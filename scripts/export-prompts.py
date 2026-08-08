#!/usr/bin/env python3
"""
세션 트랜스크립트에서 **사람이 실제로 친 프롬프트만** 뽑아 .md 로 내린다.

## 왜 이 스크립트가 필요한가
NAN 2026 제출물 4번(AI 활용 기술 문서)이 "프롬프트 전문" 을 요구한다.
그런데 `~/.claude/projects/**/*.jsonl` 의 `type: "user"` 레코드는 사람 발화가 아니다 —
툴 결과 · 시스템 주입 · 훅 출력 · 서브에이전트 내부 대화가 전부 같은 타입으로 들어온다.
그냥 뽑으면 발화당 평균 8,185자가 나온다 (실제로 그랬다). 사람은 그렇게 안 친다.

## 무엇을 걸러내는가
- `tool_result` 블록이 하나라도 있으면 사람 발화가 아니다
- `isSidechain` 은 서브에이전트 내부 대화다
- `<system-reminder>` 는 시스템이 넣은 것이다
- 컨텍스트 **압축 요약 재생**은 84만 자짜리 한 덩어리로 들어온다 — 사람 발화로 세면 통계가 무너진다
- 슬래시 명령 확장(`<command-name>`)과 로컬 stdout

## 무엇을 남기는가
사람이 친 것 + 사람이 붙여넣은 것. 붙여넣기는 길이로 표시만 하고 지우지 않는다 —
"어떤 자료를 언제 물려줬나" 도 파이프라인의 일부다.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

PROJECT_DIR = Path.home() / '.claude/projects/-Users-teo-Project-Game-NHN'

# 이 문서는 **공개 저장소로 나간다.** 조용히 지우면 지운 줄도 모르므로, 지운 것은 세어서 보고한다.
REDACTIONS = [
    (re.compile(r'\b(?:sk|msy|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{16,}'), '[키 삭제]'),
    (re.compile(r'\bBearer\s+[A-Za-z0-9._-]{20,}'), 'Bearer [토큰 삭제]'),
    (re.compile(r'\bAKIA[0-9A-Z]{12,}\b'), '[키 삭제]'),
    (re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), '[이메일 삭제]'),
    (re.compile(re.escape(str(Path.home()))), '~'),
]


def redact(text: str, tally: dict) -> str:
    """공개해선 안 될 것을 지운다. 지운 횟수를 tally 에 적는다."""
    for pat, repl in REDACTIONS:
        text, n = pat.subn(repl, text)
        if n:
            tally[repl] = tally.get(repl, 0) + n
    return text
# 압축 요약 재생은 이 길이를 넘는다. 사람이 친 최장 프롬프트(붙여넣기 포함)와 자릿수가 다르다.
COMPACTION_CHARS = 100_000
# 이 길이를 넘으면 "붙여넣은 자료" 로 표시한다
PASTE_CHARS = 3_000


def human_turns(path: Path):
    """한 세션에서 사람 발화만 시간순으로 뽑는다."""
    for line in path.open(encoding='utf-8', errors='replace'):
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get('type') != 'user' or d.get('isSidechain'):
            continue
        content = d.get('message', {}).get('content')

        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            if any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in content):
                continue
            text = ''.join(
                b.get('text', '') for b in content
                if isinstance(b, dict) and b.get('type') == 'text'
            )
        else:
            continue

        text = re.sub(r'<system-reminder>.*?</system-reminder>', '', text, flags=re.S).strip()
        if not text:
            continue
        if text.startswith(('<command-', 'Caveat:')) or 'local-command-stdout' in text[:40]:
            continue
        if len(text) > COMPACTION_CHARS:      # 압축 요약 재생
            continue

        yield d.get('timestamp', ''), text


def main() -> int:
    files = sorted(PROJECT_DIR.glob('*.jsonl'), key=lambda p: p.stat().st_mtime)
    if not files:
        print(f'트랜스크립트를 못 찾았다: {PROJECT_DIR}', file=sys.stderr)
        return 1

    sessions = []
    for f in files:
        # 파일에는 되감기·분기가 섞여 있어 기록 순서가 곧 시간 순서가 아니다. 시각으로 다시 세운다.
        turns = sorted(human_turns(f), key=lambda t: t[0])
        if turns:
            sessions.append((f, turns))
    sessions.sort(key=lambda s: s[1][0][0])       # 첫 발화 시각 순

    out = ['# 프롬프트 전문 — FIVE ALIBIS (nan-alibi)',
           '',
           '> NAN 2026 제출물 4번 부록. 사람이 실제로 입력한 것만 시간순으로 담았다.',
           '> 툴 결과 · 시스템 주입 · 서브에이전트 내부 대화 · 컨텍스트 압축 재생은 제외했다.',
           f'> 생성: `scripts/export-prompts.py` · 세션 {len(sessions)}개',
           '']

    total = 0
    total_chars = 0
    tally: dict[str, int] = {}
    for i, (f, turns) in enumerate(sessions, 1):
        first = turns[0][0][:10] or '?'
        last = turns[-1][0][:10] or '?'
        out += ['', f'## 세션 {i} — {first} ~ {last}', '',
                f'`{f.name}` · 발화 {len(turns)}건', '']
        for ts, text in turns:
            when = ts[:16].replace('T', ' ') if ts else ''
            tag = f'  *(붙여넣은 자료 {len(text):,}자)*' if len(text) > PASTE_CHARS else ''
            body = text if len(text) <= PASTE_CHARS else text[:PASTE_CHARS] + '\n\n…(이하 생략)'
            body = redact(body, tally)
            # 붙여넣은 자료에 백틱 펜스가 들어 있으면 바깥 펜스가 거기서 닫혀 문서가 깨진다.
            # 본문에 나오는 가장 긴 백틱 연속보다 한 칸 더 긴 펜스를 쓴다.
            longest = max((len(m) for m in re.findall(r'`+', body)), default=0)
            fence = '`' * max(3, longest + 1)
            out += [f'### {when}{tag}', '', f'{fence}text', body, fence, '']
            total += 1
            total_chars += len(text)

    dest = Path(__file__).resolve().parent.parent / 'docs/제출/프롬프트-전문.md'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text('\n'.join(out), encoding='utf-8')

    print(f'세션 {len(sessions)}개 · 사람 발화 {total}건 · {total_chars:,}자')
    print(f'→ {dest}')
    if tally:
        print('  마스킹:', ' · '.join(f'{k} {v}건' for k, v in sorted(tally.items())))
    else:
        print('  마스킹: 없음')
    for i, (f, turns) in enumerate(sessions, 1):
        chars = sum(len(t) for _, t in turns)
        print(f'  세션 {i}: {len(turns):3}건 · {chars:>7,}자 · 평균 {chars // len(turns):>5}자 · {f.name[:8]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
