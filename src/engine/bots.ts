/**
 * 플레이 봇 — "6회가 적절한가" 를 감이 아니라 승률로 답하기 위한 도구.
 * starcraft 에서 밸런스를 잡았던 방식(약·강 봇 양끝으로 검증)을 이 장르에 옮긴 것.
 *
 * ⚠️ 공정성 규칙: 봇은 **플레이어가 화면에서 볼 수 있는 것만** 읽는다.
 *   - 조회 전 물증의 `subjects` 를 보면 안 된다 (화면엔 종류·시각·장소만 나온다)
 *   - `truth` · `culprit` · `decisive` · `presentUnlocks` 를 보면 안 된다
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
  availableEvidence, claimCardId, connect, createGame, interview,
  lookupEvidence, presentEvidence, submit, type GameState,
} from './game'
import { makeRng, pick, shuffle, type Rng } from './rng'
import { INVESTIGATION_BUDGET, KEY_LABEL, METHODS } from '../data/config'

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

function finish(g: GameState, seed: number, bot: string, log: string[], reacted?: Set<SuspectId>): PlayResult {
  const cands = candidatesVisible(g)
  // 우선순위: ① 후보 1명으로 확정 ② 증거에 반응한 사람 ③ 범행시각 밖 모순자 ④ 아무 모순자 ⑤ 남은 후보
  const reactedList = [...(reacted ?? [])].filter((s) => cands.includes(s))
  const odd = oddHourLiars(g).filter((s) => cands.includes(s))
  const flagged = contradictedSuspects(g).filter((s) => cands.includes(s))
  const guess = cands.length === 1 ? cands[0]!
    : (reactedList[0] ?? odd[0] ?? flagged[0] ?? cands[0] ?? 'S1')
  // 결정적 증거는 "범행 시각 · 범행 현장" 기록이다 — 카드 앞면에 다 적혀 있다.
  // 이전에는 마지막 획득 카드를 냈는데, 그건 봇의 실수지 게임의 결함이 아니었다 (ADR 010).
  // **UI 와 같은 제약을 건다** — 제출 화면은 범행 시각 기록만 고를 수 있다.
  // 봇이 22:10 기록을 제출하는 로그가 남아 자동 리뷰가 blocker 로 올렸다. 정당한 지적이었다:
  // 봇이 화면 규칙을 우회하면 그 로그는 게임을 대표하지 못한다.
  const ownedEv = g.case.evidence.filter((e) => g.cards.includes(e.id) && e.slot === CRIME_SLOT)
  const atScene = ownedEv.find((e) => e.place === CRIME_PLACE)
  // **수단도 정직하게 판독한다.** 예전엔 `g.case.method` 를 그대로 제출해 항상 적중했고,
  // 그 로그가 "수단은 근거 없이 맞는다" 는 착시를 만들었다. 결정적 증거를 쥐었으면
  // 카드의 발급 구분에서 읽고, 없으면 첫 후보를 찍는다 — 사람과 같은 조건이다.
  const decisiveCard = g.case.evidence.find((e) => e.decisive && g.cards.includes(e.id))
  const readMethod = decisiveCard
    ? (METHODS.find((m) => KEY_LABEL[m] === decisiveCard.keyLabel) ?? METHODS[0])
    : METHODS[0]
  const r = submit(g, {
    culprit: guess,
    method: readMethod,
    decisiveEvidenceId: (atScene ?? ownedEv[ownedEv.length - 1])?.id ?? '',
  })
  log.push(
    `제출 — 범인:${g.case.suspects[guess].name} / 수단:${readMethod}${decisiveCard ? '(카드 판독)' : '(추측)'} / 결정적증거:${(() => { const d = atScene ?? ownedEv[ownedEv.length - 1]; return d ? `${d.id} [${evLabel(g.case, d.id)}]` : '(없음)' })()}` +
    ` → 범인 ${r.correct.culprit ? '적중' : '오답'} · 수단 ${r.correct.method ? '적중' : '오답'} · 증거 ${r.correct.decisive ? '적중' : '오답'}` +
    ` · 점수 ${r.total} (후보 ${cands.length}명 남음)`,
  )
  return {
    seed, bot, won: r.correct.culprit,
    actionsUsed: (g.case.evidence.length, INVESTIGATION_BUDGET) - g.investigationsLeft,
    contradictions: g.foundContradictions.length,
    submitted: guess, culprit: g.case.culprit, log,
  }
}

/** ① 무작위 봇 — 하한선. 운으로 몇 %나 풀리는가 */
export function randomBot(c: CaseFile, rng: Rng, budget?: number): PlayResult {
  const log: string[] = []
  let g = createGame(c, budget)
  while (g.investigationsLeft > 0) {
    const recs = visible(g)
    const roll = rng.next()
    if (roll < 0.4 && recs.length) {
      const r = pick(rng, recs); g = lookupEvidence(g, r.id); log.push(`조회 ${r.id}`)
    } else if (roll < 0.8) {
      const s = pick(rng, SUSPECTS); g = interview(g, s); log.push(`심문 ${s}`)
    } else {
      const owned = g.cards.filter((id) => c.evidence.some((e) => e.id === id))
      if (!owned.length) { const s = pick(rng, SUSPECTS); g = interview(g, s); log.push(`심문 ${s}`); continue }
      const s = pick(rng, SUSPECTS); g = presentEvidence(g, pick(rng, owned), s); log.push(`제시 →${s}`)
    }
    g = connectAll(g)
  }
  return finish(g, c.seed, 'random', log)
}

