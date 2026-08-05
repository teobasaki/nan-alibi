#!/usr/bin/env node
/**
 * 인물 사진 생성 — Meshy text-to-image.
 *
 * 사진은 **역할**에 묶는다(`src/ui/portraits.ts` 참조). 이름은 매 판 무작위지만
 * 역할 8종은 고정이라, 역할에 묶어야 이름과 얼굴이 어긋나지 않는다.
 *
 * 규율:
 *   - **이미 있는 파일은 건너뛴다.** 재실행이 크레딧을 다시 태우면 안 된다.
 *   - 한 장씩 확인하고 넘어간다 (`--only <slug>`) — 8장을 한꺼번에 태우기 전에 룩을 검증한다.
 *   - 키는 `.dev.vars` 에서 읽고 **출력하지 않는다.**
 *
 * 사용법:
 *   node scripts/gen-portraits.mjs --only security   # 한 장만 (룩 검증)
 *   node scripts/gen-portraits.mjs                   # 없는 것 전부
 *   MODEL=nano-banana node scripts/gen-portraits.mjs # 싼 모델로
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'

const API = 'https://api.meshy.ai/openapi/v1/text-to-image'
const OUT = 'public/portraits'
const MODEL = process.env.MODEL ?? 'nano-banana-pro'

const key = (() => {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY
  const m = /^MESHY_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf-8'))
  if (!m) throw new Error('.dev.vars 에 MESHY_API_KEY 가 없다')
  return m[1].trim().replace(/^["']|["']$/g, '')
})()

/**
 * 공통 접미사가 룩을 통일한다.
 * 핵심은 **"찍힌 사진"** 이지 초상화가 아니라는 것 — 시선이 정면을 살짝 벗어나야
 * 취조실에서 찍은 신원 사진처럼 보인다. 정면 응시는 인물화가 되고 긴장이 죽는다.
 */
const LOOK = [
  'photorealistic, shot on 35mm film, harsh single overhead fluorescent light from above',
  'deep hard shadows under the eyes and jaw, desaturated cold color grade',
  'visible film grain, slight sensor noise, shallow depth of field',
  'neutral guarded expression, eyes looking slightly off-camera, not smiling',
  'plain dark interrogation-room background, no text, no watermark',
  'head and shoulders, vertical 3:4 framing',
].join(', ')

const ROLES = [
  ['security', 'A Korean hotel security team leader in a dark navy uniform with a name badge, late 40s, close-cropped hair, tired heavy-lidded eyes, faint stubble'],
  ['manager', 'A Korean luxury hotel general manager in a charcoal three-piece suit, early 50s, silver-streaked hair combed back, composed but hollow expression'],
  ['secretary', 'A Korean executive secretary in a plain dark blouse, early 30s, hair pulled back tightly, reddened eyes as if recently crying, holding composure'],
  ['appraiser', 'A Korean jewelry appraiser in a dark turtleneck with a loupe hanging on a cord, late 30s, thin wire-rim glasses, watchful narrow gaze'],
  ['investor', 'A Korean investor in an expensive but rumpled dark suit with loosened tie, late 50s, heavy build, unreadable flat stare'],
  ['expartner', 'A Korean former business partner in a worn dark overcoat, mid 40s, unshaven, deep frown lines, resentful weary look'],
  ['housekeeping', 'A Korean hotel housekeeping staff member in a dark uniform and apron, early 40s, hair under a cap, guarded anxious eyes, hands out of frame'],
  ['nephew', 'A Korean man in his late 20s in a cheap dark jacket over a t-shirt, nephew of a wealthy man, restless nervous eyes, faint sweat on the forehead'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, init) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function generate(slug, subject) {
  const prompt = `${subject}. ${LOOK}`
  const { result: id } = await api('', {
    method: 'POST',
    body: JSON.stringify({ ai_model: MODEL, prompt, aspect_ratio: '3:4' }),
  })

  process.stdout.write(`  ${slug} … `)
  for (let i = 0; i < 90; i++) {
    await sleep(3000)
    const job = await api(`/${id}`)
    if (job.status === 'SUCCEEDED') {
      const url = job.image_urls?.[0]
      if (!url) throw new Error('SUCCEEDED 인데 image_urls 가 비었다')
      const bin = Buffer.from(await (await fetch(url)).arrayBuffer())
      const file = `${OUT}/${slug}.png`
      writeFileSync(file, bin)
      console.log(`저장 ${file} (${(bin.length / 1024).toFixed(0)}KB)`)
      return
    }
    if (job.status === 'FAILED' || job.status === 'CANCELED') {
      throw new Error(`${job.status}: ${JSON.stringify(job.task_error ?? {}).slice(0, 200)}`)
    }
    process.stdout.write('.')
  }
  throw new Error('시간 초과')
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const have = new Set(
  (existsSync(OUT) ? readdirSync(OUT) : []).filter((f) => /\.(webp|png|jpg)$/i.test(f)).map((f) => f.replace(/\.\w+$/, '')),
)

const todo = ROLES.filter(([slug]) => (only ? slug === only : !have.has(slug)))
if (todo.length === 0) {
  console.log('생성할 것이 없다 (이미 다 있음). 다시 만들려면 파일을 지워라.')
  process.exit(0)
}

const { balance } = await (await fetch('https://api.meshy.ai/openapi/v1/balance', {
  headers: { Authorization: `Bearer ${key}` },
})).json()
const perImage = { 'nano-banana': 3, 'nano-banana-2': 6, 'nano-banana-pro': 9, 'gpt-image-2': 9 }[MODEL] ?? 9
console.log(`\n▶ ${MODEL} · ${todo.length}장 · 예상 ${todo.length * perImage}크레딧 (잔액 ${balance})\n`)

for (const [slug, subject] of todo) {
  try {
    await generate(slug, subject)
  } catch (e) {
    console.error(`  ✗ ${slug} 실패: ${e.message}`)
  }
}
console.log('\n완료. `npm run build` 하면 자동으로 붙는다.')
