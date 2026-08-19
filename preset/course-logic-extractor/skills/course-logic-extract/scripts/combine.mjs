#!/usr/bin/env node
// combine.mjs — 合并逐页 OCR 的 md 为直出稿。
// Usage: node combine.mjs <mdDir|file.md> <outFile> [--raw]
// - 目录模式：按文件名排序合并，仅做空行拼接（页码与封面/CIP 页一律原样保留）；
// - 文件模式：对单个 md 做公式语法转换后写出；
// - 公式统一转换为 Obsidian 语法 $...$ / $$...$$；
// - --raw 为兼容旧调用保留（本版仅有直出模式）。
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('--'))
const [inArg, outArg] = positional
if (!inArg || !outArg) {
  console.error('usage: node combine.mjs <mdDir|file.md> <outFile> [--raw]')
  process.exit(2)
}

function convertFormulas(s) {
  // 注意：String.replace 的替换串里 '$$' 是特殊模式（表示单个 $），必须用函数返回字面 '$$'
  s = s.replace(/\\\[/g, () => '$$').replace(/\\\]/g, () => '$$')
  s = s.replace(/\\\(/g, () => '$').replace(/\\\)/g, () => '$')
  return s
}

const inStat = await stat(inArg)
let text
if (inStat.isDirectory()) {
  const files = (await readdir(inArg)).filter((f) => f.endsWith('.md')).sort()
  const parts = []
  for (const f of files) {
    const s = convertFormulas(await readFile(path.join(inArg, f), 'utf8')).trim()
    if (s) { parts.push(s); console.log('keep ' + f) }
  }
  text = parts.join('\n\n')
  console.log('combine: ' + parts.length + ' files merged')
} else {
  text = convertFormulas(await readFile(inArg, 'utf8'))
  console.log('converted: ' + inArg)
}
await writeFile(outArg, text + '\n', 'utf8')
console.log('written ' + outArg + ' (' + text.length + ' chars)')
