"""
믹사모 애니메이션을 우리 리그로 옮긴다 (Blender 헤드리스).

## 왜 싸게 끝나는가 — 실측으로 확인한 것
Meshy 오토리깅은 **믹사모 이름 규약을 쓴다.** `mixamorig:` 접두사만 떼면
24본 중 19본(79%)이 그대로 일치하고, 안 맞는 5개도 사소하다:

    Spine01 ↔ Spine1 · Spine02 ↔ Spine2 · neck ↔ Neck · head_end ↔ HeadTop_End

세 줄짜리 규칙으로 23/24 가 맞는다. 남는 믹사모 본은 전부 손가락이고
걷기에는 필요 없다. **그래서 본 매핑을 손으로 짤 일이 없다.**

## rest pose 함정
배포되는 `*.opt.glb` 는 **앉은 자세가 rest pose 로 구워져 있다**
(`export_rest_position_armature=False` 로 그렇게 만들었다).
거기에 걷기를 얹으면 앉은 채로 걷는다. 그래서 입력은 반드시
착석 **전** 원본(`assets-src/*.mvrigged.glb`, A포즈)이어야 한다.

## 왜 constraint 를 굽는가
fcurve 를 직접 옮기는 것보다 제약을 걸고 굽는 편이 다루기 쉽다.

## ⚠ 알려진 결함 — rest 축 차이를 보정하지 않는다
아래에서 Copy Rotation 을 `LOCAL_WITH_PARENT` 로 거는데, 이 공간은 회전을
**각 본 자신의 rest 축 성분 그대로** 복사한다. **블렌더가 두 리그의 rest 축 차이를
알아서 흡수해 주지 않는다** (예전에 이 주석이 그렇게 적혀 있었고, 그게 틀렸다).

실제로 이 프로젝트의 Meshy 오토리그는 **다리 본 8개만** Mixamo 대비 자기 축(Y)
기준 180° 롤되어 있었다(몸통·팔·머리 15개는 정렬). 그래서 다리 회전의 X·Z 성분이
반대로 얹혀 **무릎이 뒤로 꺾인 채** 배포됐다.

지금은 런타임에서 `(-x, y, -z, w)` 로 되돌린다(`src/ui/explore3d.ts` 의 `unrollLegs`).
**여기를 제대로 고치려면** rest 축을 비교해 다른 축은 미리 보정한 뒤 구워야 한다.

사용:
  blender -b --python scripts/retarget.py -- <target.glb> <anim.fbx> <out.glb> [액션이름]
"""

import bpy
import re
import sys


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


# 믹사모 → 우리 리그. 접두사를 뗀 뒤에도 안 맞는 것만 적는다.
RENAME = {
    'spine1': 'spine01',
    'spine2': 'spine02',
    'headtop_end': 'head_end',
}


def norm(name: str) -> str:
    """비교용 정규화 — 접두사·대소문자·구분자 차이를 없앤다."""
    n = re.sub(r'^mixamorig[:_]?', '', name, flags=re.I).lower()
    n = RENAME.get(n, n)
    return n.replace('_', '').replace('.', '')


