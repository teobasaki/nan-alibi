/**
 * 「30초의 현장」 — **씬의 규칙 계층.** 3D 를 모르는 순수 함수만 둔다.
 *
 * crimescene3d.ts(그림)와 main.ts(배선)가 이 파일을 같이 본다.
 * 3D 씬은 headless 테스트가 못 닿으므로, **시간 상태기계·압박 곡선·스왑·배치**를
 * 여기로 떼어내 게이트(기획서 ⑥ ①③④⑦)가 보게 한다 — explore3d 의
 * `nearestWithin` 과 같은 이유, 같은 문법이다.
 *
 * ## 엔진 무변경의 경계
 * 이 파일은 `engine/` 을 **호출만** 한다. 수거 = `lookupEvidence`(기존 조회와 동일 효과),
 * 스왑 = 내려놓기(환불) + `lookupEvidence`(재지출) — 지출은 끝까지 엔진이 소유한다.
 * 시간 종료는 예산을 0 으로 못박아 "예산 소진과 동일 상태" 를 만든다(기획서 §2).
 */

import { lookupEvidence, type GameState } from '../engine/game'
import type { Evidence, PlaceId } from '../types'

type EvKind = Evidence['kind']

/** 연출·밸런스 상수 — **체감 조정은 전부 여기서** (RESULT_FX/TYPE_FX 와 같은 규약) */
export const SCENE_FX = {
  /** 훑기(카메라 오빗, 조작 불가) 길이 */
  surveyMs: 5000,
  /** 수집 시간 — 30.0초. 십분의일초까지 표시한다 */
  collectMs: 30000,
  /** 이 잔여초 이하부터 째깍이 2Hz (기획서 §3: 10~6초) */
  tick2FromSec: 10,
  /** 이 잔여초 이하부터 심박+비네트 강 (기획서 §3: 5~0초) */
  heartFromSec: 5,
  /** 심박 간격 — 1Hz 째깍과 구분되는 몸의 박자 */
  heartGapMs: 750,
  /** 스왑(내려놓기)의 시간 비용 — "내려놓기도 1.5초 소모" (기획서 §2) */
  swapPenaltyMs: 1500,
  /**
   * 수거 동작(pickup 클립) 동안의 이동 잠금. 기획서 검산의 "수거 0.4s" 가 이 값이다 —
   * 30초 게임에서 수거가 느려지면 안 되므로 0.5s 를 넘기지 않는다 (코디네이터 지시).
   */
  pickupLockMs: 450,
  /** pickup 클립에서 실제로 보여줄 앞부분 비율 — 집는 동작은 앞에 있다 */
  pickupPortion: 0.55,
  /** 호루라기 후 화이트아웃이 차오르는 시간. 이 뒤에 수사 정리가 열린다 */
  whiteoutMs: 900,
  /** 수거 토스트("확보 — …")가 떠 있는 시간 — 무엇을 얻었는지가 화면에 분명해야 한다 */
  toastMs: 1500,
  /** 이동 속도 m/s — 걷기 클립일 때 (explore3d 와 같은 빠른 걸음) */
  speed: 2.2,
  /**
   * **1인칭 상한 속도 m/s.** 같은 3.4 라도 1인칭이 더 빠르게 느껴진다 —
   * 시야가 좁아 화면 가장자리를 스치는 상대속도가 커지기 때문이다(실플레이 "너무 빠르다").
   * 조감(V)은 방 전체가 보이므로 클립 속도(3.4)를 그대로 쓴다.
   */
  fpSpeed: 2.4,
  /**
   * 가감속 램프의 시간상수(초). 급출발·급정지가 프레임 드랍처럼 읽히던 체감의 수리 —
   * 이 값 동안 목표 속도의 63%에 닿는다. 클립 가중치도 같은 램프를 탄다.
   */
  rampTau: 0.15,
  /**
   * 달리기 클립일 때의 이동 속도 m/s. 30초 압박에 걷기는 태평하다 —
   * 30초 × 3.4 ≈ 100m 주행이라 12×9m 방에서 가방 5칸이 유일한 상한이 된다.
   * 클립이 없으면 걷기+2.2 로 떨어진다 (발이 미끄러지면 안 된다).
   */
  runSpeed: 3.4,
  /** 줍기 판정 반경 m — explore3d 의 PICK_RADIUS 와 같다 */
  pickRadius: 1.1,
} as const

