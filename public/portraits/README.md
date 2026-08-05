# 인물 사진 — 넣는 법

`<slug>.webp` (또는 .jpg/.png) 로 저장하면 코드 수정 없이 붙는다.
없는 역할은 자동으로 놋쇠 명패로 되돌아간다 — 8장을 다 채우지 않아도 화면은 안 깨진다.

| slug | 역할 |
|---|---|
| `manager` | 호텔 지배인 |
| `security` | 보안 팀장 |
| `secretary` | 피해자의 비서 |
| `appraiser` | 보석 감정사 |
| `investor` | 투자자 |
| `expartner` | 전 동업자 |
| `housekeeping` | 객실 담당 |
| `nephew` | 피해자의 조카 |

## 규격
- **세로 3:4**, 짧은 변 512px 이상 (표시 크기는 42~60px 이지만 고해상도 화면 대비)
- **webp, 장당 60KB 이하.** 8장이면 500KB 미만 — 60초 시연에서 첫 화면이 늦으면 안 된다
- 배경은 어둡게. 화면이 `#16110f` 위에 얹히므로 밝은 배경은 사각형으로 떠 보인다

## 화면 처리
CSS 가 자동으로 **증거 사진** 처리를 입힌다 — 채도를 죽이고, 대비를 올리고, 입자를 얹고,
모서리에 사건번호를 찍는다. 그래서 원본이 매끈한 스튜디오 사진이어도
조서 서식과 싸우지 않는다. 생성 시 후보정을 미리 넣을 필요 없다.

## 프롬프트 (하이퍼리얼 · 공포)
공통 접미사:
> shot on 35mm, harsh single overhead fluorescent, deep shadows, desaturated,
> slight motion blur, grainy CCTV-adjacent quality, neutral expression looking
> slightly off-camera, dark background, 3:4 vertical portrait, photorealistic

역할별 앞부분 예:
- `security` — Korean hotel security team leader in a dark uniform, late 40s, tired eyes
- `housekeeping` — Korean hotel housekeeping staff, apron, holding a keycard, guarded look
- `investor` — Korean investor in an expensive but rumpled suit, late 50s, unreadable

**얼굴 방향은 정면을 살짝 벗어나게.** 정면 응시는 초상화가 되고, 살짝 빗나간 시선은
"찍힌 사진" 이 된다 — 이 게임이 원하는 건 후자다.
