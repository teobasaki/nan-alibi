/**
 * 「30초의 현장」 — **감식반이 철수하기 전, 현장을 마지막으로 밟는 30초.**
 *
 * ## explore3d 와의 관계
 * 문법(정사영 탑다운·WASD/E/V·nearestWithin·마커 실루엣·`e.code` 입력)은 그대로 가져오고
 * 공간만 다르다: 경찰서는 26만 삼각형 실측 모델이라 벽 격자를 **구웠지만**, 이 방은
 * 프리미티브 12×9m 라 충돌이 **표(SCENE_BOXES) 조회**로 끝난다. 굽는 코드가 없는 게 맞다.
 *
 * ## 규칙을 계산하지 않는다 (explore3d 와 같은 경계)
 * 이 모듈은 시계와 그림만 소유한다. 무엇을 주울 수 있는지·주우면 무슨 일이 나는지는
 * 전부 main.ts 가 engine 에 물어서 정하고, 여기는 `onPick` 으로 알리기만 한다.
 * 시간 상태기계·압박 곡선도 이 파일 것이 아니다 — `sceneRules.ts` 가 소유한다
 * (3D 는 테스트가 못 닿으므로, 틀리면 자원을 잃는 판정은 전부 순수 계층에 있다).
 *
 * ## 비동기 로드 + 재진입 (explore3d 가 밟은 함정)
 * 씬은 한 번만 만들고(main 의 `mounting` 가드), 로드가 끝났을 때 이미 떠났으면
 * 그대로 버린다. setMarkers 는 동기라 seatEpoch 같은 토큰은 필요 없지만,
 * **로드 완료 콜백은 반드시 생존 여부를 먼저 본다.**
 */

import * as THREE from 'three'
import { groundIt, measuredHeight } from './skinBounds'
import { nearestWithin, unrollLegs } from './explore3d'
import { play } from './sound'
import {
  DEATH_AT, FLAG_KEY, GALLERY_OFFSET, SCENE_BOXES, SCENE_FX, SCENE_ROOM, SCENE_START,
  clipRateFor, moveSpeedFor, phaseAt, pulseAt, rampTo, remainMs, sceneBlocked, variantFor, vignetteAt,
  VARIANT, type ScenePhase,
} from './sceneRules'

/**
 * 새 효과음 키(tick·heartbeat·whistle·snap·pickup)는 메인 세션이 sound.ts 에 배선한다.
 * 파일이 이미 있으면 `play` 의 파일 우선 경로가 그대로 재생하고, 키도 파일도 없으면
 * 조용히 아무 일도 없다 — **없어도 죽지 않는 구조**라 여기서는 이름만 부른다.
 */
const sfx = (k: string): void => play(k as Parameters<typeof play>[0])

export interface SceneMarker {
  id: string
  label: string
  kind: 'keycard' | 'cctv' | 'call' | 'receipt' | 'autopsy'
  /** 범행 시각 기록 — 사람을 지우는 유일한 것이라 붉다 (explore3d 와 같은 규약) */
  crime: boolean
  /** 봉인(requires 미충족) — 주워 담아도 열람은 기존 사슬이다 */
  sealed: boolean
  /** 방 안 위치. main 이 spawnAnchored 로 정해서 넘긴다 — 화면과 판정이 같은 값을 본다 */
  at: [number, number]
  /** 부양 높이(m) — 없으면 바닥 기본(MARK_Y). cctv 벽 부착은 2.2~2.6 이 온다 */
  y?: number
  /** 벽·가구 부착 — 서 있을 수 없는 자리가 정상이므로 도달성 재배치(spotFor)를 건너뛴다 */
  mounted?: boolean
  /**
   * 입을 실모델 키 (`props/ev-<키>.opt.glb`). 없으면 kind 이름으로 떨어진다.
   * 같은 kind 라도 순번대로 다른 모델을 입는다 — cctv 는 카메라 ↔ 필름 릴,
   * 풀을 소진하면 증거 깃발(FLAG_KEY)이다.
   */
  model?: string
}

export interface SceneHandlers {
  /** E/클릭으로 집겠다고 한 것 — 규칙(가능한가·가방·스왑)은 main+engine 이 정한다 */
  onPick(id: string): void
  /** 시간 종료(화이트아웃까지 끝난 뒤) 또는 [철수] 버튼 — 둘은 같은 문이다 */
  onDone(reason: 'time' | 'exit'): void
}

/** 가방 한 칸의 표시 정보 — 라벨은 월드 어휘를 지나 main 이 만들어 넘긴다 */
export interface BagItem {
  kind: string
  /** 슬롯 약칭 (kind 아이콘이 없을 때 보인다) */
  short: string
  /** hover 툴팁·1~5키 확인용 전체 이름 */
  full: string
}

export interface CrimeScene {
  dispose(): void
  /** 남은 증거품 갱신 — 주운 것은 사라지고, 스왑으로 내려놓은 것은 되살아난다 */
  setMarkers(list: SceneMarker[]): void
  /** 가방 표시 갱신 — 폴라로이드가 꽂힌다. 칸마다 아이콘/약칭 + 툴팁 */
  setBag(items: BagItem[], capacity: number): void
  /** 수거 토스트 — "확보 — 카메라 기록 · 21:16" 이 1.5초 뜬다 (무엇을 얻었는지의 직관) */
  toast(text: string): void
  /** 스왑 시간 비용 등 — 시계에 ms 를 얹는다 */
  addPenalty(ms: number): void
  /**
   * 수거 연출 — 그 자리에서 가방 슬롯으로 포물선 비행, 착지에 snap (60 Seconds! 해치 투척).
   * **setMarkers 로 마커가 지워지기 전에** 불러야 출발 좌표가 남아 있다.
   */
  flyFrom(id: string): void
  /** 수거 몸동작 원샷 — 0.45s 이동 잠금 후 걷기/달리기 복귀. 클립이 없으면 아무 일 없다. */
  playPickup(): void
  /** 안내줄(봉인·가방 가득 등) — 힌트바에 잠깐 띄운다 */
  note(text: string): void
  /**
   * 가방이 가득할 때의 선택 — 씬이 DOM 을 그리고 main 이 규칙을 정한다.
   * choose(null) = 그대로 둔다. 시계는 멈추지 않는다 (60 Seconds! 의 문법).
   */
  openSwap(items: { id: string; label: string }[], pickLabel: string, choose: (dropId: string | null) => void): void
}

