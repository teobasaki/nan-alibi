/** 공유 타입 — 사건의 진실 모델. 이 파일의 데이터는 전부 코드가 소유하며 LLM에 통째로 넘기지 않는다. */

export type SuspectId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
export const SUSPECTS: readonly SuspectId[] = ['S1', 'S2', 'S3', 'S4', 'S5']

/** 22:00 / 22:10 / 22:20(범행) / 22:30 / 22:40 */
export type Slot = 0 | 1 | 2 | 3 | 4
export const SLOTS: readonly Slot[] = [0, 1, 2, 3, 4]
export const SLOT_LABEL = ['22:00', '22:10', '22:20', '22:30', '22:40'] as const

/** 장소 index. 2번(1204호)이 범행 현장. */
export type PlaceId = 0 | 1 | 2 | 3 | 4
export const PLACES: readonly PlaceId[] = [0, 1, 2, 3, 4]
export const PLACE_LABEL = ['로비', '복도', '1204호', '직원계단', '라운지'] as const

export const CRIME_SLOT: Slot = 2
export const CRIME_PLACE: PlaceId = 2

/** 물증 1건 = "이 시각 이 장소에 이 인물들이 있었다"를 **확정**한다. 진술과 달리 거짓일 수 없다. */
export interface Evidence {
  id: string
  /** 'autopsy'(검시 소견)는 인물이 아니라 **도구의 흔적**을 확정한다 — subjects 는 항상 빈다 (ADR 022) */
  kind: 'keycard' | 'cctv' | 'call' | 'receipt' | 'autopsy'
  /**
   * 카드에 실리는 한 줄 비고 — 시각·장소·인물로 표현되지 않는 사건 고유 정보
   * (예: gc001 "해임 통지 출력 기록"). 생성 사건은 쓰지 않는다 — 없으면 행도 없다.
   */
  note?: string
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
  /** 나이 — 용의자 카드에 노출된다 (ADR 022 심문 화면) */
  age: number
  job: string
  /** 피해자와의 관계 — 용의자 카드에 노출된다 */
  relation: string
  /**
   * 이 인물이 피해자와 얽힌 사정 — 다섯 명 전부 하나씩 갖고, **범인의 것이 사건의 동기다.**
   * 동기 지목이 어휘 맞히기가 아니라 "누구의 사정이 살인까지 갔는가" 가 되게 하는 장치 (ADR 022).
   * 심문에서 관계를 캐면 드러난다 — 지목 시트에는 이름 없이 사정 문구만 나열된다.
   */
  motive: string
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

/**
 * 월드 스킨 — 라벨·어휘를 사건이 소유한다 (GC001 어댑테이션 계약 §1).
 *
 * 구조(슬롯 5·장소 5·CRIME_SLOT=2·CRIME_PLACE=2)는 전역 불변이고, **이름만** 바뀐다.
 * 없으면 기존 호텔 상수를 그대로 쓴다 — 시드 사건 400개가 바이트 하나 안 바뀌는 것이 게이트다.
 */
export interface WorldSkin {
  slotLabels: readonly [string, string, string, string, string]
  placeLabels: readonly [string, string, string, string, string]
  /** 기록 종류 표시명 덮어쓰기 — 없는 키는 각 화면의 기본값 */
  kindLabels?: Partial<Record<Evidence['kind'], string>>
  /** 3축 셋째 축의 표시명 (기본 '살인 도구') */
  weaponAxisLabel?: string
  /** 셋째 축 선택지 (기본 WEAPONS) */
  weaponOptions?: readonly string[]
  /** autopsy 기록의 소견 본문 (기본 WEAPON_TRACE[weapon]) */
  autopsyText?: string
}

export interface CaseFile {
  seed: number
  title: string
  victim: { name: string; title: string }
  venue: { name: string; room: string }
  /** 없으면 호텔 월드 — 생성 사건 전부가 이 경로다 */
  world?: WorldSkin
  /** GC-001 V0.2: legacy `requires` 는 호환 메타데이터로 남기되 실제 조회 문으로 쓰지 않는다 */
  evidenceAccess?: 'open'
  culprit: SuspectId
  /** 사건의 동기 = 범인의 motive. 지목 시트의 정답 축 */
  motive: string
  /** 카드키 발급 구분 축 — 채점 축에서는 빠졌지만 잠긴 기록·재현영상이 쓴다 (ADR 022 §1) */
  method: string
  /** 살인 도구 — 검시 소견(WEAPON_TRACE)이 단서다. 지목 시트의 정답 축 */
  weapon: string
  suspects: Record<SuspectId, Suspect>
  evidence: Evidence[]
  testimonies: Testimony[]
  presentUnlocks: PresentUnlock[]
  /** 결정적 증거 id */
  decisiveEvidenceId: string
  /**
   * 고정 사건 전용 결말 오버라이드 (GC001 계약 §2 자백 훅의 착지점).
   * 자백 한 문단과 5단계 재구성(발단→…→결말)을 **사건이 직접 소유한다** — LLM 아님.
   * 생성 사건은 없음 → 페르소나 자백 템플릿 + 호텔 5단계가 그대로 쓰인다.
   */
  ending?: {
    confession: string
    beats: readonly (readonly [string, string])[]
  }
}

/* ─────────── 월드 라벨 헬퍼 (GC001 계약 §1) ───────────
 * SLOT_LABEL/PLACE_LABEL 을 화면·프롬프트·봇이 직접 읽으면 라벨이 전역에 박제된다.
 * 앞으로 모든 소비처는 이 헬퍼를 지나간다 — world 가 없으면 기존 상수 그대로라
 * 생성 사건의 출력은 바이트 단위로 동일하다.
 */
export const slotLabel = (c: CaseFile, s: Slot): string => c.world?.slotLabels[s] ?? SLOT_LABEL[s]
export const placeLabel = (c: CaseFile, p: PlaceId): string => c.world?.placeLabels[p] ?? PLACE_LABEL[p]
/**
 * 기록 종류 표시명. 화면마다 기본 어휘의 길이가 다르므로(카드는 "카드키 출입 기록",
 * 일지는 "카드키") 기본값은 호출부가 낸다 — 월드 오버라이드만 여기서 가로챈다.
 */
export const kindLabel = (c: CaseFile, k: Evidence['kind'], fallback: string): string =>
  c.world?.kindLabels?.[k] ?? fallback
