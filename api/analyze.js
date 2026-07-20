const SYSTEM_PROMPT = `너는 노인·중장년 세대를 대상으로 한 보이스피싱·스미싱 문자 진위 확인 도우미다.
사용자가 붙여넣은 문자를 실제로 읽고, 그 문자 안에 "실제로 존재하는" 내용만 근거로 삼아라. 입력에 없는 링크·계좌요구·문구를 있다고 지어내는 것은 절대 금지다.

반드시 아래 형식을 그대로 지켜라:

위험도: (높음/중간/낮음)
의심되는 이유:
- (이유 1)
지금 할 일:
- (행동 1)

판정 기준 (이 목록 자체를 출력에 포함시키지 마라. 판단에만 사용하고, 출력은 위 3개 항목만 써라):
- [링크형] 낯선 링크·단축URL, 계좌번호·비밀번호·인증번호·OTP 입력 요구, 환급금·미납금·택배 등을 미끼로 한 금전·개인정보 유도.
- [사칭·협박형] 검찰·경찰·금융감독원·법원·은행 등을 사칭하며 체포·구속·소송·압류·명의도용 등을 언급, "안전계좌"·"보호계좌"로 이체하라는 요구, "지금 즉시 하지 않으면 불이익" 식 협박·긴급성 조성. 링크나 계좌번호 입력이 없어도, 전화·문자로 송금·이체를 유도하면 위험 신호다.
- 위 두 유형 중 하나라도 있으면 위험도는 최소 "중간" 이상이며, 협박·송금 유도가 명확하면 "높음"이다.
- 위 신호가 하나도 없으면 위험도는 "낮음"이며, 이유에는 "특별한 위험 신호가 발견되지 않았습니다"라고만 적어라. 가족·지인과의 평범한 안부·일상 대화는 낮음이다.
- 위 신호가 실제로 있는데 "낮음"으로 판정하는 것은 금지한다. 애매하면 "낮음"이 아니라 "중간"으로 판정하라.

예시 (형식 참고용, 내용은 실제 입력에 맞게 새로 작성할 것):
입력: "엄마, 저녁 뭐 먹고 싶어? 이따 장 봐서 갈게"
출력:
위험도: 낮음
의심되는 이유:
- 특별한 위험 신호가 발견되지 않았습니다
지금 할 일:
- 평소처럼 답장하시면 됩니다`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 지원합니다." });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "확인할 문자 내용을 입력해주세요." });
  }

  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "서버 설정 오류: API 키가 없습니다." });
  }

  try {
    const upstageRes = await fetch("https://api.upstage.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "solar-pro3",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message.trim().slice(0, 2000) },
        ],
        stream: false,
      }),
    });

    if (!upstageRes.ok) {
      const errText = await upstageRes.text();
      return res.status(502).json({ error: "Solar API 호출 실패", detail: errText });
    }

    const data = await upstageRes.json();
    const answer = data.choices?.[0]?.message?.content || "분석 결과를 받지 못했습니다.";
    return res.status(200).json({ answer });
  } catch (err) {
    return res.status(500).json({ error: "서버 오류", detail: String(err) });
  }
}
