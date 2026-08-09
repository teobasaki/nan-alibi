/**
 * 수첩이 놓이는 한 박자 — **펼쳐진 가죽 수첩이 화면에 한 번 선다.**
 *
 * ## 왜 3D 인가 (그리고 왜 여기뿐인가)
 * 수사 화면은 격자·버튼·스크롤이라 **DOM 이어야 한다.** 3D 로 만들면 접근성과
 * 스크롤을 통째로 다시 짜야 하고, 얻는 것은 질감뿐이다. 그래서 수첩 본체는
 * 지금도 DOM 이고 앞으로도 DOM 이다.
 *
 * 그런데 이 게임은 **"수첩을 펼치며 수사가 시작된다"** 를 이미 은유로 갖고 있고
 * (`.nb.opening`, style.css), 그 은유가 시작되는 **딱 한 순간**에는 물건이
 * 실제로 있어야 설득된다. 여기가 그 한 순간이다 — 1.1초, 한 번, 그 뒤로는 DOM 이다.
 *
 * 이 모델은 **이미 펼쳐진** 수첩이라 은유가 그대로 맞는다. 펼쳐진 가죽 수첩이
 * 화면을 채우고, 그 자리를 펼쳐지는 DOM 수첩이 이어받는다 — 같은 물건의 두 표현이다.
 *
 * ## 없으면 없는 대로 간다
 * `public/nb/journal.opt.glb` 가 없으면 이 모듈은 **아무것도 하지 않고 즉시 resolve** 한다.
 * 인물 사진·경찰서·재현영상과 같은 규칙이다 — 에셋이 비어도 화면이 안 깨진다.
 *
 * 출처: "A writer's journal" by Valeria Gerontopoulos (CC BY 4.0) — CREDITS.md
 */

import * as THREE from 'three'

