/**
 * 플레이 봇 — "예산이 적절한가" 를 감이 아니라 승률로 답하기 위한 도구.
 * starcraft 에서 밸런스를 잡았던 방식(약·강 봇 양끝으로 검증)을 이 장르에 옮긴 것.
 *
 * ADR 022 이후 봇도 챕터 구조를 탄다: **현장 조사(조회 5회) → 심문(인당 대화 10회 상한)**.
 * 심문 진입 게이트는 UI 의 것이지만, 봇이 사람과 같은 순서를 밟아야 승률이 게임을 대표한다.
 *
 * ⚠️ 공정성 규칙: 봇은 **플레이어가 화면에서 볼 수 있는 것만** 읽는다.
 *   - 조회 전 물증의 `subjects` 를 보면 안 된다 (화면엔 종류·시각·장소만 나온다)
 *   - `truth` · `culprit` · `decisive` · `presentUnlocks` 를 보면 안 된다
 *   - `case.weapon` 은 **검시 소견 카드를 쥔 뒤에만** 읽는다 — 카드가 흔적을 1:1 로 보여주므로
 *     그 시점의 판독과 동치다. `suspects[s].motive` 는 **그 사람과 대화한 뒤에만** 읽는다 —
 *     심문에서 사정이 드러난다는 가정이고, 그 가정이 깨지면 이 숫자도 깨진다.
 *   이 규칙이 깨지면 승률 숫자가 아무 의미도 없어진다.
 */

import {
  CRIME_PLACE,
  CRIME_SLOT,
  PLACE_LABEL,
  SLOT_LABEL,
  SUSPECTS,
  type CaseFile,
  type PlaceId,
  type Slot,
  type SuspectId,
} from '../types'
import {
  availableEvidence, connect, createGame, interview,
  lookupEvidence, presentEvidence, submit, talksLeft, type GameState,
} from './game'
import { makeRng, pick, randInt, shuffle, type Rng } from './rng'
import { WEAPONS } from '../data/config'

/** 조회 전에 화면에 보이는 정보만 (subjects 없음) */
export interface VisibleRecord {
  id: string
  kind: string
  slot: Slot
  place: PlaceId
}

/** 기록 한 건을 사람이 읽는 한 줄로. **원시 id·숫자를 로그에 흘리지 않는다.** */
const evLabel = (c: CaseFile, id: string): string => {
  const e = c.evidence.find((x) => x.id === id)
  return e ? `${e.kind} · ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}` : id
}

const visible = (g: GameState): VisibleRecord[] =>
  availableEvidence(g).map((e) => ({ id: e.id, kind: e.kind, slot: e.slot, place: e.place }))

export interface PlayResult {
  seed: number
  bot: string
  won: boolean
  actionsUsed: number
  contradictions: number
  submitted: SuspectId
  culprit: SuspectId
  log: string[]
}

/** 보유한 카드만으로 세우는 후보 추론 — 플레이어가 하는 것과 같은 계산 */
function candidatesVisible(g: GameState): SuspectId[] {
  const cleared = new Set<SuspectId>()
  let pinned: SuspectId | null = null
  for (const e of g.case.evidence) {
    if (!g.cards.includes(e.id) || e.slot !== CRIME_SLOT) continue
    for (const s of e.subjects) {
      if (e.place === CRIME_PLACE) pinned = s
      else cleared.add(s)
    }
  }
  if (pinned) return [pinned]
  return SUSPECTS.filter((s) => !cleared.has(s))
}

/** 보유 카드 전부를 서로 연결해 본다 — 무료이므로 사람도 이렇게 한다 */
function connectAll(g: GameState): GameState {
  const evIds = g.cards.filter((id) => g.case.evidence.some((e) => e.id === id))
  const claimIds = g.cards.filter((id) => id.startsWith('C:'))
  let cur = g
  for (const a of evIds) for (const b of claimIds) cur = connect(cur, a, b).state
  return cur
}

function contradictedSuspects(g: GameState): SuspectId[] {
  return [...new Set(g.foundContradictions.map((k) => k.split('|')[1] as SuspectId))]
}

/**
 * **범행 시각이 아닌 시각**에 모순이 걸린 사람 — 상식 봇의 핵심 추론.
 *
 * 근거: 범행 시각에는 다들 거짓말한다(각자 숨길 게 있다). 그건 잡음이다.
 * 그런데 *다른* 시각의 진술까지 기록과 어긋나는 사람은 드물다 —
 * 그 시각에 있으면 안 될 곳에 있었다는 뜻이다.
 */
