/**
 * 한국어 조사 선택 — 이름이 매 판 바뀌므로 "이(가)" 같은 회피 표기를 쓰면
 * 화면 전체가 사무 문서처럼 읽힌다. 받침을 보고 골라 붙인다.
 */
const hasFinalConsonant = (word: string): boolean => {
  const ch = word.trim().slice(-1)
  const code = ch.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return false // 한글 음절이 아니면 받침 없음으로 본다
  return (code - 0xac00) % 28 !== 0
}

/** josa('남기훈', '이/가') → '남기훈이' */
export function josa(word: string, pair: string): string {
  const [withFinal, withoutFinal] = pair.split('/') as [string, string]
  return word + (hasFinalConsonant(word) ? withFinal : withoutFinal)
}
