/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRosterCsv, mapRosterRows } from './roster'
const mapping = { externalId: 0, name: 1, department: 2, className: -1 }
test('CSV preserves leading-zero IDs, identical names, Unicode and quoted commas', () => {
  const rows = parseRosterCsv(
    '\uFEFFID,Name,Unit\r\n0001,"Lee, Alex",Community\r\n0002,"Lee, Alex",Community\r\n0003,月,Community\r\n'
  )
  const result = mapRosterRows(rows, mapping)
  assert.deepEqual(
    result.map(row => row.externalId),
    ['0001', '0002', '0003']
  )
  assert.equal(result[0]?.name, 'Lee, Alex')
  assert.equal(result[1]?.name, 'Lee, Alex')
  assert.equal(result[2]?.name, '月')
})
test('CSV reads multiline quoted fields and escaped quotes', () => {
  assert.deepEqual(parseRosterCsv('id,name\n01,"Alex ""A""\nMorgan"'), [
    ['id', 'name'],
    ['01', 'Alex "A"\nMorgan']
  ])
})
test('invalid quoting and ambiguous column mapping cannot be silently imported', () => {
  for (const text of ['id,name\n1,"open', 'id,name\n1,"closed"extra', 'id,name\n1,bad"quote'])
    assert.throws(() => parseRosterCsv(text), /INVALID_CSV/)
  assert.throws(() => mapRosterRows([['id'], ['01']], { ...mapping, name: 0 }), /INVALID_MAPPING/)
})
test('missing IDs remain empty for server preview instead of being invented or merged', () => {
  const result = mapRosterRows(parseRosterCsv('id,name\n,Same Name\n,Same Name'), { ...mapping, department: -1 })
  assert.equal(result.length, 2)
  assert.equal(result[0]?.externalId, '')
  assert.equal(result[1]?.externalId, '')
})