function oddHourLiars(g: GameState): SuspectId[] {
  return [...new Set(
    g.foundContradictions
      .filter((k) => Number(k.split('|')[2]) !== CRIME_SLOT)
      .map((k) => k.split('|')[1] as SuspectId),
  )]
}

function finish(
  g: GameState, seed: number, bot: string, log: string[], actionsUsed: number,
  reacted?: Set<SuspectId>, met?: Set<SuspectId>, guessRng?: Rng,
): PlayResult {
  const cands = candidatesVisible(g)
  /**
   * 지목. 무작위 봇은 **남은 후보 중 무작위**로 찍는다 (guessRng) — 대화 지갑 분리로
   * 정보가 흔해진 뒤로는 똑똑한 지목 사다리를 태우면 "운의 하한선" 이라는 이 봇의
   * 존재 이유가 사라진다 (실측: 사다리를 태우자 무작위 봇이 51% 를 "추리" 했다).
   * 상식·완벽 봇의 사다리: ① 후보 1명 확정 ② 증거에 반응한 사람 ③ 범행시각 밖 모순자 ④ 아무 모순자 ⑤ 남은 후보
   */
  const reactedList = [...(reacted ?? [])].filter((s) => cands.includes(s))
  const odd = oddHourLiars(g).filter((s) => cands.includes(s))
  const flagged = contradictedSuspects(g).filter((s) => cands.includes(s))
  const guess = cands.length === 1 ? cands[0]!
    : guessRng ? pick(guessRng, cands.length ? cands : [...SUSPECTS])
    : (reactedList[0] ?? odd[0] ?? flagged[0] ?? cands[0] ?? 'S1')

  // **도구는 검시 소견 카드를 쥔 사람만 판독한다.** 카드의 흔적 서술이 도구와 1:1 이므로
  // (WEAPON_TRACE), 카드를 쥐었다는 조건 아래에서만 case.weapon 을 읽는다 — 없으면 찍는다.
  const hasAutopsy = g.case.evidence.some((e) => e.kind === 'autopsy' && g.cards.includes(e.id))
  const weaponGuess = hasAutopsy ? g.case.weapon : WEAPONS[0]

  // **동기는 대화한 사람의 것만 안다.** 지목 시트의 동기 목록은 익명이라,
  // 그 사람과 대화해 사정을 들었을 때에만 지목 대상의 동기를 고를 수 있다는 가정이다.
  const talked = met ?? new Set<SuspectId>()
  const motiveGuess = talked.has(guess)
    ? g.case.suspects[guess].motive
    : g.case.suspects[SUSPECTS[0]!].motive   // 아무 사정이나 찍는다

  const r = submit(g, { culprit: guess, motive: motiveGuess, weapon: weaponGuess })
  log.push(
    `제출 — 범인:${g.case.suspects[guess].name} / 동기:${talked.has(guess) ? '대화 근거' : '추측'} / 도구:${hasAutopsy ? '검시 판독' : '추측'}` +
    ` → 범인 ${r.correct.culprit ? '적중' : '오답'} · 동기 ${r.correct.motive ? '적중' : '오답'} · 도구 ${r.correct.weapon ? '적중' : '오답'}` +
    ` · 점수 ${r.total} = 범인 ${r.breakdown.culprit}(후보 ${r.candidatesLeft}명 남음)` +
    ` + 동기 ${r.breakdown.motive} + 도구 ${r.breakdown.weapon}` +
    ` + 잔여조사 ${r.breakdown.efficiency} + 통찰 ${r.breakdown.insight}`,
  )
  return {
    seed, bot, won: r.correct.culprit,
    actionsUsed,
    contradictions: g.foundContradictions.length,
    submitted: guess, culprit: g.case.culprit, log,
  }
}

