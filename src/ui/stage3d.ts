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
 * Meshy 오토리깅이 주는 클립은 **걷기·달리기뿐**이라 심문 장면에 쓸 데가 없다.
 * 대신 뼈대를 직접 흔든다 — 호흡, 미세한 고개 움직임, 압박이 높을 때의 떨림.
 * 사람이 가만히 서 있을 때 실제로 하는 것이 그것이고, 클립보다 상태에 잘 반응한다.
 */

export interface Stage3D {
  /** 압박 0~100 — 호흡이 빨라지고 몸이 굳는다 */
  setPressure(v: number): void
  /** 말하는 중 — 미세하게 고개가 움직인다 */
  setSpeaking(v: boolean): void
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

const MODELS = import.meta.glob('/public/characters/*.opt.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const BY_SLUG = new Map<string, string>()
for (const [path, url] of Object.entries(MODELS)) {
  const name = path.split('/').pop()?.replace(/\.opt\.glb$/, '')
  if (name) BY_SLUG.set(name, (url as string).replace(/^\/public/, ''))
}

export const hasModel = (slug: string): boolean => BY_SLUG.has(slug)

/**
 * 취조실을 그린다. 실패하면 null.
 * @param host 캔버스를 넣을 요소. 크기는 호출부가 CSS 로 정한다.
 */
export async function mount(host: HTMLElement, slug: string): Promise<Stage3D | null> {
  const url = BY_SLUG.get(slug)
  if (!url || !canRender3D()) return null

  try {
    const THREE = await import('three')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')

    const w = host.clientWidth || 320
    const h = host.clientHeight || 380

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // 필름 같은 계조. 없으면 하이라이트가 하얗게 타서 플라스틱처럼 보인다.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // **가슴 위로 바짝 붙는다.** 전신을 담으면 얼굴이 20px 이 되고,
    // 그러면 3D 를 넣은 이유가 사라진다 (첫 배선에서 실제로 그랬다).
    const camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 50)
    const EYE = 1.56          // 서 있는 사람의 눈높이 (모델은 1.72m 로 정규화된다)
    camera.position.set(0.12, EYE, 0.78)
    camera.lookAt(0, EYE - 0.06, 0)

    /**
     * 취조실 조명 — **머리 위 하나뿐**이다.
     * 이 게임의 CSS 분위기 층(비네트·그레인)이 같은 전제로 만들어졌다.
     * 빛을 더 넣으면 사무실이 되고, 하나만 두면 취조실이 된다.
     */
    const key = new THREE.SpotLight(0xffe2b4, 9, 6, Math.PI / 9, 0.7, 1.8)
    key.position.set(0.35, 2.5, 0.55)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0015
    scene.add(key, key.target)
    // 바닥에서 올라오는 아주 약한 반사광 — 이게 없으면 턱 밑이 완전히 죽는다
    // 반사광은 **거의 없다.** 밝히면 사무실이 되고, 어두워야 취조실이다.
    scene.add(new THREE.HemisphereLight(0x2a1c20, 0x0a0806, 0.18))

    // 방 — 상자 몇 개면 충분하다. 생성 모델을 쓸 이유가 없었다.
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1416, roughness: 0.95 }),
    )
    wall.position.set(0, 1.6, -0.75)
    wall.receiveShadow = true
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({ color: 0x141013, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(wall, floor)

    const draco = new DRACOLoader()
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)

    const gltf = await loader.loadAsync(url)
    const model = gltf.scene
    model.traverse((o) => {
      const m = o as import('three').Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    scene.add(model)

    // 발이 바닥에 닿고 가슴이 화면 중앙에 오도록 맞춘다 — 모델마다 크기가 다르다
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const scale = 1.72 / (size.y || 1.72)
    model.scale.setScalar(scale)
    const box2 = new THREE.Box3().setFromObject(model)
    model.position.y -= box2.min.y
    model.position.x -= (box2.max.x + box2.min.x) / 2
    key.target.position.set(0, 1.4, 0)

    /** 뼈 이름은 리깅 도구마다 다르다. 패턴으로 찾고, 못 찾으면 모델 전체를 흔든다. */
    const findBone = (re: RegExp): import('three').Object3D | null => {
      let hit: import('three').Object3D | null = null
      model.traverse((o) => {
        if (!hit && (o as import('three').Bone).isBone && re.test(o.name)) hit = o
      })
      return hit
    }
    const head = findBone(/head/i)
    const spine = findBone(/spine|chest|torso/i)
    const rest = new Map<import('three').Object3D, import('three').Euler>()
    for (const b of [head, spine]) if (b) rest.set(b, (b as import('three').Object3D).rotation.clone())

    let pressure = 0
    let speaking = false
    let raf = 0
    let t0 = performance.now()

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const t = (performance.now() - t0) / 1000
      // 압박이 오르면 호흡이 빨라지고 얕아진다 — 굳는 것이지 커지는 게 아니다
      const rate = 1.0 + (pressure / 100) * 1.6
      const depth = 0.022 * (1 - (pressure / 100) * 0.45)
      const breath = Math.sin(t * rate) * depth

      if (spine) {
        const r = rest.get(spine)!
        spine.rotation.set(r.x + breath * 0.5, r.y, r.z)
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
        model.rotation.y = Math.sin(t * 0.35) * 0.04
        model.position.y += Math.sin(t * rate) * 0.0004
      }

      // 압박이 높으면 조명이 붉게 조여든다 — CSS 분위기 층과 같은 언어
      const heat = Math.min(1, pressure / 100)
      key.color.setRGB(1, 0.886 - heat * 0.22, 0.706 - heat * 0.32)
      key.intensity = 9 + heat * 4

      renderer.render(scene, camera)
    }
    tick()

    const onResize = (): void => {
      const nw = host.clientWidth || w
      const nh = host.clientHeight || h
      renderer.setSize(nw, nh)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    }
    addEventListener('resize', onResize)

    return {
      setPressure: (v) => { pressure = Math.max(0, Math.min(100, v)) },
      setSpeaking: (v) => { speaking = v },
      dispose: () => {
        cancelAnimationFrame(raf)
        removeEventListener('resize', onResize)
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
