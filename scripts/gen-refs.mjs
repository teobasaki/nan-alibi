#!/usr/bin/env node
/**
 * 3D 소스용 레퍼런스 이미지 — **OpenAI 로 뽑는다.**
 *
 * 역할 분담:
 *   OpenAI  → 초실사 2D (얼굴 품질이 여기서 결정된다)
 *   Meshy   → 3D 변환 · 오토리깅 (얼굴을 만들지 않고 옮기기만 한다)
 *   Blender → 앉은 자세
 *
 * 왜 이 순서인가: Meshy text-to-3d 는 게임 에셋 등급의 얼굴을 준다.
 * 반면 image-to-3d 는 **넣어 준 사진의 얼굴을 보존한다.** 그러므로 품질의 병목은
 * 3D 단계가 아니라 **2D 사진**이고, 거기에 제일 좋은 이미지 모델을 써야 한다.
 *
 * 그리고 사진은 반드시 **전신 T포즈**여야 한다. 흉상으로 뽑으면 3D 도 흉상이 되고
 * 오토리깅이 "Pose estimation failed" 로 거부한다 (실제로 한 번 겪었다).
 *
 * 사용법:
 *   node scripts/gen-refs.mjs --only security
 *   node scripts/gen-refs.mjs                  # 없는 것 전부
 *   MODEL=gpt-image-1 node scripts/gen-refs.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'

const OUT = 'public/refs'
const MODEL = process.env.MODEL ?? 'gpt-image-2'
const SIZE = process.env.SIZE ?? '1024x1536'   // 세로 — 전신이 들어가야 한다
const QUALITY = process.env.QUALITY ?? 'high'

const key = (() => {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const m = /^OPENAI_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf-8'))
  if (!m) throw new Error('.dev.vars 에 OPENAI_API_KEY 가 없다')
  return m[1].trim().replace(/^["']|["']$/g, '')
})()

/**
 * 공통 규격. **T포즈·전신·정면**이 리깅의 요구조건이고,
 * 그 위에 초실사와 취조실 분위기를 얹는다.
 * 배경은 반드시 단색 — 배경이 복잡하면 image-to-3d 가 그것까지 메시로 만든다.
 */
const SPEC = [
  'full body from head to feet, standing straight, arms extended horizontally to the sides in a T-pose',
  'facing the camera directly, symmetrical, feet together, palms down',
  'photorealistic photograph, shot on 85mm lens, even neutral studio lighting, no harsh shadows',
  'plain flat neutral gray background, no props, no text, no watermark',
  'sharp focus on the face, realistic skin texture with pores and imperfections',
  'neutral guarded expression, mouth closed, looking straight ahead',
].join(', ')

const ROLES = [
  ['security', 'A Korean man in his late 40s, hotel security team leader, dark navy security uniform with badge and name tag, black boots, close-cropped hair, heavy build, tired eyes'],
  ['manager', 'A Korean man in his early 50s, luxury hotel general manager, charcoal three-piece suit with tie, polished dress shoes, silver-streaked hair combed back, slim build'],
  ['secretary', 'A Korean woman in her early 30s, executive secretary, plain dark blouse and knee-length skirt, low heels, hair pulled back tightly, composed expression'],
  ['appraiser', 'A Korean man in his late 30s, jewelry appraiser, dark turtleneck and slacks, thin wire-rim glasses, slight build, watchful narrow eyes'],
  ['investor', 'A Korean man in his late 50s, wealthy investor, expensive dark suit with loosened tie, heavy build, unreadable flat expression'],
  ['expartner', 'A Korean man in his mid 40s, former business partner, worn dark overcoat over a shirt, unshaven, average build, deep frown lines'],
  ['housekeeping', 'A Korean woman in her early 40s, hotel housekeeping staff, dark uniform with apron and cap, flat shoes, guarded anxious eyes'],
  ['nephew', 'A Korean man in his late 20s, cheap dark jacket over a t-shirt and jeans, sneakers, thin build, restless nervous eyes'],
]

async function generate(slug, subject) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${subject}. ${SPEC}`,
      size: SIZE,
      quality: QUALITY,
      n: 1,
    }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(d).slice(0, 400))

  const item = d.data?.[0]
  const bin = item?.b64_json
    ? Buffer.from(item.b64_json, 'base64')
    : Buffer.from(await (await fetch(item.url)).arrayBuffer())

  mkdirSync(OUT, { recursive: true })
  const file = `${OUT}/${slug}.png`
  writeFileSync(file, bin)
  console.log(`  ${slug}: ${file} (${(bin.length / 1024).toFixed(0)}KB)`)
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const have = new Set(
  (existsSync(OUT) ? readdirSync(OUT) : []).filter((f) => /\.png$/i.test(f)).map((f) => f.replace(/\.png$/i, '')),
)
const todo = ROLES.filter(([slug]) => (only ? slug === only : !have.has(slug)))
if (!todo.length) { console.log('생성할 것이 없다 (이미 다 있음).'); process.exit(0) }

console.log(`\n▶ ${MODEL} · ${SIZE} · ${QUALITY} · ${todo.length}장\n`)
for (const [slug, subject] of todo) {
  try {
    await generate(slug, subject)
  } catch (e) {
    console.error(`  ✗ ${slug} 실패: ${e.message}`)
  }
}