/** ① 무작위 봇 — 하한선. 운으로 몇 %나 풀리는가 */
export function randomBot(c: CaseFile, rng: Rng, budget?: number): PlayResult {
  const log: string[] = []
  let g = createGame(c, budget)
  let actions = 0
  const met = new Set<SuspectId>()

  // ── 1장: 현장 — 예산을 전부 무작위 조회에 쓴다 ──
  while (g.investigationsLeft > 0) {
    const recs = visible(g)
    if (!recs.length) break
    const r = pick(rng, recs)
    g = lookupEvidence(g, r.id); actions++; log.push(`조회 ${r.id}`)
    g = connectAll(g)
  }

  // ── 2장: 심문 — 무작위 대화 3~10회. 상한(인당 10회)은 넘길 수 없다 ──
  const talkBudget = randInt(rng, 3, 10)
  for (let i = 0; i < talkBudget; i++) {
    const able = SUSPECTS.filter((s) => talksLeft(g, s) > 0)
    if (!able.length) break
    const s = pick(rng, able)
    const owned = g.cards.filter((id) => c.evidence.some((e) => e.id === id))
    if (rng.next() < 0.65 || !owned.length) {
      g = interview(g, s); log.push(`심문 ${s}`)
    } else {
      g = presentEvidence(g, pick(rng, owned), s); log.push(`제시 →${s}`)
    }
    met.add(s); actions++
    g = connectAll(g)
    // 해금된 기록(선행 조건이 있던 것)은 무료로 열린다 — 무작위 봇도 절반은 집는다
    const unlocked = availableEvidence(g).filter((e) => e.requires.length > 0)
    if (unlocked.length && rng.next() < 0.5) {
      const u = unlocked[0]!
      g = lookupEvidence(g, u.id); actions++; log.push(`조회 ${u.id}`)
      g = connectAll(g)
    }
  }
  return finish(g, c.seed, 'random', log, actions, undefined, met, rng)
}

/**
 * ② 상식 봇 — 이게 핵심 지표. 사람이 할 법한 순서로 챕터를 밟는다:
 *   1장(현장 5회): 검시 소견 → 겹치는 알리바이의 범행시각 기록 → 직전 시각 기록
 *   2장(심문): 모순자 심문 → 증거 제시 → 해금 기록 무료 조회 → 남은 사람 심문(증언 수집)
 */