export type ScenePhase = 'survey' | 'collect' | 'done'

/**
 * 경과 시간 → 국면. **calm 모드는 시계가 없다** — 영원히 collect 다.
 * 훑기도 건너뛴다: calm 은 reduced-motion 사용자·심사 데모용인데(기획서 §2)
 * 조작 불가로 도는 카메라 5초는 그 사용자에게 모션이자 대기다.
 */
export function phaseAt(elapsedMs: number, calm: boolean): ScenePhase {
  if (calm) return 'collect'
  if (elapsedMs < SCENE_FX.surveyMs) return 'survey'
  if (elapsedMs < SCENE_FX.surveyMs + SCENE_FX.collectMs) return 'collect'
  return 'done'
}

/** 남은 수집 시간(ms). 훑기 중에는 만땅, 종료 후에는 0 에 고정된다. */
export function remainMs(elapsedMs: number): number {
  return Math.max(0, Math.min(SCENE_FX.collectMs, SCENE_FX.surveyMs + SCENE_FX.collectMs - elapsedMs))
}

/** 압박 곡선의 소리 층 (기획서 §3): 30~11초 1Hz · 10~6초 2Hz · 5~0초 심박 */
export type Pulse = 'tick1' | 'tick2' | 'heart'

export function pulseAt(remainSec: number): Pulse {
  if (remainSec > SCENE_FX.tick2FromSec) return 'tick1'
  if (remainSec > SCENE_FX.heartFromSec) return 'tick2'
  return 'heart'
}

/**
 * 비네트 세기 0~1 (기획서 §3): 10초부터 서서히 조이고 5초부터 강하게.
 * 숫자가 아니라 몸으로 남은 시간을 알린다 — 타이머를 안 보는 플레이어에게도.
 */
export function vignetteAt(remainSec: number): number {
  if (remainSec > SCENE_FX.tick2FromSec) return 0
  if (remainSec > SCENE_FX.heartFromSec) {
    return 0.45 * (SCENE_FX.tick2FromSec - remainSec) / (SCENE_FX.tick2FromSec - SCENE_FX.heartFromSec)
  }
  return 0.45 + 0.55 * (SCENE_FX.heartFromSec - Math.max(0, remainSec)) / SCENE_FX.heartFromSec
}

/**
 * 시간 종료 = **예산 소진과 동일 상태** (기획서 §2 — "시간 종료 = 예산 0").
 * 예산을 0 으로 내리면 기존 챕터 게이트(`fieldDone`)가 그대로 수사 정리를 연다 —
 * 새 게이트를 만들지 않는다. 남은 예산의 효율 보너스(+2/회)도 함께 죽는데,
 * 그게 맞다: 감식반이 철수한 판에 "아껴서" 보너스를 주면 시간이 자원이 아니게 된다.
 */
export function timeUp(g: GameState): GameState {
  return g.investigationsLeft <= 0 ? g : { ...g, investigationsLeft: 0 }
}

/**
 * 스왑 — 가방 5/5 에서 6번째를 집으면 하나를 내려놓는다.
 *
 * 내려놓기 = 카드 반납 + 예산 1 환불, 집기 = `lookupEvidence`(예산 1 재지출).
 * **순비용 0, 지출 경로는 엔진 그대로다.** 엔진에 "카드 제거" 를 새로 파지 않는 이유:
 * 내려놓은 기록은 아직 현장 바닥에 있다 — 조회가 취소된 것이지 규칙이 바뀐 게 아니다.
 * 시간 비용(swapPenaltyMs)은 씬의 시계가 진다.
 */
export function swapField(g: GameState, dropId: string, pickId: string): GameState {
  if (!g.case.evidence.some((e) => e.id === dropId) || !g.cards.includes(dropId)) {
    throw new Error(`내려놓을 수 없는 카드: ${dropId}`)
  }
  const refunded: GameState = {
    ...g,
    cards: g.cards.filter((c) => c !== dropId),
    investigationsLeft: g.investigationsLeft + 1,
  }
  return lookupEvidence(refunded, pickId)
}

