/**
 * 캐스팅 룸 — **주인공 후보 3명을 같은 무대에 세우고 같은 클립을 먹여 본다.**
 *
 * dev 전용이다: 후보 파일(수십 MB FBX/GLB)은 ~/Downloads 에서 /@fs/ 로 직접 읽고
 * (vite.config server.fs.allow), casting.html 은 빌드 인풋에 없어 배포에 안 실린다.
 *
 * 비교 축은 둘이다:
 * ① 눈 — 같은 조명 아래서 화풍·비율·질감이 게임과 어울리는가
 * ② 기계 — 우리 Mixamo 클립이 그 리그에 몇 %나 붙는가 (본 이름 매칭률)
 *    Mixamo 캐릭터는 100% 가 정상이고, Sketchfab 리그는 이름 규약이 다르면
 *    카드에 매칭률이 낮게 뜬다 — 그 수치가 곧 "리타게팅 노동의 양"이다.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const DL = '/@fs/Users/teo/Downloads'
/**
 * 후보는 ~/Downloads/character/ 에서 온다. character_cyberpunk(831MB)는
 * 브라우저가 감당 못 하는 크기 + 세계관 밖(SF)이라 명단에서 뺐다.
 */
const CANDIDATES = [
  { name: 'Joe (Mixamo)', url: `${DL}/character/Ch33_nonPBR.fbx`, kind: 'fbx' },
  { name: 'character_type_detective', url: `${DL}/character/character_type_detective.glb`, kind: 'glb' },
  { name: 'private_investigator', url: `${DL}/character/private_investigator_detective.glb`, kind: 'glb' },
] as const

const CLIPS = [
  { key: '대기', url: `${DL}/Breathing Idle (2).fbx` },
  { key: '걷기', url: `${DL}/Walking.fbx` },
  { key: '달리기', url: `${DL}/Running.fbx` },
  { key: '집기', url: `${DL}/Taking Item.fbx` },
  { key: '회전', url: `${DL}/Running To Turn.fbx` },
] as const

const X = [-2.6, 0, 2.6]
const TARGET_H = 1.75      // 후보를 같은 키로 정규화 — 스케일 차이가 비교를 오염시키면 안 된다

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x14100e)
scene.fog = new THREE.Fog(0x14100e, 9, 20)

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 60)
camera.position.set(0, 2.1, 6.4)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
document.getElementById('stage')!.appendChild(renderer.domElement)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1, 0)

// 바닥 + 후보별 원판 + 스포트라이트 — 오디션 무대의 문법
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x1c1613, roughness: 0.95 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)
scene.add(new THREE.AmbientLight(0xfff2dd, 0.35))
for (const x of X) {
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.05, 0.06, 40),
    new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.8 }),
  )
  disc.position.set(x, 0.03, 0)
  disc.receiveShadow = true
  scene.add(disc)
  const spot = new THREE.SpotLight(0xffe6bf, 60, 14, Math.PI / 7, 0.45, 1.6)
  spot.position.set(x, 5.2, 1.6)
  spot.target.position.set(x, 1, 0)
  spot.castShadow = true
  scene.add(spot, spot.target)
}

/** Mixamo 트랙 이름을 후보 리그의 본 이름에 붙여 본다 — 매칭률이 카드에 뜬다 */
function bindClip(clip: THREE.AnimationClip, root: THREE.Object3D): { clip: THREE.AnimationClip; pct: number } {
  const bones = new Map<string, string>()
  root.traverse((o) => {
    const key = o.name.toLowerCase().replace(/^mixamorig[:0-9]*/i, '').replace(/_\d+$/, '').replace(/[_\s]/g, '')
    if (!bones.has(key)) bones.set(key, o.name)
  })
  const tracks: THREE.KeyframeTrack[] = []
  const nodesAll = new Set<string>()
  const nodesHit = new Set<string>()
  for (const t of clip.tracks) {
    const [node, prop] = [t.name.slice(0, t.name.lastIndexOf('.')), t.name.slice(t.name.lastIndexOf('.') + 1)]
    nodesAll.add(node)
    const key = node.toLowerCase().replace(/^mixamorig[:0-9]*/i, '').replace(/_\d+$/, '').replace(/[_\s]/g, '')
    const real = bones.get(key)
    if (real) {
      nodesHit.add(node)
      const nt = t.clone()
      nt.name = `${real}.${prop}`
      // 루트 이동은 제자리 재생 — 무대를 벗어나면 비교가 안 된다
      if (/hips/i.test(key) && prop === 'position') continue
      tracks.push(nt)
    }
  }
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), pct: Math.round((nodesHit.size / Math.max(1, nodesAll.size)) * 100) }
}

interface Slot { name: string; root?: THREE.Object3D; mixer?: THREE.AnimationMixer; card: HTMLElement; own: THREE.AnimationClip[] }
const cards = document.querySelector('.cards')!
const slots: Slot[] = CANDIDATES.map((c) => {
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `<b>${c.name}</b><div class="meta">불러오는 중…</div><div class="compat"></div>`
  cards.appendChild(card)
  return { name: c.name, card, own: [] }
})