export function commonsenseBot(c: CaseFile, rng: Rng, budget?: number): PlayResult {
  const log: string[] = []
  let g = connectAll(createGame(c, budget))
  let actions = 0
  const interviewed = new Set<SuspectId>()
  const presented = new Set<string>()
  /** 증거를 들이밀었을 때 실제로 무언가 열린 사람 — 가장 강한 단서 */
  const reacted = new Set<SuspectId>()

  // 같은 장소를 주장한 인원이 많은 순 — 겹치면 둘 중 하나는 거짓이다
  const claimCount = new Map<PlaceId, number>()
  for (const s of SUSPECTS) {
    const p = c.suspects[s].claim[CRIME_SLOT]!
    claimCount.set(p, (claimCount.get(p) ?? 0) + 1)
  }

  // ── 1장: 현장 조사 — 예산 5회를 정해진 우선순위로 쓴다 ──
  // ① 검시 소견(도구 축 15점의 근거) ② 범행 시각 알리바이(사람을 지우는 유일한 기록)
  // ③ 범행에 가까운 다른 시각(사슬의 시작점) ④ 남는 것
  while (g.investigationsLeft > 0) {
    const recs = visible(g)
    if (!recs.length) break
    const autopsy = recs.find((r) => r.kind === 'autopsy')
    const alibi = recs
      .filter((r) => r.slot === CRIME_SLOT && r.kind !== 'autopsy')
      .sort((a, b) => (claimCount.get(b.place) ?? 0) - (claimCount.get(a.place) ?? 0))
    const odd = recs
      .filter((r) => r.slot !== CRIME_SLOT)
      .sort((a, b) => Math.abs(a.slot - CRIME_SLOT) - Math.abs(b.slot - CRIME_SLOT))
    const target = autopsy ?? alibi[0] ?? odd[0] ?? recs[0]!
    g = lookupEvidence(g, target.id); actions++
    log.push(`조회 ${target.id} [${evLabel(c, target.id)}]${target.kind === 'autopsy' ? ' — 검시' : target.slot === CRIME_SLOT ? ' — 알리바이' : ' — 사슬 탐색'}`)
    g = connectAll(g)
  }

  // ── 2장: 심문 — 대화는 넉넉하지만(인당 10회) 낭비하지 않는다 ──
  for (let guard = 0; guard < 60; guard++) {
    // 0) 해금된 기록이 있으면 즉시 집는다 — 자물쇠를 여는 값은 이미 치렀다 (무료)
    const unlocked = availableEvidence(g).filter((e) => e.requires.length > 0)
    if (unlocked.length) {
      const u = unlocked[0]!
      g = lookupEvidence(g, u.id); actions++
      log.push(`조회 ${u.id} [${evLabel(c, u.id)}] — 해금됨`)
      g = connectAll(g); continue
    }

    // 1) 범행 시각 밖 모순자를 최우선으로 심문한다 (범인의 흔적)
    const odd = oddHourLiars(g).filter((s) => !interviewed.has(s) && talksLeft(g, s) > 0)
    const flagged = odd.length ? odd
      : contradictedSuspects(g).filter((s) => !interviewed.has(s) && talksLeft(g, s) > 0)
    if (flagged.length) {
      const s = flagged[0]!
      g = interview(g, s); interviewed.add(s); actions++
      log.push(`심문 ${s} [${c.suspects[s].name}] — 모순 대상`)
      g = connectAll(g); continue
    }

    // 2) 범행 시각 밖 기록에 찍힌 사람을 심문한다 — 확정 위치와 진술을 맞대기 위해
    const oddHourSeen = g.case.evidence
      .filter((e) => g.cards.includes(e.id) && e.slot !== CRIME_SLOT)
      .flatMap((e) => e.subjects)
      .filter((x) => !interviewed.has(x) && talksLeft(g, x) > 0)
    if (oddHourSeen.length) {
      const s = oddHourSeen[0]!
      g = interview(g, s); interviewed.add(s); actions++
      log.push(`심문 ${s} [${c.suspects[s].name}] — 범행시각 밖 기록에 찍힘`)
      g = connectAll(g); continue
    }

    // 3) 모순이 걸린 사람들에게 차례로 증거를 들이민다 — 반응이 곧 판별이다 (ADR 008)
    const targets = oddHourLiars(g).length ? oddHourLiars(g) : contradictedSuspects(g)
    let pushed = false
    for (const t of targets) {
      if (talksLeft(g, t) <= 0) continue
      const evForHim = g.foundContradictions
        .filter((k) => k.split('|')[1] === t)
        .map((k) => k.split('|')[0]!)
        .filter((id) => !presented.has(`${id}|${t}`))
        .sort((a, b) => {
          const ea = c.evidence.find((e) => e.id === a)!
          const eb = c.evidence.find((e) => e.id === b)!
          const rank = (e: typeof ea) => (e.slot === CRIME_SLOT ? 9 : Math.abs(e.slot - CRIME_SLOT))
          return rank(ea) - rank(eb)
        })[0]
      if (!evForHim) continue
      presented.add(`${evForHim}|${t}`)
      const before = g.cards.length
      g = presentEvidence(g, evForHim, t); actions++
      const yielded = g.cards.length > before
      if (yielded) reacted.add(t)
      log.push(`제시 ${evForHim} [${evLabel(c, evForHim)}] → ${c.suspects[t].name}${yielded ? ' ★반응' : ' (무반응)'}`)
      g = connectAll(g); pushed = true
      break
    }
    if (pushed) continue

    // 4) 아직 안 만난 사람을 심문한다 — 잠긴 기록의 자물쇠는 목격자 증언을 요구한다 (ADR 008)
    const fresh = SUSPECTS.filter((s) => !interviewed.has(s) && talksLeft(g, s) > 0)
    if (fresh.length) {
      const s = pick(rng, fresh)
      g = interview(g, s); interviewed.add(s); actions++
      log.push(`심문 ${s} [${c.suspects[s].name}] — 탐색`)
      g = connectAll(g); continue
    }

    // 할 수 있는 생산적 행동이 없다 — 대화를 소진하는 것은 플레이가 아니라 낭비다 (ADR 022 §2)
    break
  }
  const met = new Set<SuspectId>([...interviewed, ...reacted])
  return finish(g, c.seed, 'commonsense', log, actions, reacted, met)
}

/** ③ 완벽 봇 — 상한선. BFS 최적 경로를 그대로 밟는다 */
export function optimalBot(c: CaseFile, path: string[]): PlayResult {
  const log: string[] = []
  let g = createGame(c)
  let actions = 0
  const met = new Set<SuspectId>()
  for (const step of path) {
    const [kind, arg] = step.split(':') as [string, string]
    if (kind === '조회') g = lookupEvidence(g, arg)
    else if (kind === '심문') { g = interview(g, arg as SuspectId); met.add(arg as SuspectId) }
    else if (kind === '제시') {
      const [ev, s] = arg.split('→') as [string, string]
      g = presentEvidence(g, ev, s as SuspectId)
      met.add(s as SuspectId)
    }
    actions++
    log.push(step)
    g = connectAll(g)
  }
  return finish(g, c.seed, 'optimal', log, actions, undefined, met)
}

export const botRng = (seed: number): Rng => makeRng(seed ^ 0x5bf03635)
export { shuffle }
