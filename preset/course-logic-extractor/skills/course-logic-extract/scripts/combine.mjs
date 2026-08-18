#!/usr/bin/env node
// combine.mjs — 合并逐页 OCR 的 md 并按「内容本身」做排版规范化，产出所见即所得成品。
// Usage: node combine.mjs <mdDir|file.md> <outFile> [--keep-front]
// - 目录模式：按页码排序合并；默认丢弃封面等超短页与版权页（CIP/ISBN/出版信息签名）；
// - 文件模式：对已有 md 直接做排版规范化（reflow），原地或另存均可；
// - 排版规范化：属于同一段/整块内容的多行合并为一段（CJK 之间不留空格、拉丁词之间
//   留空格、数字间断行产生的 " - " 空隙还原）；标题、列表、表格、引用、代码块、
//   $$ 公式、点线目录行等块级结构保持不变；
// - 公式统一转换为 Obsidian 语法 $...$ / $$...$$。
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const keepFront = args.includes('--keep-front')
const raw = args.includes('--raw') // 直出模式：不做重排/目录处理/页码剥离，仅空行拼接
const positional = args.filter((a) => !a.startsWith('--'))
const [inArg, outArg] = positional
if (!inArg || !outArg) {
  console.error('usage: node combine.mjs <mdDir|file.md> <outFile> [--keep-front]')
  process.exit(2)
}

const META_RE = /图书在版编目|CIP数据|ISBN|版权所有|责任印制|印张|版次\s*\d|印次\s*\d|定价\s*\d|物料号|开本\s*\d|邮政编码|购书热线|咨询电话/i

function convertFormulas(s) {
  s = s.replace(/\\\[/g, '$$').replace(/\\\]/g, '$$')
  s = s.replace(/\\\(/g, '$').replace(/\\\)/g, '$')
  return s
}

function isFrontMatter(text) {
  const bare = text.replace(/\s+/g, '')
  if (bare.length < 250) return true
  if (META_RE.test(text)) return true
  return false
}

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
const OPEN = /[（《“‘【]/
const CLOSE = /[，。；：、！？》”’）】]/

function joinPara(parts) {
  let s = ''
  for (const p of parts) {
    if (!s) { s = p; continue }
    const prev = s.slice(-1)
    const next = p[0]
    const sep = CJK.test(prev) || CJK.test(next) || CLOSE.test(prev) || OPEN.test(next) ? '' : ' '
    s += sep + p
  }
  return s.replace(/(\d)-\s+(\d)/g, '$1-$2')
}

// 结构化起始行：正文里的例/定义/定理等（空行不断段，遇到它们才断段）
const STARTER = /^(例|定义|定理|引理|命题|推论|证明|附注|注记|注|习题|练习)\s*\d*[\.、．]/

function preprocessLine(t) {
  let s = t
  if (/^equation\s*/i.test(s)) s = s.replace(/^equation\s*/i, '')
  // 单独成行的行内公式 → 行间公式块
  const m = /^\$([^$]+)\$$/.exec(s.trim())
  if (m) return '$$' + m[1] + '$$'
  return s
}

