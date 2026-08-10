/**
 * 소리 — **파일 없이 WebAudio 로 합성한다.**
 *
 * 왜 합성인가: 오디오 파일을 넣으면 번들이 수백 KB 늘고, CDN 을 쓰면 배포 의존이 생긴다.
 * 이 게임에 필요한 건 음악이 아니라 **행동의 확인음** 넷뿐이라 합성으로 충분하다.
 *
 * 이 파일은 `ui/` 에 있다 — `engine/` 은 DOM 도 브라우저 API 도 모른다 (그 경계가 테스트를 지탱한다).
 *
 * 소리의 역할은 장식이 아니라 **판정의 확인**이다:
 *   stamp  인장이 찍혔다 (모순 발견)  — 이 게임에서 가장 중요한 순간
 *   open   자물쇠가 움직였다 (★반응)
 *   deny   아무것도 열리지 않았다 (무반응)
 *   paper  기록을 꺼냈다
 *   solved / filed  사건 해결 / 미제 편철
 */

type Voice = 'stamp' | 'open' | 'deny' | 'paper' | 'solved' | 'filed' | 'creak' | 'doorOpen'
  | 'verdict' | 'type' | 'typebell' | 'page' | 'unlock'
  | 'tick' | 'heartbeat' | 'whistle' | 'snap' | 'pickup'

const KEY = 'nan-alibi:muted'

let ctx: AudioContext | null = null
let muted = ((): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()

export const isMuted = (): boolean => muted

export function setMuted(v: boolean): void {
  muted = v
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    /* 사파리 사생활 보호 모드 등 — 소리는 계속 되게 두고 기억만 포기한다 */
  }
  // 앰비언스는 확인음과 달리 '지금 나고 있는' 소리라 토글이 즉시 먹어야 한다
  if (ambMaster && ctx) {
    ambMaster.gain.cancelScheduledValues(ctx.currentTime)
    ambMaster.gain.setValueAtTime(ambMaster.gain.value, ctx.currentTime)
    ambMaster.gain.linearRampToValueAtTime(v ? 0 : 1, ctx.currentTime + 0.35)
  }
}

/**
 * 브라우저는 사용자 제스처 전에는 소리를 못 내게 막는다.
 * 브리핑의 "수사를 시작한다" 클릭이 그 제스처다 — 거기서 한 번 깨운다.
 */
export function wake(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  buildAmbience()
}

/**
 * 앰비언스 — 수사 내내 깔리는 **비와 방의 숨.**
 *
 * 확인음(아래 play)이 "판정의 통보"라면 앰비언스는 "장소의 존재"다.
 * 이 게임은 소리가 확인음뿐이라 행동 사이가 완전한 정적이었고, 정적은
 * 브라우저 탭을 게임이 아니라 문서로 읽게 만든다. 인트로 카툰이 전부
 * 비 오는 밤이므로 그 비를 게임 화면까지 끌고 들어온다.
 *
 * 원칙: **있는지도 모르게.** 껐을 때에야 없어진 걸 아는 크기가 정답이다.
 * 파일 없이 합성(이 파일의 규칙), Math.random 금지(재현 가능성)도 그대로 탄다.
 */
let ambMaster: GainNode | null = null

