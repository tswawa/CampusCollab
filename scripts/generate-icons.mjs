import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Original geometry lives in brand.svg; every generated name preserves an
// existing public URL. No fonts, remote images or external tools are required.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const source = await fs.readFile(path.join(publicDir, 'brand.svg'), 'utf8')
const svg = Buffer.from(source)
const background = '#3157d5'
const targets = [
  ['android-chrome-192x192.png', 192],
  ['android-chrome-256x256.png', 256],
  ['apple-touch-icon-180x180.png', 180, true],
  ['apple-touch-icon.png', 180, true],
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['favicon.png', 256],
  ['maskable-icon-512x512.png', 512, true],
  // Preserve the existing 270px Windows tile rendition at this historical URL.
  ['mstile-150x150.png', 270, true],
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['pwa-64x64.png', 64]
]

function render(size, opaque = false) {
  const output = sharp(svg).resize(size, size)
  return opaque ? output.flatten({ background }) : output
}

for (const [name, size, opaque] of targets) {
  await render(size, opaque).png({ compressionLevel: 9 }).toFile(path.join(publicDir, name))
}
await render(200, true).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(path.join(publicDir, 'brand.jpeg'))

// ICO directory entries contain PNG images, including a 256px rendition.
const sizes = [16, 32, 48, 256]
const icons = await Promise.all(sizes.map(size => render(size).png({ compressionLevel: 9 }).toBuffer()))
const directory = Buffer.alloc(6 + icons.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(icons.length, 4)
let offset = directory.length
for (let index = 0; index < icons.length; index += 1) {
  const entry = 6 + index * 16
  directory[entry] = sizes[index] === 256 ? 0 : sizes[index]
  directory[entry + 1] = directory[entry]
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(icons[index].length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += icons[index].length
}
await fs.writeFile(path.join(publicDir, 'favicon.ico'), Buffer.concat([directory, ...icons]))

const symbol = source.match(/<g id="symbol"[\s\S]*?<\/g>/)?.[0]
if (!symbol) throw new Error('brand.svg must contain the original symbol group')
const pinned = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n${symbol.replaceAll('#ffffff', '#000000')}\n</svg>\n`
await fs.writeFile(path.join(publicDir, 'safari-pinned-tab.svg'), pinned)
console.log(`Generated ${targets.length + 3} CampusTask icon files from public/brand.svg`)
