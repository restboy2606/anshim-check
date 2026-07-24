#!/usr/bin/env python3
"""
실사례 기반 스미싱/보이스피싱 문자 10종 → Solar 판정 QA
근거 유형: 금융감독원·은행·경찰 캠페인에서 반복되는 대표 수법
- 환급금/건강보험/국세청 링크형
- 택배 사칭
- 검찰·안전계좌
- 가족·메신저피싱
- 대출 사칭
- 기관 콜백형
- 명절·지원금
- 정상 대조군
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


def project_root() -> Path:
    here = Path(__file__).resolve().parent
    for candidate in [here, *here.parents]:
        if (candidate / "api" / "analyze.js").exists() and (candidate / "index.html").exists():
            return candidate
    raise RuntimeError("anshim-check project root not found")


ANALYZE_URL = "http://127.0.0.1:3215/api/analyze"
PROJECT_ROOT = project_root()
OUT = PROJECT_ROOT / "qa" / "reports" / "scam_persona_report.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

# 검색으로 확인된 대표 수법을 바탕으로 '창의적 변형' 본문 (더미 URL/번호만)
CASES = [
    {
        "id": "R01",
        "source_type": "건강보험·환급금 스미싱 (공공기관 사칭+단축URL)",
        "expected": "높음",
        "message": (
            "[국민건강보험] 2025년 보험료 정산 환급금 87,400원이 확정되었습니다.\n"
            "오늘 24시 전 미신청 시 소멸됩니다.\n"
            "본인확인 ▶ https://bit.ly/fake-nhis-refund-26"
        ),
    },
    {
        "id": "R02",
        "source_type": "국세청·종합소득세 환급 사칭 (신고 시즌 링크 유도)",
        "expected": "높음",
        "message": (
            "[국세청 Hometax] 종합소득세 환급 대상자로 선정되셨습니다.\n"
            "환급 계좌 등록이 필요합니다. 아래 안심링크로 3분 내 완료하세요.\n"
            "http://hometax-refund.example.com/r/a9k2"
        ),
    },
    {
        "id": "R03",
        "source_type": "택배사 사칭 스미싱 (명절·미수령 미끼)",
        "expected": "높음",
        "message": (
            "[한진택배] 배송지 불가로 반송 접수되었습니다.\n"
            "재배송비 2,500원 결제 후 재발송됩니다.\n"
            "결제/주소수정: https://hanjin-reship.example.net/p/88"
        ),
    },
    {
        "id": "R04",
        "source_type": "검찰·수사기관 사칭 + 안전계좌 (기관사칭형)",
        "expected": "높음",
        "message": (
            "서울중앙지방검찰청 형사부입니다.\n"
            "고객님 명의 계좌가 해외 범죄자금 세탁에 사용되어 긴급 동결 예정입니다.\n"
            "수사 협조를 위해 자산을 보호계좌로 이체해 주시기 바랍니다.\n"
            "담당 검사보 직통: 010-0000-0000 (지금 연락 없으면 구속 영장 검토)"
        ),
    },
    {
        "id": "R05",
        "source_type": "가족·자녀 메신저피싱 (폰고장+급전이체)",
        "expected": "높음",
        "message": (
            "엄마 나야ㅠ 폰 깨져서 친구 번호로 연락해\n"
            "지금 카드가 정지돼서 급해… 편의점 앞에서 기다리고 있어\n"
            "우리은행 1002-000-000000 임OO 앞으로 35만원만 보내주면 안돼?\n"
            "아빠한테는 말 말고 빨리!!"
        ),
    },
    {
        "id": "R06",
        "source_type": "저금리 대출 사칭 (앱 설치·개인정보 유도)",
        "expected": "높음",
        "message": (
            "[정부지원 대환대출] 신용 무관 연 1.2% 특별 한도 승인\n"
            "오늘 마감. 신청서 작성 후 담당자 배정됩니다.\n"
            "신청앱 설치: https://bit.ly/fake-gov-loan-app\n"
            "문의 1600-0000"
        ),
    },
    {
        "id": "R07",
        "source_type": "기관 콜백형 (링크 없이 전화 유도 — 소프트 스미싱)",
        "expected": "중간",
        "message": (
            "안녕하세요, 국민연금공단 광명지사 상담센터입니다.\n"
            "연금 수급 자격 재확인 서류가 미비하여 연락드렸습니다.\n"
            "업무시간 내 이 번호로 회신 주시면 3분 안내 도와드리겠습니다."
        ),
    },
    {
        "id": "R08",
        "source_type": "명절·정부지원금 사칭",
        "expected": "높음",
        "message": (
            "[행정안전부] 설 명절 민생안정 지원금 대상 안내\n"
            "미신청 시 자동 소멸. 본인 인증 후 수령 계좌를 등록하세요.\n"
            "신청: https://mois-support.example.org/s/2026"
        ),
    },
    {
        "id": "R09",
        "source_type": "정상 대조 — 가족 안부",
        "expected": "낮음",
        "message": "엄마 오늘 저녁에 반찬 좀 해둘까? 회사에서 일찍 끝나. 맛있는 거 먹고 싶어?",
    },
    {
        "id": "R10",
        "source_type": "정상 대조 — 병원 예약(링크·송금 없음)",
        "expected": "낮음",
        "message": (
            "[서울대병원] 임종권 님, 7월 25일(금) 14:30 내과 예약이 있습니다.\n"
            "방문 시 건강보험증을 지참해 주세요. (링크 없음, 단순 안내)"
        ),
    },
]


def call_solar(message: str) -> dict:
    payload = json.dumps({"message": message}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        ANALYZE_URL,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            data = json.loads(res.read().decode("utf-8"))
            return {"ok": True, "status": res.status, "answer": data.get("answer", "")}
    except urllib.error.HTTPError as e:
        return {
            "ok": False,
            "status": e.code,
            "answer": e.read().decode("utf-8", errors="replace"),
        }
    except Exception as e:
        return {"ok": False, "status": 0, "answer": str(e)}


def parse_level(answer: str) -> str | None:
    m = re.search(r"위험도\s*[:：]\s*(높음|중간|낮음)", answer or "")
    return m.group(1) if m else None


def rank(level: str | None) -> int:
    return {"낮음": 0, "중간": 1, "높음": 2}.get(level or "", -1)


def pass_case(expected: str, actual: str | None) -> bool:
    if actual is None:
        return False
    if expected == "높음":
        return actual == "높음"
    if expected == "중간":
        return rank(actual) >= 1  # 중간 이상
    if expected == "낮음":
        return actual == "낮음"
    return expected == actual


def main() -> int:
    print("실사례 기반 10종 → Solar 판정\n")
    rows = []
    ok_n = 0
    for c in CASES:
        print(f"[{c['id']}] {c['source_type']}")
        print(f"  expected={c['expected']}")
        print(f"  msg: {c['message'][:90].replace(chr(10), ' / ')}…")
        r = call_solar(c["message"])
        actual = parse_level(r.get("answer", "")) if r.get("ok") else None
        passed = pass_case(c["expected"], actual) if r.get("ok") else False
        if passed:
            ok_n += 1
        mark = "PASS" if passed else "FAIL"
        print(f"  → Solar={actual} [{mark}] http={r.get('status')}")
        if r.get("answer") and r.get("ok"):
            first = r["answer"].splitlines()[0:4]
            print("    " + " | ".join(first)[:200])
        rows.append(
            {
                **c,
                "actual": actual,
                "pass": passed,
                "solar_answer": r.get("answer"),
                "http_ok": r.get("ok"),
                "status": r.get("status"),
            }
        )
        time.sleep(1.0)

    total = len(rows)
    report = {
        "summary": {
            "total": total,
            "passed": ok_n,
            "failed": total - ok_n,
            "accuracy": round(ok_n / total, 3) if total else 0,
            "basis": "금감원·은행·경찰 캠페인 대표 유형 기반 창의 변형 문자",
            "detector": "upstage solar-pro3 /api/analyze",
        },
        "cases": rows,
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n=== SUMMARY ===")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    fails = [x for x in rows if not x["pass"]]
    if fails:
        print("\nFAILS:")
        for f in fails:
            print(f"- {f['id']}: exp={f['expected']} got={f['actual']} :: {f['source_type']}")
    print("WROTE", OUT)
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
