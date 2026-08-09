import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { botRng, commonsenseBot, optimalBot, randomBot } from '../src/engine/bots'
import { FIELD_BUDGET, TALK_CAP } from '../src/data/config'

const SEEDS = Array.from({ length: 100 }, (_, i) => 20000 + i)
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(0)}%`

describe('★ 밸런스 — 봇 승률 (조사 예산 판정 근거)', () => {
  const rows = SEEDS.map((seed) => {
    const g = generateValidCase(seed)
    return {
      random: randomBot(g.case, botRng(seed)),
      common: commonsenseBot(g.case, botRng(seed)),
      optimal: optimalBot(g.case, g.validation.solve.path),
    }
  })
  const rate = (k: 'random' | 'common' | 'optimal') => rows.filter((r) => r[k].won).length / rows.length
  const avgActions = (k: 'random' | 'common' | 'optimal') =>
    rows.reduce((a, r) => a + r[k].actionsUsed, 0) / rows.length

  it('통계 출력', () => {
    console.log(`\n  현장 ${FIELD_BUDGET}회 · 대화 인당 ${TALK_CAP}회 · 시드 ${SEEDS.length}개`)
    for (const k of ['random', 'common', 'optimal'] as const) {
      console.log(`  ${k.padEnd(11)} 승률 ${pct(rows.filter((r) => r[k].won).length, rows.length).padStart(4)}  평균 소모 ${avgActions(k).toFixed(1)}회  평균 모순 ${(rows.reduce((a, r) => a + r[k].contradictions, 0) / rows.length).toFixed(1)}건`)
    }
    const fails = rows.filter((r) => !r.common.won).slice(0, 2)
    for (const f of fails) console.log(`  [상식봇 실패 예 seed ${f.common.seed}] ${f.common.log.join(' / ')}`)
  })

  it('완벽 봇은 항상 이긴다 — 사건이 실제로 풀린다는 증명', () => {
    expect(rate('optimal')).toBe(1)
  })

  /**
   * 무작위 봇 실측 22% (2026-08-10, ADR 022 재측정).
   * 눈감고 찍으면 20% 다 — 무작위 행동은 겨우 +2%p 를 보탠다.
   * 예전엔 이 봇도 똑똑한 지목 사다리를 탔는데, 대화 지갑 분리로 정보가 흔해지자
   * 51% 를 "추리" 해버렸다. 하한선의 의미를 되찾으려 지목을 후보 중 무작위로 바꿨다.
   */
  it('무작위 봇은 절반 아래다 — 찍어서 되는 게임이 아니다', () => {
    expect(rate('random')).toBeLessThan(0.5)
  })

  it('상식 봇이 무작위 봇을 유의미하게 앞선다 — 스킬이 값을 한다', () => {
    expect(rate('common') - rate('random')).toBeGreaterThanOrEqual(0.08)
  })

  /**
   * ★ 목표 구간 재설정: 60~75% → **75~95%** (2026-08-10, ADR 022).
   *
   * 왜 바뀌었나: 옛 구간은 조회·심문·제시가 예산 9회 **한 지갑**을 쓰던 시절의 것이다.
   * 챕터 구조는 대화를 인당 10회(총 50회)로 풀어놨고, 체계적으로 노는 봇은 전원을
   * 심문하고 모순마다 들이밀 수 있다 — 정보가 흔해져 실측이 64% → 84% 로 올랐다.
   * 이건 회귀가 아니라 **의도된 관대함**이다 (ADR 022 §2: 상한은 낭비를 막는 안전선).
   * 난이도의 긴장은 이제 승패가 아니라 3축 완답(동기·도구까지)과 통찰 보너스에 있다.
   *
   * 그래도 상한(95%)은 잠근다 — 100% 에 붙으면 "심문 없이 알리바이만으로 확정되는"
   * 류의 구조 누설이 되살아났다는 신호다 (ADR 007 이 잡았던 그 병).
   * 하한(75%)은 상식적인 플레이가 벽에 부딪히는 회귀를 감시한다.
   */
  it('★ 상식 봇 승률이 목표 구간(75~95%)에 있다', () => {
    const r = rate('common')
    expect(r).toBeGreaterThanOrEqual(0.75)
    expect(r).toBeLessThanOrEqual(0.95)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * ★ 완료기준 E1 — 행동 수를 **실제 소요시간**으로 환산한다.
 *
 * 왜 필요한가: 예산 9회는 "행동 9번" 일 뿐 시간이 아니다. 심문 1회와 조회 1회는
 * 같은 1회지만 벽시계로는 4배 넘게 차이 난다(LLM 왕복 vs 로컬 조회).
 * 그래서 "숙련자 5분" 은 평균 행동 수가 아니라 **행동 구성**으로 판정해야 한다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 환산 상수 — 전부 여기 모으고 근거를 남긴다. 테스트를 통과시키려고 만지지 말 것.
 *
 * ⚠️ 이 상수들은 **측정 대체물이지 측정값이 아니다.** 실제 브라우저 계측이 붙으면 갱신한다.
 */
const TIME = {
  /**
   * LLM 응답 대기 3초. 근거: docs/STATE.md 프로덕션 실측 12회 1.35~2.71초,
   * ADR 005 성능 목표 p95 ≤3.5초. 그 사이의 보수적 대표값으로 3초를 쓴다.
   * (타이핑 연출이 붙으므로 "첫 토큰" 이 아니라 "다 읽을 수 있게 되기까지" 에 가깝다)
   */
  LLM_WAIT_SEC: 3,
  /**
   * 답변 읽는 시간 6초. 근거: 페르소나 응답은 2~3문장 · 한국어 60~90자 규모이고,
   * 한국어 묵독 속도 대략 500~600자/분 ≈ 9~10자/초 → 8~10초.
   * 여기에 플레이어가 문장 전체를 정독하지 않고 시각·장소만 훑는 실제 행동을 반영해 6초로 잡는다.
   */
  LLM_READ_SEC: 6,
  /** 기록 조회 2초. 네트워크 없음(로컬 상태 전이) + 카드 한 장 훑기. */
  LOOKUP_SEC: 2,
  /**
   * 카드 연결(무료 행동) 판당 20초. 근거: 봇의 connectAll 은 매 행동마다 전 조합을 돌지만
   * 사람은 새 카드가 들어올 때만 관심 조합 몇 개를 클릭한다. 판당 8~12회 클릭 × 2초 ≈ 20초.
   * **행동 수에 비례시키지 않는 것이 중요하다** — 연결은 조사 예산을 안 쓰므로
   * 행동 수로 환산하면 시간이 이중 계상된다.
   */
  CONNECT_SEC_PER_GAME: 20,
  /** 초회 플레이어 온보딩 — 규칙 읽기 + 용의자 5명 카드 정독 + 기록 목록 훑기. */
  FIRST_TIME_OVERHEAD_SEC: 90,

  /** 완료기준 E1 상한 */
  SKILLED_LIMIT_SEC: 5 * 60,
  FIRST_TIME_LIMIT_SEC: 6 * 60 + 30,
} as const

/** 심문·증거 제시는 둘 다 LLM 왕복이다 — 대기 + 읽기 */
const LLM_TURN_SEC = TIME.LLM_WAIT_SEC + TIME.LLM_READ_SEC

interface ActionMix { interview: number; lookup: number; present: number }

/**
 * 봇 로그 한 줄 → 행동 종류. 로그 접두사는 bots.ts 가 소유한다:
 *   `심문 S3 (모순 대상)` / `조회 E2 (해금됨)` / `제시 E2→S3 ★반응` / `제출 — ...`
 * '제출' 은 조사 행동이 아니다(예산을 안 쓴다).
 */
function classify(log: string[]): ActionMix {
  const mix: ActionMix = { interview: 0, lookup: 0, present: 0 }
  for (const line of log) {
    if (line.startsWith('심문')) mix.interview++
    else if (line.startsWith('조회')) mix.lookup++
    else if (line.startsWith('제시')) mix.present++
    else if (line.startsWith('제출')) continue
    else throw new Error(`분류 못 한 로그 줄: "${line}" — bots.ts 로그 포맷이 바뀌었다`)
  }
  return mix
}

const skilledSec = (m: ActionMix) =>
  (m.interview + m.present) * LLM_TURN_SEC + m.lookup * TIME.LOOKUP_SEC + TIME.CONNECT_SEC_PER_GAME

const mmss = (s: number) => `${Math.floor(s / 60)}분 ${String(Math.round(s % 60)).padStart(2, '0')}초`

describe('★ E1 시간 — 행동 구성을 벽시계로 환산', () => {
  const runs = SEEDS.map((seed) => commonsenseBot(generateValidCase(seed).case, botRng(seed)))
  const mixes = runs.map((r) => classify(r.log))
  const skilled = mixes.map(skilledSec)
  const firstTime = skilled.map((s) => s + TIME.FIRST_TIME_OVERHEAD_SEC)

  const sorted = [...skilled].sort((a, b) => a - b)
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

  it('로그 줄 수가 실제 소모 조사 수와 일치한다 — 환산의 전제', () => {
    // 이게 깨지면 시간 숫자는 전부 거짓말이 된다. 먼저 잠근다.
    runs.forEach((r, i) => {
      const m = mixes[i]!
      expect(m.interview + m.lookup + m.present, `seed ${r.seed}`).toBe(r.actionsUsed)
    })
  })

  it('통계 출력', () => {
    const m = { interview: mean(mixes.map((x) => x.interview)), lookup: mean(mixes.map((x) => x.lookup)), present: mean(mixes.map((x) => x.present)) }
    console.log(`\n  [E1 시간 환산] 상식봇 ${SEEDS.length}판 · 현장 ${FIELD_BUDGET}회 · 대화 인당 ${TALK_CAP}회`)
    console.log(`  상수: LLM 왕복 ${LLM_TURN_SEC}초(대기 ${TIME.LLM_WAIT_SEC} + 읽기 ${TIME.LLM_READ_SEC}) · 조회 ${TIME.LOOKUP_SEC}초 · 연결 ${TIME.CONNECT_SEC_PER_GAME}초/판 · 초회 +${TIME.FIRST_TIME_OVERHEAD_SEC}초`)
    console.log(`  평균 행동 구성: 심문 ${m.interview.toFixed(1)} · 제시 ${m.present.toFixed(1)} · 조회 ${m.lookup.toFixed(1)}`)
    console.log(`  숙련  평균 ${mmss(mean(skilled))} · 중앙 ${mmss(p(0.5))} · p95 ${mmss(p(0.95))} · 최악 ${mmss(Math.max(...skilled))}  (상한 ${mmss(TIME.SKILLED_LIMIT_SEC)})`)
    console.log(`  초회  평균 ${mmss(mean(firstTime))} · p95 ${mmss(p(0.95) + TIME.FIRST_TIME_OVERHEAD_SEC)} · 최악 ${mmss(Math.max(...firstTime))}  (상한 ${mmss(TIME.FIRST_TIME_LIMIT_SEC)})`)

    // ⚠️ 이 모델이 **빼먹고 있는 것**: 심문 질문을 사람이 직접 작문·타이핑하는 시간.
    //   봇은 대상만 고르면 되지만 사람은 한글 IME 로 한 문장을 친다. 이게 실제로는 최대 항일 수 있다.
    //   상한 판정은 위 가정(과제 명시)대로 두되, 민감도를 같이 남긴다 — 숫자를 숨기지 않기 위해서.
    for (const typing of [10, 20, 30]) {
      const w = mixes.map((x, i) => skilled[i]! + x.interview * typing)
      console.log(`   └ 민감도: 심문당 작문·타이핑 ${typing}초 가정 → 숙련 평균 ${mmss(mean(w))} · 최악 ${mmss(Math.max(...w))} · 초회 최악 ${mmss(Math.max(...w) + TIME.FIRST_TIME_OVERHEAD_SEC)}`)
    }
  })

  it('숙련자 1판이 5분 안에 끝난다 — 최악의 시드에서도', () => {
    expect(Math.max(...skilled)).toBeLessThanOrEqual(TIME.SKILLED_LIMIT_SEC)
  })

  it('초회 플레이어 1판이 6분 30초 안에 끝난다 — 최악의 시드에서도', () => {
    expect(Math.max(...firstTime)).toBeLessThanOrEqual(TIME.FIRST_TIME_LIMIT_SEC)
  })

  /**
   * ADR 022 이후 "전소진 ≤ 5분" 은 **성립하지 않고, 성립할 필요도 없다.**
   * 대화 50회(5명×10회)는 상한이지 기준이 아니다 — 숙련자는 몇 번으로 끝내고,
   * 상한은 낭비를 막는 안전선이다 (ADR 022 §2). 5분 상한은 위의 **실측 최악**(상식 봇)이
   * 지키고, 여기서는 이론적 전소진이 ADR 이 감수한 구간(15~25분)을 안 넘는지만 잠근다.
   */
  it('대화 상한까지 전소진해도 ADR 022 가 감수한 상한(25분) 안이다', () => {
    const TYPING_SEC = 20   // 심문당 작문·타이핑 — 위 민감도 표의 중간값
    const worst = FIELD_BUDGET * TIME.LOOKUP_SEC
      + 5 * TALK_CAP * (LLM_TURN_SEC + TYPING_SEC)
      + TIME.CONNECT_SEC_PER_GAME
    console.log(`  이론 전소진(현장 ${FIELD_BUDGET}회 + 대화 ${5 * TALK_CAP}회, 타이핑 ${TYPING_SEC}초/회): ${mmss(worst)}`)
    expect(worst).toBeLessThanOrEqual(25 * 60)
  })
})
