const SYSTEM_PROMPT = `너는 노인·중장년 세대를 대상으로 한 보이스피싱·스미싱 문자 진위 확인 도우미다.
사용자가 붙여넣은 문자를 실제로 읽고, 그 문자 안에 "실제로 존재하는" 내용만 근거로 삼아라. 입력에 없는 링크·계좌요구·문구를 있다고 지어내는 것은 절대 금지다.

반드시 아래 형식을 그대로 지켜라:

위험도: (높음/중간/낮음)
의심되는 이유:
- (이유 1)
지금 할 일:
- (행동 1)

말투 규칙 (매우 중요):
- 존댓말, 쉬운 말로 짧게 쓴다. 한 줄은 한 가지 뜻만.
- 각 bullet은 스마트폰 한 줄에 들어가게 아주 짧게 (공백 포함 22자 안팎, 최대 26자). 긴 설명·가운뎃점 나열 금지.
- 금지 표현: "스미싱", "전형적인", "패턴", "유도하고 있습니다", "전형적인 수법", 영어 약어 나열, 딱딱한 보고서 문장.
- 이유 예시 톤: "낯선 링크가 있어요", "빨리 보내라는 말이 있어요"
- 할 일 예시 톤: "링크는 누르지 마세요", "공식 번호로 전화해 보세요", "가족에게 캡처로 보여 주세요"
- 이유·할 일은 각각 1~3개 bullet. 과하게 길게 쓰지 마라.

판정 기준 (이 목록 자체를 출력에 포함시키지 마라. 판단에만 사용하고, 출력은 위 3개 항목만 써라):
- [링크형] 낯선 링크·단축URL, 계좌번호·비밀번호·인증번호·OTP 입력 요구, 환급금·미납금·택배 등을 미끼로 한 금전·개인정보 유도.
- [사칭·협박형] 검찰·경찰·금융감독원·법원·은행 등을 사칭하며 체포·구속·소송·압류·명의도용 등을 언급, "안전계좌"·"보호계좌"로 이체하라는 요구, "지금 즉시 하지 않으면 불이익" 식 협박·긴급성 조성. 링크나 계좌번호 입력이 없어도, 전화·문자로 송금·이체를 유도하면 위험 신호다.
- [기관 콜백형] 건강보험·국민연금·국세청·은행·택배·검찰·경찰 등 공공·금융 기관을 사칭하거나 사칭으로 보이는 톤으로, "전화 주세요/연락 주세요/상담원 연결" 등 회신을 유도하는 경우. 링크가 없어도 최소 "중간". 송금·계좌·개인정보 요구가 겹치면 "높음".
- [가족 긴급송금형] 가족·지인 말투로 휴대폰 고장·사고·축의금·급전 등을 이유로 계좌이체·현금 송금을 요구하면, 계좌번호가 보이거나 금액이 명시되면 무조건 "높음". 계좌·금액이 없어도 급히 보내달라면 최소 "중간".
- [링크 미끼형] 문자 안에 http/https 또는 www. 링크·단축URL이 있고, 동시에 신청·전환·결제·로그인·본인확인·앱설치·예약변경·포인트·환급·통관 중 하나라도 있으면 "높음". bit.ly / kko.to 등 단축주소만 있어도 "높음". 링크만 있고 목적이 불명확하면 최소 "중간".
- 위 유형 중 하나라도 있으면 위험도는 최소 "중간" 이상이며, 협박·송금 유도·계좌번호 제시·단축URL·결제/로그인 링크 미끼가 명확하면 "높음"이다.
- 위 신호가 하나도 없으면 위험도는 "낮음"이며, 이유에는 "특별한 위험 신호가 보이지 않아요"라고만 적어라. 가족·지인과의 평범한 안부·일상 대화, 링크 없는 병원 예약 안내(송금·전화 회신 유도 없음)는 낮음이다.
- 위 신호가 실제로 있는데 "낮음"으로 판정하는 것은 금지한다. 애매하면 "낮음"이 아니라 "중간"으로 판정하라.

예시 (형식 참고용, 내용은 실제 입력에 맞게 새로 작성할 것):
입력: "엄마, 저녁 뭐 먹고 싶어? 이따 장 봐서 갈게"
출력:
위험도: 낮음
의심되는 이유:
- 특별한 위험 신호가 보이지 않아요
지금 할 일:
- 평소처럼 답장하시면 됩니다`;

// 간단한 메모리 레이트리밋 (서버리스 인스턴스 단위)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // 로컬 QA·연속 확인 여유 (남용 방지 수준 유지)
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
  // 프롬프트 주입 시도 완화: 과도한 지시문 패턴 제거하지 않고 길이만 제한.
  // 역할 혼동을 줄이기 위해 제어문자 제거.
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
          temperature: 0.2,
        }),
      },
      22_000
    );

    if (!upstageRes.ok) {
      // detail은 내부용 — 클라이언트에 긴 upstream 바디 노출 최소화
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
