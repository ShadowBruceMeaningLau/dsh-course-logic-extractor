// verify.mjs 集成测试：构造 page 文件验证统计逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const verify = path.join(here, '..', 'verify.mjs')
function run(args) {
  return execFileSync(process.execPath, [verify, ...args], { encoding: 'utf8' })
}

test('页数对账：缺失页/空页/超短页/公式配对统计', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-test-'))
  writeFileSync(path.join(dir, 'page0001.md'), '', 'utf8') // 空页
  writeFileSync(path.join(dir, 'page0002.md'), '短内容', 'utf8') // 超短页
  writeFileSync(path.join(dir, 'page0003.md'), '正常内容测试页'.repeat(20), 'utf8') // 140 字符，非超短页
  const out = run([dir, '--total=4'])
  assert.match(out, /files=3 missing=1 empty=1 short=1/)
  assert.match(out, /missing: 4/)
  assert.match(out, /empty: page0001\.md/)
  assert.match(out, /short: page0002\.md/)
  rmSync(dir, { recursive: true, force: true })
})

test('质量报告写出：--out 生成 md 文件', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-test-'))
  writeFileSync(path.join(dir, 'page0001.md'), '内容足够长避免触发超短页阈值', 'utf8')
  const out = path.join(dir, '质量报告.md')
  run([dir, '--total=1', '--out=' + out])
  const text = readFileSync(out, 'utf8')
  assert.match(text, /# OCR 转录质量报告/)
  assert.match(text, /## 缺失页\n无/)
  rmSync(dir, { recursive: true, force: true })
})