function buildAmbience(): void {
  if (!ctx || ambMaster) return
  const t = ctx.currentTime
  const master = ctx.createGain()
  master.gain.setValueAtTime(0, t)
  master.connect(ctx.destination)

  /**
   * 생성 앰비언스(`public/sfx/ambience.opus`)가 있으면 그걸 루프한다 —
   * 확인음과 같은 파일 우선 규칙. HTMLAudio 의 loop 는 이음새에서 딸꾹질하므로
   * AudioBuffer 루프로 돌린다 (양끝 20ms 페이드는 인코딩 때 넣었다).
   */
  const url = SFX_URL.get('ambience')
  if (url) {
    ambMaster = master
    const ac = ctx
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b))
      .then((buf) => {
        const src = ac.createBufferSource()
        src.buffer = buf
        src.loop = true
        const g = ac.createGain()
        g.gain.value = 0.16   // '있는지도 모르게' — 껐을 때에야 없어진 걸 아는 크기
        src.connect(g).connect(master)
        src.start()
        master.gain.linearRampToValueAtTime(muted ? 0 : 1, ac.currentTime + 2.5)
      })
      .catch(() => { /* 디코드 실패 — 소리 없이 간다. 합성으로 되돌리면 코드 경로가 둘이 된다 */ })
    return
  }

  // 공용 잡음 버퍼 4초 — 비와 룸톤이 같은 버퍼를 다른 필터로 나눠 쓴다
  const n = Math.floor(ctx.sampleRate * 4)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  let x = 0x9e3779b9
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5
      d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1
    }
  }

  // 비 — 잡음을 밴드패스로 가늘게. 유리창 밖에서 들리는 굵기다.
  const rain = ctx.createBufferSource()
  rain.buffer = buf; rain.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.6
  const rainG = ctx.createGain()
  rainG.gain.value = 0.02
  rain.connect(bp).connect(rainG).connect(master)
  rain.start()

  // 빗발이 숨쉬듯 굵어졌다 가늘어진다 — 아주 느린 LFO 가 비의 '살아있음'이다
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'; lfo.frequency.value = 0.05
  const lfoAmt = ctx.createGain()
  lfoAmt.gain.value = 0.007
  lfo.connect(lfoAmt).connect(rainG.gain)
  lfo.start()

  // 방의 숨 — 같은 잡음을 반속 재생 + 로우패스로 낮게 깐다 (형광등·보일러의 웅웅거림)
  const hum = ctx.createBufferSource()
  hum.buffer = buf; hum.loop = true; hum.playbackRate.value = 0.5
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = 140
  const humG = ctx.createGain()
  humG.gain.value = 0.012
  hum.connect(lp).connect(humG).connect(master)
  hum.start()

  ambMaster = master
  // 2.5초에 걸쳐 스며든다 — 갑자기 켜지면 '효과'가 되고, 스며들면 '장소'가 된다
  master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 2.5)
}

function tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(ctx.destination)
  o.start(at)
  o.stop(at + dur + 0.02)
}