function isBlock(t) {
  if (/^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|\||>|\$\$|```|---)/.test(t)) return true
  if (/^§\s*\d/.test(t)) return true // § 节标题行
  if (t.length < 80 && /[.．·…]{2,}/.test(t)) return true // 点线目录行
  if (t.length < 80 && /\d{1,4}$/.test(t)) return true // 以页码结尾的目录行
  if (t.length < 80 && /(^|\s)[ivxlcdm]{1,7}$/i.test(t)) return true // 罗马数字页码的目录行
  return false
}

function reflow(md) {
  const lines = md.split('\n')
  const out = []
  let para = []
  let inCode = false
  const flush = (blank) => {
    if (para.length) { out.push(joinPara(para)); para = []; if (blank) out.push('') }
  }
  for (const raw of lines) {
    if (raw.startsWith('```')) { flush(true); inCode = !inCode; out.push(raw); out.push(''); continue }
    if (inCode) { out.push(raw); continue }
    const t = preprocessLine(raw.trimEnd())
    if (t === '') continue // 空行视为软换行：不打断段落
    if (isBlock(t) || STARTER.test(t)) { flush(true); out.push(t); out.push(''); continue }
    para.push(t)
  }
  flush(false)
  const fixed = tocPass(fixToc(out))
  return fixed.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// 目录列表化：同一 § 下的编号条目拆成每行一条，紧贴 § 标题（无空行），
// 连续排列（Obsidian 渲染为有序列表）；§ 组与 § 组之间保留一个空行
function tocPass(lines) {
  const out = []
  let group = []
  let bare = false // 上一行是 § 标题且其后尚无条目
  const flushGroup = () => { if (group.length) { out.push(...group); out.push(''); group = [] } }
  const pushHeader = (line, blankAfter) => {
    if (bare && !group.length && out.length && out[out.length - 1] !== '') out.push('')
    out.push(line)
    if (blankAfter) out.push('')
    bare = !blankAfter
  }
  for (const line of lines) {
    if (line === '') continue
    if (/^#{1,6}\s|^\*第/.test(line)) { flushGroup(); pushHeader(line, true); continue }
    if (/^§\s*\d/.test(line)) { flushGroup(); pushHeader(line, false); continue }
    if (/^\d+\.\s/.test(line)) {
      group.push(...line.split(/(?=\d+\.\s)/).map((s) => s.trim()).filter(Boolean))
      bare = false
      continue
    }
    flushGroup(); out.push(line); out.push(''); bare = false
  }
  flushGroup()
  return out
}

// 修复被换行撕开的目录条目：编号开头、未以页码收尾的行，向后跨空行找含 (页码) 的续行合并
function fixToc(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!/^\d+\.\s/.test(l) || /\(\d{1,4}\)$/.test(l)) { out.push(l); continue }
    let j = i + 1
    while (j < lines.length && lines[j] === '') j++
    const n = lines[j]
    if (n !== undefined && /\(\d{1,4}\)/.test(n) && !/^#{1,6}\s|^§|^---$/.test(n)) {
      out.push(joinPara([l, n]))
      i = j
    } else out.push(l)
  }
  return out
}

const inStat = await stat(inArg)
let text
if (inStat.isDirectory()) {
  const files = (await readdir(inArg)).filter((f) => f.endsWith('.md')).sort()
  let kept = 0
  let dropped = 0
  const parts = []
  for (const f of files) {
    const s = convertFormulas(await readFile(path.join(inArg, f), 'utf8')).trim()
    if (!s) continue
    if (!raw && !keepFront && isFrontMatter(s)) { dropped++; console.log('drop ' + f); continue }
    parts.push(s)
    kept++
    console.log('keep ' + f)
  }
  text = raw ? parts.join('\n\n') : parts.join('\n')
  console.log('combine: kept=' + kept + ' dropped=' + dropped + (raw ? ' (raw)' : ''))
} else {
  text = convertFormulas(await readFile(inArg, 'utf8'))
  console.log('reflow: ' + inArg)
}
const outText = raw ? text : stripPageRefs(reflow(text))
await writeFile(outArg, outText + '\n', 'utf8')
console.log('written ' + outArg + ' (' + outText.length + ' chars)')

// md 中没有翻页概念：仅目录区内剥除 (页码) 与行尾页码/罗马页码（正文公式编号不受影响）
function stripPageRefs(text) {
  const ls = text.split('\n')
  let inToc = false
  for (let k = 0; k < ls.length; k++) {
    const t = ls[k]
    if (/^#{1,2} 目录\s*$/.test(t)) { inToc = true; continue }
    if (inToc && (/^# /.test(t) || (/^## /.test(t) && !/^## 第/.test(t)))) inToc = false
    if (!inToc || t.length > 120) continue
    let s = t
    s = s.replace(/\s*\(\d{1,4}\)\s*/g, ' ')
    s = s.replace(/\s+\d{1,4}$/, '')
    s = s.replace(/\s+[ivxlcdm]{1,7}$/i, '')
    s = s.replace(/\s{2,}/g, ' ').trim()
    if (s !== t) ls[k] = s
  }
  return ls.join('\n')
}
