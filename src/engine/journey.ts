/**
 * 플레이 여정 로그 — **개인화의 재료이지, 개인화가 아니다.**
 *
 * (파일명 주의: `tests/trace.test.ts` 는 *사건*을 추적하는 다른 물건이다.
 *  이건 *플레이어*를 따라간다. QA 보고서의 '사용자 여정' 에서 이름을 가져왔다.)
 *
 * ## 정직하게 먼저
 * 이 모듈은 지금 아무것도 개인화하지 않는다. 난이도를 바꾸지도, 힌트를 조절하지도 않는다.
 * **무엇을 기록해야 나중에 그게 가능한지**를 정하고 그 기록을 남길 뿐이다.
 * 있지도 않은 개인화를 있는 것처럼 부르지 않는다.
 *
 * ## 왜 결과가 아니라 과정을 남기나
 * `GameState` 는 **지금 무엇을 갖고 있는가**만 안다. 그래서 오답 진단이
 * "22:20 기록 4건 중 0건만 확인했다" 까지만 말할 수 있다.
 * 정작 알고 싶은 건 **어떻게 거기 도달했는가**다 — 한 사람만 계속 팠는지,
 * 격자를 한 번도 안 봤는지, 모순을 찾고도 다른 사람을 지목했는지.
 * 그건 상태에 안 남는다. 지나가면 사라진다.
 *
 * ## 무엇을 남기지 않는가
 * - **자유 입력 질문 원문을 남기지 않는다.** 개인 식별 가능한 문장이 섞일 수 있고,
 *   성향 분석에는 "무엇을 물었나(정형/자유)" 와 "누구에게" 로 충분하다.
 * - **서버로 보내지 않는다.** 로컬에만 쌓인다. 계정도 사용자 id 도 없다.
 * - 시각은 판 시작 기준 **상대 밀리초**다. 절대 시각은 생활 패턴이 된다.
 *
 * 순수 함수로 둔다 — 저장소는 주입받고, 분류는 상태를 읽어 계산만 한다.
 */

import type { SuspectId } from '../types'

export type TraceEvent =
  /** 기록 조회 */
  | { t: number; k: 'lookup'; ev: string }
  /** 심문 — 질문 원문은 남기지 않는다 */
  | { t: number; k: 'ask'; who: SuspectId; preset: boolean; fallback: boolean }
  /** 증거 제시 */
  | { t: number; k: 'present'; ev: string; who: SuspectId; opened: boolean }
  /** 카드 두 장 연결 (무료 행동) */
  | { t: number; k: 'connect'; hit: boolean }
  /** 상황판 각도 전환 — 이 사람이 어떤 축으로 생각하는지 드러난다 */
  | { t: number; k: 'view'; to: 'time' | 'place' | 'person' }
  /** 인물 선택 */
  | { t: number; k: 'open'; who: SuspectId }
  /** 최종 지목 */
  | { t: number; k: 'submit'; who: SuspectId; correct: boolean; score: number }

/**
 * 시각을 뺀 이벤트. **`Omit<TraceEvent,'t'>` 로 쓰면 안 된다** —
 * `Omit` 은 유니온에 분배되지 않아 모든 갈래의 **공통 키만** 남기고
 * `who`·`ev`·`hit` 같은 갈래별 필드를 통째로 지워버린다.
 * 조건부 타입으로 감싸야 갈래마다 따로 적용된다.
 */
export type TraceInput = TraceEvent extends infer E
  ? E extends { t: number } ? Omit<E, 't'> : never
  : never

export interface Trace {
  seed: number
  /** 판 시작 시각 (절대). 상대 시각을 복원할 때만 쓴다 */
  startedAt: number
  events: TraceEvent[]
}

export const newTrace = (seed: number, now: number): Trace => ({ seed, startedAt: now, events: [] })

/** 이벤트 상한 — 한 판이 아무리 길어도 이 이상은 성향 분석에 보태지 않는다 */
const MAX_EVENTS = 500

export function record(tr: Trace, e: TraceEvent): Trace {
  if (tr.events.length >= MAX_EVENTS) return tr
  return { ...tr, events: [...tr.events, e] }
}

