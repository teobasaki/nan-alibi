/**
 * 교차 대조 — **기록 노동은 시스템이 지고, 판단은 플레이어가 한다.**
 *
 * ## 왜 필요한가
 * 초회 플레이 피드백(QA 5.4)의 진단은 "기억력이 부족하다" 가 아니라
 * **"정보가 비교하기 쉬운 형태로 정리되지 않았다"** 였다. 다섯 사람 × 다섯 시각의
 * 진술과 물증이 대화 로그와 카드 더미에 흩어져 있으니, 플레이어가 머릿속에서
 * 표를 다시 그리다가 추리할 시간을 다 썼다.
 *
 * ## 무엇을 하고 무엇을 하지 않는가
 * **한다**: 흩어진 것을 모아 같은 축에 놓는다 (누가 어디에 있었다고 하는가, 기록은 무엇을 확정하는가).
 * **하지 않는다**: 모순인지 아닌지 말하지 않는다. 그건 `connect()` 가 하는 일이고,
 * 그 판정을 미리 흘리면 이 게임의 유일한 추론 행위가 사라진다.
 *
 * 그래서 `pendingPairs()` 는 "이 둘은 **아직 안 맞춰봤다**" 까지만 말한다.
 * 맞춰봤을 때 무슨 일이 나는지는 끝까지 플레이어의 몫이다.
 */

import {
  CRIME_SLOT, PLACES, SLOTS, SUSPECTS,
  type PlaceId, type Slot, type SuspectId,
} from '../types'
import { claimCardId, type GameState } from './game'

/** 장소 × 시각 표의 한 칸. */
export interface PlaceCell {
  /** 그 칸에 있었다고 **주장한** 사람 — 진술 카드를 확보한 경우만 */
  claimants: SuspectId[]
  /** 그 칸에 있었음이 **기록으로 확정된** 사람 */
  pinned: SuspectId[]
  /** 그 칸을 덮는 보유 기록 id */
  records: string[]
  /**
   * 그중 하나라도 '남김없는' 기록인가 (CCTV 는 구역 전체를 담는다).
   * true 면 **여기 없는 이름은 그 시각 여기 없었다**는 뜻이 된다 — 부재 모순의 근거.
   */
  exhaustive: boolean
}

/**
 * 장소 × 시각 격자. `[장소][시각]` 순서다.
 *
 * 인물 × 시각 격자(알리바이 대조표)와 **같은 사실의 축을 뒤집은 것**이다.
 * 뒤집으면 인물 격자가 못 보여주던 것이 보인다 — 누가 누구와 같은 자리에 있었다고
 * 주장하는가, 그리고 **한 사람의 이름이 같은 세로줄에 두 번 나오는가.**
 * 두 번 나오면 둘 중 하나는 거짓이다. 그 사실을 표가 말해주는 게 아니라 눈이 본다.
 */
export function placeMatrix(g: GameState): PlaceCell[][] {
  const c = g.case
  const held = new Set(g.cards)

  return PLACES.map((p: PlaceId) =>
    SLOTS.map((t: Slot): PlaceCell => {
      // 진술은 **카드를 확보한 것만** 쓴다. 심문 전에 남의 궤적이 보이면 안 된다.
      const claimants = SUSPECTS.filter(
        (s) => held.has(claimCardId(s, t)) && c.suspects[s].claim[t] === p,
      )
      const recs = c.evidence.filter((e) => held.has(e.id) && e.slot === t && e.place === p)
      const pinned = [...new Set(recs.flatMap((e) => e.subjects))]
      return {
        claimants,
        pinned,
        records: recs.map((e) => e.id),
        exhaustive: recs.some((e) => e.exhaustive),
      }
    }),
  )
}

/** 아직 맞대보지 않은 (기록 ↔ 진술) 조합. */
export interface PendingPair {
  evidenceId: string
  claimCardId: string
  suspect: SuspectId
  slot: Slot
}

/**
 * **비교할 수 있는데 아직 안 해본** 조합을 모은다.
 *
 * 모순인지는 말하지 않는다 — 같은 시각을 다루는 기록과 진술을 둘 다 손에 쥐고 있고
 * 아직 연결해보지 않았다는 **사실만** 말한다. 이건 판정이 아니라 장부 정리다.
 * 연결은 조사를 소모하지 않으므로, 이 목록을 다 지우는 것은 언제나 이득이다.
 *
 * 범행 시각을 먼저 올린다 — 사람을 지우는 것은 그 시각의 기록뿐이다.
 */
export function pendingPairs(g: GameState): PendingPair[] {
  const held = new Set(g.cards)
  const done = new Set(g.connections.map(([a, b]) => [a, b].sort().join('~')))
  const out: PendingPair[] = []

  for (const e of g.case.evidence) {
    if (!held.has(e.id)) continue
    // 검시 소견은 인물 위치를 확정하지 않는다 (subjects 없음 · exhaustive 아님) —
    // 어떤 진술과도 모순이 성립할 수 없으므로 장부에 올리면 그 줄 전부가 소음이다.
    if (e.kind === 'autopsy') continue
    for (const s of SUSPECTS) {
      const cid = claimCardId(s, e.slot)
      if (!held.has(cid)) continue
      if (done.has([e.id, cid].sort().join('~'))) continue
      out.push({ evidenceId: e.id, claimCardId: cid, suspect: s, slot: e.slot })
    }
  }

  return out.sort((a, b) => {
    const pa = a.slot === CRIME_SLOT ? 0 : 1
    const pb = b.slot === CRIME_SLOT ? 0 : 1
    return pa - pb || a.slot - b.slot
  })
}
