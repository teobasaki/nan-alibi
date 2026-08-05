/** 사건 표면 데이터 — 진실 구조와 무관한 "옷". 생성기가 시드로 골라 입힌다. */

export const SURNAMES = ['한', '서', '윤', '조', '임', '오', '강', '문', '배', '신', '권', '류'] as const
export const GIVEN_NAMES = ['도윤', '세아', '지후', '민서', '재현', '유진', '태경', '하늘', '주원', '연우', '시윤', '가온'] as const

/** 직업 — 피해자와의 관계와 짝을 이룬다 */
export const ROLES = [
  { job: '호텔 지배인', relation: '피해자의 오랜 거래 상대' },
  { job: '보안 팀장', relation: '사건 당일 근무자' },
  { job: '피해자의 비서', relation: '가장 가까이서 일한 사람' },
  { job: '보석 감정사', relation: '거래를 중개했다' },
  { job: '투자자', relation: '피해자에게 큰돈을 빌려줬다' },
  { job: '전 동업자', relation: '3년 전 결별했다' },
  { job: '객실 담당', relation: '1204호를 관리했다' },
  { job: '피해자의 조카', relation: '유일한 상속인' },
] as const

export const VICTIMS = [
  { name: '정민호', title: '보석상' },
  { name: '남기훈', title: '경매사' },
  { name: '고은채', title: '갤러리 대표' },
] as const

export const VENUES = [
  { name: '한강 리버뷰 호텔', room: '1204호' },
  { name: '남산 그랜드 호텔', room: '1204호' },
  { name: '을지로 클래식 호텔', room: '1204호' },
] as const

export const CASE_TITLES = [
  '사라진 다이아몬드', '1204호의 20분', '정전 이후', '마지막 거래', '열두 시의 카드키',
] as const
