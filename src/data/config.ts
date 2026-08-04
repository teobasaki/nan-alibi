/** 밸런스 숫자는 전부 여기 모은다 — 튜닝할 때 코드를 안 뒤지기 위해서 (기획서 §9). */

export const INVESTIGATION_BUDGET = 6

/** 검증기가 요구하는 최소 조사 수 범위 (V5). 3 미만이면 너무 쉽고, 6 이상이면 못 푼다. */
export const MIN_SOLUTION_LOWER = 3
export const MIN_SOLUTION_UPPER = 5

/** 조사 0회 시점에 남아야 하는 최소 후보 수 (V4) */
export const MIN_INITIAL_CANDIDATES = 3

/** 무고한 사람 중 거짓말쟁이 최소 인원 (V6) */
export const MIN_INNOCENT_LIARS = 2

/** 잡음 물증 개수 범위 */
export const NOISE_EVIDENCE_MIN = 1
export const NOISE_EVIDENCE_MAX = 3

export const MOTIVES = [
  '거액의 빚', '해고 통보에 대한 앙심', '가로챈 특허', '오래된 협박',
  '상속 다툼', '불륜 사실의 폭로 위협',
] as const

export const METHODS = [
  '비상용 마스터키를 이용한 침입', '미리 복제해 둔 카드키', '정전 시각에 맞춘 잠입',
  '직원 출입구를 통한 우회', '내부 공범 없이 단독 침입',
] as const

export const SECRETS = [
  '불륜 사실을 숨기려고', '빌린 돈을 숨기려고', '몰래 이직 면접을 봤기 때문에',
  '동료를 감싸려고', '자신의 실수를 덮으려고', '피해자와 다툰 것을 숨기려고',
] as const
