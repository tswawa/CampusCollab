import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ExcelJS from 'exceljs'

test('historical preview CLI preserves text IDs and provenance, writes no formulas and refuses overwrite', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-template-preview-'))
  try {
    const fixture = JSON.parse(fs.readFileSync('docs/templates/hfut-2018.anonymous.json', 'utf8'))
    fixture.input.rows[0].name = '=1+1'
    const inputFile = path.join(root, 'input.json')
    const output = path.join(root, 'preview')
    fs.writeFileSync(inputFile, JSON.stringify(fixture))
    const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/template-preview.ts', inputFile, output], { cwd: process.cwd(), encoding: 'utf8' })
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    const json = JSON.parse(fs.readFileSync(path.join(output, 'preview.json'), 'utf8'))
    assert.equal(json.currentInstitutionalAcceptance, 'unverified')
    assert.deepEqual(json.originalInput, fixture.input)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(path.join(output, 'preview.xlsx'))
    const sheet = workbook.getWorksheet('Historical mapping')!
    assert.equal(sheet.getCell('B6').value, fixture.input.rows[0].externalId)
    assert.equal(sheet.getCell('B6').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('C6').value, '=1+1')
    assert.equal(sheet.getCell('C6').type, ExcelJS.ValueType.String)
    assert.equal(sheet.getCell('F6').value, json.rows[0].values[5])
    assert.equal(workbook.worksheets[0]!.name, 'Read first')
    const before = fs.readFileSync(path.join(output, 'preview.xlsx'))
    assert.notEqual(run().status, 0)
    assert.deepEqual(fs.readFileSync(path.join(output, 'preview.xlsx')), before)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