/** 가방에 든 것 — **물증만** 센다. 진술 카드(C:…)·증언은 가방이 아니라 수첩에 있다. */
export function bagIds(g: GameState): string[] {
  return g.case.evidence.filter((e) => g.cards.includes(e.id)).map((e) => e.id)
}

/* ─────────── 방 배치 — 갤러리 서관 홀 (실측 기반) ───────────
 * 지오메트리는 하나, 라벨은 월드가 소유한다(기획서 위험 §2). 좌표는 전부 미터.
 *
 * ## 갤러리 실측 (gallery-bbox 스크립트, art_gallery.glb 원본 좌표)
 * 바닥 x[-10, 20.6]·z[-7.5, 7.5], 서관 홀 바닥면 y=-0.6, 계단이 x=10 부터
 * 동관(저층 -2.2)으로 내려간다. 조각상 받침 x[7.5, 8.7]. 그래서 모델을
 * GALLERY_OFFSET(+1.5, +0.6, 0) 으로 옮기면 서관 홀 바닥이 y=0 에 오고,
 * 놀이 구역은 **벽 안쪽면(-8.3·±7.3)과 계단 목전(11.5)** 사이가 된다.
 * 동쪽 경계만 보이는 벽이 없다 — 계단 낙하 방지의 통제선이다.
 */

export const GALLERY_OFFSET: readonly [number, number, number] = [1.5, 0.6, 0]

export const SCENE_ROOM = { minX: -8.6, maxX: 10.9, minZ: -7.2, maxZ: 7.2 } as const

/** 벽에서 이만큼 물러선 안쪽만 걷는다 */
const MARGIN = 0.5

/** 장애물 AABB — 씬이 이 표로 상자를 그리고, 충돌·스폰이 같은 표를 본다. */
export interface Box {
  x: number
  z: number
  /** 반너비 */
  hx: number
  /** 반깊이 */
  hz: number
  /** 높이(그리기용) */
  h: number
  kind: 'pedestal' | 'partition' | 'crate' | 'desk'
}

/**
 * 현장 받침대 1 · 파티션 2 · 운송 상자 5 · 큐레이터 데스크 1 (기획서 §A 표).
 * 파티션은 동선을 꺾는 벽이다 — 최단 직선을 끊어 "달린다" 가 성립하게 한다.
 * 좌표는 갤러리 서관 홀(약 19×14m)에 다시 폈다 — 갤러리 자체 가구(의자·조각상)는
 * 씬이 메시에서 격자로 구워 막는다.
 */
export const SCENE_BOXES: readonly Box[] = [
  { x: -0.6, z: -4.2, hx: 0.7, hz: 0.7, h: 0.95, kind: 'pedestal' },
  { x: -3.2, z: 0.8, hx: 1.5, hz: 0.14, h: 1.8, kind: 'partition' },
  { x: 3.4, z: -1.2, hx: 0.14, hz: 1.4, h: 1.8, kind: 'partition' },
  { x: -7.0, z: -4.6, hx: 0.42, hz: 0.42, h: 0.8, kind: 'crate' },
  { x: -6.0, z: -5.0, hx: 0.42, hz: 0.42, h: 0.55, kind: 'crate' },
  { x: -6.6, z: -3.7, hx: 0.42, hz: 0.42, h: 1.1, kind: 'crate' },
  { x: 8.6, z: -2.6, hx: 0.42, hz: 0.42, h: 0.8, kind: 'crate' },
  { x: 8.9, z: -1.4, hx: 0.42, hz: 0.42, h: 0.6, kind: 'crate' },
  { x: 6.6, z: 5.2, hx: 0.95, hz: 0.4, h: 1.05, kind: 'desk' },
] as const

/** 전시 받침대(분석 상자) 위치 — 지금은 가구다. 발견 지점 서사는 DEATH_AT 이 가져갔다. */
export const PEDESTAL_AT: readonly [number, number] = [-0.6, -4.2]

