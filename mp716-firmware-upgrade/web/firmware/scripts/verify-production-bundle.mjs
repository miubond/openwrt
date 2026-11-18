import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const dist = join(root, 'dist')

const forbidden = [
  '/cgi-bin/mp716',
  'DeviceRouterAdapter',
  'mp716-legacy-httpd',
  'httpd.uc',
  'changeme123',
]

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
  console.error('BLOCKED: run build first (dist/index.html missing)')
  process.exit(1)
}

const files = walk(dist)
let bytes = 0
const hits = []

for (const file of files) {
  bytes += statSync(file).size
  if (!file.endsWith('.js') && !file.endsWith('.html')) continue
  const text = readFileSync(file, 'utf8')
  for (const needle of forbidden) {
    if (text.includes(needle)) hits.push({ file, needle })
  }
}

const index = readFileSync(join(dist, 'index.html'), 'utf8')
const baseOk = index.includes('/mp716/') || index.includes('href="/assets/')

console.log(JSON.stringify({ distBytes: bytes, distFiles: files.length, baseMp716Hint: baseOk, forbiddenHits: hits }, null, 2))

if (hits.length) process.exit(1)
