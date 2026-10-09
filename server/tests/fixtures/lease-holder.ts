import fs from 'node:fs'
import { acquireDatabaseLease } from '../../db/lease.js'

const [databasePath, mode] = process.argv.slice(2)
if (!databasePath || !process.send) throw new Error('Fixture requires a database path and IPC')
let release: () => void
if (mode === 'legacy') {
  const filename = `${databasePath}.lock`
  fs.writeFileSync(filename, JSON.stringify({ pid: process.pid, token: 'legacy-fixture' }), { flag: 'wx' })
  release = () => fs.unlinkSync(filename)
} else release = acquireDatabaseLease(databasePath)
process.on('message', message => {
  if (message !== 'release') return
  release()
  process.disconnect()
})
process.send('ready')