/**
 * **사망 지점 — 조각상 아래.** 갤러리 실측(Statue_low t=(7.90,·,-0.14) ·
 * stand t=(8.11,·,-0.02)) + GALLERY_OFFSET(+1.5) = 조각상이 씬 (9.4, -0.1) 에 선다.
 * 그 서남쪽 발치가 발견 지점이다 — fallscene 실모델·테이프 라인·autopsy 앵커·
 * 접근 서술이 전부 이 좌표를 본다 (유혈·시신 직접 묘사 금지, 골든 케이스 §4).
 */
export const DEATH_AT: readonly [number, number] = [8.0, 1.0]

/** 현장 테이프 구역 — 사망 지점 둘레. 연출 전용이라 통행은 막지 않는다. */
export const DEATH_ZONE = { x: 8.0, z: 1.0, hx: 1.5, hz: 1.3 } as const

/** 플레이어 시작 위치 — 출입문(+z 벽) 쪽 */
export const SCENE_START: readonly [number, number] = [2.0, 5.6]

/**
 * 장소(PlaceId 0~4) → 방 안 앵커. **규칙이 아니라 배치다** — 어느 기록이 어느
 * 장소인지는 `evidence.place` 가 정했고, 여기서는 그 다섯 구역을 방에 편다.
 * 현장(2번)은 받침대 곁이다.
 */
export const SCENE_PLACE_AT: readonly [number, number][] = [
  [-6.4, 3.6],   // 0 로비 — 입구 왼쪽 안
  [6.2, 3.6],    // 1 복도 — 데스크 곁
  [-2.4, -4.4],  // 2 현장 — 받침대 곁 (받침대 안이면 못 줍는다)
  [-6.6, -2.2],  // 3 계단 — 상자 더미 곁
  [5.8, -4.4],   // 4 라운지 — 오른쪽 안쪽
]

/** 몸(반지름 ~0.35m)이 설 수 없는 자리인가 — 벽 밖이거나 장애물 안 */
export function sceneBlocked(x: number, z: number): boolean {
  if (x < SCENE_ROOM.minX + MARGIN || x > SCENE_ROOM.maxX - MARGIN) return true
  if (z < SCENE_ROOM.minZ + MARGIN || z > SCENE_ROOM.maxZ - MARGIN) return true
  const R = 0.3
  for (const b of SCENE_BOXES) {
    if (Math.abs(x - b.x) < b.hx + R && Math.abs(z - b.z) < b.hz + R) return true
  }
  return false
}

/**
 * 증거품 스폰 — 같은 장소의 k번째는 앵커 둘레의 고리에 놓는다.
 * **Math.random 금지**(이 프로젝트의 재현 가능성 규칙): 순번과 장소만으로 정해져
 * 같은 사건은 언제나 같은 현장이다. 막힌 자리는 나선 탐색으로 곁의 빈 칸에 옮긴다 —
 * explore3d 의 `placeReachable` 과 같은 이유다 (못 닿는 기록은 없는 기록이다).
 */
/**
 * (레거시 — 장소 축 배치) 개편 라운드부터 본선은 kind 서사 앵커(`spawnAnchored`)다.
 * 이 함수는 ⑥-⑧ 계약 테스트와 "장소 축으로도 펼 수 있다"의 증거로 남는다.
 */
export function spawnFor(list: readonly { id: string; place: PlaceId }[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  const countAt = new Map<PlaceId, number>()
  const taken: [number, number][] = []

  const free = (x: number, z: number): boolean =>
    !sceneBlocked(x, z) && taken.every(([tx, tz]) => Math.hypot(x - tx, z - tz) > 0.85)

  for (const it of list) {
    const k = countAt.get(it.place) ?? 0
    countAt.set(it.place, k + 1)
    const [ax, az] = SCENE_PLACE_AT[it.place] ?? [0, 0]
    let x = ax
    let z = az
    if (k > 0) {
      const ang = (k - 1) * (Math.PI / 3) + it.place * 0.7
      const rad = 0.95 + 0.4 * Math.floor((k - 1) / 6)
      x = ax + Math.cos(ang) * rad
      z = az + Math.sin(ang) * rad
    }
    if (!free(x, z)) {
      outer: for (let r = 0.3; r < 4; r += 0.3) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const px = x + Math.cos(a) * r
          const pz = z + Math.sin(a) * r
          if (free(px, pz)) { x = px; z = pz; break outer }
        }
      }
    }
    taken.push([x, z])
    out.set(it.id, [x, z])
  }
  return out
}

