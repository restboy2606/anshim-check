#!/usr/bin/env python3
"""NVIDIA scam-persona message generator → Solar (local /api/analyze) accuracy QA."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import nvidia_nim_client  # noqa: E402

ANALYZE_URL = "http://127.0.0.1:3215/api/analyze"
OUT = Path(__file__).resolve().parent / "_qa_scam_persona_report.json"

GEN_PACKET = """당신은 QA용 '사기꾼 페르소나 시뮬레이터'입니다.
실제 피해를 내는 링크/계좌는 쓰지 마세요. 가짜 예시만 만드세요.
bit.ly/fake-xxx, example.com 같은 더미 URL만 사용.

아래 JSON 배열만 출력하세요. 다른 말 금지.
각 원소:
{
  "id": "S01",
  "expected": "높음|중간|낮음",
  "category": "스미싱_링크|보이스피싱_사칭|가족사칭|택배미끼|정상_안부|정상_예약|애매",
  "channel": "문자|카톡",
  "message": "실제 붙여넣을 본문 전체"
}

반드시 포함:
- 높음 4개 (건보환급 링크, 검찰 안전계좌, 택배 미수령 링크, 은행 명의도용 협박)
- 중간 2개 (애매한 기관 연락 요청, 짧은 의심 링크)
- 낮음 3개 (가족 안부, 병원 예약 리마인드(공식 톤·링크 없음), 지인 약속)
- 함정 1개: 가족이지만 갑자기 돈 이체 부탁(예상 중간 또는 높음)

총 10개. 한국어 자연스럽게, 어르신 대상 톤 섞기.
"""


def gen_messages() -> list[dict]:
    comp = nvidia_nim_client.complete(
        GEN_PACKET,
        model="deepseek-ai/deepseek-v4-flash",
        timeout_seconds=90,
        enable_thinking=False,
    )
    text = comp.content.strip()
    # strip fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # find array
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end < 0:
        raise RuntimeError(f"no json array: {text[:300]}")
    items = json.loads(text[start : end + 1])
    return items, comp.total_tokens


def call_solar(message: str) -> dict:
    payload = json.dumps({"message": message}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        ANALYZE_URL,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as res:
            body = res.read().decode("utf-8")
            data = json.loads(body)
            return {"ok": True, "status": res.status, "answer": data.get("answer", "")}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "status": e.code, "answer": detail}
    except Exception as e:
        return {"ok": False, "status": 0, "answer": str(e)}


def parse_level(answer: str) -> str | None:
    m = re.search(r"위험도\s*[:：]\s*(높음|중간|낮음)", answer or "")
    return m.group(1) if m else None


def rank(level: str | None) -> int:
    return {"낮음": 0, "중간": 1, "높음": 2}.get(level or "", -1)


def pass_case(expected: str, actual: str | None, category: str) -> bool:
    if actual is None:
        return False
    # 함정: 가족 이체는 중간 이상이면 통과
    if "함정" in category or "이체" in category:
        return rank(actual) >= 1
    # 높음 예상: 높음만 통과 (중간은 약함)
    if expected == "높음":
        return actual == "높음"
    if expected == "중간":
        return actual in ("중간", "높음")  # 중간 이상 OK
    if expected == "낮음":
        return actual == "낮음"
    return expected == actual


def main() -> int:
    print("=== 1) NVIDIA: 사기꾼 페르소나 문자 생성 ===")
    items, gen_tokens = gen_messages()
    print(f"generated={len(items)} tokens={gen_tokens}")

    print("\n=== 2) Solar(/api/analyze) 판정 ===")
    rows = []
    ok_n = 0
    for i, item in enumerate(items):
        msg = item.get("message") or ""
        exp = item.get("expected") or ""
        cat = item.get("category") or ""
        print(f"\n[{item.get('id', i)}] expected={exp} cat={cat}")
        print("MSG:", msg[:120].replace("\n", " / "))
        result = call_solar(msg)
        actual = parse_level(result.get("answer", "")) if result.get("ok") else None
        passed = pass_case(exp, actual, cat) if result.get("ok") else False
        if passed:
            ok_n += 1
        print(f"SOLAR: actual={actual} pass={passed} status={result.get('status')}")
        if result.get("answer"):
            print((result["answer"] if result["ok"] else result["answer"])[:220].replace("\n", " | "))
        rows.append(
            {
                "id": item.get("id"),
                "expected": exp,
                "actual": actual,
                "pass": passed,
                "category": cat,
                "channel": item.get("channel"),
                "message": msg,
                "solar_answer": result.get("answer"),
                "http_ok": result.get("ok"),
                "status": result.get("status"),
            }
        )
        # rate limit 여유
        time.sleep(1.2)

    total = len(rows)
    report = {
        "summary": {
            "total": total,
            "passed": ok_n,
            "failed": total - ok_n,
            "accuracy": round(ok_n / total, 3) if total else 0,
            "gen_tokens": gen_tokens,
            "generator": "deepseek-ai/deepseek-v4-flash",
            "detector": "upstage solar-pro3 via /api/analyze",
        },
        "cases": rows,
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n=== SUMMARY ===")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    fails = [r for r in rows if not r["pass"]]
    if fails:
        print("\nFAILS:")
        for f in fails:
            print(f"- {f['id']}: expected={f['expected']} actual={f['actual']} cat={f['category']}")
    print("WROTE", OUT)
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
