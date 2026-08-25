# UI 목업 생성 프롬프트 정본

> 용도: ChatGPT 이미지 생성으로 **구현 기준이 될 UI 목업**을 뽑는다.
> 뽑은 그림은 픽셀 정답이 아니라 **레이아웃·색·정보 위계의 기준**이다.
>
> 원칙(효과음 명세와 같다): **생성 프롬프트는 대화 기록이 아니라 저장소에 남긴다.**
> 다시 뽑을 수 있어야 하고, 왜 그 화면인지가 남아야 한다.

## 쓰는 법 — 먼저 읽을 것

1. **한 대화에서 순서대로 뽑는다.** ①번을 먼저 뽑고, 그 대화 안에서 ②번부터는
   프롬프트 앞에 `앞 이미지와 완전히 같은 아트 디렉션·색·타이포로:` 를 붙인다.
   대화를 갈아타면 게임이 아니라 서로 다른 게임 열 개가 나온다.
2. **한글은 깨진다.** 이미지 모델은 한글 자소를 자주 뭉갠다. 그건 정상이고 문제없다 —
   우리는 **글자를 읽으러** 뽑는 게 아니라 **어디에 무엇이 놓이는지**를 보려고 뽑는다.
   깨진 글자는 코드에서 진짜 한글로 들어간다.
3. **16:9 가로**로 뽑는다. 게임이 브라우저 가로 화면이다.
4. 마음에 안 들면 프롬프트를 통째로 다시 쓰지 말고 **한 구역만 지목해 고친다**:
   "오른쪽 세로 띠만 더 좁고 어둡게, 나머지는 그대로."

## 사건 사실 (모든 프롬프트가 공유한다 — 지어내지 말 것)

| 항목 | 값 |
|---|---|
| 사건 | 「옮겨진 상자의 사각」 |
| 장소 | 라음 사립 갤러리 · 메인 전시홀 |
| 피해자 | 한라온 (관장) |
| 시간대 5칸 | 21:00 · 21:10 · 21:16 · 21:18 · 21:21 |
| 장소 5칸 | 큐레이터 데스크 · 갤러리 밖 · 메인 전시홀 · 반입문 앞 · 반입대 |
| 용의자 5인 | 류나린(41, 전시 운영 책임자) · 배지호(33, 부큐레이터) · 문소라(38, 작품 운송 담당) · 도율(52, 작품 보존 담당) · 김하늘(29, 야간 보안 담당) |
| 기록 종류 | 수정 라벨 기록 · 작업 기록 · 카메라 기록 · 통화 기록 · 현장 판정 |
| 예산 | 질문 10회 · 현장 증거 5개 |

**금칙:** 유혈·신체 손상·흉기 묘사는 어떤 화면에도 넣지 않는다. 시신도 그리지 않는다.
현장은 「사망 위치 표시」와 감식 마커로만 표현한다.

---

## 공통 스타일 접두 (모든 프롬프트 앞에 붙인다)

```
A high-fidelity game UI mockup, viewed straight-on as a flat 16:9 screenshot.
No perspective tilt, no device frame, no hands, no desk photo — just the screen itself.

ART DIRECTION — a Korean detective game set in 1978.
Two visual modes that must never blend:
  · FIELD & INTERROGATION MODE — deep desaturated navy and charcoal, one warm
    tungsten light source, cold cyan-teal for interface accents, amber-orange
    reserved exclusively for "something changed", muted brick red for verdicts.
  · NOTEBOOK MODE — warm cream paper, aged ivory, sepia ink, oxblood leather.
Typography: clean condensed sans for interface labels, small and quiet;
the notebook uses a warmer serif. Interface text is small; the scene breathes.
Flat modern UI shapes — thin 1px borders, subtle fills, no glossy bevels,
no drop shadows on text, no glowing neon, no sci-fi holograms.
Restrained and serious. This is a room at night, not a dashboard.
```

---

# 필수 4종 — 이것부터 뽑는다

## ① 심문 화면 · 평상 상태

> 왜 필요한가: 게임 시간의 절반이 이 화면이다. 여기서 정한 색·간격이 나머지 전부의 기준이 된다.

