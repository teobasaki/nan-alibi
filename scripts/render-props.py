"""
증거 소품의 「정본 기록 뷰」 썸네일을 3D 에셋에서 직접 굽는다 (Blender 헤드리스 · EEVEE).

## 왜 3D 에셋을 직접 굽는가
비주얼 바이블 8A.1 이 이 이미지의 제작 우선순위를 못박았다 — **1순위: 동일 3D Asset 직접 렌더**.
현장에서 본 그 물건을 수첩에서 "아, 아까 그 물건" 하고 알아보게 하는 것이 목적이므로,
따로 그린 아이콘이나 생성 이미지는 같은 물건으로 안 읽힌다.

## 소품 공정성 (7A.7) — 이 스크립트의 핵심 제약
중요한 증거라고 더 크게·더 밝게 잡으면 플레이어에게 "이게 진범 단서다"를 누설한다.
그래서 **모든 소품이 같은 렌즈·같은 조명·같은 프레임 점유율**을 쓴다:

  * 렌즈 고정   — 55mm/36mm 센서. 소품마다 바꾸지 않는다.
  * 조명 고정   — SUN 3등(키·필·림). **카메라 기준 좌표계에 매달아** 놓으므로
                  방위각을 돌려도 물건에 닿는 빛의 상대 각도가 같다.
                  SUN 은 거리 감쇠가 없어 물건 크기와 무관하게 같은 노출이 나온다.
  * 프레임 고정 — 바운딩박스를 카메라 공간에 투영해 **화면 점유율 FILL** 로 자동 정규화.
                  큰 물건도 작은 물건도 같은 비율로 찬다. 여기가 유일한 자동 변수다.

소품별로 허용되는 조정은 **방위각(azimuth)뿐**이다 — 물건이 어느 쪽을 보고 있는지는
에셋마다 다르므로 "정체성이 가장 잘 드러나는 각"으로 돌린다. 고도(elevation)·렌즈·조명은
전 소품 공통이다.

## 배경
`film_transparent` 로 알파를 남긴다. 완전 검정 배경은 금지 — 어두운 물건이 묻힌다.
다만 월드는 투명해도 **셰이딩에는 기여한다**: 금속 재질은 반사할 환경이 없으면 새까맣게
나오므로 중성 회색 월드를 켜 둔다 (이걸 끄면 `keycard`(금속 상자)가 실루엣만 남는다).

## Draco / WebP
배포본 `*.opt.glb` 는 Draco 압축 + EXT_texture_webp 텍스처다.
Blender 5.1 의 glTF 임포터는 **둘 다 그대로 읽는다** (실측 확인). 압축을 풀 필요 없다.

사용:
  blender -b --factory-startup --python scripts/render-props.py -- [소품키 ...]
  (인자가 없으면 PROPS 표 전부를 굽고 manifest 를 쓴다)

각도 찾기(검수 루프) — 표를 안 건드리고 방위각·고도를 흔들어 본다.
매니페스트는 안 쓰고 지정한 폴더에만 떨군다:
  blender -b --factory-startup --python scripts/render-props.py -- \
      --out=/tmp/sweep cctv@0 cctv@60 cctv@120/10

산출:
  public/props/thumbs/<키>.webp (512x512, RGBA)
  public/props/thumbs/manifest.json
"""

import json
import math
import os
import sys
from datetime import datetime, timezone

import bpy
from mathutils import Vector, Matrix

# ── 전 소품 공통 규격 (여기를 소품별로 바꾸면 공정성 위반이다) ──────────────
SIZE = 512
LENS_MM = 55.0
SENSOR_MM = 36.0
#: 물건이 프레임을 차지하는 비율. 1.0 이면 화면 끝에 딱 닿는다 — 여백을 남긴다.
FILL = 0.80
#: 카메라 고도(deg). 3/4 뷰의 "위에서 살짝 내려다보는" 각.
ELEVATION_DEG = 22.0
#: 렌더 샘플 (EEVEE TAA)
SAMPLES = 96