const FILES = import.meta.glob('/public/nb/journal.opt.glb', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const URL_ = (Object.values(FILES)[0] as string | undefined)?.replace(/^\/public/, '')

export const hasJournalModel = (): boolean => Boolean(URL_)

/** 연출 길이(ms). `.nb.opening`(900ms)이 이어받으므로 여기서 다 쓰지 않는다. */
const BEAT = 1100
/** 모션을 줄인 사람에게는 **움직임 없이** 이만큼만 보여준다 */
const BEAT_STILL = 650

/**
 * 수첩을 한 번 세웠다 눕힌다. 끝나면 resolve — 호출부는 그 다음에 수첩을 펼친다.
 * **연출을 못 하면 조용히 넘어간다.** 시작을 막는 연출은 연출이 아니라 장애물이다.
 */
export async function showJournal(): Promise<void> {
  if (!URL_) return
  /**
   * **모션을 줄이는 사람에게도 물건은 보여준다.**
   * 예전엔 여기서 그냥 return 했다 — 그러면 그 사람에게는 수첩이 아예 없는 것이 된다.
   * 줄여야 하는 것은 **움직임**이지 그림이 아니다. 카메라를 고정하고 짧게 보여준다.
   */
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  /**
   * **그릴 수 없으면 시작하지 않는다.**
   * `.nb3d` 는 불투명하다. 숨은 탭이나 레이아웃 전이라 `innerWidth` 가 0 이면
   * three 의 `setSize` 가 캔버스에 **인라인으로 0px 를 박아** 영영 0×0 이 된다.
   * 그러면 화면에는 "연출 없음" 이 아니라 **아무것도 없는 검은 판**이 남는다.
   * 실제로 그렇게 덮여서 "수첩이 왜 안 나오냐" 가 됐다.
   */
  const vw = (): number => document.documentElement.clientWidth || innerWidth
  const vh = (): number => document.documentElement.clientHeight || innerHeight
  if (!vw() || !vh() || document.visibilityState !== 'visible') return

  let host: HTMLDivElement | null = null
  let raf = 0
  let renderer: THREE.WebGLRenderer | null = null
  let onResize: (() => void) | null = null

  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')

    const w = vw()
    const h = vh()
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    renderer.setSize(w, h)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 60)

    /**
     * **모델을 먼저 받고 나서 화면을 덮는다.** 덮어 놓고 기다리면 로딩이 느린 만큼
     * 검은 판이 오래 남고, 실패하면 그 판만 남는다. 그리고 **2.5초 안에 못 받으면 포기한다** —
     * 시작을 막는 연출은 연출이 아니라 장애물이다.
     */
    const draco = new DRACOLoader().setDecoderPath('/draco/')
    const loaded = await Promise.race([
      new GLTFLoader().setDRACOLoader(draco).loadAsync(URL_),
      new Promise<null>((r) => setTimeout(() => r(null), 2500)),
    ])
    if (!loaded) return
    const gltf = loaded
    const book = gltf.scene

    host = document.createElement('div')
    host.className = 'nb3d'
    host.appendChild(renderer.domElement)
    document.body.appendChild(host)

    // 창 크기가 바뀌어도 캔버스가 따라간다 — 인라인 px 가 박히므로 CSS 만으로는 안 된다
    onResize = (): void => {
      if (!renderer) return
      renderer.setSize(vw(), vh())
      camera.aspect = vw() / vh()
      camera.updateProjectionMatrix()
    }
    addEventListener('resize', onResize)

    // 크기를 모른 채 카메라를 두면 매번 다시 재야 한다 — 긴 변을 1로 맞춘다.
    const box = new THREE.Box3().setFromObject(book)
    const size = new THREE.Vector3()
    box.getSize(size)
    const span = Math.max(size.x, size.y, size.z) || 1
    book.scale.setScalar(1 / span)
    // 원점을 물건 가운데로 — 그래야 회전이 책을 중심으로 돈다
    const mid = new THREE.Vector3()
    box.getCenter(mid)
    book.position.copy(mid).multiplyScalar(-1 / span)

    const pivot = new THREE.Group()
    pivot.add(book)
    scene.add(pivot)

    book.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = true
      for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
        if (!mm) continue
        // Sketchfab 모델은 대개 스스로 빛난다 — 이 프로젝트가 모든 에셋에 하는 처리다
        mm.emissive?.setScalar(0)
        mm.emissiveMap = null
      }
    })

    /**
     * **조명은 취조실의 것을 빌린다.** 놋쇠빛 키 하나와 낮은 환경광 —
     * 게임 팔레트(`--amber #c8912f`)와 같은 색이라야 다음 화면과 이어진다.
     */
    scene.add(new THREE.AmbientLight(0xffd9b0, 0.95))
    const key = new THREE.DirectionalLight(0xffe6bc, 3.4)
    key.position.set(1.6, 2.4, 1.8)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x8899cc, 0.8)
    rim.position.set(-2, 0.6, -1.4)
    scene.add(rim)

    await new Promise<void>((resolve) => {
      const dur = still ? BEAT_STILL : BEAT
      const t0 = performance.now()
      /**
       * **연출이 게임을 붙잡지 못하게 한다.** 탭이 숨으면 rAF 가 멈추고,
       * 그러면 이 약속이 영영 안 풀려 수사가 시작되지 않는다. 시간으로 끊는다.
       */
      const bail = setTimeout(() => resolve(), dur + 1200)
      const done = (): void => { clearTimeout(bail); resolve() }
      const step = (): void => {
        const p = Math.min(1, (performance.now() - t0) / dur)
        // 부드럽게 들어와 부드럽게 앉는다
        const e = 1 - Math.pow(1 - p, 3)

        /**
         * **표지를 내려다본다.** 이 모델은 XZ 평면에 눕고 Y 가 두께다(2 × 0.136 × 1.066).
         * 그래서 카메라를 옆에 두면 표지가 아니라 **책등만 보인다** — 처음에 그렇게 만들어
         * 화면에 얇은 선 하나만 떴다. 책은 그대로 눕혀 두고 **카메라가 위에서 내려온다.**
         *
         * 책은 조금만 돌린다. 물건이 살아 있어 보이는 데는 그 정도면 되고,
         * 많이 돌리면 다음 화면(펼쳐진 DOM 수첩)과 각도가 어긋난다.
         */
        // 모션을 줄인 사람에게는 끝 자세로 고정한다 — 그림은 그대로, 움직임만 없앤다
        const k = still ? 1 : e
        pivot.rotation.y = THREE.MathUtils.lerp(-0.30, -0.05, k)
        camera.position.set(
          THREE.MathUtils.lerp(0.30, 0.01, k),
          THREE.MathUtils.lerp(1.24, 0.76, k),
          THREE.MathUtils.lerp(0.96, 0.58, k))
        camera.lookAt(0, 0, 0)

        // 끝에서 사라진다 — 다음 화면(DOM 수첩)이 그 자리를 이어받는다
        if (host) host.style.opacity = String(p < 0.82 ? 1 : 1 - (p - 0.82) / 0.18)

        renderer?.render(scene, camera)
        if (p >= 1) return done()
        raf = requestAnimationFrame(step)
      }
      step()
    })
  } catch {
    /* 연출은 실패해도 게임을 막지 않는다 */
  } finally {
    cancelAnimationFrame(raf)
    if (onResize) removeEventListener('resize', onResize)
    renderer?.dispose()
    host?.remove()
  }
}
