/**
 * 오프닝 — 웹툰처럼 넘어가는 사건 개요.
 *
 * ## 왜 그림은 범용이고 글은 구체적인가
 * 사건은 매 판 시드로 생성된다 — 제목·호텔·피해자·다섯 사람의 이름과 직업이 전부 달라진다.
 * 그림을 사건별로 만들 수는 없다. 그래서 **그림은 어느 사건에도 맞는 다섯 장**(밤의 호텔,
 * 복도, 열린 문, 다섯 그림자, 사건 파일)으로 고정하고, **구체적인 것은 전부 자막이 진다.**
 * 이러면 시드가 바뀌어도 인트로가 거짓말을 하지 않는다.
 *
 * ## 그림이 없어도 돈다
 * `public/intro/0.webp` … `4.webp` 가 없으면 각 패널은 색면+큰 활자로 폴백한다.
 * 인물 사진·3D 와 같은 원칙이다 — 에셋은 나중에 채워도 화면이 깨지지 않는다.
 */

import { CRIME_SLOT, SLOT_LABEL, SUSPECTS, type CaseFile } from '../types'
import { play } from './sound'
import { josa } from '../josa'

const FILES = import.meta.glob('/public/intro/*.{webp,png,jpg}', {
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
  /** 자막 — 사건마다 달라진다 */
  line: string
  /** 색면 폴백에 쓸 강조어 */
  key: string
  /**
   * 그림 위에 박히는 의성어. **만화의 정체성은 여기 있다.**
   * 비용이 0인데(이미 있는 명조와 인장색을 쓴다) 화면의 장르를 바꾼다.
   */
  bam?: string
  /** 칸이 기우는 각도(deg). 웹툰 칸은 반듯하지 않다. */
  tilt?: number
}

function panels(c: CaseFile): Panel[] {
  const five = SUSPECTS.map((s) => c.suspects[s].job).join(' · ')
  return [
    { key: '어젯밤', line: `어젯밤, ${c.venue.name}.`, tilt: -1.4 },
    { key: SLOT_LABEL[CRIME_SLOT], line: `${SLOT_LABEL[CRIME_SLOT]}. 12층 복도의 불이 반쯤 나가 있었다.`,
      bam: '치직', tilt: 1.1 },
    { key: c.venue.room, line: `${c.venue.room}에서 ${c.victim.title} ${josa(c.victim.name, '이/가')} 숨진 채 발견됐다.`,
      bam: '쿵', tilt: -0.9 },
    { key: '다섯', line: `호텔에 남아 있던 다섯 사람 — ${five}.`, tilt: 1.5 },
    { key: '한 명', line: '다섯 모두 그 시간엔 다른 곳에 있었다고 말한다. 그중 한 명이 범인이다.',
      bam: '한 명', tilt: -0.6 },
  ]
}

/**
 * 인트로를 재생한다. 끝나거나 건너뛰면 resolve.
 * 마지막 패널은 흰빛으로 타올라 브리핑으로 넘어간다 — 컷이 아니라 이어짐이다.
 */
export function playIntro(c: CaseFile): Promise<void> {
  return new Promise((resolve) => {
    const list = panels(c)
    const ov = document.createElement('div')
    ov.className = 'intro'

    const stage = document.createElement('div')
    stage.className = 'intro-stage'
    const cap = document.createElement('div')
    cap.className = 'intro-cap'
    const bar = document.createElement('div')
    bar.className = 'intro-bar'
    for (let i = 0; i < list.length; i++) {
      const d = document.createElement('i')
      bar.appendChild(d)
    }

    const skip = document.createElement('button')
    skip.className = 'intro-skip'
    skip.textContent = '건너뛰기 (Esc)'

    const title = document.createElement('div')
    title.className = 'intro-title'
    title.textContent = c.title

    ov.append(stage, cap, title, bar, skip)
    document.body.appendChild(ov)

    let idx = -1
    let timer = 0
    let done = false

    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      removeEventListener('keydown', onKey)
      ov.classList.add('out')     // 흰빛으로 타오르며 브리핑으로 넘어간다
      setTimeout(() => {
        ov.remove()
        resolve()
      }, 700)
    }

    const show = (i: number): void => {
      if (i >= list.length) return finish()
      idx = i
      const p = list[i]!

      const frame = document.createElement('div')
      frame.className = 'intro-frame ink'
      // 칸이 반듯하면 삽화이고, 기울면 만화다. 각도는 패널마다 다르게 준다.
      frame.style.setProperty('--tilt', `${p.tilt ?? 0}deg`)
      const url = PANEL_URL.get(String(i))
      if (url) {
        frame.style.backgroundImage = `url(${url})`
      } else {
        // 그림이 없으면 색면 + 큰 활자. 없다고 화면이 비지는 않는다.
        frame.classList.add('noimg')
        frame.textContent = p.key
      }
      // 의성어 — 그림 위에 박힌다. 잉크가 번진 뒤에 튀어나온다.
      if (p.bam) {
        const bam = document.createElement('span')
        bam.className = 'intro-bam'
        bam.textContent = p.bam
        frame.appendChild(bam)
      }
      stage.appendChild(frame)
      // 이전 컷은 겹쳐서 사라진다 — 넘김이 아니라 포개짐이어야 웹툰처럼 읽힌다
      const prev = stage.children[stage.children.length - 2] as HTMLElement | undefined
      if (prev) {
        prev.classList.add('gone')
        setTimeout(() => prev.remove(), 900)
      }

      cap.textContent = p.line
      cap.classList.remove('on')
      void cap.offsetWidth
      cap.classList.add('on')

      Array.from(bar.children).forEach((d, k) => d.classList.toggle('on', k <= i))
      play('paper')

      timer = window.setTimeout(() => show(i + 1), i === 0 ? 3400 : 3100)
    }

    const next = (): void => {
      clearTimeout(timer)
      show(idx + 1)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next() }
    }
    addEventListener('keydown', onKey)
    ov.onclick = (e) => { if (e.target !== skip) next() }
    skip.onclick = (e) => { e.stopPropagation(); finish() }

    show(0)
  })
}