# 조명 세기 — **전 소품 공통**. 여기를 소품별로 손대면 공정성 위반이다.
# 어두운 소품(keycard 금속 상자)이 어두운 카드 배경에 묻히던 문제는
# 그 소품만 밝히는 게 아니라 **월드 앰비언트와 림을 다 같이 올려서** 풀었다.
KEY_ENERGY = 3.4
FILL_ENERGY = 1.3
RIM_ENERGY = 5.0
#: 월드 밝기 — 화면에는 안 보이지만(투명 필름) 그림자 바닥값을 들어올린다.
#: 검은 물건이 새까만 덩어리로 뭉개지지 않게 하는 것이 이 값의 일이다.
WORLD_STRENGTH = 1.45
#: 노출(stop). Khronos PBR Neutral 은 하이라이트를 굴려 주는 대신 중간톤을 내린다 —
#: 그만큼 되올린다. 이 변환은 위쪽이 잘 안 타므로 올려도 흰 소품이 안 뭉갠다.
EXPOSURE = 0.85

# ── 소품 표 ────────────────────────────────────────────────────────────
# azimuth: 카메라 방위각(deg). 0 = 모델 정면(glTF +Z, Blender 에서는 -Y)에서 본다.
#          양수면 시계 반대 방향으로 돈다. 에셋마다 정면이 달라서 이것만 조정한다.
# tilt   : 물건 자체를 세워/눕혀 보여줄 때의 추가 고도(deg). 납작한 물건(서류)은
#          정면에서 보면 선 하나가 되므로 조금 더 위에서 내려다본다.
# note   : 무엇을 찍는지 (검수용)
PROPS = {
    # 방위각은 눈으로 훑어 고른 값이다. cctv 는 표 초기값(35)에서 렌즈가 안 보여
    # 종이비행기처럼 읽혔다 — 120 에서만 렌즈+벽 브래킷이 함께 잡힌다.
    'cctv':     {'azimuth': 120, 'tilt':   5, 'note': '1970s 보안 카메라'},
    'reel':     {'azimuth':  30, 'tilt':  12, 'note': '필름 릴'},
    'call':     {'azimuth':  35, 'tilt':   0, 'note': '앤티크 다이얼 전화기'},
    'receipt':  {'azimuth':  35, 'tilt':  12, 'note': '서류 뭉치'},
    # 왕진 가방에는 날붙이가 꽂혀 있다. 35 에서는 그 날이 가방 앞을 가로질러
    # 제일 먼저 읽혔다 — 정본 §4(유혈·신체·도구 어휘 금지)의 톤과 어긋난다.
    # 320 은 가방 앞면(잠금쇠)과 약병이 앞에 서고 날은 뒤로 물러난다.
    'autopsy':  {'azimuth': 320, 'tilt':   0, 'note': '왕진 가방'},
    'keycard':  {'azimuth':  35, 'tilt':   8, 'note': '금속 상자'},
    'crate':    {'azimuth': 120, 'tilt':   0, 'note': '운송 상자 (증거품 아님 · 지형 소품)'},
}

#: GLB 파일 이름 규칙 — 증거품은 `ev-` 접두사를 쓰고 지형 소품은 안 쓴다.
NO_PREFIX = {'crate', 'fallscene'}