/* ────────────────────────────────────────────────────────────────
 * 여기서부터가 "개인화가 가능해지는" 부분 — 궤적에서 성향을 읽는다.
 * 지금은 읽기만 한다. 무엇을 바꿀지는 아직 정하지 않았다.
 * ──────────────────────────────────────────────────────────────── */

export type Style =
  /** 기록을 먼저 모으고 나중에 사람을 만난다 */
  | '기록파'
  /** 사람을 먼저 만나고 기록으로 확인한다 */
  | '심문파'
  /** 한두 명만 깊게 판다 */
  | '집중형'
  /** 아직 판단할 근거가 부족하다 */
  | '미상'

export interface Profile {
  style: Style
  /** 조사 행동 중 조회 비율 0~1 */
  lookupRatio: number
  /** 심문한 서로 다른 인물 수 */
  peopleAsked: number
  /** 연결을 몇 번 시도했나 — 무료인데 안 쓰면 규칙을 모르는 것이다 */
  connects: number
  /** 상황판 세 각도 중 실제로 본 수 */
  viewsUsed: number
  /** 사람이 읽을 한 줄 — 오답 진단에 붙이면 "왜 놓쳤는지" 가 구체해진다 */
  note: string
}

export function profile(tr: Trace): Profile {
  const e = tr.events
  const lookups = e.filter((x) => x.k === 'lookup').length
  const asks = e.filter((x) => x.k === 'ask')
  const spend = lookups + asks.length + e.filter((x) => x.k === 'present').length
  const people = new Set(asks.map((a) => (a as { who: SuspectId }).who)).size
  const connects = e.filter((x) => x.k === 'connect').length
  const views = new Set(e.filter((x) => x.k === 'view').map((v) => (v as { to: string }).to)).size
  const ratio = spend ? lookups / spend : 0

  let style: Style = '미상'
  if (spend >= 3) {
    if (asks.length >= 2 && people <= 2) style = '집중형'
    else if (ratio >= 0.6) style = '기록파'
    else if (ratio <= 0.35) style = '심문파'
    else style = '미상'
  }

  const notes: string[] = []
  if (connects === 0 && spend >= 3) {
    notes.push('연결을 한 번도 하지 않았다 — 연결은 조사를 소모하지 않는다')
  }
  if (views <= 1 && spend >= 4) {
    notes.push('상황판을 한 각도로만 봤다 — 장소별로 뒤집으면 같은 이름이 두 번 나오는 게 보인다')
  }
  if (style === '집중형') {
    notes.push('한두 명에게 집중했다 — 사람을 지우는 것은 범행 시각의 기록뿐이다')
  }

  return { style, lookupRatio: ratio, peopleAsked: people, connects, viewsUsed: views, note: notes[0] ?? '' }
}

/** 여러 판에 걸친 경향 — **이것이 "개인화 루프" 가 실제로 딛고 설 자리다** */
export function tendency(list: Trace[]): { style: Style; games: number } {
  const played = list.filter((t) => t.events.some((e) => e.k === 'submit'))
  if (played.length === 0) return { style: '미상', games: 0 }
  const counts = new Map<Style, number>()
  for (const t of played) {
    const s = profile(t).style
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  let best: Style = '미상'
  let n = 0
  for (const [s, c] of counts) {
    if (s !== '미상' && c > n) { best = s; n = c }
  }
  return { style: best, games: played.length }
}

/* ── 저장은 여기 없다 ─────────────────────────────────────────
 * `src/engine/` 은 브라우저와 Cloudflare Worker 가 **공유**한다.
 * localStorage 를 여기 두면 Worker 타입체크가 깨진다 — 실제로 깨졌고
 * 커밋 게이트(`typecheck:functions`)가 잡았다. 저장은 플랫폼 관심사이므로
 * `ui/journeyStore.ts` 로 내렸다. 이 파일은 순수 계산만 갖는다.
 *
 * **이 분리는 취향이 아니라 강제다.** 게이트가 없었으면 배포에서 터졌을 것이다.
 * ──────────────────────────────────────────────────────────── */
