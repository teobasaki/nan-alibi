/**
 * 탐색 모드 — **걸어 다니며 기록을 줍는 방.**
 *
 * ## 왜 `stage3d.ts` 를 안 고쳤나
 * 심문 씬은 이미 715줄이고 좌석·카메라·조명이 실측으로 못박혀 있다. 거기에 이동을
 * 얹으면 두 모드가 같은 상수를 다투게 된다. 여기는 **다른 카메라(정사영 탑다운)와
 * 다른 모델(걷기 리그)** 을 쓰므로 애초에 다른 씬이다. 방 에셋만 같이 쓴다.
 *
 * ## 규칙을 계산하지 않는다
 * 이 모듈은 **무엇을 클릭했는지만** 바깥에 알린다. 그 클릭이 조사를 소모하는지,
 * 조회가 가능한지는 전부 `engine/` 이 정한다. 화면이 "지금 무엇을 할 수 있는가" 를
 * 가로채면 `availableEvidence()` 가 소유하던 규칙이 둘로 갈라진다.
 *
 * ## 2D 목록은 사라지지 않는다
 * 걸어가서 줍는 것은 **또 하나의 입력 방법**이지 유일한 입력이 아니다.
 * 우면 기록철은 그대로 있고 키보드로도 전부 접근된다 — 3D 가 실패해도(모바일·저사양)
 * 게임이 멈추지 않아야 하기 때문이다. 이 프로젝트가 사진 폴백에서 지켜 온 원칙과 같다.
 */

import * as THREE from 'three'
import { groundIt, measuredHeight } from './skinBounds'

export interface Marker {
  /** 무엇을 가리키는가 — 기록 id */
  id: string
  /** 방 안 위치 (미터) */
  at: [number, number]
  label: string
  /**
   * 기록 종류. **생긴 게 달라야 가기 전에 고를 수 있다.**
   * 60 Seconds! 에서 방독면과 수프 캔이 다르게 생긴 것과 같은 이유다 —
   * 전부 같은 링이면 걸어가 보기 전까지 무엇인지 모르고, 그러면 선택이 아니라 순회가 된다.
   */
  kind: 'keycard' | 'cctv' | 'call' | 'receipt' | 'autopsy'
  /** 범행 시각 기록인가 — 사람을 지우는 유일한 것이라 눈에 띄어야 한다 */
  crime: boolean
}

export interface Explore3D {
  dispose(): void
  /** 마커 갱신 — 조회한 기록은 사라진다 */
  setMarkers(list: Marker[]): void
  /** 앉아 있는 사람들 배치 */
  setSeats(list: Seat[]): Promise<void>
  /** 지금 걷고 있는가 (UI 힌트용) */
  isMoving(): boolean
}

/** 경찰서에 앉아 있는 사람. **다가가면 취조실로 데려간다.** */
export interface Seat {
  /** 용의자 id */
  id: string
  /** 착석 모델 slug — 심문 씬이 쓰는 것과 같은 표(roleSlug)에서 온다 */
  slug: string
  /** 방 안 위치 (미터). 벽 안이면 씬이 빈 칸으로 옮기고 이 값을 갱신한다. */
  at: [number, number]
  /** 화면에 뜰 이름 */
  label: string
  /** 이미 심문했는가 — 표시가 달라진다 */
  done: boolean
  /** 이 사람에게서 찾아낸 모순 수. **판단 근거가 화면에 있어야 걷기가 선택이 된다.** */
  stamps: number
  /** 기록으로 소거됐는가 — 소거된 사람은 자리에서 일어나 나간다 */
  cleared: boolean
}

export interface ExploreHandlers {
  /**
   * 마커에 **닿았을 때** — 아직 아무 일도 일어나지 않는다.
   * 근접만으로 조회를 소모하면 지나가다 조사를 잃는다. 자원 게임에서 그건 사고다.
   */
  onNear(id: string | null): void
  /** 플레이어가 **집겠다고 한 것** — E 키 또는 마커 클릭 */
  onPick(id: string): void
  /** 용의자에게 닿았을 때 */
  onNearSeat(id: string | null): void
  /**
   * **이 사람을 취조실로 데려간다.**
   * 화면은 "데려가겠다" 만 말한다 — 조사를 소모할지, 지금 가능한지는 engine 이 정한다.
   */
  onTake(id: string): void
}

