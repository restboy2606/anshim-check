#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""위험점수(0~100) 포맷 QA — Solar 직접 호출 + 선택적 NIM 교차검증."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV = ROOT / ".env"
OUT = ROOT / "_qa_score_report.json"

SCORE_PROMPT = """너는 노인·중장년 세대를 대상으로 한 보이스피싱·스미싱 문자 진위 확인 도우미다.
사용자가 붙여넣은 문자를 실제로 읽고, 그 문자 안에 "실제로 존재하는" 내용만 근거로 삼아라. 입력에 없는 링크·계좌요구·문구를 있다고 지어내는 것은 절대 금지다.

반드시 아래 형식을 그대로 지켜라:

위험점수: (0부터 100 사이 정수)
위험도: (높음/중간/낮음)
의심되는 이유:
- (이유 1)
지금 할 일:
- (행동 1)

점수 규칙:
- 0~29 → 위험도 반드시 낮음
- 30~69 → 위험도 반드시 중간
- 70~100 → 위험도 반드시 높음
- 점수는 신호 강도에 맞게: 명확한 송금·단축URL·협박은 80~100, 소프트 회신유도는 40~65, 일상 안부 0~15

말투 규칙:
- 존댓말, 쉬운 말. bullet은 스마트폰 한 줄(최대 26자).
- 금지: 스미싱, 전형적인, 패턴, 영어 약어 나열.

판정 기준(출력에 넣지 말 것):
- 링크·단축URL+신청/결제/로그인/환급 → 높음(점수 80+)
- 검찰·은행 사칭+이체/협박 → 높음(90+)
- 가족 말투+계좌/금액 급전 → 높음(85+)
- 기관 콜백만(링크·계좌 없음) → 중간(45~60)
- 위험 신호 없음 → 낮음(0~15)
"""

CASES = [
    {
        "id": "S01",
        "expect_band": "high",
        "min_score": 70,
        "message": "[국민건강보험] 환급금 32,900원 발생. 오늘 24시 전 미신청 시 소멸. https://nhis-refund.example.com/a",
    },
    {
        "id": "S02",
        "expect_band": "high",
        "min_score": 80,
        "message": "[서울중앙지검] 명의 금융사기 접수. 계좌 동결 예정. 보호계좌로 이체 후 연락. 02-0000-0000",
    },
    {
        "id": "S03",
        "expect_band": "high",
        "min_score": 75,
        "message": "엄마 핸드폰 고장났어 이 번호로. 우리은행 1002-000-000000 으로 50만원 빨리. 아빠한테 말하지 마",
    },
    {
        "id": "S04",
        "expect_band": "mid",
        "min_score": 30,
        "max_score": 69,
        "message": "건강보험공단입니다. 피부양자 자격 변동 확인이 필요해 연락드렸습니다. 업무시간 중 회신 주세요.",
    },
    {
        "id": "S05",
        "expect_band": "low",
        "max_score": 29,
        "message": "엄마, 저녁 뭐 먹고 싶어? 이따 장 봐서 갈게",
    },
    {
        "id": "S06",
        "expect_band": "low",
        "max_score": 29,
        "message": "[서울아산병원] 내일 오후 2시 외래 예약 안내입니다. 문의 1588-0000",
    },
    {
        "id": "S07",
        "expect_band": "high",
        "min_score": 70,
        "message": "[한진택배] 배송지 오류 반송 예정. 주소·결제 수정: https://hanjin-reship.example.net/p/9",
    },
    {
        "id": "S08",
        "expect_band": "mid",
        "min_score": 30,
        "max_score": 69,
        "message": "야 이거 너 사진이야? ㅋㅋ 봐봐 https://bit.ly/fake-album-zz",
    },
    {
        "id": "S09",
        "expect_band": "high",
        "min_score": 85,
        "message": "금융감독원 조사관입니다. 대포통장 연루. 지금 지정 안전계좌로 이체 후 입금확인증 보내세요. 거부 시 출석요구서.",
    },
    {
        "id": "S10",
        "expect_band": "low",
        "max_score": 29,
        "message": "아들 학교 체육복 세탁했어. 내일 가져가. 사랑해",
    },
]