/** 잡음 한 조각 — 종이·도장 같은 '물건' 소리는 순음으로는 안 난다 */
function noise(at: number, dur: number, gain: number, cutoff: number): void {
  if (!ctx) return
  const n = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  // 결정론적 잡음 — 이 프로젝트는 Math.random() 을 금지한다 (재현 가능성)
  let x = 0x2f6e2b1
  for (let i = 0; i < n; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.setValueAtTime(cutoff, at)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(f).connect(g).connect(ctx.destination)
  src.start(at)
}

/**
 * 생성된 효과음(`public/sfx/<key>.wav`) — **있으면 쓰고, 없으면 아래 합성음이 그대로 돈다.**
 *
 * `import.meta.glob` 이 빌드 타임에 실제 파일만 잡으므로, 폴더가 비어 있으면
 * 이 맵도 비고 코드 경로가 통째로 사라진다. 에셋이 없어도 화면·소리가 안 깨진다는
 * 이 프로젝트의 규칙(인물 사진·3D·인트로와 같은 원칙)을 소리에도 그대로 적용한 것이다.
 */
const FILES = import.meta.glob('/public/sfx/*.{opus,webm,m4a,wav,mp3,ogg}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const SFX_URL = new Map<string, string>()
for (const [path, url] of Object.entries(FILES)) {
  const name = path.split('/').pop()?.replace(/\.\w+$/, '')
  if (name) SFX_URL.set(name, (url as string).replace(/^\/public/, ''))
}

/** 한 번 받은 것은 다시 받지 않는다 — `paper` 는 한 판에 수십 번 난다 */
const cache = new Map<string, HTMLAudioElement>()

/**
 * 파일 재생 음량 — 생성물은 라우드니스가 제각각인데 HTMLAudio 는 기본 1.0 이다.
 * 특히 `type` 은 몇 초에 수십 번 나는 소리라 여기서 눌러 두지 않으면 타자기가
 * 조서를 쓰는 게 아니라 조서를 두드려 부순다.
 */
const FILE_VOL: Partial<Record<Voice, number>> = {
  type: 0.28, typebell: 0.5, page: 0.65, paper: 0.7, unlock: 0.8, verdict: 0.9,
  // 현장 수집 — tick 은 초당 한 번(막판 두 번) 나므로 존재감이 없어야 한다
  tick: 0.22, heartbeat: 0.55, whistle: 0.75, snap: 0.6, pickup: 0.6,
}

function playFile(v: Voice): boolean {
  const url = SFX_URL.get(v)
  if (!url) return false
  let el = cache.get(v)
  if (!el) {
    el = new Audio(url)
    cache.set(v, el)
  }
  el.volume = FILE_VOL[v] ?? 1
  el.currentTime = 0
  // 재생 실패(자동재생 정책 등)는 조용히 넘긴다. 합성음으로 되돌리지는 않는다 —
  // 두 소리가 겹쳐 나는 것이 안 나는 것보다 나쁘다.
  void el.play().catch(() => {})
  return true
}

export function play(v: Voice): void {
  if (muted) return
  if (playFile(v)) return
  wake()
  if (!ctx) return
  const t = ctx.currentTime

  switch (v) {
    case 'stamp':
      // 도장이 종이를 때린다 — 짧고 낮은 충격 + 잉크가 눌리는 잡음
      noise(t, 0.07, 0.5, 1800)
      tone(t, 140, 0.11, 0.32, 'triangle')
      tone(t + 0.005, 70, 0.16, 0.22, 'sine')
      break
    case 'open':
      // 자물쇠가 한 칸 움직인다 — 올라가는 두 음
      tone(t, 523.25, 0.1, 0.16, 'triangle')
      tone(t + 0.085, 783.99, 0.22, 0.15, 'triangle')
      break
    case 'deny':
      // 아무것도 열리지 않았다 — 짧게 내려앉는 한 음. 벌이 아니라 사실의 통보다.
      tone(t, 196, 0.13, 0.14, 'sine')
      break
    case 'paper':
      noise(t, 0.12, 0.22, 3200)
      break
    case 'solved':
      tone(t, 392, 0.5, 0.14, 'sine')
      tone(t + 0.09, 523.25, 0.5, 0.13, 'sine')
      tone(t + 0.18, 659.25, 0.7, 0.12, 'sine')
      break
    case 'creak': {
      /**
       * 탁자가 삐걱인다 — **stick-slip**(붙었다 미끄러졌다) 소리다.
       *
       * 처음엔 41~58Hz 톱니파를 320Hz 밴드패스(Q=7)에 통과시켰다. 통과대역이 기음보다
       * 한참 위라 거의 아무것도 안 나왔다 — 게인도 0.075 로 너무 작았다. 안 들린 게 당연하다.
       *
       * 삐걱임의 정체는 **떨리는 진폭**이다. 나무가 붙었다 미끄러지길 반복하면서
       * 소리가 잘게 끊긴다. 그래서 LFO 로 게인을 흔든다 — 이게 없으면 그냥 낮은 웅웅거림이다.
       */
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(190, t)
      o.frequency.exponentialRampToValueAtTime(96, t + 0.55)

      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.setValueAtTime(760, t)
      f.frequency.exponentialRampToValueAtTime(380, t + 0.55)
      f.Q.setValueAtTime(3.2, t)

      // stick-slip — 게인을 빠르게 떨어 '삐걱' 을 만든다
      const wob = ctx.createOscillator()
      wob.type = 'triangle'
      wob.frequency.setValueAtTime(23, t)
      wob.frequency.linearRampToValueAtTime(13, t + 0.55)
      const wobAmt = ctx.createGain()
      wobAmt.gain.setValueAtTime(0.55, t)

      const env = ctx.createGain()
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(0.42, t + 0.07)
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)

      wob.connect(wobAmt).connect(env.gain)   // 진폭 변조
      o.connect(f).connect(env).connect(ctx.destination)
      o.start(t); wob.start(t)
      o.stop(t + 0.72); wob.stop(t + 0.72)

      noise(t + 0.02, 0.26, 0.12, 1400)
      break
    }
    case 'doorOpen':
      // 문이 열리고 방이 드러난다 — 금속 걸쇠 + 긴 여운
      noise(t, 0.05, 0.4, 2600)
      tone(t + 0.02, 210, 0.09, 0.13, 'square')
      noise(t + 0.1, 0.45, 0.16, 700)
      tone(t + 0.14, 82, 0.7, 0.1, 'sine')
      break
    case 'filed':
      // 미제 편철 — 서류가 닫힌다
      noise(t, 0.18, 0.3, 1200)
      tone(t + 0.04, 130.81, 0.45, 0.13, 'sine')
      break
    case 'verdict':
      // 최종 판정 인장 — stamp 보다 한 체급 무겁게 (낮고 길게 울린다)
      noise(t, 0.09, 0.6, 1400)
      tone(t, 110, 0.18, 0.4, 'triangle')
      tone(t + 0.01, 55, 0.4, 0.3, 'sine')
      break
    case 'type':
      // 타자기 한 타 — 아주 작은 기계식 틱
      noise(t, 0.025, 0.16, 4200)
      tone(t, 1100, 0.02, 0.05, 'square')
      break
    case 'typebell':
      // 줄 끝의 벨 + 캐리지 리턴
      tone(t, 1975, 0.35, 0.1, 'sine')
      tone(t + 0.002, 3951, 0.2, 0.05, 'sine')
      noise(t + 0.28, 0.14, 0.12, 900)
      break
    case 'page':
      // 만화 페이지가 넘어간다 — paper 보다 크고 느린 종이
      noise(t, 0.3, 0.3, 1600)
      noise(t + 0.22, 0.12, 0.2, 2600)
      break
    case 'unlock':
      // 자물쇠가 떨어진다 — 금속 두 번 + 문이 살짝 열림
      tone(t, 620, 0.05, 0.18, 'square')
      tone(t + 0.09, 430, 0.07, 0.16, 'square')
      noise(t + 0.2, 0.3, 0.14, 800)
      break
    case 'tick':
      // 초시계 한 째깍 — 짧고 마른 금속
      noise(t, 0.015, 0.1, 5200)
      tone(t, 2200, 0.02, 0.05, 'square')
      break
    case 'heartbeat':
      // 한 박 (lub-dub) — 가슴 안쪽에서 들리는 낮은 둔음 둘
      tone(t, 55, 0.12, 0.4, 'sine')
      tone(t + 0.18, 48, 0.16, 0.32, 'sine')
      break
    case 'whistle':
      // 호루라기 한 번 — 두 음이 겹쳐 떨리는 금속 피리
      tone(t, 2400, 0.5, 0.2, 'square')
      tone(t + 0.003, 2520, 0.5, 0.16, 'square')
      break
    case 'snap':
      // 폴라로이드 — 셔터 딸깍 + 필름 배출 모터
      noise(t, 0.03, 0.4, 3600)
      tone(t + 0.01, 900, 0.03, 0.1, 'square')
      noise(t + 0.12, 0.4, 0.1, 1500)
      break
    case 'pickup':
      // 증거봉투 — 천 스침 + 비닐 구김 (VARCO 크레딧 소진으로 합성만)
      noise(t, 0.1, 0.15, 2000)
      noise(t + 0.12, 0.18, 0.22, 4500)
      break
  }
}
