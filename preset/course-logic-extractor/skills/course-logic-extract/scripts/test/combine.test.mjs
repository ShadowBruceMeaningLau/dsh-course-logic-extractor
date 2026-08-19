// combine.mjs 集成测试：临时目录 → 合并/排序/公式转换断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const combine = path.join(here, '..', 'combine.mjs')
function run(args) {
  return execFileSync(process.execPath, [combine, ...args], { encoding: 'utf8' })
}

test('目录合并：按文件名排序 + 空行拼接 + 公式转换', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'combine-test-'))
  writeFileSync(path.join(dir, 'page0002.md'), 'B 段 \\(x\\) 结束\n', 'utf8')
  writeFileSync(path.join(dir, 'page0001.md'), 'A 段 \\[y\\] 结束\n', 'utf8')
  const out = path.join(dir, 'out.md')
  const log = run([dir, out])
  assert.match(log, /2 files merged/)
  const text = readFileSync(out, 'utf8')
  assert.ok(text.startsWith('A 段 $$y$$ 结束'), '公式 \\[ \\] 应转为 $$ $$')
  assert.ok(text.includes('B 段 $x$ 结束'), '公式 \\( \\) 应转为 $ $')
  assert.ok(text.indexOf('A 段') < text.indexOf('B 段'), '应按文件名排序')
  rmSync(dir, { recursive: true, force: true })
})

test('单文件模式：公式转换后写出', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'combine-test-'))
  const src = path.join(dir, 'in.md')
  const out = path.join(dir, 'out.md')
  writeFileSync(src, '行内 \\(a+b\\) 与行间 \\[c+d\\]\n', 'utf8')
  run([src, out])
  const text = readFileSync(out, 'utf8')
  assert.ok(text.includes('$a+b$') && text.includes('$$c+d$$'))
  rmSync(dir, { recursive: true, force: true })
})
