/**
 * 심문 파이프라인의 현재 단계 — **기다림에 이름을 붙인다.**
 *
 * ## 왜 필요한가
 * 심문을 누르면 화면에 `…` 하나가 떴다. 2초쯤 뒤 대사가 나온다.
 * 그 2초 동안 플레이어는 **무엇을 기다리는지 모른다** — 멈춘 건지, 느린 건지,
 * 내 인터넷이 문제인지. 단계 이름이 보이면 같은 2초가 "진행 중"으로 읽힌다.
 *
 * 참고한 구조: 사내 AllInOne 서버의 상태 칩(STT 대기 → LLM 추론 → TTS 합성 → 전송).
 * 이 게임은 마이크가 없으므로 STT 가 빠지고, 대신 **검증**이 한 칸 들어간다 —
 * 이 프로젝트에서 LLM 출력은 그냥 쓰이지 않고 반드시 검증기를 통과해야 하기 때문이다.
 * 즉 이 칩은 장식이 아니라 **아키텍처를 화면에 드러낸 것**이다.
 *
 * 상태만 소유하고 그리지 않는다 — 그려야 그릴 수 있는 것을 테스트하려면 갈라놔야 한다.
 */

export type Stage =
  | 'idle'
  /** 질문을 보냈고 응답을 기다린다 */
  | 'thinking'
  /** 응답이 왔고 검증기를 통과시키는 중 */
  | 'verifying'
  /** 음성을 합성하는 중 (외부 TTS 를 쓸 때만 보인다) */
  | 'synthesizing'
  /** 말하는 중 */
  | 'speaking'

export const STAGE_LABEL: Record<Stage, string> = {
  idle: '',
  thinking: '진술을 고르는 중',
  verifying: '진술 검증',
  synthesizing: '음성 합성',
  speaking: '진술 중',
}

/** 폴백으로 떨어졌을 때 보일 이름 — 실패를 감추지 않는다 */
export const FALLBACK_LABEL = '응답 실패 — 조사 반환'

type Listener = (s: Stage, detail?: string) => void

let current: Stage = 'idle'
const listeners = new Set<Listener>()

/**
 * 단계별 마지막 소요 시간(ms).
 *
 * **새 계측기를 만들지 않았다** — 단계 기계가 이미 전이 시각을 알고 있으므로
 * 여기서 재는 게 가장 싸고, 화면에 보이는 것과 재는 것이 같은 근원에서 나온다.
 * 대시보드가 "어디서 시간이 갔나" 를 말할 수 있는 근거다.
 */
export type Timings = Partial<Record<Exclude<Stage, 'idle'>, number>>

let timings: Timings = {}
let enteredAt = 0

export const lastTimings = (): Timings => ({ ...timings })

export const stage = (): Stage => current

export function onStage(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * 단계를 옮긴다. 같은 단계로의 재진입은 무시한다 —
 * 재렌더마다 알림이 터지면 칩이 깜빡여 오히려 안 읽힌다.
 */
export function setStage(s: Stage, detail?: string): void {
  if (s === current && !detail) return

  const now = Date.now()
  // 떠나는 단계의 체류 시간을 적는다. idle 에서 나갈 때는 잴 것이 없다.
  if (current !== 'idle' && enteredAt) timings[current] = now - enteredAt
  // 한 심문이 시작되면 지난 판의 숫자를 지운다 — 섞이면 읽는 사람이 속는다
  if (s === 'thinking') timings = {}
  enteredAt = s === 'idle' ? 0 : now

  current = s
  for (const fn of listeners) fn(s, detail)
}

/** 어떤 경로로 끝나든 idle 로 돌아와야 한다 — 칩이 켜진 채 남으면 거짓말이 된다 */
export function resetStage(): void {
  setStage('idle')
}
