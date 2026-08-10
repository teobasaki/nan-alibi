"""배우 3D 모델에서 용의자 초상 썸네일을 굽는다 (Blender 헤드리스 · EEVEE).

## 왜 그림을 새로 그리지 않는가
런타임에 돌아가는 3D 모델이 **정체성의 원본**이다. 2D 초상을 따로 그리면
카드월의 얼굴과 취조실의 얼굴이 달라지고, 그 순간 플레이어는 누가 누구인지
추적하는 것을 포기한다. 그래서 초상은 **같은 GLB에서 구워 낸다.**

## 추리 공정성 — 다섯 장이 완전히 같은 조건이어야 한다
한 명만 밝거나, 한 명만 가까이 잡히면 그것 자체가 단서처럼 읽힌다.
그래서 카메라·조명·노출을 **상수로 박고**, 대신 **모델 쪽을 정규화**한다:

    머리 꼭대기를 z=1.70 에 · 머리 축을 x=y=0 에 · 정면을 -Y 로 · 머리 길이를 0.23 으로

모델마다 원점도(m1 은 -2.1 만큼 내려가 있다) 단위도(carla 는 cm, wong 은 m)
정면 방향도 제각각이라, 카메라를 모델에 맞추면 다섯 벌의 카메라가 생긴다.
**모델을 카메라에 맞추면 카메라는 한 벌이면 된다.**

## 머리를 어떻게 찾는가
바운딩박스 꼭대기는 못 믿는다 — GLB 마다 원점 근처에 반지름 1 짜리 `Icosphere`
(gltf 파이프라인이 남긴 것)가 섞여 있고, 그게 박스를 오염시킨다. 그래서

  ① 아마추어에 안 붙은 메시를 버린다
  ② `head` 본(mixamo·CC_Base·소문자 규약을 한 표로 흡수 — retarget.py 와 같은 정규화)
  ③ 그 본 위쪽 + XY 근방 정점만 모아 정수리를 잡는다 (2회 수렴)
  ④ 눈 본이 있으면 눈 중심으로, 없으면 발→발가락으로 **정면 방향**을 구한다

## 눈높이인데 왜 기울이지 않는가
카메라를 눈높이에 두고 가슴까지 담으려면 아래로 8° 쯤 기울여야 하는데, 그러면
얼굴이 내려다보는 각이 되어 인물이 위축돼 보인다. 대신 **렌즈 시프트**(`shift_y`)로
프레임만 내린다 — 실제 인물 사진의 틸트-시프트와 같은 방법이라 수직선이 안 눕는다.

사용:
  blender -b --factory-startup --python scripts/render-portraits.py -- [태그...]
  blender -b --factory-startup --python scripts/render-portraits.py -- --full carla
"""

import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARS = os.path.join(ROOT, 'public', 'characters')
OUT = os.path.join(ROOT, 'public', 'portraits')

# 배역 다섯. src/ui/cast.ts 의 CAST 와 같은 순서·같은 태그다.
TAGS = ['wong', 'carla', 'm1', 'f3', 'f1']

# 기본은 **rest pose**. 대기 클립 첫 프레임은 배우마다 복불복이다 —
# wong·f1(둘 다 CC_Base 리그)은 리타게팅 결함으로 **두 팔이 머리 위로 뻗은 채** 시작한다.
# rest 는 A/T 포즈라 어깨가 곧고, 어차피 가슴 위로 자르면 팔은 화면 밖으로 나간다.
# 대기 포즈로 굽고 싶으면 `--pose`.

# ── 정규화된 좌표계(canonical) ────────────────────────────────────────
# 모델을 여기에 맞춘다. 아래 숫자가 곧 "다섯 명이 공유하는 규격"이다.
HEAD_LEN = 0.23          # 턱끝→정수리. 사람 머리 실측치
CROWN_Z = 1.70           # 정수리 높이 (선 사람 기준)
# 세로 프레임 = 머리 1.95 개. 어깨선 조금 아래에서 잘린다.
#
# 왜 더 넓히지 않는가: rest pose 가 배우마다 T(wong·m1·f1)와 A(carla·f3)로 갈린다.
# 팔을 제약으로 내려 통일하려다 실패했다 — CC_Base 리그(wong·f1)는 glTF 임포트 후
# **상완 본이 원점에 길이 13913 으로 깨져 들어온다**(스킨 행렬만 멀쩡하다).
# 그 본에 Damped Track 을 걸면 팔이 엉뚱한 데로 접힌다. 그래서 팔을 고치는 대신
# **팔이 안 들어오게 자른다.** 화면 표시는 3:4 라 좌우가 11% 씩 더 잘려 나간다.
FRAME_HEADS = 1.95
HEADROOM = 0.12          # 머리 위 여백 12% (비주얼 바이블 8~12%)
FOV_DEG = 32.0           # 수직 화각 (28~36°)
YAW_DEG = 12.0           # 살짝 3/4 (0~15°)
EYE_FROM_CROWN = 0.45    # 눈은 정수리에서 머리 길이의 45% 아래

