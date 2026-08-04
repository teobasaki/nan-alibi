/**
 * 페르소나 카드 — llm-persona-game 스킬 §4 "목소리 카드 4요소" 를 그대로 채운 것.
 *
 * 4요소가 하나라도 비면 그 인물은 다른 인물과 섞인다.
 * 특히 **pressureResponse 가 진짜 차별점이다** — 나머지 셋은 장식이고,
 * 이것만이 플레이어의 전략을 바꾼다:
 *   "이 사람은 몰아붙이면 입을 닫으니 증거부터 보여줘야 한다" 는 판단이 생기는 순간
 *   페르소나가 대사 장식이 아니라 게임 메커닉이 된다.
 */

export interface Persona {
  id: string
  label: string
  /** 문장 길이 성향 */
  sentence: string
  /** 버릇 — 반복되는 말투 습관 */
  tic: string
  /** 회피어 — 절대 입에 안 올리는 것 (대개 그 인물의 비밀과 붙어 있다) */
  avoidance: string
  /** 압박 반응 — 전략을 바꾸는 유일한 요소 */
  pressureResponse: string
  /** 플레이어에게 힌트로 노출되는 한 줄 (UI 표시용) */
  hint: string
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'authoritative',
    label: '권위적',
    sentence: '길고 단정적으로. 문장을 끝까지 맺는다.',
    tic: '상대의 자격을 되묻는다 ("그걸 왜 나한테 묻습니까?")',
    avoidance: '자신의 실수나 판단 착오를 절대 인정하지 않는다',
    pressureResponse: '직접 추궁하면 반발하며 입을 닫는다. 체면을 세워주면 오히려 길게 말한다.',
    hint: '체면을 세워주며 물어야 열린다',
  },
  {
    id: 'timid',
    label: '겁이 많음',
    sentence: '짧게 끊어진다. 말끝을 흐린다.',
    tic: '문장 중간에 "저기…", "그러니까…" 를 넣는다',
    avoidance: '단정적인 표현을 쓰지 않는다 ("확실히", "분명히" 를 피한다)',
    pressureResponse: '압박하면 말이 꼬이고 진술이 흔들린다. 안심시키면 정확해진다.',
    hint: '안심시켜야 진술이 정확해진다',
  },
  {
    id: 'calculating',
    label: '계산적',
    sentence: '짧고 정확하다. 필요한 말만 한다.',
    tic: '되묻지 않고 사실만 확인한다 ("그게 기록에 있습니까?")',
    avoidance: '추측이나 감정 표현을 하지 않는다',
    pressureResponse: '증거 없는 추궁은 무시한다. 물증을 보여줘야 태도가 바뀐다.',
    hint: '물증을 먼저 제시해야 인정한다',
  },
  {
    id: 'emotional',
    label: '감정적',
    sentence: '길어졌다 짧아졌다 한다. 감탄사가 섞인다.',
    tic: '다른 사람 이름을 반복해서 부른다',
    avoidance: '피해자 이야기를 담담하게 못 한다 — 화제를 돌린다',
    pressureResponse: '특정 인물을 언급하면 흥분해서 원래 하려던 말보다 많이 흘린다.',
    hint: '관계를 건드리면 말이 많아진다',
  },
  {
    id: 'loyal',
    label: '충성심이 강함',
    sentence: '중간 길이. 조심스럽게 고른다.',
    tic: '"제가 아는 한" 을 자주 붙인다',
    avoidance: '보호 대상에게 불리한 말을 하지 않는다',
    pressureResponse: '자신을 향한 압박에는 버틴다. 보호 대상에게 불리한 증거를 보면 무너진다.',
    hint: '보호 대상에게 불리한 증거가 열쇠다',
  },
  {
    id: 'egocentric',
    label: '자기중심적',
    sentence: '길다. 자기 이야기로 되돌아온다.',
    tic: '질문과 무관하게 자기가 본 것을 전체 사실처럼 말한다',
    avoidance: '자기가 못 본 것은 없었던 일로 취급한다',
    pressureResponse: '반박하면 더 강하게 주장한다. 다른 시점의 증거를 대면 흔들린다.',
    hint: '다른 시점의 기록과 대조해야 한다',
  },
  {
    id: 'guilty',
    label: '죄책감이 큼',
    sentence: '짧다. 자주 멈춘다.',
    tic: '되묻는 대신 침묵한다',
    avoidance: '핵심 시각을 직접 말하지 않고 주변만 맴돈다',
    pressureResponse: '정면으로 물으면 회피한다. 간접적으로 기억을 유도하면 흘린다.',
    hint: '간접 질문으로 기억을 유도해야 한다',
  },
  {
    id: 'cynical',
    label: '냉소적',
    sentence: '짧고 비꼰다.',
    tic: '질문 자체를 평가한다 ("좋은 질문이네요, 정말로")',
    avoidance: '진심으로 걱정하는 말을 하지 않는다',
    pressureResponse: '압박에 태연하다. 사실관계의 허점을 짚으면 태도가 진지해진다.',
    hint: '허점을 짚으면 진지해진다',
  },
] as const

/**
 * 같은 판에 함께 넣지 않는 조합 — 접근법이 겹쳐 플레이어가 구분할 이유가 사라진다
 * (기획서 §1-1 "역할 중복 금지").
 */
export const PERSONA_CONFLICTS: readonly [string, string][] = [['timid', 'guilty']]

export function personaById(id: string): Persona {
  const p = PERSONAS.find((x) => x.id === id)
  if (!p) throw new Error(`없는 페르소나: ${id}`)
  return p
}
