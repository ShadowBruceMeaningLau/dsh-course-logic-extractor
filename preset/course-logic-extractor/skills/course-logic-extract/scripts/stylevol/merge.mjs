#!/usr/bin/env node
// merge.mjs — 合并 NN-*-N.md 分卷为成品。
// Usage: node merge.mjs <分卷目录> <成品.md>
// - 按 序号-章节-卷号 排序（文件名形如 01-第一章-1.md）；分卷间以空行连接；UTF-8 无 BOM。
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const [inDir, outFile] = args
if (!inDir || !outFile) {
  console.error('usage: node merge.mjs <分卷目录> <成品.md>')
  process.exit(2)
}
const files = (await readdir(inDir)).filter((f) => f.endsWith('.md') && /^\d{2}-.+-\d+\.md$/.test(f))
files.sort((a, b) => {
  const ka = a.replace(/\.md$/, '').split('-')
  const kb = b.replace(/\.md$/, '').split('-')
  const na = Number(ka[0]); const nb = Number(kb[0])
  if (na !== nb) return na - nb
  const ca = ka.slice(1, -1).join('-'); const cb = kb.slice(1, -1).join('-')
  if (ca !== cb) return ca < cb ? -1 : 1
  return Number(ka[ka.length - 1]) - Number(kb[kb.length - 1])
})
const parts = []
for (const f of files) {
  const s = (await readFile(path.join(inDir, f), 'utf8')).trim()
  if (s) parts.push(s)
}
const text = parts.join('\n\n') + '\n'
await writeFile(outFile, text, 'utf8')
console.log('merged ' + parts.length + ' files -> ' + outFile + ' (' + text.length + ' chars)')
console.log('order: ' + files.join(' , '))
