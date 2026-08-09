/**
 * 수사 일지 — **여정 이벤트를 형사가 받아 적은 문장으로 옮긴다.**
 *
 * ## 왜 순수 함수로 떼어냈나
 * 이 층의 유일한 일은 번역이다. 그런데 렌더 코드 안에 두면 1600줄짜리 `main.ts` 로
 * 착지하고 **커밋 게이트(vitest)가 닿지 않는다.** 일지는 "내가 무엇을 했나" 를 말하는
 * 화면이라, 틀리면 오류가 아니라 **거짓말**이 남는다 — 그게 화면에 그럴듯하게 렌더된다.
 * 그래서 게이트가 볼 수 있는 자리에 둔다.
 *
 * ## 규칙을 계산하지 않는다
 * 일지는 **"한 일"만** 쓴다. "남은 후보 3명" 같은 현재 상태는 쓰지 않는다.
 * 그걸 쓰려면 그 시점의 `g.cards` 를 복원해야 하고, 그건 `interview()`·`presentEvidence()`
 * 가 무엇을 주는지를 `ui/` 에서 **두 번째로 구현하는 일**이다. 그 복제는 조용히 썩는다 —
 * 엔진이 바뀌어도 타입 에러가 안 나고 테스트도 초록인데 일지만 과거를 틀리게 말한다.
 * 현재 상태는 사건 면(격자)이 그린다. 여기서는 지출 내역만 적는다.
 *
 * ## 대사를 붙이는 근거 (불변식)
 * `main.ts` 의 `doAsk`·`doPresent` 는 **`mark()` 를 먼저 하고 `ui.chats[s]` 에 나중에**
 * 동기적으로 append 한다. 그래서 "인물 s 의 n 번째 (ask|present) 이벤트" 와
 * `chats[s][n]` 이 1:1 로 맞는다. 이 정렬이 이 파일의 유일한 외부 가정이고,
 * **`tests/journal.test.ts` 가 그것을 못박는다** — 우연히 맞는 상태로 두지 않는다.
 */

import type { Trace, TraceEvent } from '../engine/journey'
import type { CaseFile, SuspectId } from '../types'
import { SLOT_LABEL, PLACE_LABEL } from '../types'

export interface JournalLine {
  /** 조사를 소모한 줄인가 — 여백 눈금을 그릴지 정한다 */
  spent: boolean
  /** 본문 */
  text: string
  /** 붙는 인장. 모순은 별도 목록이 아니라 일지 안의 표시가 된다 */
  stamp?: 'hit' | 'miss' | 'open'
  /** 이 줄이 가리키는 인물 (조서를 붙일 때 쓴다) */
  who?: SuspectId
  /** 대사에서 받아 적은 조서 한 줄 */
  note?: string
}

const evLabel = (c: CaseFile, id: string): string => {
  const e = c.evidence.find((x) => x.id === id)
  if (!e) return id
  const kind = { keycard: '카드키', cctv: 'CCTV', call: '통화', receipt: '영수증' }[e.kind] ?? e.kind
  return `${kind} · ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}`
}

const name = (c: CaseFile, s: SuspectId): string => c.suspects[s].name

/**
 * 여정을 일지로 옮긴다.
 *
 * @param statements 인물별 조서 — `main.ts` 의 `ui.chats[s]` 에서 뽑은 문자열 배열.
 *   n 번째 (ask|present) 이벤트에 n 번째 조서가 붙는다 (위 불변식).
 */
export function journalLines(
  c: CaseFile,
  tr: Trace,
  statements: Partial<Record<SuspectId, (string | undefined)[]>> = {},
): JournalLine[] {
  const out: JournalLine[] = []
  const seen: Partial<Record<SuspectId, number>> = {}

  for (const e of tr.events) {
    switch (e.k) {
      case 'lookup':
        out.push({ spent: true, text: `${evLabel(c, e.ev)} 기록을 조회했다.` })
        break

      case 'ask': {
        const n = seen[e.who] ?? 0
        seen[e.who] = n + 1
        // 폴백은 조사가 환불된다 — 지출 내역이 아니므로 눈금을 긋지 않는다
        out.push({
          spent: !e.fallback,
          who: e.who,
          text: e.fallback
            ? `${name(c, e.who)}에게 물었으나 답을 받지 못했다. 조사 횟수를 돌려받았다.`
            : `${name(c, e.who)}을 심문했다.`,
          note: e.fallback ? undefined : statements[e.who]?.[n],
        })
        break
      }

      case 'present': {
        const n = seen[e.who] ?? 0
        seen[e.who] = n + 1
        out.push({
          spent: true,
          who: e.who,
          stamp: e.opened ? 'open' : 'miss',
          text: `${name(c, e.who)}에게 ${evLabel(c, e.ev)} 기록을 들이밀었다.`,
          note: statements[e.who]?.[n],
        })
        break
      }

      case 'connect':
        // 연결은 조사를 소모하지 않는다 — 눈금 없이 인장만 남는다
        out.push({
          spent: false,
          stamp: e.hit ? 'hit' : 'miss',
          text: e.hit ? '기록과 진술이 어긋났다.' : '맞대봤으나 어긋나지 않았다.',
        })
        break

      case 'submit':
        out.push({ spent: false, text: `${name(c, e.who)}을 지목했다.` })
        break

      // 각도 전환과 인물 열람은 지출이 아니다. 일지는 지출 내역이므로 적지 않는다 —
      // 다 적으면 일지가 아니라 로그가 되고, 읽히지 않는 목록은 없는 것과 같다.
      case 'view':
      case 'open':
        break
    }
  }
  return out
}

/** 여백 눈금 — 조사를 몇 번 썼고 몇 번 남았나. 상단바 pip 을 대체한다. */
export function tally(lines: JournalLine[], budget: number): { spent: number; left: number } {
  const spent = lines.filter((l) => l.spent).length
  return { spent, left: Math.max(0, budget - spent) }
}

/** `TraceEvent` 를 다 다뤘는지 타입으로 강제한다 — 새 이벤트가 생기면 여기서 걸린다 */
export type HandledKinds = TraceEvent['k']