const CHAR = import.meta.glob('/public/characters/*.walk.opt.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const WALK_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(CHAR)) {
  const slug = p.split('/').pop()?.replace('.walk.opt.glb', '')
  if (slug) WALK_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

/** 앉아 있는 사람들은 **심문 씬이 쓰는 착석 모델**을 그대로 쓴다 — 같은 사람이어야 한다 */
const SEATED = import.meta.glob('/public/characters/*.opt.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const SEAT_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(SEATED)) {
  const f = p.split('/').pop() ?? ''
  if (f.includes('.walk.')) continue          // 걷기 모델은 여기서 제외
  const slug = f.replace('.opt.glb', '')
  SEAT_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

/**
 * 경찰서. **취조실(`room.opt.glb`)은 그대로 둔다** — 심문 씬이 그 방의 좌석·조명을
 * 실측으로 못박고 있어서 건드리면 전부 다시 재야 한다. 여기는 그 앞 단계의 다른 공간이다.
 *
 * 원본은 노드 2,889개였다. 재질이 21종뿐이라 **전부 한 메시로 합쳐** 드로우콜을
 * 노드 수가 아니라 재질 수로 떨어뜨렸다(`scripts/merge_by_material.py`).
 * 천장(`Ceiling`)만 따로 남긴 이유는 **위에서 내려다보려면 그것을 숨겨야** 하기 때문이다 —
 * 합쳐버리면 숨길 수가 없다.
 */
const STATION_URL = (Object.values(
  import.meta.glob('/public/room/station.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string | undefined)?.replace(/^\/public/, '')

export const hasWalkModel = (slug: string): boolean => WALK_BY_SLUG.has(slug)
export const hasStation = (): boolean => Boolean(STATION_URL)

/**
 * 경찰서 실측 31.8 × 21.1 × 4.1m. 배율 1 로 그대로 쓴다 —
 * 취조실(1.8×2.0m)은 원본이 작아 1.9배를 곱했지만 이건 이미 실척이다.
 */
/**
 * 걸어 다닐 수 있는 범위는 **상수가 아니라 방에서 유도한다.**
 * 예전엔 `HALF_X=13 / HALF_Z=8` 을 원점 중심으로 박아 뒀는데, 이 경찰서의 실제
 * 월드 bbox 는 x[-16.9, 14.9] · z[-12.9, 8.2] 라 **중심이 (-1.0, -2.4)** 다.
 * 그래서 +X·+Z 쪽에서는 **아무것도 없는 바닥 위에서 보이지 않는 벽에 멈추고**,
 * 방이 실제로 뻗어 있는 x<-13 · z<-8 구역에는 영영 못 갔다.
 * 상수를 방에 맞추는 게 아니라 방에서 상수를 뽑는다.
 */
const EDGE_MARGIN = 0.45   // 바깥벽 안쪽으로 이만큼 물러선다
/**
 * m/s. 사람 걷기는 1.4, 뛰기는 3 이다. 방이 31.8 × 21.1m 라 실제 걷기 속도로는
 * 가로지르는 데 23초가 걸린다 — 조사 9회짜리 게임에서 그건 기다림이다.
 * 빠른 걸음(2.2)으로 타협한다. 1인칭에서 2.6 은 뛰는 것처럼 느껴졌다.
 */
const SPEED = 2.2
const PICK_RADIUS = 1.1    // 공간에 비례해 넓힌다 — 좁으면 계속 빗나간다
/** 표식이 뜨는 높이(m). 실척 인물의 허리쯤이라 눈에 걸린다. */
const MARK_Y = 0.85
/** 이 높이 위는 천장이다. 탑다운이므로 숨긴다. */
const CEILING_HIDE = true
/**
 * 앉은 사람의 키(m). **실척으로 되돌렸다** (2.6 → 1.35).
 *
 * 처음엔 "탑다운에서 점이 된다" 는 이유로 2배 넘게 키웠다. 그건 화각이 22 이고
 * 카메라가 고정이던 시절의 이야기다. 지금은 화각 13 에 인물을 따라다니므로
 * 1.35m 짜리도 화면에서 **약 90px** 로 읽힌다.
 *
 * 그리고 키운 대가가 컸다 — 이 방은 **실척**이다(책상 0.7~0.8m · 카운터 1.0m ·
 * 칸막이 1.2m, 실측). 사람만 2배면 책상에 앉은 거인이 되고, 1인칭으로 바꾸면
 * 그 어긋남이 그대로 눈높이로 온다.
 */
const SEAT_HEIGHT = 1.35
/** 걸어 다니는 나. 방이 실척이므로 사람도 실척이다. */
const ACTOR_HEIGHT = 1.78
/** 1인칭 눈높이(m). 키 1.78 인 사람의 눈은 대략 여기다. */
const EYE_HEIGHT = 1.64

/**
 * 반경 안에서 **가장 가까운** 것을 고른다. 순수 함수로 떼어낸 이유는
 * 이 판정이 틀리면 조사 1회를 오발로 잃기 때문이다 — 3D 씬은 테스트가 못 닿으므로
 * 판정만이라도 게이트가 보게 한다.
 */
/**
 * **다리 애니메이션의 축을 되돌린다** — 무릎이 뒤로 꺾이던 원인.
 *
 * ## 원인
 * 걷기 동작은 Mixamo 클립을 Meshy 오토리그에 리타게팅한 것이다
 * (`scripts/retarget.py`). 그런데 Copy Rotation 을 `LOCAL_WITH_PARENT` 로 걸면
 * 회전 성분이 **각 본의 rest 축 그대로** 복사되고, 블렌더는 두 리그의 rest 축 차이를
 * 보정해 주지 않는다. 그리고 이 리그는 **다리 본 8개만** Mixamo 대비
 * 자기 축(Y) 기준 **180° 롤**되어 있다 (몸통·팔·머리 15개는 정렬돼 있다).
 * 180° Y 롤은 X 와 Z 축을 뒤집으므로, 회전을 `(x, y, z, w) → (-x, y, -z, w)` 로
 * 되돌리면 원래 동작이 나온다.
 *
 * ## 어떻게 확인했나 — 세 가지가 같은 결론
 * 1. 무릎 **굽힘축**을 월드에서 재니 `(-1, 0, 0)` 이었다. 정면이 +Z 인 인물에서
 *    -X 굽힘은 정강이를 **앞으로** 접는다. 사람 무릎은 뒤로 접힌다.
 * 2. **팔꿈치**도 같이 재니 축 부호가 무릎과 **같았다**. 사람은 둘이 반대로 굽는다 —
 *    하나가 뒤집혔다는 뜻이고, 팔은 멀쩡했으니 다리다.
 * 3. 정면은 `headfront` 본으로 확정했다 (머리→headfront 가 +Z).
 *
 * ## 왜 무릎만 고치지 않았나 — 재서 갈랐다
 * 무릎 두 개만 되돌리면 무릎은 펴지는데 **발이 뒤로만 끌린다**(발목 Z -0.53~0.10).
 * 원인이 다리 체인 전체의 축이므로 8개를 다 되돌려야 걸음이 걸음이 된다(-0.42~0.32).
 *
 * ## 왜 런타임에서 고치나
 * 제대로 된 해법은 rest 축 차이를 보정해 리타게팅을 다시 하는 것이다(Blender 필요).
 * 이건 그때까지의 보정이고, 원본 GLB 를 건드리지 않는다.
 */
const LEG_BONES = new Set([
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
])

function unrollLegs(clip: THREE.AnimationClip, root: THREE.Object3D): void {
  /**
   * **rest 기준 delta 에 걸어야 한다 — 원 회전값에 걸면 안 된다.**
   * 어긋난 것은 "이 본이 rest 에서 얼마나 움직였나" 를 표현한 축이지 최종 자세가 아니다.
   * 원 회전값을 뒤집으면 rest 자세까지 같이 뒤집혀, rest 가 우연히 180° 에 가까운
   * 모델에서만 맞고 나머지는 망가진다. 실측이 그랬다:
   *
   * | 모델 | 원값 뒤집기 | rest delta 뒤집기 |
   * |---|---|---|
   * | security | 역꺾임 0 | 역꺾임 0 |
   * | **investor** | **역꺾임 59프레임 그대로 · 발목이 1.3m 로 솟음** | 역꺾임 0 |
   * | secretary | 역꺾임 0 (발목 Z -0.58~0.21, 한쪽으로 쏠림) | 역꺾임 0 (-0.45~0.31 균형) |
   */
  if ((clip as unknown as { __legsFixed?: boolean }).__legsFixed) return
  ;(clip as unknown as { __legsFixed?: boolean }).__legsFixed = true

  // mixer 가 돌기 전의 본 회전이 곧 rest 다
  const rest = new Map<string, THREE.Quaternion>()
  root.traverse((o) => { if (LEG_BONES.has(o.name)) rest.set(o.name, o.quaternion.clone()) })

  const inv = new THREE.Quaternion()
  const q = new THREE.Quaternion()
  const d = new THREE.Quaternion()
  for (const track of clip.tracks) {
    const m = /^(.+)\.quaternion$/.exec(track.name)
    const r = m ? rest.get(m[1]!) : undefined
    if (!r) continue
    inv.copy(r).invert()
    const v = track.values
    for (let i = 0; i + 3 < v.length; i += 4) {
      q.set(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!)
      d.copy(inv).multiply(q)                 // rest 기준 delta
      d.set(-d.x, d.y, -d.z, d.w)             // 본 축 180° 롤을 되돌린다
      q.copy(r).multiply(d)
      v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w
    }
  }
}

export function nearestWithin<T extends { id: string; at: [number, number] }>(
  items: readonly T[], x: number, z: number, radius: number,
): string | null {
  let best = radius * radius
  let hit: string | null = null
  for (const it of items) {
    const dx = x - it.at[0]
    const dz = z - it.at[1]
    const d = dx * dx + dz * dz
    if (d < best) { best = d; hit = it.id }
  }
  return hit
}

export async function mountExplore(
  host: HTMLElement,
  slug: string,
  handlers: ExploreHandlers,
): Promise<Explore3D | null> {
  if (!STATION_URL || !WALK_BY_SLUG.has(slug)) return null

  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')
    /**
     * **스킨드 메시는 `Object3D.clone()` 으로 복제하면 안 된다.**
     * 착석 모델 다섯은 전부 스킨(뼈대)이 있는데, 일반 clone 은 메시만 복제하고
     * `skeleton` 은 원본 뼈를 계속 가리킨다. 그러면 복제본이 자기 뼈를 못 찾아
     * **화면에서 통째로 사라진다** — 실제로 후광과 이름표만 뜨고 사람이 안 보였다.
     * 심문 씬(`stage3d.ts`)이 멀쩡했던 건 거기서는 복제를 안 하고 그대로 붙이기 때문이다.
     */
    const { clone: cloneSkinned } = await import('three/examples/jsm/utils/SkeletonUtils.js')

    const w = host.clientWidth || 640
    const h = host.clientHeight || 420
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    renderer.setSize(w, h)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0908)

    /**
     * **정사영 탑다운.** 60 Seconds! 가 그렇듯 방 전체가 한 화면에 들어와야
     * "어디로 갈지" 를 고를 수 있다. 원근이면 벽이 시야를 가린다.
     */
    /**
     * **두 개의 눈.**
     * 탑다운은 "어디로 갈지" 를 고르게 하고, 1인칭은 "거기 있다" 를 만든다.
     * 둘 다 필요해서 둘 다 둔다. V 로 바꾼다.
     *
     * 탑다운 화각을 22 → 13 으로 줄였다 — 방 전체가 다 보이면 인물이 점이 되고
     * 어디로 걷는지도 안 읽힌다. 인물을 따라다니게 하고 주변만 보여준다.
     */
    const VIEW = 13
    const camera = new THREE.OrthographicCamera(
      -VIEW * (w / h) / 2, VIEW * (w / h) / 2, VIEW / 2, -VIEW / 2, 0.1, 200)
    const CAM_OFF = new THREE.Vector3(9, 12, 9)   // 아이소메트릭 각도 유지
    camera.position.copy(CAM_OFF)
    camera.lookAt(0, 0, 0)

    /** 1인칭 눈. 정사영으로 1인칭을 하면 원근이 없어 방이 납작해진다. */
    /**
     * 1인칭 눈. 화각 72 → **60**. Three 의 fov 는 **세로** 화각이라 72 는 16:9 에서
     * 가로 100° 가 넘는다 — 방이 휘어 보이고 가까운 물건이 과장된다.
     */
    const eye = new THREE.PerspectiveCamera(60, w / h, 0.08, 200)

    const draco = new DRACOLoader().setDecoderPath('/draco/')
    const loader = new GLTFLoader().setDRACOLoader(draco)

    const [roomGltf, charGltf] = await Promise.all([
      loader.loadAsync(STATION_URL),
      loader.loadAsync(WALK_BY_SLUG.get(slug)!),
    ])

    const room = roomGltf.scene
    room.traverse((o) => {
      // 천장은 숨긴다 — 위에서 내려다보는 화면이므로. 합치지 않고 남겨둔 이유가 이것이다.
      if (CEILING_HIDE && /ceiling/i.test(o.name)) o.visible = false
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.receiveShadow = true
      for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
        if (!mm) continue
        // 심문 씬과 같은 처리 — Meshy·Sketchfab 모델은 기본적으로 스스로 빛난다
        mm.emissive?.setScalar(0)
        mm.emissiveMap = null
      }
    })
    scene.add(room)

    /**
     * 방 지오메트리에 **매 프레임 레이를 쏘면 느리다** — 이 방은 268,199 삼각형이고
     * BVH 가 없어서 한 번의 intersectObject 가 전수 검사다. 실제로 브라우저가 멎었다.
     *
     * 대신 **벽을 한 번만 격자로 구워둔다.** 로딩 때 방을 한 번 훑어
     * 0.5m 칸마다 "여기 벽이 있나" 를 기록하면, 이동 판정은 배열 조회 한 번이 된다.
     * 정확도는 칸 크기만큼 거칠지만, 필요한 것은 "벽을 못 지나간다" 하나뿐이다.
     */
    const CELL = 0.5

    /**
     * **걸을 수 있는 사각형을 방에서 뽑는다.** (위 `EDGE_MARGIN` 주석 참고)
     * 상수로 박으면 방이 바뀔 때마다 허공에 보이지 않는 벽이 생긴다.
     */
    const roomBox = new THREE.Box3().setFromObject(room)
    const MIN_X = roomBox.min.x + EDGE_MARGIN
    const MAX_X = roomBox.max.x - EDGE_MARGIN
    const MIN_Z = roomBox.min.z + EDGE_MARGIN
    const MAX_Z = roomBox.max.z - EDGE_MARGIN
    const GW = Math.ceil((MAX_X - MIN_X) / CELL) + 1
    const GH = Math.ceil((MAX_Z - MIN_Z) / CELL) + 1
    const solid = new Uint8Array(GW * GH)
    /**
     * **바닥이 있는 칸.** 이게 없으면 걷는 범위가 사각형이 되고, 이 건물은 L 자라
     * 그 사각형에는 **건물 밖 허공**이 들어간다 — 실측 1262칸 중 447칸이 바닥이 없었다.
     * 걸을 수 있는 곳은 "사각형 안" 이 아니라 **바닥이 있고 막히지 않은 곳**이다.
     */
    const floorAt = new Uint8Array(GW * GH)
    const inBox = (x: number, z: number): boolean =>
      x >= MIN_X && x <= MAX_X && z >= MIN_Z && z <= MAX_Z
    const gi = (x: number, z: number): number =>
      Math.round((z - MIN_Z) / CELL) * GW + Math.round((x - MIN_X) / CELL)

    /**
     * ## 높이 띠 — **보이는 것을 막는다** (재서 골랐다)
     * 처음엔 사람 허리(0.8~1.7m)를 훑었더니 가구가 전부 벽이 되어 미로가 됐고,
     * 그래서 가구 위(2.0~3.0m)로 올렸다. 그랬더니 이번엔 **거의 아무것도 안 막혔다** —
     * `scripts/probe-walkgrid.mjs` 로 재보니 화면에 장애물로 보이는 532칸 중
     * **149칸만 막고 384칸(72%)을 그대로 통과**했다. 책상·카운터·칸막이를 뚫고 다녔다.
     *
     * 그리고 **위쪽 끝을 문 상인방 아래로 내려야 한다.** 모서리 래스터화로 바꾸고 나서
     * 0.3~2.6m 로 구웠더니 문 위 상인방이 출입구를 통째로 막아 **걸어서 닿는 칸이
     * 1262 → 332 로 무너졌다.** 방 하나에 갇혔다는 뜻이다.
     *
     * | 띠 | 막음 | 보이는데 통과 | **걸어서 닿는 칸** |
     * |---|---|---|---|
     * | 0.3~2.6m | 1091 | 0 | **332** ← 문이 막힌다 |
     * | **0.3~1.9m** | **1047** | **44** | **1262** |
     * | 0.3~1.1m | 1000 | 91 | 1296 |
     *
     * 0.3~1.9m 를 쓴다. 남는 44칸은 **머리 위로 지나가는 것들**(상인방·간판)이라
     * 통과하는 게 맞다. 벽·책상·칸막이는 전부 이 띠에 있다.
     */
    const WALL_LO = 0.3
    const WALL_HI = 1.9
    /** 이 높이의 수평면을 **바닥**으로 본다 */
    const FLOOR_LO = -0.6
    const FLOOR_HI = 0.25

    /**
     * **정점만 찍으면 큰 벽이 뚫린다.**
     * 처음엔 정점 하나가 떨어진 칸만 막았다. 그런데 이 방은 최적화되어 합쳐진
     * 건축 메시라 벽 한 장이 **모서리가 4.76m 짜리 큰 삼각형**이다. 칸이 0.5m 이므로
     * 5m 벽이 양 끝 두 칸만 막고 **가운데 열 칸이 비었다** — 그 사이로 걸어 나갔다.
     *
     * 그래서 **삼각형의 모서리를 따라 찍는다.** 면 내부를 채우지 않는 이유는
     * 벽이 수직면이라 XZ 로 투영하면 **넓이가 0인 선**이 되기 때문이다 —
     * 면적 래스터화로는 벽이 아예 안 잡힌다. 발자국은 모서리에 있다.
     *
     * 레이캐스트는 여전히 안 쓴다. 26만 삼각형에 BVH 가 없어 브라우저가 멎었다.
     */
    const bakeWalls = (): void => {
      const a = new THREE.Vector3()
      const b = new THREE.Vector3()
      const p = new THREE.Vector3()
      // 삼각형 26만 개다 — 벡터를 매번 새로 만들면 80만 개를 할당한다. 돌려 쓴다.
      const v0 = new THREE.Vector3()
      const v1 = new THREE.Vector3()
      const v2 = new THREE.Vector3()
      room.updateMatrixWorld(true)

      /**
       * **바닥은 면적을 채운다.** 바닥은 몇 안 되는 큰 삼각형이라 모서리만 찍으면
       * 방 가장자리에 테두리만 생기고 가운데가 빈다 — 실제로 그렇게 재서
       * "도달한 칸의 99%에 바닥이 없다" 는 말이 안 되는 값이 나왔다.
       * 수평면은 XZ 로 투영해도 넓이가 남으므로 면적 래스터화가 맞다.
       */
      const fillFloor = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): void => {
        const x0 = Math.max(MIN_X, Math.min(p0.x, p1.x, p2.x))
        const x1 = Math.min(MAX_X, Math.max(p0.x, p1.x, p2.x))
        const z0 = Math.max(MIN_Z, Math.min(p0.z, p1.z, p2.z))
        const z1 = Math.min(MAX_Z, Math.max(p0.z, p1.z, p2.z))
        if (x1 < x0 || z1 < z0) return
        const side = (ax: number, az: number, bx: number, bz: number, px: number, pz: number): number =>
          (bx - ax) * (pz - az) - (bz - az) * (px - ax)
        for (let z = z0; z <= z1 + 1e-9; z += CELL) {
          for (let x = x0; x <= x1 + 1e-9; x += CELL) {
            const s1 = side(p0.x, p0.z, p1.x, p1.z, x, z)
            const s2 = side(p1.x, p1.z, p2.x, p2.z, x, z)
            const s3 = side(p2.x, p2.z, p0.x, p0.z, x, z)
            if ((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0)) continue
            floorAt[gi(x, z)] = 1
          }
        }
      }

      /** 한 모서리를 따라가며 띠 안에 들어오는 지점의 칸을 막는다 */
      const stamp = (): void => {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dz = b.z - a.z
        const len2d = Math.hypot(dx, dz)
        // **세로 모서리도 놓치지 않는다.** 벽 기둥은 XZ 길이가 0이라
        // 2D 길이만 보면 표본이 1개고, 그 한 점의 y 가 띠 밖이면 통째로 빠진다.
        const steps = Math.max(1,
          Math.ceil(len2d / (CELL * 0.5)),
          Math.ceil(Math.abs(dy) / (CELL * 0.5)))
        for (let k = 0; k <= steps; k++) {
          const t = k / steps
          p.set(a.x + dx * t, a.y + dy * t, a.z + dz * t)
          if (p.y < WALL_LO || p.y > WALL_HI) continue
          if (!inBox(p.x, p.z)) continue
          solid[gi(p.x, p.z)] = 1
        }
      }

      room.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        // **조상까지 본다.** 천장은 Group 에 visible=false 가 걸리고 자식 Mesh 는
        // true 로 남는다 — 자기 자신만 보면 숨긴 천장을 벽으로 구워 버린다.
        for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return
        const pos = m.geometry.getAttribute('position')
        if (!pos) return
        const idx = m.geometry.getIndex()
        const count = idx ? idx.count : pos.count
        for (let i = 0; i < count; i += 3) {
          const i0 = idx ? idx.getX(i) : i
          const i1 = idx ? idx.getX(i + 1) : i + 1
          const i2 = idx ? idx.getX(i + 2) : i + 2
          v0.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld)
          v1.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld)
          v2.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld)
          const lo = Math.min(v0.y, v1.y, v2.y)
          const hi = Math.max(v0.y, v1.y, v2.y)
          if (hi >= FLOOR_LO && lo <= FLOOR_HI) fillFloor(v0, v1, v2)
          // 셋 다 띠 위이거나 셋 다 띠 아래면 이 삼각형은 몸에 안 닿는다
          if (hi < WALL_LO || lo > WALL_HI) continue
          a.copy(v0); b.copy(v1); stamp()
          a.copy(v1); b.copy(v2); stamp()
          a.copy(v2); b.copy(v0); stamp()
        }
      })
    }

    /**
     * **몸 반지름은 보지 않는다.** 칸이 0.5m 라 중심 한 점만 봐도 약 0.25m 의
     * 여유가 이미 들어 있고, 반지름을 더 주면 책상 사이 통로가 통째로 막힌다.
     * 어깨가 벽에 반 칸 파고들어 보이는 것은 감수한다 — 탑다운에서는 잘 안 보이고,
     * 못 지나가는 것보다 낫다.
     */
    const blocked = (x: number, z: number): boolean => {
      if (!inBox(x, z)) return true
      const i = gi(x, z)
      // **바닥이 없으면 못 간다.** 건물이 L 자라 사각형 경계만으로는 허공이 걸린다.
      return solid[i] === 1 || floorAt[i] === 0
    }


    /**
     * **노멀맵을 살리는 재질.**
     * 걷기 모델을 처음에 1024·PBR 복원 없이 뽑았더니 텍스처가 baseColor 한 장만
     * 남아 "로우폴리처럼" 보였다 — 폴리곤은 296,547개로 충분했고,
     * 사라진 것은 **표면 요철(노멀맵)** 이었다. 이 프로젝트가 이미 한 번 겪은 원인이다.
     * 이제 3장이 다 있으므로 roughness/metalness 를 상수로 덮어쓰면 안 된다.
     */
    const dressUp = (root: THREE.Object3D): void => {
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.castShadow = true
        for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          if (!mm) continue
          mm.emissive?.setScalar(0)
          mm.emissiveMap = null
          // 맵이 있으면 계수는 1로 둔다 — 상수로 덮으면 맵이 죽는다(glTF 는 곱셈이다)
          if (mm.roughnessMap) { mm.roughness = 1; mm.metalness = mm.metalnessMap ? 1 : 0 }
          else { mm.roughness = 0.62; mm.metalness = 0 }
          if (mm.normalMap) mm.normalScale?.set(1.15, 1.15)   // 탑다운이라 살짝 강조
        }
      })
    }

    const actor = charGltf.scene
    // 걷기 리그는 A포즈 rest 라 원래 크기다. 방 배율에 맞춘다.
    const height = measuredHeight(actor)
    actor.scale.setScalar(height > 0 ? ACTOR_HEIGHT / height : 1)
    dressUp(actor)
    scene.add(actor)

    {
      // 굽는 시간은 로딩에 그대로 얹힌다 — DEV 에서 눈에 보이게 남긴다
      const t0 = performance.now()
      bakeWalls()
      if (import.meta.env.DEV) {
        let n = 0
        for (const c of solid) if (c) n++
        console.info(`[탐색] 벽 격자 ${GW}x${GH} · 막힌 칸 ${n} · ${Math.round(performance.now() - t0)}ms`)
      }
    }

    /**
     * **문을 연다.** — 방과 방을 가르는 **가장 얇은 칸막이**를 뚫어 준다.
     *
     * ## 왜 이름으로 못 찾나
     * 이 경찰서는 노드 2,889개를 재질별로 합쳐 2개로 줄인 모델이라
     * (`scripts/merge_by_material.py`) **문이라는 이름이 남아 있지 않다.**
     * 재질도 `Wall___Column` · `Props` 뿐이고 door 계열이 없다.
     * (다른 후보 모델 `police_station.glb` 에는 `Door_00`… 이 있지만 그건 안 쓰는 모델이다.)
     *
     * ## 그래서 두께로 찾는다
     * 문은 얇고 벽은 두껍다. 시작점에서 **"빈 칸은 공짜, 막힌 칸은 1"** 로 0-1 BFS 를
     * 돌리면, 각 칸까지 가는 데 **몇 겹을 뚫어야 하는지**가 나온다. 그 값이 상한 이하인
     * 칸까지의 경로만 열어 준다.
     *
     * | 상한 | 뚫은 칸 | 걸을 칸 | 도달 칸 |
     * |---|---|---|---|
     * | 0 (안 뚫음) | 0 | 890 | 795 |
     * | **2칸 = 1.0m** | **15** | **905** | **901** |
     * | 4칸 = 2.0m | 24 | 914 | 914 |
     *
     * 1.0m 에서 사실상 다 열린다(905 중 901). 더 올리면 9칸을 더 뚫어 13칸을 더 얻는데,
     * 그건 문이 아니라 **벽을 뚫는 것**이다. 남는 4칸은 1m² 라 방이 아니다.
     */
    const DOOR_MAX = 2      // 뚫어 줄 최대 두께(칸). 0.5m × 2 = 1.0m
    const openDoors = (sx: number, sz: number): number => {
      const N = GW * GH
      const dist = new Int32Array(N).fill(0x7fffffff)
      const prev = new Int32Array(N).fill(-1)
      const start = gi(sx, sz)
      dist[start] = 0
      // 0-1 BFS — 공짜 이동은 앞에, 뚫는 이동은 뒤에 넣는다
      const dq: number[] = [start]
      let head = 0
      while (head < dq.length) {
        const i = dq[head++]!
        const r = Math.floor(i / GW)
        const c = i % GW
        for (const j of [
          r > 0 ? i - GW : -1, r < GH - 1 ? i + GW : -1,
          c > 0 ? i - 1 : -1, c < GW - 1 ? i + 1 : -1,
        ]) {
          if (j < 0) continue
          if (floorAt[j] === 0) continue          // 건물 밖으로는 문을 내지 않는다
          const w = solid[j] === 1 ? 1 : 0
          if (dist[i]! + w < dist[j]!) {
            dist[j] = dist[i]! + w
            prev[j] = i
            if (w) dq.push(j)
            else { dq.splice(head, 0, j) }        // 공짜 이동은 지금 처리할 자리에
          }
        }
      }
      let opened = 0
      for (let i = 0; i < N; i++) {
        if (floorAt[i] === 0 || solid[i] === 1) continue
        if (dist[i] === 0 || dist[i]! > DOOR_MAX) continue
        for (let j = i; j !== -1 && dist[j]! > 0; j = prev[j]!) {
          if (solid[j] === 1) { solid[j] = 0; opened++ }
        }
      }
      return opened
    }

    /**
     * **의자를 찾는다 — 이름이 아니라 기하로.**
     *
     * "의자 위치를 눈대중으로 맞추지 말고 좌표를 뽑아서 배치하라" — 그대로 한다.
     * 이 방은 재질이 합쳐져 있지만 의자·탁자 재질(`Chair___Table`)이 따로 남아 있어서
     * 그 재질의 삼각형만 보면 된다. 좌면 높이(0.35~0.62m)의 수평면을 XZ 로 뭉치면
     * 뭉치 하나가 의자 하나다.
     *
     * 선반과 의자는 **등받이**로 가른다 — 책상 밑 선반도 좌면 높이의 수평면이지만
     * 등받이가 없다. 뭉치 근처 0.62~1.2m 의 수직면 무게중심이 등받이고, 그 반대쪽이
     * 의자가 보는 방향이다. 등받이 없는 뭉치는 버린다.
     *
     * ("위가 막히면 책상 밑 선반" 필터는 시도했다가 버렸다 — 이 재질에는 **탁자도**
     * 들어 있어서, 책상 앞에 밀어 넣은 의자가 전부 걸러졌다. 런타임 실측 의자 0개.
     * 책상 안쪽 선반이 등받이 요건을 뚫고 들어와도, 그런 자리는 사방이 막혀 있어
     * `pickChair` 의 "다가갈 수 있는가" 검사가 걸러 준다.)
     */
    interface ChairSpot { x: number; z: number; y: number; facing: number }
    const findChairs = (): ChairSpot[] => {
      interface Acc { x: number; z: number; y: number; w: number; bx: number; bz: number; bn: number }
      const seatsAcc: Acc[] = []
      const v0 = new THREE.Vector3()
      const v1 = new THREE.Vector3()
      const v2 = new THREE.Vector3()
      const n_ = new THREE.Vector3()
      const e1 = new THREE.Vector3()
      const e2 = new THREE.Vector3()
      room.updateMatrixWorld(true)
      room.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        if (!mats.some((mm) => /chair/i.test((mm as THREE.Material)?.name ?? ''))) return
        const pos = m.geometry.getAttribute('position')
        if (!pos) return
        const idx = m.geometry.getIndex()
        const count = idx ? idx.count : pos.count
        for (let i = 0; i + 2 < count; i += 3) {
          v0.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld)
          v1.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld)
          v2.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld)
          e1.subVectors(v1, v0)
          e2.subVectors(v2, v0)
          n_.crossVectors(e1, e2)
          const area = n_.length() / 2
          if (area < 1e-6) continue
          const ny = Math.abs(n_.y) / (area * 2)
          const cy = (v0.y + v1.y + v2.y) / 3
          const cx = (v0.x + v1.x + v2.x) / 3
          const cz = (v0.z + v1.z + v2.z) / 3
          if (ny > 0.8 && cy > 0.35 && cy < 0.62) {
            let c = seatsAcc.find((k) => Math.hypot(k.x - cx, k.z - cz) < 0.45)
            if (!c) { c = { x: cx, z: cz, y: 0, w: 0, bx: 0, bz: 0, bn: 0 }; seatsAcc.push(c) }
            const w = c.w + area
            c.x = (c.x * c.w + cx * area) / w
            c.z = (c.z * c.w + cz * area) / w
            c.y = (c.y * c.w + cy * area) / w
            c.w = w
          }
          if (ny < 0.35 && cy > 0.62 && cy < 1.2) {
            const c = seatsAcc.find((k) => Math.hypot(k.x - cx, k.z - cz) < 0.5)
            if (c) { c.bx += cx; c.bz += cz; c.bn++ }
          }
        }
      })
      return seatsAcc
        .filter((c) => c.w > 0.1 && c.w < 2.0)
        .filter((c) => c.bn > 3)
        .map((c) => ({ x: c.x, z: c.z, y: c.y,
          facing: Math.atan2(c.x - c.bx / c.bn, c.z - c.bz / c.bn) }))
    }
    const chairs = findChairs()
    if (import.meta.env.DEV) {
      console.info(`[탐색] 의자 ${chairs.length}개 실측`,
        chairs.map((c) => `(${c.x.toFixed(1)},${c.z.toFixed(1)})`).join(' '))
    }

    /**
     * **걸어서 닿는 칸을 미리 구해 둔다.**
     *
     * 보이는 것을 전부 막으면(0.3~2.6m) 책상 뒤·구석에 **고립된 칸이 18개** 생긴다.
     * "빈 칸" 만 보고 사람이나 기록을 놓으면 그 중 하나에 떨어질 수 있고,
     * 그러면 **평생 못 닿는 자리**가 된다 — 그 사람은 없는 것과 같다.
     * 그래서 시작점에서 한 번 BFS 를 돌려 도달 가능한 칸을 표시해 둔다.
     */
    const reach = new Uint8Array(GW * GH)
    const floodFrom = (x: number, z: number): void => {
      reach.fill(0)
      const start = gi(x, z)
      if (blocked(x, z)) return
      reach[start] = 1
      const q = [start]
      for (let h = 0; h < q.length; h++) {
        const i = q[h]!
        const r = Math.floor(i / GW)
        const c = i % GW
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = r + dr
          const nc = c + dc
          if (nr < 0 || nr >= GH || nc < 0 || nc >= GW) continue
          const n = nr * GW + nc
          // **`blocked()` 와 같은 조건이어야 한다.** 여기서 solid 만 보면 바닥 없는
          // 허공까지 "닿는 칸" 으로 세고, 그러면 사람이 못 서는 자리에 사람을 놓는다.
          if (solid[n] === 1 || floorAt[n] === 0 || reach[n] === 1) continue
          reach[n] = 1
          q.push(n)
        }
      }
    }

    /** 걸어서 닿는 칸인가. 격자 밖·벽·고립된 구석은 전부 아니다. */
    const reachable = (x: number, z: number): boolean =>
      inBox(x, z) && reach[gi(x, z)] === 1

    /**
     * **닿는 자리에 놓는다.** 지정한 좌표가 벽 안이거나 고립돼 있으면
     * 가장 가까운 **도달 가능한** 칸으로 옮긴다. 예전에는 "빈 칸" 만 봤는데,
     * 그건 벽 뒤 구석도 통과시킨다.
     */
    const placeReachable = (o: THREE.Object3D, x: number, z: number): void => {
      // **y 는 건드리지 않는다.** `groundIt()` 이 맞춰 놓은 접지 높이를 여기서 0으로
      // 덮어쓰면 다시 공중에 뜨거나 바닥에 묻힌다. 자리를 옮기는 것과 발을 붙이는 것은
      // 다른 일이고, 서로를 지우면 안 된다.
      const put = (px: number, pz: number): void => { o.position.x = px; o.position.z = pz }
      if (reachable(x, z)) { put(x, z); return }
      for (let r = CELL; r < 14; r += CELL) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const px = x + Math.cos(a) * r
          const pz = z + Math.sin(a) * r
          if (reachable(px, pz)) { put(px, pz); return }
        }
      }
      put(x, z)
    }

    /**
     * 시작점부터 정한다 — **여기가 막혀 있으면 한 발도 못 뗀다.**
     * 지정한 (0, 5) 가 막혔으면 가장 가까운 빈 칸에서 시작하고,
     * 그 자리를 기준으로 도달 가능 영역을 다시 구한다.
     */
    {
      let sx = 0
      let sz = 5
      if (blocked(sx, sz)) {
        outer: for (let r = CELL; r < 14; r += CELL) {
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
            const px = sx + Math.cos(a) * r
            const pz = sz + Math.sin(a) * r
            if (!blocked(px, pz)) { sx = px; sz = pz; break outer }
          }
        }
      }
      const doors = openDoors(sx, sz)
      floodFrom(sx, sz)
      actor.position.set(sx, 0, sz)
      groundIt(actor)
      if (import.meta.env.DEV) {
        let n = 0
        for (const c of reach) if (c) n++
        console.info(`[탐색] 문 ${doors}칸 뚫음 · 걸어서 닿는 칸 ${n}`)
      }
    }

    const mixer = new THREE.AnimationMixer(actor)
    const clip = charGltf.animations[0]
    if (clip) unrollLegs(clip, actor)
    const walk = clip ? mixer.clipAction(clip) : null
    walk?.play()
    if (walk) walk.paused = true      // 멈춰 있을 때는 정지 프레임

    // 조명 — 심문실보다 밝게. 어두우면 어디로 갈지 안 보인다.
    // 넓은 실내라 점광 하나로는 구석이 안 보인다. 환경광을 올리고 위에서 넓게 비춘다.
    scene.add(new THREE.AmbientLight(0xffd9b0, 0.85))
    const key = new THREE.DirectionalLight(0xfff0d8, 1.6)
    key.position.set(8, 18, 6)
    // 그림자가 있어야 인물이 바닥에 '서 있는' 것으로 보인다. 정사영이라 카메라 절두체에 맞춘다.
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 60
    key.shadow.bias = -0.0009
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0x8899bb, 0x2a1c20, 0.5))

    /**
     * **벽 충돌.** 지금까지는 사각 경계로만 막아서 내부 벽을 그냥 통과했다.
     *
     * 물리 엔진을 넣지 않는다 — 이 게임에 필요한 건 "벽을 못 지나간다" 하나뿐이고,
     * 그건 **가려는 방향으로 레이를 쏘는 것**으로 끝난다. 방 지오메트리가 이미 씬에 있다.
     * 세 방향(정면·좌사선·우사선)으로 쏘는 이유는, 한 줄기만 쏘면 벽에 비스듬히
     * 붙어 걸을 때 모서리를 파고들기 때문이다.
     */
    // ── 마커 ──
    const markerRoot = new THREE.Group()
    scene.add(markerRoot)
    let markers: Marker[] = []

    /** 기록 종류마다 다른 실루엣 — 멀리서도 무엇인지 읽힌다 */
    const shapeOf = (k: Marker['kind']): THREE.BufferGeometry => {
      switch (k) {
        case 'cctv':    return new THREE.ConeGeometry(0.28, 0.5, 4)            // 렌즈가 향하는 원뿔
        case 'keycard': return new THREE.BoxGeometry(0.44, 0.05, 0.28)         // 납작한 카드
        case 'call':    return new THREE.TorusGeometry(0.22, 0.07, 8, 20)      // 수화기 코드
        case 'autopsy': return new THREE.CylinderGeometry(0.3, 0.34, 0.09, 14) // 낮은 원판 — 검시 접시
        default:        return new THREE.CylinderGeometry(0.06, 0.06, 0.52, 6) // 말린 영수증
      }
    }

    /** 표식 하나를 **닿는 자리**로 옮겨 그 좌표를 돌려준다. 화면과 근접 판정이 같은 값을 본다. */
    const spotFor = (at: [number, number]): [number, number] => {
      const probe = new THREE.Object3D()
      placeReachable(probe, at[0], at[1])
      return [probe.position.x, probe.position.z]
    }

    const setMarkers = (list: Marker[]): void => {
      /**
       * **못 닿는 자리에 놓지 않는다.** 보이는 것을 전부 막고 나면(0.3~2.6m)
       * 손으로 찍은 장소 좌표가 책상 안이나 고립된 구석에 떨어질 수 있다.
       * 그러면 그 기록은 걸어서는 영영 못 줍는다 — 조회 목록으로만 남는다.
       * 옮긴 좌표를 `at` 에 되써서 근접 판정도 같은 자리를 본다.
       */
      markers = list.map((m) => ({ ...m, at: spotFor(m.at) }))
      list = markers
      for (const c of markerRoot.children) {
        const mesh = c as THREE.Mesh
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      markerRoot.clear()
      for (const m of list) {
        const g = new THREE.Mesh(
          shapeOf(m.kind),
          new THREE.MeshStandardMaterial({
            // 범행 시각 기록은 붉게 — 사람을 지우는 유일한 물건이다
            color: m.crime ? 0xb3372c : 0xc8912f,
            emissive: m.crime ? 0x5a1a14 : 0x4a3410,
            roughness: 0.45, metalness: 0.3,
          }),
        )
        g.position.set(m.at[0], MARK_Y, m.at[1])
        g.userData.id = m.id
        markerRoot.add(g)

        // 바닥에 옅은 원 — 어디까지 가야 닿는지 보인다
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(PICK_RADIUS - 0.1, PICK_RADIUS, 28),
          new THREE.MeshBasicMaterial({
            color: m.crime ? 0xb3372c : 0xc8912f,
            transparent: true, opacity: 0.16, side: THREE.DoubleSide,
          }),
        )
        halo.rotation.x = -Math.PI / 2
        halo.position.set(m.at[0], 0.04, m.at[1])
        halo.userData.id = m.id
        markerRoot.add(halo)
      }
    }

    // ── 앉아 있는 사람들 ──
    const seatRoot = new THREE.Group()
    // 개발 중에만 씬을 밖에서 들여다볼 수 있게 둔다 — 3D 는 콘솔 없이는 원인을 못 찾는다.
    // 실제로 "사람이 안 보인다" 를 이걸로 잡았다. 배포 번들에는 들어가지 않는다.
    if (import.meta.env.DEV) {
      /**
       * **막힌 칸을 눈으로 본다.** 충돌은 숫자로는 맞는데 화면과 안 맞을 수 있고,
       * 그 어긋남은 격자를 그려 보기 전까지는 절대 안 잡힌다. DEV 에서만 산다.
       */
      const debugGrid = (): void => {
        const g = new THREE.Group()
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.45 })
        const geo = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92)
        for (let r = 0; r < GH; r++) {
          for (let c = 0; c < GW; c++) {
            if (!solid[r * GW + c]) continue
            const m = new THREE.Mesh(geo, mat)
            m.rotation.x = -Math.PI / 2
            m.position.set(c * CELL + MIN_X, 0.06, r * CELL + MIN_Z)
            g.add(m)
          }
        }
        scene.add(g)
      }
      ;(window as unknown as Record<string, unknown>).__ex =
        { scene, seatRoot, markerRoot, camera, room, actor, solid, gi, blocked, GW, GH, CELL, debugGrid }
    }
    scene.add(seatRoot)
    let seats: Seat[] = []
    /** 같은 모델을 두 번 받지 않는다 — 다섯 명이 같은 직업이면 한 번만 받는다 */
    const seatCache = new Map<string, THREE.Object3D>()

    /** 인물 위에 뜨는 이름표 — 캔버스로 그려 스프라이트로 붙인다 (웹폰트 0) */
    const makeLabel = (st: Seat): THREE.Sprite => {
      const c = document.createElement('canvas')
      c.width = 512; c.height = 128
      const g = c.getContext('2d')!
      g.fillStyle = 'rgba(13,9,8,.82)'
      g.roundRect?.(6, 22, 500, 84, 14); g.fill()
      g.strokeStyle = st.done ? '#4f9b6e' : '#c8912f'
      g.lineWidth = 3; g.stroke()
      g.textAlign = 'center'
      g.fillStyle = '#e9e1d3'
      g.font = 'bold 40px "Apple SD Gothic Neo", sans-serif'
      g.fillText(st.label.split(' · ')[0] ?? '', 256, 62)
      g.fillStyle = st.stamps > 0 ? '#b3372c' : '#9a8b80'
      g.font = '26px "Apple SD Gothic Neo", sans-serif'
      const sub = st.cleared ? '기록으로 소거됨'
        : st.stamps > 0 ? `모순 ${st.stamps}건`
        : (st.label.split(' · ')[1] ?? '')
      g.fillText(sub, 256, 96)

      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      // 이름표는 4.4m 폭이었다 — 키 2.6m 인물 옆에서는 맞았지만 실척(1.35m)에서는
      // 사람보다 세 배 넓은 간판이 된다. 사람 어깨폭의 네 배쯤으로 줄인다.
      sp.scale.set(2.2, 0.55, 1)
      sp.position.set(st.at[0], SEAT_HEIGHT + 0.55, st.at[1])
      sp.renderOrder = 10
      return sp
    }

    /** 이번 판에서 이미 배정한 의자 — 두 사람이 같은 의자에 겹치면 안 된다 */
    const takenChairs = new Set<ChairSpot>()
    /**
     * setSeats 재진입 토큰. **이게 없으면 사람이 두 명씩 그려진다** — 실측 스크린샷에서
     * 서지후·한세아가 각각 두 의자에 앉아 있었다. exploreRoom() 은 매 렌더마다
     * setSeats 를 부르는데 안에 await(모델 로드)가 있어서, 겹쳐 돈 두 호출이
     * 서로 다른 의자를 배정하며 둘 다 seatRoot 에 모델을 넣는다.
     * 그 결과가 신고된 버그 둘이다: 눈앞의 (낡은 복제) 인물 곁에서 E 가 안 먹고
     * (등록 좌표는 다른 의자다), 겹친 두 모델의 다리가 얽혀 "붙어" 보인다.
     */
    let seatEpoch = 0
    const pickChair = (ax: number, az: number): ChairSpot | null => {
      let best: ChairSpot | null = null
      let bestD = 4.5                     // 앵커에서 이보다 멀면 "근처 의자" 가 아니다
      for (const c of chairs) {
        if (takenChairs.has(c)) continue
        // 플레이어가 다가갈 자리 — 의자 주변 여덟 방향 중 하나는 걸을 수 있어야 한다
        let approachable = false
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          if (reachable(c.x + Math.cos(a) * 0.8, c.z + Math.sin(a) * 0.8)) { approachable = true; break }
        }
        if (!approachable) continue
        const d = Math.hypot(c.x - ax, c.z - az)
        if (d < bestD) { bestD = d; best = c }
      }
      if (best) takenChairs.add(best)
      return best
    }

    const setSeats = async (list: Seat[]): Promise<void> => {
      const epoch = ++seatEpoch
      takenChairs.clear()
      /**
       * **화면에 있는 사람만 E 의 대상이다.**
       * 소거됐거나 착석 모델이 없어 안 그린 사람이 `seats` 에 남아 있으면, 그의 at 는
       * 의자로 옮겨진 적 없는 **앵커 원좌표**다 — 보이지 않는 좌석이 방 한가운데서
       * 근접 판정(nearestWithin)을 가로채 "빈 바닥에 E" 가 되거나, 보이는 사람 곁에서
       * E 가 유령을 연행한다. 실제로 그린 사람만 판정 목록에 올린다.
       */
      const placed: Seat[] = []
      seatRoot.clear()
      for (const st of list) {
        /**
         * **소거된 사람은 자리에 없다.**
         * 기록이 그를 지웠으면 경찰서에 붙잡아 둘 이유가 없다 — 집에 갔다.
         * 방이 비어갈수록 남은 후보가 조여드는 게 **몸으로** 보인다.
         * 클릭 목록으로는 줄 수 없는 정보이고, 새 에셋이 0개다.
         */
        if (st.cleared) continue
        const url = SEAT_BY_SLUG.get(st.slug)
        if (!url) continue
        let proto = seatCache.get(st.slug)
        if (!proto) {
          const g = await loader.loadAsync(url)
          // 로드하는 사이 새 배치가 시작됐으면 이 판은 폐기한다 — 늦게 온 손이 얹으면 두 명이 된다
          if (epoch !== seatEpoch) return
          proto = g.scene
          dressUp(proto)
          seatCache.set(st.slug, proto)
        }
        if (epoch !== seatEpoch) return
        const o = cloneSkinned(proto)
        // 착석 모델은 rest pose 가 앉은 자세라 그대로 놓으면 된다.
        // 크기는 사람 키(1.7m)에 맞춘다 — 모델마다 원본 스케일이 다르다.
        const hgt = measuredHeight(o)
        /**
         * **탑다운에서는 실척이 곧 안 보임이다.**
         * 공간이 31.8×21.1m 인데 앉은 사람은 1.2m 라 화면에서 점이 된다.
         * 60 Seconds! 도 캐릭터를 방 대비 크게 그린다 — 조작 대상이 보여야 하기 때문이다.
         * 사실적 비례를 버리고 **읽히는 크기**를 택한다.
         */
        /**
         * **말이 안 되는 배율은 거부한다.**
         * 착석 모델 세 개가 포즈가 안 먹은 채(리그가 달라서) 배포된 적이 있다.
         * 그중 하나는 **누워 있었고**(가장 긴 축이 깊이), 키가 0.34m 로 재져서
         * 배율이 **4.03배**가 됐다 — 책상 위에 뻗은 거인이 나왔다.
         * 정상적으로 앉은 사람은 1.30~1.40m 로 재지고 배율이 0.96~1.04 다.
         * 그 밖이면 **키우지 않고 그대로 둔다** — 작게 나오는 게 괴물보다 낫다.
         */
        const scale = hgt > 0 ? SEAT_HEIGHT / hgt : 1
        if (scale > 0.6 && scale < 1.8) o.scale.setScalar(scale)
        else if (import.meta.env.DEV) {
          console.warn(`[탐색] ${st.slug} 착석 모델이 이상하다 — 키 ${hgt.toFixed(2)}m, 배율 ${scale.toFixed(2)}. 배율을 적용하지 않는다.`)
        }
        groundIt(o)
        /**
         * **실측한 의자에 앉힌다.** 앵커에서 가장 가까운 미사용 의자를 고르되,
         * 플레이어가 다가갈 수 있어야 하므로 의자 곁에 걸을 수 있는 칸이 있는 것만 쓴다.
         * 근처에 의자가 없으면 예전처럼 바닥의 닿는 자리에 세운다 — 의자가 없다고
         * 사람이 사라지면 안 된다.
         */
        const chair = pickChair(st.at[0], st.at[1])
        if (chair) {
          o.position.x = chair.x
          o.position.z = chair.z
          // 엉덩이를 좌면에 얹는다 — 발바닥 기준(0)으로는 좌면과 8cm쯤 어긋난다
          let hips: THREE.Object3D | null = null
          o.traverse((b) => { if (!hips && /^Hips$/.test(b.name)) hips = b })
          if (hips) {
            const hv = new THREE.Vector3()
            ;(hips as THREE.Object3D).getWorldPosition(hv)
            const lift = chair.y - hv.y
            if (lift > -0.05 && lift < 0.25) o.position.y += lift
          }
          o.rotation.y = chair.facing               // 의자가 보는 쪽을 본다
          st.at = [chair.x, chair.z]
        } else {
          // **벽 안에 앉히지 않는다.** 못 닿는 자리에 두면 그 사람은 없는 것과 같다.
          placeReachable(o, st.at[0], st.at[1])
          st.at = [o.position.x, o.position.z]
          o.rotation.y = Math.atan2(-st.at[0], -st.at[1])   // 방 가운데를 본다
        }
        o.userData.seatId = st.id
        seatRoot.add(o)

        /**
         * **이름표.** 이게 없으면 대기실에서 보이는 건 익명의 실루엣 다섯이고,
         * 그러면 격자에서 이름을 눌러 들어가는 기존 경로가 모든 면에서 낫다 —
         * 빠르고, 그 사람의 모순 인장을 보면서 고를 수 있다.
         * 걸어가는 몇 초가 판단 시간이 되려면 **걸어가는 동안 그 사람을 알아야** 한다.
         */
        seatRoot.add(makeLabel(st))

        // 발치 표식 — 이미 심문한 사람은 초록, 아직이면 놋쇠
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(PICK_RADIUS - 0.14, PICK_RADIUS + 0.25, 32),
          new THREE.MeshBasicMaterial({
            color: st.done ? 0x4f9b6e : 0xc8912f,
            transparent: true, opacity: st.done ? 0.2 : 0.45, side: THREE.DoubleSide,
          }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(st.at[0], 0.03, st.at[1])
        ring.userData.seatId = st.id
        seatRoot.add(ring)
        placed.push(st)
      }
      if (epoch === seatEpoch) seats = placed
    }

    // ── 입력 ──
    // **`tick()`·핸들러가 참조하는 것은 전부 그보다 먼저 선언한다.**
    // 이 프로젝트는 stage3d.ts 에서 같은 TDZ 를 두 번 밟았다(lastFrame·applyCam).
    let near: string | null = null
    /** 지금 닿아 있는 사람 */
    let nearSeat: string | null = null
    /** 1인칭인가. V 로 토글한다 — 넓은 탑다운은 방을 보여주고 1인칭은 방에 있게 한다. */
    let firstPerson = false
    const keys = new Set<string>()
    /**
     * **`e.key` 를 쓰면 한글 모드에서 통째로 죽는다.**
     * 한글 입력 상태에서 E 를 누르면 `e.key` 는 'ㄷ' 이고, W·A·S·D 는 'ㅈㅁㄴㄷ' 다.
     * 이 프로젝트는 이미 한글 IME 로 한 번 당했다(Enter 로 질문이 잘려 조사 1회가 날아갔다).
     * `e.code` 는 **물리 키 위치**라 자판 배열·IME 와 무관하다.
     */
    const MOVE_CODES = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
    ])
    const onDown = (e: KeyboardEvent): void => {
      /**
       * **글을 쓰는 중이면 손대지 않는다.** 이 핸들러는 window 에 붙고 이동키에
       * `preventDefault()` 를 건다 — 질문 입력창에 포커스가 있을 때도 걸리면
       * 심문 질문에 ㅁㄴㅇㄹ 를 못 친다. 스페이스도 마찬가지다.
       */
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        || (t instanceof HTMLElement && t.isContentEditable)) return
      if (e.code === 'KeyE' || e.code === 'Space') {
        // **사람이 우선한다.** 둘 다 닿아 있으면 연행이 조회보다 큰 행동이다.
        if (nearSeat) { handlers.onTake(nearSeat); e.preventDefault(); return }
        if (near) { handlers.onPick(near); e.preventDefault(); return }
      }
      if (e.code === 'KeyV') { firstPerson = !firstPerson; e.preventDefault(); return }
      if (MOVE_CODES.has(e.code)) { keys.add(e.code); e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent): void => { keys.delete(e.code) }
    /**
     * **포커스를 잃으면 keyup 이 안 온다.**
     * W 를 누른 채 탭을 옮기거나 다른 창을 클릭하면 그 키가 **영영 눌린 상태로 남고**,
     * 돌아왔을 때 아무도 안 눌렀는데 인물이 계속 직진한다. 신고된 증상이 이것이다.
     * 키 입력은 클릭 목표보다 우선이라 목표 포기 가드로도 안 풀린다 — 여기서 끊어야 한다.
     */
    const clearKeys = (): void => keys.clear()
    const onVis = (): void => { if (document.hidden) keys.clear() }
    addEventListener('keydown', onDown)
    addEventListener('keyup', onUp)
    addEventListener('blur', clearKeys)
    document.addEventListener('visibilitychange', onVis)

    /** 화면 좌표 → 바닥 평면. 클릭한 자리로 걸어간다. */
    const ray = new THREE.Raycaster()
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let goal: THREE.Vector3 | null = null
    const onClick = (e: MouseEvent): void => {
      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, firstPerson ? eye : camera)
      // 마커를 눌렀으면 줍는 것이지 거기로 걸어가는 게 아니다
      const onSeat = ray.intersectObjects(seatRoot.children, true)[0]
      if (onSeat) {
        // 클릭한 것이 사람이면 연행이다. 자식 메시가 잡히므로 부모까지 거슬러 올라간다.
        let n: THREE.Object3D | null = onSeat.object
        while (n && !n.userData.seatId) n = n.parent
        if (n?.userData.seatId) { handlers.onTake(n.userData.seatId as string); return }
      }
      const onMarker = ray.intersectObjects(markerRoot.children, false)[0]
      if (onMarker) {
        const id = onMarker.object.userData.id as string | undefined
        if (id) handlers.onPick(id)
        return
      }
      const hit = new THREE.Vector3()
      if (ray.ray.intersectPlane(floor, hit)) {
        /**
         * **닿는 자리로만 목표를 잡는다.** 벽이나 책상 위를 눌렀으면 그 자리가 아니라
         * 그 근처의 걸어갈 수 있는 칸으로 간다. 예전에는 누른 자리를 그대로 목표로 삼아
         * 벽에 붙은 채 계속 걷는 자세가 됐다.
         */
        const [gx, gz] = spotFor([
          Math.max(MIN_X, Math.min(MAX_X, hit.x)),
          Math.max(MIN_Z, Math.min(MAX_Z, hit.z)),
        ])
        goal = new THREE.Vector3(gx, 0, gz)
        stuckT = 0
      }
    }
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.style.cursor = 'pointer'

    // ── 루프 ──
    let raf = 0
    let alive = true
    let moving = false
    const clock = new THREE.Clock()
    const dir = new THREE.Vector3()
    const camFwd = new THREE.Vector3()
    const camRight = new THREE.Vector3()
    const UP = new THREE.Vector3(0, 1, 0)
    /** 1인칭에서 좌우 키가 도는 속도 (라디안/초) */
    const TURN = 2.4
    const keyNum = (a: string, b: string): number => (keys.has(a) || keys.has(b) ? 1 : 0)
    /**
     * 클릭 목표를 향해 나아가지 못한 **시간(초)**.
     * 프레임 수로 세면 120Hz 에서 0.1초, 30Hz 에서 0.4초로 제각각이 된다.
     */
    let stuckT = 0
    const stuckAt = new THREE.Vector3()

    const tick = (): void => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, clock.getDelta())

      /**
       * **이동은 카메라 기준이다.** 예전엔 W 가 월드 -Z 였는데, 탑다운 카메라가
       * 아이소메트릭(오프셋 9,12,9)이라 월드 -Z 는 **화면에서 56° 방향**(오른쪽 위 대각선)이다.
       * A 는 304°, D 는 124° — 네 키가 전부 45°쯤 돌아가 있었다. 실제로 재서 나온 값이다.
       * 사람은 "위" 를 누르면 화면 위로 가기를 기대한다. 그래서 화면 축으로 옮긴다.
       */
      const fwd = keyNum('KeyW', 'ArrowUp') - keyNum('KeyS', 'ArrowDown')
      const side = keyNum('KeyD', 'ArrowRight') - keyNum('KeyA', 'ArrowLeft')

      dir.set(0, 0, 0)
      if (firstPerson) {
        /**
         * **1인칭은 몸이 기준이다.** 좌우로 게걸음을 치면 몸이 그쪽을 보고 돌아버려
         * 시야가 같이 휘둘린다(몸의 방향이 곧 눈의 방향이라서). 그래서 좌우는 **회전**이다.
         */
        if (side !== 0) actor.rotation.y -= side * TURN * dt
        if (fwd !== 0) dir.set(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y)).multiplyScalar(fwd)
      } else if (fwd !== 0 || side !== 0) {
        camera.getWorldDirection(camFwd)
        camFwd.y = 0
        if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1)
        camFwd.normalize()
        camRight.crossVectors(camFwd, UP).normalize()
        dir.copy(camFwd).multiplyScalar(fwd).addScaledVector(camRight, side)
      }

      if (dir.lengthSq() > 0) {
        goal = null                              // 키를 누르면 클릭 목표를 버린다
        dir.normalize()
      } else if (goal) {
        const to = goal.clone().sub(actor.position)
        to.y = 0
        if (to.length() < 0.06) goal = null
        else dir.copy(to.normalize())
      }
      /**
       * **못 가는 곳을 향해 영원히 걷지 않는다.**
       * 클릭 목표가 벽 뒤면 인물이 벽에 붙은 채 **제자리걸음**을 계속한다.
       * (신고된 "혼자 직진" 은 이쪽이 아니다 — 여기는 이동이 0 이고 걷기 클립만 돈다.
       *  실제로 전진시키는 것은 키 래치다. 위 `clearKeys` 주석 참고.)
       * 그래도 고친다: 못 가는 목표를 붙들고 걷는 자세로 서 있는 것 자체가 버그다.
       * 목표가 있는데 **실제로 나아가지 못한 프레임이 이어지면** 목표를 버린다.
       */
      const before = stuckAt.set(actor.position.x, 0, actor.position.z)

      moving = dir.lengthSq() > 0
      if (moving) {
        /**
         * 축을 따로 시험한다 — 벽에 비스듬히 부딪히면 **막히는 축만 죽이고**
         * 나머지 축으로 미끄러진다. 한 덩어리로 막으면 벽에 붙는 순간 완전히 멈춰
         * 조작이 답답해진다.
         */
        const step = SPEED * dt
        const nx = actor.position.x + dir.x * step
        const nz = actor.position.z + dir.z * step
        if (dir.x !== 0 && !blocked(nx, actor.position.z)) actor.position.x = nx
        if (dir.z !== 0 && !blocked(actor.position.x, nz)) actor.position.z = nz
        // 가는 쪽을 본다. 즉시 돌리면 뚝뚝 끊기므로 각도를 보간한다.
        // 1인칭은 좌우 키가 이미 몸을 돌리므로 여기서 또 돌리면 서로 싸운다.
        const want = firstPerson ? actor.rotation.y : Math.atan2(dir.x, dir.z)
        let d = want - actor.rotation.y
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        actor.rotation.y += d * Math.min(1, dt * 12)
      }
      if (goal) {
        // 0.5프레임분 이상 못 갔으면 막힌 것이다 (SPEED*dt 의 절반)
        const moved = Math.hypot(actor.position.x - before.x, actor.position.z - before.z)
        stuckT = moved < SPEED * dt * 0.5 ? stuckT + dt : 0
        if (stuckT > 0.4) { goal = null; stuckT = 0 }   // 0.4초 제자리면 포기한다
      } else {
        stuckT = 0
      }

      if (walk) walk.paused = !moving
      mixer.update(dt)

      // 표식이 천천히 돈다 — 멈춰 있는 물건은 주울 수 있어 보이지 않는다
      for (const g of markerRoot.children) {
        if ((g as THREE.Mesh).geometry.type !== 'RingGeometry') g.rotation.y += dt * 1.1
      }

      // **닿았다고 줍지 않는다.** 어느 것에 닿았는지만 알리고, 집는 건 사람이 정한다.
      /**
       * **가장 가까운 것을 고른다.** 처음엔 반경 안 첫 번째에서 `break` 했는데,
       * 그건 배열 순서가 이기는 것이지 거리가 이기는 게 아니다. 표식이 겹치는 자리에서
       * 엉뚱한 것이 잡히고, 이 게임에서 그건 **조사 1회를 오발로 잃는다**는 뜻이다.
       */
      const nowNear = nearestWithin(markers, actor.position.x, actor.position.z, PICK_RADIUS)
      if (nowNear !== near) {
        near = nowNear
        handlers.onNear(near)
      }

      const nowSeat = nearestWithin(seats, actor.position.x, actor.position.z, PICK_RADIUS)
      if (nowSeat !== nearSeat) {
        nearSeat = nowSeat
        handlers.onNearSeat(nearSeat)
      }
      // 닿아 있는 마커는 부풀어 오른다 — 지금 집을 수 있다는 신호
      for (const g of markerRoot.children) {
        const on = g.userData.id === near
        const isHalo = (g as THREE.Mesh).geometry.type === 'RingGeometry'
        g.scale.setScalar(on ? (isHalo ? 1.12 : 1.35) : 1)
        const mat = (g as THREE.Mesh).material as THREE.Material
        if (isHalo) mat.opacity = on ? 0.42 : 0.16
      }

      /**
       * 탑다운은 **인물을 따라간다.** 고정 카메라로 넓은 방을 담으면 인물이 점이 되고,
       * 좁게 담으면 프레임 밖으로 나간다. 따라다니면 둘 다 안 생긴다.
       */
      camera.position.copy(actor.position).add(CAM_OFF)
      camera.lookAt(actor.position.x, 0.6, actor.position.z)

      if (firstPerson) {
        /**
         * **사람 눈높이에 둔다.** 예전엔 `ACTOR_HEIGHT * 0.92 = 2.76m` 였다 —
         * 방은 실척인데(책상 0.7~0.8m) 눈만 2.76m 라 책상을 내려다보는 거인이었다.
         * 인물을 실척으로 되돌렸으므로 눈도 제자리로 온다.
         */
        eye.position.set(actor.position.x, EYE_HEIGHT, actor.position.z)
        const fwd = new THREE.Vector3(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y))
        eye.lookAt(eye.position.clone().add(fwd).setY(EYE_HEIGHT))
        // 1인칭에서는 내 몸이 시야를 가린다
        actor.visible = false
        renderer.render(scene, eye)
      } else {
        actor.visible = true
        renderer.render(scene, camera)
      }
    }
    tick()

    const onResize = (): void => {
      const nw = host.clientWidth || w
      const nh = host.clientHeight || h
      const asp = nw / nh
      camera.left = -VIEW * asp / 2
      camera.right = VIEW * asp / 2
      camera.updateProjectionMatrix()
      eye.aspect = asp
      eye.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    addEventListener('resize', onResize)

    return {
      setMarkers,
      setSeats,
      isMoving: () => moving,
      dispose() {
        alive = false
        cancelAnimationFrame(raf)
        removeEventListener('keydown', onDown)
        removeEventListener('keyup', onUp)
        removeEventListener('blur', clearKeys)
        document.removeEventListener('visibilitychange', onVis)
        removeEventListener('resize', onResize)
        renderer.domElement.removeEventListener('click', onClick)
        mixer.stopAllAction()
        renderer.dispose()
        draco.dispose()
        renderer.domElement.remove()
      },
    }
  } catch {
    // 3D 가 실패해도 게임은 멈추지 않는다 — 2D 목록이 그대로 있다
    return null
  }
}