def count_fcurves(action) -> int:
    """액션의 커브 수 — Blender 4.x 는 `action.fcurves`, 5.x 는 layer/strip 안에 있다."""
    if hasattr(action, 'fcurves'):
        return len(action.fcurves)
    n = 0
    for layer in getattr(action, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for cb in getattr(strip, 'channelbags', []):
                n += len(getattr(cb, 'fcurves', []))
    return n


def only_armature():
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        raise SystemExit('아마추어가 없다')
    return arms[0]


def main() -> int:
    args = argv()
    if len(args) < 3:
        print('사용: <target.glb> <anim.fbx> <out.glb> [액션이름]')
        return 1
    target_path, anim_path, out_path = args[0], args[1], args[2]
    action_name = args[3] if len(args) > 3 else 'Walk'

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ── 대상(우리 캐릭터) ──
    bpy.ops.import_scene.gltf(filepath=target_path)
    tgt = only_armature()
    tgt.name = 'TARGET'
    target_objs = set(bpy.data.objects)

    # ── 애니메이션 원본 ──
    bpy.ops.import_scene.fbx(filepath=anim_path)
    src = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o not in target_objs)
    src.name = 'SOURCE'

    src_by_norm = {norm(b.name): b.name for b in src.pose.bones}
    pairs = [(b.name, src_by_norm[norm(b.name)]) for b in tgt.pose.bones if norm(b.name) in src_by_norm]

    print(f'RETARGET|대상본 {len(tgt.pose.bones)} · 원본본 {len(src.pose.bones)} · 매핑 {len(pairs)}')
    if len(pairs) < 8:
        # 8개도 못 맞으면 규약이 다른 리그다. 이상한 결과를 내보내느니 여기서 멈춘다.
        unmatched = [b.name for b in tgt.pose.bones if norm(b.name) not in src_by_norm]
        print('RETARGET|매핑 실패. 안 맞은 본:', unmatched[:12])
        return 2

    # ── 제약을 걸고 굽는다 ──
    for tname, sname in pairs:
        pb = tgt.pose.bones[tname]
        c = pb.constraints.new('COPY_ROTATION')
        c.target = src
        c.subtarget = sname
        c.target_space = 'LOCAL_WITH_PARENT'
        c.owner_space = 'LOCAL_WITH_PARENT'
    # 허리 높이는 따라가야 걷는 느낌이 난다. 위치는 뿌리 하나만 옮긴다.
    root = next((t for t, _ in pairs if norm(t) == 'hips'), None)
    if root:
        c = tgt.pose.bones[root].constraints.new('COPY_LOCATION')
        c.target = src
        c.subtarget = src_by_norm['hips']
        c.use_offset = True
        c.target_space = 'LOCAL'
        c.owner_space = 'LOCAL'

    act = src.animation_data.action
    f0, f1 = (int(round(v)) for v in act.frame_range)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = f0, f1

    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(
        frame_start=f0, frame_end=f1, only_selected=True,
        visual_keying=True, clear_constraints=True, clear_parents=False,
        use_current_action=False, bake_types={'POSE'},
    )
    bpy.ops.object.mode_set(mode='OBJECT')

    baked = tgt.animation_data.action
    baked.name = action_name
    # Blender 5.x 는 액션을 slot/layer 로 쪼개서 `action.fcurves` 가 없다.
    # 버전마다 다른 곳을 보므로 개수는 참고용으로만 세고, 실패해도 진행한다.
    print(f'RETARGET|구운 프레임 {f0}~{f1} · fcurve {count_fcurves(baked)}')

    # 원본은 내보내지 않는다
    bpy.data.objects.remove(src, do_unlink=True)

    # **남은 액션을 전부 지운다.** 안 지우면 GLB 에 4개가 실린다 —
    # 원본 FBX 의 `mixamo.com|Layer0`, 대상 GLB 가 갖고 있던 `clip0|baselayer`,
    # 굽기가 남긴 빈 `Action.001` 까지. 셋 다 키가 없어서 재생하면 **정지 상태**다.
    # 런타임이 첫 번째 액션을 집으면 안 움직이는 모델이 된다 — 실제로 검증기가 그걸 밟았다.
    for a in list(bpy.data.actions):
        if a is not baked:
            bpy.data.actions.remove(a)
    print(f'RETARGET|남긴 액션 {[a.name for a in bpy.data.actions]}')

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_animations=True,
        # **rest pose 를 A포즈로 유지한다.** 현재 프레임을 rest 로 굽는 실수가
        # 앉은 모델을 만들었던 그 설정이다 — 여기서는 반대로 가야 한다.
        export_rest_position_armature=True,
        export_current_frame=False,
        export_optimize_animation_size=True,
    )
    print(f'RETARGET|저장 {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