# ── 게임의 증거 종류 ↔ 소품 대응 (읽기 전용 조사 결과) ────────────────────
# src/ui/sceneRules.ts 의 KIND_MODELS, src/data/gc001.ts 의 kindLabels 에서 떴다.
KIND_MODELS = {
    'cctv':    ['cctv', 'reel'],
    'call':    ['call'],
    'receipt': ['receipt'],
    'autopsy': ['autopsy'],
    'keycard': ['keycard'],
}
KIND_LABELS = {
    'keycard': '수정 라벨 기록',
    'receipt': '작업 기록',
    'cctv':    '카메라 기록',
    'call':    '통화 기록',
    'autopsy': '현장 판정',
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPS_DIR = os.path.join(ROOT, 'public', 'props')
OUT_DIR = os.path.join(PROPS_DIR, 'thumbs')


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def glb_path(key):
    name = key if key in NO_PREFIX else 'ev-' + key
    return os.path.join(PROPS_DIR, name + '.opt.glb')


# ── 씬 조립 ────────────────────────────────────────────────────────────

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True          # 알파 배경 — 검정 금지
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.quality = 92
    sc.eevee.taa_render_samples = SAMPLES
    # 색 관리 — `Khronos PBR Neutral` 은 **에셋 썸네일용으로 만들어진** 변환이다.
    # 알베도 색은 그대로 두고 하이라이트만 굴려 준다. 앞서 쓰던 `Standard` 는
    # 밝은 소품의 화소 12~18% 를 255 로 태워 질감을 날렸고(cctv·reel·receipt),
    # `AgX` 는 반대로 색을 빼앗아 "무엇인지"를 흐린다.
    sc.view_settings.view_transform = 'Khronos PBR Neutral'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = EXPOSURE

    # 월드 — 화면에는 안 보이지만(투명 필름) 금속의 반사원이다.
    world = bpy.data.worlds.new('neutral')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.56, 0.60, 1.0)   # 살짝 찬 중성 회색
    bg.inputs[1].default_value = WORLD_STRENGTH
    sc.world = world


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def world_points(objs, cap=40000):
    """월드 좌표 정점 목록. 프레이밍 계산의 입력 — 바운딩박스보다 정확하다."""
    pts = []
    for o in objs:
        if o.type != 'MESH' or not o.data:
            continue
        mw = o.matrix_world
        vs = o.data.vertices
        step = max(1, len(vs) // cap)
        for i in range(0, len(vs), step):
            pts.append(mw @ vs[i].co)
    return pts


def bbox_of(pts):
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def camera_basis(azimuth_deg, elevation_deg):
    """카메라가 물건을 바라보는 방향(정규화). Blender 는 Z-up, glTF +Z 정면은 -Y 다."""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    # 방위각 0 = -Y 에서 본다 → 물건의 정면.
    horiz = Vector((math.sin(az), -math.cos(az), 0.0))
    d = Vector((horiz.x * math.cos(el), horiz.y * math.cos(el), math.sin(el)))
    d.normalize()
    return d


def look_at(obj, target, direction):
    """direction 쪽에 놓인 카메라/조명이 target 을 보게 한다 (로컬 -Z 가 시선)."""
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (-direction).to_track_quat('-Z', 'Y')


def fit_camera(cam, pts, center, direction):
    """
    바운딩박스를 카메라 공간에 투영해 **화면 점유율이 정확히 FILL 이 되도록** 거리를 잡고,
    동시에 투영 박스의 중심이 프레임 한가운데 오도록 조준점을 민다.
    렌즈는 고정 — 움직이는 것은 거리와 조준점뿐이다. 이것이 "크기 정규화"의 전부다.

    ⚠ 조준점을 안 밀면 점유율이 소품마다 달라진다. 3D 바운딩박스 중심을 그냥 겨누면
    투영된 실루엣은 그 점을 기준으로 **비대칭**이라, "중심에서 가장 먼 점"으로 맞춘
    거리는 반대쪽에 여백을 남긴다. 실제로 그렇게 해서 점유율이 57~79% 로 흩어졌다
    (cctv 57 · reel 79). 소품 공정성은 프레임 점유율까지 같아야 성립한다.
    원근이라 한 번에 안 맞으므로 몇 번 조인다 (금방 수렴한다).
    """
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    radius = max((p - center).length for p in pts)
    dist = radius * 3.0
    target = center.copy()
    #: 거리 d 에서 프레임이 담는 월드 폭 = 2*d*tan(반화각). 정사각 렌더라 가로=세로.
    half_fov = math.atan((SENSOR_MM * 0.5) / LENS_MM)

    def place(d):
        cam.location = target + direction * d
        look_at(cam, target, direction)
        # ⚠ 클립면은 **반드시 물건 크기에 맞춰 다시 잡는다.**
        # 새 카메라의 기본 far 는 100 인데 이 소품들의 저작 단위가 제각각이다
        # (call 은 0.27, cctv 는 504, keycard 는 320). 기본값으로 두면 큰 모델은
        # 뒷부분이 잘려 나가거나(운송 상자) 통째로 사라진다(cctv 일부 방위각에서
        # 빈 프레임이 나왔다). 프레이밍 계산(world_to_camera_view)은 클리핑을
        # 모르기 때문에 **로그상으로는 멀쩡해 보이는** 종류의 함정이다.
        cam.data.clip_start = max(1e-4, d * 0.01)
        cam.data.clip_end = d * 10.0
        bpy.context.view_layer.update()

    for _ in range(60):
        place(dist)
        mw = cam.matrix_world
        right = mw.col[0].to_3d().normalized()
        up = mw.col[1].to_3d().normalized()

        xs, ys, behind = [], [], False
        for p in pts:
            co = world_to_camera_view(sc, cam, p)
            if co.z <= 0:                        # 카메라 뒤 — 너무 가깝다
                behind = True
                break
            xs.append(co.x)
            ys.append(co.y)
        if behind:
            dist *= 3.0
            continue

        cx, cy = (min(xs) + max(xs)) * 0.5, (min(ys) + max(ys)) * 0.5
        extent = max(max(xs) - min(xs), max(ys) - min(ys))

        # 조준점을 밀어 투영 박스를 프레임 중앙으로. 화면 1.0 = 월드 frame 만큼.
        # 부호 주의: 카메라는 조준점과 **같이** 움직인다. 물건이 오른쪽에 치우쳐
        # 보이면(cx>0.5) 조준점을 오른쪽으로 밀어야 프레임 중심이 따라와 물건이
        # 가운데로 돌아온다. 반대로 걸면 조준점이 물건에서 달아나고, 투영 폭이
        # 커지면서 거리가 발산한다 (실제로 dist 가 1e11 까지 갔다).
        frame = 2.0 * dist * math.tan(half_fov)
        target += right * ((cx - 0.5) * frame) + up * ((cy - 0.5) * frame)

        if abs(extent - FILL) < 0.003 and abs(cx - 0.5) < 0.002 and abs(cy - 0.5) < 0.002:
            break
        dist *= max(0.4, min(2.5, extent / FILL))
        dist = max(radius * 0.6, min(radius * 40.0, dist))   # 발산 방지
    place(dist)                                  # 마지막 보정치로 반드시 다시 세운다
    return dist


def add_sun(name, direction, energy, angle_deg=6.0, color=(1, 1, 1)):
    """SUN 은 거리 감쇠가 없다 — 물건 크기가 달라도 노출이 같다 (공정성의 핵심)."""
    data = bpy.data.lights.new(name, 'SUN')
    data.energy = energy
    data.angle = math.radians(angle_deg)
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    return obj


def setup_lights(view_dir):
    """
    카메라 기준 좌표계에 3등을 매단다 — 방위각을 돌려도 물건이 받는 빛은 똑같다.
    right/up 은 카메라의 화면 오른쪽/위.
    """
    fwd = -view_dir                                   # 카메라 → 물건
    right = fwd.cross(Vector((0, 0, 1)))
    if right.length < 1e-6:
        right = Vector((1, 0, 0))
    right.normalize()
    up = right.cross(fwd).normalized()

    def d(rx, uy, fz):
        v = (right * rx + up * uy + fwd * fz)
        v.normalize()
        return v

    # 키 — 왼쪽 위 앞. 형태를 만든다.
    add_sun('key', d(-0.75, -0.85, 1.0), KEY_ENERGY, angle_deg=12.0, color=(1.0, 0.97, 0.92))
    # 필 — 오른쪽 아래, 약하게. 그림자가 새까매지지 않게.
    add_sun('fill', d(0.95, 0.25, 0.7), FILL_ENERGY, angle_deg=30.0, color=(0.88, 0.92, 1.0))
    # 림 — 물건 뒤에서 앞으로. 어두운 물건의 실루엣을 배경에서 떼어낸다.
    add_sun('rim', d(0.45, -0.55, -1.0), RIM_ENERGY, angle_deg=8.0, color=(0.95, 0.97, 1.0))


def render_prop(key, cfg, out_path, dump=None):
    reset_scene()
    src = glb_path(key)
    if not os.path.exists(src):
        raise SystemExit('없는 파일: ' + src)
    objs = import_glb(src)
    pts = world_points(objs)
    if not pts:
        raise SystemExit('메시가 없다: ' + src)

    lo, hi = bbox_of(pts)
    center = (lo + hi) * 0.5
    dims = hi - lo

    view_dir = camera_basis(cfg['azimuth'], ELEVATION_DEG + cfg.get('tilt', 0))

    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = LENS_MM
    cam_data.sensor_width = SENSOR_MM
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    dist = fit_camera(cam, pts, center, view_dir)

    setup_lights(view_dir)

    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)

    info = {
        'key': key,
        'note': cfg['note'],
        'dims_m': [round(v, 4) for v in dims],
        'azimuth': cfg['azimuth'],
        'elevation': ELEVATION_DEG + cfg.get('tilt', 0),
        'distance': round(dist, 4),
        'verts_sampled': len(pts),
    }
    if dump is not None:
        dump.append(info)
    print('RENDERED', json.dumps(info, ensure_ascii=False))


