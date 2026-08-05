"""
앉은 자세 적용 — 블렌더 헤드리스 배치.

Meshy 오토리깅은 **A포즈로 선 캐릭터**를 준다. 심문 장면에 서 있는 사람은 어색하다.
이 스크립트가 리깅된 GLB 를 받아 의자에 앉은 자세로 굳혀 다시 내보낸다.

왜 스크립트인가: MCP 로 대화하며 한 명씩 잡으면 재현이 안 된다. 모델을 다시 뽑거나
자세를 고칠 때마다 처음부터 다시 해야 한다. 8명에 같은 값을 적용하려면 파일이어야 한다.

왜 이 각도인가: 눈대중이 아니라 **탐색으로 찾았다.** 팔 각도는 위팔·아래팔 3축을
훑으면서 "손이 무릎 위에 오는" 조합을 거리 최소화로 골랐다 (왼손↔왼무릎 0.13m).
Meshy 리그는 24본 Mixamo 계열 이름이라 8명이 같은 값을 공유한다.

사용법:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python scripts/pose-seated.py -- <입력.glb> <출력.glb>
"""
import bpy
import math
import sys
from mathutils import Euler

R = math.radians

# 뼈 이름 → (x, y, z) 도 단위. Meshy 오토리깅의 24본 규격.
SEATED = {
    # 다리 — 허벅지 수평, 정강이 수직
    'LeftUpLeg':  (-88, 0, 4),
    'RightUpLeg': (-88, 0, -4),
    'LeftLeg':    (84, 0, 0),
    'RightLeg':   (84, 0, 0),
    'LeftFoot':   (8, 0, 0),
    'RightFoot':  (8, 0, 0),
    # 상체 — 취조받는 사람은 뒤로 기대지 않는다. 살짝 앞으로, 고개는 조금 숙인다.
    'Spine':   (6, 0, 0),
    'Spine01': (3, 0, 0),
    'Spine02': (2, 0, 0),
    'neck':    (-4, 0, 0),
    'Head':    (2, 0, 0),
    # 어깨만 고정. **팔은 모델마다 탐색한다** — 아래 fit_arms() 참조.
    'LeftShoulder':  (0, 0, 4),
    'RightShoulder': (0, 0, -4),
}


def fit_arms(arm, side):
    """
    손이 **허벅지 중간**에 놓이도록 위팔·아래팔 각도를 탐색한다.

    ## 세 번 고쳤다
    ① 손↔**무릎** 거리만 최소화 → 팔이 몸통을 뚫는 지름길이 최적해였다.
    ② 관통 벌점을 붙임 → 관통은 사라졌지만 팔이 어정쩡하게 벌어졌다.
       목표가 무릎이라 너무 멀어서, 팔을 쭉 뻗어야 닿았기 때문이다.
    ③ 2본 IK 로 바꿔봤다 → 아마추어 공간과 월드 공간을 섞어 팔꿈치가 수천 m 밖으로 날아갔다.
       (`pb.head`/`pb.matrix` 는 아마추어 공간이다)

    **결론: 탐색은 맞았고 목표가 틀렸다.** 앉은 사람의 손은 무릎이 아니라
    허벅지 중간쯤에 얹힌다. 그 지점을 목표로 하면 팔꿈치가 자연스럽게 접히고,
    관통 벌점이 몸통을 지켜 준다.
    """
    import itertools
    pb = arm.pose.bones
    upper, fore = pb[f'{side}Arm'], pb[f'{side}ForeArm']
    upper.rotation_mode = fore.rotation_mode = 'XYZ'

    def hand():
        bpy.context.view_layer.update()
        return pb[f'{side}Hand'].head

    bpy.context.view_layer.update()
    knee = pb[f'{side}Leg'].head.copy()
    hip = pb['Hips'].head.copy()

    # **허벅지 중간** — 엉덩이와 무릎 사이 55% 지점, 허벅지 위로 조금
    target = hip.lerp(knee, 0.55)
    target.z += 0.075

    spine_lo = pb['Spine'].head.copy()
    spine_hi = pb['Spine02'].tail.copy()
    CLEAR = max(0.095, abs(pb[f'{side}Shoulder'].head.x - spine_lo.x) * 0.85)

    def torso_hit():
        """팔꿈치·손이 몸통 축에 파고든 양. 0 이면 안 겹친다."""
        pen = 0.0
        for pt in (fore.head, pb[f'{side}Hand'].head, pb[f'{side}Hand'].tail):
            t = max(0.0, min(1.0, (pt.z - spine_lo.z) / max(1e-6, spine_hi.z - spine_lo.z)))
            axis = spine_lo.lerp(spine_hi, t)
            horiz = ((pt.x - axis.x) ** 2 + (pt.y - axis.y) ** 2) ** 0.5
            if horiz < CLEAR:
                pen += CLEAR - horiz
        return pen

    def cost():
        bpy.context.view_layer.update()
        return (hand() - target).length + torso_hit() * 4.0

    best = None
    for ux, uy, uz in itertools.product(range(-90, 51, 20), range(-80, 81, 40), range(-60, 81, 20)):
        upper.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(-110, 111, 25), range(-110, 111, 25)):
            fore.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            c = cost()
            if best is None or c < best[0]:
                best = (c, (ux, uy, uz), (fx, fz))

    bu, bf = best[1], best[2]
    for ux, uy, uz in itertools.product(*[range(v - 15, v + 16, 5) for v in bu]):
        upper.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(bf[0] - 15, bf[0] + 16, 5), range(bf[1] - 15, bf[1] + 16, 5)):
            fore.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            c = cost()
            if c < best[0]:
                best = (c, (ux, uy, uz), (fx, fz))

    upper.rotation_euler = Euler((R(best[1][0]), R(best[1][1]), R(best[1][2])), 'XYZ')
    fore.rotation_euler = Euler((R(best[2][0]), 0, R(best[2][1])), 'XYZ')
    hb = pb.get(f'{side}Hand')
    if hb:
        hb.rotation_mode = 'XYZ'
        hb.rotation_euler = Euler((R(-12), 0, 0), 'XYZ')

    bpy.context.view_layer.update()
    # ⚠️ 이 좌표는 **아마추어 공간**이다. Meshy 리그는 아마추어 scale 이 0.01 이라
    # 여기 수치 × 0.01 = 실제 미터다 (14.0 → 14cm). 이 단위를 몰라 IK 를 두 번 틀렸다.
    scale = arm.scale.x or 1.0
    print(f'  {side} 팔: 손↔허벅지 {(hand() - target).length * scale * 100:.1f}cm · '
          f'몸통관통 {torso_hit() * scale * 100:.1f}cm')


