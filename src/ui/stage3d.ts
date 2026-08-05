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

const MODELS = import.meta.glob('/public/characters/*.opt.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const ROOM_URL = (Object.values(
  import.meta.glob('/public/room/room.opt.glb', { eager: true, query: '?url', import: 'default' }),
)[0] as string ?? '').replace(/^\/public/, '')

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
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.05, 50)

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
    const ROOM_SCALE = 1.9
    const roomGltf = await new GLTFLoader().setDRACOLoader(
      new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'),
    ).loadAsync(ROOM_URL)
    const room = roomGltf.scene
    room.scale.setScalar(ROOM_SCALE)
    room.traverse((o) => {
      const m = o as import('three').Mesh
      if (m.isMesh) {
        m.receiveShadow = true
        m.castShadow = true
        const mm = m.material as import('three').MeshStandardMaterial
        if (mm?.isMeshStandardMaterial) {
          // 에셋이 밝은 사무실 톤이다. 어둡게 눌러 취조실로 만든다.
          mm.color.multiplyScalar(0.42)
          mm.roughness = Math.max(mm.roughness, 0.85)
          mm.metalness = Math.min(mm.metalness, 0.15)
        }
      }
    })
    // 원본 바닥이 z=-0.53 단위 → 월드 0 으로 내린다
    room.position.y = 0.53 * ROOM_SCALE
    scene.add(room)

    const TABLE_H = 0.74

    /**
     * 조명 — 방 에셋의 갓등 **아래에** 실제 광원을 매단다.
     * 에셋에는 조명이 없다(LIGHT 0개). 등은 형상일 뿐이라 빛은 우리가 넣어야 한다.
     * 흔들림도 여기서 만든다 — 빛이 얼굴을 훑는 것이 이 장면의 핵심이다.
     */
    const key = new THREE.SpotLight(0xffd9a0, 22, 9, Math.PI / 5.5, 0.6, 1.4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.002
    scene.add(key, key.target)
    scene.add(new THREE.HemisphereLight(0x2c2429, 0x0a0806, 0.35))

    /** 전경의 어깨 — 형사(=플레이어)의 것. 화면 아래를 검게 먹어 "내가 그 방에 있다" 를 만든다. */
    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    )
    shoulder.scale.set(1.15, 1.7, 0.7)
    scene.add(shoulder)

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

    /**
     * 인물을 **방의 실제 의자**에 앉힌다.
     *
     * 좌표는 방 GLB 를 블렌더로 열어 좌면 높이(원본 z≈-0.36)의 버텍스를 XY 로 군집화해
     * 뽑았다. 의자는 두 줄이다 — 원본 x≈-0.28 에 4개, x≈0.42 에 2개. 테이블의 긴 축이
     * Y 이므로 두 줄이 테이블을 사이에 두고 마주본다. 용의자는 x≈0.42 쪽에 앉힌다.
     *
     * **축 변환**: 블렌더는 Z-up, three.js 는 Y-up 이다. glTF 의 (x,y,z) 는
     * 블렌더에서 (x, -z, y) 로 들어온다. 그래서 블렌더 (x, y) → three (x, ·, -y).
     * 여기에 방 배율 1.9 를 곱한다.
     */
    const SEAT = new THREE.Vector3(0.42 * ROOM_SCALE, 0, 0.03 * ROOM_SCALE)
    /** 용의자는 -X 쪽(맞은편 의자)을 본다. 카메라도 그 방향에서 들어온다. */
    const FACE_YAW = -Math.PI / 2
    const LAMP = new THREE.Vector3(-0.2 * ROOM_SCALE, 1.62, 0.02 * ROOM_SCALE)

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
    model.rotation.y = FACE_YAW
    model.updateMatrixWorld(true)
    const box3 = new THREE.Box3().setFromObject(model)
    model.position.x += SEAT.x - (box3.max.x + box3.min.x) / 2
    model.position.z += SEAT.z - (box3.max.z + box3.min.z) / 2

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
     * 카메라는 **맞은편 의자 자리**다 — 인물이 바라보는 방향에서 들어온다.
     * 처음엔 1.5m 였는데 방의 갓등이 바로 머리 위에 걸려 갓이 화면 절반을 덮었다.
     * 물러서고(2.05m) 옆으로 비껴서(측면 0.34m) 등을 화면 위쪽 구석에 남긴다 —
     * 레퍼런스처럼 **보이되 가리지 않게**.
     */
    const DIST = 2.05
    const aim = new THREE.Vector3(face.x, face.y - 0.14, face.z)
    const fwd = new THREE.Vector3(Math.sin(FACE_YAW), 0, Math.cos(FACE_YAW))
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
    camera.position.copy(face)
      .addScaledVector(fwd, DIST)
      .addScaledVector(side, 0.34)
    camera.position.y = face.y + 0.10
    camera.lookAt(aim)
    key.position.copy(LAMP)
    key.target.position.set(face.x, face.y - 0.15, face.z)

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
    /** 삐걱 콜백 — 등이 진폭 최대에 닿는 순간마다 한 번씩 부른다 */
    let creakCb: (() => void) | null = null
    let lastCreak = 0

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      lastFrame = performance.now()
      const t = (lastFrame - t0) / 1000
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
        model.rotation.y = Math.sin(t * 0.35) * 0.04
        model.position.y += Math.sin(t * rate) * 0.0004
      }

      /**
       * **빛이 흔들린다.** 방 에셋의 갓등은 고정 형상이지만, 그 아래 광원을 흔들면
       * 그림자가 벽을 쓸고 얼굴을 훑는다 — 레퍼런스의 핵심이 그것이다.
       * 두 주기를 겹친다: 단일 사인파는 기계처럼 보인다.
       * 압박이 오르면 진폭이 커진다 — 방이 아니라 심문이 거칠어지는 것이다.
       */
      const heat0 = Math.min(1, pressure / 100)
      const swingA = 0.13 + heat0 * 0.12
      const sx = Math.sin(t * 0.62) * swingA + Math.sin(t * 1.37) * swingA * 0.28
      const sz = Math.cos(t * 0.48) * swingA * 0.5
      key.position.set(LAMP.x + Math.sin(sx) * 0.7, LAMP.y, LAMP.z + Math.sin(sz) * 0.7)
      key.target.position.set(face.x + sx * 0.55, face.y - 0.15, face.z)
      const flick = 1 + Math.sin(t * 11.3) * 0.03 + Math.sin(t * 27.7) * 0.015

      // 등이 한쪽 끝에 닿을 때 탁자가 삐걱인다 — 소리와 그림이 같은 박자를 탄다
      if (creakCb && Math.abs(sx) > swingA * 0.94 && t - lastCreak > 3.2) {
        lastCreak = t
        creakCb()
      }

      // 압박이 높으면 조명이 붉게 조여든다 — CSS 분위기 층과 같은 언어
      const heat = Math.min(1, pressure / 100)
      key.color.setRGB(1, 0.886 - heat * 0.22, 0.706 - heat * 0.32)
      key.intensity = (22 + heat * 8) * flick

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
    const applyCam = (): void => {
      const off = base.clone().sub(aim)
      const sph = new THREE.Spherical().setFromVector3(off)
      sph.theta += orbit.yaw
      sph.phi = Math.max(0.55, Math.min(1.48, sph.phi + orbit.pitch))
      sph.radius = off.length() * orbit.dist
      camera.position.copy(aim).add(new THREE.Vector3().setFromSpherical(sph))
      camera.lookAt(aim)
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      orbit.dist = Math.max(0.55, Math.min(1.45, orbit.dist + e.deltaY * 0.0012))
      applyCam()
    }
    let dragging = false
    let px = 0
    let py = 0
    const onDown = (e: PointerEvent): void => {
      dragging = true; px = e.clientX; py = e.clientY
      host.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      // 좌우 ±20°, 상하 ±11° 정도로 묶는다
      orbit.yaw = Math.max(-0.35, Math.min(0.35, orbit.yaw - (e.clientX - px) * 0.004))
      orbit.pitch = Math.max(-0.2, Math.min(0.2, orbit.pitch + (e.clientY - py) * 0.003))
      px = e.clientX; py = e.clientY
      applyCam()
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false
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
