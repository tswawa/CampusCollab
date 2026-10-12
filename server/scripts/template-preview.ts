import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { convertInstitutionalTemplate, type InstitutionalTemplateInput } from '../../shared/institutional-templates.js'
import { productNames } from '../../shared/brand.js'

const [inputName, outputName] = process.argv.slice(2)
if (!inputName || !outputName) throw new Error('Usage: npm run template:preview -- <input.json> <new-output-directory>')
const inputFile = path.resolve(inputName)
if (fs.statSync(inputFile).size > 5 * 1024 * 1024) throw new Error('Template input exceeds 5MB')
const parsed = JSON.parse(fs.readFileSync(inputFile, 'utf8')) as
  InstitutionalTemplateInput | { fixtureVersion: number; input: InstitutionalTemplateInput }
const output = convertInstitutionalTemplate('fixtureVersion' in parsed ? parsed.input : parsed)
const outputDirectory = path.resolve(outputName)
if (fs.existsSync(outputDirectory))
  throw new Error('Choose a new output directory; existing files are never overwritten')
const workbook = new ExcelJS.Workbook()
workbook.creator = productNames.en
const readme = workbook.addWorksheet('Read first')
readme.addRows([
  ['历史字段映射预览 / Historical field mapping preview'],
  ['学校当前接收状态未验证。This preview is not an accepted institutional form or credit certification.'],
  ['Template', `${output.templateId}@${output.templateVersion}`],
  ['Source', output.source.fileUrl],
  ['Source SHA-256', output.source.sha256],
  ['Policy', output.policy.id],
  ['Confirmed by', output.policy.confirmation.confirmedBy],
  ['Reason', output.policy.confirmation.reason],
  ['Unit', output.unit],
  ...output.warnings.map(warning => [warning.code, `${warning.description['zh-CN']} / ${warning.description.en}`])
])
readme.getColumn(1).width = 44
readme.getColumn(2).width = 100
readme.eachRow(row => {
  row.alignment = { vertical: 'top', wrapText: true }
  row.height = 45
})
const mapping = workbook.addWorksheet('Historical mapping', { views: [{ state: 'frozen', ySplit: 5 }] })
for (const [address, value] of Object.entries(output.cells)) {
  const cell = mapping.getCell(address)
  cell.value = value // Strings, including formula-like names, are never formula objects.
  cell.numFmt = typeof value === 'number' ? '0.########' : '@'
}
mapping.columns.forEach(column => {
  column.width = 27
})
mapping.getRow(5).font = { bold: true }
mapping.eachRow(row => {
  row.alignment = { vertical: 'top', wrapText: true }
})
const binary = await workbook.xlsx.writeBuffer()
fs.mkdirSync(outputDirectory)
fs.writeFileSync(path.join(outputDirectory, 'preview.json'), JSON.stringify(output, null, 2), { flag: 'wx' })
fs.writeFileSync(path.join(outputDirectory, 'preview.xlsx'), Buffer.from(binary), { flag: 'wx' })
fs.writeFileSync(
  path.join(outputDirectory, 'README.txt'),
  '历史字段映射预览；学校当前接收状态未验证。\nHistorical field mapping preview; current institutional acceptance is unverified.\nThe original minutes, source references and explicitly confirmed calculation policy are retained in preview.json. No original school branding, seal, signature or approval is reproduced.\n',
  { flag: 'wx' }
)
console.log(`Historical preview created: ${outputDirectory}`)
