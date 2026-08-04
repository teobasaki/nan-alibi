/**
 * 사건 생성기 — 결정론. 시드 하나가 사건 하나를 완전히 결정한다.
 *
 * 설계 원칙 (llm-persona-game 스킬 §1 소유권 분리):
 *   여기서 만든 것이 **진실**이다. LLM 은 이 진실을 연기할 뿐 만들지 않는다.
 *
 * 이 함수는 "그럴듯한" 사건을 제안할 뿐 **보증하지 않는다.**
 * 유일해·해결 가능성 보증은 validate.ts + solver.ts 의 몫이고,
 * 통과 못 한 시드는 generateValidCase() 가 다음 시드로 재생성한다.
 */

import {
  CRIME_PLACE,
  CRIME_SLOT,
  SLOTS,
  SUSPECTS,
  type CaseFile,
  type Evidence,
  type PlaceId,
  type PresentUnlock,
  type Slot,
  type Suspect,
  type SuspectId,
  type Testimony,
  type Trajectory,
} from '../types'
import { METHODS, MOTIVES, NOISE_EVIDENCE_MAX, NOISE_EVIDENCE_MIN, SECRETS } from '../data/config'
import { makeRng, pick, randInt, sample, shuffle, type Rng } from './rng'

/** 범행 현장이 아닌 장소들 — 무고한 사람들이 배치되는 곳 */
const NON_CRIME_PLACES: PlaceId[] = [0, 1, 3, 4]

const APPROACH_PLACE: PlaceId = 1 // 복도 — 범인이 현장 직전에 지나는 곳
const ESCAPE_PLACE: PlaceId = 3 // 직원계단 — 범인의 도주로

function otherPlace(rng: Rng, not: PlaceId): PlaceId {
  return pick(rng, NON_CRIME_PLACES.filter((p) => p !== not))
}

/** 범인의 실제 궤적: 접근 → 범행 → 도주 (플레이어가 나중에 타임라인으로 재구성하게 될 모양) */
function culpritTruth(rng: Rng): Trajectory {
  return [pick(rng, NON_CRIME_PLACES), APPROACH_PLACE, CRIME_PLACE, ESCAPE_PLACE, pick(rng, NON_CRIME_PLACES)]
}

/**
 * 무고한 사람의 궤적. 범행 시각 위치(anchor)는 호출자가 지정한다 —
 * 서로 다른 장소에 흩어놓아야 "한 번의 CCTV 조회로 4명이 한꺼번에 풀리는" 지름길이 안 생긴다.
 */
function innocentTruth(rng: Rng, anchor: PlaceId): Trajectory {
  const t: PlaceId[] = []
  for (const s of SLOTS) {
    t.push(s === CRIME_SLOT ? anchor : pick(rng, NON_CRIME_PLACES))
  }
  return t as Trajectory
}

