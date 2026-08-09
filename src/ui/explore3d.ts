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
}

export interface Explore3D {
  dispose(): void
  /** 마커 갱신 — 조회한 기록은 사라진다 */
  setMarkers(list: Marker[]): void
  /** 지금 걷고 있는가 (UI 힌트용) */
  isMoving(): boolean
}

export interface ExploreHandlers {
  /**
   * 마커에 **닿았을 때** — 아직 아무 일도 일어나지 않는다.
   * 근접만으로 조회를 소모하면 지나가다 조사를 잃는다. 자원 게임에서 그건 사고다.
   */
  onNear(id: string | null): void
  /** 플레이어가 **집겠다고 한 것** — E 키 또는 마커 클릭 */
  onPick(id: string): void
}

const CHAR = import.meta.glob('/public/characters/*.walk.opt.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const WALK_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(CHAR)) {
  const slug = p.split('/').pop()?.replace('.walk.opt.glb', '')
  if (slug) WALK_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
}

const ROOM_URL = (Object.values(
  import.meta.glob('/public/room/room.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string | undefined)?.replace(/^\/public/, '')

export const hasWalkModel = (slug: string): boolean => WALK_BY_SLUG.has(slug)

/** 방 크기(미터). 심문 씬과 같은 배율에서 나온 값이다. */
const ROOM_SCALE = 1.9
const HALF = 1.35          // 걸어 다닐 수 있는 반경 — 벽 안쪽
const SPEED = 1.25         // m/s. 32프레임 걷기 클립의 보폭에 맞췄다
const PICK_RADIUS = 0.42   // 이 거리 안에 들어오면 주울 수 있다

export async function mountExplore(
  host: HTMLElement,
  slug: string,
  handlers: ExploreHandlers,
): Promise<Explore3D | null> {
  if (!ROOM_URL || !WALK_BY_SLUG.has(slug)) return null

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
    const view = 3.4
    const camera = new THREE.OrthographicCamera(
      -view * (w / h) / 2, view * (w / h) / 2, view / 2, -view / 2, 0.1, 40)
    camera.position.set(2.6, 3.4, 2.6)
    camera.lookAt(0, 0.55, 0)

    const draco = new DRACOLoader().setDecoderPath('/draco/')
    const loader = new GLTFLoader().setDRACOLoader(draco)

    const [roomGltf, charGltf] = await Promise.all([
      loader.loadAsync(ROOM_URL),
      loader.loadAsync(WALK_BY_SLUG.get(slug)!),
    ])

    const room = roomGltf.scene
    room.scale.setScalar(ROOM_SCALE)
    room.traverse((o) => {
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
    actor.scale.setScalar(height > 0 ? 1.7 / height : 1)   // 사람 키 1.7m
    actor.position.set(0, 0, 0.9)
    scene.add(actor)

    const mixer = new THREE.AnimationMixer(actor)
    const clip = charGltf.animations[0]
    const walk = clip ? mixer.clipAction(clip) : null
    walk?.play()
    if (walk) walk.paused = true      // 멈춰 있을 때는 정지 프레임

    // 조명 — 심문실보다 밝게. 어두우면 어디로 갈지 안 보인다.
    scene.add(new THREE.AmbientLight(0xffd9b0, 0.55))
    const lamp = new THREE.PointLight(0xffcf9a, 14, 7, 2)
    lamp.position.set(0.05, 1.75, 0.02)
    scene.add(lamp)

    // ── 마커 ──
    const markerRoot = new THREE.Group()
    scene.add(markerRoot)
    let markers: Marker[] = []

    const setMarkers = (list: Marker[]): void => {
      markers = list
      markerRoot.clear()
      for (const m of list) {
        const g = new THREE.Mesh(
          new THREE.RingGeometry(0.13, 0.18, 24),
          new THREE.MeshBasicMaterial({ color: 0xc8912f, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
        )
        g.rotation.x = -Math.PI / 2
        g.position.set(m.at[0], 0.02, m.at[1])
        g.userData.id = m.id
        markerRoot.add(g)
      }
    }

    // ── 입력 ──
    // **`tick()`·핸들러가 참조하는 것은 전부 그보다 먼저 선언한다.**
    // 이 프로젝트는 stage3d.ts 에서 같은 TDZ 를 두 번 밟았다(lastFrame·applyCam).
    let near: string | null = null
    const keys = new Set<string>()
    const onDown = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (k === 'e' && near) { handlers.onPick(near); e.preventDefault(); return }
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
      const onMarker = ray.intersectObjects(markerRoot.children, false)[0]
      if (onMarker) {
        const id = onMarker.object.userData.id as string | undefined
        if (id) handlers.onPick(id)
        return
      }
      const hit = new THREE.Vector3()
      if (ray.ray.intersectPlane(floor, hit)) {
        goal = new THREE.Vector3(
          Math.max(-HALF, Math.min(HALF, hit.x)), 0,
          Math.max(-HALF, Math.min(HALF, hit.z)))
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
        actor.position.x = Math.max(-HALF, Math.min(HALF, actor.position.x))
        actor.position.z = Math.max(-HALF, Math.min(HALF, actor.position.z))
        // 가는 쪽을 본다. 즉시 돌리면 뚝뚝 끊기므로 각도를 보간한다.
        const want = Math.atan2(dir.x, dir.z)
        let d = want - actor.rotation.y
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        actor.rotation.y += d * Math.min(1, dt * 12)
      }
      if (walk) walk.paused = !moving
      mixer.update(dt)

      // **닿았다고 줍지 않는다.** 어느 것에 닿았는지만 알리고, 집는 건 사람이 정한다.
      let nowNear: string | null = null
      for (const m of markers) {
        const dx = actor.position.x - m.at[0]
        const dz = actor.position.z - m.at[1]
        if (dx * dx + dz * dz < PICK_RADIUS * PICK_RADIUS) { nowNear = m.id; break }
      }
      if (nowNear !== near) {
        near = nowNear
        handlers.onNear(near)
      }
      // 닿아 있는 마커는 부풀어 오른다 — 지금 집을 수 있다는 신호
      for (const g of markerRoot.children) {
        const on = g.userData.id === near
        g.scale.setScalar(on ? 1.35 : 1)
        const mat = (g as THREE.Mesh).material as THREE.MeshBasicMaterial
        mat.opacity = on ? 1 : 0.55
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
