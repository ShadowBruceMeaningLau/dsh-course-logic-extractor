// stylevol 集成测试：merge 排序 + check 目录区 TOC 感知。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const stylevol = path.join(here, '..', 'stylevol')
function run(script, args) {
  return execFileSync(process.execPath, [path.join(stylevol, script), ...args], { encoding: 'utf8' })
}

test('merge：按 序号-章节-卷号 排序合并', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'merge-test-'))
  writeFileSync(path.join(dir, '01-第一章-2.md'), 'B\n', 'utf8')
  writeFileSync(path.join(dir, '01-第一章-1.md'), 'A\n', 'utf8')
  writeFileSync(path.join(dir, '02-第二章-1.md'), 'C\n', 'utf8')
  const out = path.join(dir, 'merged.md')
  const log = run('merge.mjs', [dir, out])
  assert.match(log, /merged 3 files/)
  const text = readFileSync(out, 'utf8')
  assert.ok(text.indexOf('A') < text.indexOf('B') && text.indexOf('B') < text.indexOf('C'), '应按 序号-章-卷 排序')
  rmSync(dir, { recursive: true, force: true })
})

test('check：目录区页码差异不误报（TOC 感知规范化）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-test-'))
  // 直出稿：目录区带页码 + 正文
  const src = path.join(dir, 'src.md')
  writeFileSync(src, [
    '# 前言',
    '',
    '## 目录',
    '## 第一章 绪论 (1)',
    '引言 (1)',
    '1. 背景 (2)',
    '# 第一章 绪论',
    '正文第一段内容',
    '## 1.1 背景',
    '详细内容在这里',
  ].join('\n'), 'utf8')
  // 成品：内容与直出稿一致，仅目录区无页码（优化稿铁律）
  writeFileSync(path.join(dir, '01-第一章-1.md'), [
    '# 前言',
    '',
    '## 目录',
    '## 第一章 绪论',
    '引言',
    '1. 背景',
    '# 第一章 绪论',
    '正文第一段内容',
    '',
    '## 1.1 背景',
    '',
    '详细内容在这里',
  ].join('\n'), 'utf8')
  const merged = path.join(dir, 'merged.md')
  run('merge.mjs', [dir, merged])
  const log = run('check.mjs', [src, dir, merged])
  assert.match(log, /RESULT: 成品与直出稿内容一致/, '目录区页码差异应被忽略')
  rmSync(dir, { recursive: true, force: true })
})
