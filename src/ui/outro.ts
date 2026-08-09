/**
 * 엔딩 — 검거, 또는 미제.
 *
 * ## 왜 인트로와 같은 문법인가
 * 오프닝이 "웹툰처럼 넘어가는 자막 패널" 이었다면 엔딩도 같아야 한다.
 * 다른 문법으로 끝내면 두 개의 게임처럼 읽힌다. 같은 활자, 같은 넘김, 같은 검정.
 * 다만 **방향이 반대다** — 인트로는 어둠에서 사건으로 들어가고,
 * 엔딩은 사건에서 어둠으로 빠져나온다.
 *
 * ## 그림이 없어도 돈다
 * `public/outro/0.webp` … 가 없으면 색면 + 큰 활자로 폴백한다.
 * 인트로·인물 사진·3D 와 같은 원칙이다 — 에셋은 나중에 채워도 화면이 안 깨진다.
 *
 * ## 맞혔을 때와 틀렸을 때는 다른 이야기다
 * 같은 패널에 문장만 바꾸면 "졌는데 이긴 것처럼" 읽힌다.
 * 검거는 붉은 인장과 문 닫히는 소리로, 미제는 서류가 덮이는 소리로 끝난다.
 */

import { buildComicPage, type ComicPanel } from './comicPage'
import { play } from './sound'
import { josa } from '../josa'
import type { CaseFile, SuspectId } from '../types'

const FILES = import.meta.glob('/public/outro/*.{webp,png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const PANEL_URL = new Map<string, string>()
for (const [path, url] of Object.entries(FILES)) {
  const name = path.split('/').pop()?.replace(/\.\w+$/, '')
  if (name) PANEL_URL.set(name, (url as string).replace(/^\/public/, ''))
}

/**
 * 페이지 배치는 결말마다 다르다 — 검거는 네 칸이 좁혀 들어가고,
 * 미제는 세 칸이 넓게 비어 간다. 같은 페이지 문법(`comicPage.ts`) 위에서.
 */
function panels(c: CaseFile, culprit: SuspectId, correct: boolean): ComicPanel[] {
  const who = c.suspects[culprit]
  if (!correct) {
    /**
     * 미제 전용 그림은 `m0`~`m2` 다. 없으면 검거 그림(0~2)으로 폴백한다 —
     * 수갑 그림 위에 "사건은 미제로 편철됐다" 가 얹히는 건 틀린 그림이지만,
     * 빈 칸보다는 낫다. 전용 그림이 오면 저절로 갈아탄다.
     */
    const g = (m: string, f: string): string | undefined => PANEL_URL.get(m) ?? PANEL_URL.get(f)
    return [
      { area: 'p0', img: g('m0', '0'), key: '남았다', corner: 'tl', tilt: 0.8,
        line: '조서에 서명이 없었다.', voice: 'creak' },
      { area: 'p1', img: g('m1', '1'), key: '미제', corner: 'bl', tilt: -0.7,
        line: '사건은 미제로 편철됐다. 다섯은 각자의 밤으로 돌아갔다.' },
      { area: 'p2', img: g('m2', '2'), key: '그중 하나', corner: 'br', tilt: 0.6, bam: '…',
        line: '그중 하나는 오늘도 잠을 잘 잘 것이다.', voice: 'filed' },
    ]
  }
  return [
    { area: 'p0', img: PANEL_URL.get('0'), key: '무너졌다', corner: 'tl', tilt: -0.9,
      line: `${josa(who.name, '은/는')} 더 말하지 않았다.`, voice: 'creak' },
    { area: 'p1', img: PANEL_URL.get('1'), key: '수갑', corner: 'tr', tilt: 1.0, bam: '철컥',
      line: '손목에 금속이 닿는 소리가 방을 채웠다.', voice: 'stamp' },
    { area: 'p2', img: PANEL_URL.get('2'), key: '복도', corner: 'bl', tilt: -0.6,
      line: `${who.job} ${josa(who.name, '이/가')} 복도로 끌려 나갔다. 등 뒤에서 문이 닫혔다.`, voice: 'doorOpen' },
    { area: 'p3', img: PANEL_URL.get('3'), key: '끝', corner: 'br', tilt: 0.5,
      line: `${c.venue.name} 1204호의 불이 꺼졌다.` },
  ]
}

/** 인트로와 같은 타이밍 — 같은 호흡이어야 한 편으로 읽힌다 */
const HOLD = 2600
const FADE = 620

export function playOutro(c: CaseFile, culprit: SuspectId, correct: boolean): Promise<void> {
  return new Promise((resolve) => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const list = panels(c, culprit, correct)
    const ov = document.createElement('div')
    ov.className = 'intro outro comic'

    const page = correct
      ? buildComicPage(list, ['p0 p1', 'p2 p2', 'p3 p3'], '38% 34% 28%')
      : buildComicPage(list, ['p0 p0', 'p1 p2'], '48% 52%')

    const bar = document.createElement('div')
    bar.className = 'intro-bar'
    for (let i = 0; i < list.length; i++) bar.appendChild(document.createElement('i'))

    const skip = document.createElement('button')
    skip.className = 'intro-skip'
    skip.textContent = '건너뛰기 (Esc)'

    ov.append(page.el, bar, skip)
    document.body.appendChild(ov)

    let idx = -1
    let timer = 0
    let done = false

    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      removeEventListener('keydown', onKey)
      ov.classList.add('gone')
      setTimeout(() => { ov.remove(); resolve() }, FADE)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') finish() }
    addEventListener('keydown', onKey)
    skip.onclick = finish

    const step = (): void => {
      idx += 1
      if (idx >= list.length) {
        // 완성된 페이지를 한 박자 — 결말을 눈에 담는 시간이다
        timer = window.setTimeout(finish, still ? 400 : 1400)
        return
      }
      const p = list[idx]!
      page.reveal(idx)
      bar.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= idx))
      if (p.voice) play(p.voice as Parameters<typeof play>[0])
      timer = window.setTimeout(step, still ? 800 : HOLD)
    }
    step()
  })
}
