"""
앉은 자세 — **뼈 이름 규약이 다른 리그도 받는다.**

Meshy 오토리깅은 24본 Mixamo 이름(`Hips`, `LeftUpLeg` …)을 준다.
기성 에셋(Sketchfab 등)은 제각각이다 — carla 는 89본에 `hip_02`, `upperleg_l_074` 처럼
접미 번호가 붙는다. 그래서 **정확한 이름 대신 패턴으로 찾는다.**

기성 리그가 나은 점: 손가락 개별 본, 턱·눈꺼풀·눈썹 본까지 있어
입 모양과 표정이 가능하다 (Meshy 는 모프 0 · 얼굴본 0 이라 원천 불가였다).

사용법:
  Blender --background --python scripts/pose_seated2.py -- <입력.glb> <출력.glb> [키(m)]
"""
import bpy
import math
import re
import sys
from mathutils import Euler, Vector

R = math.radians

# 역할 → 뼈 이름 패턴. 앞에 오는 패턴이 우선한다.
#
# 지금까지 만난 규약 셋:
#   Meshy 오토리깅       : Hips, LeftUpLeg, LeftLeg, LeftArm …
#   Sketchfab(carla)     : hip_02, upperleg_l_074, lowerleg_l_075 …
#   Character Creator    : CC_Base_Hip, CC_Base_L_Thigh, CC_Base_L_Calf …
# 규약마다 이름이 다르므로 **정확한 이름 대신 패턴**으로 찾는다.
PATTERNS = {
    'hips':      [r'^hips?$', r'^hip[_\d]', r'(?:cc_base_)?hip$', r'^pelvis'],
    'spine':     [r'^spine[_\d]*0?1', r'^spine$', r'(?:cc_base_)?waist$', r'(?:cc_base_)?spine0?1$'],
    'chest':     [r'^spine[_\d]*0?3', r'^spine[_\d]*0?2', r'^chest', r'(?:cc_base_)?spine0?2$'],
    'neck':      [r'^neck', r'(?:cc_base_)?neck'],
    'head':      [r'^head(?![_\d]*end)', r'(?:cc_base_)?head$'],
    'jaw':       [r'^jaw(?![_\d]*end)', r'(?:cc_base_)?jawroot$', r'jaw'],
    'l_upleg':   [r'^upperleg[_\d]*l\b', r'^leftupleg', r'l_thigh$', r'^l.*upleg'],
    'r_upleg':   [r'^upperleg[_\d]*r\b', r'^rightupleg', r'r_thigh$', r'^r.*upleg'],
    'l_leg':     [r'^lowerleg[_\d]*l\b', r'^leftleg', r'l_calf$'],
    'r_leg':     [r'^lowerleg[_\d]*r\b', r'^rightleg', r'r_calf$'],
    'l_foot':    [r'^foot[_\d]*l\b', r'^leftfoot', r'l_foot$'],
    'r_foot':    [r'^foot[_\d]*r\b', r'^rightfoot', r'r_foot$'],
    'l_shoulder':[r'^shoulder[_\d]*l\b', r'^leftshoulder', r'l_clavicle$', r'^clavicle[_\d]*l'],
    'r_shoulder':[r'^shoulder[_\d]*r\b', r'^rightshoulder', r'r_clavicle$', r'^clavicle[_\d]*r'],
    'l_arm':     [r'^upperarm[_\d]*l\b', r'^leftarm', r'l_upperarm$'],
    'r_arm':     [r'^upperarm[_\d]*r\b', r'^rightarm', r'r_upperarm$'],
    'l_fore':    [r'^lowerarm[_\d]*l\b', r'^leftforearm', r'l_forearm$'],
    'r_fore':    [r'^lowerarm[_\d]*r\b', r'^rightforearm', r'r_forearm$'],
    'l_hand':    [r'^hand[_\d]*l\b', r'^lefthand', r'l_hand$'],
    'r_hand':    [r'^hand[_\d]*r\b', r'^righthand', r'r_hand$'],
}


def map_bones(arm):
    """뼈 이름을 역할에 대응시킨다. 접미 번호(`_074`)는 무시하고 본다."""
    got = {}
    names = [b.name for b in arm.pose.bones]
    for role, pats in PATTERNS.items():
        for pat in pats:
            hit = None
            for n in names:
                # 접미 번호를 떼고 비교한다 — upperleg_l_074 → upperleg_l
                # `CC_Base_L_Thigh_04` → `CC_Base_L_Thigh`, `upperleg_l_074` → `upperleg_l`
                stripped = re.sub(r'_\d+$', '', n)
                if re.search(pat, stripped, re.I) or re.search(pat, n, re.I):
                    hit = n
                    break
            if hit:
                got[role] = hit
                break
    return got


# 상체는 축이 덜 민감해서 고정값으로 둔다
SEATED = {
    'spine': (6, 0, 0), 'chest': (3, 0, 0),
    'neck': (-4, 0, 0), 'head': (2, 0, 0),
    'l_shoulder': (0, 0, 4), 'r_shoulder': (0, 0, -4),
}