/* ─────────── 개연성 배치 — kind 서사 앵커 (개편 라운드, 사용자 결정 3) ───────────
 * "한곳에 뭉치거나 무작위" 라는 실플레이 불만의 수리다. 증거는 **있을 법한 자리**에 있다:
 * cctv 는 벽 상단, 통화 기록은 데스크·벤치 위, 영수증은 데스크·수장고 곁,
 * 검시 소견은 사망 지점 옆, 봉인(keycard)은 수장고 구석. 라벨은 여전히 월드 소유다.
 */

/** 서사 앵커 한 자리 (배치표의 원소) */
export interface Anchor {
  at: [number, number]
  /** 부양 높이(m) — 없으면 바닥 기본(씬의 MARK_Y). cctv 는 1인칭 시야(1.6m)에서 올려다보이는 2.2~2.6 */
  y?: number
  /** 벽·가구 부착 — 서 있을 수 없는 자리가 정상이므로 씬의 도달성 재배치(spotFor)를 건너뛴다 */
  mounted?: boolean
}

/** 실제로 배정된 자리 — 앵커에 **입을 모델**까지 정해진 것 */
export interface SpawnSpot extends Anchor {
  /** 이 자리에 설 실모델 키 (`props/ev-<키>.opt.glb`) — 같은 kind 라도 번갈아 입는다 */
  model: string
}

/**
 * kind → 서사 앵커 서열. 같은 kind 복수는 순번대로 **서로 다른 앵커**를 받는다.
 * 좌표는 갤러리 서관 홀 실측(SCENE_ROOM·SCENE_BOXES·GLB 노드 t)에서 골랐다.
 */
export const KIND_SPOTS: Record<EvKind, readonly Anchor[]> = {
  cctv: [
    { at: [2.0, 6.9], y: 2.45, mounted: true },    // 출입구(+z 벽, 시작점 곁) 위
    { at: [-8.0, -6.6], y: 2.5, mounted: true },   // 북서 벽 상단 코너
    { at: [10.3, -6.6], y: 2.3, mounted: true },   // 북동 벽 상단 코너
  ],
  call: [
    { at: [6.5, 5.1], y: 1.35, mounted: true },    // 큐레이터 데스크(h 1.05) 위
    { at: [5.9, 0.5], y: 0.95, mounted: true },    // 관람 벤치 위 (갤러리 chairs t=(4.53,·,-0.04)+오프셋)
  ],
  receipt: [
    { at: [5.2, 4.4] },                            // 데스크 곁 바닥
    { at: [-5.6, -4.2] },                          // 서쪽 수장고(상자 더미) 곁
    { at: [8.2, -3.4] },                           // 동쪽 상자 곁
  ],
  autopsy: [
    { at: [6.8, 0.9] },                            // 사망 지점 서편 — 테이프 밖
    { at: [8.2, 3.0] },                            // 사망 지점 남편
  ],
  keycard: [
    { at: [-7.2, -5.6] },                          // 서쪽 수장고 구석
    { at: [10.1, 6.4] },                           // 남동 구석
  ],
}

/** 앵커 초과분을 흩을 때의 kind 별 위상 — 결정론 (Math.random 금지) */
const KIND_PHASE: Record<EvKind, number> = { cctv: 0, call: 0.7, receipt: 1.4, autopsy: 2.1, keycard: 2.8 }

/**
 * kind 서사 앵커 배치. 부착(mounted) 앵커는 좌표 그대로, 바닥 앵커는 겹침 회피
 * (0.85m)와 설 자리 검사(sceneBlocked)를 지나며, 앵커가 소진되면 마지막 앵커
 * 둘레 고리로 흩는다 — 전부 순번만으로 정해져 같은 사건은 언제나 같은 현장이다.
 */
