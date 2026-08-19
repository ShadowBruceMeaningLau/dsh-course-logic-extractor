#!/usr/bin/env node
// split.mjs — 按章切分直出稿为分卷（供参考风格优化分批处理）。
// Usage: node split.mjs <直出稿.md> <分卷目录> [--pattern=<正则>] [--max-chars=<n>]
// - 默认按章标题切分：^#{1,3}\s*第[一二三四五六七八九十百零〇\d]+章；--pattern 可覆盖；
// - --max-chars：单卷字符数超限时按后续标题再切（文件名为 NN-第X章-N.md，N 从 1）；
// - 输出命名：NN-第X章.md（或 NN-第X章-N.md）；UTF-8 无 BOM。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
let pattern = ''
let maxChars = 0
const positional = []
for (const a of args) {
  if (a.startsWith('--pattern=')) pattern = a.slice(10)
  else if (a.startsWith('--max-chars=')) maxChars = Number(a.slice(12)) || 0
  else positional.push(a)
}
const [inArg, outDir] = positional
if (!inArg || !outDir) {
  console.error('usage: node split.mjs <直出稿.md> <分卷目录> [--pattern=正则] [--max-chars=n]')
  process.exit(2)
}
const text = await readFile(inArg, 'utf8')
const lines = text.split('\n')
const chapterRe = new RegExp(pattern || '^#{1,3}\\s*第[一二三四五六七八九十百零〇\\d]+章')
// 目录区章标题（行尾带 (页码) 或后随目录条目流）不算切分点
function isTocChapterTitle(line, i) {
  if (/\(\s*\d+\s*\)\s*$/.test(line)) return true
  let tocLike = 0
  for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
    if (/^\d+\.\s/.test(lines[k]) || /^§\s*\d/.test(lines[k]) || /\(\s*\d+\s*\)\s*$/.test(lines[k])) tocLike++
  }
  return tocLike >= 2
}
const heads = []
lines.forEach((l, i) => { if (chapterRe.test(l) && !isTocChapterTitle(l, i)) heads.push(i) })
if (heads.length === 0) { console.error('split: 未找到章标题，请用 --pattern 指定章标题正则'); process.exit(2) }

const chapters = []
for (let h = 0; h < heads.length; h++) {
  const start = heads[h]
  const end = h + 1 < heads.length ? heads[h + 1] : lines.length
  chapters.push({ title: lines[start].replace(/^#{1,3}\s*/, '').trim(), body: lines.slice(start, end) })
}

// 单章超限时按后续标题（任意级）再切
function chunk(body) {
  if (!maxChars || body.join('\n').length <= maxChars) return [body]
  const cuts = [0]
  for (let i = 1; i < body.length; i++) if (/^#{1,6}\s/.test(body[i])) cuts.push(i)
  cuts.push(body.length)
  const out = []
  let cur = []
  for (let c = 1; c < cuts.length; c++) {
    cur = body.slice(cuts[c - 1], cuts[c])
    if (cur.join('\n').length > maxChars && /^#{1,6}\s/.test(cur[0] || '')) {
      // 仍超限：按空行二分兜底
      const half = Math.floor(cur.length / 2)
      out.push(cur.slice(0, half)); cur = cur.slice(half)
    }
    if (cur.length) out.push(cur)
  }
  return out
}

await mkdir(outDir, { recursive: true })
let count = 0
chapters.forEach((ch, ci) => {
  const seq = String(ci + 1).padStart(2, '0')
  const parts = chunk(ch.body)
  parts.forEach((body, pi) => {
    const name = seq + '-' + ch.title + (parts.length > 1 ? '-' + (pi + 1) : '') + '.md'
    writeFile(path.join(outDir, name), body.join('\n').trimEnd() + '\n', 'utf8').then(() => {
      count++
      console.log('wrote ' + name + ' (' + body.join('\n').length + ' chars)')
    })
  })
})
await new Promise((r) => setTimeout(r, 100))
console.log('split: ' + chapters.length + ' chapters -> ' + count + ' volumes in ' + outDir)
