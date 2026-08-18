#!/usr/bin/env node
// dsocr2md.mjs — 文档/图片 → Markdown OCR。
// 默认模型：deepseek-ai/DeepSeek-OCR（硅基流动免费托管，官方提示词）；
// --model= 可指定硅基流动上其他兼容模型。
// Usage: node dsocr2md.mjs <imagesDir|file.pdf> [outDir] [--model=deepseek-ai/DeepSeek-OCR] [--pages=1-20] [--workers=4] [--delay=2000]
// - 图片：data URI 直传；PDF：≤100 页整本直传，>100 页用 mupdf 拆页（--pages=起-止）；
// - 空响应/5xx/402/429 自动重试 3 次；已存在的 .md 自动跳过（断点续跑）；
// - --workers=N：并发池（默认 1，建议 4-6）。
import { readFile, writeFile, readdir, mkdir, access, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
let delayMs = 2000
let workers = 1
let pagesArg = ''
let modelArg = ''
for (const a of args) {
  if (a.startsWith('--delay=')) delayMs = Math.max(0, Number(a.slice(8)) || 0)
  else if (a.startsWith('--workers=')) workers = Math.max(1, Math.min(12, Number(a.slice(10)) || 1))
  else if (a.startsWith('--pages=')) pagesArg = a.slice(8)
  else if (a.startsWith('--model=')) modelArg = a.slice(8)
}
const positional = args.filter((a) => !a.startsWith('--'))
const [inputArg, outArg] = positional
if (!inputArg) {
  console.error('usage: node dsocr2md.mjs <imagesDir|file.pdf> [outDir] [--model=deepseek-ai/DeepSeek-OCR] [--pages=1-20] [--workers=4]')
  process.exit(2)
}
const inputPath = path.resolve(inputArg)
const MODEL = modelArg || 'deepseek-ai/DeepSeek-OCR'

function loadSiliconflowKey() {
  let key = process.env.SILICONFLOW_API_KEY || ''
  if (!key) {
    try {
      const raw = readFileSync(path.join(os.homedir(), '.dsh', 'free-vision.json'), 'utf8')
      key = JSON.parse(raw)?.apiKey || ''
    } catch {}
  }
  if (!key) {
    console.error('dsocr2md: 未找到 SiliconFlow API key（SILICONFLOW_API_KEY 或 ~/.dsh/free-vision.json）')
    process.exit(2)
  }
  return key
}

const SF_KEY = loadSiliconflowKey()
const SF_PROMPT_OCR = '<image>\n<|grounding|>Convert the document to markdown.'
const SF_PROMPT_VLM = '请把上述图片转换为markdown代码：文本一字不差，用markdown语法尽量还原原图排版（标题层级、列表、表格；数学公式用 $...$ 或 $$...$$）。只输出markdown正文，不要任何解释。'

function clean(content) {
  let s = content
  while (true) {
    const a = s.indexOf('<|ref|>')
    if (a < 0) break
    const rEnd = s.indexOf('<|/ref|>', a)
    if (rEnd < 0) break
    const d = s.indexOf('<|det|>', rEnd)
    const dEnd = s.indexOf('<|/det|>', d < 0 ? rEnd : d)
    if (dEnd < 0) { s = s.slice(0, a) + s.slice(rEnd + 9); continue }
    s = s.slice(0, a) + s.slice(dEnd + 9)
  }
  s = s.split('<|ref|>').join('').split('<|/ref|>').join('')
  while (s.includes('<|det|>')) {
    const a = s.indexOf('<|det|>')
    const b = s.indexOf('<|/det|>', a)
    if (b < 0) break
    s = s.slice(0, a) + s.slice(b + 9)
  }
  s = s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

// 硅基流动：chat/completions（DeepSeek-OCR 用官方提示词；其他模型用中文转写提示词）
async function sfChat(dataUrl) {
  const prompt = MODEL.toLowerCase().includes('deepseek-ocr') ? SF_PROMPT_OCR : SF_PROMPT_VLM
  const res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SF_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: prompt },
      ]}],
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(600000),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = 'HTTP ' + res.status
    try { msg += ': ' + (JSON.parse(text)?.message || text.slice(0, 200)) } catch { msg += ': ' + text.slice(0, 200) }
    throw new Error(msg)
  }
  const j = JSON.parse(text)
  const c = j?.choices?.[0]?.message?.content
  if (c == null || String(c).trim() === '') throw new Error('空响应（余额不足或模型暂不可用）')
  return clean(String(c))
}

async function callOcr(dataUrl) {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await sfChat(dataUrl)
    } catch (error) {
      lastErr = error
      if (attempt < 3) {
        console.log('  retry ' + attempt + '/3: ' + (error && error.message ? String(error.message).slice(0, 100) : String(error)))
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
    pdfBuf = await readFile(inputPath)
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
    } catch (error) { failed++; console.log('fail pdf ' + tag + ': ' + (error && error.message ? error.message : String(error))) }
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
        const ext = path.extname(file).toLowerCase()
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
        const md = await callOcr(`data:${mime};base64,${(await readFile(file)).toString('base64')}`)
        if (md.replace(/\s+/g, '').length < 4) throw new Error('转录过短')
        await mkdir(path.dirname(outPath), { recursive: true })
        await writeFile(outPath, md + '\n', 'utf8')
        ok++; console.log('ok   ' + rel + ' [' + MODEL + '] -> ' + outPath + ' (' + md.length + ' chars)')
      } catch (error) { failed++; console.log('fail ' + rel + ': ' + (error && error.message ? error.message : String(error))) }
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
      const ext = path.extname(inputPath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
      const md = await callOcr(`data:${mime};base64,${(await readFile(inputPath)).toString('base64')}`)
      await mkdir(path.dirname(outPath), { recursive: true })
      await writeFile(outPath, md + '\n', 'utf8')
      ok++; console.log('ok   ' + rel + ' [' + MODEL + '] -> ' + outPath + ' (' + md.length + ' chars)')
    } catch (error) { failed++; console.log('fail ' + rel + ': ' + (error && error.message ? error.message : String(error))) }
  }
} else {
  console.error('dsocr2md: 不支持的输入：' + inputPath)
  process.exit(2)
}
console.log('dsocr2md [' + MODEL + ']: ok=' + ok + ' failed=' + failed + ' skipped=' + skipped)
if (failed > 0) process.exitCode = 1