export function spawnAnchored(list: readonly { id: string; kind: EvKind }[]): Map<string, SpawnSpot> {
  const out = new Map<string, SpawnSpot>()
  const countByKind = new Map<EvKind, number>()
  const taken: [number, number][] = []

  const free = (x: number, z: number): boolean =>
    !sceneBlocked(x, z) && taken.every(([tx, tz]) => Math.hypot(x - tx, z - tz) > 0.85)

  for (const it of list) {
    const k = countByKind.get(it.kind) ?? 0
    countByKind.set(it.kind, k + 1)
    const spots = KIND_SPOTS[it.kind]
    const anchor = spots[Math.min(k, spots.length - 1)]!

    if (anchor.mounted && k < spots.length) {
      // 부착 — 벽·가구 위라 서 있을 수 없어도 된다. 줍기는 발치(XZ 반경)로 판정된다.
      taken.push([anchor.at[0], anchor.at[1]])
      out.set(it.id, {
        at: [anchor.at[0], anchor.at[1]], y: anchor.y, mounted: true,
        model: modelKeyFor(it.kind, k),
      })
      continue
    }

    const over = k - (spots.length - 1)
    let x = anchor.at[0]
    let z = anchor.at[1]
    if (over > 0) {
      const ang = over * (Math.PI / 2.6) + KIND_PHASE[it.kind]
      const rad = 1.0 + 0.4 * Math.floor(over / 5)
      x += Math.cos(ang) * rad
      z += Math.sin(ang) * rad
    }
    if (!free(x, z)) {
      outer: for (let r = 0.3; r < 4; r += 0.3) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const px = x + Math.cos(a) * r
          const pz = z + Math.sin(a) * r
          if (free(px, pz)) { x = px; z = pz; break outer }
        }
      }
    }
    taken.push([x, z])
    out.set(it.id, { at: [x, z], y: over > 0 ? undefined : anchor.y, model: modelKeyFor(it.kind, k) })
  }
  return out
}

/* ─────────── 이동 체감 — 시점별 상한 + 가감속 램프 (실플레이 피드백) ───────────
 * 3D 씬은 테스트가 못 닿으므로, **속도를 정하는 산수만** 순수 함수로 떼어 게이트가 보게 한다
 * (nearestWithin·spawnAnchored 와 같은 이유, 같은 문법).
 */

/**
 * 시점별 이동 상한. 클립이 정한 속도(걷기 2.2·달리기 3.4)를 **1인칭에서만** fpSpeed 로 누른다.
 * 클립보다 빠르게는 절대 만들지 않는다 — 발이 미끄러지면 속도가 거짓말이 된다.
 */
export function moveSpeedFor(clipSpeed: number, firstPerson: boolean): number {
  return firstPerson ? Math.min(clipSpeed, SCENE_FX.fpSpeed) : clipSpeed
}

/**
 * 걷기/달리기 클립의 **고정 재생 배율.** 예전에는 매 프레임 `curSpeed / clipSpeed` 로
 * 동기화했는데, 램프 중 속도가 변하는 동안 클립 재생속도가 함께 출렁여 **몸 전체가
 * 떨려 보였다** (실플레이 "현장이 계속 버벅인다" — 경찰서는 고정 배율이라 매끄럽다).
 * 발 미끄러짐보다 떨림이 더 나쁘다는 사용자 판정에 따라 배율을 **시점별 상한에 고정**한다:
 * 1인칭 = fpSpeed/클립속도(예: 2.4/3.4 ≈ 0.71), 조감 = 1. 가감속 램프(tau 0.15s)의
 * 짧은 순간에만 발이 살짝 미끄러지는데, 그때는 대기 클립과의 가중치 전환이 겹쳐 안 보인다.
 */
export function clipRateFor(clipSpeed: number, firstPerson: boolean): number {
  return clipSpeed > 0 ? moveSpeedFor(clipSpeed, firstPerson) / clipSpeed : 1
}

/**
 * 지수 접근 램프 — dt 가 들쭉날쭉해도 **시간상수(tau)가 결과를 정한다**.
 * 선형 가속(속도 += a·dt)은 프레임이 처지면 한 프레임에 목표를 뛰어넘어
 * 급출발이 그대로 남는다. `1 - exp(-dt/tau)` 는 어떤 dt 에도 단조 수렴한다.
 */
