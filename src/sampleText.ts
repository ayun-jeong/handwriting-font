// Default preview text built from what the user has actually written, so the first preview is all handwriting.

const SENTENCES = [
  '그리고 우리는 다시 만나 이야기를 했다.',
  '하지만 정말 원하는 것은 없었다.',
  '주말에 동생과 전화를 했다.',
  '여기서 기다리고 있을게요.',
  '오늘은 하늘이 맑아서 기분이 좋다.',
  '내 손글씨로 만든 글꼴을 써 본다.',
  '바람이 불어서 나뭇잎이 흔들린다.',
  '시간이 지나도 마음은 그대로다.',
  '맛있는 음식을 먹고 산책을 했다.',
  '고맙습니다. 좋은 하루 보내세요.',
  '안녕하세요, 만나서 반갑습니다.',
  '다람쥐 헌 쳇바퀴에 타고파',
  '키스의 고유 조건은 입술끼리 만나야 하고 특별한 기술은 필요치 않다.',
]

const WORDS = (
  '우리 나라 우리나라 이야기 아이 아이들 사이 문제 정부 경제 국가 한국 국어 정말 그리고 그러나 하지만 이제 다시 아주 자주 ' +
  '여자 기자 의사 의자 가수 가게 지구 부모 소리 여기 거기 이것 그것 사과 과자 자기 자리 거리 나무 지도 구조 시장 시대 대화 문화 ' +
  '전화 신문 동생 생일 일기 경우 정도 요구 성장 상대 장소 주인 인사 사장 정리 이상 상자 자동 동시 시인 인기 우주 주제 제주도 ' +
  '사람 시간 생각 마음 사랑 오늘 내일 하늘 바다 바람 구름 나무 꽃 봄 여름 가을 겨울 아침 저녁 친구 가족 학교 공부 선생님 ' +
  '행복 여행 음식 커피 노래 그림 편지 선물 약속 기억 추억 처음 마지막 함께 모두 항상 조금 많이 가장 계속 그냥 정말로 ' +
  '감사합니다 안녕하세요 고맙습니다 미안합니다 축하합니다 사랑해요 보고싶어'
).split(' ')

const PANGRAM = 'The quick brown fox jumps over the lazy dog.'

const isHangul = (c: string) => c >= '가' && c <= '힣'

function coverage(s: string, have: Set<string>): number {
  const chars = [...s].filter((c) => c.trim() && (isHangul(c) || /[A-Za-z0-9]/.test(c)))
  return chars.length ? chars.filter((c) => have.has(c)).length / chars.length : 0
}

export function sampleText(have: Set<string>): string {
  const lines: string[] = []
  const full = SENTENCES.filter((s) => coverage(s, have) === 1)
  lines.push(...full.slice(0, 3))
  if (lines.length < 2) {
    const words = WORDS.filter((w) => [...w].every((c) => have.has(c)))
    for (let i = 0; i < Math.min(words.length, 24); i += 8) lines.push(words.slice(i, i + 8).join(' '))
  }
  if (!lines.length) {
    const best = [...SENTENCES].sort((a, b) => coverage(b, have) - coverage(a, have))[0]
    if (coverage(best, have) > 0) lines.push(best)
  }
  if (coverage(PANGRAM, have) > 0.5) lines.push(PANGRAM)
  if ([...'0123456789'].every((c) => have.has(c))) lines.push('0123456789')
  if (!lines.length) lines.push([...have].slice(0, 40).join(''))
  return lines.join('\n')
}

/** Short sample for the download screen. */
export function shortSample(have: Set<string>): string[] {
  return sampleText(have).split('\n').slice(0, 3)
}