```
[공통 스타일 접두]

SCREEN: the interrogation room, normal state. Six regions, left to right.

1. LEFT RAIL — 14% width, near-black, separated by a hairline.
   A vertical list of five suspect rows. Each row: a small square portrait chip
   (dim, low-contrast), a Korean name, and a one-line role beneath it in tiny
   gray type. Rows top to bottom: "류나린 / 전시 운영 책임자", "배지호 / 부큐레이터",
   "문소라 / 작품 운송 담당", "도율 / 작품 보존 담당", "김하늘 / 야간 보안 담당".
   The FIRST row is currently selected: a 2px cyan-teal bar on its left edge and a
   slightly lifted background. The third and fifth rows carry a small dim check mark
   meaning already interrogated.

2. CENTER STAGE — about 58% width. A woman in her early forties in a dark charcoal
   blazer, seated across a scuffed metal table, framed from the chest up, turned
   slightly away, hands out of frame. Behind her a single warm desk lamp; the rest
   of the room drops into darkness. She looks composed and tired. Photographic,
   cinematic, shallow depth of field.

3. DIALOGUE — two stacked blocks floating over the lower third of the center stage,
   left-aligned, each with generous inner padding:
   · upper block, muted steel-blue fill, small tag "탐정":
     "21시 16분에 어디 계셨습니까?"
   · lower block, dark translucent charcoal fill, small tag "류나린":
     "그 시간엔 계속 큐레이터 데스크에 있었습니다."

4. ACTION BAR — a full-width row at the very bottom of the center stage, three flat
   buttons side by side with thin cool-gray borders: "질문하기", "기록 제시", "추궁하기".

5. RIGHT RAIL — 12% width, near-black. From the top:
   · a thin line-art closed notebook icon with a tiny blue dot on its corner
   · a counter block: the word "NEW" in cool blue above a large numeral "2"
   · a counter block: the word "CHANGED" in dim gray above a large numeral "0"
   · a small line: "기록 4 · 메모 1"
   · at the bottom, a wide outlined button: "수첩 열기"

6. BOTTOM-RIGHT CORNER — two small quiet counters in thin type, stacked:
   "질문 7/10", "기록 4/5".

The amber-orange accent appears NOWHERE in this image — this is the calm state.
```

## ② 심문 화면 · 진술 번복 (CHANGED)

> 왜 필요한가: 이 게임의 결정적 순간. **주황이 처음 켜지는 프레임**이다.

```
[공통 스타일 접두]

앞 이미지와 완전히 같은 아트 디렉션·레이아웃·인물로. 바뀌는 것은 아래 넷뿐이다.

SCREEN: the same interrogation room, one heartbeat after the suspect's story broke.

1. The suspect's answer block now reads: "…21시 18분에 잠깐 반입문 앞에 나갔습니다."
   The entire line is rendered in warm AMBER-ORANGE, and a thin amber bar runs down
   the left edge of that block. It is the only saturated colour on the screen.

2. The RIGHT RAIL "CHANGED" counter has flipped: the word "CHANGED" is now amber and
   the numeral reads "1", with a soft amber halo behind it.

3. A small amber ribbon tab has sprouted from the right rail, just under the notebook
   icon, reading "기록 갱신" — as if a note were slipped into the notebook's pages.

4. BOTTOM-RIGHT counters now read "질문 6/10", "기록 4/5".

Everything else — the woman, the lamp, the left rail, the action bar — is identical
and unchanged. The eye must land on the amber line first.
```

## ③ 수첩 · 이전 진술 / 현재 진술 비교 펼침면

> 왜 필요한가: 레퍼런스의 BEFORE/CURRENT를 **책 펼침면**으로 옮기는 실험. 이게 성공하면 수첩 전체가 풀린다.

```
[공통 스타일 접두]

SCREEN: NOTEBOOK MODE. A worn oxblood-leather case notebook lies OPEN across the
screen, filling about 88% of it, photographed straight down. Around its edges the
darkened interrogation screen is still faintly visible, dimmed and out of focus —
the notebook is an overlay, not a new place.

The notebook is a two-page spread with a visible centre gutter and stitching.
Cream paper, faint ruled lines, sepia ink, slight age foxing at the corners.
Along the outer right edge, five slim cloth ribbon bookmarks hang at different
depths, each with a tiny label: "개요", "기록", "인물", "대조", "메모".
The "인물" ribbon is pulled forward and brighter than the rest.

LEFT PAGE — headed "이전 진술" in small caps, with a light timestamp "21:04 확보".
Below it, a quoted statement in warm sepia handwriting-like type, two lines:
  "그 시간엔 계속
   큐레이터 데스크에 있었습니다."
Beneath, a small ruled sub-block: "출처 · 심문 중 답변".
The whole left page is very slightly faded, as if written earlier.

RIGHT PAGE — headed "현재 진술" with a timestamp "21:19 확보".
The same layout, but the quoted statement is written in AMBER-ORANGE ink:
  "21시 18분에 잠깐
   반입문 앞에 나갔습니다."
Beneath it a boxed strip with a thin amber border, headed "무엇이 바꿨나":
  "수정 라벨 기록 · 21:18 · 메인 전시홀"

At the bottom of the right page, small and quiet, a single outlined button on the
paper: "심문으로 돌아가 묻기".

The two pages must read as one comparison — the eye goes left, then right, then
down to the evidence that caused it.
```