export function rampTo(cur: number, target: number, dtSec: number, tauSec = SCENE_FX.rampTau): number {
  if (dtSec <= 0) return cur
  if (tauSec <= 0) return target
  const k = 1 - Math.exp(-dtSec / tauSec)
  const next = cur + (target - cur) * k
  // 부동소수 꼬리가 영원히 남지 않게 — 정지는 진짜 0 이어야 대기 클립으로 넘어간다
  return Math.abs(target - next) < 1e-3 ? target : next
}

/* ─────────── 표현 변주 — "같은 물건 복제"로 안 읽히게 (실플레이 체감) ───────────
 * 사용자가 본 "중복"의 정체는 노드 중복이 아니라 **같은 kind 가 같은 GLB 하나**라는 것이었다.
 * cctv 5장이면 똑같은 보안 카메라 5대가 선다. 배치가 개연적일수록 이 반복이 더 눈에 띈다.
 * 그래서 ① 모델을 번갈아 쓰고 ② 같은 모델도 자세·크기를 흩는다. **수거·기록 매핑은 불변.**
 */

/**
 * kind → 실모델 키 풀 (`public/props/ev-<키>.opt.glb`).
 *
 * **한 현장에 같은 모델은 한 번만 선다** (사용자 재판정 — "하나만 쓰여야 한다".
 * 모델 교대 3+2 로는 부족했다). 그래서 풀은 **kind 간에도 겹치면 안 된다** —
 * 예전의 call: ['call','receipt'] 는 receipt kind 의 모델과 충돌해 서류가 두 번 섰다.
 * 풀을 소진한 초과분은 증거 깃발(FLAG_KEY, 감식 번호판)로 선다 — "무엇인지"는
 * 훑기 라벨과 근접 힌트가 말하므로 판독은 깨지지 않는다 (ADR 028 §10 보류 근거 소멸).
 */
export const KIND_MODELS: Record<EvKind, readonly string[]> = {
  cctv: ['cctv', 'reel'],
  call: ['call'],
  receipt: ['receipt'],
  autopsy: ['autopsy'],
  keycard: ['keycard'],
}

/**
 * 실모델 풀 소진분의 표현 — **증거 깃발**(감식 텐트 카드 + 폴라로이드, 숫자 없음).
 * 에셋 파일이 아니라 씬이 프리미티브로 세운다 — 에셋 0 원칙 그대로다.
 */
export const FLAG_KEY = 'flag'

/** 같은 kind 의 k번째가 입을 모델. 풀을 넘어서면 증거 깃발이다 — 같은 모델은 한 번만. */
export function modelKeyFor(kind: EvKind, k: number): string {
  const pool = KIND_MODELS[kind]
  return k < pool.length ? pool[k]! : FLAG_KEY
}

/** 변주 상한 — 너무 크면 "물건이 부서졌나"가 되고, 너무 작으면 복제로 남는다 */
export const VARIANT = {
  /** 크기 ±12% */
  scaleSpread: 0.12,
  /** 바닥에 놓인 것의 기울기(rad) — 넘어졌거나 기대 있는 각 */
  tiltMax: 0.22,
  /** 벽 부착물이 정면(방 중심)에서 흔들리는 폭(rad) — 사람이 대충 단 각도 */
  mountJitter: 0.26,
} as const

/**
 * **증거 id 로 결정되는 자세.** 순번이 아니라 id 를 쓰는 이유: 수거하면 목록이 줄어드는데,
 * 순번 기반이면 남은 물건들의 생김새가 그때마다 바뀐다(같은 판에서 물건이 변신한다).
 * FNV-1a 해시 — Math.random 금지 규칙 아래서 "무작위처럼 보이는 결정론"을 만든다.
 */
export function variantFor(id: string): { yaw: number; tilt: number; tiltDir: number; scale: number } {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const u = (shift: number, mod: number): number => ((h >>> shift) % mod) / mod
  return {
    yaw: u(0, 3600) * Math.PI * 2,
    tilt: u(11, 1000) * VARIANT.tiltMax,
    tiltDir: u(19, 3600) * Math.PI * 2,
    scale: 1 + (u(23, 1000) * 2 - 1) * VARIANT.scaleSpread,
  }
}
