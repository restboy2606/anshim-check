/**
 * 경찰청 안전Dream 실종검색 OpenAPI 프록시
 * 가이드: https://www.safe182.go.kr/home/api/guide5.do
 * 필수: 응답·화면에 [자료 출처: 경찰청] 표기
 *
 * env:
 *   SAFE182_ESNTL_ID  — 고유아이디
 *   SAFE182_AUTH_KEY  — 인증키
 */

const TARGET_LABEL = {
  "010": "아동",
  "020": "가출인",
  "040": "시설보호무연고",
  "060": "지적장애인",
  "061": "지적장애인(아동)",
  "062": "지적장애인(성인)",
  "070": "치매",
  "080": "기타",
};

function pickPhotoUrl(item) {
  // 안전Dream 실측 응답: 사진은 URL이 아니라 tknphotoFile에 base64(JPEG) 원문으로 옴.
  const b64 = item.tknphotoFile || item.tknphoto;
  if (b64 && typeof b64 === "string" && !/^https?:\/\//i.test(b64)) {
    const clean = b64.replace(/\s+/g, "");
    if (clean.length > 100) return `data:image/jpeg;base64,${clean}`;
  }

  // 혹시 URL 형태로 오는 필드가 있으면 그것도 수용 (방어적)
  const urlCandidates = [
    item.photoFile,
    item.photoUrl,
    item.file2,
    item.imgUrl,
    item.imageUrl,
  ].filter(Boolean);

  for (const c of urlCandidates) {
    const s = String(c);
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `https://www.safe182.go.kr${s}`;
  }
  return null;
}

function normalizeItem(raw, index) {
  const code = String(raw.writngTrgetDscd || "");
  return {
    id: String(raw.msspsnId || raw.id || `${raw.nm || "unknown"}-${raw.occrde || index}`),
    name: raw.nm || "이름 비공개",
    sex: raw.sexdstnDscd || "",
    ageThen: raw.age != null ? String(raw.age) : "",
    ageNow: raw.ageNow != null ? String(raw.ageNow) : "",
    place: raw.occrAdres || "",
    date: raw.occrde || "",
    targetCode: code,
    target: TARGET_LABEL[code] || code || "",
    dressing: raw.alldressingDscd || "",
    photoUrl: pickPhotoUrl(raw),
    detailUrl: "https://www.safe182.go.kr/",
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET만 지원합니다." });
  }

  const esntlId = process.env.SAFE182_ESNTL_ID;
  const authKey = process.env.SAFE182_AUTH_KEY;

  if (!esntlId || !authKey) {
    return res.status(200).json({
      ok: false,
      needKey: true,
      source: "경찰청",
      sourceNote: "자료 출처: 경찰청",
      portal: "https://www.safe182.go.kr/",
      call: "182",
      guide: "https://www.safe182.go.kr/home/api/guide5.do",
      items: [],
      message:
        "안전Dream 인증키를 연결하면 이 자리에 실종아동 사진이 표시됩니다. (과자 뒷면처럼)",
    });
  }

  try {
    const body = new URLSearchParams();
    body.set("esntlId", esntlId);
    body.set("authKey", authKey);
    body.set("rowSize", "16");
    body.set("page", "1");
    // 실종 취약계층 전반: 아동·시설보호무연고·지적장애·치매 (부모님 세대 공감 + 자연스러운 다양성)
    body.append("writngTrgetDscds", "010"); // 아동
    body.append("writngTrgetDscds", "040"); // 시설보호무연고
    body.append("writngTrgetDscds", "060"); // 지적장애인
    body.append("writngTrgetDscds", "061"); // 지적장애(아동)
    body.append("writngTrgetDscds", "062"); // 지적장애(성인)
    body.append("writngTrgetDscds", "070"); // 치매

    const upstream = await fetch(
      "https://www.safe182.go.kr/api/lcm/findChildList.do",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json,text/plain,*/*",
        },
        body,
      }
    );

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        ok: false,
        error: "안전Dream 응답 파싱 실패",
        detail: text.slice(0, 200),
      });
    }

    if (String(data.result) !== "00") {
      return res.status(200).json({
        ok: false,
        needKey: false,
        source: "경찰청",
        sourceNote: "자료 출처: 경찰청",
        portal: "https://www.safe182.go.kr/",
        call: "182",
        items: [],
        message: data.msg || "조회에 실패했습니다.",
        result: data.result,
      });
    }

    const list = Array.isArray(data.list) ? data.list : [];
    const items = list.map(normalizeItem).filter((x) => x.name);

    return res.status(200).json({
      ok: true,
      needKey: false,
      source: "경찰청",
      sourceNote: "자료 출처: 경찰청",
      portal: "https://www.safe182.go.kr/",
      call: "182",
      totalCount: data.totalCount ?? items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "실종정보 조회 중 오류",
      detail: String(err.message || err),
    });
  }
}