## ④ 수첩 · 알리바이 격자 펼침면

> 왜 필요한가: **우리만 가진 화면.** 레퍼런스에 없으므로 우리가 직접 그려야 한다. 모순에 인장이 찍힌다.

```
[공통 스타일 접두]

SCREEN: NOTEBOOK MODE, the same open leather notebook, but now the "대조" ribbon is
pulled forward. The two-page spread carries one large hand-ruled table drawn straight
across the centre gutter, as if the detective ruled it himself with a straightedge.

TABLE — five columns and five rows.
· Column headers across the top, small and tight: "21:00", "21:10", "21:16",
  "21:18", "21:21".
· Row labels down the left: "류나린", "배지호", "문소라", "도율", "김하늘".
· Each filled cell holds a short place name in sepia ink: "큐레이터 데스크",
  "메인 전시홀", "반입대", "갤러리 밖", "반입문 앞". Some cells are still blank —
  a faint dotted underline where nothing is known yet.

THE STAMPS — on exactly two cells, a muted brick-red rubber stamp has been struck
across the writing: a rough ring with a short word inside, ink slightly uneven and
bleeding into the paper grain, overlapping the cell border. These mark contradictions.
One stamp sits on the 류나린 × 21:18 cell.

At the top of the left page a small heading: "알리바이 대조" and beneath it in tiny
type: "찍힌 칸은 기록과 어긋난다".
At the bottom of the right page, quiet counters: "모순 2 · 미확인 6".

The table must feel hand-made and physical — ruled by hand on paper, stamped with a
real rubber stamp — not like a spreadsheet.
```

---

# 강력 권장 3종

## ⑤ 용의자 프로필 카드월

> 왜 필요한가: 3막의 문이다. 취조실로 들어가기 전 마지막 화면.

```
[공통 스타일 접두]

SCREEN: FIELD MODE. A police station desk at night, seen from directly above at a
slight downward angle. Five case cards have been dealt across the desk in a loose
fan, slightly overlapping, lit by one warm desk lamp from the upper left; the desk
surface falls into darkness at the edges.

Each card is a stiff manila personnel card with a rounded corner, carrying:
· a small monochrome pencil portrait in the upper area
· a Korean name in bold beneath it
· a one-line role in small gray type
· three tiny stat rows at the bottom, label and value
Cards left to right: "류나린 / 전시 운영 책임자", "배지호 / 부큐레이터",
"문소라 / 작품 운송 담당", "도율 / 작품 보존 담당", "김하늘 / 야간 보안 담당".

The centre card is LIFTED — raised toward the viewer, larger, fully lit, with a soft
shadow cast on the cards beneath it, and a thin cyan-teal outline. On it a small
button strip reads "심문 시작".
Two of the other cards carry a small dim stamp in the corner reading "심문 완료".

Across the very top of the screen, small and quiet: "누구부터 부르시겠습니까".
Bottom right: "질문 10 남음".
```

## ⑥ 2막 · 30초 현장 수집 HUD

> 왜 필요한가: 심사위원이 처음 만지는 화면. 여기서 재미가 결정된다.

```
[공통 스타일 접두]

SCREEN: FIELD MODE, a first-person view inside a private art gallery at night.
A polished concrete floor, white partition walls, a few framed canvases and a
lit sculpture plinth. Cold moonlight from high windows fights one warm security
lamp. Empty and hushed. There is no body and no blood anywhere — on the floor
sits only a small evidence marker cone and a taped floor outline of a rectangle,
clinical and abstract.

HUD ELEMENTS, all thin and unobtrusive:
· TOP CENTRE — a pocket-watch countdown: a circular dial rendered as a thin ring
  with a depleting arc, its remaining sweep in cool white, the consumed part dark.
  In the centre, large but restrained: "12.4". Below it, tiny: "초".
  The last third of the ring is amber, hinting at the panic to come.
· BOTTOM CENTRE — an evidence satchel: five empty slot outlines in a row, rounded
  squares with thin borders. Two are filled with a small monochrome icon of a
  document and a camera; three remain empty dashed outlines.
· MIDDLE RIGHT — a nearby object (a stacked wooden crate) traced with a soft WHITE
  outline glow, with a small floating tag beside it: "작업 기록 · 반입대".
  A tiny key hint below the tag: "[E] 수거".
· TOP LEFT — small and quiet: "라음 사립 갤러리 · 메인 전시홀".

The countdown must be the only thing that feels urgent. Everything else stays calm.
```

