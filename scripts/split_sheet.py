#!/usr/bin/env python3
"""
4면 시트 → 시점별 파일 4장.

## 왜 시트인가
ChatGPT 에 시점을 4번 따로 요청하면 **매번 다른 사람이 나온다.** 한 장 안에 네 시점을
함께 그리게 하면 같은 인물이 보장되고, 요청도 7×4=28 번이 아니라 7 번으로 준다.
대신 그 한 장을 우리가 잘라야 한다.

## sips 를 버린 이유
macOS 기본 `sips` 의 `--cropOffset` 이 이 이미지에서 아무 파일도 만들지 않았다
(오프셋 0 은 되고 627 은 조용히 실패). 실패를 확인하지 않고 넘어갔더니 시트 전체가
그대로 3D 로 들어가 리깅이 거부했고 30크레딧을 버렸다. PIL 로 바꿨다.

## 인물이 작으면 리깅이 거부한다
잘린 칸은 627px 인데 그 안에서 인물은 더 작다. 자세 추정이 실패하므로
**인물 주변을 찾아 여백을 잘라내고** 1024 로 키운다.

2×2 격자: 좌상=정면, 우상=좌측면, 좌하=우측면, 우하=후면.
사용법: python3 scripts/split_sheet.py <시트.png> <slug>
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

CELLS = [('front', 0, 0), ('left', 1, 0), ('right', 0, 1), ('back', 1, 1)]  # (이름, 열, 행)
TARGET = 1024
MARGIN = 0.06   # 인물 주변에 남길 여백 비율


def trim(img):
    """단색 배경을 찾아 인물 주변만 남긴다. 배경이 균일하지 않으면 원본을 그대로 둔다."""
    bg = Image.new(img.mode, img.size, img.getpixel((2, 2)))
    diff = ImageChops.difference(img, bg).convert('L')
    box = diff.point(lambda p: 255 if p > 18 else 0).getbbox()
    if not box:
        return img
    w, h = img.size
    mx, my = int(w * MARGIN), int(h * MARGIN)
    box = (max(0, box[0] - mx), max(0, box[1] - my),
           min(w, box[2] + mx), min(h, box[3] + my))
    # 너무 많이 잘렸으면(인물 검출 실패로 본다) 원본을 쓴다
    if (box[2] - box[0]) < w * 0.15 or (box[3] - box[1]) < h * 0.15:
        return img
    return img.crop(box)


def main(sheet_path, slug, grid=None, out_dir='public/refs', do_trim=True, count=None):
    """
    grid=None 이면 인물 4면(2×2, 시점 이름). grid='3x2' 면 격자를 지정하고
    파일명은 `<slug>0.png` 부터 번호로 나간다 — 인트로·엔딩 컷에 쓴다.
    """
    sheet = Image.open(sheet_path).convert('RGB')
    W, H = sheet.size
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if grid is None:
        cols, rows, cells = 2, 2, CELLS
    else:
        cols, rows = (int(x) for x in grid.lower().split('x'))
        cells = [(str(i), i % cols, i // cols) for i in range(cols * rows)]
        if count:
            cells = cells[:count]

    cw, ch = W // cols, H // rows
    print(f'\n▶ {sheet_path} ({W}×{H}) → {cols}×{rows} ({cw}×{ch})\n')
    for name, col, row in cells:
        cell = sheet.crop((col * cw, row * ch, col * cw + cw, row * ch + ch))
        if do_trim:
            cell = trim(cell)
        scale = TARGET / max(cell.size)
        if scale > 1:
            cell = cell.resize((round(cell.width * scale), round(cell.height * scale)),
                               Image.LANCZOS)
        sep = '-' if grid is None else ''
        out = out_path / f'{slug}{sep}{name}.png'
        cell.save(out)
        print(f'  {name}: {out} ({cell.width}×{cell.height})')
    print('')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 2:
        raise SystemExit(
            '사용법:\n'
            '  인물 4면 : python3 scripts/split_sheet.py <시트.png> <slug>\n'
            '  컷 시트  : python3 scripts/split_sheet.py <시트.png> "" --grid 3x2 '
            '--out public/intro --no-trim --count 5')
    sheet, slug = a[0], a[1]
    opt = lambda k, d=None: (a[a.index(k) + 1] if k in a else d)
    main(sheet, slug,
         grid=opt('--grid'),
         out_dir=opt('--out', 'public/refs'),
         do_trim='--no-trim' not in a,
         count=int(opt('--count', 0)) or None)
