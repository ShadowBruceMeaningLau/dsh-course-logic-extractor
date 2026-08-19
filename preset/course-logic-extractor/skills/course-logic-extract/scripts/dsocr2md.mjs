#!/usr/bin/env node
// dsocr2md.mjs — 文档/图片 → Markdown OCR（GLM-OCR，智谱 bigmodel）。
// Usage: node dsocr2md.mjs <imagesDir|file.pdf> [outDir] [--pages=1-20] [--workers=4] [--delay=2000]
// - 图片：data URI 直传；PDF：≤100 页整本直传，>100 页用 mupdf 拆页（--pages=起-止）；
// - 空响应/5xx/402/429 自动重试 3 次；已存在的 .md 自动跳过（断点续跑）；
// - --workers=N：并发池（默认 1，建议 4-6）。
// Key：环境变量 ZHIPU_API_KEY，或 ~/.dsh/free-vision.json 的 zhipuApiKey 字段。
import { readFile, writeFile, readdir, mkdir, access, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
let delayMs = 2000
let workers = 1
let pagesArg = ''
for (const a of args) {
  if (a.startsWith('--delay=')) delayMs = Math.max(0, Number(a.slice(8)) || 0)
  else if (a.startsWith('--workers=')) workers = Math.max(1, Math.min(12, Number(a.slice(10)) || 1))
  else if (a.startsWith('--pages=')) pagesArg = a.slice(8)
}
const positional = args.filter((a) => !a.startsWith('--'))
const [inputArg, outArg] = positional
if (!inputArg) {
  console.error('usage: node dsocr2md.mjs <imagesDir|file.pdf> [outDir] [--pages=1-20] [--workers=4] [--delay=2000]')
  process.exit(2)
}
const inputPath = path.resolve(inputArg)

const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4/layout_parsing'
const MODEL = 'glm-ocr'
const MAX_IMG_BYTES = 10 * 1024 * 1024 // 图片 ≤10MB
const MAX_PDF_BYTES = 50 * 1024 * 1024 // PDF ≤50MB
const MAX_PDF_PAGES = 100 // PDF ≤100 页

function loadZhipuKey() {
  let key = process.env.ZHIPU_API_KEY || ''
  if (!key) {
    try {
      const raw = readFileSync(path.join(os.homedir(), '.dsh', 'free-vision.json'), 'utf8')
      key = JSON.parse(raw)?.zhipuApiKey || ''
    } catch { /* 忽略读取失败 */ }
  }
  if (!key) {
    console.error('dsocr2md: 未找到智谱 API Key（环境变量 ZHIPU_API_KEY 或 ~/.dsh/free-vision.json 的 zhipuApiKey 字段）')
    process.exit(2)
  }
  return key
}

const ZHIPU_KEY = loadZhipuKey()

// GLM-OCR 专用端点 layout_parsing：body 为 {model, file}，file 为 data URI（图片 ≤10MB / PDF ≤50MB ≤100 页）
async function zhipuLayoutParsing(dataUrl) {
  const res = await fetch(ZHIPU_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ZHIPU_KEY },
    body: JSON.stringify({ model: MODEL, file: dataUrl }),
    signal: AbortSignal.timeout(600000),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = 'HTTP ' + res.status
    try { msg += ': ' + (JSON.parse(text)?.error?.message || text.slice(0, 200)) } catch { msg += ': ' + text.slice(0, 200) }
    throw new Error(msg)
  }
  const j = JSON.parse(text)
  const md = j?.md_results
  if (typeof md !== 'string' || md.trim() === '') throw new Error('空响应（余额不足或模型暂不可用）')
  return md.trim()
}

async function callOcr(dataUrl) {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await zhipuLayoutParsing(dataUrl)
    } catch (error) {
      lastErr = error
      if (attempt < 3) {
        console.log('  retry ' + attempt + '/3: ' + String(error?.message || error).slice(0, 100))
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }
  throw lastErr || new Error('OCR 失败')
}

async function ensureMupdf() {
  try {
    const mod = await import('mupdf')
    const m = mod.default ?? mod
    if (typeof m.ready === 'function') await m.ready
    return m
  } catch {
    console.error('dsocr2md: PDF 拆页需要 mupdf，请在本脚本目录执行 npm install mupdf')
    process.exit(2)
  }
}

function isImage(file) {
  return ['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) files.push(...(await walk(p)))
    else if (isImage(p)) files.push(p)
  }
  return files.sort()
}

const inputStat = await stat(inputPath)
const isDir = inputStat.isDirectory()
const isPdf = path.extname(inputPath).toLowerCase() === '.pdf'
const outRoot = path.resolve(outArg || (isDir ? path.join(inputPath, 'md') : path.dirname(inputPath)))
let ok = 0
let failed = 0
let skipped = 0