def main(src, dst):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=src)

    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not arms:
        raise SystemExit(f'아마추어가 없다: {src} — 리깅되지 않은 파일이다')
    arm = arms[0]

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    missing = []
    for name, (x, y, z) in SEATED.items():
        pb = arm.pose.bones.get(name)
        if not pb:
            missing.append(name)
            continue
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler((R(x), R(y), R(z)), 'XYZ')
    if missing:
        print(f'  ! 없는 뼈 {len(missing)}개: {missing[:6]}')

    for side in ('Left', 'Right'):
        fit_arms(arm, side)

    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()

    body = max(meshes, key=lambda m: len(m.data.vertices))

    """
    **엉덩이를 의자 좌면에 맞춘다.**
    발바닥을 바닥(0)에 맞췄더니 엉덩이 높이가 모델마다 달라 의자와 겹쳤다.
    앉은 사람의 기준은 발이 아니라 **엉덩이가 닿는 면**이다.
    방 에셋의 좌면은 원본 z≈-0.36, 배율 1.9 기준 바닥에서 0.455m 다.
    """
    SEAT_H = 0.455
    hips_z = (arm.matrix_world @ arm.pose.bones['Hips'].head).z
    arm.location.z += SEAT_H - hips_z
    bpy.context.view_layer.update()

    # **포즈를 레스트로 굳히지 않는다.**
    # `pose.armature_apply()` 를 쓰면 아마추어의 레스트는 바뀌지만 스킨 메시의 바인드가
    # 따라오지 않아 익스포트 결과가 원래 포즈로 되돌아간다 (실측: 폭 1.55m = 팔 벌린 T포즈).
    # glTF 는 관절 노드의 TRS 를 그대로 싣기 때문에, **포즈를 켠 채 내보내면** 된다.

    # 본체 메시와 아마추어만. Meshy 출력에 딸려오는 잡동사니는 제외한다.
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm

    # **`export_rest_position_armature` 가 기본 True 다** — 그대로 두면 포즈를 무시하고
    # 레스트 포즈(T/A포즈)를 내보낸다. 이걸 못 찾아서 두 번 헛돌았다:
    # `pose.armature_apply()` 로 레스트를 바꿔 봤지만 스킨 바인드가 따라오지 않아 소용없었다.
    # 정답은 굳히는 게 아니라 **현재 포즈를 그대로 싣는 것**이다.
    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', use_selection=True,
        export_apply=False, export_animations=False, export_skins=True,
        export_rest_position_armature=False,
        export_current_frame=True,
        export_reset_pose_bones=False,
    )
    print(f'  앉힘: {dst}')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    if len(argv) != 2:
        raise SystemExit('사용법: -- <입력.glb> <출력.glb>')
    main(argv[0], argv[1])