def write_manifest(keys):
    """
    루트는 `{소품키: 파일경로}` 평면 매핑이다 — UI 가 그대로 인덱싱한다.
    부가 정보는 `$meta` 한 칸에 몰아 넣어 순회에 안 섞이게 한다.
    """
    man = {}
    for k in keys:
        man[k] = '/public/props/thumbs/%s.webp' % k
    man['$meta'] = {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'generator': 'scripts/render-props.py (Blender EEVEE)',
        'size': [SIZE, SIZE],
        'format': 'webp (RGBA, 알파 배경)',
        'lens': '%.0fmm / %.0fmm sensor (전 소품 공통)' % (LENS_MM, SENSOR_MM),
        'fill': FILL,
        'lighting': 'SUN 3등(키/필/림) · 카메라 기준 고정 · 거리 감쇠 없음',
        'fairness': '소품 공정성 7A.7 — 렌즈·조명·프레임 점유율 전 소품 동일. 방위각만 소품별.',
        'publicPath': '경로는 vite glob 키 형태다. 정적 서빙 경로는 props/thumbs/<키>.webp.',
        'kindModels': KIND_MODELS,
        'kindLabels': KIND_LABELS,
        'notes': {k: PROPS[k]['note'] for k in keys},
        'nonEvidence': ['crate'],
        # 씬은 실모델 풀이 떨어지면 프리미티브로 세운 "증거 깃발"을 쓴다
        # (sceneRules.ts 의 FLAG_KEY). 에셋 파일이 없으므로 썸네일도 없다 —
        # UI 는 이 키에서 매니페스트 조회가 빌 것을 예상해야 한다.
        'noThumb': {
            'flag': '증거 깃발 — 파일 에셋이 아니라 씬이 프리미티브로 세운다. '
                    'kind 풀을 넘어선 k번째 증거가 이걸 입는다.',
        },
        'excluded': {
            'fallscene': '현장 사망 지점 표시물 — 수거되는 증거품이 아니라 수첩 카드가 없다. '
                         '정본 §4(유혈·신체 묘사 금지)에도 걸린다.',
        },
    }
    path = os.path.join(OUT_DIR, 'manifest.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('MANIFEST', path)


def parse_spec(spec):
    """`키` · `키@방위각` · `키@방위각/추가고도` — 뒤 둘은 표를 덮어쓰는 각도 탐색용."""
    key, _, rest = spec.partition('@')
    if key not in PROPS:
        raise SystemExit('모르는 소품키: %s' % key)
    cfg = dict(PROPS[key])
    name = key
    if rest:
        az, _, tilt = rest.partition('/')
        cfg['azimuth'] = float(az)
        if tilt:
            cfg['tilt'] = float(tilt)
        name = '%s@%g_%g' % (key, cfg['azimuth'], cfg.get('tilt', 0))
    return key, name, cfg


def main():
    args = argv()
    out_dir = OUT_DIR
    specs = []
    for a in args:
        if a.startswith('--out='):
            out_dir = os.path.abspath(a[6:])
        elif not a.startswith('-'):
            specs.append(a)
    parsed = [parse_spec(s) for s in (specs or list(PROPS))]
    os.makedirs(out_dir, exist_ok=True)
    dump = []
    for key, name, cfg in parsed:
        render_prop(key, cfg, os.path.join(out_dir, name + '.webp'), dump)
    # 각도 탐색분은 매니페스트를 건드리지 않는다 — 정본은 표대로 구운 것뿐이다.
    if out_dir == OUT_DIR:
        write_manifest(list(PROPS))


main()