const fbxLoader = new FBXLoader()
const glbLoader = new GLTFLoader()
const clipCache = new Map<string, THREE.AnimationClip>()

/** FBX 는 빈 "Take 001" 이 animations[0] 로 오는 경우가 많다 — 트랙이 가장 많은 것이 진짜다 */
const best = (list: THREE.AnimationClip[]): THREE.AnimationClip | null =>
  list.reduce<THREE.AnimationClip | null>((a, b) => (b.tracks.length > (a?.tracks.length ?? 0) ? b : a), null)

async function loadClip(url: string): Promise<THREE.AnimationClip | null> {
  if (clipCache.has(url)) return clipCache.get(url)!
  try {
    const obj = await fbxLoader.loadAsync(url)
    const clip = best(obj.animations ?? [])
    if (clip) clipCache.set(url, clip)
    return clip
  } catch { return null }
}

function fit(root: THREE.Object3D, x: number): void {
  const box = new THREE.Box3().setFromObject(root)
  const h = box.max.y - box.min.y
  const s = h > 0.01 ? TARGET_H / h : 1
  root.scale.setScalar(root.scale.x * s)
  const box2 = new THREE.Box3().setFromObject(root)
  root.position.x = x - (box2.min.x + box2.max.x) / 2
  root.position.y -= box2.min.y
  root.position.z = -(box2.min.z + box2.max.z) / 2
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true } })
}

async function loadCandidate(i: number): Promise<void> {
  const c = CANDIDATES[i]!
  const slot = slots[i]!
  try {
    let root: THREE.Object3D
    let own: THREE.AnimationClip[] = []
    if (c.kind === 'fbx') {
      const obj = await fbxLoader.loadAsync(c.url)
      root = obj; own = (obj.animations ?? []).filter((a) => a.tracks.length > 0)
    } else {
      const g = await glbLoader.loadAsync(c.url)
      root = g.scene; own = (g.animations ?? []).filter((a) => a.tracks.length > 0)
    }
    fit(root, X[i]!)
    scene.add(root)
    slot.root = root
    slot.own = own
    slot.mixer = new THREE.AnimationMixer(root)
    let bones = 0
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones += 1 })
    slot.card.querySelector('.meta')!.textContent =
      `본 ${bones}개 · 내장 클립 ${own.length}개${own.length ? ` (${own.map((a) => a.name).slice(0, 2).join(', ')}…)` : ''}`
  } catch (e) {
    slot.card.querySelector('.meta')!.textContent = `로드 실패 — ${String(e).slice(0, 60)}`
  }
}

let current: string = CLIPS[0]!.key
async function playAll(key: string): Promise<void> {
  current = key
  document.querySelectorAll('.bar button').forEach((b) => b.classList.toggle('on', b.textContent === key))
  const def = CLIPS.find((c) => c.key === key)!
  const clip = await loadClip(def.url)
  for (const slot of slots) {
    if (!slot.root || !slot.mixer) continue
    slot.mixer.stopAllAction()
    if (!clip) { slot.card.querySelector('.compat')!.textContent = '클립 로드 실패'; continue }
    const { clip: bound, pct } = bindClip(clip, slot.root)
    const el = slot.card.querySelector('.compat')!
    el.className = `compat ${pct >= 80 ? 'ok' : pct >= 40 ? 'warn' : 'bad'}`
    el.textContent = `클립 호환 ${pct}% ${pct >= 80 ? '— 무변환 사용 가능' : pct >= 40 ? '— 부분 매칭 (리타게팅 필요)' : '— 리그 상이 (리타게팅 필수)'}`
    if (bound.tracks.length) slot.mixer.clipAction(bound).play()
    else if (slot.own[0]) slot.mixer.clipAction(slot.own[0]).play()   // 최소한 내장 클립이라도
  }
}

const bar = document.querySelector('.bar')!
for (const c of CLIPS) {
  const b = document.createElement('button')
  b.textContent = c.key
  b.onclick = () => void playAll(c.key)
  bar.appendChild(b)
}
// 내장 클립 재생 버튼 — Sketchfab 후보의 자체 애니를 본다
const ownBtn = document.createElement('button')
ownBtn.textContent = '내장'
ownBtn.onclick = () => {
  document.querySelectorAll('.bar button').forEach((b) => b.classList.toggle('on', b === ownBtn))
  for (const slot of slots) {
    if (!slot.mixer) continue
    slot.mixer.stopAllAction()
    if (slot.own[0]) slot.mixer.clipAction(slot.own[0]).play()
    slot.card.querySelector('.compat')!.textContent = slot.own.length ? `내장 클립 재생: ${slot.own[0]!.name}` : '내장 클립 없음'
  }
}
bar.appendChild(ownBtn)

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta()
  for (const slot of slots) slot.mixer?.update(dt)
  controls.update()
  renderer.render(scene, camera)
})
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

void (async () => {
  await Promise.all(CANDIDATES.map((_, i) => loadCandidate(i)))
  await playAll(current)
})()

// dev 디버그 — 콘솔에서 본 이름·클립을 뒤질 수 있게
;(window as unknown as { __casting: unknown }).__casting = { slots, clipCache }
