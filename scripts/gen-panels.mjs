#!/usr/bin/env node
/**
 * 인트로·아웃트로 만화 패널 — **OpenAI 이미지로 뽑는다.**
 *
 * 프롬프트의 정본은 `docs/content/인트로-패널-생성-프롬프트.md` 다.
 * 이 스크립트는 그 문서의 프롬프트를 코드로 옮긴 것이고, 문서의 하드 제약
 * (글자 금지·얼굴 금지·시신 금지·1960년대·중앙 띠 구도)을 그대로 진다.
 *
 * 크레딧 규율 — 이 프로젝트가 크레딧 44% 를 태우며 배운 그대로:
 *   ① `--only 0` 으로 **한 장 먼저** 뽑아 눈으로 확인한 뒤에야 `--all`.
 *   ② 받은 바이트를 검사하고 이상하면 쓰지 않는다.
 *
 * 사용:
 *   node scripts/gen-panels.mjs --only 0     인트로 0 한 장만
 *   node scripts/gen-panels.mjs --all        없는 것 전부
 *   node scripts/gen-panels.mjs --all --force  있어도 다시
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const MODEL = process.env.MODEL ?? 'gpt-image-2'
const SIZE = '1536x1024'
const QUALITY = process.env.QUALITY ?? 'high'

const key = (() => {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const m = /^OPENAI_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf-8'))
  if (!m) throw new Error('.dev.vars 에 OPENAI_API_KEY 가 없다')
  return m[1].trim().replace(/^["']|["']$/g, '')
})()

/** 공통 스타일 — 호텔 더스크(로토스코프 연필선) × 1960년대 누아르. 문서와 동일. */
const STYLE = [
  'Hand-drawn detective adventure game illustration in the style of 1960s noir:',
  'loose confident pencil line art with rotoscope-like figure work, sketchy',
  'cross-hatching and charcoal grain shading, mostly desaturated warm sepia',
  'monochrome with selective muted color accents only in brass amber and deep',
  'burgundy, aged paper texture feeling, dramatic film-noir lighting with deep',
  'shadows, cinematic composition. No text, no lettering, no signage with',
  'readable words, no watermark, no speech bubbles, no frames or borders.',
].join(' ')