/** 액터 후보(joe·pi)의 클립만 싣는다 — explore3d 의 CHAR 와 같은 이유(dist 복제 방지) */
const CHAR = import.meta.glob([
  '/public/characters/joe.walk.opt.glb',
  '/public/characters/pi.walk.opt.glb',
], {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const WALK_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(CHAR)) {
  const slug = p.split('/').pop()?.replace('.walk.opt.glb', '')
  if (slug) WALK_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

/**
 * 달리기 클립 — 30초 압박에 걷기는 태평하다. `<slug>.run.opt.glb` 이 있으면 그것,
 * 없으면(manager 등) 걷기로 떨어진다 — 속도도 클립에 맞춰 함께 떨어진다.
 * run 도 walk 와 같은 리그 결함(다리 본 8개 180° 롤)이라 unrollLegs 를 그대로 지난다.
 */
const RUN = import.meta.glob([
  '/public/characters/joe.run.opt.glb',
  '/public/characters/pi.run.opt.glb',
], {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const RUN_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(RUN)) {
  const slug = p.split('/').pop()?.replace('.run.opt.glb', '')
  if (slug) RUN_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

/**
 * 물건 집기 클립(`<slug>.pickup.opt.glb`) — E 수거 순간 원샷.
 * 같은 리그의 다른 파일이라 **클립만 뽑아 액터의 mixer 에 얹는다** (본 이름으로 바인딩).
 * unrollLegs 의 rest 기준은 그 파일 자신의 씬이다 — 액터는 이미 움직인 뒤라 rest 가 아니다.
 *
 * turn180 클립은 도착해 있지만 **배선하지 않는다**: 이 씬의 조향은 12rad/s 보간이라
 * 클릭 이동마다 방향이 수시로 뒤집히고, 급반전 원샷이 그때마다 걸리면 달리기가
 * 덜컥거린다. 코디네이터가 생략을 허용한 항목이다 (판단 기록: ADR 026).
 */
const PICKUP = import.meta.glob([
  '/public/characters/joe.pickup.opt.glb',
  '/public/characters/pi.pickup.opt.glb',
], {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const PICKUP_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(PICKUP)) {
  const slug = p.split('/').pop()?.replace('.pickup.opt.glb', '')
  if (slug) PICKUP_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

/**
 * 증거품 빌보드 아이콘 — `public/evidence/<kind>.webp` (연필 스케치 512px, 메인 세션 생성).
 * **없으면 기존 프리미티브 마커가 그대로 돈다** — 인물 사진·효과음과 같은 에셋 0 원칙.
 * import.meta.glob 은 빌드 타임에 실제 파일만 잡으므로 폴더가 비면 이 맵도 빈다.
 */
const EVIDENCE_FILES = import.meta.glob('/public/evidence/*.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const ICON_BY_KIND = new Map<string, string>()
for (const [p, url] of Object.entries(EVIDENCE_FILES)) {
  const k = p.split('/').pop()?.replace('.webp', '')
  if (k) ICON_BY_KIND.set(k, (url as string).replace(/^\/public/, ''))
}

/**
 * 진짜 갤러리 방 (`public/room/gallery.opt.glb`, 원본 23MB → 1.8MB 최적화).
 * 없으면 프리미티브 방이 그대로 돈다 — 경찰서(station)와 같은 에셋 0 원칙.
 */
const GALLERY_URL = (Object.values(
  import.meta.glob('/public/room/gallery.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string | undefined)?.replace(/^\/public/, '')

/**
 * 대기 클립(`<slug>.idle.opt.glb`) — 정지 상태의 기본. 걷기 0프레임 A포즈가
 * "리깅 안 돼 있다" 로 읽히던 것의 수리다. pickup 과 같은 방식으로 클립만 얹는다.
 */
const IDLE = import.meta.glob([
  '/public/characters/joe.idle.opt.glb',
  '/public/characters/pi.idle.opt.glb',
], {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const IDLE_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(IDLE)) {
  const slug = p.split('/').pop()?.replace('.idle.opt.glb', '')
  if (slug) IDLE_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

/**
 * 증거품 실모델 (`public/props/ev-<kind>.opt.glb`) — 표현 서열: **실모델 > 빌보드 > 프리미티브.**
 * 없는 kind(keycard 봉인 봉투 등)는 아래 단계가 그대로 받는다 — 에셋 0 원칙.
 * crate.opt.glb 는 증거품이 아니라 지형 소품(운송 상자 더미)의 옷이다.
 */
const PROP_FILES = import.meta.glob('/public/props/ev-*.opt.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const PROP_BY_KEY = new Map<string, string>()
for (const [p, url] of Object.entries(PROP_FILES)) {
  const k = p.split('/').pop()?.replace(/^ev-/, '').replace('.opt.glb', '')
  if (k) PROP_BY_KEY.set(k, (url as string).replace(/^\/public/, ''))
}

const CRATE_URL = (Object.values(
  import.meta.glob('/public/props/crate.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string | undefined)?.replace(/^\/public/, '')

/** 사망 지점 연출 — 조각상 아래 fallscene (30KB). 없으면 테이프 윤곽+서류 폴백이 선다 */
const FALLSCENE_URL = (Object.values(
  import.meta.glob('/public/props/fallscene.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string | undefined)?.replace(/^\/public/, '')

const ACTOR_HEIGHT = 1.78
const EYE_HEIGHT = 1.64
const MARK_Y = 0.8
const TURN = 2.4
/** 증거품 실모델의 목표 최대 치수(m) — 0.5m 급 소품 × 과장 1.6배 규칙 */
const PROP_TARGET = 0.85
/**
 * Mixamo **네이티브 베이크** 액터 — 리그 결함 0 이라 다리 축 보정(unrollLegs)을
 * 걸지 않는다 (걸면 멀쩡한 다리를 뒤집는다). 리타게팅 슬러그(security 등)는 보정 유지.
 */
const NATIVE_SLUGS = new Set(['joe'])
/** 현장 액터 서열 — **Joe 확정** (사용자 결정 1). 기존 슬러그 액터는 폴백. */
const ACTOR_PREFERENCE: readonly string[] = ['joe']
/** 사망 지점 fallscene 실모델의 목표 최대 평면 치수(m) — 사람 하나가 쓰러진 자리 크기 */
const FALL_TARGET = 2.2
/** fallscene 잿빛 틴트 — 유혈 요소가 있어도 톤이 죽는다 (골든 케이스 §4, 부분 숨김 불가한 단일 메시) */
const FALL_TINT = 0x77716a
const FALL_TINT_K = 0.55
/** keycard 메탈 박스의 잿빛 틴트 — futuristic 톤을 무대(불 꺼진 갤러리)에 맞춰 누른다 */
const KEYCARD_TINT = 0x8a8478
const KEYCARD_TINT_K = 0.6
/**
 * 1인칭 수거 시선 하강(m) — 몸이 안 보이는 시점에서는 카메라가 "숙인다"를 진다.
 * pickup 잠금(0.45s) 동안 사인 곡선으로 내려갔다 돌아온다. 모션 축소면 없다.
 */
const PICKUP_EYE_DIP = 0.38
/** 회중시계 부채꼴·침의 각도 양자화 폭 — 0.25°. 이보다 곱게 쓰면 프레임마다 SVG 페인트다 */
const HUD_ANG_STEP = Math.PI / 720
/**
 * **한 프레임이 적분할 수 있는 최대 시간(초).** 20fps 바닥 — 이 위의 프레임은 손해가 없고,
 * 밑으로 떨어진 프레임(히치·GC·탭 복귀)만 잔여 거리를 버린다. 순간이동의 상한이 이 값이다:
 * 조감 3.4m/s × 0.05s = 17cm. 충돌 서브스텝(0.05s)과 같은 눈금이라 조각도 한 번이면 끝난다.
 */
const STEP_CAP = 0.05

/** 씬 팔레트 — style.css 의 세계(불 꺼진 갤러리)와 같은 계열 */
const COL = {
  floor: 0x241a17, wall: 0x2e2023, crate: 0x4a3524, desk: 0x3a2b25,
  pedestal: 0x585048, partition: 0x413036, tape: 0xc8b03a,
  amber: 0xc8912f, red: 0xb3372c,
} as const

export async function mountCrimeScene(
  host: HTMLElement,
  slug: string,
  calm: boolean,
  pedestalLine: string,
  handlers: SceneHandlers,
): Promise<CrimeScene | null> {
  try {
    const w = host.clientWidth || innerWidth
    const hgt = host.clientHeight || innerHeight
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    renderer.setSize(w, hgt)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    /**
     * **그림자는 한 프레임 걸러 굽는다.** 실측: 조감(3인칭) 한 프레임의 삼각형 44만 중
     * **21만(49%)·드로우콜 52개가 그림자 패스**다. 그런데 이 방에서 움직이는 그림자는
     * 사람 하나뿐이다 — 빛도 벽도 조각상도 30초 내내 그 자리다. 매 프레임 다시 구울
     * 이유가 없다. 걸러 구우면 사람 그림자가 한 프레임 늦는데, 3.4m/s 라도 그 사이
     * 이동은 3cm 라 눈에 잡히지 않는다. 1인칭보다 조감이 무거운 것이 3인칭 버벅임의
     * 정체였으므로, 깎이는 곳도 조감이다.
     */
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x120d0c)

    /**
     * 정사영 — 방 전체가 한 화면에 들어와야 "어디부터 갈지" 를 고른다 (60 Seconds! 문법).
     * 경찰서(31.8m)는 따라다녔지만 이 방은 12×9m 라 **고정 카메라로 다 보인다** —
     * 따라다니면 오히려 남은 증거의 전모가 안 보여 포기가 선택이 못 된다.
     */
    const VIEW = 15
    const camera = new THREE.OrthographicCamera(
      -VIEW * (w / hgt) / 2, VIEW * (w / hgt) / 2, VIEW / 2, -VIEW / 2, 0.1, 200)
    const CAM_R = Math.hypot(12, 12)
    const camAngle0 = Math.atan2(9, 9)
    const CX = (SCENE_ROOM.minX + SCENE_ROOM.maxX) / 2   // 홀 중심 — 갤러리 홀은 원점 중심이 아니다
    const CZ = (SCENE_ROOM.minZ + SCENE_ROOM.maxZ) / 2
    const placeCam = (ang: number): void => {
      camera.position.set(CX + Math.cos(ang) * CAM_R, 15, CZ + Math.sin(ang) * CAM_R)
      camera.lookAt(CX, 0, CZ)
    }
    placeCam(camAngle0)

    /** 1인칭 눈 — explore3d 와 같은 화각·이유 */
    const eye = new THREE.PerspectiveCamera(60, w / hgt, 0.08, 100)

    /* ── 로더는 방·액터·클립이 같이 쓴다 — 한 번만 만든다 ── */
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')
    const draco = new DRACOLoader().setDecoderPath('/draco/')
    const loader = new GLTFLoader().setDRACOLoader(draco)

    const mat = (color: number, rough = 0.85): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 })

    /**
     * 갤러리 메시를 **격자로 굽는다** — probe-walkgrid 문법 (경찰서 통합 때와 같은 절차).
     * 모서리 래스터화(벽은 XZ 투영 넓이가 0이라 면적 래스터화로는 안 잡힌다),
     * 몸통 높이 띠 0.3~1.9m. 바닥 판정은 굽지 않는다 — 놀이 구역(SCENE_ROOM)을
     * **연속 바닥인 서관 홀 안에서 실측으로 골랐기 때문**이다 (sceneRules 주석·bbox 실측).
     */
    const CELL = 0.5
    const GW = Math.ceil((SCENE_ROOM.maxX - SCENE_ROOM.minX) / CELL) + 1
    const GH = Math.ceil((SCENE_ROOM.maxZ - SCENE_ROOM.minZ) / CELL) + 1
    const solid = new Uint8Array(GW * GH)
    const gi = (x: number, z: number): number =>
      Math.round((z - SCENE_ROOM.minZ) / CELL) * GW + Math.round((x - SCENE_ROOM.minX) / CELL)
    const inGrid = (x: number, z: number): boolean =>
      x >= SCENE_ROOM.minX && x <= SCENE_ROOM.maxX && z >= SCENE_ROOM.minZ && z <= SCENE_ROOM.maxZ

    const bakeWalls = (root: THREE.Object3D): number => {
      const WALL_LO = 0.3
      const WALL_HI = 1.9
      const a = new THREE.Vector3()
      const b = new THREE.Vector3()
      const p = new THREE.Vector3()
      const v0 = new THREE.Vector3()
      const v1 = new THREE.Vector3()
      const v2 = new THREE.Vector3()
      root.updateMatrixWorld(true)
      const stamp = (): void => {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dz = b.z - a.z
        // 세로 모서리(기둥)도 놓치지 않는다 — 2D 길이만 보면 표본이 1개다 (explore3d 실측)
        const steps = Math.max(1,
          Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)),
          Math.ceil(Math.abs(dy) / (CELL * 0.5)))
        for (let k = 0; k <= steps; k++) {
          const t = k / steps
          p.set(a.x + dx * t, a.y + dy * t, a.z + dz * t)
          if (p.y < WALL_LO || p.y > WALL_HI) continue
          if (!inGrid(p.x, p.z)) continue
          solid[gi(p.x, p.z)] = 1
        }
      }
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        // 조상까지 본다 — 숨긴 천장을 벽으로 구우면 안 된다 (explore3d 와 같은 함정)
        for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return
        /**
         * **걷는 면과 장식 레일은 굽지 않는다** (격자 실측으로 잡은 함정).
         * floor 는 단차 테두리가 y 0.3~0.54 로 몸통 띠에 걸리고, corner(픽처레일 몰딩)는
         * z=±2.5 에서 홀을 **전폭으로 가로지르는 벽**이 되어 시작점이 6.5m² 에 갇혔다 —
         * 도달성 BFS 가 마커 10개 전부 unreachable 을 찍었다. 벽·가구·조각상만 굽는다.
         */
        if (/floor|stairs|corner/i.test(m.name)) return
        const pos = m.geometry.getAttribute('position')
        if (!pos) return
        const idx = m.geometry.getIndex()
        const count = idx ? idx.count : pos.count
        for (let i = 0; i < count; i += 3) {
          v0.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld)
          v1.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld)
          v2.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld)
          const lo = Math.min(v0.y, v1.y, v2.y)
          const hi = Math.max(v0.y, v1.y, v2.y)
          if (hi < WALL_LO || lo > WALL_HI) continue
          /**
           * **면을 굽는다 — 모서리 3개만 찍으면 로우폴리 벽이 뚫린다** (실플레이로 잡은 구멍).
           * 갤러리의 흰 파티션은 삼각형 2개짜리 8m 벽이라, 모서리만 찍으면 아래변(띠 밖)·
           * 윗변(띠 밖)·대각선 일부만 남고 **중간이 통째로 비어** 그대로 걸어 나갈 수 있었다.
           * 경찰서가 멀쩡했던 건 그 GLB 가 잘게 쪼개져 모서리만으로도 덮였기 때문 — 운이었다.
           * v2 를 향해 v0→v1 현을 좁혀 가며 스탬프해 삼각형 내부를 전부 칠한다.
           */
          const sweeps = Math.max(1, Math.ceil(
            Math.max(v0.distanceTo(v2), v1.distanceTo(v2)) / (CELL * 0.5)))
          for (let s = 0; s <= sweeps; s++) {
            const u = s / sweeps
            a.copy(v0).lerp(v2, u)
            b.copy(v1).lerp(v2, u)
            stamp()
          }
        }
      })
      let n = 0
      for (const c of solid) if (c) n++
      return n
    }

    /** 분석 경계·소품 상자 + 구운 격자 — 이동·스폰 보정이 같은 값을 본다 */
    const blockedAt = (x: number, z: number): boolean =>
      sceneBlocked(x, z) || (inGrid(x, z) && solid[gi(x, z)] === 1)

    /**
     * **걷는 면의 world y 를 잰다** — 상수를 믿지 않고 모델에게 묻는다.
     * 위에서 아래로 광선을 쏴 `floor` 노드의 윗면을 맞힌다. 놀이 구역 안 세 점의
     * 중앙값이라 한 점이 단차·계단에 걸려도 흔들리지 않는다. 못 재면 null —
     * 그때는 아무것도 하지 않는다 (보정이 오히려 위험하다).
     */
    const measureWalkY = (room: THREE.Object3D): number | null => {
      room.updateMatrixWorld(true)
      const floors: THREE.Object3D[] = []
      room.traverse((o) => { if ((o as THREE.Mesh).isMesh && /floor/i.test(o.name)) floors.push(o) })
      if (!floors.length) return null
      const rc = new THREE.Raycaster()
      rc.far = 60
      const down = new THREE.Vector3(0, -1, 0)
      const from = new THREE.Vector3()
      const ys: number[] = []
      for (const [px, pz] of [SCENE_START, [CX, CZ], DEATH_AT] as [number, number][]) {
        from.set(px, 30, pz)
        rc.set(from, down)
        const hit = rc.intersectObjects(floors, false)[0]
        if (hit) ys.push(hit.point.y)
      }
      if (!ys.length) {
        // 광선이 뒷면(FrontSide 재질)을 못 맞히는 GLB 도 있다 — 그때는 바닥 노드의 윗면으로 떨어진다
        const bb = new THREE.Box3()
        for (const f of floors) bb.expandByObject(f)
        return Number.isFinite(bb.max.y) ? bb.max.y : null
      }
      ys.sort((a, b) => a - b)
      return ys[Math.floor(ys.length / 2)]!
    }

    /** 갤러리 루트 — DEV 계측(그림자 A/B)이 밖에서 잡는다 */
    let galleryRoom: THREE.Object3D | null = null

    if (GALLERY_URL) {
      /* ── 진짜 갤러리 — 서관 홀을 실측 오프셋으로 y=0 바닥에 맞춘다 (sceneRules 주석) ── */
      const g = await loader.loadAsync(GALLERY_URL)
      const room = g.scene
      galleryRoom = room
      room.position.set(GALLERY_OFFSET[0], GALLERY_OFFSET[1], GALLERY_OFFSET[2])
      /**
       * **바닥 묻힘의 수리 — 걷는 면을 실측해 y=0 으로 내린다.**
       * 이 방의 배치는 전부 "바닥은 y=0" 을 전제로 계산한다 (액터 `groundIt`, 상자 접지,
       * 테이프 0.02, 마커 `MARK_Y`, 눈높이 `EYE_HEIGHT`). 그런데 실측하면 서관 홀의
       * 걷는 면은 **y=0.538** 이었다 — 발이 0 에 놓이니 무릎(약 0.48m)까지 잠긴다.
       * 1인칭이 기본이라 몸이 안 보였고, **V 조감(3인칭)에서만 드러나** 오래 숨어 있었다.
       * 상수(GALLERY_OFFSET[1])를 고치지 않고 여기서 재서 내리는 이유: GLB 가 갈리면
       * 상수는 다시 틀리지만 실측은 따라간다. 격자를 굽기 **전**에 내려야 벽 띠(0.3~1.9m)도
       * 걷는 면 기준이 된다.
       */
      const walkY = measureWalkY(room)
      if (walkY !== null && Math.abs(walkY) > 0.02) {
        room.position.y -= walkY
        if (import.meta.env.DEV) {
          console.info(`[현장] 걷는 면 ${walkY.toFixed(3)}m 실측 — 바닥을 y=0 으로 내렸다`)
        }
      }
      room.traverse((o) => {
        // 탑다운이므로 머리 위 구조물은 숨긴다 — 경찰서의 CEILING_HIDE 와 같은 이유
        if (/ceiling|skylight|^lights/i.test(o.name)) o.visible = false
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.receiveShadow = true
        m.castShadow = true
        // 갤러리의 emissive(창·조명 텍스처)는 살린다 — 어둡다는 체감의 반대 방향으로
      })
      scene.add(room)
      const t0 = performance.now()
      const n = bakeWalls(room)
      if (import.meta.env.DEV) {
        console.info(`[현장] 갤러리 격자 ${GW}x${GH} · 막힌 칸 ${n} · ${Math.round(performance.now() - t0)}ms`)
        /**
         * 충돌 **역방향 검증** — "걸을 수 없는 곳이 정말 막혔는가". 도달성 probe(전부
         * 닿는가)는 격자가 통째로 비어도 통과해 버린다 — 조인 재활성·노드 개명으로
         * 베이크가 조용히 죽는 사고는 이 줄이 잡는다. 좌표는 GLB 노드 실측+오프셋.
         */
        const holes: string[] = []
        if (!blockedAt(9.4, -0.1)) holes.push('조각상(9.4,-0.1)')
        // 벤치 좌표는 정점 클러스터 실측 — 노드 원점(벤치 사이 빈 바닥)을 찍으면 오탐이다
        if (!blockedAt(-2.0, 5.0)) holes.push('벤치(-2.0,5.0)')
        if (!blockedAt(3.4, -1.2)) holes.push('파티션(3.4,-1.2)')
        if (holes.length) console.warn(`[현장] 충돌 역검증 실패 — 뚫림: ${holes.join(' · ')}`)
        else console.info('[현장] 충돌 역검증 통과 — 조각상·벤치·파티션 막힘')
      }
    } else {
      /* ── 폴백 — 프리미티브 방. 에셋이 없어도 게임은 선다 ── */
      const RW = SCENE_ROOM.maxX - SCENE_ROOM.minX + 0.6
      const RD = SCENE_ROOM.maxZ - SCENE_ROOM.minZ + 0.6
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), mat(COL.floor, 0.95))
      floor.rotation.x = -Math.PI / 2
      floor.position.set(CX, 0, CZ)
      floor.receiveShadow = true
      scene.add(floor)
      const wallMat = mat(COL.wall, 0.9)
      const mkWall = (wx: number, wz: number, sx: number, sz: number, h = 3): void => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), wallMat)
        m.position.set(wx, h / 2, wz)
        m.receiveShadow = true
        scene.add(m)
      }
      mkWall(CX, SCENE_ROOM.minZ - 0.15, RW, 0.3)               // 뒷벽
      mkWall(SCENE_ROOM.minX - 0.15, CZ, 0.3, RD)               // 좌벽
      // 컷어웨이 — 카메라 쪽 두 벽은 낮춘다 (보여야 고를 수 있다)
      mkWall(SCENE_ROOM.maxX + 0.15, CZ, 0.3, RD, 0.5)
      mkWall(CX, SCENE_ROOM.maxZ + 0.15, RW, 0.3, 0.5)
    }

    /**
     * 증거품 실모델 프로토 — mount 중 한 번씩 받아 두면 setMarkers 가 동기로 복제한다.
     * bbox 실측으로 최대 치수를 PROP_TARGET(0.85m — 0.5m 급 × 과장 1.6배)에 정규화.
     */
    const propProto = new Map<string, { obj: THREE.Object3D; scale: number }>()
    await Promise.all([...PROP_BY_KEY.entries()].map(async ([key, url]) => {
      try {
        const g = await loader.loadAsync(url)
        const size = new THREE.Vector3()
        new THREE.Box3().setFromObject(g.scene).getSize(size)
        const maxD = Math.max(size.x, size.y, size.z)
        g.scene.traverse((o) => {
          const mm = o as THREE.Mesh
          if (mm.isMesh) { mm.castShadow = true }
        })
        propProto.set(key, { obj: g.scene, scale: maxD > 0 ? PROP_TARGET / maxD : 1 })
      } catch { /* 이 키는 빌보드/프리미티브가 받는다 */ }
    }))

    /**
     * **증거 깃발** (FLAG_KEY) — 실모델 풀을 소진한 초과분의 표현. 감식 텐트 카드
     * (Λ, 숫자 없음) + 발치에 기대 놓은 폴라로이드 + 작은 깃발. 에셋 파일이 아니라
     * 프리미티브로 세운다 — 프로토 표에 넣어 두면 복제·재질 복제·자세 변주·근접
     * 하이라이트가 실모델과 **같은 경로**로 돈다. "무엇인지"는 라벨·힌트가 말한다.
     */
    {
      const flag = new THREE.Group()
      const card = new THREE.MeshStandardMaterial({ color: COL.tape, roughness: 0.75, side: THREE.DoubleSide })
      const lean = 0.42                              // 텐트 카드가 벌어진 반각(rad)
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.27), card)
        p.rotation.x = s * (Math.PI / 2 - lean)
        p.position.set(0, 0.115, s * 0.055)
        p.castShadow = true
        flag.add(p)
      }
      const photoBack = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9, side: THREE.DoubleSide }))
      photoBack.rotation.x = -0.5
      photoBack.position.set(0.21, 0.1, 0.1)
      const photoIn = new THREE.Mesh(
        new THREE.PlaneGeometry(0.15, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.95, side: THREE.DoubleSide }))
      photoIn.rotation.x = -0.5
      photoIn.position.set(0.21, 0.117, 0.102)
      flag.add(photoBack, photoIn)
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.56, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.6, metalness: 0.4 }))
      pole.position.set(-0.16, 0.28, -0.06)
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), card)
      banner.position.set(-0.06, 0.5, -0.06)
      flag.add(pole, banner)
      propProto.set(FLAG_KEY, { obj: flag, scale: 1 })
    }

    // 장애물 — 충돌 표(SCENE_BOXES)와 **같은 표**로 그린다. 보이는 것과 막히는 것이 같아야 한다.
    // 운송 상자는 실모델(crate.opt.glb)이 있으면 그 옷을 입는다 — 충돌은 여전히 표가 정한다.
    let crateProto: { obj: THREE.Object3D; scale: number } | null = null
    if (CRATE_URL) {
      try {
        const g = await loader.loadAsync(CRATE_URL)
        const size = new THREE.Vector3()
        new THREE.Box3().setFromObject(g.scene).getSize(size)
        const maxH = Math.max(size.x, size.z)
        g.scene.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.castShadow = true })
        crateProto = { obj: g.scene, scale: maxH > 0 ? 1 / maxH : 1 }
      } catch { /* 프리미티브 상자가 받는다 */ }
    }
    const boxMat: Record<string, THREE.MeshStandardMaterial> = {
      pedestal: mat(COL.pedestal, 0.7), partition: mat(COL.partition, 0.85),
      crate: mat(COL.crate, 0.9), desk: mat(COL.desk, 0.75),
    }
    for (const b of SCENE_BOXES) {
      if (b.kind === 'crate' && crateProto) {
        const c = crateProto.obj.clone()
        c.scale.setScalar(crateProto.scale * b.hx * 2)
        const bb = new THREE.Box3().setFromObject(c)
        c.position.set(b.x, -bb.min.y, b.z)      // 바닥에 접지
        scene.add(c)
        continue
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), boxMat[b.kind]!)
      m.position.set(b.x, b.h / 2, b.z)
      m.castShadow = true
      m.receiveShadow = true
      scene.add(m)
    }

    /* ── 사망 지점 — **조각상 아래** (사용자 결정 3, 현장 보존 연출) ──
     * fallscene 실모델(30KB)을 잿빛으로 눌러 놓는다 — 유혈·시신 직접 묘사 금지
     * (골든 케이스 §4). 단일 메시라 부분 숨김이 불가하므로 틴트가 그 대비책이다.
     * 에셋이 없으면 기존 테이프 윤곽이 폴백으로 선다. 흩어진 서류는 항상 남는다. */
    if (FALLSCENE_URL) {
      try {
        const g = await loader.loadAsync(FALLSCENE_URL)
        const size = new THREE.Vector3()
        new THREE.Box3().setFromObject(g.scene).getSize(size)
        const maxD = Math.max(size.x, size.z)
        g.scene.scale.setScalar(maxD > 0 ? FALL_TARGET / maxD : 1)
        const tint = new THREE.Color(FALL_TINT)
        g.scene.traverse((o) => {
          const mm = o as THREE.Mesh
          if (!mm.isMesh) return
          mm.castShadow = true
          mm.receiveShadow = true
          for (const x of (Array.isArray(mm.material) ? mm.material : [mm.material]) as THREE.MeshStandardMaterial[]) {
            x?.color?.lerp(tint, FALL_TINT_K)
          }
        })
        groundIt(g.scene, 0.02)
        g.scene.position.x = DEATH_AT[0]
        g.scene.position.z = DEATH_AT[1]
        scene.add(g.scene)
      } catch { /* 폴백 연출(테이프 윤곽)이 받는다 */ }
    }

    /**
     * 발견 지점 바닥 연출 — 링 테이프 + 흩어진 서류 (시신 없음).
     * 실물 폴리스라인 에셋(crimetape)은 2026-08-10 미사용 결정으로 저장소에서
     * 제거했다 — 프리미티브 링이 본선이다 (에셋 0 원칙).
     */
    {
      const tape = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.05, 4),
        new THREE.MeshBasicMaterial({ color: COL.tape, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
      tape.rotation.x = -Math.PI / 2
      tape.rotation.z = Math.PI / 4
      tape.position.set(DEATH_AT[0], 0.02, DEATH_AT[1] + 0.1)
      scene.add(tape)
      const paperG = new THREE.PlaneGeometry(0.24, 0.32)
      const paperM = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 1, side: THREE.DoubleSide })
      const sheets: [number, number, number][] = [[-0.5, -0.4, 0.4], [0.4, -0.8, 1.8], [0.7, 0.3, 0.9], [-0.2, 0.8, 2.6]]
      for (const [dx, dz, rot] of sheets) {
        const p = new THREE.Mesh(paperG, paperM)
        p.rotation.x = -Math.PI / 2
        p.rotation.z = rot
        p.position.set(DEATH_AT[0] + dx, 0.03, DEATH_AT[1] - 0.9 + dz)
        scene.add(p)
      }
    }

    // 조명 — 갤러리 전시 조명. "너무 어둡다"는 실플레이 체감의 수리:
    // 환경광·키·헤미를 전부 올리고 노출도 1.12 → 1.3. 증거품이 읽히는 밝기가 기준이다.
    renderer.toneMappingExposure = 1.3
    scene.add(new THREE.AmbientLight(0xfff0dc, 1.05))
    const key = new THREE.DirectionalLight(0xfff6e8, 1.8)
    key.position.set(CX + 5, 16, CZ + 4)
    key.target.position.set(CX, 0, CZ)
    scene.add(key.target)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 50
    key.shadow.bias = -0.0008
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0xa8b4c8, 0x2a2018, 0.55))

    /* ── 내 몸 — 걷기 모델. 없으면 프리미티브 실루엣으로라도 선다 (에셋 0 원칙) ── */
    let picked: THREE.Object3D | null = null
    let mixer: THREE.AnimationMixer | null = null
    let walk: THREE.AnimationAction | null = null
    let pickupAction: THREE.AnimationAction | null = null
    let idleAction: THREE.AnimationAction | null = null
    /**
     * 달리기 우선 — 클립과 속도는 한 몸이다. run 이 없거나 **리그가 말이 안 되면**
     * 걷기 클립 + 걷기 속도로 떨어진다.
     *
     * "말이 안 되는 배율은 거부한다" (explore3d 착석 모델의 그 함정): 누운 채 익스포트된
     * 리그는 키가 0.3m 로 재져 배율이 6배가 되고, 방에 드러누운 거인이 나온다 —
     * run 클립 첫 배선에서 실제로 그랬다. 키 1.2~2.5m 밖이면 그 후보를 버린다.
     */
    /**
     * 액터 후보 서열 — **Joe(Mixamo 네이티브 베이크) 우선, 기존 슬러그는 폴백**
     * (사용자 결정 1). 같은 액터 안에서는 달리기 파일 먼저다. 리그 가드(키 1.2~2.5m)는
     * 전 후보가 지난다 — run 첫 배선의 31m 거인(ADR 026 §7)이 이 가드의 존재 이유다.
     * 네이티브 액터가 걷기 몸으로 잡히면 run **클립만** 얹는 2단 폴백이 아래에 있다.
     */
    const prefSlugs = [...new Set([...ACTOR_PREFERENCE, slug])]
    const candidates: { url: string; slug: string; run: boolean }[] = []
    for (const s of prefSlugs) {
      const r = RUN_BY_SLUG.get(s)
      if (r) candidates.push({ url: r, slug: s, run: true })
      const wk = WALK_BY_SLUG.get(s)
      if (wk) candidates.push({ url: wk, slug: s, run: false })
    }
    for (const [s, u] of RUN_BY_SLUG) {
      if (!prefSlugs.includes(s)) { candidates.push({ url: u, slug: s, run: true }); break }
    }
    for (const [s, u] of WALK_BY_SLUG) {
      if (!prefSlugs.includes(s)) { candidates.push({ url: u, slug: s, run: false }); break }
    }
    let moveSpeed: number = SCENE_FX.speed
    let actorSlug = slug
    let native = false
    for (const cand of candidates) {
      const gltf = await loader.loadAsync(cand.url)
      const mh = measuredHeight(gltf.scene)
      if (mh < 1.2 || mh > 2.5) {
        if (import.meta.env.DEV) {
          console.warn(`[현장] ${cand.url} 리그가 이상하다 — 키 ${mh.toFixed(2)}m. 다음 후보로 넘어간다.`)
        }
        continue
      }
      picked = gltf.scene
      actorSlug = cand.slug
      native = NATIVE_SLUGS.has(cand.slug)
      picked.scale.setScalar(ACTOR_HEIGHT / mh)
      moveSpeed = cand.run ? SCENE_FX.runSpeed : SCENE_FX.speed
      picked.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.castShadow = true
        for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          if (!mm) continue
          mm.emissive?.setScalar(0)
          mm.emissiveMap = null
        }
      })
      mixer = new THREE.AnimationMixer(picked)
      const clip = gltf.animations[0]
      if (clip) {
        // Joe(네이티브)에는 다리 축 보정을 걸지 않는다 — 리그 결함 0 (사용자 결정 1)
        if (!native) unrollLegs(clip, picked)
        walk = mixer.clipAction(clip)
        walk.play()
        walk.paused = true
      }
      break
    }

    if (picked && mixer) {
      /**
       * 같은 리그의 다른 파일에서 클립만 뽑는다. rest 는 그 파일 자신의 씬이다.
       * 네이티브 리그는 가드도 보정도 건너뛴다 — 키 가드는 리타게팅 파이프라인의
       * 잔여물(Beta_Surface 등)을 잡는 장치라, 본 이름 바인딩만 하는 클립 인출에는
       * 네이티브에서 오탐(메시 겉껍데기 크기)만 낸다.
       */
      const extraClip = async (url: string | undefined, what: string): Promise<THREE.AnimationClip | null> => {
        if (!url) return null
        try {
          const g2 = await loader.loadAsync(url)
          const clip2 = g2.animations[0]
          if (!clip2) return null
          if (native) return clip2
          const mh2 = measuredHeight(g2.scene)
          if (mh2 >= 1.2 && mh2 <= 2.5) {
            unrollLegs(clip2, g2.scene)
            return clip2
          }
          if (import.meta.env.DEV) {
            console.warn(`[현장] ${url} ${what} 리그가 이상하다 — 키 ${mh2.toFixed(2)}m. ${what} 없이 간다.`)
          }
        } catch { /* 없이 간다 — 규칙은 그대로다 */ }
        return null
      }

      /**
       * 달리기 2단 폴백 — 네이티브 액터가 걷기 몸으로 잡혔다면(run 파일이 키 가드에
       * 걸린 경우) run **클립만** 뽑아 걷기 자리를 통째로 잇는다. 속도와 클립은 한 몸.
       * 클립은 다른 리그에 얹으면 조용히 무효라(본 이름 불일치) 네이티브끼리만 잇는다.
       */
      if (native && moveSpeed !== SCENE_FX.runSpeed) {
        const rClip = await extraClip(RUN_BY_SLUG.get(actorSlug), '달리기')
        if (rClip) {
          walk?.stop()
          walk = mixer.clipAction(rClip)
          walk.play()
          walk.paused = true
          moveSpeed = SCENE_FX.runSpeed
        }
      }

      /* 집기·대기 클립 — 클립의 주인은 **잡힌 액터**(actorSlug)다. 남의 리그 클립은
       * 본 이름이 달라 조용히 무효가 되므로, 네이티브는 자기 것만 쓴다. */
      const pickupUrl = PICKUP_BY_SLUG.get(actorSlug)
        ?? (native ? undefined : PICKUP_BY_SLUG.get(slug) ?? [...PICKUP_BY_SLUG.values()][0])
      const pClip = await extraClip(pickupUrl, '집기')
      if (pClip) {
        pickupAction = mixer.clipAction(pClip)
        pickupAction.setLoop(THREE.LoopOnce, 1)
        /**
         * 잠금 0.45s 안에 클립 앞 55%가 보이도록 재생 속도를 맞춘다 —
         * 클립을 자르는 대신 시간을 접는다 (subclip 은 프레임 수를 알아야 한다).
         */
        const want = pClip.duration * SCENE_FX.pickupPortion
        pickupAction.timeScale = Math.min(3, Math.max(0.8, want / (SCENE_FX.pickupLockMs / 1000)))
      }

      const idleUrl = IDLE_BY_SLUG.get(actorSlug)
        ?? (native ? undefined : IDLE_BY_SLUG.get(slug) ?? [...IDLE_BY_SLUG.values()][0])
      const iClip = await extraClip(idleUrl, '대기')
      if (iClip) {
        idleAction = mixer.clipAction(iClip)
        idleAction.play()                    // 대기가 기본이다 — 숨쉬는 몸이 A포즈를 지운다
        if (walk) { walk.paused = false; walk.setEffectiveWeight(0) }
      }
    }
    if (import.meta.env.DEV) {
      console.info(`[현장] 액터 ${actorSlug}${native ? '(네이티브)' : ''} — ` +
        `이동 ${moveSpeed === SCENE_FX.runSpeed ? '달리기' : '걷기'} ${moveSpeed}m/s · ` +
        `대기 ${idleAction ? '있음' : '없음(0프레임 폴백)'} · 집기 ${pickupAction ? '있음' : '없음'}`)
    }
    // 모든 후보가 없거나 리그가 깨졌다 — 캡슐 실루엣. 게임은 멈추지 않는다.
    const actor: THREE.Object3D = picked ?? (() => {
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.0, 4, 10), mat(0x6b5a4c, 0.6))
      body.position.y = 0.85
      body.castShadow = true
      g.add(body)
      return g
    })()
    actor.position.set(SCENE_START[0], 0, SCENE_START[1])
    // 시작점이 갤러리 가구(구운 격자) 안이면 곁의 빈 자리로 — 첫 발이 막히면 게임이 없다
    if (blockedAt(actor.position.x, actor.position.z)) {
      outer: for (let r = 0.3; r < 5; r += 0.3) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const px = SCENE_START[0] + Math.cos(a) * r
          const pz = SCENE_START[1] + Math.sin(a) * r
          if (!blockedAt(px, pz)) { actor.position.set(px, 0, pz); break outer }
        }
      }
    }
    // 1인칭 기본이라 첫 프레임 시선이 곧 첫인상이다 — 벽(+z 출입문)이 아니라 홀 중심을 보고 선다
    actor.rotation.y = Math.atan2(CX - actor.position.x, CZ - actor.position.z)
    groundIt(actor)
    scene.add(actor)

    /* ── 마커 (explore3d 의 실루엣 문법) ── */
    const markerRoot = new THREE.Group()
    scene.add(markerRoot)
    let markers: SceneMarker[] = []

    /**
     * 실루엣은 explore3d 문법인데 크기는 **실물의 1.6배쯤**이다 — 60 Seconds! 의
     * 수프캔이 얼굴만 한 것과 같은 이유. 아이소메트릭에서 읽혀야 줍고 싶어진다.
     */
    const shapeOf = (k: SceneMarker['kind']): THREE.BufferGeometry => {
      switch (k) {
        case 'cctv': return new THREE.ConeGeometry(0.45, 0.8, 4)
        case 'keycard': return new THREE.BoxGeometry(0.7, 0.08, 0.45)
        case 'call': return new THREE.TorusGeometry(0.35, 0.11, 8, 20)
        case 'autopsy': return new THREE.CylinderGeometry(0.48, 0.54, 0.14, 14)
        default: return new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6)
      }
    }

    /** 봉인 자물쇠 스프라이트 — 캔버스 한 장 (웹폰트 0) */
    const lockTex = ((): THREE.CanvasTexture => {
      const c = document.createElement('canvas')
      c.width = 64; c.height = 64
      const g = c.getContext('2d')!
      g.font = '48px serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('🔒', 32, 36)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()

    /** 아이콘 텍스처 캐시 — 같은 kind 를 다시 받지 않는다 */
    const iconTex = new Map<string, THREE.Texture>()
    const texLoader = new THREE.TextureLoader()
    const iconFor = (kind: string): THREE.Texture | null => {
      const url = ICON_BY_KIND.get(kind)
      if (!url) return null
      let t = iconTex.get(kind)
      if (!t) {
        t = texLoader.load(url)
        t.colorSpace = THREE.SRGBColorSpace
        iconTex.set(kind, t)
      }
      return t
    }

    /**
     * **못 닿는 자리에 놓지 않는다.** 스폰(sceneRules)은 분석 상자만 알고 갤러리의
     * 의자·조각상(구운 격자)은 모른다 — 그 안에 떨어진 마커는 걸어서 영영 못 줍는다.
     * 옮긴 좌표를 `at` 에 되써서 화면과 근접 판정이 같은 자리를 본다 (explore3d 문법).
     */
    const spotFor = (at: [number, number]): [number, number] => {
      if (!blockedAt(at[0], at[1])) return at
      for (let r = 0.3; r < 4; r += 0.3) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const px = at[0] + Math.cos(a) * r
          const pz = at[1] + Math.sin(a) * r
          if (!blockedAt(px, pz)) return [px, pz]
        }
      }
      return at
    }

    /**
     * 마커 노드 구성 집계 — "중복 스폰인가"를 눈이 아니라 숫자로 판정한다.
     * DEV 훅(`__cs.markerStats()`)으로도 나간다.
     */
    const markerStats = (): { bodies: number; halos: number; locks: number; labels: number; total: number; dup: string[] } => {
      const seen = new Map<string, number>()
      let bodies = 0
      let halos = 0
      let locks = 0
      let labels = 0
      for (const c of markerRoot.children) {
        const part = c.userData.part as string | undefined
        if (part === 'halo') halos++
        else if (part === 'lock') locks++
        else if (part === 'label') labels++
        else {
          bodies++
          const id = String(c.userData.id)
          seen.set(id, (seen.get(id) ?? 0) + 1)
        }
      }
      return {
        bodies, halos, locks, labels, total: markerRoot.children.length,
        dup: [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`),
      }
    }

    /**
     * **훑기 라벨 힌트** (승인 UX ②) — 5초 오빗 동안 증거 위치마다 이름표가 뜬다.
     * 훑기는 "무엇을 포기할지"를 고르는 시간인데, 실루엣만 돌면 무엇이 어디 있는지를
     * 몸이 익히기 전에 시계가 돈다. 라벨은 훑기가 끝나는 순간 함께 걷힌다 —
     * 수집 중에는 근접 힌트바가 같은 정보를 말하므로 화면을 어지럽힐 이유가 없다.
     * 캔버스 스프라이트(웹폰트 0)는 explore3d 의 이름표와 같은 문법이다.
     */
    const makeHintLabel = (text: string): THREE.Sprite => {
      const c = document.createElement('canvas')
      c.width = 512
      c.height = 96
      const g = c.getContext('2d')!
      g.fillStyle = 'rgba(13,9,8,.85)'
      g.beginPath()
      // roundRect 는 사파리 16 미만에 없다 — 없으면 각진 판으로 선다. 폴백이 본선이다.
      if (g.roundRect) g.roundRect(4, 16, 504, 64, 12)
      else g.rect(4, 16, 504, 64)
      g.fill()
      g.strokeStyle = '#c8912f'
      g.lineWidth = 3
      g.stroke()
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillStyle = '#e9e1d3'
      g.font = 'bold 34px "Apple SD Gothic Neo", sans-serif'
      g.fillText(text, 256, 50, 480)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      sp.scale.set(2.6, 0.49, 1)
      sp.renderOrder = 9
      return sp
    }

    /** 훑기가 끝났는가 — 끝난 뒤의 setMarkers(수거 갱신)는 라벨을 다시 세우지 않는다 */
    let surveyOver = calm
    const clearHintLabels = (): void => {
      for (const c of [...markerRoot.children]) {
        if (c.userData.part !== 'label') continue
        const sp = c as THREE.Sprite
        sp.material.map?.dispose()
        sp.material.dispose()
        markerRoot.remove(c)
      }
    }

    const setMarkers = (list: SceneMarker[]): void => {
      // 부착 마커(벽 cctv·데스크 위)는 재배치하지 않는다 — 설 수 없는 자리가 정상이다
      markers = list.map((m) => (m.mounted ? { ...m } : { ...m, at: spotFor(m.at) }))
      list = markers
      for (const c of markerRoot.children) {
        const m = c as THREE.Mesh
        // 이름표는 자기 캔버스 텍스처를 갖는다 — 재질만 버리면 그림이 GPU 에 남는다
        if (c.userData.part === 'label') (c as unknown as THREE.Sprite).material.map?.dispose()
        m.geometry?.dispose?.()
        ;((m as unknown as { material?: THREE.Material }).material)?.dispose?.()
        // 실모델 마커 — 지오메트리는 프로토와 공유라 두고, 복제한 재질만 버린다
        if (Array.isArray(c.userData.mats)) for (const mm of c.userData.mats as THREE.Material[]) mm.dispose()
      }
      markerRoot.clear()
      for (const m of list) {
        /**
         * 빌보드 아이콘이 있으면 그것, 없으면 프리미티브 실루엣 — 폴백이 본선이다.
         * 봉인은 회색으로 눌러 두고(틴트 곱), 범행 시각의 붉음은 발치 링이 계속 말한다.
         */
        const proto = propProto.get(m.model ?? m.kind)
        const tex = iconFor(m.kind)
        const baseEm = m.sealed ? 0x241f1a : m.crime ? 0x5a1a14 : 0x4a3410
        const my = m.y ?? MARK_Y
        let g: THREE.Object3D
        if (proto) {
          /* 실모델 — 재질은 인스턴스마다 복제한다: 근접 흰 윤곽빛이 이웃에게 새면 안 된다 */
          g = proto.obj.clone()
          const kcTint = new THREE.Color(KEYCARD_TINT)
          const mats: THREE.MeshStandardMaterial[] = []
          g.traverse((o) => {
            const mm = o as THREE.Mesh
            if (!mm.isMesh) return
            mm.material = Array.isArray(mm.material)
              ? mm.material.map((x) => (x as THREE.Material).clone())
              : (mm.material as THREE.Material).clone()
            for (const x of (Array.isArray(mm.material) ? mm.material : [mm.material]) as THREE.MeshStandardMaterial[]) {
              // keycard 메탈 박스 — futuristic 색을 잿빛으로 눌러 무대 톤에 맞춘다 (사용자 결정 3)
              if (m.kind === 'keycard' && x.color) x.color.lerp(kcTint, KEYCARD_TINT_K)
              if (m.sealed && x.color) x.color.multiplyScalar(0.55)   // 봉인 — 잿빛으로 눌러 둔다
              mats.push(x)
            }
          })
          g.userData.mats = mats
          /**
           * **자세 변주** — 같은 모델이라도 복제로 안 읽히게 (실플레이 체감).
           * 자세는 증거 id 가 정한다(순번이 아니라) — 하나를 주워 목록이 줄어도
           * 남은 물건들이 그 자리에서 변신하지 않는다.
           * · 벽·가구 부착: 방 중심을 보되 사람이 대충 단 만큼 흔들린다. 기울기 없음.
           * · 바닥: 아무 방향으로 놓이고, 넘어졌거나 기대 있는 각으로 살짝 눕는다.
           */
          const v = variantFor(m.id)
          if (m.mounted) {
            g.rotation.y = Math.atan2(CX - m.at[0], CZ - m.at[1])
              + (v.yaw / (Math.PI * 2) * 2 - 1) * VARIANT.mountJitter
          } else {
            g.rotation.y = v.yaw
            g.rotation.x = Math.cos(v.tiltDir) * v.tilt
            g.rotation.z = Math.sin(v.tiltDir) * v.tilt
          }
          g.userData.baseScale = proto.scale * v.scale
          g.scale.setScalar(proto.scale * v.scale)
        } else if (tex) {
          g = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true,
            color: m.sealed ? 0x8a8078 : 0xffffff,
          }))
          g.userData.baseScale = 1.3           // 스프라이트 배율은 월드 크기다 — 펄스가 덮으면 안 된다
          g.userData.spin = true               // 추상 표현은 돈다 — 그것이 "주울 것"의 신호다
          g.scale.setScalar(1.3)
        } else {
          g = new THREE.Mesh(
            shapeOf(m.kind),
            new THREE.MeshStandardMaterial({
              color: m.sealed ? 0x776a5c : m.crime ? COL.red : COL.amber,
              emissive: baseEm,
              roughness: 0.45, metalness: 0.3,
            }))
          g.userData.em = baseEm               // 근접 하이라이트가 되돌릴 기준값
          g.userData.spin = true               // 프리미티브 실루엣도 추상이다 — 돈다
        }
        g.position.set(m.at[0], my, m.at[1])   // 서사 앵커의 높이 — 벽 cctv 2.2~2.6·데스크 위 1.35
        g.userData.id = m.id
        g.userData.part = 'body'               // 구성 집계용 꼬리표 (markerStats)
        g.userData.kind = m.kind
        g.userData.model = proto ? (m.model ?? m.kind) : (tex ? 'billboard' : 'primitive')
        markerRoot.add(g)

        const haloCol = m.sealed ? 0x776a5c : m.crime ? COL.red : COL.amber
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(SCENE_FX.pickRadius - 0.1, SCENE_FX.pickRadius, 28),
          new THREE.MeshBasicMaterial({
            color: haloCol,
            transparent: true, opacity: 0.16, side: THREE.DoubleSide,
          }))
        halo.rotation.x = -Math.PI / 2
        halo.position.set(m.at[0], 0.04, m.at[1])
        halo.userData.id = m.id
        halo.userData.col = haloCol            // 근접 시 흰빛으로 바꿨다 되돌릴 기준값
        halo.userData.part = 'halo'            // 구성 집계용 꼬리표 (markerStats)
        markerRoot.add(halo)

        if (m.sealed) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true, depthTest: false }))
          sp.userData.baseScale = 0.42         // 펄스 루프가 배율을 덮으므로 기준값을 남긴다
          sp.scale.setScalar(0.42)
          sp.position.set(m.at[0], my + 0.55, m.at[1])
          sp.userData.id = m.id
          sp.userData.part = 'lock'            // 구성 집계용 꼬리표 (markerStats)
          markerRoot.add(sp)
        }

        // 훑기 중에만 — 증거 이름표 (승인 UX ②). 봉인 자물쇠보다 위에 띄운다.
        if (!surveyOver) {
          const lb = makeHintLabel(m.label)
          lb.position.set(m.at[0], my + (m.sealed ? 0.95 : 0.75), m.at[1])
          lb.userData.id = m.id
          lb.userData.part = 'label'
          markerRoot.add(lb)
        }
      }

      /**
       * **구성 불변식** — 마커 1개는 몸통 1 + 발치 링 1 (+봉인이면 자물쇠 1) 이다.
       * 그래서 `markerRoot.children` 은 **증거 수의 2배 + 봉인 수**가 정상이고,
       * id 가 2~3번 세어지는 것도 정상이다 (같은 x·z, 다른 y). 이 주석이 없어서
       * 실플레이 보고가 "중복 스폰"으로 읽혔다 — 이제 숫자로 잠근다.
       * 진짜 중복(같은 id 의 몸통 2개)은 아래가 잡는다.
       */
      if (import.meta.env.DEV) {
        const s = markerStats()
        const dupIds = [...new Set(list.map((m) => m.id))].length !== list.length
        if (s.bodies !== list.length || s.halos !== list.length || dupIds) {
          console.warn(`[현장] 마커 불변식 위반 — 증거 ${list.length} · 몸통 ${s.bodies} · ` +
            `링 ${s.halos} · 자물쇠 ${s.locks}${dupIds ? ' · 입력 id 중복' : ''}`)
        } else {
          console.info(`[현장] 마커 ${list.length}개 = 몸통 ${s.bodies} + 링 ${s.halos} + ` +
            `자물쇠 ${s.locks} → 노드 ${s.total} (불변식 통과)`)
        }
      }
    }

    /* ── HUD — 씬이 소유하는 DOM. 규칙 숫자는 main 이 넣어 준다 ── */
    const hud = document.createElement('div')
    hud.className = 'cs-hud'
    host.appendChild(hud)

    /**
     * 초시계 = **놋쇠 회중시계** (60 Seconds! 의 아날로그 시계를 누아르로 번역).
     * 남은 시간이 붉은 부채꼴로 줄고, 마지막 5초에는 침이 떨린다.
     * 숫자(십분의일초)는 시계 아래 작게 병기 — 기획서 §5의 가독 요구는 숫자가 진다.
     */
    const timerEl = document.createElement('div')
    timerEl.className = 'cs-timer watch'
    const WR = 38   // 부채꼴 반지름 (viewBox 좌표)
    const ticksSvg = Array.from({ length: 12 }, (_, i) => {
      const a = i * Math.PI / 6
      const sx = 50 + 34 * Math.sin(a)
      const sy = 50 - 34 * Math.cos(a)
      const ex = 50 + 40 * Math.sin(a)
      const ey = 50 - 40 * Math.cos(a)
      return `<line class="cw-tick" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"/>`
    }).join('')
    timerEl.innerHTML =
      `<svg class="cs-watch" viewBox="0 0 100 100" aria-hidden="true">` +
      `<circle class="cw-case" cx="50" cy="50" r="47"/>` +
      `<circle class="cw-face" cx="50" cy="50" r="42"/>` +
      ticksSvg +
      `<path class="cw-sector" d="M50,50 L50,${50 - WR} A${WR},${WR} 0 1 1 ${(50 - 0.01).toFixed(2)},${50 - WR} Z"/>` +
      `<line class="cw-needle" x1="50" y1="50" x2="50" y2="${50 - WR - 2}"/>` +
      `<circle class="cw-pin" cx="50" cy="50" r="2.6"/>` +
      `</svg><span class="cs-digits">00:30.0</span>`
    const sectorEl = timerEl.querySelector('.cw-sector')!
    const needleEl = timerEl.querySelector('.cw-needle')!
    const digitsEl = timerEl.querySelector('.cs-digits')!
    if (!calm) hud.appendChild(timerEl)      // calm 은 타이머 미표시 (기획서 ⑥)

    const bagEl = document.createElement('div')
    bagEl.className = 'cs-bag'
    hud.appendChild(bagEl)

    const hintEl = document.createElement('div')
    hintEl.className = 'cs-hint'
    hud.appendChild(hintEl)

    const noteEl = document.createElement('div')
    noteEl.className = 'cs-note'
    hud.appendChild(noteEl)
    let noteT = 0
    const note = (text: string): void => {
      noteEl.textContent = text
      noteEl.classList.add('on')
      clearTimeout(noteT)
      noteT = window.setTimeout(() => noteEl.classList.remove('on'), 2400)
    }

    /* 수거 토스트 — 힌트바(안내)와 자리가 다르다: 가방 바로 위에서 "얻었다"를 말한다 */
    const toastEl = document.createElement('div')
    toastEl.className = 'cs-toast'
    hud.appendChild(toastEl)
    let toastT = 0
    const toast = (text: string): void => {
      toastEl.textContent = text
      toastEl.classList.remove('on')
      void toastEl.offsetWidth                    // 연속 수거에도 매번 다시 떠오른다
      toastEl.classList.add('on')
      clearTimeout(toastT)
      toastT = window.setTimeout(() => toastEl.classList.remove('on'), SCENE_FX.toastMs)
    }

    const exitBtn = document.createElement('button')
    exitBtn.className = 'cs-exit'
    exitBtn.textContent = calm ? '수집을 마친다' : '먼저 철수한다'
    hud.appendChild(exitBtn)

    const vin = document.createElement('div')
    vin.className = 'cs-vignette'
    host.appendChild(vin)

    const white = document.createElement('div')
    white.className = 'cs-white'
    host.appendChild(white)

    const caption = document.createElement('div')
    caption.className = 'cs-caption'
    host.appendChild(caption)

    if (!calm) {
      caption.textContent = '현장을 훑는다 — 무엇을 들고 나올 것인가'
      caption.classList.add('on')
    }

    const setBag = (items: BagItem[], capacity: number): void => {
      bagEl.replaceChildren()
      const had = bagEl.dataset.n ? Number(bagEl.dataset.n) : 0
      for (let i = 0; i < capacity; i++) {
        const it = items[i]
        const slot = document.createElement('div')
        slot.className = `cs-slot${it ? ' full' : ''}${it && i >= had ? ' fresh' : ''}`
        if (it) {
          slot.title = it.full                     // hover 툴팁 — 담긴 기록의 전체 이름
          const icon = ICON_BY_KIND.get(it.kind)
          if (icon) {
            const im = document.createElement('i')
            im.className = 'cs-sicon'
            im.style.backgroundImage = `url(${icon})`
            slot.appendChild(im)
            const cap = document.createElement('b')
            cap.className = 'cs-scap'
            cap.textContent = it.short
            slot.appendChild(cap)
          } else slot.textContent = it.short       // 아이콘 미도착이면 약칭이 본선이다
        }
        bagEl.appendChild(slot)
      }
      bagEl.dataset.n = String(items.length)
    }

    /**
     * 수거 포물선 — 증거가 화면의 그 자리에서 가방 슬롯으로 날아가 꽂힌다.
     * 착지 프레임에 snap(폴라로이드 찰칵) — 소리가 연출의 마침표다.
     * 모션 축소면 비행 없이 소리만 낸다.
     */
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const flyFrom = (id: string): void => {
      if (REDUCED) { sfx('snap'); return }
      const m = markers.find((x) => x.id === id)
      if (!m) return
      const cam = firstPerson ? eye : camera
      const v = new THREE.Vector3(m.at[0], m.y ?? MARK_Y, m.at[1]).project(cam)
      const hw2 = host.clientWidth
      const hh2 = host.clientHeight
      const x0 = (v.x / 2 + 0.5) * hw2
      const y0 = (-v.y / 2 + 0.5) * hh2
      // 착지 칸 = 지금 가득 찬 칸 수 번째 (이 연출 직후 setBag 이 그 칸을 채운다)
      const nFull = bagEl.querySelectorAll('.cs-slot.full').length
      const slot = bagEl.children[Math.min(nFull, Math.max(0, bagEl.children.length - 1))] as HTMLElement | undefined
      const hostR = host.getBoundingClientRect()
      const sr = slot?.getBoundingClientRect()
      const x1 = sr ? sr.left + sr.width / 2 - hostR.left : hw2 / 2
      const y1 = sr ? sr.top + sr.height / 2 - hostR.top : hh2 - 60
      const chip = document.createElement('div')
      chip.className = 'cs-fly'
      const iconUrl = ICON_BY_KIND.get(m.kind)
      if (iconUrl) chip.style.backgroundImage = `url(${iconUrl})`
      else chip.classList.add('blank')
      host.appendChild(chip)
      const t0 = performance.now()
      const DUR = 400
      const ARC = Math.max(90, Math.abs(y1 - y0) * 0.35)
      const step = (): void => {
        if (!alive) return chip.remove()
        const k = Math.min(1, (performance.now() - t0) / DUR)
        const x = x0 + (x1 - x0) * k
        const y = y0 + (y1 - y0) * k - ARC * 4 * k * (1 - k)   // 포물선
        chip.style.transform = `translate(${x}px, ${y}px) rotate(${(k * 260).toFixed(0)}deg) scale(${(1 - k * 0.35).toFixed(3)})`
        if (k < 1) requestAnimationFrame(step)
        else { chip.remove(); sfx('snap') }
      }
      step()
    }

    /* ── 스왑 선택지 — 시계는 계속 돈다 ── */
    let swapEl: HTMLElement | null = null
    let swapChoose: ((dropId: string | null) => void) | null = null
    let swapIds: string[] = []
    const closeSwap = (): void => {
      swapEl?.remove()
      swapEl = null
      swapChoose = null
      swapIds = []
    }
    const openSwap = (
      items: { id: string; label: string }[], pickLabel: string,
      choose: (dropId: string | null) => void,
    ): void => {
      closeSwap()
      swapChoose = choose
      swapIds = items.map((i) => i.id)
      swapEl = document.createElement('div')
      swapEl.className = 'cs-swap'
      const cap = document.createElement('div')
      cap.className = 'cs-swap-cap'
      cap.textContent = `가방이 가득하다 — ${pickLabel}${calm ? '' : ' (내려놓기 1.5초)'}`
      swapEl.appendChild(cap)
      items.forEach((it, i) => {
        const b = document.createElement('button')
        b.className = 'cs-swaprow'
        b.textContent = `${i + 1}. ${it.label} 을 내려놓는다`
        b.onclick = () => { const f = swapChoose; closeSwap(); f?.(it.id) }
        swapEl!.appendChild(b)
      })
      const keep = document.createElement('button')
      keep.className = 'cs-swaprow keep'
      keep.textContent = 'Esc. 그대로 둔다'
      keep.onclick = () => { const f = swapChoose; closeSwap(); f?.(null) }
      swapEl.appendChild(keep)
      host.appendChild(swapEl)
    }

    /* ── 입력 — explore3d 와 같은 규약(e.code · 입력창 가드 · blur 청소) ── */
    /**
     * **1인칭이 기본이다** (사용자 결정 2) — 현장을 "밟는" 감각은 눈높이에서 온다.
     * V 는 탑다운 조감 토글로 남는다. 조망성은 훑기 5초 오빗이 보완한다.
     */
    /**
     * **1인칭 고정 — 조감(V)은 제거했다** (2026-08-10 사용자 결정, 마감 판단).
     *
     * 조감은 3인칭 몸을 화면에 세우는 순간 온갖 것을 요구했다: 걷는 면 실측, 루트 모션,
     * 벽 격자의 촘촘함, 카메라 상대 이동축, 클립 속도 동기화. 하나가 어긋나면
     * "혼자 달려나갔다 돌아오고 벽을 뚫는" 그림이 되는데, 1인칭에서는 그 어느 것도
     * 화면에 나타나지 않는다 — 몸이 안 보이기 때문이다.
     * 남은 시간을 3D 인체에 쓰지 않고 UI·UX 에 쓰기로 했다. `const` 인 것이 그 결정이다.
     */
    const firstPerson = true
    const keys = new Set<string>()
    const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'])
    let near: string | null = null
    let phase: ScenePhase = calm ? 'collect' : 'survey'

    const onDown = (e: KeyboardEvent): void => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        || (t instanceof HTMLElement && t.isContentEditable)) return
      // 스왑 선택지가 떠 있으면 숫자·Esc 가 먼저다
      if (swapEl && swapChoose) {
        const n = /^Digit([1-9])$/.exec(e.code)
        if (n) {
          const id = swapIds[Number(n[1]) - 1]
          if (id) { const f = swapChoose; closeSwap(); f(id); e.preventDefault() }
          return
        }
        if (e.code === 'Escape') { const f = swapChoose; closeSwap(); f(null); e.preventDefault(); return }
      }
      if (phase !== 'collect') return          // 훑기·종료 중엔 조작 불가
      // 1~5 — 가방 칸 확인. 스왑이 떠 있으면 위에서 이미 소비됐다 (내려놓기 선택이 먼저다)
      const dg = /^Digit([1-5])$/.exec(e.code)
      if (dg) {
        const slot = bagEl.children[Number(dg[1]) - 1] as HTMLElement | undefined
        note(slot?.title ? `가방 ${dg[1]}칸 — ${slot.title}` : `가방 ${dg[1]}칸 — 비어 있다`)
        e.preventDefault()
        return
      }
      if (e.code === 'KeyE' || e.code === 'Space') {
        if (near) { handlers.onPick(near); e.preventDefault() }
        return
      }
      // V(조감) 는 제거했다 — 위 firstPerson 주석 참조. 눌러도 아무 일도 없어야 한다.
      if (MOVE_CODES.has(e.code)) { keys.add(e.code); e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent): void => { keys.delete(e.code) }
    const clearKeys = (): void => keys.clear()
    const onVis = (): void => { if (document.hidden) keys.clear() }
    addEventListener('keydown', onDown)
    addEventListener('keyup', onUp)
    addEventListener('blur', clearKeys)
    document.addEventListener('visibilitychange', onVis)

    const ray = new THREE.Raycaster()
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let goal: THREE.Vector3 | null = null
    let stuckT = 0
    const onClick = (e: MouseEvent): void => {
      if (phase !== 'collect') return
      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, firstPerson ? eye : camera)
      const onMarker = ray.intersectObjects(markerRoot.children, false)[0]
      if (onMarker) {
        const id = onMarker.object.userData.id as string | undefined
        // 마커 클릭도 근접해야 줍는다 — 원거리 클릭 수거를 열면 30초가 클릭 순회가 된다
        if (id && id === near) { handlers.onPick(id); return }
        if (id) {
          const m = markers.find((x) => x.id === id)
          if (m) { goal = new THREE.Vector3(m.at[0], 0, m.at[1]); stuckT = 0 }
          return
        }
      }
      const hit = new THREE.Vector3()
      if (ray.ray.intersectPlane(floorPlane, hit)) {
        goal = new THREE.Vector3(
          Math.max(SCENE_ROOM.minX + 0.5, Math.min(SCENE_ROOM.maxX - 0.5, hit.x)), 0,
          Math.max(SCENE_ROOM.minZ + 0.5, Math.min(SCENE_ROOM.maxZ - 0.5, hit.z)))
        stuckT = 0
      }
    }
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.style.cursor = 'pointer'

    /* ── 시계 — sceneRules 의 상태기계를 그대로 돌린다 ── */
    /**
     * **프레임 간격을 누적하되, 끊긴 시간은 세지 않는다.**
     * performance.now 절대값으로 재면 탭이 가려져 rAF 가 멎은 동안에도 30초가
     * 몰래 탄다 — 돌아온 플레이어는 훑기에서 곧장 호루라기로 점프한다
     * (실측: 브라우저 패널 전환 중 실제로 그랬다). 그렇다고 dt 를 0.05s 로 캡해 더하면
     * 저프레임 환경에서 30초가 고무줄처럼 늘어난다. 그래서 프레임 간격을 그대로 더하되
     * **1초를 넘는 간격은 "탭이 멎었던 시간"으로 보고 0 으로 친다** — 60 Seconds! 도
     * 뒤로 가 있는 동안은 시계가 멎는다.
     */
    let elapsedMs = 0
    let lastPulseSec = -1
    let lastHeartAt = 0
    let ended = false
    let doneSent = false
    /** 집기 동작 중 — 이동이 잠긴다 (elapsedMs 기준이라 탭이 멎으면 같이 멎는다) */
    let lockUntil = 0
    let pickingUp = false

    /**
     * E 수거 원샷 — 몸을 숙여 집고, 잠금이 풀리면 걷기/달리기로 돌아온다.
     * 걷기 액션의 weight 를 0 으로 눌러 두 클립이 반반 섞이는 것을 막는다.
     */
    const playPickup = (): void => {
      if (!pickupAction) return
      lockUntil = elapsedMs + SCENE_FX.pickupLockMs
      pickingUp = true
      walk?.setEffectiveWeight(0)
      /**
       * **대기 클립도 즉시 0 으로 누른다** — 걸어두면 블렌딩이 0.25초에 걸쳐 내리는
       * 동안 idle 1 + pickup 1 이 반반 섞여 집는 동작이 묽어진다 (실측 —
       * "pickup 이 재생 안 된다"로 보였다. 대기 클립이 없던 시절의 배선 잔재).
       */
      idleAction?.setEffectiveWeight(0)
      pickupAction.reset().play()
    }

    const endScene = (reason: 'time' | 'exit'): void => {
      if (ended) return
      ended = true
      phase = 'done'
      closeSwap()
      sfx('whistle')
      caption.textContent = '호루라기 — 감식반 철수'
      caption.classList.add('on')
      white.classList.add('on')
      window.setTimeout(() => {
        if (doneSent) return
        doneSent = true
        handlers.onDone(reason)
      }, SCENE_FX.whiteoutMs)
    }
    exitBtn.onclick = () => endScene('exit')

    /* ── 루프 ── */
    let raf = 0
    let alive = true
    const clock = new THREE.Clock()
    /**
     * **속도는 상태다** — 입력이 아니라. 실제 속도(curSpeed)를 램프로 밀고,
     * 이동·클립 가중치·발소리 전부 이 하나를 본다. 입력이 끊긴 프레임에도
     * curSpeed 가 남아 미끄러지듯 서고, 그 값이 0 이 되면 대기 클립이 올라온다 —
     * "정지했는데 계속 달린다"(실플레이)의 근본 수리다: 클립 상태를 **입력 플래그가
     * 아니라 몸의 속도**가 정한다.
     */
    let curSpeed = 0
    /** 그림자 재굽기 홀짝 — 0/1 을 오가며 1일 때만 굽는다 */
    let shadowParity = 0
    /** DEV 프레임 통계 누적 (2초 창) */
    let frames = 0
    let statAcc = 0
    const lastDir = new THREE.Vector3(0, 0, 1)
    const dir = new THREE.Vector3()
    const camFwd = new THREE.Vector3()
    const camRight = new THREE.Vector3()
    const UP = new THREE.Vector3(0, 1, 0)
    /**
     * 루프 안에서 `new` 를 만들지 않는다 — 매 프레임 할당은 GC 를 주기적으로 불러
     * 수십 ms 멈춤(=버벅임)으로 돌아온다. 경찰서 루프가 매끄러운 또 하나의 이유다.
     */
    const toGoal = new THREE.Vector3()
    const eyeFwd = new THREE.Vector3()
    const eyeTo = new THREE.Vector3()
    /** HUD 는 값이 **바뀌었을 때만** 쓴다 — SVG 어트리뷰트·스타일 변이는 매 프레임 페인트를 부른다 */
    let hudDigits = ''
    let hudSector = ''
    let hudNeedle = ''
    let hudVin = ''
    const keyNum = (a: string, b: string): number => (keys.has(a) || keys.has(b) ? 1 : 0)

    const tick = (): void => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      const gap = clock.getDelta()                    // 프레임 간격 (초)
      const dt = Math.min(0.05, gap)                  // 조향·연출용 — 프레임 급락 시 과회전 방지 캡
      if (gap <= 1) elapsedMs += gap * 1000           // 1초 넘게 멎었던 시간은 시계가 세지 않는다
      /**
       * 이동·애니메이션은 **실시간(simSec)** 을 탄다 — "움직임이 순간이동" 의 수리.
       * 예전엔 dt(0.05 캡)로만 밀어서, 프레임이 처지면 이동·클립이 함께 느려졌다가
       * 다음 프레임에 시계(elapsedMs)와 어긋난 채 뚝뚝 끊겨 보였다.
       * 이제 프레임이 길어도 그 시간만큼 정확히 나아가되, 충돌 검사는 아래에서
       * 0.05s 조각으로 나눠 민다 — 벽 뚫기(터널링)는 그대로 막는다.
       *
       * **다만 상한이 있다 (STEP_CAP).** 눈은 렌더된 프레임만 본다. 0.25s 를 한 번에
       * 적분하면 조감 3.4m/s 에서 **한 프레임에 85cm** 를 건너뛴다 — 평상시 한 걸음(2cm)의
       * 40배라, 시간상으로는 정확해도 화면에서는 순간이동이다 (실측: 120ms 히치에서
       * 조감 42cm · 1인칭 29cm 도약). 상한을 0.05s 로 두면 최악이 17cm 로 줄고,
       * 20fps 위의 프레임은 **하나도 손해 보지 않는다** — 잃는 것은 진짜로 떨어뜨린
       * 프레임의 잔여 거리뿐이고, 30초 한 판에서 그 총합은 눈에 띄지 않는다.
       */
      const simSec = gap <= 1 ? Math.min(STEP_CAP, gap) : 0
      const elapsed = elapsedMs
      const prevPhase = phase
      if (!ended) phase = phaseAt(elapsed, calm)
      if (phase === 'done' && !ended) { endScene('time'); }

      /* 훑기 — 카메라가 현장을 한 바퀴, 마커 전부 점멸 + 이름표 (기획서 §3 · 승인 UX ②) */
      if (phase === 'survey') {
        const k = elapsed / SCENE_FX.surveyMs
        placeCam(camAngle0 + k * Math.PI * 2)
        const blink = 0.75 + 0.45 * Math.sin(k * Math.PI * 10)
        for (const g of markerRoot.children) {
          if (g.userData.part === 'label') continue          // 이름표는 점멸하지 않는다 — 읽는 물건이다
          if ((g as THREE.Mesh).geometry?.type !== 'RingGeometry') {
            g.scale.setScalar(((g.userData.baseScale as number) ?? 1) * blink)
          }
        }
      } else if (prevPhase === 'survey') {
        placeCam(camAngle0)
        caption.classList.remove('on')
        // 훑기 이름표는 여기서 걷힌다 — 수집 중에는 근접 힌트바가 그 정보를 잇는다
        surveyOver = true
        clearHintLabels()
        for (const g of markerRoot.children) g.scale.setScalar((g.userData.baseScale as number) ?? 1)
        // 훑기가 끝나는 순간이 조작의 첫 순간이다 — 시점 문법을 여기서 한 번만 말한다
        note('WASD · 클릭으로 이동 · E 로 수거')
      }

      /* 이동 — collect 중에만. 화면 축 기준(정사영) / 몸 기준(1인칭) */
      if (phase === 'collect') {
        // 집는 동안은 발이 멎는다 — 잠금은 0.45s, 클릭 목표는 잠금 뒤에 이어서 간다
        const locked = elapsedMs < lockUntil
        const fwd = locked ? 0 : keyNum('KeyW', 'ArrowUp') - keyNum('KeyS', 'ArrowDown')
        const side = locked ? 0 : keyNum('KeyD', 'ArrowRight') - keyNum('KeyA', 'ArrowLeft')
        dir.set(0, 0, 0)
        if (firstPerson) {
          // 조향도 이동과 **같은 시계**(simSec)를 탄다 — dt(0.05 캡)로 돌리면 프레임이
          // 처질 때 몸은 실시간으로 가는데 시선만 늦게 돌아 곡선 궤적이 덜컥거린다
          if (side !== 0) actor.rotation.y -= side * TURN * simSec
          if (fwd !== 0) dir.set(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y)).multiplyScalar(fwd)
        } else if (fwd !== 0 || side !== 0) {
          camera.getWorldDirection(camFwd)
          camFwd.y = 0
          if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1)
          camFwd.normalize()
          camRight.crossVectors(camFwd, UP).normalize()
          dir.copy(camFwd).multiplyScalar(fwd).addScaledVector(camRight, side)
        }
        if (dir.lengthSq() > 0) { goal = null; dir.normalize() }
        else if (goal && !locked) {
          toGoal.copy(goal).sub(actor.position)
          toGoal.y = 0
          if (toGoal.length() < 0.06) goal = null
          else dir.copy(toGoal.normalize())
        }

        const bx = actor.position.x
        const bz = actor.position.z
        const wantsMove = dir.lengthSq() > 0
        if (wantsMove) lastDir.copy(dir)
        /**
         * 시점별 상한 + 가감속 램프 (sceneRules 의 순수 함수가 산수를 소유한다).
         * 1인칭은 시야가 좁아 같은 3.4 도 과속으로 읽힌다 → 2.4 로 누른다.
         * 조감(V)은 방이 다 보이므로 클립 속도 그대로.
         */
        const topSpeed = moveSpeedFor(moveSpeed, firstPerson)
        curSpeed = rampTo(curSpeed, wantsMove && !locked ? topSpeed : 0, simSec)
        const moving = curSpeed > 0.05
        if (moving) {
          // 실시간을 0.05s 조각으로 나눠 민다 — 프레임 드랍에도 속도가 참이고 벽은 안 뚫린다
          let rem = simSec
          while (rem > 1e-4) {
            const st = Math.min(0.05, rem)
            rem -= st
            const step = curSpeed * st
            const nx = actor.position.x + lastDir.x * step
            const nz = actor.position.z + lastDir.z * step
            // 축 분리 — 벽에 비스듬히 닿으면 미끄러진다 (explore3d 와 같은 이유).
            // 격자(갤러리 벽·조각상·의자)와 분석 상자를 같은 판정이 본다.
            if (lastDir.x !== 0 && !blockedAt(nx, actor.position.z)) actor.position.x = nx
            if (lastDir.z !== 0 && !blockedAt(actor.position.x, nz)) actor.position.z = nz
          }
          /**
           * 1인칭에서 **키 이동은 몸이 기준**(A/D 가 조향)이지만, **클릭 이동은 목표가
           * 기준**이다 — 몸을 돌리지 않으면 시선은 그대로인 채 옆걸음으로 미끄러진다.
           */
          const byKeys = fwd !== 0 || side !== 0
          // 활강(입력 없이 감속 중)에는 lastDir 을 본다 — dir 이 0 이면 atan2(0,0)=0 이라
          // 몸이 +Z 로 홱 돌아간다 (램프를 넣으며 새로 생긴 함정)
          const want = firstPerson && byKeys ? actor.rotation.y : Math.atan2(lastDir.x, lastDir.z)
          let d = want - actor.rotation.y
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          actor.rotation.y += d * Math.min(1, simSec * 12)
        }
        if (goal) {
          const moved = Math.hypot(actor.position.x - bx, actor.position.z - bz)
          stuckT = moved < topSpeed * simSec * 0.5 ? stuckT + simSec : 0
          if (stuckT > 0.4) { goal = null; stuckT = 0 }
        } else stuckT = 0
        // 집기가 끝났다 — 클립을 내린다 (weight 복귀는 아래 블렌딩이 맡는다)
        if (pickingUp && elapsedMs >= lockUntil) {
          pickingUp = false
          pickupAction?.stop()
          if (!idleAction) walk?.setEffectiveWeight(1)
        }
        /**
         * 상태 → 클립 블렌딩. **판정 기준은 입력이 아니라 실제 속도(curSpeed)다** —
         * 입력 플래그로 정하면 클릭 목표·잠금·키 이벤트 유실 중 하나만 어긋나도
         * 달리는 자세로 서 있게 된다("계속 달린다"의 정체). 속도가 0 이면 몸도 0 이다.
         * 가중치 램프는 이동 램프와 같은 시간상수(rampTau)를 써서 발과 몸이 함께 선다.
         */
        if (idleAction && walk) {
          const frac = topSpeed > 0 ? Math.min(1, curSpeed / topSpeed) : 0
          const tW = pickingUp ? 0 : frac
          const tI = pickingUp ? 0 : 1 - frac
          walk.paused = false
          walk.setEffectiveWeight(rampTo(walk.getEffectiveWeight(), tW, simSec))
          idleAction.setEffectiveWeight(rampTo(idleAction.getEffectiveWeight(), tI, simSec))
          /**
           * 클립 재생 배율은 **고정**이다 (clipRateFor — 시점별 상한/클립속도).
           * 예전의 매 프레임 `curSpeed / moveSpeed` 동기화는 램프가 도는 동안
           * 재생속도가 함께 출렁여 몸 전체가 떨려 보였다 — "현장이 계속 버벅인다"의
           * 주범. 경찰서(explore3d)가 매끄러운 이유가 바로 고정 배율이다.
           */
          walk.timeScale = clipRateFor(moveSpeed, firstPerson)
        } else if (walk) {
          walk.paused = !moving && !pickingUp
          walk.timeScale = clipRateFor(moveSpeed, firstPerson)
        }

        /* 근접 판정 — 가장 가까운 것 (nearestWithin 재사용) */
        const nowNear = nearestWithin(markers, actor.position.x, actor.position.z, SCENE_FX.pickRadius)
        if (nowNear !== near) {
          near = nowNear
          const m = markers.find((x) => x.id === near)
          hintEl.textContent = m
            ? m.sealed
              ? `${m.label} — E 로 수거 (봉인 — 열람은 심문에서 열쇠를 얻은 뒤)`
              : `${m.label} — E 또는 Space 로 수거`
            : nearestWithin([{ id: 'p', at: DEATH_AT as [number, number] }],
                actor.position.x, actor.position.z, 1.7)
              ? pedestalLine
              : ''
          hintEl.classList.toggle('on', hintEl.textContent !== '')
        } else if (!near) {
          // 받침대 접근 서술 — 마커가 아니므로 매 프레임 갱신해도 싸다
          const onPed = nearestWithin([{ id: 'p', at: DEATH_AT as [number, number] }],
            actor.position.x, actor.position.z, 1.7)
          const want = onPed ? pedestalLine : ''
          if (hintEl.textContent !== want) {
            hintEl.textContent = want
            hintEl.classList.toggle('on', want !== '')
          }
        }
        /**
         * 근접 신호 — 부풀림 + **흰 윤곽빛** (60 Seconds! 의 흰 컨투어를 우리 재질로 번역).
         * 실루엣은 emissive 를 종이빛으로 끌어올리고, 발치 링은 흰색으로 바뀐다 —
         * "지금 손에 닿는다" 가 색으로 읽힌다. 떠나면 기준값(userData.em/col)으로 되돌린다.
         */
        for (const g of markerRoot.children) {
          const isHalo = (g as THREE.Mesh).geometry?.type === 'RingGeometry'
          // **실물은 놓이고, 추상만 돈다.** 실모델은 배치된 자세(변주)를 지킨다 —
          // 벽에 붙은 카메라가 빙글빙글 돌면 현장이 아니라 아이템 창고가 된다.
          if (g.userData.spin === true) g.rotation.y += dt * 1.1
          const on = g.userData.id === near
          const base = (g.userData.baseScale as number) ?? 1
          g.scale.setScalar(base * (on ? (isHalo ? 1.12 : 1.35) : 1))
          const mat = (g as THREE.Mesh).material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial
          if (isHalo) {
            mat.opacity = on ? 0.5 : 0.16
            mat.color.setHex(on ? 0xf5efe0 : ((g.userData.col as number) ?? COL.amber))
          } else if (Array.isArray(g.userData.mats)) {
            // 실모델 — 복제해 둔 재질의 emissive 를 통째로 올린다 (흰 윤곽빛)
            for (const mm of g.userData.mats as THREE.MeshStandardMaterial[]) {
              mm.emissive?.setHex(on ? 0x8a8274 : 0x000000)
            }
          } else if (typeof g.userData.em === 'number' && mat.emissive) {
            mat.emissive.setHex(on ? 0xbdb49e : (g.userData.em as number))
          }
        }

        /* 시계·압박 곡선 — calm 은 전부 건너뛴다 */
        if (!calm) {
          const rm = remainMs(elapsed)
          const sec = Math.floor(rm / 1000)
          const tenth = Math.floor((rm % 1000) / 100)
          /**
           * **HUD 는 바뀐 값만 쓴다.** 예전에는 부채꼴 path·침 transform·숫자·비네트를
           * **매 프레임** 밀어 넣었다 — WebGL 프레임마다 SVG 레이아웃·페인트가 같이 돌아
           * 주기적인 밀림(버벅임)의 한 축이었다. 각도는 0.25° 로 양자화해 문자열이 같으면
           * 쓰기 자체를 건너뛴다 — 눈으로는 구분되지 않는 해상도다.
           */
          const dg = `00:${String(sec).padStart(2, '0')}.${tenth}`
          if (dg !== hudDigits) { hudDigits = dg; digitsEl.textContent = dg }
          const pulse = pulseAt(rm / 1000)
          timerEl.classList.toggle('hot', pulse === 'heart')
          // 회중시계 — 남은 시간의 붉은 부채꼴이 줄고, 침이 그 가장자리를 짚는다
          const frac = rm / SCENE_FX.collectMs
          const ang = frac * Math.PI * 2
          let sd: string
          if (frac > 0.9995) {
            sd = `M50,50 L50,${50 - WR} A${WR},${WR} 0 1 1 49.99,${50 - WR} Z`
          } else {
            const angQ = Math.round(ang / HUD_ANG_STEP) * HUD_ANG_STEP
            const px = 50 + WR * Math.sin(angQ)
            const py = 50 - WR * Math.cos(angQ)
            sd = `M50,50 L50,${50 - WR} A${WR},${WR} 0 ${angQ > Math.PI ? 1 : 0} 1 ${px.toFixed(2)},${py.toFixed(2)} Z`
          }
          if (sd !== hudSector) { hudSector = sd; sectorEl.setAttribute('d', sd) }
          // 마지막 5초 — 침이 떨린다 (결정론: elapsed 기반 사인, Math.random 금지)
          const jitter = pulse === 'heart' ? Math.sin(elapsed * 0.045) * 3.2 : 0
          const nd = `rotate(${(Math.round((ang * 180 / Math.PI + jitter) * 4) / 4).toFixed(2)} 50 50)`
          if (nd !== hudNeedle) { hudNeedle = nd; needleEl.setAttribute('transform', nd) }
          if (pulse === 'heart') {
            if (performance.now() - lastHeartAt > SCENE_FX.heartGapMs) {
              lastHeartAt = performance.now()
              sfx('heartbeat')
            }
          } else if (pulse === 'tick2') {
            const half = Math.floor(rm / 500)
            if (half !== lastPulseSec) { lastPulseSec = half; sfx('tick') }
          } else {
            if (sec !== lastPulseSec) { lastPulseSec = sec; sfx('tick') }
          }
          const vo = (Math.round(vignetteAt(rm / 1000) * 100) / 100).toFixed(2)
          if (vo !== hudVin) { hudVin = vo; vin.style.opacity = vo }
        }
      }

      /**
       * **믹서는 국면 밖에서 돈다.** 예전엔 collect 안에 있어서 훑기 5초 동안
       * 대기 클립이 0프레임에 얼어 있었다 — 오빗 카메라가 도는 내내 A포즈에 가까운
       * 몸을 비추던 것의 정체다. 종료(화이트아웃) 중에도 몸은 숨을 쉰다.
       */
      mixer?.update(simSec)

      // 그림자 재굽기 — 한 프레임 걸러 (autoUpdate 를 끈 대가를 여기서 치른다)
      if ((shadowParity ^= 1) === 1) renderer.shadowMap.needsUpdate = true

      // 훑기만 조감이다 — 종료 국면(화이트아웃 뒤)에도 시점이 튀지 않아야 한다
      if (firstPerson && phase !== 'survey') {
        /* 집는 동안 시선이 숙는다 — 몸이 안 보이는 1인칭에서는 카메라가 그 몸짓을 진다 */
        let eyeY = EYE_HEIGHT
        if (!REDUCED && pickingUp) {
          const p = Math.min(1, Math.max(0, 1 - (lockUntil - elapsedMs) / SCENE_FX.pickupLockMs))
          eyeY = EYE_HEIGHT - PICKUP_EYE_DIP * Math.sin(Math.PI * p)
        }
        eye.position.set(actor.position.x, eyeY, actor.position.z)
        eyeFwd.set(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y))
        const dip = EYE_HEIGHT - eyeY
        eye.lookAt(eyeTo.copy(eye.position).add(eyeFwd).setY(eyeY - dip * 1.6))
        actor.visible = false
        renderer.render(scene, eye)
      } else {
        actor.visible = true
        renderer.render(scene, camera)
      }

      /**
       * 프레임 원가 — 버벅임 보고가 오면 **그림인지 아닌지**를 이 줄이 가른다.
       * 2초마다 한 번만 찍는다 (로그가 프레임을 먹으면 관측이 원인이 된다).
       */
      if (import.meta.env.DEV) {
        frames++
        statAcc += gap
        if (statAcc >= 2) {
          const fps = frames / statAcc
          console.info(`[현장] ${fps.toFixed(0)}fps · ${(1000 / fps).toFixed(1)}ms/f · ` +
            `드로우콜 ${renderer.info.render.calls} · 삼각형 ${(renderer.info.render.triangles / 1000).toFixed(0)}k · ` +
            `지오 ${renderer.info.memory.geometries} · 텍스처 ${renderer.info.memory.textures}`)
          frames = 0
          statAcc = 0
        }
      }
    }
    // 개발 중에만 씬을 밖에서 들여다본다 — 3D 는 콘솔 없이는 원인을 못 찾는다 (explore3d 의 __ex 와 같은 이유)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__cs = {
        scene, actor, markerRoot, camera, eye, renderer, moveSpeed, blockedAt,
        /** 그림자 패스의 원가를 재는 스위치 — "버벅임이 그림인지" 를 A/B 로 가른다 */
        shadowAuto: (on: boolean) => { renderer.shadowMap.autoUpdate = on },
        shadowInfo: () => ({ auto: renderer.shadowMap.autoUpdate, size: key.shadow.mapSize.x }),
        roomShadows: (on: boolean) => {
          galleryRoom?.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = on })
        },
        hasPickupClip: Boolean(pickupAction),
        hasIdleClip: Boolean(idleAction),
        markerStats,
        // 입력이 들어왔는가 — "안 움직인다" 가 입력인지 이동인지 가른다 (키 잠김 회귀 포함)
        keysNow: () => [...keys],
        phaseNow: () => phase,
        /**
         * **지금 몸이 무엇을 하고 있는가** — 애니메이션 회귀는 눈이 아니라 이 숫자로 본다.
         * "정지했는데 달린다" 류 보고가 오면 speed·walkW·idleW 세 값이 곧 진단이다.
         */
        animState: () => ({
          speed: +curSpeed.toFixed(3),
          topSpeed: +moveSpeedFor(moveSpeed, firstPerson).toFixed(2),
          clipSpeed: moveSpeed,
          firstPerson,
          walkW: +(walk?.getEffectiveWeight() ?? -1).toFixed(3),
          idleW: +(idleAction?.getEffectiveWeight() ?? -1).toFixed(3),
          pickupRunning: pickupAction?.isRunning() ?? false,
          walkTimeScale: +(walk?.timeScale ?? 0).toFixed(2),
        }),
        // 렌더 부하 — 버벅임의 원인이 그림인지 아닌지를 가른다
        renderStats: () => ({
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          programs: renderer.info.programs?.length ?? -1,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        }),
        pickupState: () => ({
          running: pickupAction?.isRunning() ?? false,
          idleW: idleAction?.getEffectiveWeight() ?? -1,
          walkW: walk?.getEffectiveWeight() ?? -1,
        }),
        teleport: (x: number, z: number) => { actor.position.x = x; actor.position.z = z },
        time: () => elapsedMs,
        skip: (ms: number) => { elapsedMs += ms },
      }
    }
    tick()

    const onResize = (): void => {
      const nw = host.clientWidth || w
      const nh = host.clientHeight || hgt
      camera.left = -VIEW * (nw / nh) / 2
      camera.right = VIEW * (nw / nh) / 2
      camera.updateProjectionMatrix()
      eye.aspect = nw / nh
      eye.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    addEventListener('resize', onResize)

    return {
      setMarkers,
      setBag,
      toast,
      addPenalty: (ms) => { elapsedMs += ms },
      flyFrom,
      playPickup,
      note,
      openSwap,
      dispose() {
        alive = false
        cancelAnimationFrame(raf)
        clearTimeout(noteT)
        clearTimeout(toastT)
        removeEventListener('keydown', onDown)
        removeEventListener('keyup', onUp)
        removeEventListener('blur', clearKeys)
        document.removeEventListener('visibilitychange', onVis)
        removeEventListener('resize', onResize)
        renderer.domElement.removeEventListener('click', onClick)
        mixer?.stopAllAction()
        renderer.dispose()
        host.replaceChildren()
      },
    }
  } catch {
    // 3D 가 실패해도 게임은 멈추지 않는다 — main 이 기존 기록철 흐름으로 되돌린다
    return null
  }
}
