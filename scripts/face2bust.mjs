#!/usr/bin/env node
/**
 * 얼굴 클로즈업 4면 → **흉상 3D**.
 *
 * ## 왜 흉상인가
 * Meshy 멀티이미지는 **최대 4장**만 받는다(실측: 5장 이상은 HTTP 400).
 * 그래서 전신과 얼굴 중 골라야 한다.
 *
 * | 조합 | 얼굴 픽셀 | 리깅 |
 * |---|---|---|
 * | 전신 4면 시트를 쪼갠 것 | 84px | 가능 |
 * | **머리·어깨 클로즈업 4면** | **580px** | 불가 (다리가 없어 자세 추정 실패) |
 *
 * 이 게임의 카메라는 **가슴 위를 잡고 테이블이 아래를 가린다** — 다리는 애초에 안 보인다.
 * 그래서 리깅(앉은 자세·팔 제스처)을 포기하고 얼굴 7배를 택한다.
 * 호흡·미세한 움직임은 모델 전체를 흔들어 대신한다.
 *
 * 리깅을 아예 시도하지 않으므로 **PBR 맵이 떨어질 일도 없다** —
 * Meshy 리깅이 노멀맵을 버리는 문제(restore-pbr.mjs 가 필요했던 이유)가 여기선 없다.
 *
 * 사용법: node scripts/face2bust.mjs <slug>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASE = 'https://api.meshy.ai/openapi'
const key = /^MESHY_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf-8'))[1].trim().replace(/^["']|["']$/g, '')
const slug = process.argv[2]
if (!slug) { console.error('사용법: node scripts/face2bust.mjs <slug>'); process.exit(1) }

const VIEWS = ['front', 'left', 'right', 'back']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const req = async (p, init) => {
  const r = await fetch(BASE + p, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}
const bal = async () => (await req('/v1/balance')).balance

const files = VIEWS.map((v) => `public/refs/${slug}-face-${v}.png`).filter(existsSync)
if (files.length < 2) {
  console.error(`얼굴 시점이 ${files.length}장뿐이다. public/refs/${slug}-face-{front,left,right,back}.png 가 필요하다.`)
  process.exit(1)
}
// 4장 상한 — 넘기면 400 이다
const use = files.slice(0, 4)
const urls = use.map((f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`)

const start = await bal()
console.log(`\n▶ ${slug} · 얼굴 ${use.length}장 → 흉상 · 잔액 ${start}\n`)

const { result: id } = await req('/v1/multi-image-to-3d', {
  method: 'POST',
  body: JSON.stringify({
    image_urls: urls,
    ai_model: 'meshy-6',
    should_texture: true,
    enable_pbr: true,
    should_remesh: true,
    topology: 'quad',
    target_polycount: 150000,
  }),
})

process.stdout.write('  생성 ')
let job
for (let i = 0; i < 300; i++) {
  await sleep(4000)
  job = await req(`/v1/multi-image-to-3d/${id}`)
  if (job.status === 'SUCCEEDED') break
  if (job.status === 'FAILED' || job.status === 'CANCELED') throw new Error(JSON.stringify(job.task_error ?? {}))
  process.stdout.write('.')
}

const out = `assets-src/${slug}.bust.glb`
writeFileSync(out, Buffer.from(await (await fetch(job.model_urls.glb)).arrayBuffer()))
const maps = Object.keys(job.texture_urls?.[0] ?? {})
const end = await bal()
console.log(`\n  받은 맵: ${maps.join(', ') || '(없음)'}`)
console.log(`  저장: ${out} · ${start - end}크레딧 · 잔액 ${end}\n`)
