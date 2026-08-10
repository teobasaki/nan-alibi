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
  | 'verdict' | 'type' | 'typebell' | 'page' | 'unlock' | 'ambience'
  | 'tick' | 'heartbeat' | 'whistle' | 'snap' | 'pickup' | 'curtain'

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
  {
    key: 'verdict',
    moment: '결과 시트에 "사건 해결"/"미제" 인장이 내리찍힐 때',
    meaning: 'stamp(격자 인장)보다 한 체급 무거운, 한 판의 최종 판정',
    prompt:
      'A large heavy brass seal stamp slammed down once onto a document on a thick ' +
      'wooden desk. Deep wooden boom, paper crush, a faint metal ring after the hit. ' +
      'Single hit, dry 1960s office, close-miked. No music, no electronic tone.',
    seconds: 1.4,
  },
  {
    key: 'type',
    moment: '심문 응답이 한 글자씩 찍힐 때 (조서 타자기)',
    meaning: '조서가 지금 작성되고 있다. 몇 초에 수십 번 나므로 존재감이 없어야 한다',
    prompt:
      'One single soft manual typewriter key strike on paper. Very short muffled ' +
      'mechanical tap, no carriage noise, no bell, extremely close and quiet. No music.',
    seconds: 0.3,
  },
  {
    key: 'typebell',
    moment: '심문 응답 타이핑이 끝났을 때',
    meaning: '한 진술이 조서에 박제됐다 — 줄 끝의 벨과 캐리지 리턴',
    prompt:
      'A manual typewriter line-end: small bell ding then the carriage return slide ' +
      'and stop. Bright but quiet bell, short mechanical slide, dry room. No music.',
    seconds: 1,
  },
  {
    key: 'page',
    moment: '발단 카툰의 페이지가 넘어갈 때',
    meaning: '감정 단락이 넘어간다 — paper(기록 한 장)보다 크고 무거운 종이',
    prompt:
      'A large stiff comic-book page turning once: heavy paper flex, a wide sweep of ' +
      'air, and the page settling. Single page, close, dry, no hand noise. No music.',
    seconds: 0.9,
  },
  {
    key: 'unlock',
    moment: '잠긴 기록(결정적 증거 사슬)이 조건을 채워 풀릴 때',
    meaning: 'open(증언 개방)보다 결정적인 순간 — 자물쇠가 실제로 떨어진다',
    prompt:
      'An old padlock shackle popping open and a thin chain slipping off a metal ' +
      'cabinet handle, then the small door easing ajar. Metallic, close, dry. No music.',
    seconds: 1.3,
  },
  {
    key: 'ambience',
    moment: '수사 내내 (루프)',
    meaning: '장소의 존재 — 유리창 밖의 비와 방의 웅웅거림. 있는지도 모르게',
    prompt:
      'Seamless loop of steady moderate rain heard from inside a quiet 1960s office ' +
      'at night: soft rain wash against a window, very low room rumble, no thunder, ' +
      'no distinct droplets, no events, perfectly steady texture for looping. No music.',
    seconds: 4.5,
  },
  {
    key: 'tick',
    moment: '현장 수집 30초 카운트다운 (1Hz, 막판 2Hz)',
    meaning: '시간이 실재한다. 초당 한 번 나므로 아주 작아야 한다',
    prompt:
      'One single tick of a mechanical stopwatch, dry sharp metallic click, ' +
      'extremely short and quiet, close-miked, no ringing, no room tone. No music.',
    seconds: 0.25,
  },
  {
    key: 'heartbeat',
    moment: '현장 수집 마지막 5초',
    meaning: '몸이 먼저 아는 마감 — 한 박(lub-dub), 루프로 반복된다',
    prompt:
      'A single human heartbeat, one lub-dub thump, low and muffled as heard from ' +
      'inside the chest, deep soft thud pair, short, no room tone. No music, no voice.',
    seconds: 0.8,
  },
  {
    key: 'whistle',
    moment: '30초 종료 — 감식반 철수',
    meaning: '수집 챕터의 마침표. 한 번, 단호하게',
    prompt:
      'One short sharp blast of a metal police whistle, single burst about half a ' +
      'second, slight outdoor air, decisive stop, no echo tail, no crowd. No music.',
    seconds: 1.2,
  },
  {
    key: 'snap',
    moment: '증거를 수거해 가방(폴라로이드)에 꽂힐 때',
    meaning: '증거가 기록으로 박제됐다 — 카메라 셔터와 필름 배출',
    prompt:
      'A vintage instant camera taking one photo: mechanical shutter clack then the ' +
      'short motorized whir of film ejecting, close, dry, brief. No music, no voice.',
    seconds: 1,
  },
  {
    key: 'pickup',
    moment: '증거품에 손을 대는 순간 (snap 직전)',
    meaning: '물건을 집었다 — 장갑 낀 손과 비닐 증거봉투',
    prompt:
      'A gloved hand picking up a small object and slipping it into a plastic ' +
      'evidence bag: brief cloth rustle and one crisp plastic bag crinkle. Close, ' +
      'dry, quick. No music, no voice.',
    seconds: 0.8,
  },
  {
    key: 'curtain',
    moment: '막 전환 — 커튼이 닫히거나 열릴 때 (연극 3막 구조)',
    meaning: '한 막이 끝나고 다음 막이 시작된다. 무겁고 부드러운 천',
    prompt:
      'A heavy velvet theater curtain sweeping closed: deep soft fabric whoosh ' +
      'with a low cloth rumble, about one second, ending with a gentle settle. ' +
      'No rings jingling, no squeaks. No music, no voice, no ambience.',
    seconds: 1.2,
  },
]

export const specOf = (k: SfxKey): SfxSpec | undefined => SFX.find((s) => s.key === k)