RES = 512
SAMPLES = 64


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


# ── 본 이름 정규화 — retarget.py 와 같은 규칙 ─────────────────────────
_RENAME = {'spine1': 'spine01', 'spine2': 'spine02', 'headtop_end': 'head_end'}
_FOREIGN = {
    'ccbasehead': 'head', 'ccbaseneck': 'neck',
    'ccbasenecktwist01': 'neck', 'ccbasenecktwist02': 'neck',
}
for _s, _side in (('l', 'left'), ('r', 'right')):
    _FOREIGN.update({
        # CC_Base 계열 (wong · f1)
        f'ccbase{_s}eye': f'{_side}eye',
        f'ccbase{_s}clavicle': f'{_side}shoulder',
        f'ccbase{_s}upperarm': f'{_side}arm',
        f'ccbase{_s}foot': f'{_side}foot',
        f'ccbase{_s}toebase': f'{_side}toebase',
        # 소문자 계열 (carla)
        f'eye{_s}': f'{_side}eye',
        f'clavicle{_s}': f'{_side}shoulder',
        f'shoulder{_s}': f'{_side}shoulder',
        f'upperarm{_s}': f'{_side}arm',
        f'foot{_s}': f'{_side}foot',
        f'ball{_s}': f'{_side}toebase',
        f'toe{_s}': f'{_side}toebase',
    })


def norm(name: str) -> str:
    n = re.sub(r'^mixamorig[:_0-9]*', '', name, flags=re.I).lower()
    n = re.sub(r'_\d+$', '', n)
    n = _RENAME.get(n, n)
    n = n.replace('_', '').replace('.', '').replace(':', '')
    return _FOREIGN.get(n, n)


# ── 씬 조립 ───────────────────────────────────────────────────────────
def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_actor(path: str):
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        raise SystemExit(f'아마추어가 없다: {path}')
    arm = arms[0]
    # 아마추어에 매달리지 않은 메시는 배우가 아니다 (gltf 파이프라인이 남긴 Icosphere 등)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    return arm


def all_verts(deps):
    pts = []
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        oe = o.evaluated_get(deps)
        me = oe.to_mesh()
        mw = oe.matrix_world
        pts.extend([mw @ v.co for v in me.vertices])
        oe.to_mesh_clear()
    return pts


def head_cluster(arm, deps, head_bone_name):
    """**머리 본에 매달린 정점만** 월드 좌표로 모은다.

    바운딩박스 꼭대기를 쓰면 안 된다 — wong·f1 은 대기 클립 첫 프레임에서 **두 손이
    머리 위**에 있어서, 박스 꼭대기가 손이 되고 머리가 두 배로 커진다(실측: 머리
    길이 0.43 — 실제의 두 배). 정점 그룹은 그런 실수를 원천적으로 막는다.

    모자·머리카락·얼굴 본은 머리 본의 자손이라 함께 잡힌다 (wong 의 `Flat_Cap` 등).
    """
    bone = arm.data.bones[head_bone_name]
    names = {bone.name} | {b.name for b in bone.children_recursive}
    pts = []
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        gi = {g.index for g in o.vertex_groups if g.name in names}
        if not gi:
            continue
        oe = o.evaluated_get(deps)
        me = oe.to_mesh()
        mw = oe.matrix_world
        # 아마추어 모디파이어는 토폴로지를 바꾸지 않는다 — 인덱스가 그대로 맞는다
        src = o.data.vertices
        n = min(len(src), len(me.vertices))
        for i in range(n):
            w = sum(g.weight for g in src[i].groups if g.group in gi)
            if w > 0.5:
                pts.append(mw @ me.vertices[i].co)
        oe.to_mesh_clear()
    return pts


def bone_name(arm, wanted):
    for b in arm.data.bones:
        if norm(b.name) == wanted:
            return b.name
    return None


def bone_world(arm_eval, wanted):
    """정규화된 이름이 `wanted` 인 본의 월드 head 위치들."""
    out = []
    for pb in arm_eval.pose.bones:
        if norm(pb.name) == wanted:
            out.append(arm_eval.matrix_world @ pb.head)
    return out


