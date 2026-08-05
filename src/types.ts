/** 공유 타입 — 사건의 진실 모델. 이 파일의 데이터는 전부 코드가 소유하며 LLM에 통째로 넘기지 않는다. */

export type SuspectId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
export const SUSPECTS: readonly SuspectId[] = ['S1', 'S2', 'S3', 'S4', 'S5']

/** 22:00 / 22:10 / 22:20(범행) / 22:30 / 22:40 */
export type Slot = 0 | 1 | 2 | 3 | 4
export const SLOTS: readonly Slot[] = [0, 1, 2, 3, 4]
export const SLOT_LABEL = ['22:00', '22:10', '22:20', '22:30', '22:40'] as const

/** 장소 index. 2번(1204호)이 범행 현장. */
export type PlaceId = 0 | 1 | 2 | 3 | 4
export const PLACE_LABEL = ['로비', '복도', '1204호', '직원계단', '라운지'] as const

export const CRIME_SLOT: Slot = 2
export const CRIME_PLACE: PlaceId = 2

/** 물증 1건 = "이 시각 이 장소에 이 인물들이 있었다"를 **확정**한다. 진술과 달리 거짓일 수 없다. */
export interface Evidence {
  id: string
  kind: 'keycard' | 'cctv' | 'call' | 'receipt'
  slot: Slot
  place: PlaceId
  /** 이 기록으로 위치가 확정되는 인물들 (CCTV는 여럿, 카드키는 1명) */
  subjects: SuspectId[]
  /**
   * 이 기록이 해당 시각·장소의 **인원을 남김없이** 담고 있는가.
   * CCTV(구역 촬영)는 true — 안 찍혔으면 없었다는 뜻이다.
   * 영수증·카드키·통화는 false — 결제/출입/통화를 안 했을 뿐일 수 있다.
   * 이 구분이 "부재 모순"(그 기록에 저 사람이 없다)의 논리적 근거다.
   */
  exhaustive: boolean
  /** 범인을 직접 가리키는 결정적 증거인가 */
  decisive: boolean
  /** 카드키 기록에만 있는 '발급 구분' — 결정적 증거에서 범행 수단을 읽어내는 근거 */
  keyLabel?: string
  /** 이 항목들을 먼저 획득해야 조회 가능 (없으면 즉시 조회 가능) */
  requires: string[]
}

/** 인물이 말하는 궤적. truth 와 다른 칸이 거짓말이다. */
export type Trajectory = PlaceId[]   // 길이 5 (Slot 별)

export interface Suspect {
  id: SuspectId
  /** 표시용 이름 */
  name: string
  job: string
  /** 피해자와의 관계 — 용의자 카드에 노출된다 */
  relation: string
  /** 배정된 페르소나 id (data/personas.ts). 클라이언트가 바꿀 수 없다 — 사건이 소유한다. */
  personaId: string
  isCulprit: boolean
  /** 실제 궤적 — 코드만 안다 */
  truth: Trajectory
  /** 진술 궤적 — 플레이어에게 보인다 */
  claim: Trajectory
  /** claim !== truth 인 슬롯들 */
  lieSlots: Slot[]
  /** 거짓말 이유 (범인이 아닌 경우: 개인 비밀) */
  lieReason: string
  /** 심문으로 해금되는 증언 id들 */
  testimonies: string[]
}

/** 심문으로 얻는 증언 — 물증 조회를 여는 열쇠 역할을 한다 */
export interface Testimony {
  id: string
  /** 이 증언을 가진 인물 */
  from: SuspectId
  /** 무엇에 대한 증언인지 (UI 표시용) */
  about: SuspectId | null
  text: string
}

/** 증거를 인물에게 제시했을 때 열리는 것. 이것이 "조사 6회" 를 전략 게임으로 만든다. */
export interface PresentUnlock {
  /** 이 증거를 */
  evidenceId: string
  /** 이 인물에게 제시하면 */
  suspectId: SuspectId
  /** 이 증언이 열린다 */
  yieldsTestimonyId: string
}

export interface CaseFile {
  seed: number
  title: string
  victim: { name: string; title: string }
  venue: { name: string; room: string }
  culprit: SuspectId
  motive: string
  method: string
  suspects: Record<SuspectId, Suspect>
  evidence: Evidence[]
  testimonies: Testimony[]
  presentUnlocks: PresentUnlock[]
  /** 결정적 증거 id */
  decisiveEvidenceId: string
}
