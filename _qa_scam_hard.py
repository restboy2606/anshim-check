#!/usr/bin/env python3
"""
빡센 경계 케이스 QA — 소프트 사기 / 공식톤 위장 / 함정 / 애매
실무에서 어르신·중장년이 헷갈리기 쉬운 형태 위주.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ANALYZE_URL = "http://127.0.0.1:3216/api/analyze"
OUT = Path(__file__).resolve().parent / "_qa_scam_hard_report.json"

# expected: 높음 | 중간 | 낮음
# pass 규칙: 높음=정확히 높음 / 중간=중간이상 / 낮음=정확히 낮음
CASES = [
    # --- 교묘한 높음 ---
    {
        "id": "H01",
        "diff": "S",
        "source_type": "카톡 공식채널 톤 + 짧은 단축링크 (스미싱)",
        "expected": "높음",
        "message": (
            "고객님, 카카오페이 보안센터입니다.\n"
            "해외 로그인 시도가 감지되어 임시 잠금되었습니다.\n"
            "본인 확인 후 해제: kko.to/fake-sec-unlock"
        ),
    },
    {
        "id": "H02",
        "diff": "S",
        "source_type": "은행 고객센터 말투 + '안심URL' 위장",
        "expected": "높음",
        "message": (
            "[KB국민은행] 고객님 카드 부정사용 의심 거래 1건\n"
            "금액 487,000원 / 가맹점: 해외직구몰\n"
            "거래 취소는 안심URL에서만 가능합니다 → https://kb-secure.example.com/cxl"
        ),
    },
    {
        "id": "H03",
        "diff": "S",
        "source_type": "메신저피싱 고도화 — 가족말투+사진증명 유도 없이 계좌만",
        "expected": "높음",
        "message": (
            "엄마 나 지금 학원 앞에서 폰 액정이 나가서 이 번호로 연락해.\n"
            "오늘 교재비+등록비 내야 하는데 카드가 안 돼ㅠ\n"
            "카카오뱅크 3333-00-0000000 김OO 앞으로 28만만 보내줄 수 있어?\n"
            "선생님 앞에서 기다리고 있어서 빨리…"
        ),
    },
    {
        "id": "H04",
        "diff": "S",
        "source_type": "택배+개인통관부호 탈취형",
        "expected": "높음",
        "message": (
            "[쿠팡] 해외직구 통관 보류 안내\n"
            "개인통관고유부호 미등록으로 통관이 지연 중입니다.\n"
            "24시간 내 미등록 시 반송: https://coupang-customs.example.io/u"
        ),
    },
    {
        "id": "H05",
        "diff": "S",
        "source_type": "경찰 아닌 '금융감독원 조사관' 소프트 협박",
        "expected": "높음",
        "message": (
            "금융감독원 불법금융대응단 조사관 김○○입니다.\n"
            "고객님 명의로 대포통장이 개설되어 참고인 조사 대상입니다.\n"
            "지금 통화 가능하신가요? 거부 시 출석요구서가 발송됩니다.\n"
            "자산 보호를 위해 지정 계좌로 이체 후 입금확인증을 보내주셔야 합니다."
        ),
    },
    # --- 중간 (링크 약하거나 소프트) ---
    {
        "id": "H06",
        "diff": "A",
        "source_type": "기관 사칭 콜백만 (링크·계좌 없음)",
        "expected": "중간",
        "message": (
            "건강보험공단 자격관리팀입니다.\n"
            "피부양자 자격 변동 확인이 필요해 연락드렸습니다.\n"
            "업무시간 중 회신 주시면 안내 도와드리겠습니다."
        ),
    },
    {
        "id": "H07",
        "diff": "A",
        "source_type": "지인 말투 + 수상한 링크만 (금액 요구 없음)",
        "expected": "중간",
        "message": "야 이거 너 사진이야? ㅋㅋ 봐봐 https://bit.ly/fake-album-zz",
    },
    {
        "id": "H08",
        "diff": "A",
        "source_type": "회사 인사팀 톤 + 복지포인트 링크",
        "expected": "높음",
        "message": (
            "[인사총무팀] 2026 상반기 복지포인트 미사용분 소멸 예정\n"
            "잔여 포인트 전환 신청 (오늘 마감)\n"
            "신청서: https://hr-welfare.example.co.kr/form"
        ),
    },
    # --- 낮음 (정상인데 헷갈릴 수 있는 것) ---
    {
        "id": "H09",
        "diff": "A",
        "source_type": "정상 — 동네 맛집 단톡 공지",
        "expected": "낮음",
        "message": (
            "안녕하세요 반장님, 이번 주 토요일 반상회 10시 경로당입니다.\n"
            "다과비 1,000원은 현장에서 받습니다. 참석 여부 카톡으로만 알려주세요."
        ),
    },
    {
        "id": "H10",
        "diff": "A",
        "source_type": "정상 — 학교 가정통신문 요약 (링크 없음)",
        "expected": "낮음",
        "message": (
            "[OO초] 7/28(월) 체육대회 안내입니다.\n"
            "운동화 착용, 물 지참 부탁드립니다. 우천 시 익일로 연기됩니다."
        ),
    },
    # --- 더 빡센 함정 ---
    {
        "id": "H11",
        "diff": "S+",
        "source_type": "함정 — 진짜 공식 도메인처럼 보이는 오타 도메인",
        "expected": "높음",
        "message": (
            "[카카오톡] 고객센터\n"
            "계정 보호조치 해제는 공식 고객센터에서만 가능합니다.\n"
            "https://accounts-kaka0.com/secure/login  (영문 o → 숫자 0 위장)"
        ),
    },
    {
        "id": "H12",
        "diff": "S+",
        "source_type": "함정 — '링크 없음' 강조하며 계좌이체 (텍스트만)",
        "expected": "높음",
        "message": (
            "※ 본 문자는 링크를 포함하지 않습니다. 피싱이 아닙니다.\n"
            "검찰청 사이버수사팀입니다. 명의도용 사건 관련 참고인입니다.\n"
            "증거보전을 위해 농협 352-0000-0000-00 으로 잔액을 이체 후\n"
            "입금증을 팩스 02-000-0000 으로 보내 주십시오."
        ),
    },
    {
        "id": "H13",
        "diff": "S+",
        "source_type": "함정 — 정상 예약 톤 + 끝에만 수상 링크",
        "expected": "높음",
        "message": (
            "[서울아산병원] 임OO 님 7/30 09:20 예약 확인되었습니다.\n"
            "방문 시 마스크 착용 부탁드립니다.\n"
            "예약 변경/취소는 여기서: https://bit.ly/fake-asan-change"
        ),
    },
    {
        "id": "H14",
        "diff": "S+",
        "source_type": "함정 — 가족 안부처럼 시작 → 후반 송금",
        "expected": "높음",
        "message": (
            "엄마 나 잘 지내고 있어. 날씨 좋지?\n"
            "아 맞다 오늘 친구 결혼식 축의금이 모자라서 그런데\n"
            "카뱅 3333-11-2222222 로 20만만 먼저 보내줄 수 있어?\n"
            "저녁에 바로 채워둘게 사랑해"
        ),
    },
    {
        "id": "H15",
        "diff": "S+",
        "source_type": "애매 — 실제 은행 대표번호만 안내 (링크·이체 없음)",
        "expected": "낮음",
        "message": (
            "[신한은행] 고객님, 신청하신 체크카드가 제작 완료되어 등기 발송 예정입니다.\n"
            "배송 조회는 신한 쏠(SOL) 앱 또는 고객센터 1599-8000으로 문의해 주세요."
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
        return rank(actual) >= 1
    if expected == "낮음":
        return actual == "낮음"
    return expected == actual


def main() -> int:
    print(f"빡센 세트 {len(CASES)}건 → Solar\n")
    rows = []
    ok_n = 0
    for c in CASES:
        print(f"[{c['id']}|{c['diff']}] {c['source_type']}")
        print(f"  exp={c['expected']}")
        r = call_solar(c["message"])
        actual = parse_level(r.get("answer", "")) if r.get("ok") else None
        passed = pass_case(c["expected"], actual) if r.get("ok") else False
        if passed:
            ok_n += 1
        mark = "PASS" if passed else "FAIL"
        print(f"  → got={actual} [{mark}]")
        if r.get("ok") and r.get("answer"):
            print("    " + " | ".join(r["answer"].splitlines()[:3])[:180])
        rows.append({**c, "actual": actual, "pass": passed, "solar_answer": r.get("answer")})
        time.sleep(1.5)

    total = len(rows)
    by_diff = {}
    for r in rows:
        d = r["diff"]
        by_diff.setdefault(d, {"n": 0, "ok": 0})
        by_diff[d]["n"] += 1
        by_diff[d]["ok"] += int(r["pass"])

    report = {
        "summary": {
            "total": total,
            "passed": ok_n,
            "failed": total - ok_n,
            "accuracy": round(ok_n / total, 3) if total else 0,
            "by_diff": by_diff,
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
            print(f"- {f['id']}: exp={f['expected']} got={f['actual']} | {f['source_type']}")
    print("WROTE", OUT)
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
