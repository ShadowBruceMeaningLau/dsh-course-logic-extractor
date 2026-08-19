#!/usr/bin/env node
// mermaid2canvas.mjs — 把 md 报告中的 mermaid 流程图转换为 Obsidian .canvas。
// Usage: node mermaid2canvas.mjs <md文件> <输出.canvas> [--index=N]
// - 提取第 N 个（默认 0，即第一个）```mermaid 块，解析节点/边（支持三种格式）：
//   1) 定义+边单行：A["文本"] --> B["文本"]
//   2) 边带目标文本：B --> C["文本"]（B 的文本已在别处定义）
//   3) 纯边行：A --> B / A -->|"标签"| B / A -.标签.-> B
// - 报告含多个 mermaid 块时用 --index=N 逐个转换；
// - 布局：按依赖分层（入度为 0 为第 0 层），x=层*380，y=层内序号*160；
// - 输出 Obsidian canvas JSON（nodes/edges，边带 label）。
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
let index = 0
const positional = []
for (const a of args) {
  if (a.startsWith('--index=')) index = Number(a.slice(8)) || 0
  else positional.push(a)
}
const [inFile, outFile] = positional
if (!inFile || !outFile) {
  console.error('usage: node mermaid2canvas.mjs <md文件> <输出.canvas> [--index=N]')
  process.exit(2)
}

const BT = String.fromCharCode(96)
const fence = BT.repeat(3)

function extractMermaids(text) {
  const out = []
  let pos = 0
  while (true) {
    const s = text.indexOf(fence + 'mermaid', pos)
    if (s < 0) break
    const e = text.indexOf(fence, s + fence.length)
    if (e < 0) { out.push(text.slice(s + fence.length + 7)); break }
    out.push(text.slice(s + fence.length + 7, e))
    pos = e + fence.length
  }
  return out
}

function convert(mmd) {
  const lines = mmd.split('\n').filter((l) => l.trim() && !/^flowchart|^graph/.test(l.trim()))
  const nodes = []
  const edges = []
  const idSet = new Set()
  const addNode = (id, text) => {
    if (!id) return
    if (!idSet.has(id)) { idSet.add(id); nodes.push({ id, text: (text || id).replace(/<br\s*\/?>/gi, '\n') }) }
  }
  for (const raw of lines) {
    let l = raw.trim()
    let from = ''
    let m = l.match(/^([A-Za-z0-9_]+)\s*\[\s*"([^"]*)"\s*\]\s*(.*)$/)
    if (m) { addNode(m[1], m[2]); from = m[1]; l = m[3].trim(); if (!l) continue }
    // 边：A --> B / A -->|"l"| B / A -.l.-> B / B --> C["文本"]（from 可选）
    // m[1]=from(可选) m[2]=实线标签 m[3]=虚线标签 m[4]=to m[5]=目标文本
    m = l.match(/^([A-Za-z0-9_]+)?\s*(?:-->\|\s*"([^"]*)"\s*\||-\.([^.]*)\.->|-->|-\.->)\s*([A-Za-z0-9_]+)(?:\s*\[\s*"([^"]*)"\s*\])?\s*$/)
    if (m) {
      const src = from || m[1]
      if (src) edges.push({ from: src, to: m[4], label: m[2] ?? m[3] ?? '' })
      if (m[5]) addNode(m[4], m[5])
      continue
    }
    console.error('mermaid2canvas: 未解析行 [' + l.slice(0, 60) + ']')
  }
  for (const e of edges) { addNode(e.from); addNode(e.to) }
  const layer = {}
  for (const n of nodes) layer[n.id] = 0
  for (let i = 0; i < nodes.length; i++) for (const e of edges) layer[e.to] = Math.max(layer[e.to], layer[e.from] + 1)
  const order = {}
  nodes.forEach((n, i) => { order[n.id] = i })
  const byLayer = {}
  for (const n of nodes) { (byLayer[layer[n.id]] = byLayer[layer[n.id]] || []).push(n.id) }
  for (const k of Object.keys(byLayer)) byLayer[k].sort((a, b) => order[a] - order[b])
  const canvasNodes = []
  for (const n of nodes) {
    const l = layer[n.id]
    const k = byLayer[l].indexOf(n.id)
    canvasNodes.push({ id: n.id, type: 'text', text: n.text, x: l * 380, y: k * 160, width: 300, height: 100 })
  }
  const canvasEdges = edges.map((e, i) => {
    const o = { id: 'e' + (i + 1), fromNode: e.from, toNode: e.to, fromSide: 'right', toSide: 'left' }
    if (e.label) o.label = e.label
    return o
  })
  return JSON.stringify({ nodes: canvasNodes, edges: canvasEdges }, null, 2)
}

const text = await readFile(inFile, 'utf8')
const mermaids = extractMermaids(text)
const mmd = mermaids[index]
if (!mmd) { console.error('mermaid2canvas: 未找到第 ' + (index + 1) + ' 个 mermaid 块（共 ' + mermaids.length + ' 个）：' + inFile); process.exit(2) }
const canvas = convert(mmd)
await writeFile(outFile, canvas + '\n', 'utf8')
const j = JSON.parse(canvas)
console.log('mermaid2canvas: nodes=' + j.nodes.length + ' edges=' + j.edges.length + ' -> ' + path.basename(outFile))
