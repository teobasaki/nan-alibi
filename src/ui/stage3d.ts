/**
 * 심문석 3D — 취조실에 선 용의자 한 명.
 *
 * ## 설계 원칙: **실패해도 게임이 죽지 않는다**
 * WebGL 이 없거나(구형 기기·원격 데스크톱), 모델 파일이 없거나, 로드가 실패하면
 * `mount()` 는 조용히 `null` 을 돌려주고 호출부는 기존 사진/명패로 되돌아간다.
 * 마감 이틀 전에 3D 를 넣는 유일하게 안전한 방법이다.
 *
 * ## three 는 동적 import 한다
 * three 는 압축 후에도 수백 KB 다. 첫 화면(브리핑)에서 받을 이유가 없다 —
 * 심문을 시작하는 순간에만 받는다. 60초 시연에서 첫 화면 지연은 치명적이다.
 *
 * ## 애니메이션은 절차적이다
 * ⚠️ **2026-08-09 정정:** 아래 문장은 리깅 직후에는 맞았지만 지금은 틀렸다.
 * 배포되는 9개 GLB 를 전부 열어 보니 **`animations` 가 0개다** — 걷기·달리기 클립이
 * 남아 있지 않다. 최적화(`gltf-transform`)와 앉은 자세 재익스포트(단일 프레임 굽기)를
 * 거치며 걷어졌고, 아무도 다시 재지 않았다. ADR 016 §31 도 같은 이유로 낡았다.
 * **결과: 이 프로젝트에 캐릭터 이동을 붙이려면 클립을 새로 구해야 한다** (ADR 018).
 *
 * 원래 문장 — Meshy 오토리깅이 주는 클립은 **걷기·달리기뿐**이라 심문 장면에 쓸 데가 없다.
 * 대신 뼈대를 직접 흔든다 — 호흡, 미세한 고개 움직임, 압박이 높을 때의 떨림.
 * 사람이 가만히 서 있을 때 실제로 하는 것이 그것이고, 클립보다 상태에 잘 반응한다.
 */

export interface Stage3D {
  /** 압박 0~100 — 호흡이 빨라지고 몸이 굳는다 */
  setPressure(v: number): void
  /** 말하는 중 — 미세하게 고개가 움직인다 */
  setSpeaking(v: boolean): void
  /** 얼굴의 화면상 위치(0~1). 말풍선을 머리 옆에 붙이는 데 쓴다. */
  facePoint(): { x: number; y: number }
  /** 탁자가 삐걱일 만한 순간인지 — 등이 크게 흔들리는 지점에서 true 를 한 번 준다 */
  onCreak(cb: () => void): void
  dispose(): void
}

