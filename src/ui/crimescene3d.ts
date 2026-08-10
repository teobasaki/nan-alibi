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
  PEDESTAL_AT, SCENE_BOXES, SCENE_FX, SCENE_ROOM, SCENE_START,
  phaseAt, pulseAt, remainMs, sceneBlocked, vignetteAt, type ScenePhase,
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
  /** 방 안 위치. main 이 spawnFor 로 정해서 넘긴다 — 화면과 판정이 같은 값을 본다 */
  at: [number, number]
}

export interface SceneHandlers {
  /** E/클릭으로 집겠다고 한 것 — 규칙(가능한가·가방·스왑)은 main+engine 이 정한다 */
  onPick(id: string): void
  /** 시간 종료(화이트아웃까지 끝난 뒤) 또는 [철수] 버튼 — 둘은 같은 문이다 */
  onDone(reason: 'time' | 'exit'): void
}

export interface CrimeScene {
  dispose(): void
  /** 남은 증거품 갱신 — 주운 것은 사라지고, 스왑으로 내려놓은 것은 되살아난다 */
  setMarkers(list: SceneMarker[]): void
  /** 가방 표시 갱신 — 폴라로이드가 꽂힌다 */
  setBag(labels: string[], capacity: number): void
  /** 스왑 시간 비용 등 — 시계에 ms 를 얹는다 */
  addPenalty(ms: number): void
  /**
   * 수거 연출 — 그 자리에서 가방 슬롯으로 포물선 비행, 착지에 snap (60 Seconds! 해치 투척).
   * **setMarkers 로 마커가 지워지기 전에** 불러야 출발 좌표가 남아 있다.
   */
  flyFrom(id: string): void
  /** 안내줄(봉인·가방 가득 등) — 힌트바에 잠깐 띄운다 */
  note(text: string): void
  /**
   * 가방이 가득할 때의 선택 — 씬이 DOM 을 그리고 main 이 규칙을 정한다.
   * choose(null) = 그대로 둔다. 시계는 멈추지 않는다 (60 Seconds! 의 문법).
   */
  openSwap(items: { id: string; label: string }[], pickLabel: string, choose: (dropId: string | null) => void): void
}

