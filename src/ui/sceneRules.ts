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
import type { PlaceId } from '../types'

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
  /** 이동 속도 m/s — 걷기 클립일 때 (explore3d 와 같은 빠른 걸음) */
  speed: 2.2,
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

/* ─────────── 방 배치 (기획서 §A — 12×9m 추상 현장) ───────────
 * 지오메트리는 하나, 라벨은 월드가 소유한다(기획서 위험 §2). 좌표는 전부 미터.
 */

export const SCENE_ROOM = { minX: -6, maxX: 6, minZ: -4.5, maxZ: 4.5 } as const

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
 */
export const SCENE_BOXES: readonly Box[] = [
  { x: 0, z: -2.9, hx: 0.7, hz: 0.7, h: 0.95, kind: 'pedestal' },
  { x: -1.9, z: 0.6, hx: 1.3, hz: 0.14, h: 1.8, kind: 'partition' },
  { x: 2.5, z: -0.9, hx: 0.14, hz: 1.2, h: 1.8, kind: 'partition' },
  { x: -4.7, z: -3.5, hx: 0.42, hz: 0.42, h: 0.8, kind: 'crate' },
  { x: -3.8, z: -3.7, hx: 0.42, hz: 0.42, h: 0.55, kind: 'crate' },
  { x: -4.4, z: -2.6, hx: 0.42, hz: 0.42, h: 1.1, kind: 'crate' },
  { x: 5.1, z: -0.2, hx: 0.42, hz: 0.42, h: 0.8, kind: 'crate' },
  { x: 5.3, z: 1.0, hx: 0.42, hz: 0.42, h: 0.6, kind: 'crate' },
  { x: 4.6, z: 3.4, hx: 0.95, hz: 0.4, h: 1.05, kind: 'desk' },
] as const

/** 현장 받침대(발견 지점) 위치 — 접근하면 서술 1줄이 뜬다. 줍는 물건이 아니다. */
export const PEDESTAL_AT: readonly [number, number] = [0, -2.9]

/** 플레이어 시작 위치 — 입구 쪽 */
export const SCENE_START: readonly [number, number] = [0, 3.6]

/**
 * 장소(PlaceId 0~4) → 방 안 앵커. **규칙이 아니라 배치다** — 어느 기록이 어느
 * 장소인지는 `evidence.place` 가 정했고, 여기서는 그 다섯 구역을 방에 편다.
 * 현장(2번)은 받침대 곁이다.
 */
export const SCENE_PLACE_AT: readonly [number, number][] = [
  [-4.3, 2.6],   // 0 로비 — 입구 왼쪽
  [4.0, 2.2],    // 1 복도 — 입구 오른쪽, 데스크 곁
  [-1.5, -3.3],  // 2 현장 — 받침대 곁 (받침대 안이면 못 줍는다)
  [-4.6, -1.3],  // 3 계단 — 상자 더미 곁
  [3.8, -3.2],   // 4 라운지 — 오른쪽 안쪽
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
