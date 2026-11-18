import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = join(root, 'dist')
const overlay = join(root, 'firmware', 'web-overlay', 'www')
const reportJson = join(root, 'firmware', 'reports', 'web-overlay-manifest.json')

const forbiddenNames = new Set([
  'cgi_huayi.cgi',
  'cgi_modem.cgi',
  'cgi_no_login.cgi',
  'cgi_stream.cgi',
  'httpd.uc',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('BLOCKED: dist/index.html missing. Run npm run build first.')
  process.exit(1)
}

const distFiles = walk(dist)
for (const file of distFiles) {
  const base = file.split(/[/\\]/).pop()
  if (forbiddenNames.has(base)) {
    console.error(`BLOCKED: web overlay must not include ${base}`)
    process.exit(1)
  }
  if (file.endsWith('.js')) {
    const text = readFileSync(file, 'utf8')
    if (text.includes('/cgi-bin/mp716') || text.includes('changeme123')) {
      console.error(`BLOCKED: production bundle still contains a non-factory dependency: ${relative(root, file)}`)
      process.exit(1)
    }
  }
}

rmSync(overlay, { recursive: true, force: true })
mkdirSync(overlay, { recursive: true })
cpSync(dist, overlay, { recursive: true })

const files = walk(overlay)
  .map((abs) => {
    const data = readFileSync(abs)
    return {
      path: relative(overlay, abs).replaceAll('\\', '/'),
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      crc32: (crc32(data) >>> 0).toString(16).padStart(8, '0'),
    }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

const rawBytes = files.reduce((sum, file) => sum + file.bytes, 0)
const manifestBody = files.map((file) => `${file.sha256}  ${file.path}`).join('\n')
const manifest = {
  generatedAt: new Date().toISOString(),
  role: 'web-static-overlay',
  replaces: 'factory /www static files only',
  doesNotInclude: ['kernel', 'cgi binaries', 'huayi_core', 'lighttpd config', 'uci'],
  candidateBin: null,
  reasonBinMissing: 'No original factory BIN and no verified firmware_repack.py in this workspace.',
  fileCount: files.length,
  rawBytes,
  sha256: createHash('sha256').update(manifestBody).digest('hex'),
  crc32: (crc32(Buffer.from(manifestBody)) >>> 0).toString(16).padStart(8, '0'),
  files,
}

mkdirSync(dirname(reportJson), { recursive: true })
writeFileSync(reportJson, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`web overlay ${files.length} files, ${rawBytes} bytes`)
console.log(`manifest ${relative(root, reportJson)}`)
console.log('candidate BIN not created')
