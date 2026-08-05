#!/usr/bin/env node
/**
 * 자동 플레이테스트 리뷰 루프 — 봇이 한 판 돌고, LLM 이 **냉정하게** 지적한다.
 *
 * 왜 필요한가: 승률 숫자는 "몇 % 이기는가" 만 답한다.
 * "왜 재미없는가 / 어디서 막히는가 / 뭐가 불친절한가" 는 자연어로만 나온다.
 * 사람 플레이테스터를 매번 부를 수 없으니 그 역할을 자동화한다.
 *
 * 규율 (llm-persona-game 스킬과 같은 원칙):
 *   - 리뷰어는 **플레이어가 본 것만** 받는다. 정답·진실 궤적을 주면 사후확신 편향이 생겨
 *     "범인이 뻔하다" 같은 쓸모없는 지적만 나온다.
 *   - 칭찬 금지. 구조화 출력으로 강제한다.
 *   - 이미 알고 있는 문제(known.json)는 다시 올리지 않는다 → 루프가 수렴한다.
 *
 * 사용법:
 *   node scripts/review.mjs            # 3판 리뷰
 *   node scripts/review.mjs 5          # 5판
 *   ROUNDS=3 node scripts/review.mjs   # 지적이 없을 때까지 최대 3라운드
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const N = Number(process.argv[2] ?? 3)
const KNOWN_PATH = 'docs/playtest-known.json'
const MODEL = 'gpt-5.6-terra'

const key = (() => {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const m = /OPENAI_API_KEY=(.+)/.exec(readFileSync('.dev.vars', 'utf-8'))
  if (!m) throw new Error('.dev.vars 에 OPENAI_API_KEY 가 없다')
  return m[1].trim()
})()

// 봇 로그를 뽑는다 (엔진은 TS 이므로 vitest 러너를 통해 실행)
function collectTranscripts(n) {
  const src = `
import { it } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { commonsenseBot, botRng } from '../src/engine/bots'
import { createGame, availableEvidence } from '../src/engine/game'
import { SLOT_LABEL, PLACE_LABEL, SUSPECTS, CRIME_SLOT } from '../src/types'
import { personaById } from '../src/data/personas'
it('t', () => {
  const out = []
  for (let i = 0; i < ${n}; i++) {
    const seed = 40000 + i * 137
    const g = generateValidCase(seed)
    const c = g.case
    const r = commonsenseBot(c, botRng(seed))
    const seen = SUSPECTS.map((s) => {
      const x = c.suspects[s]
      return \`  \${x.name}(\${x.job}, \${x.relation}) — "\${SLOT_LABEL[CRIME_SLOT]}엔 \${PLACE_LABEL[x.claim[CRIME_SLOT]]}" · 성향힌트 "\${personaById(x.personaId).hint}"\`
    }).join('\\n')
    const menu = availableEvidence(createGame(c)).map((e) =>
      \`  \${e.kind} · \${SLOT_LABEL[e.slot]} \${PLACE_LABEL[e.place]}\`).join('\\n')
    out.push({
      seed, title: c.title, victim: c.victim.name, venue: c.venue.name,
      seen, menu, actions: r.log, won: r.won, used: r.actionsUsed, contradictions: r.contradictions,
    })
  }
  console.log('===JSON===' + JSON.stringify(out))
})`
  writeFileSync('tests/_review.test.ts', src)
  try {
    const o = execSync('npx vitest run tests/_review.test.ts', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    const line = o.split('\n').find((l) => l.includes('===JSON==='))
    return JSON.parse(line.slice(line.indexOf('===JSON===') + 10))
  } finally {
    execSync('rm -f tests/_review.test.ts')
  }
}

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string', enum: ['onboarding', 'clarity', 'pacing', 'balance', 'feedback', 'fairness'] },
          problem: { type: 'string', description: '무엇이 문제인지 한 문장' },
          evidence: { type: 'string', description: '로그의 어느 대목이 근거인지' },
          fix: { type: 'string', description: '구체적 수정 제안 한 문장' },
        },
        required: ['severity', 'area', 'problem', 'evidence', 'fix'],
        additionalProperties: false,
      },
    },
    verdict: { type: 'string', description: '한 문장 총평' },
  },
  required: ['findings', 'verdict'],
  additionalProperties: false,
}

const SYSTEM = `당신은 냉정한 게임 플레이테스터다. 추리 게임 "FIVE ALIBIS" 를 처음 하는 사람의 눈으로 본다.

규칙:
- 칭찬하지 마라. 좋은 점은 적지 마라. 문제만 적는다.
- 문제가 없으면 findings 를 빈 배열로 두라. 억지로 만들어내지 마라.
- 각 지적은 반드시 아래 로그의 특정 대목을 근거로 들어야 한다. 근거를 못 대면 적지 마라.
- 당신은 정답(범인)을 모른다. 로그의 승패만 안다. 정답을 추측하려 하지 마라.
- "AI 대사가 어떻다" 는 이 로그에 없으니 논하지 마라. 구조·정보·페이스만 본다.

이 게임의 규칙:
- 조사는 6회뿐. 심문 1회, 기록 조회 1회, 증거 제시 1회씩 소모.
- 카드 연결(모순 찾기)은 무료, 무제한.
- 마지막에 범인·수단·결정적 증거를 지목한다.`

async function review(t, known) {
  const body = {
    model: MODEL,
    max_output_tokens: 1200,
    reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: SYSTEM },
      {
        role: 'user',
        content: [
          `[사건] ${t.title} · ${t.venue} · 피해자 ${t.victim}`,
          ``,
          `[시작 화면에 보이는 다섯 명]`,
          t.seen,
          ``,
          `[열 수 있는 기록 목록 — 누가 찍혔는지는 열어야 보인다]`,
          t.menu,
          ``,
          `[플레이어가 한 행동 순서 (조사 ${t.used}/6 소모)]`,
          t.actions.map((a, i) => `  ${i + 1}. ${a}`).join('\n'),
          ``,
          `[결과] ${t.won ? '범인 적중' : '오답'} · 발견한 모순 ${t.contradictions}건`,
          ``,
          known.length ? `[이미 알고 있어 다시 적을 필요 없는 문제]\n${known.map((k) => '  - ' + k).join('\n')}` : '',
        ].join('\n'),
      },
    ],
    text: { format: { type: 'json_schema', name: 'review', strict: true, schema: SCHEMA } },
  }
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(d).slice(0, 300))
  const text = d.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text')?.text
  return JSON.parse(text)
}

const known = existsSync(KNOWN_PATH) ? JSON.parse(readFileSync(KNOWN_PATH, 'utf-8')) : []
console.log(`\n▶ 봇 ${N}판 플레이 → LLM 리뷰 (이미 아는 문제 ${known.length}건 제외)\n`)

const transcripts = collectTranscripts(N)
const all = []
for (const t of transcripts) {
  const r = await review(t, known)
  console.log(`── 시드 ${t.seed} (${t.won ? '승' : '패'}, 조사 ${t.used}/6) ──`)
  console.log(`   총평: ${r.verdict}`)
  for (const f of r.findings) {
    console.log(`   [${f.severity}/${f.area}] ${f.problem}`)
    console.log(`      근거: ${f.evidence}`)
    console.log(`      제안: ${f.fix}`)
    all.push(f)
  }
  if (!r.findings.length) console.log('   지적 없음')
  console.log()
}

const blockers = all.filter((f) => f.severity === 'blocker').length
const majors = all.filter((f) => f.severity === 'major').length
console.log(`총 ${all.length}건 (blocker ${blockers} · major ${majors} · minor ${all.length - blockers - majors})`)
console.log(all.length === 0 ? '✅ 수렴 — 지적 없음' : '❌ 미수렴 — 수정 후 재실행')
process.exit(all.length === 0 ? 0 : 1)
