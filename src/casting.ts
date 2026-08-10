/**
 * 캐스팅 룸 — **후보와 재적 배우 전원을 같은 무대에 세우고 같은 클립을 먹여 본다.**
 *
 * dev 전용이다: 외부 후보(수십 MB FBX/GLB)는 ~/Downloads 에서 /@fs/ 로 직접 읽고
 * (vite.config server.fs.allow), casting.html 은 빌드 인풋에 없어 배포에 안 실린다.
 *
 * 무대는 2열이다:
 *   앞줄 — 다운로드 후보 3명 (Joe · 탐정 2종)
 *   뒷줄 — 우리 게임 캐릭터 8종 (assets-src/*.mvrigged.glb, A포즈 원본)
 *
 * 비교 축은 둘이다:
 * ① 눈 — 같은 조명 아래서 화풍·비율·질감
 * ② 기계 — 클립 호환률(본 이름 매칭). Mixamo 리그는 100%, 이름 규약이 다르면
 *    낮게 뜬다 — 그 수치가 곧 리타게팅 노동량이다.
 *
 * ⚠ 우리 8종은 여기서 **다리 축 보정(unrollLegs) 없이** 재생된다 — 게임에서는
 * 보정이 걸리므로, 뒷줄 다리가 뒤틀려 보여도 그건 캐스팅 룸의 한계지 게임의 모습이 아니다.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const DL = '/@fs/Users/teo/Downloads'
// manager 는 A포즈 원본(mvrigged)이 없어 뺐다 — face 레퍼런스로 만든 배역이라 bust 뿐이다
const OUR = ['security', 'investor', 'expartner', 'appraiser', 'secretary', 'housekeeping', 'nephew']

interface Candidate { name: string; url: string; kind: 'fbx' | 'glb'; x: number; z: number; ours?: boolean }
const CANDIDATES: Candidate[] = [
  // 앞줄 — 다운로드 후보 (character_cyberpunk 831MB 는 브라우저가 감당 못 해 제외)
  { name: 'Joe (Mixamo)', url: `${DL}/character/Ch33_nonPBR.fbx`, kind: 'fbx', x: -2.6, z: 1.5 },
  { name: 'character_type_detective', url: `${DL}/character/character_type_detective.glb`, kind: 'glb', x: 0, z: 1.5 },
  { name: 'private_investigator', url: `${DL}/character/private_investigator_detective.glb`, kind: 'glb', x: 2.6, z: 1.5 },
  // 리타게팅 실증본 — retarget.py(접미 번호 정규화) + strip-beta 로 idle 을 구웠다. '내장' 버튼으로 확인
  { name: 'PI (리타게팅됨)', url: '/characters/pi.idle.opt.glb', kind: 'glb', x: 5.2, z: 1.5 },
  // 용의자 후보 4종 (사용자 다운로드) — Female1/3 는 mixamorig 리그, Female2 는 CC_Base(규약 상이), Male1 은 접미 번호형
  { name: 'Male1', url: `${DL}/character/Male1.glb`, kind: 'glb', x: -3.9, z: 4.2 },
  { name: 'Female1', url: `${DL}/character/Female1.glb`, kind: 'glb', x: -1.3, z: 4.2 },
  { name: 'Female2', url: `${DL}/character/Female2.glb`, kind: 'glb', x: 1.3, z: 4.2 },
  { name: 'Female3', url: `${DL}/character/Female3.glb`, kind: 'glb', x: 3.9, z: 4.2 },
  /**
   * **리타게팅 완성본** — 셋째 줄. 이 캐릭터들은 Mixamo 리그가 아니었지만
   * (CC_Base·carla 소문자 규약) 이름이 규칙적이라 `retarget.py` 의 FOREIGN 표로
   * 흡수했다(매핑 23·14개). 여기 뜨는 것은 **착석 클립이 구워진 결과물**이라
   * '내장' 버튼으로 봐야 앉은 자세가 보인다 — 서 있는 것은 idle 쪽이다.
   */
  { name: 'carla ✅sit', url: '/characters/carla.sit.opt.glb', kind: 'glb', x: -5.2, z: 6.6, ours: true },
  { name: 'wong ✅sit', url: '/characters/wong.sit.opt.glb', kind: 'glb', x: -2.6, z: 6.6, ours: true },
  { name: 'alina ✅sit', url: '/characters/alina.sit.opt.glb', kind: 'glb', x: 0, z: 6.6, ours: true },
  { name: 'Female2 ✅sit', url: '/characters/f2.sit.opt.glb', kind: 'glb', x: 2.6, z: 6.6, ours: true },
  { name: 'Male1 ✅sit', url: '/characters/m1.sit.opt.glb', kind: 'glb', x: 5.2, z: 6.6, ours: true },
  { name: 'Female1 ✅sit', url: '/characters/f1.sit.opt.glb', kind: 'glb', x: 7.8, z: 6.6, ours: true },
  { name: 'Female3 ✅sit', url: '/characters/f3.sit.opt.glb', kind: 'glb', x: -7.8, z: 6.6, ours: true },
  // 뒷줄 — 우리 배우들 (프로젝트 파일이라 dev 서버가 그대로 서빙한다)
  ...OUR.map((slug, i): Candidate => ({
    name: slug, url: `/assets-src/${slug}.mvrigged.glb`, kind: 'glb',
    x: (i - (OUR.length - 1) / 2) * 1.7, z: -1.9, ours: true,
  })),
]

