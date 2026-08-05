#!/usr/bin/env node
/**
 * 앉은 자세 배치 적용 — 리깅된 GLB 전부를 블렌더 헤드리스로 돌린다.
 * 이미 `.seated.glb` 가 있으면 건너뛴다 (한 명당 수 초지만 8명이면 쌓인다).
 */
import { readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DIR = 'public/characters'
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'
if (!existsSync(BLENDER)) { console.error(`블렌더를 못 찾았다: ${BLENDER}\nBLENDER=<경로> 로 지정하라.`); process.exit(1) }
if (!existsSync(DIR)) { console.log('캐릭터 폴더가 없다.'); process.exit(0) }

const srcs = readdirSync(DIR).filter((f) => f.endsWith('.rigged.glb'))
if (!srcs.length) { console.log('.rigged.glb 가 없다.'); process.exit(0) }

for (const f of srcs) {
  const slug = f.replace(/\.rigged\.glb$/, '')
  const dst = `${DIR}/${slug}.seated.glb`
  if (existsSync(dst)) { console.log(`  ${slug}: 이미 있음 — 건너뜀`); continue }
  try {
    execFileSync(BLENDER, ['--background', '--python', 'scripts/pose-seated.py', '--', `${DIR}/${f}`, dst], { stdio: 'pipe' })
    console.log(`  ${slug}: ${(statSync(dst).size / 1048576).toFixed(1)}MB`)
  } catch (e) {
    console.error(`  ✗ ${slug} 실패: ${String(e.stdout ?? e.stderr ?? e).slice(-300)}`)
  }
}
