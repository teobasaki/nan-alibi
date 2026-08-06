# 인물 레퍼런스 — 넣는 법

## 파일 두 종류

| 파일 | 무엇 | 담당 |
|---|---|---|
| `sheet-<이름>.png` | 2×2 **전신** T포즈 4면 | 실루엣 · 의상 · 비율 |
| `face-<이름>.png` | 2×2 **머리·어깨** 클로즈업 4면 | 이목구비 |

이름: `manager` `secretary` `appraiser` `investor` `expartner` `housekeeping` `nephew` `security`

## 왜 얼굴 시트가 따로 필요한가 (실측)

전신 한 장에서 얼굴은 키의 약 1/7.5 다. 4면 시트를 쪼개면 거기서 또 1/4 이 되어
**얼굴이 실측 84px** 까지 떨어진다. 화면에서는 얼굴이 200px 넘게 나오므로 확대일 뿐이다.

| 소스 | 얼굴 픽셀 |
|---|---|
| 전신 4면 시트를 쪼갠 것 | **84px** |
| 개별 전신 이미지 | 205px |
| **머리·어깨 클로즈업 시트** | **300px 이상** |

전신과 얼굴을 **함께** Meshy 에 넣으면 형상과 이목구비를 둘 다 얻는다.

## 얼굴 시트 프롬프트

해당 인물의 `sheet-<이름>.png` 를 **첨부**하고:

> Use the attached turnaround sheet as the exact character reference. Create image:
> a 2x2 grid of HEAD AND SHOULDERS close-up portraits of the SAME person — identical
> face, identical hair, identical clothing at the collar. In every cell the head fills
> most of the frame, cropped just below the shoulders, sharp facial detail, skin texture
> and pores visible. Same plain light gray seamless background and same flat even studio
> lighting in all four. Layout: TOP-LEFT facing the camera straight on; TOP-RIGHT the
> left side in exact 90 degree profile; BOTTOM-LEFT the right side in exact 90 degree
> profile; BOTTOM-RIGHT the back of the head from directly behind. Neutral expression,
> mouth closed, eyes open looking straight ahead. Photorealistic, no text, no watermark.
> Square image.

## 넣은 뒤

```bash
npm run add:face manager        # 한 명
npm run add:face                # docs/refs/face-*.png 전부
```

분할 → Meshy(전신4+얼굴4) → 리깅 → 착석 → PBR 복원 → 압축까지 자동으로 돈다.
빌드가 끝나면 `npx vite build && npx wrangler pages deploy dist --branch main`.