def load_key() -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("UPSTAGE_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("UPSTAGE_API_KEY missing")


def solar_call(key: str, message: str) -> str:
    body = json.dumps(
        {
            "model": "solar-pro3",
            "messages": [
                {"role": "system", "content": SCORE_PROMPT},
                {"role": "user", "content": message},
            ],
            "stream": False,
            "temperature": 0.15,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.upstage.ai/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=40) as res:
        data = json.loads(res.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def parse(text: str) -> dict:
    score_m = re.search(r"위험점수\s*[:：]\s*(\d{1,3})", text)
    level_m = re.search(r"위험도\s*[:：]\s*(높음|중간|낮음)", text)
    score = int(score_m.group(1)) if score_m else None
    level = level_m.group(1) if level_m else None
    band = None
    if score is not None:
        if score <= 29:
            band = "low"
        elif score <= 69:
            band = "mid"
        else:
            band = "high"
    return {"score": score, "level": level, "band": band, "raw": text}


def band_from_level(level: str | None) -> str | None:
    return {"높음": "high", "중간": "mid", "낮음": "low"}.get(level or "")


def eval_case(case: dict, parsed: dict) -> dict:
    ok = True
    notes = []
    score = parsed["score"]
    if score is None:
        ok = False
        notes.append("no_score")
    else:
        if score < 0 or score > 100:
            ok = False
            notes.append("score_oor")
        if case.get("min_score") is not None and score < case["min_score"]:
            ok = False
            notes.append(f"score_lt_{case['min_score']}")
        if case.get("max_score") is not None and score > case["max_score"]:
            ok = False
            notes.append(f"score_gt_{case['max_score']}")
    exp = case["expect_band"]
    if parsed["band"] and parsed["band"] != exp:
        ok = False
        notes.append(f"band_{parsed['band']}_ne_{exp}")
    lvl_band = band_from_level(parsed["level"])
    if parsed["band"] and lvl_band and parsed["band"] != lvl_band:
        ok = False
        notes.append("score_level_mismatch")
    return {"ok": ok, "notes": notes, **parsed, "expect": exp}


def nim_crosscheck(rows: list[dict]) -> dict | None:
    try:
        sys.path.insert(0, str(ROOT.parents[1] / "scripts"))
        import nvidia_nim_client  # type: ignore
    except Exception as e:
        return {"skipped": True, "reason": f"import_fail:{e}"}

    compact = [
        {
            "id": r["id"],
            "expect": r["expect"],
            "score": r.get("score"),
            "level": r.get("level"),
            "ok": r.get("ok"),
            "snippet": (r.get("message") or "")[:80],
        }
        for r in rows
    ]
    prompt = f"""당신은 보이스피싱/스미싱 판정 QA 심사관입니다.
아래는 Solar가 준 위험점수(0-100) 결과입니다.
JSON만 출력:
{{
  "agree_count": 숫자,
  "disagree": [{{"id":"...","why":"..."}}],
  "score_system_ready": true/false,
  "comment": "한 줄"
}}
규칙: 일상 안부·병원예약=낮음(0-29), 기관콜백만=중간, 단축URL/송금/협박=높음.
데이터:
{json.dumps(compact, ensure_ascii=False)}
"""
    try:
        # nvidia_nim_client API may vary — try common helpers
        if hasattr(nvidia_nim_client, "chat"):
            out = nvidia_nim_client.chat(prompt)
        elif hasattr(nvidia_nim_client, "complete"):
            out = nvidia_nim_client.complete(prompt)
        elif hasattr(nvidia_nim_client, "call_nim"):
            out = nvidia_nim_client.call_nim(prompt)
        else:
            # fallback: inspect module
            names = [n for n in dir(nvidia_nim_client) if not n.startswith("_")]
            return {"skipped": True, "reason": f"no_chat_fn names={names[:12]}"}
        text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            return json.loads(m.group(0))
        return {"raw": text[:800]}
    except Exception as e:
        return {"skipped": True, "reason": str(e)}


def main() -> int:
    key = load_key()
    rows = []
    for case in CASES:
        t0 = time.time()
        try:
            ans = solar_call(key, case["message"])
            parsed = parse(ans)
            judged = eval_case(case, parsed)
            rows.append(
                {
                    "id": case["id"],
                    "message": case["message"],
                    "latency_s": round(time.time() - t0, 2),
                    **judged,
                    "answer": ans,
                }
            )
            print(
                f"{case['id']} ok={judged['ok']} score={judged['score']} "
                f"level={judged['level']} notes={judged['notes']}"
            )
        except Exception as e:
            rows.append({"id": case["id"], "ok": False, "error": str(e)})
            print(f"{case['id']} ERROR {e}")
        time.sleep(0.4)

    passed = sum(1 for r in rows if r.get("ok"))
    total = len(rows)
    ready = passed >= int(total * 0.8)  # 80% 이상이면 도입
    nim = nim_crosscheck(rows)
    report = {
        "passed": passed,
        "total": total,
        "pass_rate": round(passed / total, 3) if total else 0,
        "score_system_ready": ready,
        "nim": nim,
        "rows": rows,
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nPASS {passed}/{total} ready={ready}")
    print(f"report -> {OUT}")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
