#!/usr/bin/env node
// check.mjs — 分卷合并成品校验：内容一致性 + 结构 QA + 覆盖核对。
// Usage: node check.mjs <直出稿.md> <分卷目录> <成品.md>
// - 一致性：规范化（去标题符/列表符/加粗/公式符/空白）后逐字符比对直出稿与成品，报前 20 处差异；
// - 结构 QA：标题层级计数、$$ fence 数、纯数字行（疑似页码）、LaTeX 旧分隔符残留；
// - 覆盖核对：每卷首尾内容行在直出稿中的行号与卷间缺口（gap）。
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const [srcArg, volDir, mergedArg] = args
if (!srcArg || !volDir || !mergedArg) {
  console.error('usage: node check.mjs <直出稿.md> <分卷目录> <成品.md>')
  process.exit(2)
}

function norm(s, stripPage = false) {
  if (!s) return ''
  let t = s
  t = t.replace(/^\s*#{1,6}\s*/, '')
  t = t.replace(/^[\s\t]*[-*+][\s\t]+/, '')
  t = t.replace(/\*\*/g, '').replace(/\$/g, '')
  t = t.replace(/\\\(/g, '').replace(/\\\)/g, '').replace(/\\\[/g, '').replace(/\\\]/g, '')
  if (stripPage) {
    t = t.replace(/\(\s*\d+\s*\)\s*$/, '')
    t = t.replace(/[.\s\u2026]*\d+\s*$/, '')
  }
  return t.replace(/\s+/g, '')
}

// 目录区状态机：直出稿目录条目带页码、成品目录不带——规范化为「目录区剥离行尾页码」后两者方可一致。
// 进入：`# 目录`/`## 目录` 标题；退出：连续 2 行不似目录条目。
function makeTocNorm() {
  let inToc = false
  let miss = 0
  return function (s) {
    if (!s) return ''
    if (!inToc && /^#{1,2}\s*目录/.test(s)) { inToc = true; miss = 0 }
    let strip = false
    if (inToc) {
      const looksToc = /\(\s*\d+\s*\)\s*$/.test(s) || /^§\s*\d/.test(s) || /^\d+\.\s/.test(s) ||
        /^#{1,2}\s*目录/.test(s) || /^第[一二三四五六七八九十百零〇\d]+章/.test(s) ||
        /^\s*[-*+]\s+第/.test(s) || /^#{1,2}\s*第/.test(s)
      if (looksToc) { miss = 0; strip = true } else { miss++; if (miss >= 2) { inToc = false; miss = 0 } }
    }
    return norm(s, strip)
  }
}

const srcLines = (await readFile(srcArg, 'utf8')).split('\n')
const volLines = (await readFile(mergedArg, 'utf8')).split('\n')

// ---- 一致性比对 ----
const normSrc = makeTocNorm()
const sbA = []
const map = []
for (let i = 0; i < srcLines.length; i++) {
  const n = normSrc(srcLines[i])
  if (n) { for (const ch of n) { sbA.push(ch); map.push(i + 1) } }
}
const A = sbA.join('')
const normMerged = makeTocNorm()
let B = ''
for (const ln of volLines) { const n = normMerged(ln); if (n) B += n }
console.log('chars: src=' + A.length + ' merged=' + B.length)
if (A === B) {
  console.log('RESULT: 成品与直出稿内容一致（仅排版差异）')
} else {
  console.log('RESULT: 发现差异（前 20 处）')
  let i = 0; let j = 0; let n = 0; const W = 24; const LOOK = 8000
  while (i < A.length && j < B.length && n < 20) {
    if (A[i] === B[j]) { i++; j++; continue }
    const line = i < map.length ? map[i] : -1
    let done = false
    if (i + W <= A.length) {
      const pos = B.indexOf(A.slice(i, i + W), j)
      if (pos >= 0 && pos - j < LOOK) { n++; console.log('  #' + n + ' src行' + line + ' 成品多出(' + (pos - j) + ') [' + B.slice(j, j + 70) + ']'); j = pos; done = true }
    }
    if (!done && j + W <= B.length) {
      const pos = A.indexOf(B.slice(j, j + W), i)
      if (pos >= 0 && pos - i < LOOK) { n++; console.log('  #' + n + ' src行' + line + ' 直出稿丢失(' + (pos - i) + ') [' + A.slice(i, i + 70) + ']'); i = pos; done = true }
    }
    if (!done) { n++; console.log('  #' + n + ' src行' + line + ' 不一致 src[' + A.slice(i, i + 40) + '] 成品[' + B.slice(j, j + 40) + ']'); i++; j++ }
  }
}

// ---- 结构 QA ----
const h1 = volLines.filter((l) => /^# /.test(l))
const h2 = volLines.filter((l) => /^## /.test(l)).length
const h3 = volLines.filter((l) => /^### /.test(l)).length
const fence = volLines.filter((l) => l.trim() === '$$').length
const pageOnly = volLines.filter((l) => /^\d{1,3}$/.test(l.trim())).length
const hr = volLines.filter((l) => /^(---|\*\*\*|___)$/.test(l.trim())).length
const oldDelim = volLines.filter((l) => /\\\(|\\\)|\\\[|\\\]/.test(l)).length
console.log('')
console.log('STRUCTURE: 行数=' + volLines.length + ' H1=' + h1.length + ' H2=' + h2 + ' H3=' + h3 + " '$$'fence=" + fence + ' 纯页码行=' + pageOnly + ' hr=' + hr + ' LaTeX旧分隔符=' + oldDelim)
console.log('H1 标题顺序:')
h1.forEach((l) => console.log('  ' + l))

// ---- 覆盖核对 ----
const idx = new Map()
for (let i = 0; i < srcLines.length; i++) {
  const n = norm(srcLines[i])
  if (n.length >= 6) {
    if (!idx.has(n)) idx.set(n, [])
    idx.get(n).push(i + 1)
  }
}
function pick(n, after) {
  if (!n || !idx.has(n)) return 0
  for (const v of idx.get(n)) if (v >= after) return v
  const list = idx.get(n)
  return list[list.length - 1]
}
const vols = (await readdir(volDir)).filter((f) => f.endsWith('.md') && /^\d{2}-.+-\d+\.md$/.test(f))
vols.sort((a, b) => {
  const ka = a.replace(/\.md$/, '').split('-'); const kb = b.replace(/\.md$/, '').split('-')
  const na = Number(ka[0]); const nb = Number(kb[0])
  if (na !== nb) return na - nb
  const ca = ka.slice(1, -1).join('-'); const cb = kb.slice(1, -1).join('-')
  if (ca !== cb) return ca < cb ? -1 : 1
  return Number(ka[ka.length - 1]) - Number(kb[kb.length - 1])
})
let prevEnd = 0
console.log('')
console.log('覆盖核对（每卷在直出稿中的定位）:')
for (const f of vols) {
  const lines = (await readFile(path.join(volDir, f), 'utf8')).split('\n')
  let firstNorm = ''; for (const l of lines) { const n = norm(l); if (n.length >= 6) { firstNorm = n; break } }
  let lastNorm = ''; for (let k = lines.length - 1; k >= 0; k--) { const n = norm(lines[k]); if (n.length >= 6) { lastNorm = n; break } }
  const s = pick(firstNorm, Math.max(1, prevEnd - 5))
  const e = pick(lastNorm, Math.max(1, s))
  const gap = s > 0 ? s - prevEnd - 1 : -999
  console.log('  ' + f + ' 行数=' + lines.length + ' 起始行=' + s + ' 结束行=' + e + ' 前缺口=' + gap)
  if (e > 0) prevEnd = e
}