## ⑦ 결과 시트

> 왜 필요한가: 마지막에 남는 인상. 3축 채점이 여기서 한 장으로 정리된다.

```
[공통 스타일 접두]

SCREEN: NOTEBOOK MODE pushed to its formal end — a single official case-closing
sheet on heavy cream paper, filling the screen, slightly rotated by one degree,
lying on a dark desk. A paper clip at the top left, a coffee ring stain at the
lower right corner.

CONTENT, top to bottom:
· A ruled header band: "사건 종결 보고" and to its right "라음 사립 갤러리 · 21:16".
· A three-row scoring block, each row a label, a hand-written answer, and a
  small mark at the right edge:
    "범인" — "류나린" — a check
    "동기" — "반입 기록 조작 발각" — a check
    "수단" — "고의적 직접 물리력" — a check
· Beneath, a wide ruled area with three lines of small typed summary text.
· Across the lower right of the sheet, struck at a tilt and overlapping the ruled
  lines, a large muted brick-red rubber stamp: a double ring with "사건 해결"
  inside it, ink uneven and bleeding into the paper grain.
· At the very bottom, two small quiet counters: "질문 8/10 사용", "기록 5/5 확보".

Formal, final, and quiet. No celebration, no confetti, no gold. The stamp is the
only strong mark on the page.
```

---

# 있으면 좋음 3종

## ⑧ 타이틀 · 막이 오르기 전

```
[공통 스타일 접두]

SCREEN: a theatre proscenium seen from the audience. Heavy deep-crimson velvet
curtains hang CLOSED across the frame, their folds catching a single warm
footlight from below; the top of the frame is lost in darkness. Fine dust drifts
in the light beam.

Centred over the curtain, the title in a tall condensed serif, letter-spaced wide,
in aged gold: "다섯 개의 알리바이". Beneath it, small and quiet: "제1막 · 발단".
Below that, a single flat outlined button, restrained: "막을 올린다".

Bottom left corner, tiny: "라음 사립 갤러리 · 1978".
The curtain must look heavy and physical — real velvet with weight, not a graphic.
```

## ⑨ 수첩 · 사건 개요 펼침면

```
[공통 스타일 접두]

SCREEN: NOTEBOOK MODE, the same open leather notebook, the "개요" ribbon pulled forward.

LEFT PAGE — headed "사건 개요". Beneath it a small ruled fact list, label and value
per line: "날짜 — 1978년 5월 17일 (금)", "장소 — 라음 사립 갤러리 · 메인 전시홀",
"피해자 — 한라온 (관장)", "발생 — 21시 16분". Below the list, three lines of
sepia narrative text describing the case in brief. In the outer margin, a small
pencil sketch of the gallery floor plan with an X marking the main hall.

RIGHT PAGE — upper half headed "확보 현황", a compact block of four rows, each with
a label, a fraction, and a thin progress rule drawn in ink:
  "기록 4/5", "진술 12/25", "번복된 진술 1", "내 메모 2".
Lower half headed "최근 갱신", a list of three entries, each a single line with a
small coloured tag at the left, a short sentence, and a faint relative time at the
right:
  amber tag "번복" — "류나린 · 21:18 진술이 뒤집혔다" — "방금"
  blue tag "새 기록" — "김하늘 · 새 진술 확보" — "2분 전"
  blue tag "새 기록" — "수정 라벨 기록 확보" — "9분 전"

The two tag colours must match the interrogation rail exactly: amber for 번복,
cool blue for 새 기록.
```

## ⑩ 막 전환 · 커튼이 닫히는 순간

```
[공통 스타일 접두]

SCREEN: mid-transition. The same deep-crimson velvet curtains are sweeping CLOSED
from both sides, meeting near the centre but not yet touching — a narrow vertical
sliver of the gallery scene still visible between them, cold and blue against the
warm red. Motion blur on the curtain edges as they move.

Centred low, over the closing gap, a single quiet line of text in aged gold:
"제2막 · 현장". Nothing else. No buttons, no HUD.

The contrast between the cold blue sliver and the warm red velvet is the whole image.
```

---

## 다 뽑은 뒤 — 나에게 줄 때

번호와 함께 주면 된다("①번, ③번 다시 뽑았어"). 나는 그림에서 **구역 비율·색 역할·
정보 위계**를 읽어 코드로 옮기고, 글자는 우리 데이터에서 진짜 값으로 채운다.

마음에 드는 게 하나도 없으면 그것도 결과다 — 그때는 레퍼런스를 버리고
지금 화면을 다듬는 쪽이 마감에 안전하다.