def bend_legs(arm, m):
    """
    다리를 접는다 — **회전축을 탐색으로 찾는다.**

    Meshy 리그(`LeftUpLeg` X축 -88°)의 값을 그대로 넣었더니 carla 는 서 있었다.
    리그마다 뼈의 로컬 축이 달라서 상수는 옮겨 쓸 수 없다.

    앉은 자세의 정의는 명확하다: **무릎이 몸 앞으로 나오고, 발목이 무릎 아래로 내려간다.**
    그래서 각 축으로 돌려 보고 무릎이 실제로 앞(-Y)으로 가는 축을 고른다.
    """
    pb = arm.pose.bones
    for side in ('l', 'r'):
        up_n, lo_n = m.get(f'{side}_upleg'), m.get(f'{side}_leg')
        if not (up_n and lo_n):
            continue
        up, lo = pb[up_n], pb[lo_n]
        up.rotation_mode = lo.rotation_mode = 'XYZ'

        bpy.context.view_layer.update()
        hip = up.head.copy()

        # ① 허벅지: 무릎이 몸 앞(-Y)으로 최대한 나오는 축·부호를 찾는다
        best = None
        for axis in range(3):
            for deg in (-90, 90):
                e = [0.0, 0.0, 0.0]
                e[axis] = R(deg)
                up.rotation_euler = Euler(e, 'XYZ')
                bpy.context.view_layer.update()
                knee = pb[lo_n].head
                fwd = hip.y - knee.y          # 앞으로 나온 정도
                drop = abs(knee.z - hip.z)    # 수평에 가까울수록 좋다
                score = fwd - drop * 0.5
                if best is None or score > best[0]:
                    best = (score, axis, deg)
        _, ax, dg = best
        e = [0.0, 0.0, 0.0]; e[ax] = R(dg * 0.95)
        up.rotation_euler = Euler(e, 'XYZ')
        bpy.context.view_layer.update()
        knee = pb[lo_n].head.copy()

        # ② 정강이: 발목이 무릎 아래로 최대한 내려가는 축·부호
        ankle_n = m.get(f'{side}_foot')
        best = None
        for axis in range(3):
            for deg in (-95, 95):
                e2 = [0.0, 0.0, 0.0]; e2[axis] = R(deg)
                lo.rotation_euler = Euler(e2, 'XYZ')
                bpy.context.view_layer.update()
                ank = pb[ankle_n].head if ankle_n else pb[lo_n].tail
                score = (knee.z - ank.z) - abs(ank.y - knee.y) * 0.5
                if best is None or score > best[0]:
                    best = (score, axis, deg)
        _, ax2, dg2 = best
        e2 = [0.0, 0.0, 0.0]; e2[ax2] = R(dg2 * 0.92)
        lo.rotation_euler = Euler(e2, 'XYZ')
        bpy.context.view_layer.update()
        print(f'  {side} 다리: 허벅지 축{ax}={dg}° · 정강이 축{ax2}={dg2}°')


def fit_arms(arm, m, side):
    """손이 허벅지 위에 오도록 위팔·아래팔을 탐색한다. 몸통 관통에는 벌점."""
    import itertools
    pb = arm.pose.bones
    up_n, fo_n = m.get(f'{side}_arm'), m.get(f'{side}_fore')
    hand_n, leg_n = m.get(f'{side}_hand'), m.get(f'{side}_leg')
    if not all([up_n, fo_n, hand_n, leg_n]):
        print(f'  ! {side} 팔 뼈를 못 찾았다')
        return
    up, fo = pb[up_n], pb[fo_n]
    up.rotation_mode = fo.rotation_mode = 'XYZ'

    def hand():
        bpy.context.view_layer.update()
        return pb[hand_n].head

    bpy.context.view_layer.update()
    knee = pb[leg_n].head.copy()
    hip = pb[m['hips']].head.copy()
    target = hip.lerp(knee, 0.55)
    target.z += 0.075 * (arm.scale.x and 1 or 1)

    spine_lo = pb[m['spine']].head.copy()
    spine_hi = pb[m.get('chest', m['spine'])].tail.copy()
    clear = max(0.09, abs(pb[m[f'{side}_shoulder']].head.x - spine_lo.x) * 0.85) \
        if m.get(f'{side}_shoulder') else 0.09

    def hit():
        pen = 0.0
        for pt in (fo.head, pb[hand_n].head, pb[hand_n].tail):
            t = max(0.0, min(1.0, (pt.z - spine_lo.z) / max(1e-6, spine_hi.z - spine_lo.z)))
            ax = spine_lo.lerp(spine_hi, t)
            d = ((pt.x - ax.x) ** 2 + (pt.y - ax.y) ** 2) ** 0.5
            if d < clear:
                pen += clear - d
        return pen

    def cost():
        bpy.context.view_layer.update()
        return (hand() - target).length + hit() * 4.0

    best = None
    for ux, uy, uz in itertools.product(range(-90, 51, 20), range(-80, 81, 40), range(-60, 81, 20)):
        up.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(-110, 111, 25), range(-110, 111, 25)):
            fo.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            c = cost()
            if best is None or c < best[0]:
                best = (c, (ux, uy, uz), (fx, fz))
    bu, bf = best[1], best[2]
    for ux, uy, uz in itertools.product(*[range(v - 15, v + 16, 5) for v in bu]):
        up.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(bf[0] - 15, bf[0] + 16, 5), range(bf[1] - 15, bf[1] + 16, 5)):
            fo.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            c = cost()
            if c < best[0]:
                best = (c, (ux, uy, uz), (fx, fz))
    up.rotation_euler = Euler((R(best[1][0]), R(best[1][1]), R(best[1][2])), 'XYZ')
    fo.rotation_euler = Euler((R(best[2][0]), 0, R(best[2][1])), 'XYZ')
    bpy.context.view_layer.update()
    s = arm.scale.x or 1.0
    print(f'  {side} 팔: 손↔허벅지 {(hand() - target).length * s * 100:.1f}cm · 관통 {hit() * s * 100:.1f}cm')


