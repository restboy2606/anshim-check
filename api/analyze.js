const SYSTEM_PROMPT = `너는 노인·중장년 세대를 대상으로 한 보이스피싱·스미싱 문자 진위 확인 도우미다.
사용자가 붙여넣은 문자를 실제로 읽고, 그 문자 안에 "실제로 존재하는" 내용만 근거로 삼아라. 입력에 없는 링크·계좌요구·문구를 있다고 지어내는 것은 절대 금지다.

반드시 아래 형식을 그대로 지켜라:

위험점수: (0부터 100 사이 정수만)
위험도: (높음/중간/낮음)
의심되는 이유:
- (이유 1)
지금 할 일:
- (행동 1)

점수와 위험도 짝 (반드시 일치):
- 0~29 → 낮음
- 30~69 → 중간
- 70~100 → 높음

점수 가이드 (대략):
- 일상 안부·가족 대화(위험신호 없음): 0~12
- 병원·학교 등 링크 없는 일반 안내: 5~18
- 기관 사칭 톤 + 회신·전화 유도(링크·계좌 없음): 45~60 (중간)
- 낯선 단축URL만 있어도: 55~75
- 링크 + 환급/결제/로그인/통관/신청: 80~95
- 검찰·금감원·은행 사칭 + 이체·협박: 90~100
- 가족·지인 말투 + 계좌/금액 급전: 85~98

말투 규칙 (매우 중요):
- 존댓말, 쉬운 말로 짧게. 한 줄에 한 가지 뜻.
- 각 bullet은 2~3줄까지 허용(공백 포함 대략 40~70자). 너무 짧게 끊어서 의미가 잘리지 않게 쓴다.
- 금지: "스미싱", "전형적인", "패턴", "유도하고 있습니다", 영어 약어 나열.
- 할 일 안내 번호: 기본은 피싱안심SOS(https://www.counterscam112.go.kr/)와 상담전화 1394.
- "112"는 지금 당장 위협·납치·폭행처럼 긴급 위험일 때만. 일반 의 문자 확인에서는 112를 쓰지 마라.
- 이유·할 일은 각각 1~3개 bullet.

판정 기준 (이 목록 자체를 출력에 포함시키지 마라):
- [링크형] 낯선 링크·단축URL, 계좌·비밀번호·OTP 요구, 환급·미납·택배 미끼.
- [사칭·협박형] 검찰·경찰·금감원·법원·은행 사칭, 안전/보호계좌 이체, 긴급 협박.
- [기관 콜백형] 공공·금융 톤으로 회신·전화만 유도 → 최소 중간(45+). 송금·계좌 겹치면 높음.
- [가족 긴급송금형] 가족 말투 + 계좌/금액 → 무조건 높음.
- [링크 미끼형] http/https/www 또는 bit.ly 등 + 신청·결제·로그인 등이면 높음. 단축주소만 있어도 최소 중간.
- 위험 신호가 실제로 있는데 낮음으로 판정 금지. 애매하면 중간.

예시:
입력: "엄마, 저녁 뭐 먹고 싶어? 이따 장 봐서 갈게"
출력:
위험점수: 5
위험도: 낮음
의심되는 이유:
- 특별한 위험 신호가 보이지 않아요
지금 할 일:
- 평소처럼 답장하시면 됩니다`;

// 간단한 메모리 레이트리밋 (서버리스 인스턴스 단위)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const hits = new Map();

function clientKey(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || req.headers?.["x-real-ip"] || "unknown";
}

function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    hits.set(key, arr);
    return true;
  }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

function sanitizeUserMessage(raw) {
  return String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, 2000);
}

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 지원합니다." });
  }

  if (rateLimited(clientKey(req))) {
    return res.status(429).json({
      error: "요청이 너무 많아요. 잠시 후 다시 눌러 주세요.",
    });
  }

  const message = sanitizeUserMessage((req.body || {}).message || "");
  if (!message) {
    return res.status(400).json({ error: "확인할 문자 내용을 입력해주세요." });
  }

  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "서버 설정 오류: API 키가 없습니다." });
  }

  try {
    const upstageRes = await fetchWithTimeout(
      "https://api.upstage.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "solar-pro3",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
          stream: false,
          temperature: 0.15,
        }),
      },
      22_000
    );

    if (!upstageRes.ok) {
      await upstageRes.text().catch(() => "");
      return res.status(502).json({
        error: "확인 서버가 잠시 응답하지 않아요. 다시 시도해 주세요.",
      });
    }

    const data = await upstageRes.json();
    const answer =
      data.choices?.[0]?.message?.content || "분석 결과를 받지 못했습니다.";
    return res.status(200).json({ answer: String(answer).slice(0, 4000) });
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return res.status(aborted ? 504 : 500).json({
      error: aborted
        ? "확인이 오래 걸려 중단됐어요. 다시 한 번 눌러 주세요."
        : "서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
    });
  }
}