/**
 * ② 상식 봇 — 이게 핵심 지표. 사람이 할 법한 순서로 둔다:
 *   1) 겹치는 알리바이부터 의심해 그 장소의 범행시각 기록을 연다
 *   2) 열 때마다 전부 연결해 본다 (무료)
 *   3) 모순이 걸린 사람을 심문해 전체 궤적을 본다
 *   4) 그 사람에게 그 증거를 들이민다
 *   5) 새로 열린 기록을 조회한다
 */
export function commonsenseBot(c: CaseFile, rng: Rng, budget?: number): PlayResult {
  const log: string[] = []
  let g = connectAll(createGame(c, budget))
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

  let lookedUp = 0
  while (g.investigationsLeft > 0) {
    const recs = visible(g)
    // 범행 시각 밖 모순자를 최우선으로 본다 (범인의 흔적)
    const odd = oddHourLiars(g).filter((s) => !interviewed.has(s))
    const flagged = odd.length ? odd : contradictedSuspects(g).filter((s) => !interviewed.has(s))

    // 3) 모순이 걸렸는데 아직 안 만나본 사람 → 심문
    if (flagged.length) {
      const s = flagged[0]!
      g = interview(g, s); interviewed.add(s); log.push(`심문 ${s} [${c.suspects[s].name}] — 모순 대상`)
      g = connectAll(g); continue
    }

    // 3-b) **범행 시각이 아닌 기록에 찍힌 사람을 심문한다.**
    //   조회 후에는 누가 찍혔는지 보인다 — 이건 플레이어도 보는 정보다.
    //   범행 시각 밖 기록에 이름이 있다는 건 "그 시간에 거기 있었다" 가 확정됐다는 뜻이고,
    //   본인 진술과 맞춰보면 바로 갈린다. 봇이 이 정보를 안 쓰고 있었다 (ADR 007).
    const oddHourSeen = g.case.evidence
      .filter((e) => g.cards.includes(e.id) && e.slot !== CRIME_SLOT)
      .flatMap((e) => e.subjects)
      .filter((x) => !interviewed.has(x))
    if (oddHourSeen.length) {
      const s = oddHourSeen[0]!
      g = interview(g, s); interviewed.add(s); log.push(`심문 ${s} [${c.suspects[s].name}] — 범행시각 밖 기록에 찍힘`)
      g = connectAll(g); continue
    }

    // 4) **모순이 걸린 사람들에게 차례로 증거를 들이민다.**
    //   증거 순서 무작위화 이후 "먼저 걸린 모순 = 범인" 이 사라졌다.
    //   남은 판별법은 하나뿐이다 — **직접 들이밀고 반응을 본다.**
    //   무언가 열리면(카드가 늘면) 그 사람이 핵심이고, 아니면 조사 1회를 잃는다.
    //   이게 이 게임이 의도한 자원 소모다 (ADR 008).
    const targets = oddHourLiars(g).length ? oddHourLiars(g) : contradictedSuspects(g)
    let pushed = false
    // 들이밀 카드는 **범행 직전 시각 기록**을 우선한다.
    // 범행 시각 알리바이는 "그때 거기 없었다" 일 뿐이고, 사건을 여는 건 접근 흔적이다.
    for (const t of targets) {
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
      g = presentEvidence(g, evForHim, t)
      const yielded = g.cards.length > before
      if (yielded) reacted.add(t)
      log.push(`제시 ${evForHim} [${evLabel(c, evForHim)}] → ${c.suspects[t].name}${yielded ? ' ★반응' : ' (무반응)'}`)
      g = connectAll(g); pushed = true
      break
    }
    if (pushed) continue

    // 5) 새로 열린 기록(선행 조건이 있던 것)이 있으면 최우선
    const unlocked = recs.filter((r) => c.evidence.find((e) => e.id === r.id)!.requires.length > 0)
    if (unlocked.length) {
      const r = unlocked[0]!
      g = lookupEvidence(g, r.id); log.push(`조회 ${r.id} [${evLabel(c, r.id)}] — 해금됨`)
      g = connectAll(g); continue
    }

    // 1-a) **심문한 사람의 나머지 시각을 검증한다.**
    //   범행 시각 거짓말은 다들 하니 잡음이다. 범인의 흔적은 *다른* 시각에 있다.
    //   심문으로 전체 궤적을 확보했으면, 그 사람이 주장한 다른 시각·장소의 기록을 연다.
    const crossCheck = recs.filter((r) =>
      r.slot !== CRIME_SLOT &&
      [...interviewed].some((s) => c.suspects[s].claim[r.slot] === r.place),
    )
    if (interviewed.size > 0 && crossCheck.length) {
      const r = crossCheck[0]!
      g = lookupEvidence(g, r.id); log.push(`조회 ${r.id} [${evLabel(c, r.id)}] — 교차검증`)
      g = connectAll(g); continue
    }

    // 1-a2) 아직 아무 기록도 없으면 **범행 시각 밖 기록** 을 하나 연다.
    //   범행 시각 기록은 알리바이 확인(소거)에 쓰이고, 그 밖의 기록은 사슬의 시작점이 된다.
    if (lookedUp === 0) {
      // **범행 직전 시각을 최우선으로 본다.** 사람이라면 "살해 10분 전" 부터 뒤진다.
      // 잡음 기록은 아무 시각에나 흩어져 있지만, 범인의 접근 흔적은 직전 시각에 있다.
      const odd0 = recs
        .filter((r) => r.slot !== CRIME_SLOT)
        .sort((a, b) => Math.abs(a.slot - CRIME_SLOT) - Math.abs(b.slot - CRIME_SLOT))
      if (odd0.length) {
        const r = odd0[0]!
        g = lookupEvidence(g, r.id); lookedUp++
        log.push(`조회 ${r.id} [${evLabel(c, r.id)}] — 사슬 탐색`)
        g = connectAll(g); continue
      }
    }

    // 1-b) 범행 시각 · 누군가 주장한 장소 기록을 연다. 겹치는 장소부터.
    const alibi = recs
      .filter((r) => r.slot === CRIME_SLOT && (claimCount.get(r.place) ?? 0) > 0)
      .sort((a, b) => (claimCount.get(b.place) ?? 0) - (claimCount.get(a.place) ?? 0))
    if (alibi.length) {
      const r = alibi[0]!
      g = lookupEvidence(g, r.id); lookedUp++
      log.push(`조회 ${r.id} [${evLabel(c, r.id)}] — 이 장소를 주장한 사람 ${claimCount.get(r.place)}명`)
      g = connectAll(g); continue
    }

    // 막히면 안 만나본 사람을 심문
    const fresh = SUSPECTS.filter((s) => !interviewed.has(s))
    if (fresh.length) {
      const s = pick(rng, fresh)
      g = interview(g, s); interviewed.add(s); log.push(`심문 ${s} [${c.suspects[s].name}] — 탐색`)
      g = connectAll(g); continue
    }
    if (recs.length) { const r = pick(rng, recs); g = lookupEvidence(g, r.id); log.push(`조회 ${r.id} (탐색)`); g = connectAll(g); continue }
    break
  }
  return finish(g, c.seed, 'commonsense', log, reacted)
}

/** ③ 완벽 봇 — 상한선. BFS 최적 경로를 그대로 밟는다 */
export function optimalBot(c: CaseFile, path: string[]): PlayResult {
  const log: string[] = []
  let g = createGame(c)
  for (const step of path) {
    const [kind, arg] = step.split(':') as [string, string]
    if (kind === '조회') g = lookupEvidence(g, arg)
    else if (kind === '심문') g = interview(g, arg as SuspectId)
    else if (kind === '제시') {
      const [ev, s] = arg.split('→') as [string, string]
      g = presentEvidence(g, ev, s as SuspectId)
    }
    log.push(step)
    g = connectAll(g)
  }
  return finish(g, c.seed, 'optimal', log)
}

export const botRng = (seed: number): Rng => makeRng(seed ^ 0x5bf03635)
export { shuffle }