/** WebGL 을 쓸 수 있는가. 없으면 3D 자체를 시도하지 않는다. */
export function canRender3D(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * **착석은 이제 실제 Mixamo 클립이다** (`<tag>.sit.opt.glb`).
 * 예전에는 정적 포즈를 블렌더로 구워(`scripts/pose-seated.py`) 팔 관통을 탐색으로
 * 보정했다 — 그 노동 전체가 클립 재생으로 사라졌다. rest 가 A포즈이므로
 * **로드 직후 클립을 한 번 적용한 뒤에** 좌면 맞춤을 재야 한다(순서가 중요하다).
 *
 * 글롭은 **채택 배역 5종만** 정확히 짚는다 (`ui/cast.ts` 의 CAST 와 같은 목록 —
 * tests/worlds.test.ts 가 어긋남을 잠근다). `*.sit` 와일드카드로 돌리면 걷어낸
 * Meshy 8종과 예비(alina 35MB·f2 48MB)까지 dist/assets 에 복제돼 배포가 무거워지고,
 * Cloudflare Pages 의 파일당 25MB 상한에도 걸린다.
 */
const MODELS = import.meta.glob([
  '/public/characters/secretary.sit.opt.glb',
  '/public/characters/security.sit.opt.glb',
  '/public/characters/housekeeping.sit.opt.glb',
  '/public/characters/investor.sit.opt.glb',
  '/public/characters/expartner.sit.opt.glb',
], {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const ROOM_URL = (Object.values(
  import.meta.glob('/public/room/room.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string ?? '').replace(/^\/public/, '')

/**
 * 전신 모델과 **흉상**을 파일명으로 구분한다 (`<slug>.bust.opt.glb`).
 *
 * 크기로 판별하려다 한 번 당했다 — Meshy 출력은 미터가 아니라 정규화된 단위라
 * 흉상도 세로 1.9 로 나온다. 그걸 전신으로 보고 1.72m 에 맞췄더니 머리만 거대해졌다.
 * **추측하지 말고 이름으로 선언한다.**
 *
 * 흉상을 쓰는 이유: Meshy 멀티이미지가 **4장까지만** 받아서 전신과 얼굴 중 골라야 한다.
 * 이 게임의 카메라는 가슴 위를 잡고 테이블이 아래를 가린다 — 다리는 안 보인다.
 * 리깅(앉은 자세·팔 제스처)을 포기하고 **얼굴 해상도 7배**(84px→580px)를 택했다.
 */
const BY_SLUG = new Map<string, string>()
/** 흉상 경로는 배우 교체와 함께 사라졌다 — 신규 5종은 전부 전신 리깅이다 */
const IS_BUST = new Set<string>()
for (const [path, url] of Object.entries(MODELS)) {
  const tag = (path.split('/').pop() ?? '').replace('.sit.opt.glb', '')
  if (tag) BY_SLUG.set(tag, (url as string).replace(/^\/public/, ''))
}

export const hasModel = (slug: string): boolean => BY_SLUG.has(slug)

/**
 * 방에서 실측한 **수평면 하나** — 바닥이거나 상판이거나 좌면이다.
 * 좌표는 방 GLB 의 **원본 단위**다 (배율을 정하기 전에 재야 하므로).
 */
interface Flat {
  y: number
  area: number
  x0: number; x1: number
  z0: number; z1: number
}

/**
 * ## 가구를 **눈으로 찾지 말고 삼각형에서 찾는다**
 *
 * 이 파일은 좌석 좌표를 세 번 하드코딩했고 세 번 다 틀렸다. 마지막 값
 * `SEAT=(0.06,-0.66) · 좌면 0.538` 은 **지금 배포되는 room.opt.glb 와 맞지 않는다** —
 * 실측하면 그 자리는 의자가 아니라 **상판의 끝**이고, 진짜 의자는 그보다 0.5m 옆
 * (월드 x≈0.79) 에 좌면 높이 0.45m 로 있다. 주석에 적힌 "상판 0.76m" 도 틀렸다:
 * 배율 1.9 에서 상판은 **0.571m** 라 사람(앉은키 1.36m)이 인형 가구에 앉은 꼴이 됐다.
 *
 * 그래서 상수를 또 고치는 대신 **매번 잰다.** 위를 보는 수평 삼각형만 모아
 * 높이별로 묶고, 같은 높이 안에서 XZ 로 붙어 있는 것끼리 다시 묶는다.
 * 뭉치 하나가 가구 한 면이다 — 바닥(가장 넓다)·상판(그 다음)·좌면들.
 *
 * 삼각형 중심이 아니라 **삼각형의 XZ 바운딩박스가 겹치는지**로 잇는다.
 * 상판은 큰 사각형 두 장이라 중심끼리는 멀다 — 중심으로 이으면 한 상판이 둘로 쪼개진다.
 */
function flatSurfaces(THREE: typeof import('three'), root: import('three').Object3D): Flat[] {
  root.updateMatrixWorld(true)
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3()
  const u = new THREE.Vector3(); const v = new THREE.Vector3(); const n = new THREE.Vector3()
  const tris: Flat[] = []
  root.traverse((o) => {
    const m = o as import('three').Mesh
    if (!m.isMesh) return
    const pos = m.geometry?.getAttribute('position')
    if (!pos) return
    const idx = m.geometry.getIndex()
    const count = idx ? idx.count : pos.count
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i
      const i1 = idx ? idx.getX(i + 1) : i + 1
      const i2 = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld)
      b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld)
      c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld)
      u.subVectors(b, a); v.subVectors(c, a); n.crossVectors(u, v)
      const len = n.length()
      // 위를 보는 거의 완전한 수평면만. 0.98 이면 기울기 11° 이내다.
      if (len < 1e-12 || n.y / len < 0.98) continue
      tris.push({
        y: (a.y + b.y + c.y) / 3, area: len / 2,
        x0: Math.min(a.x, b.x, c.x), x1: Math.max(a.x, b.x, c.x),
        z0: Math.min(a.z, b.z, c.z), z1: Math.max(a.z, b.z, c.z),
      })
    }
  })
  if (!tris.length) return []

  const bb = new THREE.Box3().setFromObject(root)
  const yTol = Math.max((bb.max.y - bb.min.y) * 0.01, 1e-6)
  const gap = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.03

  tris.sort((p, q) => p.y - q.y)
  const out: Flat[] = []
  let i = 0
  while (i < tris.length) {
    // ① 같은 높이대로 자른다
    let j = i + 1
    const y0 = tris[i]!.y
    while (j < tris.length && tris[j]!.y - y0 < yTol) j++
    const level = tris.slice(i, j)
    i = j
    // ② 그 안에서 XZ 로 붙은 것끼리 잇는다
    const used = new Array<boolean>(level.length).fill(false)
    for (let k = 0; k < level.length; k++) {
      if (used[k]) continue
      used[k] = true
      const bag = [level[k]!]
      const stack = [level[k]!]
      while (stack.length) {
        const t = stack.pop()!
        for (let q = 0; q < level.length; q++) {
          if (used[q]) continue
          const s = level[q]!
          if (s.x0 - t.x1 > gap || t.x0 - s.x1 > gap) continue
          if (s.z0 - t.z1 > gap || t.z0 - s.z1 > gap) continue
          used[q] = true; bag.push(s); stack.push(s)
        }
      }
      out.push({
        y: bag.reduce((s, t) => s + t.y * t.area, 0) / bag.reduce((s, t) => s + t.area, 0),
        area: bag.reduce((s, t) => s + t.area, 0),
        x0: Math.min(...bag.map((t) => t.x0)), x1: Math.max(...bag.map((t) => t.x1)),
        z0: Math.min(...bag.map((t) => t.z0)), z1: Math.max(...bag.map((t) => t.z1)),
      })
    }
  }
  return out
}

/** 취조실 가구 실측 결과 — 전부 **월드 미터**, 바닥이 y=0 이다. */
export interface RoomFit {
  /** 방 GLB 에 줘야 할 배율. 상판이 TABLE_H 에 오도록 역산한다. */
  scale: number
  /** 방 GLB 의 y 오프셋. 바닥을 0 으로 내린다. */
  lift: number
  table: { cx: number; cz: number; y: number }
  /** 용의자를 앉힐 의자 좌면 중심 */
  seat: { cx: number; cz: number; y: number }
  /** 그 의자에 앉은 사람이 볼 방향(라디안). 가구는 축에 정렬돼 있으므로 90° 로 스냅한다. */
  yaw: number
  chairs: number
}

/**
 * 실측한 수평면들에서 **상판 하나와 의자들**을 골라낸다.
 *
 * - 바닥 = 가장 넓은 면. 방에서 이보다 넓은 수평면은 없다.
 * - 상판 = 바닥 위에서 가장 넓은 면.
 * - 의자 = 그 밖의 면 중 **높이 0.30~0.62m · 폭과 깊이 0.15~0.80m** 인 것.
 *   벽에 붙은 긴 선반(폭 2m 대)과 갓등(높이 2m 대)이 이 문에서 걸린다.
 * - 용의자 의자 = **가장 외로운 의자**. 취조는 한 명이 여럿을 마주보는 그림이고,
 *   이 방의 의자 셋 중 하나만 상판 반대편에 혼자 있다 (실측: 이웃까지 1.42m,
 *   나머지 둘은 서로 0.84m). 형사는 남은 쪽에 선다.
 */
function fitRoom(flats: Flat[], tableH: number): RoomFit | null {
  if (flats.length < 2) return null
  const big = (arr: Flat[]): Flat | null =>
    arr.reduce<Flat | null>((best, f) => (!best || f.area > best.area ? f : best), null)
  const floor = big(flats)
  if (!floor) return null
  const above = flats.filter((f) => f !== floor && f.y > floor.y)
  const table = big(above)
  if (!table || table.y - floor.y < 1e-6) return null
  const scale = tableH / (table.y - floor.y)
  if (!Number.isFinite(scale) || scale < 0.3 || scale > 8) return null

  const W = (f: Flat): { cx: number; cz: number; y: number; w: number; d: number } => ({
    cx: ((f.x0 + f.x1) / 2) * scale, cz: ((f.z0 + f.z1) / 2) * scale,
    y: (f.y - floor.y) * scale, w: (f.x1 - f.x0) * scale, d: (f.z1 - f.z0) * scale,
  })
  const chairs = above.filter((f) => f !== table).map(W).filter((f) =>
    f.y > 0.30 && f.y < 0.62 && f.w > 0.15 && f.w < 0.80 && f.d > 0.15 && f.d < 0.80)
  if (!chairs.length) return null

  const t = W(table)
  // 가장 외로운 의자 — 이웃까지의 거리가 가장 먼 것. 동점이면 상판에서 먼 쪽.
  const lonely = (i: number): number => {
    const me = chairs[i]!
    let d = Infinity
    for (let k = 0; k < chairs.length; k++) {
      if (k === i) continue
      const o = chairs[k]!
      d = Math.min(d, Math.hypot(me.cx - o.cx, me.cz - o.cz))
    }
    return Number.isFinite(d) ? d : Math.hypot(me.cx - t.cx, me.cz - t.cz)
  }
  let pick = 0
  for (let k = 1; k < chairs.length; k++) if (lonely(k) > lonely(pick)) pick = k
  const seat = chairs[pick]!
  // 상판 쪽을 본다. 가구는 축에 정렬돼 있으니 90° 로 스냅해야 비뚤게 앉지 않는다.
  const dx = t.cx - seat.cx
  const dz = t.cz - seat.cz
  const yaw = Math.abs(dx) >= Math.abs(dz)
    ? (dx >= 0 ? Math.PI / 2 : -Math.PI / 2)
    : (dz >= 0 ? 0 : Math.PI)
  return {
    scale, lift: -floor.y * scale,
    table: { cx: t.cx, cz: t.cz, y: t.y },
    seat: { cx: seat.cx, cz: seat.cz, y: seat.y },
    yaw, chairs: chairs.length,
  }
}

/**
 * ## 착석 클립에서 **이동 트랙을 얼린다** — 표류의 진짜 원인
 *
 * 실측(브라우저, 5초 300프레임): `m1` 의 `Hips` 가 **z 로 0.77m, y 로 0.33m** 를
 * 왕복한다. 프레임당 최대 6.5cm 다. 머리는 0.99m 를 오간다 — 앉아 있는 사람이 아니라
 * 몸부림이다. `wong` 도 머리가 0.23m 를 쓸고 다닌다.
 *
 * 원인은 리타게팅이다. 클립의 `Hips.position` 은 **원본 리그의 단위(cm 계열)** 그대로
 * 구워졌는데 받는 리그의 rest 는 미터 단위다 — `m1` 의 rest 는 `[0, 1.001, 0.010]` 인데
 * 클립이 매 프레임 `[-0.049, -43.612, 0.843]` 근처를 준다. 44배 어긋난 공간에서
 * ±0.8 을 흔드니 월드에서 0.8m 가 된다. (`groundIt` 이 그 44m 를 되돌리느라
 * `model.position.y` 가 **43.13** 이 돼 있는 것도 같은 원인이다.)
 *
 * **회전은 단위가 없다.** 자세는 회전이 만들고 뼈 길이는 rest 가 정하므로,
 * 이동 트랙을 첫 키 값으로 얼려도 **t=0 의 자세는 그대로**이고 이후로 흐르지 않는다.
 * 클립을 지우지 않고 얼리는 이유가 이것이다 — 지우면 리타게팅이 이동 트랙에 구워 둔
 * 뼈 오프셋(carla 의 `spine_01_03=[11.84,0,0]` 같은 상수)까지 날아가 골격이 무너진다.
 *
 * 버린 대안: ① 매 프레임 루트 xz 를 되돌리기 — 루트가 아닌 뼈(f1 의 `RibsTwist` 는
 * 두 키가 0.30 만큼 벌어져 15Hz 로 떤다)는 못 잡는다. ② 클립을 안 쓰고 정적 포즈로
 * 굽기 — wong·m1 의 멀쩡한 호흡 연기까지 버린다.
 */
function freezeTranslation(clip: import('three').AnimationClip): number {
  let frozen = 0
  for (const tr of clip.tracks) {
    if (!/\.position$/.test(tr.name)) continue
    const v = tr.values
    const n = tr.getValueSize()
    if (v.length <= n) continue
    let moved = false
    for (let i = n; i < v.length; i++) {
      if (v[i] !== v[i % n]) moved = true
      v[i] = v[i % n]!
    }
    if (moved) frozen++
  }
  return frozen
}

/**
 * 취조실을 그린다. 실패하면 null.
 * @param host 캔버스를 넣을 요소. 크기는 호출부가 CSS 로 정한다.
 */
export async function mount(host: HTMLElement, slug: string): Promise<Stage3D | null> {
  const url = BY_SLUG.get(slug)
  if (!url || !canRender3D()) return null

  try {
    const THREE = await import('three')
    // three 와 같이 늦게 불러온다 — 정적으로 잡으면 three 가 첫 번들로 딸려온다
    const { groundIt, measureBox, measureY, measuredHeight } = await import('./skinBounds')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')

    const w = host.clientWidth || 320
    const h = host.clientHeight || 380

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // 캡처를 위해 그리기 버퍼를 유지한다. 이게 없으면 `canvas.toDataURL()` 이 흰 이미지를 준다 —
      // 디자인 피드백을 받으려면 화면을 파일로 뽑을 수 있어야 하고, 그 대가는 약간의 성능이다.
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // 필름 같은 계조. 없으면 하이라이트가 하얗게 타서 플라스틱처럼 보인다.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.6
    // 호스트는 재사용되는 영속 노드다. **캔버스만** 치운다 —
    // `replaceChildren()` 로 통째로 비웠더니 호스트에 얹어 둔 말풍선까지 사라졌다.
    host.querySelectorAll('canvas').forEach((el) => el.remove())
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    /**
     * **얼굴에 바짝 붙는다.** 전신을 담으면 얼굴이 20px 이 되고, 그러면 3D 를 넣은 이유가 사라진다.
     *
     * 위치는 모델을 **로드한 뒤 머리 뼈를 실측해서** 정한다 (아래 참조).
     * 눈높이를 상수로 박았더니 선 모델(1.56)과 앉은 모델(1.25)에서 각각 틀렸다 —
     * 정수리를 보거나 가슴을 봤다. 모델이 8개라 상수는 언제든 다시 틀린다.
     */
    // 세로 화각. 뷰포트가 가로로 길어서 **세로가 병목**이다 —
    // 30°/1.28m 로 뒀더니 세로 0.70m 만 담겨 테이블(바닥에서 0.74m)이 프레임 밖으로 잘렸다.
    // 화각 37° — 46° 는 풀숏이 되어 모델 결함(뭉개진 손가락·긴 상체)이 다 보였다.
    // 좁힐수록 얼굴이 커지고 결함은 프레임 밖으로 나간다 (리뷰 1번).
    const camera = new THREE.PerspectiveCamera(37, w / h, 0.05, 50)

    /**
     * ## 취조실 — **완성된 에셋을 쓴다**
     *
     * 처음에는 상자와 평면으로 방을 지었다. 테이블·의자·갓등·편면거울·문이 모두 들어 있는
     * 기성 모델이 생기면서 그 전부를 걷어냈다 — 손으로 만든 상자가 이길 수 있는 물건이 아니다.
     *
     * 배율 1.9: 원본은 천장 높이가 1.06 단위다. 테이블 상판과 의자 좌면의 높이 비가
     * 실제 가구(0.74m / 0.45m = 1.64)와 일치(1.63)해서, 테이블을 0.74m 로 맞추는
     * 배율을 역산했다. 눈대중이 아니라 그 비율에서 나온 숫자다.
     */
    /** 실제 취조실 탁자 높이(m). 방 배율은 상판이 이 높이에 오도록 **역산**한다. */
    const TABLE_H = 0.74
    const roomGltf = await new GLTFLoader().setDRACOLoader(
      new DRACOLoader().setDecoderPath('/draco/'),
    ).loadAsync(ROOM_URL)
    const room = roomGltf.scene
    /**
     * **배율을 상수로 박지 않는다.** 1.9 는 "상판이 0.74m 가 되는 값" 이라고 적혀
     * 있었지만 실측하면 **0.571m** 였다 — 에셋이 바뀌는 동안 아무도 다시 재지 않았다.
     * 그 1.295배 차이가 "이상한 데 앉아 있다" 의 절반이다: 사람은 앉은키 1.36m 로
     * 정규화되는데 탁자가 무릎 높이라 인형 가구에 앉은 거인이 된다.
     * 이제 상판을 재서 배율을 역산한다 — 에셋이 또 바뀌어도 따라온다.
     */
    const fit = fitRoom(flatSurfaces(THREE, room), TABLE_H)
    /** 실측이 실패하면 **마지막으로 실측한 값**으로 간다 (2026-08-10, room.opt.glb). */
    const FALLBACK: RoomFit = {
      scale: 2.462, lift: 1.301,
      table: { cx: 0.05, cz: -0.05, y: TABLE_H },
      seat: { cx: 0.785, cz: 0.051, y: 0.451 },
      yaw: -Math.PI / 2, chairs: 3,
    }
    const R = fit ?? FALLBACK
    const ROOM_SCALE = R.scale
    room.scale.setScalar(ROOM_SCALE)
    room.traverse((o) => {
      const m = o as import('three').Mesh
      if (m.isMesh) {
        m.receiveShadow = true
        m.castShadow = true
        const mm = m.material as import('three').MeshStandardMaterial
        if (mm?.isMeshStandardMaterial) {
          /**
           * 어둡게 만드는 일은 **조명이 한다.** 베이스컬러를 0.42배로 눌렀더니
           * 피부·제복·벽돌·금속이 전부 같은 매트 표면이 되어 재질 구분이 사라졌다
           * (아트 디렉터 리뷰 4번). 색은 살리고 거칠기만 재질에 맞게 준다.
           */
          mm.color.multiplyScalar(0.68)
          mm.roughness = Math.min(Math.max(mm.roughness, 0.68), 0.9)
          mm.metalness = Math.min(mm.metalness, 0.35)
          mm.envMapIntensity = 0.35
        }
      }
    })
    // 실측한 바닥을 월드 0 으로 내린다 (원본 바닥은 약 -0.53 단위)
    room.position.y = R.lift
    scene.add(room)

    /**
     * 조명 — 방 에셋의 갓등 **아래에** 실제 광원을 매단다.
     * 에셋에는 조명이 없다(LIGHT 0개). 등은 형상일 뿐이라 빛은 우리가 넣어야 한다.
     * 흔들림도 여기서 만든다 — 빛이 얼굴을 훑는 것이 이 장면의 핵심이다.
     */
    /**
     * 키라이트. 리뷰 2·3번 반영:
     * 정면광이라 얼굴이 평면으로 떴고(이마·코·볼 밝기가 같았다), 콘이 좁아
     * 벽에 "조명 범위 표시" 같은 검은 반원이 생겼다.
     * 각도를 넓히고 penumbra 를 올려 경계를 풀고, 강도는 낮춘다.
     */
    /**
     * 키라이트 — **더 좁고 더 어둡게.**
     * 레퍼런스에서 무서웠던 이유는 인물이 잘 보여서가 아니라 **절반이 어둠에 잠겨서**였다.
     * 나는 인물을 너무 잘 보여주려 하고 있었다. 콘을 좁히고 거리를 줄여
     * 빛이 얼굴에만 닿고 몸은 어둠에 남게 한다 — 생성 모델의 결함도 함께 묻힌다.
     */
    /**
     * 키라이트 — 갓등 아래 따뜻한 빛. 색을 너무 주황으로 밀었더니 제복·피부·벽이
     * 전부 한 색으로 눌렸다(사용자 지적: "옷들이 다 단색으로"). 중성 쪽으로 되돌린다.
     */
    const key = new THREE.SpotLight(0xffe2bd, 15, 6.5, Math.PI / 4.6, 0.75, 1.6)
    key.castShadow = true
    key.shadow.mapSize.set(matchMedia('(pointer: coarse)').matches ? 1024 : 2048, matchMedia('(pointer: coarse)').matches ? 1024 : 2048)
    key.shadow.bias = -0.0005
    key.shadow.normalBias = 0.02
    scene.add(key, key.target)
    // 환경광은 거의 죽인다 — 밝히면 취조실이 사무실이 된다
        // 환경광 — 방을 둘러볼 때 벽과 가구가 형태로 읽힐 만큼만
    scene.add(new THREE.HemisphereLight(0x243040, 0x08060a, 0.16))
    /**
     * 카메라 쪽 필 — **그림자를 완전히 검게 막지 않기 위한 것**이다.
     * 이게 없으면 얼굴 그늘이 RGB 0 으로 뭉개져 형태 정보가 사라진다.
     * 차갑게(푸른기) 넣어 따뜻한 키라이트와 대비를 만든다. 키 대비 약 1/15.
     */
    /**
     * 차가운 필 — **따뜻한 키와 대비를 만든다.** 단일 광원만 있으면 밝은 곳과
     * 검은 곳뿐이라 재질이 안 읽힌다. 푸른 필이 그늘에 정보를 남기고,
     * 그 색 대비가 "단색으로 눌림" 을 푼다.
     */
    const fill = new THREE.DirectionalLight(0x7d96b8, 0.55)
    scene.add(fill, fill.target)

    /** 전경의 어깨 — 형사(=플레이어)의 것. 화면 아래를 검게 먹어 "내가 그 방에 있다" 를 만든다. */
    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    )
    shoulder.scale.set(1.15, 1.7, 0.7)
    scene.add(shoulder)

    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)

    const gltf = await loader.loadAsync(url)
    const model = gltf.scene
    /**
     * **클립을 먼저 입히고 나서 잰다.** 착석 GLB 의 rest 는 A포즈라, 클립을 적용하기
     * 전에 좌면 맞춤(hips 실측)을 하면 서 있는 몸을 기준으로 재게 된다.
     * `update(0)` 으로 첫 프레임을 굽고 월드 행렬을 갱신한 뒤에 아래 측정이 돈다.
     */
    let mixer: import('three').AnimationMixer | null = null
    const sitClip = gltf.animations[0]
    /**
     * 클립이 **회전을 덮어써 주는 뼈**의 이름. 이게 필요한 이유는 `tick()` 에 있다 —
     * 클립이 안 건드리는 뼈에까지 매 프레임 기준 자세를 다시 읽으면, 지난 프레임에
     * 우리가 얹은 호흡·제스처를 기준으로 삼아 **같은 각도를 무한히 누적**한다.
     */
    const animated = new Set<string>()
    let frozen = 0
    if (sitClip) {
      frozen = freezeTranslation(sitClip)
      for (const tr of sitClip.tracks) {
        if (!/\.quaternion$|\.rotation$/.test(tr.name)) continue
        animated.add(tr.name.slice(0, tr.name.lastIndexOf('.')).replace(/\.bones\[|\]$/g, ''))
      }
      mixer = new THREE.AnimationMixer(model)
      mixer.clipAction(sitClip).play()
      mixer.update(0)
      model.updateMatrixWorld(true)
    }
    model.traverse((o) => {
      const m = o as import('three').Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
        const mm = m.material as import('three').MeshStandardMaterial
        if (mm?.isMeshStandardMaterial) {
          /**
           * **맵이 있으면 계수를 건드리지 않는다.**
           * glTF 에서 `roughness`/`metalness` 는 맵에 **곱해지는 계수**다.
           * 맵이 있는데 0.56 을 박으면 텍스처가 담고 있던 재질 변화(피부 vs 천 vs 금속)가
           * 통째로 눌려 버린다 — 그러면 노멀맵을 복원한 의미가 없다.
           * 맵이 없을 때만 눈대중 값을 준다.
           */
          if (mm.roughnessMap) {
            mm.roughness = 1
            mm.metalness = mm.metalnessMap ? 1 : 0
          } else {
            mm.roughness = 0.56
            mm.metalness = 0
          }
          if (mm.normalMap) mm.normalScale.set(1, 1)
          mm.envMapIntensity = 0.25

          /**
           * ## ★ emissive 를 끈다 — 이게 "조악해 보이는" 가장 큰 원인이었다
           *
           * Meshy 는 `emissiveFactor = (1,1,1)` 에 **emissive 텍스처로 baseColor 를 그대로**
           * 넣어서 내보낸다. 조명 없는 뷰어에서도 모델이 보이게 하려는 배려인데,
           * 게임에서는 정확히 반대로 작동한다.
           *
           * PBR 에서 최종 색 = `조명받은 baseColor + emissive` 이고 **emissive 는 조명을
           * 완전히 무시한다.** 그래서 화면에 보이던 것은 사실상 원본 사진(평평한 스튜디오
           * 조명이 구워진)이었고, 흔들리는 등도 그림자도 노멀맵도 그 위에 겨우 얹혔다.
           *
           * 끄면 인물이 비로소 **방의 조명을 받는다** — 노멀맵과 러프니스맵도 그제야 일한다.
           */
          mm.emissive.setScalar(0)
          mm.emissiveMap = null

          /**
           * ## 피부 흉내 — 서브서피스 스캐터링이 없으면 무엇을 해도 플라스틱이다
           *
           * 실제 피부는 빛이 살짝 파고들었다 붉게 번져 나온다. 그게 없으면 아무리
           * 텍스처가 좋아도 마네킹으로 읽힌다. `MeshPhysicalMaterial` 의 `sheen` 으로
           * 흉내낸다 — 정식 SSS 는 아니지만 **스치는 빛에 따뜻한 테두리**를 만들어
           * 실루엣 가장자리가 살아난다. 이 장면은 측면광이라 효과가 특히 크다.
           *
           * 진짜 `transmission` 은 렌더 패스를 하나 더 요구해 모바일에서 무겁다 —
           * 마감 이틀 전에 낼 비용이 아니다.
           */
          const phys = new THREE.MeshPhysicalMaterial({
            map: mm.map,
            normalMap: mm.normalMap,
            roughnessMap: mm.roughnessMap,
            metalnessMap: mm.metalnessMap,
            roughness: mm.roughness,
            metalness: mm.metalness,
            envMapIntensity: 0.25,
            sheen: 0.28,
            sheenColor: new THREE.Color(0xc98f78),   // 피부 아래 혈색 — 너무 붉으면 옷까지 물든다
            sheenRoughness: 0.75,
            clearcoat: 0.06,                          // 아주 얕은 유분기
            clearcoatRoughness: 0.65,
          })
          if (phys.normalMap) phys.normalScale.set(1, 1)
          m.material = phys
        }
      }
    })
    scene.add(model)

    /**
     * ## 인물을 **방의 실제 의자**에 앉힌다 — 골반을 좌면에 얹는 방식으로
     *
     * 좌표는 이제 상수가 아니라 `fitRoom()` 이 방 삼각형에서 뽑아 온다.
     * 예전 상수(`SEAT=(0.06,-0.66)` · 좌면 `0.538`)는 지금 에셋에서 **의자가 아니라
     * 상판의 끝**을 가리켰다 — 실제 의자는 거기서 0.5m 옆이다.
     *
     * 그리고 코드는 두 가지를 더 틀리고 있었다.
     *
     * ① **골반을 한 번도 못 찾았다.** 좌면 보정이 `/^Hips$/` 로 뼈를 찾는데 배포되는
     *    다섯 리그의 골반 이름은 `hip_02`(carla) · `CC_Base_Hip_02`(wong·f1) ·
     *    `Hips_51`(m1) · `mixamorigHips_01`(f3) 이다 — **하나도 안 맞는다.**
     *    DEV 훅이 다섯 배역 모두에서 `hipsY: 0` 을 돌려주고 있던 것이 그 증거다.
     *    즉 좌면 보정은 **한 번도 실행된 적이 없다.**
     * ② **바운딩박스 중심을 좌석에 맞췄다.** 앉은 자세는 다리가 앞으로 뻗어 있어
     *    박스 중심이 골반보다 한참 앞이다. 그만큼 사람이 의자에서 밀려난다.
     *
     * 고치기 전 실측(월드 m, 옛 좌면 0.538 기준):
     *
     * | 배역 | 골반 y | 좌면 대비 | 좌석 XZ 까지 |
     * |---|---|---|---|
     * | carla | 0.801 | **+0.26 (공중)** | 0.10 |
     * | wong  | 0.098 | **-0.44 (바닥)** | 0.20 |
     * | m1    | 0.504 | -0.03 | 0.27 |
     * | f3    | 0.625 | +0.09 | 0.40 |
     * | f1    | 0.383 | -0.16 | 0.36 |
     *
     * 이제 **골반의 월드 좌표를 재서 좌면 위로 옮긴다.** 리그가 제각각이어도
     * 골반 하나만 찾으면 되고, 자세가 어떻든 사람이 의자에 닿는 지점은 골반이다.
     */
    const SEAT = new THREE.Vector3(R.seat.cx, R.seat.y, R.seat.cz)
    /** 골반 뼈는 좌면보다 이만큼 위에 있다 — 뼈는 엉덩이 살의 중심이지 바닥면이 아니다. */
    const HIP_ABOVE_SEAT = 0.09
    /** 용의자는 **상판 쪽**을 본다. 형사(카메라)는 그 반대편에서 들어온다. */
    const FACE_YAW = R.yaw

    const bust = IS_BUST.has(slug)
    /**
     * **`Box3.setFromObject` 를 쓰면 안 된다.** 착석 모델은 스킨드 메시이고
     * 노드 scale 0.01 이 렌더링 때 bindMatrix 로 상쇄되므로, Box3 는 이 사람을
     * **0.017m 로 잰다 — 실제는 1.35m 다.** 그래서 아래 바닥 보정이 100배 작았고
     * 용의자가 공중에 떴다. 탐색 씬이 같은 함정에 한 번 빠졌던 그 계산이다.
     */
    const h0 = measuredHeight(model)
    /**
     * 흉상은 머리+어깨+가슴 윗부분이라 실제 세로가 약 0.66m 다.
     * 전신 정규화(1.72m)를 적용하면 머리가 거대해진다 — 실제로 그렇게 만든 적이 있다.
     *
     * **착석 클립 모델은 "앉은 키" 로 정규화한다** (실측 1.36m — 좌면 실측과 같은 근거).
     * 신규 배우 5종은 리그 단위가 제각각이라 클립을 구운 뒤의 키가 0.98m(wong)부터
     * 147m(carla, cm 단위 리그)까지 흩어진다 — 옛 규칙(h0>1.55 만 정규화)은 wong 을
     * 그대로 둬서 **머리가 테이블 밑으로 잠겼다**(실측 head y 0.55 < 상판 0.76).
     * 축소는 언제나 안전하고, 확대는 1.8배까지만 — explore3d 좌석 배율과 같은 가드.
     */
    const SIT_H = 1.36
    const scale = bust ? 0.66 / (h0 || 1)
      : sitClip && h0 > 0 && SIT_H / h0 < 1.8 ? SIT_H / h0
      : (h0 > 1.55 ? 1.72 / h0 : 1)
    model.scale.setScalar(scale)
    /**
     * **돌린 다음에 잰다.** 회전은 모델 원점을 축으로 돌므로 뼈의 월드 좌표가 바뀐다.
     * 예전 코드처럼 올린 뒤에 돌리면 맞춰 둔 좌표가 그 자리에서 어긋난다.
     */
    model.rotation.y = FACE_YAW
    model.updateMatrixWorld(true)

    /**
     * 골반 뼈. **`/^Hips$/` 가 아니라 리그 표기 넷을 전부 받는다.**
     * "hip(s)" 뒤에 구분자나 숫자가 오는 것만 잡아 다른 뼈에 잘못 걸리지 않게 한다.
     */
    let hips: import('three').Object3D | null = null
    model.traverse((o) => {
      if (!hips && (o as import('three').Bone).isBone && /hips?([:_.0-9]|$)/i.test(o.name)) hips = o
    })
    if (bust) {
      const { hi } = measureY(model)
      /**
       * 흉상 꼭대기를 앉은 사람의 정수리(실측 1.36m)에 맞춘다.
       * 흉상 세로가 0.66m 이므로 잘린 밑면은 0.70m — 테이블 상판(0.74m)보다 아래다.
       * **단면이 테이블에 가려진다.** 몸통이 없어도 성립하는 이유가 이것이다.
       */
      model.position.y += 1.36 - hi
      const mb = measureBox(model)
      model.position.x += SEAT.x - (mb.max.x + mb.min.x) / 2
      model.position.z += SEAT.z - (mb.max.z + mb.min.z) / 2
    } else if (hips) {
      // **골반을 좌면 위로 옮긴다.** 세 축을 한꺼번에 — 높이만 맞추면 의자 옆에 앉는다.
      const hv = new THREE.Vector3()
      ;(hips as import('three').Object3D).getWorldPosition(hv)
      model.position.x += SEAT.x - hv.x
      model.position.y += SEAT.y + HIP_ABOVE_SEAT - hv.y
      model.position.z += SEAT.z - hv.z
    } else {
      // 골반을 못 찾았을 때만 옛 경로 — 발을 바닥에 붙이고 박스 중심을 좌석에 맞춘다
      groundIt(model)
      const mb = measureBox(model)
      model.position.x += SEAT.x - (mb.max.x + mb.min.x) / 2
      model.position.z += SEAT.z - (mb.max.z + mb.min.z) / 2
    }
    model.updateMatrixWorld(true)
    /** 착석이 끝난 뒤의 기준 높이. 절대 누적하지 않기 위한 기준점이다. */
    const baseY = model.position.y

    /** 뼈 이름은 리깅 도구마다 다르다. 패턴으로 찾고, 못 찾으면 모델 전체를 흔든다. */
    const findBone = (re: RegExp): import('three').Object3D | null => {
      let hit: import('three').Object3D | null = null
      model.traverse((o) => {
        if (!hit && (o as import('three').Bone).isBone && re.test(o.name)) hit = o
      })
      return hit
    }
    const head = findBone(/^head$|head(?!_?end|front)/i) ?? findBone(/head/i)
    const spine = findBone(/^spine$|spine0?1|chest|torso/i)
    /**
     * 말할 때 쓰는 뼈들. Meshy 오토리깅은 24본 Mixamo 계열 이름을 준다.
     * 리깅이 되어 있으니 **얼굴만 흔들 이유가 없다** — 사람은 말할 때 몸이 같이 움직인다.
     */
    const neck = findBone(/^neck$/i)
    const armL = findBone(/^LeftArm$/i)
    const armR = findBone(/^RightArm$/i)
    const foreL = findBone(/^LeftForeArm$/i)
    const foreR = findBone(/^RightForeArm$/i)
    const handL = findBone(/^LeftHand$/i)
    const handR = findBone(/^RightHand$/i)
    const gestureBones = [neck, armL, armR, foreL, foreR, handL, handR]

    /**
     * **카메라를 얼굴에 겨눈다 — 실측으로.**
     * 머리 뼈의 월드 좌표를 읽어 그 앞에 카메라를 놓는다.
     * 선 모델이든 앉은 모델이든, 8명 중 누구든 같은 코드가 맞춘다.
     */
    model.updateMatrixWorld(true)
    const face = new THREE.Vector3()
    if (head) head.getWorldPosition(face)
    else {
      const bb = new THREE.Box3().setFromObject(model)
      face.set(0, bb.max.y - 0.12, 0)
    }
    face.y += 0.06        // 머리 뼈는 목 위쪽이라 눈높이로 조금 올린다

    /**
     * 카메라는 **형사의 자리**다 — 테이블 건너편, 눈높이보다 조금 위.
     * 플레이어가 취조하는 사람이므로 시점도 그래야 한다.
     * 위치는 얼굴을 실측해 잡는다. 모델이 8개라 상수는 반드시 다시 틀린다.
     */
    /**
     * 프레임에 **얼굴과 테이블이 함께** 들어와야 취조 장면이 된다.
     * 필요한 세로 범위는 테이블 상판(0.74) ~ 정수리(얼굴+0.16) ≈ 0.75m.
     * 화각 36° 에서 세로 0.75m 를 담으려면 거리 = 0.75 / (2·tan18°) ≈ 1.15m 이고,
     * 여유를 둬 1.55m 로 물러선다. 시선은 얼굴과 테이블 사이를 겨눈다.
     */
    /**
     * 레퍼런스의 구도: **전등이 왼쪽 위, 얼굴이 가운데, 테이블이 아래를 가로지르고,
     * 형사의 어깨가 왼쪽 아래를 검게 먹는다.** 그걸 다 담으려면 물러서고 넓혀야 한다.
     * 얼굴만 크게 잡으면 조명은 좋아도 '방' 이 사라진다 — 두 번 그렇게 만들었다.
     */
    /**
     * ## 프레이밍 — 가슴 위 클로즈업 (아트 디렉터 리뷰 1번)
     *
     * 풀숏으로 잡았더니 저해상도 모델의 결함이 전부 드러났다 —
     * 뭉개진 손가락, 부자연스럽게 곧은 팔, 작은 머리에 긴 상체.
     * **크롭이 인물 재생성보다 먼저다.** 결함의 절반 이상은 프레이밍으로 감춰진다.
     *
     * 시선은 눈이 아니라 **흉골 위쪽**을 겨눈다 — 그래야 머리가 화면 위쪽 43~46% 에 앉는다.
     */
    /** 거리·높이는 블렌더에서 방·인물·카메라를 함께 놓고 렌더해 확정했다. */
    const DIST = 1.15
    const aim = new THREE.Vector3(face.x, face.y - 0.16, face.z)
    const fwd = new THREE.Vector3(Math.sin(FACE_YAW), 0, Math.cos(FACE_YAW))
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
    camera.position.copy(face)
      .addScaledVector(fwd, DIST)
      .addScaledVector(side, 0.20)
    camera.position.y = face.y + 0.06
    camera.lookAt(aim)

    /**
     * 키라이트 위치 — **정면에서 뺀다.**
     * 수평 55°, 위 40° 에서 들어와야 얼굴 한쪽만 밝고 반대쪽에 형태가 남는다.
     * 정면광이면 이마·코·볼이 같은 밝기가 되어 사진을 세워둔 것처럼 보인다.
     */
    const KEY_POS = face.clone()
      .addScaledVector(side, -0.45)
      .addScaledVector(fwd, 0.2)
    KEY_POS.y = face.y + 0.75
    key.position.copy(KEY_POS)
    key.target.position.set(face.x, face.y - 0.12, face.z)

    // 필은 카메라 쪽에서 — 그늘이 완전히 검게 막히는 걸 막는다
    fill.position.copy(camera.position).addScaledVector(side, 0.3)
    fill.target.position.copy(face)

    // 전경 어깨 — 카메라 바로 앞 왼쪽 아래
    {
      const toFace = new THREE.Vector3().subVectors(aim, camera.position).normalize()
      const rightV = new THREE.Vector3().crossVectors(toFace, new THREE.Vector3(0, 1, 0)).normalize()
      shoulder.position.copy(camera.position)
        .addScaledVector(rightV, -0.52)
        .addScaledVector(toFace, 0.34)
      shoulder.position.y -= 0.48
    }
    const rest = new Map<import('three').Object3D, import('three').Euler>()
    for (const b of [head, spine, ...gestureBones]) {
      if (b) rest.set(b, (b as import('three').Object3D).rotation.clone())
    }
    /** 지금 진행 중인 제스처의 세기 0~1. 말하기 시작하면 오르고 끝나면 잦아든다. */
    let gest = 0

    let pressure = 0
    let speaking = false
    let raf = 0
    let t0 = performance.now()
    // ⚠️ `tick()` 안에서 쓰므로 **tick 정의보다 먼저** 선언해야 한다.
    // 감시견 블록에 함께 뒀다가 TDZ 로 mount 가 통째로 실패했다 —
    // 정지를 막으려던 코드가 3D 를 죽여서 정지 화면이 됐다. 정확히 반대 효과였다.
    let lastFrame = performance.now()
    /**
     * 궤도 상태와 카메라 적용 함수는 **`tick()` 정의보다 먼저** 선언해야 한다.
     * 드리프트가 `tick()` 안에서 `applyCam` 을 부르는데 선언이 뒤에 있어
     * TDZ 로 mount 가 통째로 실패했다 — 같은 실수를 이 파일에서 두 번째 했다.
     * 아래에서 실제 구현을 대입할 때까지는 아무것도 하지 않는 함수로 둔다.
     */
    let drift = 0
    let idleSince = performance.now()
    let dragging = false
    let applyCam: (dy?: number, dp?: number) => void = () => {}
    /** 삐걱 콜백 — 등이 진폭 최대에 닿는 순간마다 한 번씩 부른다 */
    let creakCb: (() => void) | null = null
    let lastCreak = 0

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const prevFrame = lastFrame
      lastFrame = performance.now()
      const t = (lastFrame - t0) / 1000
      /**
       * **클립이 먼저, 제스처는 그 위에.**
       * 착석 클립과 아래의 호흡·제스처는 같은 뼈를 만진다 — 순서를 안 정하면 서로를
       * 덮어써 몸이 떤다. 클립을 먼저 적용하고, **그 결과를 기준 자세(rest)로 갱신**해
       * 제스처가 그 위에 얹히게 한다. 그러면 두 층이 싸우지 않는다.
       * 압박은 클립 재생 속도로도 나타난다 — 굳은 사람은 잔동작이 빨라진다.
       */
      if (mixer) {
        const dtSec = Math.min(0.1, Math.max(0, (lastFrame - prevFrame) / 1000))
        mixer.timeScale = 1 + (pressure / 100) * 0.5
        mixer.update(dtSec)
        /**
         * **클립이 덮어써 준 뼈만 기준 자세를 갱신한다.**
         * 예전에는 무조건 갱신했다 — 클립에 트랙이 없는 뼈는 `mixer.update()` 가
         * 손대지 않으므로, 지난 프레임에 우리가 얹은 호흡·제스처가 그대로 남아 있고
         * 그걸 다시 기준으로 읽어 같은 각을 **매 프레임 누적**했다. 60fps 면 초당
         * 수십 번 더해지니 몇 초 만에 몸이 접힌다. `animated` 가 그 고리를 끊는다.
         */
        for (const b of [head, spine, ...gestureBones]) {
          if (b && animated.has(b.name)) rest.set(b, (b as import('three').Object3D).rotation.clone())
        }
      }
      // 압박이 오르면 호흡이 빨라지고 얕아진다 — 굳는 것이지 커지는 게 아니다
      const rate = 1.0 + (pressure / 100) * 1.6
      const depth = 0.022 * (1 - (pressure / 100) * 0.45)
      const breath = Math.sin(t * rate) * depth

      if (spine) {
        const r = rest.get(spine)!
        spine.rotation.set(r.x + breath * 0.5, r.y, r.z)
      }
      // 제스처 세기를 부드럽게 따라가게 한다 — 켜고 끌 때 툭 끊기면 인형처럼 보인다
      gest += ((speaking ? 1 : 0) - gest) * 0.055

      if (gest > 0.01) {
        /**
         * **말하면 몸이 움직인다.** 리깅이 되어 있는데 얼굴만 흔들면 인형이다.
         * 팔은 무릎에 얹힌 채 아래팔만 들썩이고(사람이 앉아서 말할 때 하는 것),
         * 어깨와 목이 그 리듬을 받는다. 진폭은 작게 — 크면 연극이 된다.
         */
        const g1 = Math.sin(t * 2.7) * gest
        const g2 = Math.sin(t * 1.63 + 1.1) * gest
        const g3 = Math.sin(t * 3.9 + 0.4) * gest

        if (foreL) { const r = rest.get(foreL)!; foreL.rotation.set(r.x + g1 * 0.16, r.y, r.z + g2 * 0.1) }
        if (foreR) { const r = rest.get(foreR)!; foreR.rotation.set(r.x + g2 * 0.15, r.y, r.z - g1 * 0.1) }
        if (armL) { const r = rest.get(armL)!; armL.rotation.set(r.x + g2 * 0.05, r.y, r.z + g1 * 0.035) }
        if (armR) { const r = rest.get(armR)!; armR.rotation.set(r.x + g1 * 0.05, r.y, r.z - g2 * 0.035) }
        if (handL) { const r = rest.get(handL)!; handL.rotation.set(r.x + g3 * 0.1, r.y, r.z) }
        if (handR) { const r = rest.get(handR)!; handR.rotation.set(r.x + g3 * 0.09, r.y, r.z) }
        if (neck) { const r = rest.get(neck)!; neck.rotation.set(r.x + g1 * 0.035, r.y + g2 * 0.05, r.z) }
      } else {
        // 침묵 — 쉬는 자세로 되돌린다
        for (const b of gestureBones) {
          if (!b) continue
          const r = rest.get(b)!
          b.rotation.set(r.x, r.y, r.z)
        }
      }

      if (head) {
        const r = rest.get(head)!
        // 말할 때만 고개가 산다. 침묵할 때 움직이면 인형처럼 보인다.
        const talk = speaking ? Math.sin(t * 7.5) * 0.02 + Math.sin(t * 3.1) * 0.012 : 0
        const drift = Math.sin(t * 0.42) * 0.03
        // 압박이 높으면 미세하게 떤다
        const tremor = pressure >= 60 ? Math.sin(t * 26) * 0.004 * ((pressure - 60) / 40) : 0
        head.rotation.set(r.x + breath + talk + tremor, r.y + drift, r.z + tremor)
      }
      if (!head && !spine) {
        /**
         * 뼈를 하나도 못 찾았을 때의 최후 수단. **`+=` 를 쓰지 않는다** —
         * 매 프레임 더하면 사인파가 아니라 적분이 되어 사람이 의자에서 떠오른다.
         * 기준값에서 다시 계산해 얹는다.
         */
        model.rotation.y = FACE_YAW + Math.sin(t * 0.35) * 0.04
        model.position.y = baseY + Math.sin(t * rate) * 0.004
      }

      /**
       * **빛이 흔들린다.** 방 에셋의 갓등은 고정 형상이지만, 그 아래 광원을 흔들면
       * 그림자가 벽을 쓸고 얼굴을 훑는다 — 레퍼런스의 핵심이 그것이다.
       * 두 주기를 겹친다: 단일 사인파는 기계처럼 보인다.
       * 압박이 오르면 진폭이 커진다 — 방이 아니라 심문이 거칠어지는 것이다.
       */
      const heat0 = Math.min(1, pressure / 100)
      // 진폭을 10분의 1로 줄인다. 얼굴 전체를 왕복해 훑으면 공포가 아니라 게임 이벤트가 된다.
      const swingA = 0.016 + heat0 * 0.019
      const sx = Math.sin(t * 0.62) * swingA + Math.sin(t * 1.37) * swingA * 0.28
      const sz = Math.cos(t * 0.48) * swingA * 0.5
      key.position.set(KEY_POS.x + Math.sin(sx) * 0.5, KEY_POS.y, KEY_POS.z + Math.sin(sz) * 0.5)
      key.target.position.set(face.x + sx * 0.4, face.y - 0.12, face.z)
      const flick = 1 + Math.sin(t * 11.3) * 0.03 + Math.sin(t * 27.7) * 0.015

      // 등이 한쪽 끝에 닿을 때 탁자가 삐걱인다 — 소리와 그림이 같은 박자를 탄다
      if (creakCb && Math.abs(sx) > swingA * 0.94 && t - lastCreak > 3.2) {
        lastCreak = t
        creakCb()
      }

      // 압박이 높으면 조명이 붉게 조여든다 — CSS 분위기 층과 같은 언어
      const heat = Math.min(1, pressure / 100)
      key.color.setRGB(1, 0.886 - heat * 0.22, 0.706 - heat * 0.32)
      key.intensity = (15 + heat * 5) * flick

      // 손을 뗀 지 1.2초가 지나면 다시 천천히 떠다닌다
      if (!dragging && performance.now() - idleSince > 1200) {
        drift += 0.0016
        applyCam(Math.sin(drift) * 0.055, Math.sin(drift * 0.63 + 1.2) * 0.022)
      }

      renderer.render(scene, camera)
    }
    tick()

    /**
     * 감시견 — 루프가 멈추면 되살린다.
     * 한 번 정지 화면으로 배포된 적이 있다(rAF 0회). 원인을 구조로 없앴지만,
     * 탭 전환·컨텍스트 복구 같은 브라우저 사정으로도 끊길 수 있어 방어선을 남긴다.
     */
    const watchdog = setInterval(() => {
      if (document.hidden) return
      if (performance.now() - lastFrame > 1500) {
        cancelAnimationFrame(raf)
        tick()
      }
    }, 2000)

    /**
     * ## 룸 인터랙션 — 휠로 다가가고, 끌어서 둘러본다
     *
     * 방을 만들어 놓고 고정 카메라로만 보여주면 배경 그림과 다를 게 없다.
     * 다만 자유 궤도는 주지 않는다 — 벽 밖으로 나가거나 뒤통수를 보게 되면
     * "취조하는 자리" 라는 전제가 깨진다. **얼굴을 중심으로 한 좁은 범위**만 허용한다.
     */
    const base = camera.position.clone()
    const orbit = { yaw: 0, pitch: 0, dist: 1 }
    /**
     * ## 카메라 드리프트 — 3D 를 3D 로 보이게 하는 것
     *
     * 인물은 실측 170×71×**깊이 37.7cm** 의 진짜 부피다. 그런데 화면에서는 2D 처럼 보였다.
     * 이유는 모델이 아니라 **카메라가 고정**이라서다 — 깊이는 시차(parallax)로 인지되는데,
     * 카메라가 안 움직이면 그 단서가 아예 없다. 단일 사진 기반이라 얼굴 요철이 얕은 것도
     * 겹쳐서, 결국 사진을 세워둔 것처럼 읽혔다.
     *
     * 아주 느리게 떠다니게 한다. 눈에 띄는 움직임이 아니라 **깊이가 느껴질 만큼만.**
     * 사용자가 직접 끌면 그동안은 드리프트를 멈춘다 — 두 힘이 싸우면 멀미가 난다.
     */
    applyCam = (dy = 0, dp = 0): void => {
      const off = base.clone().sub(aim)
      const sph = new THREE.Spherical().setFromVector3(off)
      sph.theta += orbit.yaw + dy
      sph.phi = Math.max(0.55, Math.min(1.48, sph.phi + orbit.pitch + dp))
      sph.radius = off.length() * orbit.dist
      camera.position.copy(aim).add(new THREE.Vector3().setFromSpherical(sph))
      camera.lookAt(aim)
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      /**
       * 방 전체를 볼 수 있어야 하되 **방 밖으로 나가면 안 된다.**
       * 3.4배까지 열었더니 카메라가 벽을 뚫고 나가 화면이 새까매졌다.
       * 카메라~얼굴 기본 거리가 1.35m 이고 방 깊이가 약 3.8m 이므로
       * 2.0배(2.7m)면 반대편 벽 앞에서 멈춘다 — 방은 다 보이고 밖으로는 못 나간다.
       */
      orbit.dist = Math.max(0.34, Math.min(2.0, orbit.dist + e.deltaY * 0.0016))
      applyCam()
    }
    let px = 0
    let py = 0
    const onDown = (e: PointerEvent): void => {
      dragging = true; idleSince = Infinity; px = e.clientX; py = e.clientY
      host.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      // 좌우 ±20°, 상하 ±11° 정도로 묶는다
      // 좌우 ±75°, 상하 ±32° — 방을 둘러보되 벽 밖으로는 못 나간다
      orbit.yaw = Math.max(-1.3, Math.min(1.3, orbit.yaw - (e.clientX - px) * 0.005))
      orbit.pitch = Math.max(-0.55, Math.min(0.55, orbit.pitch + (e.clientY - py) * 0.004))
      px = e.clientX; py = e.clientY
      applyCam()
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false; idleSince = performance.now()
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)
    host.style.cursor = 'grab'

    const onResize = (): void => {
      const nw = host.clientWidth || w
      const nh = host.clientHeight || h
      renderer.setSize(nw, nh)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    }
    addEventListener('resize', onResize)

    // 개발 중에만 씬을 밖에서 들여다본다 — 3D 는 콘솔 없이는 원인을 못 찾는다 (__cs·__ex 와 같은 이유)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__st = {
        scene, model, camera, mixer,
        info: () => {
          const hp = new THREE.Vector3()
          if (head) (head as import('three').Object3D).getWorldPosition(hp)
          const mb2 = measureBox(model)
          const hv2 = new THREE.Vector3()
          if (hips) (hips as import('three').Object3D).getWorldPosition(hv2)
          return {
            slug, h0: +h0.toFixed(3), scale: +scale.toFixed(4),
            /** 골반 이름. `null` 이면 좌면 보정이 안 돈 것이다 — 그게 예전 버그였다. */
            hipBone: hips ? (hips as import('three').Object3D).name : null,
            hipsY: +hv2.y.toFixed(3),
            /** ★ 좌석 정렬 검증값 — 셋 다 0 에 가까워야 의자에 앉은 것이다 */
            seatErr: {
              x: +(hv2.x - SEAT.x).toFixed(3),
              y: +(hv2.y - SEAT.y - HIP_ABOVE_SEAT).toFixed(3),
              z: +(hv2.z - SEAT.z).toFixed(3),
            },
            /** 발끝 높이. 0 근처면 자세가 진짜 착석이다. 크게 벗어나면 클립 자체가 이상한 것 */
            feetY: +mb2.min.y.toFixed(3),
            room: {
              measured: !!fit, scale: +ROOM_SCALE.toFixed(3), chairs: R.chairs,
              tableY: +R.table.y.toFixed(3),
              seat: [+SEAT.x.toFixed(3), +SEAT.y.toFixed(3), +SEAT.z.toFixed(3)],
              yawDeg: Math.round((FACE_YAW * 180) / Math.PI),
            },
            face: face.toArray().map((n) => +n.toFixed(2)),
            headNow: hp.toArray().map((n) => +n.toFixed(2)),
            modelPos: model.position.toArray().map((n) => +n.toFixed(2)),
            boxNow: { lo: +mb2.min.y.toFixed(2), hi: +mb2.max.y.toFixed(2) },
            clip: sitClip
              ? { name: sitClip.name, dur: +sitClip.duration.toFixed(2), 얼린이동트랙: frozen }
              : null,
            /**
             * ★ 누적 불변식 — **우리가 각도를 얹는 뼈는 전부 클립이 덮어써야 한다.**
             * `false` 가 하나라도 있으면 그 뼈는 매 프레임 자기 자신 위에 다시 얹혀
             * 무한히 누적된다. 예전에 몸이 접히던 경로가 이것이다.
             */
            restSafe: Object.fromEntries(
              ([['head', head], ['spine', spine], ['neck', neck], ['armL', armL], ['armR', armR],
                ['foreL', foreL], ['foreR', foreR], ['handL', handL], ['handR', handR]] as const)
                .filter(([, b]) => !!b)
                .map(([k, b]) => [k, animated.has((b as import('three').Object3D).name)]),
            ),
          }
        },
      }
    }

    return {
      setPressure: (v) => { pressure = Math.max(0, Math.min(100, v)) },
      setSpeaking: (v) => { speaking = v },
      facePoint: () => {
        const v = face.clone().project(camera)
        return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }
      },
      onCreak: (cb) => { creakCb = cb },
      dispose: () => {
        cancelAnimationFrame(raf)
        clearInterval(watchdog)
        removeEventListener('resize', onResize)
        host.removeEventListener('wheel', onWheel)
        host.removeEventListener('pointerdown', onDown)
        host.removeEventListener('pointermove', onMove)
        host.removeEventListener('pointerup', onUp)
        host.removeEventListener('pointercancel', onUp)
        renderer.dispose()
        draco.dispose()
        scene.traverse((o) => {
          const m = o as import('three').Mesh
          if (m.isMesh) {
            m.geometry?.dispose()
            const mat = m.material
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
            else mat?.dispose()
          }
        })
        renderer.domElement.remove()
      },
    }
  } catch (e) {
    // 3D 가 죽어도 게임은 죽지 않는다. 원인만 남기고 폴백한다.
    console.warn('[stage3d] 3D 실패 — 사진으로 대체한다:', e)
    return null
  }
}
