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
/** 규칙 문구에 숫자를 하드코딩하지 않는다. 두 번 틀렸다:
 *  ① 제출 3요소·채점을 로그에서 빼먹어 "안 보인다" 는 가짜 지적을 받았고
 *  ② 예산을 6으로 박아둬서 9회 예산을 규칙 위반으로 읽혔다.
 *  **리뷰어는 내가 준 맥락만큼만 볼 수 있다.** */
const BUDGET = Number(
  /INVESTIGATION_BUDGET = (\d+)/.exec(readFileSync('src/data/config.ts', 'utf-8'))?.[1] ?? 0,
)
if (!BUDGET) throw new Error('config.ts 에서 INVESTIGATION_BUDGET 를 못 읽었다')
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
    // 화면 한가운데의 '알리바이 대조표' — 시작 시점에는 범행 시각 열만 채워져 있다
    const pad = (t, w) => { let n = 0; for (const ch of t) n += ch.charCodeAt(0) > 127 ? 2 : 1; return t + ' '.repeat(Math.max(0, w - n)) }
    const slots = [0, 1, 2, 3, 4]
    const grid = [
      pad('', 10) + slots.map((t) => pad(SLOT_LABEL[t] + (t === CRIME_SLOT ? '*' : ''), 10)).join(''),
      ...SUSPECTS.map((s) => pad(c.suspects[s].name, 10) +
        slots.map((t) => pad(t === CRIME_SLOT ? PLACE_LABEL[c.suspects[s].claim[t]] : '—', 10)).join('')),
      '(* = 범행 시각 · 심문하면 그 사람의 나머지 칸이 채워진다 · 모순이 잡히면 그 칸에 붉은 인장)',
    ].join('\\n')
    out.push({
      seed, title: c.title, victim: c.victim.name, venue: c.venue.name,
      header: \`\${c.venue.name} \${c.venue.room} · 피해자 \${c.victim.name}(\${c.victim.title}) · 추정 범행 \${SLOT_LABEL[CRIME_SLOT]} · 남은 조사 표시(●)\`,
      seen, menu, grid, actions: r.log, won: r.won, used: r.actionsUsed, contradictions: r.contradictions,
      note: [
        '[화면 구성] 왼쪽=용의자 5인(이름·직업·관계·압박 정도). 가운데=알리바이 대조표(위에 그린 것) + 그 아래 발견한 모순 목록. 대조표 위에는 남은 후보 수가 항상 표시되고, 기록으로 소거된 사람은 표에서 흐려지며 "기록으로 소거됨" 표가 붙는다. 오른쪽=조회 가능한 기록 목록, 잠긴 기록, 확보한 기록.',
        '[대조표가 곧 진술 카드다] 오른쪽 기록 한 장과 대조표의 칸 하나를 누르면 대조된다. 어긋나면 그 칸에 붉은 인장이 찍히고 아래 목록에 사람이 읽는 문장으로 쌓인다(예: "권태경의 22:20 진술이 CCTV · 22:20 라운지 기록과 어긋난다"). 대조는 조사를 소모하지 않는다.',
        '[기록 카드] 종류·시각·장소·찍힌 인물이 적혀 있다. 조회 전에는 인물이 감춰지고 종류·시각·장소만 보인다.',
        '[잠긴 기록] 목록에 자물쇠와 함께 남은 해금 조건과 진행도가 보인다(예: 조건 1/2 — 필요: 범인의 자백성 진술). 누가 열쇠인지는 감춰진다.',
        '[증거 제시 결과] 제시는 조사 1회를 거는 도박이며 시작 안내가 이를 명시한다(인장은 범인을 좁히는 근거, 제시는 자물쇠를 여는 시도 — 둘은 다른 일이다). 무반응이면 "이 조합은 해금 경로가 아니다. 다만 자물쇠에 대한 소거일 뿐 범인 후보를 지우지는 않는다 — 사람을 지우는 건 범행 시각의 기록뿐이다", 반응이면 "잠긴 현장 기록 조건이 1/2 → 2/2 로 진전됐다" 또는 "자물쇠가 풀렸다" 로 진행도를 알려준다. 무반응 조합은 화면에 남는다.',
        '[상단] 사건 개요와 범행 추정 시각, 남은 조사 표시(●), 그리고 상태에 맞춘 코치 한 줄. 남은 조사가 2회 이하가 되면 무엇을 포기하는 중인지 알려준다(예: "남은 조사 2회. 현장 기록은 아직 잠겨 있습니다 — 지금 결론을 내면 결정적 증거(20점)는 포기하는 것입니다.").',
        '[시작 화면] 사건 브리핑이 한 번 뜨고 할 일 5단계를 안내한다. 승리 경로와 완주 보상을 분리해 설명한다: ① 대조표를 읽는다 ② 심문하거나 기록을 조회한다 ③ 기록으로 후보를 지운다 — 이게 승리 경로다 ④ 기록과 진술을 맞춰 붉은 인장을 찍는다(무료, 누구를 의심할지 정하는 근거) ⑤ (선택) 증거를 들이밀어 잠긴 기록을 연다 — 조사 1회를 거는 도박이며 완주 보상 40점을 위한 것이지 범인을 맞히는 데 필요하지 않다. 잠긴 기록 패널에도 그것이 결정적 증거이며 카드의 발급 구분이 범행 수단임을 적어 둔다.',
        '[제출 화면] 지금까지의 근거를 한 줄로 요약해 준다(조사 N회 소모 · 확보한 기록 N건 · 찾아낸 인장 N건 · 소거한 조합 N건). 결정적 증거는 원칙만 안내하고(범인이 범행 시각에 현장에 있었음을 확정하는 기록) 정답 표시는 하지 않는다. 범행 시각이 아닌 기록은 선택 불가로 회색 처리된다. 범행 시각이지만 카드키 출입 기록이 아닌 것에는 "현장 확인용 기록이다. 카드키 출입 기록이 아니다" 라고 표시된다 — 고를 수는 있되 사실을 알려준다. 어느 장소가 현장인가는 여전히 플레이어가 판단한다.',
        '[범행 수단] 결정적 증거는 언제나 범행 시각 현장의 카드키 출입 기록이고, 그 카드에는 "발급 구분"(예: 복제 의심 / 마스터 / 여벌 / 분실 신고분 / 임시)이 찍혀 있다. 그것이 곧 범행 수단이다 — 결정적 증거를 확보한 플레이어는 수단을 판독할 수 있고, 못 얻었으면 추측이다. **그리고 카드를 쥐지 않은 채 찍어서 맞히면 수단 20점은 주어지지 않는다** — 결과 화면이 그 이유를 밝힌다. 제출 화면이 이 규칙을 미리 안내한다.',
        '[결과 화면] 진범·동기·수단, 범인의 실제 이동 경로 재구성, 점수 내역. 결정적 증거를 틀렸으면 무엇이 정답이었는지와 왜 그것인지를 복기해 준다.',
      ].join(' '),
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

const SYSTEM = () => `당신은 냉정한 게임 플레이테스터다. 추리 게임 "FIVE ALIBIS" 를 처음 하는 사람의 눈으로 본다.

규칙:
- 칭찬하지 마라. 좋은 점은 적지 마라. 문제만 적는다.
- 문제가 없으면 findings 를 빈 배열로 두라. 억지로 만들어내지 마라.
- 각 지적은 반드시 아래 로그의 특정 대목을 근거로 들어야 한다. 근거를 못 대면 적지 마라.
- 당신은 정답(범인)을 모른다. 로그의 승패만 안다. 정답을 추측하려 하지 마라.
- "AI 대사가 어떻다" 는 이 로그에 없으니 논하지 마라. 구조·정보·페이스만 본다.

이 게임의 규칙:
- 조사는 총 ${BUDGET}회. 심문 1회, 기록 조회 1회, 증거 제시 1회씩 소모.
- 카드 연결(모순 찾기)은 무료, 무제한.
- 결정적 증거를 **조회하려면** 범인의 자백과 무고한 목격자의 증언이 모두 필요하다(해금 조건).
  일단 확보하면 그 카드 자체가 결정적 증거다 — 카드에 적힌 시각·장소로 알아볼 수 있다.
- 마지막에 범인·수단·결정적 증거를 지목한다. **제출은 조사 횟수를 소모하지 않는다.**
- **배점: 범인 60 · 수단 20(결정적 증거 카드를 쥔 경우에만) · 결정적 증거 20 · 남은 조사 ×5 · 발견한 모순 ×5.**
  **승패는 범인 적중 하나로 갈린다.** 결정적 증거는 완주 보상이며 못 맞혀도 진 게 아니다
  (상식 수준 플레이 기준 도달률 26% — 의도된 상급 목표).
- 아래 행동 목록의 마지막 '제출' 항목은 조사 행동이 아니다. 그 앞까지가 소모된 조사다.`

async function review(t, known) {
  const body = {
    model: MODEL,
    max_output_tokens: 4000,
    reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: SYSTEM() },
      {
        role: 'user',
        content: [
          `[화면 상단에 항상 보이는 것] ${t.header}`,
          ``,
          `[시작 화면에 보이는 다섯 명]`,
          t.seen,
          ``,
          `[화면 한가운데 — 알리바이 대조표 (시작 시점)]`,
          t.grid,
          ``,
          `[열 수 있는 기록 목록 — 누가 찍혔는지는 열어야 보인다]`,
          t.menu,
          ``,
          `[플레이어가 한 행동 순서 (조사 ${t.used}/${BUDGET} 소모)]`,
          t.actions.map((a, i) => `  ${i + 1}. ${a}`).join('\n'),
          ``,
          `[화면이 제공하는 것] ${t.note}`,
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
  if (!text) {
    // 출력이 없으면 원인을 드러낸다 — 조용히 죽으면 루프가 왜 멈췄는지 알 수 없다
    console.error(`  ⚠️ 응답 없음 status=${d.status} incomplete=${JSON.stringify(d.incomplete_details)} out=${d.usage?.output_tokens}`)
    return { findings: [], verdict: '(리뷰 실패 — 응답 없음)' }
  }
  // 응답이 상한에 걸려 잘리면 JSON 이 깨진다. 루프 전체가 죽는 대신 그 판만 건너뛴다 —
  // 조용히 삼키지 말고 원인을 찍는다 (한 번 이 크래시로 6판 리뷰를 통째로 잃었다).
  try {
    return JSON.parse(text)
  } catch {
    console.error(`  ⚠️ 응답이 잘려 파싱 실패 (out=${d.usage?.output_tokens}, incomplete=${JSON.stringify(d.incomplete_details)}) — 이 판은 건너뛴다`)
    return { findings: [], verdict: '(리뷰 실패 — 응답 잘림)' }
  }
}

const known = existsSync(KNOWN_PATH) ? JSON.parse(readFileSync(KNOWN_PATH, 'utf-8')) : []
console.log(`\n▶ 봇 ${N}판 플레이 → LLM 리뷰 (이미 아는 문제 ${known.length}건 제외)\n`)

const transcripts = collectTranscripts(N)
const all = []
for (const t of transcripts) {
  const r = await review(t, known)
  console.log(`── 시드 ${t.seed} (${t.won ? '승' : '패'}, 조사 ${t.used}/${BUDGET}) ──`)
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
