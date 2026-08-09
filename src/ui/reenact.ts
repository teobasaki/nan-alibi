/**
 * 범행 재현 — **검거로 끝났을 때만 나온다.**
 *
 * ## 왜 영상 한 편이 모든 판에 맞는가
 * 이 게임은 시드마다 사건이 달라진다. 그런데 `METHODS`(config.ts)를 보면
 * **다섯 수단이 전부 카드키 종류다** — 복제·마스터·여벌·분실·임시.
 * 즉 **범행 동작은 모든 시드에서 같다**: 22:20 에 누군가 카드키로 1204호에 들어간다.
 * 달라지는 것은 *어떤 카드였나* 뿐이고, 그건 자막이 진다.
 *
 * 인트로가 쓴 원칙과 같다 — **그림은 범용, 글은 구체적.**
 *
 * ## 얼굴을 보여주지 않는다
 * 실루엣·손·발만 나온다. 그래야 다섯 용의자 누구여도 성립하고,
 * 추리물 문법에도 맞는다. 그리고 **문이 닫힌 뒤는 보여주지 않는다** —
 * 이 게임은 이미 "오답이면 진범을 밝히지 않는다" 는 규율을 갖고 있고 같은 결이다.
 *
 * ## 영상이 없어도 돈다
 * `public/outro/scene/*.mp4` 가 없으면 이 모듈은 **아무것도 하지 않고 null 을 돌려주고**,
 * `outro.ts` 의 기존 정지 컷이 그대로 나온다. 인물 사진·3D·인트로와 같은 원칙이다 —
 * 에셋은 나중에 채워도 화면이 안 깨진다.
 */

import { CRIME_SLOT, SLOT_LABEL, type CaseFile, type SuspectId } from '../types'
import { KEY_LABEL } from '../data/config'
import { play } from './sound'

const FILES = import.meta.glob('/public/outro/scene/*.{mp4,webm}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

/** `0.mp4` … `5.mp4` 순서대로. 번호가 곧 컷 순서다. */
const CLIPS = Object.entries(FILES)
  .map(([p, url]) => ({
    n: Number(p.split('/').pop()?.replace(/\.\w+$/, '') ?? -1),
    url: (url as string).replace(/^\/public/, ''),
  }))
  .filter((c) => Number.isFinite(c.n) && c.n >= 0)
  .sort((a, b) => a.n - b.n)

export const hasReenactment = (): boolean => CLIPS.length > 0

/**
 * 컷마다 얹히는 자막. **구체적인 것은 전부 여기가 진다** —
 * 영상은 어느 사건에도 맞는 여섯 장면이고, 이름·호수·카드 종류만 글로 박힌다.
 */
function captions(c: CaseFile, culprit: SuspectId): string[] {
  const who = c.suspects[culprit]
  const card = KEY_LABEL[c.method] ?? c.method
  return [
    `${SLOT_LABEL[CRIME_SLOT]}. ${c.venue.name} 12층. 복도의 불이 반쯤 나가 있었다.`,
    `${who.job} ${who.name}은 카드키를 꺼냈다.`,
    `${card} — 기록에 남는 줄은 알았을 것이다.`,
    `${c.venue.room}의 문이 열렸다.`,
    '문이 닫혔다. 그 안에서 무슨 일이 있었는지는 기록에 없다.',
    '문이 다시 열렸을 때, 복도는 비어 있었다.',
  ]
}

/** 컷마다 낼 소리 — 기존 합성음을 그대로 쓴다. 신규 사운드 0. */
const VOICE: (Parameters<typeof play>[0] | null)[] =
  [null, 'paper', 'stamp', 'doorOpen', 'filed', 'doorOpen']

/**
 * 재현 영상을 재생한다. 끝나거나 건너뛰면 resolve.
 * 클립이 없으면 **즉시 resolve** 한다 — 호출부는 있는지 없는지 몰라도 된다.
 */
export function playReenactment(c: CaseFile, culprit: SuspectId): Promise<void> {
  if (!CLIPS.length) return Promise.resolve()

  return new Promise((resolve) => {
    const caps = captions(c, culprit)
    const ov = document.createElement('div')
    ov.className = 'intro outro reenact'

    const stage = document.createElement('div')
    stage.className = 'intro-stage'
    const cap = document.createElement('div')
    cap.className = 'intro-cap'
    const bar = document.createElement('div')
    bar.className = 'intro-bar'
    for (let i = 0; i < CLIPS.length; i++) bar.appendChild(document.createElement('i'))

    const skip = document.createElement('button')
    skip.className = 'intro-skip'
    skip.textContent = '건너뛰기 (Esc)'

    ov.append(stage, cap, bar, skip)
    document.body.appendChild(ov)

    let idx = -1
    let done = false
    let el: HTMLVideoElement | null = null

    const finish = (): void => {
      if (done) return
      done = true
      removeEventListener('keydown', onKey)
      el?.pause()
      ov.classList.add('gone')
      setTimeout(() => { ov.remove(); resolve() }, 620)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') finish() }
    addEventListener('keydown', onKey)
    skip.onclick = finish

    const step = (): void => {
      idx += 1
      if (idx >= CLIPS.length) return finish()

      const v = document.createElement('video')
      v.src = CLIPS[idx]!.url
      v.autoplay = true
      v.muted = true          // 자동재생은 무음이어야 브라우저가 허용한다
      v.playsInline = true
      v.className = 'reenact-clip'
      // 한 컷이 끝나면 다음 컷. 영상이 못 열리면 그 컷을 건너뛴다 —
      // 한 파일이 깨져도 재현 전체가 멈추면 안 된다.
      v.onended = step
      v.onerror = step
      stage.replaceChildren(v)
      el = v
      void v.play().catch(step)

      cap.textContent = caps[idx] ?? ''
      cap.classList.remove('on')
      requestAnimationFrame(() => cap.classList.add('on'))

      bar.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= idx))
      const s = VOICE[idx]
      if (s) play(s)
    }
    step()
  })
}
