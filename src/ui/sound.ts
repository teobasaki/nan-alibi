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
const FILES = import.meta.glob('/public/sfx/*.{wav,mp3,ogg}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const SFX_URL = new Map<string, string>()
for (const [path, url] of Object.entries(FILES)) {
  const name = path.split('/').pop()?.replace(/\.\w+$/, '')
  if (name) SFX_URL.set(name, (url as string).replace(/^\/public/, ''))
}

/** 한 번 받은 것은 다시 받지 않는다 — `paper` 는 한 판에 수십 번 난다 */
const cache = new Map<string, HTMLAudioElement>()

function playFile(v: Voice): boolean {
  const url = SFX_URL.get(v)
  if (!url) return false
  let el = cache.get(v)
  if (!el) {
    el = new Audio(url)
    cache.set(v, el)
  }
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
  }
}
