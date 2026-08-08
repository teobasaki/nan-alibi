/**
 * 효과음 명세 — **소리보다 먼저 무엇을 위한 소리인지 적는다.**
 *
 * ## 왜 명세가 코드에 있나
 * 생성형 오디오는 프롬프트가 곧 에셋이다. 프롬프트가 대화 기록에만 있으면
 * 같은 소리를 다시 만들 수 없고, 왜 그 소리인지도 남지 않는다.
 * **여기 적으면 재생성이 재현 가능해지고, 심사 문서가 인용할 근거가 된다.**
 *
 * ## 이 게임의 소리 규칙
 * 무대는 22:20, 불이 반쯤 꺼진 호텔 12층 취조실이다. 소리도 거기서 나온다 —
 * 금속·종이·나무·형광등. 전자음은 쓰지 않는다. 이 게임엔 컴퓨터가 없다.
 *
 * 그리고 **소리는 정보를 실어야 한다.** 인장 소리는 모순이 확정됐다는 뜻이고,
 * 거절음은 이 조합이 아니라는 뜻이다. 장식으로 나는 소리는 넣지 않는다.
 */

/** `sound.ts` 의 합성 효과음과 같은 키를 쓴다 — 생성 실패 시 그대로 폴백된다 */
export type SfxKey =
  | 'stamp' | 'open' | 'deny' | 'paper' | 'solved' | 'creak' | 'doorOpen' | 'filed'

export interface SfxSpec {
  key: SfxKey
  /** 게임의 어느 순간에 나는가 — 이게 프롬프트보다 먼저다 */
  moment: string
  /** 이 소리가 실어 나르는 정보 */
  meaning: string
  /** varco 에 넘길 영문 프롬프트 */
  prompt: string
  /** 초 단위. 짧을수록 좋다 — 행동에 붙는 소리는 길면 다음 행동을 막는다 */
  seconds: number
}

export const SFX: readonly SfxSpec[] = [
  {
    key: 'stamp',
    moment: '모순이 확정돼 알리바이 격자에 붉은 인장이 찍힐 때',
    meaning: '되돌릴 수 없는 판정. 이 게임에서 가장 무거운 소리여야 한다',
    prompt:
      'A single heavy rubber stamp striking a stack of paper on a wooden desk. ' +
      'Sharp wooden thud with a brief paper crush, slight desk resonance, no reverb tail. ' +
      'Dry close-miked 1960s office. No music, no electronic tone.',
    seconds: 1,
  },
  {
    key: 'open',
    moment: '증거 제시가 새 증언을 열었을 때',
    meaning: '잠긴 것이 열렸다. 보상이지만 승리는 아니다 — 과하면 안 된다',
    prompt:
      'A small brass filing-cabinet lock turning and a drawer sliding open one inch. ' +
      'Metallic click, then a short wooden slide. Close, dry, no music.',
    seconds: 1.2,
  },
  {
    key: 'deny',
    moment: '연결했으나 모순이 아니거나, 제시가 아무것도 열지 못했을 때',
    meaning: '틀린 게 아니라 이 조합이 아니라는 뜻. 벌처럼 들리면 안 된다',
    prompt:
      'A file folder closing softly on a desk. Muted paper flap, no click, no impact. ' +
      'Quiet, close, slightly damped. No music.',
    seconds: 0.7,
  },
  {
    key: 'paper',
    moment: '기록을 조회하거나 화면을 넘길 때',
    meaning: '가장 자주 나는 소리다. 존재감이 있으면 안 된다',
    prompt:
      'One sheet of thin document paper turning over. Short dry rustle, no hand noise, ' +
      'no room tone, no music. Very close, very brief.',
    seconds: 0.5,
  },
  {
    key: 'creak',
    moment: '취조실 테이블·전등이 흔들릴 때 (3D 씬 배경)',
    meaning: '방이 살아 있다는 신호. 반복되므로 거슬리면 안 된다',
    prompt:
      'A single slow creak of an old wooden chair under shifting weight, in a small ' +
      'concrete room. Low, dry, faint room tone. No music, no voice.',
    seconds: 1.8,
  },
  {
    key: 'doorOpen',
    moment: '심문이 시작되며 취조실이 열릴 때',
    meaning: '장면 전환. 이 소리 뒤에는 사람이 앉아 있다',
    prompt:
      'A heavy steel door unlatching and swinging open into a concrete corridor. ' +
      'Metal latch, low hinge groan, brief hall reverb. No footsteps, no music.',
    seconds: 2.2,
  },
  {
    key: 'filed',
    moment: '미제로 끝났을 때 (엔딩)',
    meaning: '끝났지만 해결되지 않았다. 결말이되 보상이 아니다',
    prompt:
      'A thick case file dropped onto a metal cabinet shelf and the drawer pushed shut. ' +
      'Paper weight, metal slide, final clunk. Cold, empty room. No music.',
    seconds: 2.5,
  },
  {
    key: 'solved',
    moment: '범인을 맞히고 검거로 끝났을 때 (엔딩)',
    meaning: '이 게임의 유일한 보상음. 그러나 축하가 아니라 종결이다',
    prompt:
      'Handcuffs closing once, then a heavy door shutting at the end of a corridor. ' +
      'Metal ratchet, distant door, long empty silence after. No music, no fanfare.',
    seconds: 3,
  },
]

export const specOf = (k: SfxKey): SfxSpec | undefined => SFX.find((s) => s.key === k)
