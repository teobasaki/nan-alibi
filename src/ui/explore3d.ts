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
  kind: 'keycard' | 'cctv' | 'call' | 'receipt'
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
const HALF_X = 13.0        // 걸어 다닐 수 있는 범위. 벽 안쪽으로 여유를 뒀다
const HALF_Z = 8.0
const SPEED = 2.6          // m/s. 공간이 넓어져 취조실(1.25)보다 빨라야 답답하지 않다
const PICK_RADIUS = 1.1    // 공간에 비례해 넓힌다 — 좁으면 계속 빗나간다
/** 이 높이 위는 천장이다. 탑다운이므로 숨긴다. */
const CEILING_HIDE = true
/** 앉은 사람의 화면상 높이(m). 실척(1.2)이면 이 공간에서 점이 된다 — 읽히는 크기를 쓴다. */
const SEAT_HEIGHT = 2.6
/** 걸어 다니는 나. 앉은 사람보다 조금 커야 눈이 따라간다. */
const ACTOR_HEIGHT = 3.0

/**
 * 반경 안에서 **가장 가까운** 것을 고른다. 순수 함수로 떼어낸 이유는
 * 이 판정이 틀리면 조사 1회를 오발로 잃기 때문이다 — 3D 씬은 테스트가 못 닿으므로
 * 판정만이라도 게이트가 보게 한다.
 */
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

    const w = host.clientWidth || 640
    const h = host.clientHeight || 420
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    renderer.setSize(w, h)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0908)

    /**
     * **정사영 탑다운.** 60 Seconds! 가 그렇듯 방 전체가 한 화면에 들어와야
     * "어디로 갈지" 를 고를 수 있다. 원근이면 벽이 시야를 가린다.
     */
    // 경찰서가 31.8 × 21.1m 다. 세로가 병목이라 그쪽을 기준으로 화각을 잡는다.
    const view = 22
    const camera = new THREE.OrthographicCamera(
      -view * (w / h) / 2, view * (w / h) / 2, view / 2, -view / 2, 0.1, 200)
    camera.position.set(16, 20, 16)
    camera.lookAt(0, 0, 0)

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

    const actor = charGltf.scene
    // 걷기 리그는 A포즈 rest 라 원래 크기다. 방 배율에 맞춘다.
    const box = new THREE.Box3().setFromObject(actor)
    const height = box.max.y - box.min.y
    actor.scale.setScalar(height > 0 ? ACTOR_HEIGHT / height : 1)
    actor.position.set(0, 0, 5)
    scene.add(actor)

    const mixer = new THREE.AnimationMixer(actor)
    const clip = charGltf.animations[0]
    const walk = clip ? mixer.clipAction(clip) : null
    walk?.play()
    if (walk) walk.paused = true      // 멈춰 있을 때는 정지 프레임

    // 조명 — 심문실보다 밝게. 어두우면 어디로 갈지 안 보인다.
    // 넓은 실내라 점광 하나로는 구석이 안 보인다. 환경광을 올리고 위에서 넓게 비춘다.
    scene.add(new THREE.AmbientLight(0xffd9b0, 0.85))
    const key = new THREE.DirectionalLight(0xfff0d8, 1.5)
    key.position.set(8, 18, 6)
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0x8899bb, 0x2a1c20, 0.5))

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
        default:        return new THREE.CylinderGeometry(0.06, 0.06, 0.52, 6) // 말린 영수증
      }
    }

    const setMarkers = (list: Marker[]): void => {
      markers = list
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
        g.position.set(m.at[0], 0.4, m.at[1])
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
      sp.scale.set(4.4, 1.1, 1)
      sp.position.set(st.at[0], SEAT_HEIGHT + 1.0, st.at[1])
      sp.renderOrder = 10
      return sp
    }

    const setSeats = async (list: Seat[]): Promise<void> => {
      seats = list
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
          proto = g.scene
          proto.traverse((o) => {
            const m = o as THREE.Mesh
            if (!m.isMesh) return
            for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
              if (!mm) continue
              mm.emissive?.setScalar(0)      // Meshy·Sketchfab 은 기본적으로 자가발광한다
              mm.emissiveMap = null
            }
          })
          seatCache.set(st.slug, proto)
        }
        const o = proto.clone(true)
        // 착석 모델은 rest pose 가 앉은 자세라 그대로 놓으면 된다.
        // 크기는 사람 키(1.7m)에 맞춘다 — 모델마다 원본 스케일이 다르다.
        const box = new THREE.Box3().setFromObject(o)
        const hgt = box.max.y - box.min.y
        /**
         * **탑다운에서는 실척이 곧 안 보임이다.**
         * 공간이 31.8×21.1m 인데 앉은 사람은 1.2m 라 화면에서 점이 된다.
         * 60 Seconds! 도 캐릭터를 방 대비 크게 그린다 — 조작 대상이 보여야 하기 때문이다.
         * 사실적 비례를 버리고 **읽히는 크기**를 택한다.
         */
        if (hgt > 0) o.scale.setScalar(SEAT_HEIGHT / hgt)
        o.position.set(st.at[0], 0, st.at[1])
        o.rotation.y = Math.atan2(-st.at[0], -st.at[1])   // 방 가운데를 본다
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
      }
    }

    // ── 입력 ──
    // **`tick()`·핸들러가 참조하는 것은 전부 그보다 먼저 선언한다.**
    // 이 프로젝트는 stage3d.ts 에서 같은 TDZ 를 두 번 밟았다(lastFrame·applyCam).
    let near: string | null = null
    /** 지금 닿아 있는 사람 */
    let nearSeat: string | null = null
    const keys = new Set<string>()
    const onDown = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (k === 'e') {
        // **사람이 우선한다.** 둘 다 닿아 있으면 연행이 조회보다 큰 행동이다.
        if (nearSeat) { handlers.onTake(nearSeat); e.preventDefault(); return }
        if (near) { handlers.onPick(near); e.preventDefault(); return }
      }
      if ('wasd'.includes(k) || k.startsWith('arrow')) { keys.add(k); e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent): void => { keys.delete(e.key.toLowerCase()) }
    addEventListener('keydown', onDown)
    addEventListener('keyup', onUp)

    /** 화면 좌표 → 바닥 평면. 클릭한 자리로 걸어간다. */
    const ray = new THREE.Raycaster()
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let goal: THREE.Vector3 | null = null
    const onClick = (e: MouseEvent): void => {
      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
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
        goal = new THREE.Vector3(
          Math.max(-HALF_X, Math.min(HALF_X, hit.x)), 0,
          Math.max(-HALF_Z, Math.min(HALF_Z, hit.z)))
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

    const tick = (): void => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, clock.getDelta())

      dir.set(0, 0, 0)
      if (keys.has('w') || keys.has('arrowup')) dir.z -= 1
      if (keys.has('s') || keys.has('arrowdown')) dir.z += 1
      if (keys.has('a') || keys.has('arrowleft')) dir.x -= 1
      if (keys.has('d') || keys.has('arrowright')) dir.x += 1

      if (dir.lengthSq() > 0) {
        goal = null                              // 키를 누르면 클릭 목표를 버린다
        dir.normalize()
      } else if (goal) {
        const to = goal.clone().sub(actor.position)
        to.y = 0
        if (to.length() < 0.06) goal = null
        else dir.copy(to.normalize())
      }

      moving = dir.lengthSq() > 0
      if (moving) {
        actor.position.addScaledVector(dir, SPEED * dt)
        actor.position.x = Math.max(-HALF_X, Math.min(HALF_X, actor.position.x))
        actor.position.z = Math.max(-HALF_Z, Math.min(HALF_Z, actor.position.z))
        // 가는 쪽을 본다. 즉시 돌리면 뚝뚝 끊기므로 각도를 보간한다.
        const want = Math.atan2(dir.x, dir.z)
        let d = want - actor.rotation.y
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        actor.rotation.y += d * Math.min(1, dt * 12)
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

      renderer.render(scene, camera)
    }
    tick()

    const onResize = (): void => {
      const nw = host.clientWidth || w
      const nh = host.clientHeight || h
      const asp = nw / nh
      camera.left = -view * asp / 2
      camera.right = view * asp / 2
      camera.updateProjectionMatrix()
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
