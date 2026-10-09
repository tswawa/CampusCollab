import { loadConfig } from '../config.js'
import { AppDatabase } from '../db/database.js'
import { drainMailQueue, recoverInterruptedMail } from '../mail/index.js'

// The database lease requires the web application to be stopped. No credentials
// or addresses are included in the command result. SMTP acceptance is not receipt.
const db = new AppDatabase(loadConfig())
try {
  db.migrate()
  recoverInterruptedMail(db)
  const result = await drainMailQueue(db, undefined, 100)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.failed > 0) process.exitCode = 1
} finally { db.close() }