/** ~/Downloads/anims/ 의 전 클립 — 새 파일을 받으면 여기 한 줄 추가 (폴더 스캔은 브라우저가 못 한다) */
const CLIPS = [
  '대기|Breathing Idle (2).fbx',
  '걷기|Walking.fbx',
  '달리기|Running.fbx',
  '달리기B|Standard Run.fbx',
  '집기|Taking Item.fbx',
  '코너|Running To Turn.fbx',
  '우회전|Running Right Turn.fbx',
  '반전180|Running Turn 180.fbx',
  '후진|Running Backward.fbx',
  '벽run|Wall Run.fbx',
  '소총대기|Rifle Idle.fbx',
  '소총걷기|Rifle Walk.fbx',
  '소총달리기|Rifle Run.fbx',
  '사격|Firing Rifle.fbx',
  '엎드려재장전|Prone Reloading.fbx',
  '소총사망|Rifle Death.fbx',
].map((s) => { const [key, file] = s.split('|') as [string, string]; return { key, url: `${DL}/anims/${file}` } })

const TARGET_H = 1.75      // 후보를 같은 키로 정규화 — 스케일 차이가 비교를 오염시키면 안 된다

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x14100e)
scene.fog = new THREE.Fog(0x14100e, 12, 26)

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 80)
camera.position.set(0, 3.1, 9.2)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
document.getElementById('stage')!.appendChild(renderer.domElement)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1, -0.2)

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x1c1613, roughness: 0.95 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)
scene.add(new THREE.AmbientLight(0xfff2dd, 0.5))
const sun = new THREE.DirectionalLight(0xffe6bf, 1.1)
sun.position.set(4, 8, 6)
sun.castShadow = true
scene.add(sun)

for (const c of CANDIDATES) {
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(c.ours ? 0.72 : 1.0, c.ours ? 0.72 : 1.0, 0.06, 36),
    new THREE.MeshStandardMaterial({ color: c.ours ? 0x241d18 : 0x2e241d, roughness: 0.8 }),
  )
  disc.position.set(c.x, 0.03, c.z)
  disc.receiveShadow = true
  scene.add(disc)
}
// 앞줄 스포트라이트 — 오디션의 주인공은 후보다
for (const c of CANDIDATES.filter((c) => !c.ours)) {
  const spot = new THREE.SpotLight(0xffe6bf, 55, 15, Math.PI / 7, 0.45, 1.6)
  spot.position.set(c.x, 5.2, c.z + 1.6)
  spot.target.position.set(c.x, 1, c.z)
  spot.castShadow = true
  scene.add(spot, spot.target)
}

/** Mixamo 트랙 이름을 후보 리그에 붙여 본다 — 접두(mixamorig7·mixamorig:)와 접미(_01)를 벗겨 매칭 */
const normKey = (s: string): string =>
  s.toLowerCase().replace(/^mixamorig[:0-9]*/i, '').replace(/_\d+$/, '').replace(/[_\s]/g, '')

