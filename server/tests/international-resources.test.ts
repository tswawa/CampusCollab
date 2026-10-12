import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { englishErrors } from '../i18n/messages.js'
import { localizeApiPayload } from '../i18n/index.js'

test('every literal application error code has an English display resource', () => {
  const missing: string[] = []
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') walk(file)
        continue
      }
      if (!file.endsWith('.ts')) continue
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const inspect = (node: ts.Node) => {
        let code: ts.Expression | undefined
        if (ts.isNewExpression(node) && node.expression.getText(source) === 'AppError') code = node.arguments?.[1]
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'assertCondition') code = node.arguments[2]
        if (code && ts.isStringLiteral(code) && !englishErrors[code.text]) missing.push(`${file}: ${code.text}`)
        ts.forEachChild(node, inspect)
      }
      inspect(source)
    }
  }
  walk('server')
  assert.deepEqual([...new Set(missing)], [])
})

test('batch failures are localized by code while task titles and authored feedback remain unchanged', () => {
  const original = {
    ok: true,
    code: 'SUCCESS',
    message: '操作成功',
    data: {
      title: '用户原文标题',
      feedback: '用户原文反馈',
      results: [
        {
          participantId: 'fixture',
          ok: false,
          code: 'WORKFLOW_REVISION_STALE',
          message: '待审材料已变化，请核对最新版本'
        }
      ]
    }
  }
  const english = JSON.parse(localizeApiPayload(JSON.stringify(original), 'en'))
  assert.equal(english.message, 'Success.')
  assert.equal(english.data.title, original.data.title)
  assert.equal(english.data.feedback, original.data.feedback)
  assert.match(english.data.results[0].message, /latest version/)
  assert.equal(english.data.results[0].code, 'WORKFLOW_REVISION_STALE')
})
