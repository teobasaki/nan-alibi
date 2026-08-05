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
    renderer.toneMappingExposure = 0.78
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
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.05, 50)

    /**
     * ## 취조실 — 테이블을 사이에 두고 마주 앉는다
     *
     * 처음엔 검은 벽 앞의 흉상이었다. "어두운 방은 상자 몇 개면 된다" 고 해 놓고
     * 정작 상자를 안 만든 탓이다. 취조 장면은 **가구가 만든다** —
     * 테이블이 없으면 심문이 아니라 증명사진이다.
     *
     * 카메라는 **형사의 자리**에 있다. 플레이어가 곧 취조하는 사람이므로,
     * 테이블 이쪽 끝에서 약간 위에서 내려다본다.
     */
    const mat = (color: number, roughness = 0.9, metalness = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness })

    /**
     * 얼룩진 콘크리트 — **캔버스로 만든다.** 레퍼런스의 벽은 평평한 회색이 아니라
     * 물자국과 곰팡이가 얼룩덜룩한 면이고, 빛이 훑고 지나갈 때 그 얼룩이 드러나는 것이
     * 이 장면의 공포를 만든다. 평면 색으로 두면 스튜디오가 된다.
     * 결정론적 노이즈다 — 이 프로젝트는 Math.random() 을 금지한다.
     */
    const concrete = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 512
      const g = c.getContext('2d')!
      g.fillStyle = '#6b6560'
      g.fillRect(0, 0, 512, 512)
      let x = 0x1a2b3c4d
      const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 0xffffffff) }
      for (let i = 0; i < 2600; i++) {
        const px = rnd() * 512, py = rnd() * 512
        const r = 6 + rnd() * 54
        const dark = rnd() < 0.62
        const a = 0.03 + rnd() * 0.1
        const grd = g.createRadialGradient(px, py, 0, px, py, r)
        grd.addColorStop(0, dark ? `rgba(24,20,18,${a})` : `rgba(150,145,138,${a * 0.7})`)
        grd.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grd
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill()
      }
      // 세로로 흘러내린 물자국
      for (let i = 0; i < 90; i++) {
        const px = rnd() * 512
        g.fillStyle = `rgba(20,16,14,${0.02 + rnd() * 0.05})`
        g.fillRect(px, rnd() * 200, 1 + rnd() * 4, 120 + rnd() * 300)
      }
      const t = new THREE.CanvasTexture(c)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(2, 1.6)
      return t
    })()

    // 테이블 — 화면 아래를 가로지른다. 이 한 덩어리가 장면의 성격을 정한다.
    const TABLE_H = 0.74
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.05, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x3a322b, roughness: 0.55, metalness: 0.25, map: concrete }),
    )
    table.position.set(0, TABLE_H, 0.52)
    table.castShadow = true
    table.receiveShadow = true
    const legGeo = new THREE.BoxGeometry(0.05, TABLE_H, 0.05)
    const LEGS: [number, number][] = [[-0.72, 0.16], [0.72, 0.16], [-0.72, 0.88], [0.72, 0.88]]
    for (const [x, z] of LEGS) {
      const leg = new THREE.Mesh(legGeo, mat(0x1d1713))
      leg.position.set(x, TABLE_H / 2, z)
      leg.castShadow = true
      scene.add(leg)
    }
    scene.add(table)

    // 의자 등받이 — 용의자 뒤로 살짝 보인다. 앉아 있다는 증거다.
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.04), mat(0x1a1512))
    chair.position.set(0, 0.72, -0.34)
    chair.castShadow = true
    scene.add(chair)

    // 방 — 벽 셋. 열린 쪽이 형사의 등 뒤다.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2e2724, roughness: 1, map: concrete,
    })
    const back = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3), wallMat)
    back.position.set(0, 1.5, -1.15)
    back.receiveShadow = true
    const left = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), wallMat)
    left.position.set(-1.7, 1.5, 0.35)
    left.rotation.y = Math.PI / 2
    left.receiveShadow = true
    const right = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), wallMat)
    right.position.set(1.7, 1.5, 0.35)
    right.rotation.y = -Math.PI / 2
    right.receiveShadow = true
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 1, map: concrete }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(back, left, right, floor)

    /**
     * 전경의 어깨 — **형사(=플레이어)의 것**이다.
     * 레퍼런스에서 왼쪽 아래를 채운 검은 실루엣이 이 장면을 "보는 그림" 이 아니라
     * "내가 앉아 있는 방" 으로 바꾼다. 완전한 검정이라 형태만 있으면 된다.
     */
    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    )
    shoulder.scale.set(1.15, 1.7, 0.7)
    scene.add(shoulder)

    /**
     * 조명 — 테이블 위 갓등 **하나**. 취조실의 그 등이다.
     * 빛을 더 넣으면 사무실이 되고, 하나만 두면 취조실이 된다.
     */
    const key = new THREE.SpotLight(0xffe2b4, 7.5, 7, Math.PI / 6.5, 0.5, 1.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0015
    scene.add(key, key.target)
    /**
     * 갓등 — **화면 안에 보이고, 흔들린다.**
     * 레퍼런스의 핵심은 등이 흔들리며 빛이 얼굴을 훑는 것이다. 고정된 조명은
     * 아무리 어두워도 정물이 되고, 흔들리는 순간 방이 살아 있는 공간이 된다.
     * 줄까지 그린다 — 매달린 게 보여야 흔들림이 납득된다.
     */
    const lamp = new THREE.Group()
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.85, 6),
      new THREE.MeshStandardMaterial({ color: 0x120e0c, roughness: 1 }),
    )
    cord.position.y = -0.425
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.21, 0.12, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x4a4038, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide,
      }),
    )
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffeccd }),
    )
    shade.position.y = -0.85
    bulb.position.y = -0.9
    lamp.add(cord, shade, bulb)
    scene.add(lamp)

    // 반사광은 거의 없다. 어두워야 취조실이다.
    scene.add(new THREE.HemisphereLight(0x3a2830, 0x0a0806, 0.42))
    // 테이블 상판에 떨어지는 빛 — 갓등 아래 원형 자국. 이게 있어야 '그 방' 이 된다.
    const tableLight = new THREE.SpotLight(0xffdca8, 6, 3, Math.PI / 5, 0.8, 2)
    scene.add(tableLight, tableLight.target)

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
    // 앉은 모델은 세로가 1.36m 다. 선 키(1.72)로 정규화하면 26% 커진다.
    // 실제 세로를 그대로 두고(이미 미터 단위) 크기 보정은 하지 않는다.
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const scale = size.y > 1.55 ? 1.72 / size.y : 1   // 서 있는 모델만 정규화
    model.scale.setScalar(scale)
    const box2 = new THREE.Box3().setFromObject(model)
    const height = box2.max.y - box2.min.y
    if (height < 1.15) {
      // **흉상이다.** 이미지→3D 는 원본 사진이 흉상이면 흉상을 준다(그래서 리깅도 안 된다).
      // 다리가 없으니 바닥 기준으로 놓으면 공중에 뜬다. 테이블 뒤 '앉은 사람의 가슴' 높이에 맞춘다.
      // 이 구도에서는 다리가 보이지 않으므로 없어도 성립한다 — 테이블이 가려 준다.
      model.position.y += 1.42 - box2.max.y
    } else {
      model.position.y -= box2.min.y
    }
    model.position.x -= (box2.max.x + box2.min.x) / 2

    /** 뼈 이름은 리깅 도구마다 다르다. 패턴으로 찾고, 못 찾으면 모델 전체를 흔든다. */
    const findBone = (re: RegExp): import('three').Object3D | null => {
      let hit: import('three').Object3D | null = null
      model.traverse((o) => {
        if (!hit && (o as import('three').Bone).isBone && re.test(o.name)) hit = o
      })
      return hit
    }
    const head = findBone(/^head$|head(?!_?end|front)/i) ?? findBone(/head/i)
    const spine = findBone(/spine|chest|torso/i)

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
    const aim = new THREE.Vector3(face.x + 0.06, face.y - 0.16, face.z)
    camera.position.set(face.x + 0.24, face.y + 0.30, face.z + 1.62)
    camera.lookAt(aim)

    // 갓등은 테이블 위, 얼굴보다 조금 앞에 매단다
    shade.position.set(0, face.y + 0.42, face.z + 0.34)
    bulb.position.set(0, face.y + 0.37, face.z + 0.34)
    key.position.copy(bulb.position)
    key.target.position.set(face.x, face.y - 0.1, face.z)
    // 등은 **화면 왼쪽 위**에 비스듬히 — 레퍼런스처럼 정중앙이 아니다.
    // 중앙에 두면 증명사진 조명이 되고, 비스듬해야 빛이 얼굴을 '훑는다'.
    const PIVOT = new THREE.Vector3(face.x - 0.42, face.y + 1.05, face.z + 0.52)
    lamp.position.copy(PIVOT)
    tableLight.position.set(face.x, face.y + 0.5, face.z + 0.5)
    tableLight.target.position.set(face.x, TABLE_H, face.z + 0.6)

    // 전경 어깨 — 카메라 바로 앞 왼쪽 아래. 화면의 3분의 1을 검게 먹는다.
    shoulder.position.set(camera.position.x - 0.60, camera.position.y - 0.50, camera.position.z - 0.34)
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

      /**
       * **등이 흔들린다.** 두 주기를 겹쳐 진자처럼 — 하나는 크고 느리게, 하나는
       * 작고 빠르게. 단일 사인파는 기계처럼 보인다.
       * 압박이 오르면 진폭이 커진다: 방이 흔들리는 게 아니라 심문이 거칠어지는 것이다.
       */
      const heat0 = Math.min(1, pressure / 100)
      const swingA = 0.16 + heat0 * 0.14
      const sx = Math.sin(t * 0.62) * swingA + Math.sin(t * 1.37) * swingA * 0.28
      const sz = Math.cos(t * 0.48) * swingA * 0.55
      lamp.rotation.set(sz, 0, sx)
      // 등이 기울면 광원도 같이 간다 — 줄 길이 0.85m 끝에 매달린 전구의 위치
      const LEN = 0.85
      bulb.getWorldPosition(key.position)
      key.position.y = PIVOT.y - LEN * Math.cos(sx) * Math.cos(sz)
      key.position.x = PIVOT.x + LEN * Math.sin(sx)
      key.position.z = PIVOT.z + LEN * Math.sin(sz)
      // 빛이 훑고 지나가되 겨냥은 얼굴 언저리에 남는다
      key.target.position.set(face.x + sx * 0.5, face.y - 0.12, face.z)
      // 흔들리는 전구는 미세하게 깜빡인다
      const flick = 1 + Math.sin(t * 11.3) * 0.03 + Math.sin(t * 27.7) * 0.015

      // 압박이 높으면 조명이 붉게 조여든다 — CSS 분위기 층과 같은 언어
      const heat = Math.min(1, pressure / 100)
      key.color.setRGB(1, 0.886 - heat * 0.22, 0.706 - heat * 0.32)
      key.intensity = (7.5 + heat * 3.5) * flick

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
