import type { RosterImportRow } from '../../../shared/workflow-contracts'

/** RFC 4180-style CSV reader. Identity cells stay as strings, including leading zeroes. */
export function parseRosterCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closed = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
        closed = true
      } else field += char
    } else if (char === '"' && !field && !closed) quoted = true
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field)
      field = ''
      closed = false
      if (char !== ',') {
        if (row.some(value => value.trim())) rows.push(row)
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
      }
    } else {
      if (closed || char === '"') throw new Error('INVALID_CSV')
      field += char
    }
  }
  if (quoted) throw new Error('INVALID_CSV')
  row.push(field)
  if (row.some(value => value.trim())) rows.push(row)
  return rows
}

export function mapRosterRows(
  rows: string[][],
  mapping: { externalId: number; name: number; department: number; className: number }
): RosterImportRow[] {
  if (mapping.externalId < 0 || mapping.name < 0 || mapping.externalId === mapping.name)
    throw new Error('INVALID_MAPPING')
  return rows.slice(1).map(row => ({
    externalId: (row[mapping.externalId] ?? '').trim(),
    name: (row[mapping.name] ?? '').trim(),
    department: mapping.department < 0 ? undefined : row[mapping.department]?.trim(),
    className: mapping.className < 0 ? undefined : row[mapping.className]?.trim()
  }))
}