def main(src, dst, target_h=1.72):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=src)

    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not arms:
        raise SystemExit(f'아마추어가 없다: {src}')
    arm = arms[0]
    body = max(meshes, key=lambda m: len(m.data.vertices))

    m = map_bones(arm)
    need = ['hips', 'spine', 'l_upleg', 'r_upleg', 'l_leg', 'r_leg']
    miss = [k for k in need if k not in m]
    if miss:
        raise SystemExit(f'필수 뼈를 못 찾았다: {miss}\n찾은 것: {sorted(m)}')
    print(f'  뼈 매핑 {len(m)}개 · 턱={m.get("jaw", "없음")}')

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for role, (x, y, z) in SEATED.items():
        n = m.get(role)
        if not n:
            continue
        pb = arm.pose.bones[n]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler((R(x), R(y), R(z)), 'XYZ')
    bend_legs(arm, m)
    for side in ('l', 'r'):
        fit_arms(arm, m, side)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()

    # ── 크기를 미터로 맞춘다 (carla 는 cm 단위라 세로 174 로 나온다) ──
    dg = bpy.context.evaluated_depsgraph_get()
    zs = [(m.matrix_world @ v.co).z
          for m in meshes
          for v in m.evaluated_get(dg).data.vertices]
    h = max(zs) - min(zs)
    """
    크기·위치는 **모든 루트에** 적용한다.
    기성 모델은 옷·머리·신발이 각각 별도 메시이고 루트도 따로다.
    본체 하나만 스케일했더니 나머지가 원래 크기로 남아 폭 6m 짜리가 나왔다.
    """
    roots = [o for o in bpy.data.objects if o.parent is None]
    k = (target_h * 0.79) / h        # 앉은키는 선 키의 약 79%
    for r in roots:
        r.scale = (r.scale.x * k, r.scale.y * k, r.scale.z * k)
    bpy.context.view_layer.update()

    # **발을 바닥에 맞춘다.**
    # 엉덩이를 좌면(0.455m)에 맞췄더니 발이 바닥 아래 30cm 로 내려갔다 —
    # 리그마다 힙 본의 위치가 달라 힙 기준은 못 믿는다. 최저점이 확실하다.
    # 최저점은 **모든 메시**에서 잰다 — 신발이 본체보다 아래다
    dg2 = bpy.context.evaluated_depsgraph_get()
    lo = min((m.matrix_world @ v.co).z
             for m in meshes
             for v in m.evaluated_get(dg2).data.vertices)
    for r in roots:
        r.location.z -= lo
    bpy.context.view_layer.update()

    dg3 = bpy.context.evaluated_depsgraph_get()
    pts = [m.matrix_world @ v.co for m in meshes for v in m.evaluated_get(dg3).data.vertices]
    zs = [p.z for p in pts]; ys = [p.y for p in pts]; xs = [p.x for p in pts]
    print(f'  앉은키 {max(zs)-min(zs):.2f}m · 폭 {max(xs)-min(xs):.2f} · 깊이 {max(ys)-min(ys):.2f} '
          f'· 바닥 {min(zs):.2f}')

    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        if o.type in ('ARMATURE', 'MESH'):
            o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    # 포즈를 그대로 싣는다 — export_rest_position_armature 가 기본 True 라 끄지 않으면
    # 레스트 포즈(A포즈)가 나간다. 이걸 몰라 8명을 서 있는 채로 배포한 적이 있다.
    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', use_selection=True,
        export_apply=False, export_animations=False, export_skins=True,
        export_rest_position_armature=False,
        export_current_frame=True,
        export_reset_pose_bones=False,
    )
    print(f'  앉힘: {dst}')


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    if len(a) < 2:
        raise SystemExit('사용법: -- <입력.glb> <출력.glb> [키(m)]')
    main(a[0], a[1], float(a[2]) if len(a) > 2 else 1.72)