const CHAR = import.meta.glob('/public/characters/*.walk.opt.glb', {
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
const RUN = import.meta.glob('/public/characters/*.run.opt.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const RUN_BY_SLUG = new Map<string, string>()
for (const [p, url] of Object.entries(RUN)) {
  const slug = p.split('/').pop()?.replace('.run.opt.glb', '')
  if (slug) RUN_BY_SLUG.set(slug, (url as string).replace(/^\/public/, ''))
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

const ACTOR_HEIGHT = 1.78
const EYE_HEIGHT = 1.64
const MARK_Y = 0.8
const TURN = 2.4

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
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x120d0c)

    /**
     * 정사영 — 방 전체가 한 화면에 들어와야 "어디부터 갈지" 를 고른다 (60 Seconds! 문법).
     * 경찰서(31.8m)는 따라다녔지만 이 방은 12×9m 라 **고정 카메라로 다 보인다** —
     * 따라다니면 오히려 남은 증거의 전모가 안 보여 포기가 선택이 못 된다.
     */
    const VIEW = 11.5
    const camera = new THREE.OrthographicCamera(
      -VIEW * (w / hgt) / 2, VIEW * (w / hgt) / 2, VIEW / 2, -VIEW / 2, 0.1, 200)
    const CAM_R = Math.hypot(9, 9)
    const camAngle0 = Math.atan2(9, 9)
    const placeCam = (ang: number): void => {
      camera.position.set(Math.cos(ang) * CAM_R, 12, Math.sin(ang) * CAM_R)
      camera.lookAt(0, 0, 0)
    }
    placeCam(camAngle0)

    /** 1인칭 눈 — explore3d 와 같은 화각·이유 */
    const eye = new THREE.PerspectiveCamera(60, w / hgt, 0.08, 100)

    /* ── 방 — 프리미티브. 재질 몇 개로 드로우콜을 묶는다 ── */
    const mat = (color: number, rough = 0.85): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 })

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), mat(COL.floor, 0.95))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    const wallMat = mat(COL.wall, 0.9)
    const mkWall = (wx: number, wz: number, sx: number, sz: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 3, sz), wallMat)
      m.position.set(wx, 1.5, wz)
      m.receiveShadow = true
      scene.add(m)
    }
    mkWall(0, SCENE_ROOM.minZ - 0.15, 12.6, 0.3)          // 뒷벽
    mkWall(SCENE_ROOM.minX - 0.15, 0, 0.3, 9.6)           // 좌벽
    // **컷어웨이** — 카메라 쪽 두 벽(+X·+Z)은 낮춘다. 60 Seconds! 의 문법이고
    // 경찰서 씬이 천장을 숨기는 것과 같은 이유다: 보여야 고를 수 있다.
    {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 9.6), wallMat)
      m.position.set(SCENE_ROOM.maxX + 0.15, 0.25, 0)
      scene.add(m)
      const f = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.5, 0.3), wallMat)
      f.position.set(0, 0.25, SCENE_ROOM.maxZ + 0.15)
      scene.add(f)
    }

    // 장애물 — 충돌 표(SCENE_BOXES)와 **같은 표**로 그린다. 보이는 것과 막히는 것이 같아야 한다.
    const boxMat: Record<string, THREE.MeshStandardMaterial> = {
      pedestal: mat(COL.pedestal, 0.7), partition: mat(COL.partition, 0.85),
      crate: mat(COL.crate, 0.9), desk: mat(COL.desk, 0.75),
    }
    for (const b of SCENE_BOXES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), boxMat[b.kind]!)
      m.position.set(b.x, b.h / 2, b.z)
      m.castShadow = true
      m.receiveShadow = true
      scene.add(m)
    }

    /* 현장 받침대 연출 — 테이프 윤곽 + 흩어진 서류 (시신 없음, 골든 케이스 §4) */
    {
      const tape = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.05, 4),
        new THREE.MeshBasicMaterial({ color: COL.tape, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
      tape.rotation.x = -Math.PI / 2
      tape.rotation.z = Math.PI / 4
      tape.position.set(PEDESTAL_AT[0], 0.02, PEDESTAL_AT[1] + 0.1)
      scene.add(tape)
      const paperG = new THREE.PlaneGeometry(0.24, 0.32)
      const paperM = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 1, side: THREE.DoubleSide })
      const sheets: [number, number, number][] = [[-0.5, -0.4, 0.4], [0.4, -0.8, 1.8], [0.7, 0.3, 0.9], [-0.2, 0.8, 2.6]]
      for (const [dx, dz, rot] of sheets) {
        const p = new THREE.Mesh(paperG, paperM)
        p.rotation.x = -Math.PI / 2
        p.rotation.z = rot
        p.position.set(PEDESTAL_AT[0] + dx, 0.03, PEDESTAL_AT[1] + 0.9 + dz)
        scene.add(p)
      }
    }

    // 조명 — 현장은 감식용 조명이 켜져 있다. 경찰서보다 차갑고 밝다.
    scene.add(new THREE.AmbientLight(0xffe2c0, 0.75))
    const key = new THREE.DirectionalLight(0xfff2dc, 1.5)
    key.position.set(6, 14, 4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const sc = key.shadow.camera as THREE.OrthographicCamera
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40
    key.shadow.bias = -0.0008
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0x8fa0bb, 0x241a17, 0.45))

    /* ── 내 몸 — 걷기 모델. 없으면 프리미티브 실루엣으로라도 선다 (에셋 0 원칙) ── */
    let picked: THREE.Object3D | null = null
    let mixer: THREE.AnimationMixer | null = null
    let walk: THREE.AnimationAction | null = null
    /**
     * 달리기 우선 — 클립과 속도는 한 몸이다. run 이 없거나 **리그가 말이 안 되면**
     * 걷기 클립 + 걷기 속도로 떨어진다.
     *
     * "말이 안 되는 배율은 거부한다" (explore3d 착석 모델의 그 함정): 누운 채 익스포트된
     * 리그는 키가 0.3m 로 재져 배율이 6배가 되고, 방에 드러누운 거인이 나온다 —
     * run 클립 첫 배선에서 실제로 그랬다. 키 1.2~2.5m 밖이면 그 후보를 버린다.
     */
    const runUrl = RUN_BY_SLUG.get(slug) ?? [...RUN_BY_SLUG.values()][0]
    const walkOnly = WALK_BY_SLUG.get(slug) ?? [...WALK_BY_SLUG.values()][0]
    const candidates = [...new Set([runUrl, walkOnly].filter((u): u is string => Boolean(u)))]
    let moveSpeed: number = SCENE_FX.speed
    if (candidates.length) {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')
      const draco = new DRACOLoader().setDecoderPath('/draco/')
      const loader = new GLTFLoader().setDRACOLoader(draco)
      for (const url of candidates) {
        const gltf = await loader.loadAsync(url)
        const mh = measuredHeight(gltf.scene)
        if (mh < 1.2 || mh > 2.5) {
          if (import.meta.env.DEV) {
            console.warn(`[현장] ${url} 리그가 이상하다 — 키 ${mh.toFixed(2)}m. 다음 후보로 넘어간다.`)
          }
          continue
        }
        picked = gltf.scene
        picked.scale.setScalar(ACTOR_HEIGHT / mh)
        moveSpeed = url === runUrl ? SCENE_FX.runSpeed : SCENE_FX.speed
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
          unrollLegs(clip, picked)
          walk = mixer.clipAction(clip)
          walk.play()
          walk.paused = true
        }
        break
      }
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

    const setMarkers = (list: SceneMarker[]): void => {
      markers = list
      for (const c of markerRoot.children) {
        const m = c as THREE.Mesh
        m.geometry?.dispose?.()
        ;((m as unknown as { material?: THREE.Material }).material)?.dispose?.()
      }
      markerRoot.clear()
      for (const m of list) {
        /**
         * 빌보드 아이콘이 있으면 그것, 없으면 프리미티브 실루엣 — 폴백이 본선이다.
         * 봉인은 회색으로 눌러 두고(틴트 곱), 범행 시각의 붉음은 발치 링이 계속 말한다.
         */
        const tex = iconFor(m.kind)
        const baseEm = m.sealed ? 0x241f1a : m.crime ? 0x5a1a14 : 0x4a3410
        const g: THREE.Object3D = tex
          ? new THREE.Sprite(new THREE.SpriteMaterial({
              map: tex, transparent: true,
              color: m.sealed ? 0x8a8078 : 0xffffff,
            }))
          : new THREE.Mesh(
              shapeOf(m.kind),
              new THREE.MeshStandardMaterial({
                color: m.sealed ? 0x776a5c : m.crime ? COL.red : COL.amber,
                emissive: baseEm,
                roughness: 0.45, metalness: 0.3,
              }))
        if (tex) {
          g.userData.baseScale = 1.3           // 스프라이트 배율은 월드 크기다 — 펄스가 덮으면 안 된다
          g.scale.setScalar(1.3)
        }
        g.userData.em = baseEm                 // 근접 하이라이트가 되돌릴 기준값
        g.position.set(m.at[0], MARK_Y, m.at[1])
        g.userData.id = m.id
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
        markerRoot.add(halo)

        if (m.sealed) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true, depthTest: false }))
          sp.userData.baseScale = 0.42         // 펄스 루프가 배율을 덮으므로 기준값을 남긴다
          sp.scale.setScalar(0.42)
          sp.position.set(m.at[0], MARK_Y + 0.55, m.at[1])
          sp.userData.id = m.id
          markerRoot.add(sp)
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

    const setBag = (labels: string[], capacity: number): void => {
      bagEl.replaceChildren()
      const had = bagEl.dataset.n ? Number(bagEl.dataset.n) : 0
      for (let i = 0; i < capacity; i++) {
        const slot = document.createElement('div')
        slot.className = `cs-slot${labels[i] ? ' full' : ''}${labels[i] && i >= had ? ' fresh' : ''}`
        if (labels[i]) slot.textContent = labels[i]!
        bagEl.appendChild(slot)
      }
      bagEl.dataset.n = String(labels.length)
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
      const v = new THREE.Vector3(m.at[0], MARK_Y, m.at[1]).project(cam)
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
    let firstPerson = false
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
      if (e.code === 'KeyE' || e.code === 'Space') {
        if (near) { handlers.onPick(near); e.preventDefault() }
        return
      }
      if (e.code === 'KeyV') { firstPerson = !firstPerson; e.preventDefault(); return }
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
    const dir = new THREE.Vector3()
    const camFwd = new THREE.Vector3()
    const camRight = new THREE.Vector3()
    const UP = new THREE.Vector3(0, 1, 0)
    const keyNum = (a: string, b: string): number => (keys.has(a) || keys.has(b) ? 1 : 0)

    const tick = (): void => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      const gap = clock.getDelta()                    // 프레임 간격 (초)
      const dt = Math.min(0.05, gap)                  // 이동·애니메이션용 — 벽 뚫기 방지 캡
      if (gap <= 1) elapsedMs += gap * 1000           // 1초 넘게 멎었던 시간은 시계가 세지 않는다
      const elapsed = elapsedMs
      const prevPhase = phase
      if (!ended) phase = phaseAt(elapsed, calm)
      if (phase === 'done' && !ended) { endScene('time'); }

      /* 훑기 — 카메라가 현장을 한 바퀴, 마커 전부 점멸 (기획서 §3) */
      if (phase === 'survey') {
        const k = elapsed / SCENE_FX.surveyMs
        placeCam(camAngle0 + k * Math.PI * 2)
        const blink = 0.75 + 0.45 * Math.sin(k * Math.PI * 10)
        for (const g of markerRoot.children) {
          if ((g as THREE.Mesh).geometry?.type !== 'RingGeometry') {
            g.scale.setScalar(((g.userData.baseScale as number) ?? 1) * blink)
          }
        }
      } else if (prevPhase === 'survey') {
        placeCam(camAngle0)
        caption.classList.remove('on')
        for (const g of markerRoot.children) g.scale.setScalar((g.userData.baseScale as number) ?? 1)
      }

      /* 이동 — collect 중에만. 화면 축 기준(정사영) / 몸 기준(1인칭) */
      if (phase === 'collect') {
        const fwd = keyNum('KeyW', 'ArrowUp') - keyNum('KeyS', 'ArrowDown')
        const side = keyNum('KeyD', 'ArrowRight') - keyNum('KeyA', 'ArrowLeft')
        dir.set(0, 0, 0)
        if (firstPerson) {
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
        if (dir.lengthSq() > 0) { goal = null; dir.normalize() }
        else if (goal) {
          const to = goal.clone().sub(actor.position)
          to.y = 0
          if (to.length() < 0.06) goal = null
          else dir.copy(to.normalize())
        }

        const bx = actor.position.x
        const bz = actor.position.z
        const moving = dir.lengthSq() > 0
        if (moving) {
          const step = moveSpeed * dt
          const nx = actor.position.x + dir.x * step
          const nz = actor.position.z + dir.z * step
          // 축 분리 — 벽에 비스듬히 닿으면 미끄러진다 (explore3d 와 같은 이유)
          if (dir.x !== 0 && !sceneBlocked(nx, actor.position.z)) actor.position.x = nx
          if (dir.z !== 0 && !sceneBlocked(actor.position.x, nz)) actor.position.z = nz
          const want = firstPerson ? actor.rotation.y : Math.atan2(dir.x, dir.z)
          let d = want - actor.rotation.y
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          actor.rotation.y += d * Math.min(1, dt * 12)
        }
        if (goal) {
          const moved = Math.hypot(actor.position.x - bx, actor.position.z - bz)
          stuckT = moved < moveSpeed * dt * 0.5 ? stuckT + dt : 0
          if (stuckT > 0.4) { goal = null; stuckT = 0 }
        } else stuckT = 0
        if (walk) walk.paused = !moving
        mixer?.update(dt)

        /* 근접 판정 — 가장 가까운 것 (nearestWithin 재사용) */
        const nowNear = nearestWithin(markers, actor.position.x, actor.position.z, SCENE_FX.pickRadius)
        if (nowNear !== near) {
          near = nowNear
          const m = markers.find((x) => x.id === near)
          hintEl.textContent = m
            ? m.sealed
              ? `${m.label} — E 로 수거 (봉인 — 열람은 심문에서 열쇠를 얻은 뒤)`
              : `${m.label} — E 또는 Space 로 수거`
            : nearestWithin([{ id: 'p', at: PEDESTAL_AT as [number, number] }],
                actor.position.x, actor.position.z, 1.7)
              ? pedestalLine
              : ''
          hintEl.classList.toggle('on', hintEl.textContent !== '')
        } else if (!near) {
          // 받침대 접근 서술 — 마커가 아니므로 매 프레임 갱신해도 싸다
          const onPed = nearestWithin([{ id: 'p', at: PEDESTAL_AT as [number, number] }],
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
          if (!isHalo) g.rotation.y += dt * 1.1   // 스프라이트에는 회전이 안 보인다 — 빌보드니까. 무해하다.
          const on = g.userData.id === near
          const base = (g.userData.baseScale as number) ?? 1
          g.scale.setScalar(base * (on ? (isHalo ? 1.12 : 1.35) : 1))
          const mat = (g as THREE.Mesh).material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial
          if (isHalo) {
            mat.opacity = on ? 0.5 : 0.16
            mat.color.setHex(on ? 0xf5efe0 : ((g.userData.col as number) ?? COL.amber))
          } else if (typeof g.userData.em === 'number' && mat.emissive) {
            mat.emissive.setHex(on ? 0xbdb49e : (g.userData.em as number))
          }
        }

        /* 시계·압박 곡선 — calm 은 전부 건너뛴다 */
        if (!calm) {
          const rm = remainMs(elapsed)
          const sec = Math.floor(rm / 1000)
          const tenth = Math.floor((rm % 1000) / 100)
          digitsEl.textContent = `00:${String(sec).padStart(2, '0')}.${tenth}`
          const pulse = pulseAt(rm / 1000)
          timerEl.classList.toggle('hot', pulse === 'heart')
          // 회중시계 — 남은 시간의 붉은 부채꼴이 줄고, 침이 그 가장자리를 짚는다
          const frac = rm / SCENE_FX.collectMs
          const ang = frac * Math.PI * 2
          if (frac > 0.9995) {
            sectorEl.setAttribute('d', `M50,50 L50,${50 - WR} A${WR},${WR} 0 1 1 49.99,${50 - WR} Z`)
          } else {
            const px = 50 + WR * Math.sin(ang)
            const py = 50 - WR * Math.cos(ang)
            sectorEl.setAttribute('d',
              `M50,50 L50,${50 - WR} A${WR},${WR} 0 ${ang > Math.PI ? 1 : 0} 1 ${px.toFixed(2)},${py.toFixed(2)} Z`)
          }
          // 마지막 5초 — 침이 떨린다 (결정론: elapsed 기반 사인, Math.random 금지)
          const jitter = pulse === 'heart' ? Math.sin(elapsed * 0.045) * 3.2 : 0
          needleEl.setAttribute('transform', `rotate(${(ang * 180 / Math.PI + jitter).toFixed(2)} 50 50)`)
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
          vin.style.opacity = String(vignetteAt(rm / 1000))
        }
      }

      if (firstPerson && phase === 'collect') {
        eye.position.set(actor.position.x, EYE_HEIGHT, actor.position.z)
        const f = new THREE.Vector3(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y))
        eye.lookAt(eye.position.clone().add(f).setY(EYE_HEIGHT))
        actor.visible = false
        renderer.render(scene, eye)
      } else {
        actor.visible = true
        renderer.render(scene, camera)
      }
    }
    // 개발 중에만 씬을 밖에서 들여다본다 — 3D 는 콘솔 없이는 원인을 못 찾는다 (explore3d 의 __ex 와 같은 이유)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__cs = {
        scene, actor, markerRoot, camera,
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
      addPenalty: (ms) => { elapsedMs += ms },
      flyFrom,
      note,
      openSwap,
      dispose() {
        alive = false
        cancelAnimationFrame(raf)
        clearTimeout(noteT)
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
