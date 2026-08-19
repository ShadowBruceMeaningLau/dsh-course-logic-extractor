#!/usr/bin/env node
// verify.mjs — OCR 转录质量对账。
// Usage: node verify.mjs <逐页md目录> --total=<PDF总页数> [--out=<质量报告.md>] [--short=<字符阈值>]
// - 缺失页清单（pageNNNN.md 不存在，NNNN 为绝对页码）；
// - 空页/超短页清单（默认 <100 字符）；
// - $ 行内公式与 $$ 块配对统计；
// - 输出统计到 stdout；--out 时同时写质量报告.md。
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
let total = 0
let outFile = ''
let short = 100
const positional = []
for (const a of args) {
  if (a.startsWith('--total=')) total = Number(a.slice(8)) || 0
  else if (a.startsWith('--out=')) outFile = a.slice(6)
  else if (a.startsWith('--short=')) short = Number(a.slice(8)) || 100
  else positional.push(a)
}
const [inDir] = positional
if (!inDir || !total) {
  console.error('usage: node verify.mjs <逐页md目录> --total=<PDF总页数> [--out=质量报告.md] [--short=100]')
  process.exit(2)
}
const files = (await readdir(inDir)).filter((f) => /^page\d+\.md$/.test(f))
const have = new Set(files.map((f) => Number(f.replace(/^page/, '').replace(/\.md$/, ''))))
const missing = []
for (let p = 1; p <= total; p++) if (!have.has(p)) missing.push(p)
const emptyPages = []
const shortPages = []
let dollar = 0
let dollarDbl = 0
let dollarOpen = 0
let dollarDblOpen = 0
for (const f of files) {
  const t = await readFile(path.join(inDir, f), 'utf8')
  const c = t.replace(/\s+/g, '').length
  if (c === 0) emptyPages.push(f)
  else if (c < short) shortPages.push(f + '(' + c + ')')
  const m1 = t.match(/(?<!\\)\$/g)
  if (m1) { dollar += m1.length; if (m1.length % 2 !== 0) dollarOpen++ }
  const m2 = t.match(/\$\$/g)
  if (m2) { dollarDbl += m2.length; if (m2.length % 2 !== 0) dollarDblOpen++ }
}
const lines = []
lines.push('# OCR 转录质量报告')
lines.push('')
lines.push('- 生成时间：' + new Date().toISOString().slice(0, 10))
lines.push('- 逐页目录：' + inDir)
lines.push('- PDF 总页数：' + total + '；转录文件数：' + files.length + '；缺失页：' + missing.length)
lines.push('')
lines.push('## 缺失页')
lines.push(missing.length ? missing.join('、') : '无')
lines.push('')
lines.push('## 空页（0 字符）')
lines.push(emptyPages.length ? emptyPages.join('、') : '无')
lines.push('')
lines.push('## 超短页（<' + short + ' 字符）')
lines.push(shortPages.length ? shortPages.join('、') : '无')
lines.push('')
lines.push('## 公式配对统计')
lines.push('- 行内 $ 总数：' + dollar + '；奇数（未配对）文件数：' + dollarOpen)
lines.push('- 行间 $$ 总数：' + dollarDbl + '；奇数（未配对）文件数：' + dollarDblOpen)
lines.push('')
lines.push('> 说明：缺失/空页需补转录；超短页需抽查；$ 奇数文件需人工复核公式。')
const report = lines.join('\n')
console.log('total=' + total + ' files=' + files.length + ' missing=' + missing.length + ' empty=' + emptyPages.length + ' short=' + shortPages.length + ' dollarOddFiles=' + dollarOpen + ' dblOddFiles=' + dollarDblOpen)
if (missing.length) console.log('missing: ' + missing.join('、'))
if (emptyPages.length) console.log('empty: ' + emptyPages.join('、'))
if (shortPages.length) console.log('short: ' + shortPages.slice(0, 20).join('、') + (shortPages.length > 20 ? ' …' : ''))
if (outFile) { await writeFile(outFile, report + '\n', 'utf8'); console.log('written ' + outFile) }