export function generateCase(seed: number): CaseFile {
  const rng = makeRng(seed)

  const culprit = pick(rng, SUSPECTS)
  const innocents = SUSPECTS.filter((s) => s !== culprit)

  // --- 궤적 (진실) ---
  // 무고한 4명을 범행 시각에 서로 다른 장소로 흩는다. 가끔 2명을 같은 곳에 묶어 CCTV 다인 기록을 만든다.
  const anchors = shuffle(rng, NON_CRIME_PLACES)
  const pairUp = rng.next() < 0.45
  const anchorOf: Record<string, PlaceId> = {}
  innocents.forEach((s, i) => {
    anchorOf[s] = pairUp && i === 1 ? anchors[0]! : anchors[i]!
  })

  const suspects = {} as Record<SuspectId, Suspect>
  for (const s of SUSPECTS) {
    const truth = s === culprit ? culpritTruth(rng) : innocentTruth(rng, anchorOf[s]!)
    suspects[s] = {
      id: s,
      isCulprit: s === culprit,
      truth,
      claim: [...truth] as Trajectory,
      lieSlots: [],
      lieReason: '',
      testimonies: [],
    }
  }

  // --- 거짓말 ---
  // 범인은 범행 시각(필수)과 접근 시각(1)을 거짓말한다.
  // 접근 시각 거짓말이 있어야 "증거 제시 → 자백성 진술 해금" 사슬이 성립한다.
  {
    const k = suspects[culprit]
    for (const slot of [1, CRIME_SLOT] as Slot[]) {
      k.claim[slot] = otherPlace(rng, k.truth[slot]!)
      k.lieSlots.push(slot)
    }
    k.lieReason = '범인이기 때문에'
  }

  // 무고한 사람 중 2~3명이 개인 비밀 때문에 거짓말한다 (V6).
  // 이게 없으면 "거짓말하는 사람 = 범인" 이 되어 추리가 사라진다.
  const liarCount = randInt(rng, 2, 3)
  for (const s of sample(rng, innocents, liarCount)) {
    const sus = suspects[s]
    const slot = pick(rng, SLOTS)
    sus.claim[slot] = otherPlace(rng, sus.truth[slot]!)
    sus.lieSlots.push(slot)
    sus.lieReason = pick(rng, SECRETS)
  }

  // --- 증언 ---
  const testimonies: Testimony[] = []
  const presentUnlocks: PresentUnlock[] = []

  // 각 무고한 사람은 심문하면 자기 궤적을 상술하는 증언을 하나 준다 (해금 열쇠는 아니다)
  for (const s of innocents) {
    const id = `T-${s}`
    testimonies.push({ id, from: s, about: null, text: `${s}의 상세 진술` })
    suspects[s].testimonies.push(id)
  }

  // 결정적 사슬: 범인에게 [접근 시각 물증] 을 제시하면 → 자백성 진술이 열리고 → 결정적 증거 조회가 열린다
  const slipId = 'T-SLIP'
  testimonies.push({
    id: slipId,
    from: culprit,
    about: culprit,
    text: '증거 앞에서 무너지며 흘린 진술',
  })

  // --- 물증 ---
  const evidence: Evidence[] = []
  let n = 0
  const evId = () => `E${++n}`

  // ① 접근 시각 물증 (사슬의 시작점) — 즉시 조회 가능. 범인의 슬롯1 거짓말과 충돌한다.
  const anchorEv: Evidence = {
    id: evId(),
    kind: 'cctv',
    slot: 1,
    place: suspects[culprit].truth[1]!,
    subjects: [culprit],
    decisive: false,
    requires: [],
  }
  evidence.push(anchorEv)
  presentUnlocks.push({ evidenceId: anchorEv.id, suspectId: culprit, yieldsTestimonyId: slipId })

  // ② 결정적 증거 — 범행 시각 현장의 범인. 자백성 진술이 열려야 조회 가능 (V5 하한 보장)
  const decisive: Evidence = {
    id: evId(),
    kind: 'keycard',
    slot: CRIME_SLOT,
    place: CRIME_PLACE,
    subjects: [culprit],
    decisive: true,
    requires: [slipId],
  }
  evidence.push(decisive)

  // ③ 알리바이 물증 — 범행 시각, 무고한 사람들의 실제 위치를 확정한다.
  //    같은 장소에 있던 사람들은 하나의 CCTV 기록으로 묶인다.
  const byPlace = new Map<PlaceId, SuspectId[]>()
  for (const s of innocents) {
    const p = suspects[s].truth[CRIME_SLOT]!
    byPlace.set(p, [...(byPlace.get(p) ?? []), s])
  }
  for (const [place, group] of byPlace) {
    evidence.push({
      id: evId(),
      kind: group.length > 1 ? 'cctv' : pick(rng, ['keycard', 'call', 'receipt'] as const),
      slot: CRIME_SLOT,
      place,
      subjects: group,
      decisive: false,
      requires: [],
    })
  }

  // ④ 잡음 — 사건과 무관한 시각의 진짜 기록. 조사 횟수를 낭비시키는 함정.
  const noise = randInt(rng, NOISE_EVIDENCE_MIN, NOISE_EVIDENCE_MAX)
  for (let i = 0; i < noise; i++) {
    const s = pick(rng, innocents)
    const slot = pick(rng, SLOTS.filter((x) => x !== CRIME_SLOT))
    evidence.push({
      id: evId(),
      kind: pick(rng, ['receipt', 'call', 'keycard'] as const),
      slot,
      place: suspects[s].truth[slot]!,
      subjects: [s],
      decisive: false,
      requires: [],
    })
  }

  return {
    seed,
    culprit,
    motive: pick(rng, MOTIVES),
    method: pick(rng, METHODS),
    suspects,
    evidence,
    testimonies,
    presentUnlocks,
    decisiveEvidenceId: decisive.id,
  }
}
