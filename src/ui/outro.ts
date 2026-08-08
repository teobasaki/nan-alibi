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

interface Panel {
  line: string
  key: string
  /** 이 패널에서 낼 소리 */
  voice?: 'stamp' | 'doorOpen' | 'filed' | 'creak'
}

function panels(c: CaseFile, culprit: SuspectId, correct: boolean): Panel[] {
  const who = c.suspects[culprit]
  if (!correct) {
    return [
      { key: '남았다', line: '조서에 서명이 없었다.', voice: 'creak' },
      { key: '미제', line: '사건은 미제로 편철됐다. 다섯은 각자의 밤으로 돌아갔다.' },
      { key: '그중 하나', line: '그중 하나는 오늘도 잠을 잘 잘 것이다.', voice: 'filed' },
    ]
  }
  return [
    { key: '무너졌다', line: `${josa(who.name, '은/는')} 더 말하지 않았다.`, voice: 'creak' },
    { key: '수갑', line: '손목에 금속이 닿는 소리가 방을 채웠다.', voice: 'stamp' },
    { key: '복도', line: `${who.job} ${josa(who.name, '이/가')} 복도로 끌려 나갔다. 등 뒤에서 문이 닫혔다.`, voice: 'doorOpen' },
    { key: '끝', line: `${c.venue.name} 1204호의 불이 꺼졌다.` },
  ]
}

/** 인트로와 같은 타이밍 — 같은 호흡이어야 한 편으로 읽힌다 */
const HOLD = 2600
const FADE = 620

export function playOutro(c: CaseFile, culprit: SuspectId, correct: boolean): Promise<void> {
  return new Promise((resolve) => {
    const list = panels(c, culprit, correct)
    const ov = document.createElement('div')
    ov.className = 'intro outro'

    const stage = document.createElement('div')
    stage.className = 'intro-stage'
    const cap = document.createElement('div')
    cap.className = 'intro-cap'
    const bar = document.createElement('div')
    bar.className = 'intro-bar'
    for (let i = 0; i < list.length; i++) bar.appendChild(document.createElement('i'))

    const skip = document.createElement('button')
    skip.className = 'intro-skip'
    skip.textContent = '건너뛰기 (Esc)'

    ov.append(stage, cap, bar, skip)
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
      if (idx >= list.length) return finish()
      const p = list[idx]!

      const frame = document.createElement('div')
      frame.className = 'intro-frame'
      const url = PANEL_URL.get(String(idx))
      if (url) {
        frame.style.backgroundImage = `url(${url})`
      } else {
        // 그림이 없으면 큰 활자가 그림을 대신한다 — 빈 화면보다 낫다
        frame.classList.add('plate')
        const big = document.createElement('span')
        big.textContent = p.key
        frame.appendChild(big)
      }
      stage.replaceChildren(frame)
      requestAnimationFrame(() => frame.classList.add('on'))

      cap.textContent = p.line
      cap.classList.remove('on')
      requestAnimationFrame(() => cap.classList.add('on'))

      const dots = bar.querySelectorAll('i')
      dots.forEach((d, i) => d.classList.toggle('on', i <= idx))
      if (p.voice) play(p.voice)

      timer = window.setTimeout(step, HOLD)
    }
    step()
  })
}