def _perp(lateral: Vector) -> Vector:
    """몸의 좌우축 → 정면. 캐릭터의 왼쪽이 +X 이고 정면이 -Y 인 관례를 따른다."""
    return Vector((-lateral.y, lateral.x)).normalized()


def facing(arm_eval):
    """정면 방향. **발이 아니라 어깨 좌우축**으로 잡는다.

    발→발가락은 대기 자세에서 발이 벌어져 20° 씩 틀어진다(f3 실측).
    눈 본도 못 믿는다 — wong 은 눈 본 좌우축이 몸통 대비 27° 돌아가 있어서,
    그걸 정면으로 삼으면 몸이 통째로 비스듬히 선다. 쇄골이 가장 곧다.
    """
    best = None
    for lname, rname in (('leftarm', 'rightarm'), ('lefteye', 'righteye'),
                         ('leftshoulder', 'rightshoulder')):
        lv, rv = bone_world(arm_eval, lname), bone_world(arm_eval, rname)
        if lv and rv:
            lat = Vector((rv[0].x - lv[0].x, rv[0].y - lv[0].y))
            if best is None or lat.length > best[0]:
                best = (lat.length, lat, lname[4:])
    # **가장 긴 좌우축**을 쓴다. 쇄골 head 는 둘 다 척추 근처라 간격이 2cm 밖에 안 되고,
    # 그 짧은 벡터로 각도를 재면 wong 이 27° 돌아간 것으로 잘못 나온다(실측).
    # 어깨 관절(상완 head)은 30cm 넘게 벌어져 있어 같은 오차가 2° 미만이 된다.
    if best and best[0] > 1e-6:
        return _perp(best[1]), best[2]
    for side in ('left', 'right'):
        f, t = bone_world(arm_eval, f'{side}foot'), bone_world(arm_eval, f'{side}toebase')
        if f and t:
            v = Vector((t[0].x - f[0].x, t[0].y - f[0].y))
            if v.length > 1e-6:
                return v.normalized(), 'foot'
    return Vector((0, -1)), 'default'  # glTF 관례: 캐릭터는 -Y 를 본다


def measure(arm, deps):
    """정수리·눈높이·정면방향을 실측한다. 모델마다 다른 것은 여기서 다 흡수된다."""
    arm_eval = arm.evaluated_get(deps)
    hname = bone_name(arm, 'head')
    if not hname:
        raise SystemExit('head 본을 못 찾았다')
    head_pos = arm_eval.matrix_world @ arm_eval.pose.bones[hname].head

    pts = head_cluster(arm, deps, hname)
    if not pts:
        raise SystemExit('머리 정점을 못 찾았다')
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)

    eyes = bone_world(arm_eval, 'lefteye') + bone_world(arm_eval, 'righteye')
    eye_z = sum(p.z for p in eyes) / len(eyes) if eyes else None

    def head_len(top):
        # 눈 본이 있으면 그것이 가장 곧다(눈은 정수리에서 45% 아래). 없으면 머리 본으로
        # 잰다(머리 본은 정수리에서 85% 아래 — carla 의 눈 본과 교차검증해 맞췄다).
        return (top - eye_z) / EYE_FROM_CROWN if eye_z is not None else (top - head_pos.z) / 0.85

    crown = max(p.z for p in pts)
    hl = head_len(crown)
    # 안전망 — 머리카락·모자가 **본에 안 묶인 별도 메시**로 올 수 있다(m1 의 머리가 그랬다:
    # 정점 그룹만 보면 두피가 정수리가 되어, 실제 머리카락이 프레임 위로 튀어나갔다).
    # 머리 축 근방·목 위 정점을 한 번 더 훑어 진짜 꼭대기를 찾는다. 대기가 아니라 rest
    # 자세라 손은 옆으로 뻗어 있으니 이 반경에 손이 들어올 일은 없다.
    for _ in range(2):
        r = 0.85 * hl
        top = max((p.z for p in all_verts(deps)
                   if p.z > head_pos.z and math.hypot(p.x - cx, p.y - cy) < r), default=crown)
        if top <= crown + 1e-9:
            break
        crown, hl = top, head_len(top)

    fwd, how = facing(arm_eval)
    return Vector((cx, cy, crown)), hl, fwd, how


