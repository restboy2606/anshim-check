# QA

제출 전 검증용 스크립트와 결과 리포트입니다. **런타임 서비스 경로와 분리**되어 있습니다.

## 구성

- `scam_hard.py` — 고난도 사기 문자 경계 케이스
- `scam_persona.py` — 페르소나 생성 + Solar 판정
- `scam_persona_v2.py` — 대표 수법 기반 페르소나 QA
- `score.py` — 위험점수 포맷/경계 QA
- `reports/` — 실행 결과 JSON

## 실행 전제

1. 로컬에서 서비스가 떠 있어야 합니다. (`npx vercel dev` 등)
2. 일부 스크립트는 프로젝트 루트 `.env`의 `UPSTAGE_API_KEY`가 필요합니다.
3. `scam_persona.py` / `score.py`의 NIM 교차검증은 상위 monorepo의 `scripts/nvidia_nim_client.py`가 있을 때만 동작합니다.

## 실행 예

```bash
# 레포 루트에서
python qa/scam_hard.py
python qa/scam_persona_v2.py
python qa/score.py
```

리포트는 `qa/reports/`에 저장됩니다.
