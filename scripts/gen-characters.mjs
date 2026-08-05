#!/usr/bin/env node
/**
 * 캐릭터 3D 생성 — Meshy text-to-3d → auto-rigging.
 *
 * 사진(`gen-portraits.mjs`)과 같은 원칙: **역할 8종에 묶는다.** 이름은 매 판 무작위지만
 * 역할은 고정이므로, 역할에 묶어야 이름과 외형이 어긋나지 않는다.
 *
 * 규율:
 *   - **이미 있는 파일은 건너뛴다.** 재실행이 크레딧을 다시 태우면 안 된다.
 *   - `--only <slug>` 로 한 명만 돌려 파이프라인과 품질을 먼저 검증한다.
 *   - 단계별 실제 소모 크레딧을 잔액 차이로 **측정해서 찍는다** — 문서값을 믿지 않는다.
 *   - 키는 `.dev.vars` 에서 읽고 출력하지 않는다.
 *
 * 사용법:
 *   node scripts/gen-characters.mjs --only security   # 1명 (파이프라인 검증)
 *   node scripts/gen-characters.mjs                   # 없는 것 전부
 *   node scripts/gen-characters.mjs --no-rig          # 리깅 없이 메시만
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'

const BASE = 'https://api.meshy.ai/openapi'
const OUT = 'public/characters'
const key = (() => {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY
  const m = /^MESHY_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf-8'))
  if (!m) throw new Error('.dev.vars 에 MESHY_API_KEY 가 없다')
  return m[1].trim().replace(/^["']|["']$/g, '')
})()

/**
 * 리깅은 **정면이 +Z**, 사람 형태, 텍스처 있음, 30만 면 이하를 요구한다(문서).
 * 그래서 프롬프트에 서 있는 전신·A포즈를 명시한다 — 앉은 자세나 소품을 들면 리깅이 실패한다.
 */
const LOOK = [
  'full body standing character, A-pose, arms slightly away from the torso',
  'facing forward, symmetrical, clean separated limbs',
  'photorealistic textures, muted desaturated colors, dark clothing',
  'game-ready character model',
].join(', ')

const ROLES = [
  ['security', 'A Korean hotel security team leader, late 40s, dark navy security uniform with badge, close-cropped hair, heavy build'],
  ['manager', 'A Korean luxury hotel general manager, early 50s, charcoal three-piece suit, silver-streaked hair combed back, slim'],
  ['secretary', 'A Korean executive secretary, early 30s, plain dark blouse and skirt, hair pulled back tightly'],
  ['appraiser', 'A Korean jewelry appraiser, late 30s, dark turtleneck and slacks, thin wire-rim glasses, slight build'],
  ['investor', 'A Korean investor, late 50s, expensive dark suit with loosened tie, heavy build'],
  ['expartner', 'A Korean former business partner, mid 40s, worn dark overcoat over a shirt, unshaven, average build'],
  ['housekeeping', 'A Korean hotel housekeeping staff member, early 40s, dark uniform with apron and cap'],
  ['nephew', 'A Korean man in his late 20s, cheap dark jacket over a t-shirt and jeans, thin'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function req(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const balance = async () => (await req('/v1/balance')).balance

async function poll(path, label, maxTicks = 200) {
  for (let i = 0; i < maxTicks; i++) {
    await sleep(4000)
    const job = await req(path)
    if (job.status === 'SUCCEEDED') return job
    if (job.status === 'FAILED' || job.status === 'CANCELED') {
      throw new Error(`${label} ${job.status}: ${JSON.stringify(job.task_error ?? {}).slice(0, 200)}`)
    }
    process.stdout.write('.')
  }
  throw new Error(`${label} 시간 초과`)
}

async function download(url, file) {
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer())
  writeFileSync(file, bin)
  return bin.length
}

async function build(slug, subject, rig) {
  const spent0 = await balance()
  process.stdout.write(`  ${slug} · 메시 `)

  // ① preview — 형태만. 여기서 실패하면 refine 에 크레딧을 태우지 않는다.
  const { result: previewId } = await req('/v2/text-to-3d', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'preview',
      prompt: `${subject}. ${LOOK}`,
      ai_model: 'meshy-6',
      should_remesh: true,
      topology: 'quad',
      target_polycount: 30000,
    }),
  })
  await poll(`/v2/text-to-3d/${previewId}`, 'preview')

  // ② refine — 텍스처. 리깅이 "텍스처 없는 메시는 지원 안 함" 이라 필수 단계다.
  process.stdout.write(' 텍스처 ')
  const { result: refineId } = await req('/v2/text-to-3d', {
    method: 'POST',
    body: JSON.stringify({ mode: 'refine', preview_task_id: previewId, enable_pbr: true }),
  })
  const refined = await poll(`/v2/text-to-3d/${refineId}`, 'refine')

  mkdirSync(OUT, { recursive: true })
  let file = `${OUT}/${slug}.glb`
  let size = await download(refined.model_urls.glb, file)
  const afterMesh = await balance()

  // ③ 리깅 — 스켈레톤. 애니메이션(걷기·달리기)은 이 게임에 안 쓰지만 뼈대가 필요하다.
  let afterRig = afterMesh
  if (rig) {
    process.stdout.write(' 리깅 ')
    const { result: rigId } = await req('/v1/rigging', {
      method: 'POST',
      body: JSON.stringify({ input_task_id: refineId, height_meters: 1.7 }),
    })
    const rigged = await poll(`/v1/rigging/${rigId}`, 'rigging')
    // 실제 응답 구조 (문서엔 없다 — 태스크를 직접 까서 확인했다):
    //   result.rigged_character_glb_url  ← 스켈레톤 있는 캐릭터. 우리가 쓸 것
    //   result.basic_animations.{walking,running}_{glb,fbx,armature_glb}_url
    //   걷기·달리기는 심문 장면에 쓸 데가 없어 받지 않는다 (용량만 는다).
    const url = rigged.result?.rigged_character_glb_url
    if (url) {
      file = `${OUT}/${slug}.rigged.glb`
      size = await download(url, file)
    } else {
      console.log(`\n     ⚠️ 리깅 결과에 glb 가 없다: ${JSON.stringify(rigged).slice(0, 200)}`)
    }
    afterRig = await balance()
  }

  console.log(
    `\n     ✓ ${file} (${(size / 1024 / 1024).toFixed(1)}MB) · ` +
    `메시 ${spent0 - afterMesh} + 리깅 ${afterMesh - afterRig} = ${spent0 - afterRig}크레딧`,
  )
  return spent0 - afterRig
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const rig = !process.argv.includes('--no-rig')
const have = new Set(
  (existsSync(OUT) ? readdirSync(OUT) : []).filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.(rigged\.)?glb$/, '')),
)
const todo = ROLES.filter(([slug]) => (only ? slug === only : !have.has(slug)))

if (todo.length === 0) {
  console.log('생성할 것이 없다 (이미 다 있음).')
  process.exit(0)
}

console.log(`\n▶ 캐릭터 ${todo.length}명${rig ? ' (리깅 포함)' : ' (메시만)'} · 잔액 ${await balance()}\n`)
let total = 0
for (const [slug, subject] of todo) {
  try {
    total += await build(slug, subject, rig)
  } catch (e) {
    console.error(`  ✗ ${slug} 실패: ${e.message}`)
  }
}
console.log(`\n합계 ${total}크레딧 소모 · 잔액 ${await balance()}`)