if (isPdf) {
  const mupdf = await ensureMupdf()
  const doc = mupdf.Document.openDocument(await readFile(inputPath), 'application/pdf')
  const total = doc.countPages()
  const m = /^(\d+)-(\d+)$/.exec(pagesArg || '')
  let pdfBuf
  let tag
  if (m) {
    const [s, e] = [Number(m[1]), Number(m[2])]
    if (s < 1 || e > total || s > e) { console.error('dsocr2md: 页码超出范围（总页数 ' + total + '）'); process.exit(2) }
    const outDoc = new mupdf.PDFDocument()
    for (let i = s - 1; i < e; i++) outDoc.graftPage(-1, doc, i)
    const saved = outDoc.saveToBuffer('compress')
    pdfBuf = Buffer.from(typeof saved.asUint8Array === 'function' ? saved.asUint8Array() : saved)
    tag = 'p' + String(s).padStart(3, '0') + '-' + String(e).padStart(3, '0')
  } else {
    if (total > MAX_PDF_PAGES) {
      console.error('dsocr2md: 该 PDF 共 ' + total + ' 页，超过直传上限 ' + MAX_PDF_PAGES + ' 页——请用 --pages=起-止 分批（单次 ≤' + MAX_PDF_PAGES + ' 页），或先渲染 PNG 再逐页转录')
      process.exit(2)
    }
    pdfBuf = await readFile(inputPath)
    if (pdfBuf.length > MAX_PDF_BYTES) { console.error('dsocr2md: PDF 超过 50MB 限制，请用 --pages 分批'); process.exit(2) }
    tag = 'full'
  }
  const outPath = path.join(outRoot, path.basename(inputPath).replace(/\.pdf$/i, '') + '_' + tag + '.md')
  try { await access(outPath); skipped++; console.log('skip ' + outPath) } catch {
    try {
      const md = await callOcr('data:application/pdf;base64,' + pdfBuf.toString('base64'))
      if (md.replace(/\s+/g, '').length < 4) throw new Error('转录过短')
      await mkdir(path.dirname(outPath), { recursive: true })
      await writeFile(outPath, md + '\n', 'utf8')
      ok++; console.log('ok   pdf ' + tag + ' (' + total + '页) -> ' + outPath + ' (' + md.length + ' chars)')
    } catch (error) { failed++; console.log('fail pdf ' + tag + ': ' + (error?.message || error)) }
  }
} else if (isDir) {
  const files = await walk(inputPath)
  let next = 0
  async function workerRun() {
    while (true) {
      const idx = next++
      if (idx >= files.length) return
      const file = files[idx]
      const rel = path.relative(inputPath, file)
      const outPath = path.join(outRoot, rel.replace(/\.[^.]+$/, '.md'))
      try { await access(outPath); skipped++; console.log('skip ' + rel); continue } catch {}
      try {
        const fileStat = await stat(file)
        if (fileStat.size > MAX_IMG_BYTES) { failed++; console.log('fail ' + rel + ': 图片超过 10MB 限制'); continue }
        const ext = path.extname(file).toLowerCase()
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
        const md = await callOcr(`data:${mime};base64,${(await readFile(file)).toString('base64')}`)
        if (md.replace(/\s+/g, '').length < 4) throw new Error('转录过短')
        await mkdir(path.dirname(outPath), { recursive: true })
        await writeFile(outPath, md + '\n', 'utf8')
        ok++; console.log('ok   ' + rel + ' [' + MODEL + '] -> ' + outPath + ' (' + md.length + ' chars)')
      } catch (error) { failed++; console.log('fail ' + rel + ': ' + (error?.message || error)) }
      if (workers === 1 && files.length > 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  const poolSize = Math.min(workers, files.length)
  await Promise.all(Array.from({ length: poolSize }, workerRun))
} else if (isImage(inputPath)) {
  const rel = path.basename(inputPath)
  const outPath = path.join(outRoot, rel.replace(/\.[^.]+$/, '.md'))
  try { await access(outPath); skipped++; console.log('skip ' + rel) } catch {
    try {
      if ((await stat(inputPath)).size > MAX_IMG_BYTES) { failed++; console.log('fail ' + rel + ': 图片超过 10MB 限制') } else {
      const ext = path.extname(inputPath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
      const md = await callOcr(`data:${mime};base64,${(await readFile(inputPath)).toString('base64')}`)
      await mkdir(path.dirname(outPath), { recursive: true })
      await writeFile(outPath, md + '\n', 'utf8')
      ok++; console.log('ok   ' + rel + ' [' + MODEL + '] -> ' + outPath + ' (' + md.length + ' chars)') }
    } catch (error) { failed++; console.log('fail ' + rel + ': ' + (error?.message || error)) }
  }
} else {
  console.error('dsocr2md: 不支持的输入：' + inputPath)
  process.exit(2)
}
console.log('dsocr2md [' + MODEL + ']: ok=' + ok + ' failed=' + failed + ' skipped=' + skipped)
if (failed > 0) process.exitCode = 1
