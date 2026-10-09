import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../config.js'
import { projectRoot } from '../config.js'
import { acquireDatabaseLease } from './lease.js'
import { productNames } from '../../shared/brand.js'

export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlRow = Record<string, unknown>

export function nowIso(): string {
  return new Date().toISOString()
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

export class AppDatabase {
  readonly raw: DatabaseSync
  private readonly releaseLease: () => void
  private closed = false

  constructor(readonly config: AppConfig) {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })
    this.releaseLease = acquireDatabaseLease(config.databasePath)
    let opened: DatabaseSync | undefined
    try {
      opened = new DatabaseSync(config.databasePath)
      opened.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      if (config.databasePath !== ':memory:') opened.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
      this.raw = opened
    } catch (error) {
      opened?.close()
      this.releaseLease()
      throw error
    }
  }

  migrate() {
    const migrationDir = path.resolve(projectRoot, 'server/db/migrations')
    const files = fs.readdirSync(migrationDir)
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b))
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;`)
    const applied = new Set(
      (this.raw.prepare('SELECT version FROM schema_migrations').all() as SqlRow[])
        .map((row) => Number(row.version))
    )
    for (const file of files) {
      const version = Number(file.split('_', 1)[0])
      if (applied.has(version)) continue
      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8')
      const rebuild = sql.split(/\r?\n/, 1)[0] === '-- requires-foreign-keys-off'
      // Table rebuilds require FK enforcement to be disabled before BEGIN, never mid-transaction.
      const previousLegacy = Number(this.get('PRAGMA legacy_alter_table')?.legacy_alter_table ?? 0)
      if (rebuild) this.raw.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;')
      try {
        this.transaction(() => {
          this.raw.exec(sql)
          if (version === 1) this.seedBaseData()
          if (this.raw.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration ${file} violates foreign keys`)
          this.raw.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
            .run(version, file, nowIso())
        })
      } finally {
        if (rebuild) this.raw.exec(`PRAGMA legacy_alter_table = ${previousLegacy}; PRAGMA foreign_keys = ON;`)
      }
    }
  }

  transaction<T>(work: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      try { this.raw.exec('ROLLBACK') } catch { /* database already rolled back */ }
      throw error
    }
  }

  get<T extends SqlRow = SqlRow>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined
  }

  all<T extends SqlRow = SqlRow>(sql: string, ...params: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[]
  }

  run(sql: string, ...params: SqlValue[]) {
    return this.raw.prepare(sql).run(...params)
  }

  close() {
    if (this.closed) return
    this.closed = true
    try { this.raw.close() } finally { this.releaseLease() }
  }

  private seedBaseData() {
    const timestamp = nowIso()
    const departments = [
      ['dept-cs', '计算机科学与技术学院', 'CS'],
      ['dept-ie', '信息与电子工程学院', 'IE'],
      ['dept-me', '机械工程学院', 'ME'],
      ['dept-ce', '建筑工程学院', 'CE'],
      ['dept-fl', '外国语学院', 'FL'],
      ['dept-admin', '信息化与教务管理中心', 'ADMIN']
    ]
    const grades = [
      ['grade-2023', '2023级'], ['grade-2024', '2024级'],
      ['grade-2025', '2025级'], ['grade-2026', '2026级']
    ]
    const classes = [
      ['class-24cs1', '24计科1班', 'dept-cs', 'grade-2024'],
      ['class-24cs2', '24计科2班', 'dept-cs', 'grade-2024'],
      ['class-24se1', '24软件1班', 'dept-cs', 'grade-2024'],
      ['class-25cs1', '25计科1班', 'dept-cs', 'grade-2025'],
      ['class-24com1', '24通信1班', 'dept-ie', 'grade-2024'],
      ['class-24ee1', '24电子1班', 'dept-ie', 'grade-2024'],
      ['class-23me2', '23机械2班', 'dept-me', 'grade-2023'],
      ['class-24civil1', '24土木1班', 'dept-ce', 'grade-2024'],
      ['class-24en1', '24英语1班', 'dept-fl', 'grade-2024']
    ]
    const campuses = [
      ['campus-main', '主校区'], ['campus-east', '东校区'],
      ['campus-west', '西校区'], ['campus-online', '线上协助']
    ]
    const categories = [
      ['category-event', '活动协助'], ['category-place', '场地协助'],
      ['category-document', '资料整理'], ['category-design', '设计制作'],
      ['category-device', '设备协助']
    ]
    const departmentStatement = this.raw.prepare(`INSERT OR IGNORE INTO departments
      (id, name, code, enabled, version, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)`)
    departments.forEach(([id, name, code]) => departmentStatement.run(id, name, code, timestamp, timestamp))
    const gradeStatement = this.raw.prepare(`INSERT OR IGNORE INTO grades
      (id, name, enabled, version, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)`)
    grades.forEach(([id, name]) => gradeStatement.run(id, name, timestamp, timestamp))
    const classStatement = this.raw.prepare(`INSERT OR IGNORE INTO classes
      (id, name, department_id, grade_id, enabled, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)`)
    classes.forEach(([id, name, departmentId, gradeId]) => classStatement.run(id, name, departmentId, gradeId, timestamp, timestamp))
    const campusStatement = this.raw.prepare(`INSERT OR IGNORE INTO campuses
      (id, name, enabled, version, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)`)
    campuses.forEach(([id, name]) => campusStatement.run(id, name, timestamp, timestamp))
    const categoryStatement = this.raw.prepare(`INSERT OR IGNORE INTO task_categories
      (id, name, enabled, version, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)`)
    categories.forEach(([id, name]) => categoryStatement.run(id, name, timestamp, timestamp))
    this.raw.prepare(`INSERT OR IGNORE INTO school_settings
      (id, name, platform_name, logo_file_id, logo_url, badge, announcement, primary_color, timezone, version, updated_at)
      VALUES (1, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?)`)
      .run(
        'XX大学', productNames['zh-CN'], '/brand.jpeg', '校内',
        '本学期校内勤工助学、实验助理与教务协助任务通道已开放。',
        '#1E60D5', this.config.timezone, timestamp
      )
  }
}
