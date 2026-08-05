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
import { KEY_LABEL, METHODS, MOTIVES, NOISE_EVIDENCE_MAX, NOISE_EVIDENCE_MIN, SECRETS } from '../data/config'
import { CASE_TITLES, GIVEN_NAMES, ROLES, SURNAMES, VENUES, VICTIMS } from '../data/names'
import { PERSONAS, PERSONA_CONFLICTS } from '../data/personas'
import { makeRng, pick, randInt, sample, shuffle, type Rng } from './rng'

/** 범행 현장이 아닌 장소들 — 무고한 사람들이 배치되는 곳 */
const NON_CRIME_PLACES: PlaceId[] = [0, 1, 3, 4]

const APPROACH_PLACE: PlaceId = 1 // 복도 — 범인이 현장 직전에 지나는 곳
const APPROACH_SLOT: Slot = 1 // 범행 직전 시각
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

  // --- 표면 데이터 (이름·직업·페르소나) ---
  // 페르소나는 충돌 조합(접근법이 겹치는 쌍)을 피해서 5종을 고른다.
  const chosenPersonas: string[] = []
  for (const p of shuffle(rng, PERSONAS.map((x) => x.id))) {
    const clashes = PERSONA_CONFLICTS.some(
      ([a, b]) => (p === a && chosenPersonas.includes(b)) || (p === b && chosenPersonas.includes(a)),
    )
    if (!clashes) chosenPersonas.push(p)
    if (chosenPersonas.length === SUSPECTS.length) break
  }

  const usedNames = new Set<string>()
  const pickName = (): string => {
    for (let i = 0; i < 40; i++) {
      const n = `${pick(rng, SURNAMES)}${pick(rng, GIVEN_NAMES)}`
      if (!usedNames.has(n)) { usedNames.add(n); return n }
    }
    throw new Error('이름 생성 실패')
  }
  const roles = sample(rng, ROLES, SUSPECTS.length)

  const suspects = {} as Record<SuspectId, Suspect>
  SUSPECTS.forEach((s, i) => {
    const truth = s === culprit ? culpritTruth(rng) : innocentTruth(rng, anchorOf[s]!)
    suspects[s] = {
      id: s,
      name: pickName(),
      job: roles[i]!.job,
      relation: roles[i]!.relation,
      personaId: chosenPersonas[i]!,
      isCulprit: s === culprit,
      truth,
      claim: [...truth] as Trajectory,
      lieSlots: [],
      lieReason: '',
      testimonies: [],
    }
  })

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
  //
  // **거짓말 칸 수를 범인과 맞춘다 (1~2칸).** 실측에서 범인만 2칸이고 무고한 사람은 1칸이라
  // "모순이 가장 많이 걸린 사람 = 범인" 이 성립했고, 무작위 봇 승률이 52% 까지 올라갔다
  // (기대치 20%). 추리가 아니라 카운팅이 되는 순간이다 (ADR 007).
  const liarCount = randInt(rng, 2, 3)
  for (const s of sample(rng, innocents, liarCount)) {
    const sus = suspects[s]
    // **거짓말은 범행 시각에 몰아야 한다.** 물증이 대부분 범행 시각에 있으므로,
    // 다른 시각의 거짓말은 사실상 들키지 않는다. 그러면 "모순이 걸린 사람 = 범인" 이 성립하고
    // 기획서의 핵심 주제("거짓말하는 사람과 범인은 같지 않다")가 작동하지 않는다.
    // 실측: 후보 수가 같아도 무작위 봇이 기대치를 10~20%p 이겼다 (ADR 007).
    const slots: Slot[] = rng.next() < 0.65 ? [CRIME_SLOT] : sample(rng, SLOTS, 1)
    if (rng.next() < 0.4) {
      const extra = pick(rng, SLOTS.filter((x) => !slots.includes(x)))
      slots.push(extra)
    }
    for (const slot of slots) {
      if (sus.lieSlots.includes(slot)) continue
      sus.claim[slot] = otherPlace(rng, sus.truth[slot]!)
      sus.lieSlots.push(slot)
    }
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

  // 사슬 구조 — **범인 혼자로는 절대 열 수 없다.**
  //
  // 초기 설계('short')는 접근물증 → 범인에게 제시 → 결정적 이 전부여서,
  // 다섯 명 중 범인 한 명만 만나도 이겼다. 나머지 넷과 성향 힌트가 장식이 됐다
  // (자동 플레이테스트 리뷰 major 지적, ADR 008).
  //
  // 이제 모든 변형이 **무고한 목격자의 증언을 최소 1개** 요구한다:
  //   'gate'      목격자 심문 → 접근물증 → 범인에게 제시 → 결정적            (m* 4)
  //   'corrob'    접근물증 → 범인에게 제시 → 목격자 심문 → 결정적            (m* 4)
  //   'deep'      목격자 둘을 심문해야 결정적이 열린다                        (m* 5)
  const chain = pick(rng, ['gate', 'corrob', 'corrob', 'deep'] as const)
  const [witness, witness2] = sample(rng, innocents, 2) as [SuspectId, SuspectId]
  const witnessTestimony = `T-${witness}`
  const witness2Testimony = `T-${witness2}`

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
    exhaustive: true,
    decisive: false,
    // 'gate' 만 접근물증 자체를 목격자 증언 뒤에 둔다
    requires: chain === 'gate' ? [witnessTestimony] : [],
  }
  evidence.push(anchorEv)
  presentUnlocks.push({ evidenceId: anchorEv.id, suspectId: culprit, yieldsTestimonyId: slipId })

  // ② 결정적 증거 — 범행 시각 현장의 범인. 자백성 진술이 열려야 조회 가능 (V5 하한 보장)
  // 이 카드에 찍힌 '발급 구분' 이 곧 범행 수단이다 — 수단을 추측이 아니라 판독으로 만든다.
  // **별도 난수 스트림에서 뽑는다.** 주 스트림(rng)에서 뽑으면 소비 지점이 앞당겨져
  // 이후 모든 추첨이 밀리고 **기존 사건이 전부 다른 사건이 된다** — 사전 검증 시드 풀 400개도,
  // 데모 시드 36의 대본도 한꺼번에 무효가 된다. 파생 시드로 그 파급을 끊는다.
  const method = pick(makeRng(seed ^ 0x5bf03d1a), METHODS)
  const decisive: Evidence = {
    keyLabel: KEY_LABEL[method],
    id: evId(),
    kind: 'keycard',
    slot: CRIME_SLOT,
    place: CRIME_PLACE,
    subjects: [culprit],
    exhaustive: false,   // 카드키는 출입만 증명한다
    decisive: true,
    requires:
      chain === 'gate' ? [slipId]
      : chain === 'deep' ? [slipId, witnessTestimony, witness2Testimony]
      : [slipId, witnessTestimony],
  }
  evidence.push(decisive)

  // ③ 알리바이 물증 — 범행 시각, 무고한 사람들의 실제 위치를 확정한다.
  //    같은 장소에 있던 사람들은 하나의 CCTV 기록으로 묶인다.
  const byPlace = new Map<PlaceId, SuspectId[]>()
  for (const s of innocents) {
    const p = suspects[s].truth[CRIME_SLOT]!
    byPlace.set(p, [...(byPlace.get(p) ?? []), s])
  }
  // 범행 시각의 알리바이 기록은 **전부 CCTV(구역 촬영)** 로 둔다.
  // 그래야 "그 시간 그 장소 기록에 저 사람이 없다" 는 **부재 모순** 이 성립한다 —
  // 사람이 가장 먼저 떠올리는 추리인데, 영수증으로는 논리적으로 성립하지 않는다.
  // **전원 커버 금지.** 무고한 4명 전부에게 범행시각 기록을 주면
  // 조회만 3~4번 하면 심문 없이 범인이 남는다 → 무작위 조사로도 54% 가 풀린다 (ADR 007).
  // 일부만 남겨서 "기록으로 지울 수 있는 사람" 과 "심문으로만 알 수 있는 사람" 을 갈라놓는다.
  // 제약은 **장소 수가 아니라 인원 수** 에 건다.
  // 한 장소에 2명이 묶이면 2곳만으로도 무고한 4명이 전부 커버돼 지름길이 다시 열린다
  // (실측: 시드 1031 에서 알리바이만으로 후보가 1명이 됐다).
  const maxCovered = randInt(rng, 2, 3)
  const covered: PlaceId[] = []
  let coveredCount = 0
  for (const place of shuffle(rng, [...byPlace.keys()])) {
    const n = byPlace.get(place)!.length
    if (coveredCount + n > maxCovered) continue
    covered.push(place)
    coveredCount += n
  }
  for (const place of covered) {
    evidence.push({
      id: evId(),
      kind: 'cctv',
      slot: CRIME_SLOT,
      place,
      subjects: byPlace.get(place)!,
      exhaustive: true,
      decisive: false,
      requires: [],
    })
  }

  // ③-b 미끼 — **범행 직전 시각에 무고한 사람의 기록도 넣는다.**
  //   접근 물증이 항상 "직전 시각 + 범인" 이면 "직전 기록을 열어라, 거기 찍힌 사람이 범인" 이
  //   구조적 누설이 된다 (봇 승률이 89% 로 튀며 드러났다, ADR 008).
  //   같은 시각에 무고한 사람도 찍혀 있어야 그 한 수가 판별이 아니라 후보 축소가 된다.
  //   ⚠️ 미끼는 **거짓말과 짝을 이뤄야 미끼다.** 무고한 사람의 진술과 일치하는 기록을 넣으면
  //   모순이 안 생기고, "범행시각 밖 모순 = 범인" 이 그대로 100% 성립한다
  //   (실측: 후보 5명이 남아도 봇이 86% 승리 — 좁히지 않고 찍어서 맞혔다).
  //   그래서 미끼 대상에게는 접근 시각 거짓말을 강제한다.
  const decoyCount = 1
  for (const s of sample(rng, innocents, decoyCount)) {
    const sus = suspects[s]
    if (!sus.lieSlots.includes(APPROACH_SLOT)) {
      sus.claim[APPROACH_SLOT] = otherPlace(rng, sus.truth[APPROACH_SLOT]!)
      sus.lieSlots.push(APPROACH_SLOT)
      if (!sus.lieReason) sus.lieReason = pick(rng, SECRETS)
    }
    evidence.push({
      id: evId(),
      kind: 'cctv',
      slot: APPROACH_SLOT,
      place: suspects[s].truth[APPROACH_SLOT]!,
      subjects: [s],
      exhaustive: true,
      decisive: false,
      requires: [],
    })
  }

  // ④ 잡음 — 사건과 무관한 시각의 진짜 기록. 조사 횟수를 낭비시키는 함정.
  // **인물당 최대 1건**으로 분산한다. 한 사람에게 몰리면(실측: 8건 중 3건이 동일인)
  // 조회 목록의 절반이 같은 사람의 무의미한 기록이 되어 낭비 확률이 치솟는다.
  const noise = randInt(rng, NOISE_EVIDENCE_MIN, NOISE_EVIDENCE_MAX)
  for (const s of sample(rng, innocents, Math.min(noise, innocents.length))) {
    const slot = pick(rng, SLOTS.filter((x) => x !== CRIME_SLOT))
    evidence.push({
      id: evId(),
      kind: pick(rng, ['receipt', 'call', 'keycard'] as const),
      slot,
      place: suspects[s].truth[slot]!,
      subjects: [s],
      exhaustive: false,
      decisive: false,
      requires: [],
    })
  }

  // ⑤ **순서 섞기 — 생성 순서가 곧 정답 순서였다.**
  //   접근 물증이 항상 E1 이라 조회 목록의 맨 위였고, 모순도 그것부터 발견됐다.
  //   "제일 먼저 걸리는 모순 = 범인" 이 성립해, 후보 5명이 남아도 봇이 69% 를 맞혔다 (ADR 008).
  //   id 까지 다시 매겨 참조를 remap 한다.
  const shuffled = shuffle(rng, evidence)
  const idMap = new Map<string, string>()
  shuffled.forEach((e, i) => idMap.set(e.id, `E${i + 1}`))
  const remapped: Evidence[] = shuffled.map((e) => ({
    ...e,
    id: idMap.get(e.id)!,
    requires: e.requires.map((r) => idMap.get(r) ?? r),
  }))
  const unlocksRemapped = presentUnlocks.map((u) => ({ ...u, evidenceId: idMap.get(u.evidenceId)! }))

  return {
    seed,
    title: pick(rng, CASE_TITLES),
    victim: pick(rng, VICTIMS),
    venue: pick(rng, VENUES),
    culprit,
    motive: pick(rng, MOTIVES),
    method,
    suspects,
    evidence: remapped,
    testimonies,
    presentUnlocks: unlocksRemapped,
    decisiveEvidenceId: idMap.get(decisive.id)!,
  }
}