function bindClip(clip: THREE.AnimationClip, root: THREE.Object3D): { clip: THREE.AnimationClip; pct: number } {
  const bones = new Map<string, string>()
  root.traverse((o) => {
    const key = normKey(o.name)
    if (!bones.has(key)) bones.set(key, o.name)
  })
  const tracks: THREE.KeyframeTrack[] = []
  const nodesAll = new Set<string>()
  const nodesHit = new Set<string>()
  for (const t of clip.tracks) {
    const [node, prop] = [t.name.slice(0, t.name.lastIndexOf('.')), t.name.slice(t.name.lastIndexOf('.') + 1)]
    nodesAll.add(node)
    const key = normKey(node)
    const real = bones.get(key)
    if (real) {
      nodesHit.add(node)
      const nt = t.clone()
      nt.name = `${real}.${prop}`
      if (/hips/i.test(key) && prop === 'position') continue   // 제자리 재생
      tracks.push(nt)
    }
  }
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), pct: Math.round((nodesHit.size / Math.max(1, nodesAll.size)) * 100) }
}

interface Slot { def: Candidate; root?: THREE.Object3D; mixer?: THREE.AnimationMixer; card: HTMLElement; own: THREE.AnimationClip[] }
const cards = document.querySelector('.cards')!
const slots: Slot[] = CANDIDATES.map((def) => {
  const card = document.createElement('div')
  card.className = `card${def.ours ? ' ours' : ''}`
  card.innerHTML = `<b>${def.name}</b><div class="meta">불러오는 중…</div><div class="compat"></div>`
  cards.appendChild(card)
  return { def, card, own: [] }
})

const fbxLoader = new FBXLoader()
const glbLoader = new GLTFLoader()
  .setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'))   // 게임 opt 파일은 draco 압축
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

function fit(root: THREE.Object3D, x: number, z: number): void {
  const box = new THREE.Box3().setFromObject(root)
  const h = box.max.y - box.min.y
  const s = h > 0.01 ? TARGET_H / h : 1
  root.scale.setScalar(root.scale.x * s)
  const box2 = new THREE.Box3().setFromObject(root)
  root.position.x = x - (box2.min.x + box2.max.x) / 2
  root.position.y -= box2.min.y
  root.position.z = z - (box2.min.z + box2.max.z) / 2
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true } })
}

async function loadCandidate(i: number): Promise<void> {
  const slot = slots[i]!
  const c = slot.def
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
    fit(root, c.x, c.z)
    scene.add(root)
    slot.root = root
    slot.own = own
    slot.mixer = new THREE.AnimationMixer(root)
    let bones = 0
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones += 1 })
    slot.card.querySelector('.meta')!.textContent = `본 ${bones} · 내장 ${own.length}`
  } catch (e) {
    slot.card.querySelector('.meta')!.textContent = `로드 실패 ${String(e).slice(0, 40)}`
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
    el.textContent = `호환 ${pct}%`
    // 리타게팅 완성본(✅)은 자기 클립이 곧 결과물이다 — 외부 클립을 덧씌우면 그 결과를 못 본다
    if (slot.def.name.includes('✅') && slot.own[0]) {
      slot.mixer.clipAction(slot.own[0]).play()
      el.className = 'compat ok'
      el.textContent = `구운 클립: ${slot.own[0].name}`
    } else if (bound.tracks.length) slot.mixer.clipAction(bound).play()
    else if (slot.own[0]) slot.mixer.clipAction(slot.own[0]).play()
  }
}

const bar = document.querySelector('.bar')!
for (const c of CLIPS) {
  const b = document.createElement('button')
  b.textContent = c.key
  b.onclick = () => void playAll(c.key)
  bar.appendChild(b)
}
const ownBtn = document.createElement('button')
ownBtn.textContent = '내장'
ownBtn.onclick = () => {
  document.querySelectorAll('.bar button').forEach((b) => b.classList.toggle('on', b === ownBtn))
  for (const slot of slots) {
    if (!slot.mixer) continue
    slot.mixer.stopAllAction()
    if (slot.own[0]) slot.mixer.clipAction(slot.own[0]).play()
    slot.card.querySelector('.compat')!.textContent = slot.own.length ? `내장: ${slot.own[0]!.name.slice(0, 14)}` : '내장 없음'
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
  // 앞줄 먼저(주인공 후보), 뒷줄은 이어서 — 54MB FBX 가 우리 8종을 막지 않게
  await Promise.all(CANDIDATES.map((_, i) => (CANDIDATES[i]!.ours ? null : loadCandidate(i))))
  await playAll(current)
  await Promise.all(CANDIDATES.map((_, i) => (CANDIDATES[i]!.ours ? loadCandidate(i) : null)))
  await playAll(current)
})()

// dev 디버그 — 콘솔에서 본 이름·클립을 뒤질 수 있게
;(window as unknown as { __casting: unknown }).__casting = { slots, clipCache }