def normalize_actor(arm, anchor, hl_raw, fwd):
    """모델을 규격 좌표계로 옮긴다 — 카메라는 손대지 않는다."""
    if hl_raw <= 1e-9:
        raise SystemExit('머리 길이를 못 쟀다')
    s = HEAD_LEN / hl_raw

    # 정면(fwd) 을 -Y 로 돌린다
    theta = math.atan2(fwd.x, -fwd.y)      # fwd 가 -Y 일 때 0
    rot = Matrix.Rotation(-theta, 4, 'Z')

    pivot = Matrix.Translation(-anchor)
    place = Matrix.Translation(Vector((0.0, 0.0, CROWN_Z)))
    m = place @ Matrix.Scale(s, 4) @ rot @ pivot
    arm.matrix_world = m @ arm.matrix_world
    return s


# ── 리그 (다섯 명 공용 · 상수) ────────────────────────────────────────
def frame_geometry(full: bool):
    heads = 6.2 if full else FRAME_HEADS
    frame_h = heads * HEAD_LEN
    top = CROWN_Z + HEADROOM * frame_h
    center_z = top - frame_h / 2
    eye_z = CROWN_Z - EYE_FROM_CROWN * HEAD_LEN
    dist = (frame_h / 2) / math.tan(math.radians(FOV_DEG) / 2)
    return frame_h, center_z, eye_z, dist


def add_camera(frame_h, center_z, eye_z, dist):
    cam_data = bpy.data.cameras.new('portrait')
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.lens_unit = 'FOV'
    cam_data.angle_y = math.radians(FOV_DEG)
    # 눈높이 · 기울기 0 · 렌즈 시프트로만 프레임을 내린다
    cam_data.shift_y = (center_z - eye_z) / frame_h
    cam = bpy.data.objects.new('portrait', cam_data)
    yaw = math.radians(YAW_DEG)
    cam.location = (dist * math.sin(yaw), -dist * math.cos(yaw), eye_z)
    cam.rotation_euler = (math.radians(90.0), 0.0, yaw)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def _place(az_deg, elev_deg, dist, base_z):
    az = math.radians(az_deg)
    el = math.radians(elev_deg)
    h = dist * math.cos(el)
    return Vector((h * math.sin(az), -h * math.cos(az), base_z + dist * math.sin(el)))


def _aim(obj, target):
    d = target - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def add_lights(eye_z):
    """키는 카메라 왼쪽 30°, 필은 오른쪽 낮게, 림은 뒤에서. 두 눈과 입이 살아야 한다."""
    target = Vector((0.0, 0.0, CROWN_Z - 0.5 * HEAD_LEN))
    spec = [
        # (이름, 방위각, 고도, 거리, 크기, 와트)
        # 와트는 눈대중이 아니다: 면광원 P·거리 d 에서 조도 E≈P/(4πd²), 램버시안
        # 반사 휘도 L=albedo·E/π. 피부 albedo 0.6 을 L≈0.6 에 앉히려면 1.6m 에서
        # 약 100W. 260W 로 굽던 첫 판은 다섯 명 중 넷의 얼굴이 백지로 날아갔다.
        ('key', YAW_DEG - 32.0, 20.0, 1.6, 0.9, 95.0),
        ('fill', YAW_DEG + 48.0, 6.0, 1.8, 1.5, 30.0),
        ('rim', 205.0, 34.0, 1.5, 0.5, 45.0),
    ]
    for name, az, el, dist, size, power in spec:
        ld = bpy.data.lights.new(name, type='AREA')
        ld.shape = 'SQUARE'
        ld.size = size
        ld.energy = power
        lo = bpy.data.objects.new(name, ld)
        lo.location = _place(az, el, dist, eye_z)
        bpy.context.scene.collection.objects.link(lo)
        _aim(lo, target)


def add_backdrop():
    """중립 어두운 면. 완전 검정은 금지 — 살짝 발광시켜 바닥값을 준다."""
    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 1.5, CROWN_Z - 0.4))
    plane = bpy.context.active_object
    plane.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    mat = bpy.data.materials.new('backdrop')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.19, 0.18, 0.17, 1.0)
    bsdf.inputs['Roughness'].default_value = 1.0
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (0.42, 0.40, 0.38, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 0.055
    plane.data.materials.append(mat)


def setup_world():
    w = bpy.data.worlds.new('amb')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.055, 0.052, 0.050, 1.0)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = w