/** [출력 경로, 장면 프롬프트] — 문서의 12장 그대로 */
const PANELS = {
  '0': ['public/intro/0.png',
    'Wide establishing shot of a grand 1960s classic hotel at night: art-deco entrance canopy with warm brass lamps glowing, rain-slick street with faint reflections, ornate stone facade receding upward into darkness, a few windows lit on the upper floor. Low camera angle from across the street. The hotel sign is a blank glowing shape with no readable letters. Composition holds all key elements in the central horizontal band.'],
  '1': ['public/intro/1.png',
    'A dim 1960s hotel corridor in strong one-point perspective: half of the wall lamps are dark or flickering, worn burgundy patterned carpet, identical doors receding into darkness, at the far end one door stands slightly ajar spilling a thin wedge of warm amber light across the carpet. Unsettling emptiness, film-noir shadows.'],
  '2': ['public/intro/2.png',
    'View from the corridor into an open hotel room doorway at night: the door wide open, warm lamplight flooding out into the dark hallway, an overturned auction catalogue and a single dropped white glove on the floor near the threshold, and the long distorted shadow of an unseen fallen figure cast across the carpet from inside the room. No body visible, no face, no blood. The shadow tells the story.'],
  '3': ['public/intro/3.png',
    'Five anonymous human silhouettes standing scattered in a 1960s hotel lobby, strongly backlit by the warm light of an elevator and front desk lamps so that all faces and clothing details are lost in shadow. Varied heights and postures - one leaning on the desk, one holding a coat, one half turned away - but no identifiable faces, hair, or gender cues. Thin cigarette smoke haze in the light beams.'],
  '4': ['public/intro/4.png',
    "Top-down view of a detective's desk at night under a single warm desk lamp: an open kraft-paper case file with sheets of paper covered in illegible pencil scribbles, five blank paper-clipped photograph placeholders, a brass hotel room key with a blank tag, a magnifying glass, coffee ring stains on the desk. All writing is unreadable scribble marks only."],
  'o0': ['public/outro/0.png',
    "Interrogation room table seen from across: a suspect's slumped shoulders and clasped hands on the metal table under a single hanging lamp, face entirely out of frame above the top edge, brick wall and one-way mirror in deep shadow behind. The posture says defeat."],
  'o1': ['public/outro/1.png',
    "Extreme close-up of handcuffs closing around wrists resting on a metal table, a uniformed officer's gloved hands applying them, warm lamp glow from above, everything else falling into darkness. Hands only, no faces."],
  'o2': ['public/outro/2.png',
    'A 1960s hotel corridor at night: the dark silhouette of a person being led away from camera by a broader silhouette of an officer, both seen fully from behind, walking toward the bright light at the far end of the corridor, long shadows stretching back toward the viewer. No faces.'],
  'o3': ['public/outro/3.png',
    'The hotel facade at night seen from the street: every window dark except a single lit window on the upper floor, captured at the moment its light is switching off - the window half dimmed. Quiet, final, empty street below with one streetlamp.'],
  'm0': ['public/outro/m0.png',
    'Close-up of an unsigned confession document on an interrogation room table - a sheet with illegible scribbled paragraphs and a conspicuously empty signature line at the bottom, a fountain pen lying untouched beside it, one empty metal chair pushed back from the table in the shadows behind. All writing is unreadable scribbles.'],
  'm1': ['public/outro/m1.png',
    'A thick case file being closed and tied shut with string, seen from above on a dark desk: aged folder stuffed with paper edges sticking out, a hand pressing it flat, a shelf of identical dusty tied folders barely visible in the darkness behind. Unresolved weight.'],
  'm2': ['public/outro/m2.png',
    'A quiet 1960s city street at night seen from a low angle: five separate lit windows in different distant buildings, each glowing warm in the darkness, tiny anonymous silhouettes behind two of the curtains. Rain just ended, wet pavement reflections. Somewhere among them, someone sleeps soundly.'],
}

async function generate(id) {
  const [out, scene] = PANELS[id]
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: `${STYLE} ${scene}`, size: SIZE, quality: QUALITY, n: 1 }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(d).slice(0, 300))
  const item = d.data?.[0]
  const bin = item?.b64_json
    ? Buffer.from(item.b64_json, 'base64')
    : Buffer.from(await (await fetch(item.url)).arrayBuffer())
  // 받은 것을 확인하고 쓴다 — PNG 매직넘버와 최소 크기
  if (bin.length < 30_000) throw new Error(`${bin.length}바이트 — 이미지가 아니다`)
  if (bin[0] !== 0x89 || bin[1] !== 0x50) throw new Error('PNG 가 아니다')
  mkdirSync(out.split('/').slice(0, -1).join('/'), { recursive: true })
  writeFileSync(out, bin)
  return { out, kb: Math.round(bin.length / 1024) }
}

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const all = args.includes('--all')
const force = args.includes('--force')

const ids = only ? [only] : all ? Object.keys(PANELS) : []
if (!ids.length) {
  console.log('사용: --only <id> 로 한 장 확인 후 --all. id:', Object.keys(PANELS).join(' '))
  process.exit(0)
}
for (const id of ids) {
  if (!PANELS[id]) { console.error(`✗ '${id}' 없음`); continue }
  if (!force && existsSync(PANELS[id][0])) { console.log(`  ${id} 있음 — 건너뜀`); continue }
  process.stdout.write(`  ${id} … `)
  try {
    const r = await generate(id)
    console.log(`${r.out} (${r.kb}KB)`)
  } catch (e) {
    console.log(`실패 — ${e.message}`)
  }
}
