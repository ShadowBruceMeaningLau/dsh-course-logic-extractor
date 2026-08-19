// mermaid2canvas.mjs 集成测试：三种 mermaid 行格式的解析与布局。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'mermaid2canvas.mjs')
function run(args) {
  return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

function sampleMd() {
  const BT = String.fromCharCode(96)
  const fence = BT.repeat(3)
  return [
    '# 测试报告',
    '',
    fence + 'mermaid',
    'flowchart LR',
    '    A["语言奠基<br/>阶段一"] --> B["一元兑现<br/>阶段二"]',
    '    B --> C["多元与抽象兑现<br/>阶段三"]',
    '    B -.简单函数 预告.-> C',
    '    C --> D["语言收割<br/>阶段四"]',
    fence,
  ].join('\n')
}

test('三种格式解析：节点文本、边标签、虚线边、分层布局', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm2c-test-'))
  const src = path.join(dir, 'report.md')
  const out = path.join(dir, 'map.canvas')
  writeFileSync(src, sampleMd(), 'utf8')
  const log = run([src, out])
  assert.match(log, /nodes=4 edges=4/)
  const canvas = JSON.parse(readFileSync(out, 'utf8'))
  const texts = {}
  for (const n of canvas.nodes) texts[n.id] = n.text
  assert.ok(texts.A.includes('语言奠基') && texts.B.includes('一元兑现'), 'A/B 文本来自单行定义')
  assert.ok(texts.C.includes('多元与抽象兑现') && texts.D.includes('语言收割'), 'C/D 文本来自 B --> C["文本"] 格式')
  const dashed = canvas.edges.find((e) => e.label && e.label.includes('简单函数'))
  assert.ok(dashed && dashed.fromNode === 'B' && dashed.toNode === 'C', '虚线标签边解析')
  // 分层：A 在 x=0，B/C 在 x=380，D 在 x=760
  const pos = {}
  for (const n of canvas.nodes) pos[n.id] = n.x
  assert.equal(pos.A, 0)
  assert.equal(pos.B, 380)
  assert.equal(pos.D, 1140)
  rmSync(dir, { recursive: true, force: true })
})

test('无 mermaid 块时报错', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm2c-test-'))
  const src = path.join(dir, 'plain.md')
  writeFileSync(src, '# 无图报告\n', 'utf8')
  assert.throws(() => run([src, path.join(dir, 'x.canvas')]), /未找到 mermaid/)
  rmSync(dir, { recursive: true, force: true })
})
