#!/usr/bin/env node
// pdfrender.mjs — 用 MuPDF 把 PDF 的指定页码范围渲染成 PNG（供 DeepSeek-OCR 使用）。
// Usage: node pdfrender.mjs <file.pdf> <outDir> [--pages=1-20] [--scale=2]
// 输出命名 pageNN.png（NN 为绝对页码）；mupdf 已随本脚本目录安装。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
let pagesArg = ''
let scale = 2
const positional = []
for (const a of args) {
  if (a.startsWith('--pages=')) pagesArg = a.slice(8)
  else if (a.startsWith('--scale=')) scale = Math.max(1, Math.min(4, Number(a.slice(8)) || 2))
  else positional.push(a)
}
const [pdfArg, outArg] = positional
if (!pdfArg || !outArg) {
  console.error('usage: node pdfrender.mjs <file.pdf> <outDir> [--pages=1-20] [--scale=2]')
  process.exit(2)
}
const pdfPath = path.resolve(pdfArg)
const outDir = path.resolve(outArg)

const mod = await import('mupdf')
const mupdf = mod.default ?? mod
if (typeof mupdf.ready === 'function') await mupdf.ready

const doc = mupdf.Document.openDocument(readFileSync(pdfPath), 'application/pdf')
const total = doc.countPages()
const m = /^(\d+)-(\d+)$/.exec(pagesArg || '')
let s = 1
let e = total
if (m) {
  s = Number(m[1])
  e = Number(m[2])
  if (s < 1 || e > total || s > e) {
    console.error('pdfrender: 页码超出范围（总页数 ' + total + '）')
    process.exit(2)
  }
} else if (total > 20) {
  console.error('pdfrender: 该 PDF 共 ' + total + ' 页，请用 --pages=起-止 指定范围（单次建议 ≤100 页）')
  process.exit(2)
}
const matrix = mupdf.Matrix.scale(scale, scale)
mkdirSync(outDir, { recursive: true })
for (let i = s; i <= e; i++) {
  const page = doc.loadPage(i - 1)
  const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
  const png = pix.asPNG()
  const out = path.join(outDir, 'page' + String(i).padStart(2, '0') + '.png')
  writeFileSync(out, Buffer.from(png))
  console.log('rendered ' + out + ' (' + png.length + ' bytes)')
}
console.log('pdfrender: ' + (e - s + 1) + ' pages -> ' + outDir)