def setup_render(out_png: str):
    sc = bpy.context.scene
    # 엔진 id 는 버전마다 이름이 바뀐다 (4.2 에서 EEVEE Next 로, 5.x 에서 다시 EEVEE).
    # Cycles 는 쓰지 않는다 — 다섯 장을 몇 초 안에 다시 구울 수 있어야 한다.
    for cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            sc.render.engine = cand
            break
        except TypeError:
            continue
    ee = sc.eevee
    for attr, val in (('taa_render_samples', SAMPLES), ('use_raytracing', True),
                      ('use_shadows', True), ('use_soft_shadows', True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    # 하이라이트를 굴려 주는 변환을 우선한다 — 피부는 albedo 가 높아서 Standard 로는
    # 조금만 세도 이마·콧등이 먼저 clip 되고, 그 순간 인물 식별이 불가능해진다.
    for cand in ('Khronos PBR Neutral', 'AgX', 'Filmic', 'Standard'):
        try:
            sc.view_settings.view_transform = cand
            break
        except TypeError:
            continue
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.render.filepath = out_png


def to_webp(png: str, webp: str):
    cwebp = shutil.which('cwebp')
    if cwebp:
        subprocess.run([cwebp, '-q', '86', '-alpha_q', '100', '-quiet', png, '-o', webp],
                       check=True)
        return
    ff = shutil.which('ffmpeg')
    if not ff:
        raise SystemExit('cwebp 도 ffmpeg 도 없다 — webp 변환 불가')
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', png,
                    '-c:v', 'libwebp', '-quality', '86', webp], check=True)


def kill_emission():
    """자체 발광을 끈다.

    f3 의 재질은 `emissiveTexture` 를 물고 들어와 얼굴이 통째로 하얗게 날아갔다.
    발광은 모델마다 있고 없고가 다르니, 켜 두면 **다섯 명의 노출이 서로 달라진다** —
    조명을 상수로 박은 의미가 사라진다. 그래서 배우 재질의 발광은 전부 0 으로 죽인다.
    """
    for m in bpy.data.materials:
        if not m.use_nodes or m.name == 'backdrop':
            continue
        for n in m.node_tree.nodes:
            for key in ('Emission Strength',):
                if key in getattr(n, 'inputs', {}):
                    n.inputs[key].default_value = 0.0
            if n.type == 'EMISSION' and 'Strength' in n.inputs:
                n.inputs['Strength'].default_value = 0.0


def render_one(tag: str, full: bool, frame: int, rest: bool):
    src = os.path.join(CHARS, f'{tag}.idle.opt.glb')
    if not os.path.exists(src):
        src = os.path.join(CHARS, f'{tag}.sit.opt.glb')
    if not os.path.exists(src):
        print(f'!! {tag}: 모델이 없다')
        return False

    clean_scene()
    arm = import_actor(src)
    if rest:
        # `pose_position='REST'` 는 쓰지 않는다 — rest 모드에서는 **제약이 통째로
        # 무시되어** 아래 `arms_down` 이 조용히 아무 일도 안 한다(한 판 날렸다).
        # 액션을 떼고 포즈 채널을 항등으로 되돌리면 같은 자세이면서 제약은 살아 있다.
        arm.animation_data_clear()
        for pb in arm.pose.bones:
            pb.location = (0.0, 0.0, 0.0)
            pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            pb.rotation_euler = (0.0, 0.0, 0.0)
            pb.scale = (1.0, 1.0, 1.0)
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()

    anchor, hl_raw, fwd, how = measure(arm, deps)
    s = normalize_actor(arm, anchor, hl_raw, fwd)
    kill_emission()
    bpy.context.view_layer.update()

    frame_h, center_z, eye_z, dist = frame_geometry(full)
    add_camera(frame_h, center_z, eye_z, dist)
    add_lights(eye_z)
    add_backdrop()
    setup_world()

    png = os.path.join(tempfile.gettempdir(), f'portrait_{tag}.png')
    setup_render(png)
    print(f'== {tag}: 원본 머리길이={hl_raw:.4f} 배율={s:.4f} '
          f'정면=({fwd.x:.3f},{fwd.y:.3f}) 기준={how} 카메라거리={dist:.3f}')
    bpy.ops.render.render(write_still=True)
    if not os.path.exists(png):
        raise SystemExit(f'{tag}: 렌더 결과가 없다 ({png})')
    os.makedirs(OUT, exist_ok=True)
    suffix = '.full.png' if full else '.webp'
    dst = os.path.join(OUT, tag + suffix)
    if full:
        shutil.copyfile(png, dst)
    else:
        to_webp(png, dst)
    print(f'   -> {dst} ({os.path.getsize(dst)} bytes)')
    return True


def main():
    args = argv()
    full = '--full' in args
    rest = '--pose' not in args
    args = [a for a in args if a not in ('--full', '--pose')]
    frame = 1
    for a in list(args):
        if a.startswith('--frame='):
            frame = int(a.split('=', 1)[1])
            args.remove(a)
    tags = args or TAGS
    ok = 0
    for t in tags:
        if render_one(t, full, frame, rest):
            ok += 1
    print(f'== 완료 {ok}/{len(tags)}')


main()
