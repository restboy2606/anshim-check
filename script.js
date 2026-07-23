const form = document.getElementById("check-form");
const textarea = document.getElementById("message-input");
const submitBtn = document.getElementById("submit-btn");
const bottomSubmit = document.getElementById("bottom-submit");
const charCount = document.getElementById("char-count");
const charMeta = document.querySelector(".field-meta");
const loading = document.getElementById("loading");

const resultPanel = document.getElementById("result");
const resultStatus = document.getElementById("result-status");
const resultEmoji = document.getElementById("result-emoji");
const resultLevel = document.getElementById("result-level");
const resultReasons = document.getElementById("result-reasons");
const resultActions = document.getElementById("result-actions");
const resultRaw = document.getElementById("result-raw");
const resultSourceBody = document.getElementById("result-source-body");
const resultSource = document.getElementById("result-source");
const howtoStrip = document.getElementById("howto-strip");
const shareFamilyBtn = document.getElementById("share-family-btn");
const ttsBtn = document.getElementById("tts-btn");
const resetCheckBtn = document.getElementById("reset-check-btn");
const toastEl = document.getElementById("toast");

const missingTrack = document.getElementById("missing-track");
const missingGrid = document.getElementById("missing-grid");
const missingStage = document.getElementById("missing-stage");
const missingNote = document.getElementById("missing-note");
const missingPrev = document.getElementById("missing-prev");
const missingNext = document.getElementById("missing-next");
const missingCounter = document.getElementById("missing-counter");
const missingControls = document.getElementById("missing-controls");
const resultScoreEl = document.getElementById("result-score");
const resultScoreFill = document.getElementById("result-score-fill");

const LEVEL_UI = {
  high: { label: "높음", emoji: "🚨", cls: "level-high" },
  mid: { label: "중간", emoji: "⚠️", cls: "level-mid" },
  low: { label: "낮음", emoji: "✅", cls: "level-low" },
  unknown: { label: "확인 완료", emoji: "💬", cls: "level-unknown" },
};

const APP_URL = "https://anshim-check.vercel.app";
const FETCH_TIMEOUT_MS = 25_000;
let inFlight = false;
/** @type {{ level: string, score: number|null, reasons: string[], actions: string[], raw: string, message: string } | null} */
let lastParsed = null;
let ttsSpeaking = false;
let toastTimer = null;

const RISK_KEYWORDS = [
  "환급",
  "미납",
  "택배",
  "인증번호",
  "OTP",
  "체포",
  "이체",
  "안전계좌",
  "보호계좌",
];

/** 클릭 시 입력창에 채워지는 데모용 사기 문자 예시 (저작권 없는 직접 작성) */
const EXAMPLE_MESSAGES = {
  nhis: `[국민건강보험] 고객님, 환급금 32,900원이 발생했습니다.
오늘 24시 전 미신청 시 소멸됩니다.
아래 링크에서 계좌를 등록해 주세요.
https://nhis-refund-check.example.com/apply`,
  delivery: `[한진택배] 배송지 오류로 반송 예정입니다.
주소·결제 정보를 수정하지 않으면 반송됩니다.
https://hanjin-reship.example.net/p/88`,
  prosecutor: `[서울중앙지검] 귀하의 명의로 금융사기 사건이 접수되었습니다.
계좌 동결 예정이며, 확인 전화 후 보호계좌로 이체 안내를 받으시기 바랍니다.
직통: 02-0000-0000`,
  family: `엄마 나 핸드폰 고장나서 이 번호로 연락해.
지금 급해서 그런데 우리은행 1002-000-000000 으로 50만원만 빨리 보내줘.
아빠한테는 말 말고!!`,
};

function setBusy(busy) {
  inFlight = busy;
  submitBtn.disabled = busy;
  bottomSubmit.disabled = busy;
  submitBtn.textContent = busy ? "확인 중..." : "확인하기";
  bottomSubmit.textContent = busy ? "확인 중..." : "확인하기";
  submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
  bottomSubmit.setAttribute("aria-busy", busy ? "true" : "false");
  loading.hidden = !busy;
  loading.setAttribute("aria-hidden", busy ? "false" : "true");
  if (busy) {
    loading.setAttribute("role", "alertdialog");
    loading.setAttribute("aria-label", "문자를 확인하는 중");
  }
}

function levelFromScore(score) {
  if (score == null || Number.isNaN(score)) return null;
  if (score <= 29) return "low";
  if (score <= 69) return "mid";
  return "high";
}

function parseAnswer(text) {
  const raw = String(text || "").trim();
  const scoreMatch = raw.match(/위험점수\s*[:：]\s*(\d{1,3})/);
  let score = scoreMatch ? Math.min(100, Math.max(0, Number(scoreMatch[1]))) : null;

  const levelMatch = raw.match(/위험도\s*[:：]\s*(높음|중간|낮음)/);
  let level = "unknown";
  if (levelMatch) {
    if (levelMatch[1] === "높음") level = "high";
    else if (levelMatch[1] === "중간") level = "mid";
    else if (levelMatch[1] === "낮음") level = "low";
  }

  // 점수가 있으면 점수 구간이 우선 (모델 불일치 보정)
  const fromScore = levelFromScore(score);
  if (fromScore) level = fromScore;
  // 점수 없고 위험도만 있으면 대표 점수 부여
  if (score == null && level !== "unknown") {
    score = level === "high" ? 85 : level === "mid" ? 50 : 10;
  }

  const reasons = extractBullets(
    raw,
    /의심되는\s*이유\s*[:：]?/,
    /지금\s*할\s*일\s*[:：]?/
  );
  const actions = extractBullets(raw, /지금\s*할\s*일\s*[:：]?/, null);

  return { level, score, reasons, actions, raw };
}

function extractBullets(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return [];
  let slice = text.slice(start).replace(startRe, "");
  if (endRe) {
    const end = slice.search(endRe);
    if (end >= 0) slice = slice.slice(0, end);
  }
  return slice
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-•·*]+/, "").trim())
    .filter(
      (l) =>
        l &&
        !/^위험도/.test(l) &&
        !/^위험점수/.test(l) &&
        !/^의심되는/.test(l) &&
        !/^지금\s*할\s*일/.test(l)
    )
    .map(polishDisplayLine);
}

/** 화면용 문장 정리 — 의미는 유지, 읽기 리듬만 맞춤 */
function polishDisplayLine(raw) {
  let s = String(raw || "").trim();
  if (!s) return s;
  // 과도한 가운뎃점 나열 → 쉼표 리듬
  s = s.replace(/\s*·\s*/g, ", ");
  s = s.replace(/\s{2,}/g, " ");
  s = s.replace(/,{2,}/g, ",");
  s = s.replace(/,\s*,/g, ", ");
  // URL 전문은 짧게
  s = s.replace(/https?:\/\/[^\s]+/gi, "피싱안심SOS");
  s = s.replace(/counterscam112\.go\.kr[^\s]*/gi, "피싱안심SOS");
  // 끝 공백·중복 종결
  s = s.replace(/\s+([.。!?？])/g, "$1").trim();
  return s;
}

function renderList(el, items, emptyText) {
  el.innerHTML = "";
  const list = items.length ? items : [emptyText];
  for (const item of list) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "result-item-text";
    text.textContent = polishDisplayLine(item); // XSS 방지: textContent only
    li.appendChild(text);
    el.appendChild(li);
  }
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.add("is-visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
    toastEl.hidden = true;
  }, 2200);
}

function setHowtoVisible(visible) {
  if (!howtoStrip) return;
  howtoStrip.hidden = !visible;
}

function stopTts() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  ttsSpeaking = false;
  if (ttsBtn) {
    ttsBtn.textContent = "읽어주기";
    ttsBtn.setAttribute("aria-pressed", "false");
  }
}

/** 위험 토큰 하이라이트 — DOM 노드만 생성 (XSS 방지) */
function highlightRiskTokens(text) {
  const root = document.createDocumentFragment();
  const src = String(text || "");
  if (!src) {
    root.appendChild(document.createTextNode(""));
    return root;
  }

  const keywordAlt = RISK_KEYWORDS.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");

  // URL · 전화 · 계좌형 숫자열 · 위험 키워드 (lookbehind 없이 넓은 호환)
  const re = new RegExp(
    [
      "(?:https?:\\/\\/|www\\.)[^\\s<>\"']+",
      "(?:bit\\.ly|t\\.co|goo\\.gl|tinyurl\\.com|me2\\.do|han\\.gl|url\\.kr)\\/[^\\s<>\"']+",
      "(?:0\\d{1,2}[-).\\s]?\\d{3,4}[-.\\s]?\\d{4})",
      "(?:\\d{3,6}[-\\s]\\d{2,6}[-\\s]\\d{2,8})",
      "(?:\\d{10,16})",
      keywordAlt ? `(?:${keywordAlt})` : "(?!)",
    ].join("|"),
    "gi"
  );

  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      root.appendChild(document.createTextNode(src.slice(last, m.index)));
    }
    const mark = document.createElement("mark");
    mark.className = "risk-mark";
    mark.textContent = m[0];
    root.appendChild(mark);
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    root.appendChild(document.createTextNode(src.slice(last)));
  }
  return root;
}

function renderHighlightedSource(message) {
  if (!resultSourceBody) return;
  resultSourceBody.textContent = "";
  resultSourceBody.appendChild(highlightRiskTokens(message));
}

function buildShareText(parsed) {
  const ui = LEVEL_UI[parsed.level] || LEVEL_UI.unknown;
  const score =
    parsed.score != null && !Number.isNaN(parsed.score) ? parsed.score : "—";
  const reasons = (parsed.reasons || [])
    .slice(0, 2)
    .map((r) => polishDisplayLine(r))
    .filter(Boolean);
  const reasonLine = reasons.length
    ? `의심되는 이유: ${reasons.join(" / ")}`
    : "의심되는 이유: 결과를 함께 확인해 주세요.";
  const rawMsg = String(parsed.message || "").replace(/\s+/g, " ").trim();
  const snippet =
    rawMsg.length > 80 ? `${rawMsg.slice(0, 80)}…` : rawMsg || "(없음)";

  return [
    `[안심체크] 위험 점수 ${score}점(${ui.label})`,
    reasonLine,
    `원문: ${snippet}`,
    APP_URL,
  ].join("\n");
}

async function shareWithFamily() {
  if (!lastParsed) {
    showToast("먼저 문자를 확인해 주세요");
    return;
  }
  const text = buildShareText(lastParsed);
  const payload = { title: "안심체크 확인 결과", text };

  try {
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
  } catch (err) {
    // 사용자가 공유 시트를 닫은 경우 — 조용히 종료
    if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) {
      return;
    }
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast("복사됐어요");
      return;
    }
  } catch {
    /* fall through */
  }

  // 구형 폴백
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("복사됐어요");
  } catch {
    showToast("복사에 실패했어요. 화면을 캡처해 주세요");
  }
}

function speakResult() {
  if (!("speechSynthesis" in window) || !ttsBtn) return;

  if (ttsSpeaking) {
    stopTts();
    return;
  }
  if (!lastParsed) {
    showToast("먼저 문자를 확인해 주세요");
    return;
  }

  const ui = LEVEL_UI[lastParsed.level] || LEVEL_UI.unknown;
  const score =
    lastParsed.score != null && !Number.isNaN(lastParsed.score)
      ? lastParsed.score
      : "확인 중";
  const firstAction =
    (lastParsed.actions && lastParsed.actions[0]) ||
    "피싱안심에스오에스 또는 1394로 상담해 보세요.";
  const spoken = `위험 점수 ${score}점, ${ui.label}. ${polishDisplayLine(
    firstAction
  )}`;

  stopTts();
  const utter = new SpeechSynthesisUtterance(spoken);
  utter.lang = "ko-KR";
  utter.rate = 0.95;
  utter.onend = () => stopTts();
  utter.onerror = () => stopTts();
  ttsSpeaking = true;
  ttsBtn.textContent = "멈추기";
  ttsBtn.setAttribute("aria-pressed", "true");
  window.speechSynthesis.speak(utter);
}

function resetCheck() {
  stopTts();
  lastParsed = null;
  if (textarea) {
    textarea.value = "";
    updateCharCount();
  }
  if (resultPanel) resultPanel.hidden = true;
  if (resultSourceBody) resultSourceBody.textContent = "";
  if (resultRaw) {
    resultRaw.hidden = true;
    resultRaw.textContent = "";
  }
  document
    .querySelectorAll(".example-card.is-active")
    .forEach((btn) => btn.classList.remove("is-active"));
  setHowtoVisible(true);
  if (textarea) textarea.focus();
}

function showResult(answerText, sourceMessage) {
  const parsed = parseAnswer(answerText);
  parsed.message = String(sourceMessage || textarea?.value || "").trim();
  lastParsed = parsed;

  const ui = LEVEL_UI[parsed.level] || LEVEL_UI.unknown;
  const score = parsed.score != null ? parsed.score : "—";

  resultStatus.className = "result-status " + ui.cls;
  if (parsed.level === "high") {
    resultStatus.classList.add("is-alerting");
  }
  resultEmoji.textContent = ui.emoji;
  if (resultScoreEl) resultScoreEl.textContent = String(score);
  resultLevel.textContent = ui.label;
  if (resultScoreFill) {
    const pct = typeof score === "number" ? score : 0;
    resultScoreFill.style.width = `${pct}%`;
  }
  resultPanel.setAttribute(
    "aria-label",
    `확인 결과, 위험 점수 ${score}점, ${ui.label}`
  );

  renderHighlightedSource(parsed.message);

  renderList(
    resultReasons,
    parsed.reasons,
    "이 연락에서 눈에 띈 점을 다시 확인해 주세요."
  );
  renderList(
    resultActions,
    parsed.actions,
    "피싱안심SOS 또는 1394로 상담해 보세요."
  );

  const weakParse = parsed.reasons.length === 0 && parsed.actions.length === 0;
  resultRaw.hidden = !weakParse;
  resultRaw.textContent = weakParse ? parsed.raw : "";

  setHowtoVisible(false);
  stopTts();
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showError(message) {
  lastParsed = {
    level: "unknown",
    score: null,
    reasons: [message],
    actions: ["잠시 후 다시 시도해 주세요."],
    raw: message,
    message: String(textarea?.value || "").trim(),
  };
  resultStatus.className = "result-status level-unknown";
  resultEmoji.textContent = "❗";
  if (resultScoreEl) resultScoreEl.textContent = "—";
  resultLevel.textContent = "실패";
  if (resultScoreFill) resultScoreFill.style.width = "0%";
  resultPanel.setAttribute("aria-label", "확인 실패");
  renderHighlightedSource(lastParsed.message);
  renderList(resultReasons, [message], message);
  renderList(resultActions, ["잠시 후 다시 시도해 주세요."], "");
  resultRaw.hidden = true;
  setHowtoVisible(false);
  stopTts();
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function fetchJson(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck() {
  if (inFlight) return;

  const message = textarea.value.trim();
  if (!message) {
    textarea.focus();
    return;
  }
  if (message.length > 2000) {
    showError("글자가 너무 길어요. 2000자 이내로 줄여 주세요.");
    return;
  }

  setBusy(true);
  resultPanel.hidden = true;
  stopTts();

  try {
    const { res, data } = await fetchJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      throw new Error(data.error || "오류가 발생했습니다.");
    }
    showResult(data.answer || "", message);
  } catch (err) {
    if (err?.name === "AbortError") {
      showError("확인이 오래 걸려 중단됐어요. 다시 한 번 눌러 주세요.");
    } else {
      showError(err.message || "네트워크 오류가 발생했습니다.");
    }
  } finally {
    setBusy(false);
  }
}

function badgeFor(code, label) {
  const c = String(code || "");
  if (c === "010" || c === "061") return { cls: "b-child", label: "아동" };
  if (c === "070") return { cls: "b-dementia", label: "치매 어르신" };
  if (c === "060" || c === "062") return { cls: "b-disability", label: "발달장애" };
  if (c === "040") return { cls: "b-unknown", label: "보호시설" };
  if (c === "020") return { cls: "b-runaway", label: "가출인" };
  return { cls: "b-default", label: label || "실종" };
}

function formatDate(raw) {
  const s = String(raw || "");
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  }
  return s;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMissingEmpty(message, needKey) {
  if (!missingTrack) return;
  stopMissingAuto();
  missingTrack.innerHTML = "";
  const page = document.createElement("div");
  page.className = "snack-page";
  const empty = document.createElement("div");
  empty.className = "snack-empty";
  empty.innerHTML = `
    <p class="snack-empty-title">사진을 준비 중이에요</p>
    <p class="snack-empty-body">${escapeHtml(message)}</p>
    ${
      needKey
        ? `<p class="snack-empty-tip">안전Dream 인증키를 연결하면<br/>실제 공개 사진이 여기에 표시됩니다.</p>`
        : ""
    }
  `;
  page.appendChild(empty);
  missingTrack.appendChild(page);
  missingTrack.style.transform = "translate3d(0,0,0)";
  missingNote.textContent = "자료 출처: 경찰청";
  if (missingControls) missingControls.hidden = true;
  const swipeHint = document.getElementById("missing-swipe-hint");
  if (swipeHint) swipeHint.hidden = true;
}

// ---- 실종보드 앨범형 캐러셀 ----
const MISSING_PAGE_SIZE = 4;
const MISSING_AUTO_MS = 7000;
let missingItems = [];
let missingPage = 0;
let missingTimer = null;
let missingDragX = 0;
let missingAnimating = false;
const prefersReducedMotion =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function missingPageCount() {
  return Math.max(1, Math.ceil(missingItems.length / MISSING_PAGE_SIZE));
}

function stageWidth() {
  return (missingStage && missingStage.clientWidth) || 1;
}

function buildMissingCard(item) {
  const card = document.createElement("a");
  card.className = "snack-card";
  card.href = item.detailUrl || "https://www.safe182.go.kr/";
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.setAttribute(
    "aria-label",
    `${item.name} 실종 정보, 안전Dream에서 자세히 보기`
  );

  const photo = document.createElement("div");
  photo.className = "snack-photo";
  if (item.photoUrl) {
    const img = document.createElement("img");
    img.src = item.photoUrl;
    img.alt = `${item.name} 공개 사진`;
    img.loading = "lazy";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      photo.classList.add("no-photo");
      photo.textContent = "사진 없음";
      img.remove();
    };
    photo.appendChild(img);
  } else {
    photo.classList.add("no-photo");
    photo.textContent = "사진 없음";
  }

  const badge = badgeFor(item.targetCode, item.target);
  const meta = document.createElement("div");
  meta.className = "snack-meta";
  meta.innerHTML = `
    <span class="snack-badge ${badge.cls}">${escapeHtml(badge.label)}</span>
    <p class="snack-name">${escapeHtml(item.name)}</p>
    <p class="snack-line">${escapeHtml(
      [item.sex, item.ageNow ? `지금 ${item.ageNow}세` : ""]
        .filter(Boolean)
        .join(" · ")
    )}</p>
    <p class="snack-line dim">${escapeHtml(
      [formatDate(item.date), item.place].filter(Boolean).join(" · ")
    )}</p>
  `;

  card.appendChild(photo);
  card.appendChild(meta);
  return card;
}

function setTrackOffset(pageIndex, dragPx, animate) {
  if (!missingTrack) return;
  const w = stageWidth();
  const x = -pageIndex * w + (dragPx || 0);
  missingTrack.style.transition = animate
    ? "transform 0.32s cubic-bezier(0.22, 0.9, 0.28, 1)"
    : "none";
  missingTrack.style.transform = `translate3d(${x}px, 0, 0)`;
}

function layoutMissingPages() {
  if (!missingTrack || !missingStage) return;
  const w = stageWidth();
  const count = missingPageCount();
  missingTrack.style.width = `${Math.max(1, count) * w}px`;
  Array.from(missingTrack.children).forEach((el) => {
    el.style.flex = `0 0 ${w}px`;
    el.style.width = `${w}px`;
    el.style.maxWidth = `${w}px`;
  });
}

function buildMissingTrack() {
  if (!missingTrack) return;
  missingTrack.innerHTML = "";
  const count = missingPageCount();
  for (let p = 0; p < count; p++) {
    const page = document.createElement("div");
    page.className = "snack-page snack-grid";
    page.setAttribute("data-page", String(p));
    const start = p * MISSING_PAGE_SIZE;
    const slice = missingItems.slice(start, start + MISSING_PAGE_SIZE);
    slice.forEach((item) => page.appendChild(buildMissingCard(item)));
    missingTrack.appendChild(page);
  }
  layoutMissingPages();
}

function renderMissingPage(page, { animate = true } = {}) {
  const count = missingPageCount();
  missingPage = ((page % count) + count) % count;
  missingDragX = 0;
  setTrackOffset(missingPage, 0, animate && !prefersReducedMotion);

  if (missingCounter) {
    missingCounter.textContent = `${missingPage + 1} / ${count}`;
  }
  if (missingControls) missingControls.hidden = count <= 1;
  const swipeHint = document.getElementById("missing-swipe-hint");
  if (swipeHint) swipeHint.hidden = count <= 1;
}

function stopMissingAuto() {
  if (missingTimer) {
    window.clearInterval(missingTimer);
    missingTimer = null;
  }
}

function startMissingAuto() {
  stopMissingAuto();
  if (prefersReducedMotion || missingPageCount() <= 1) return;
  missingTimer = window.setInterval(
    () => goMissingPage(1),
    MISSING_AUTO_MS
  );
}

function goMissingPage(delta) {
  if (missingAnimating) return;
  stopMissingAuto();
  const count = missingPageCount();
  if (count <= 1) return;
  missingAnimating = true;
  renderMissingPage(missingPage + delta, { animate: true });
  window.setTimeout(() => {
    missingAnimating = false;
    startMissingAuto();
  }, 340);
}

/** 앨범 앱처럼: 드래그 중 다음/이전 페이지가 같이 보임 */
function bindMissingSwipe() {
  const stage = missingStage || missingTrack;
  if (!stage || !missingTrack) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = null;
  let didSwipe = false;
  const THRESHOLD_RATIO = 0.18;

  const onStart = (x, y) => {
    if (missingPageCount() <= 1 || missingAnimating) return;
    startX = x;
    startY = y;
    tracking = true;
    locked = null;
    didSwipe = false;
    stopMissingAuto();
    missingTrack.classList.add("is-dragging");
  };

  const onMove = (x, y, e) => {
    if (!tracking) return;
    const dx = x - startX;
    const dy = y - startY;
    if (!locked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (locked === "y") {
        tracking = false;
        missingTrack.classList.remove("is-dragging");
        return;
      }
    }
    if (locked !== "x") return;
    if (e && e.cancelable) e.preventDefault();
    // 가장자리 저항감 (앨범 느낌)
    const count = missingPageCount();
    let drag = dx;
    if (missingPage === 0 && drag > 0) drag *= 0.35;
    if (missingPage === count - 1 && drag < 0) drag *= 0.35;
    missingDragX = drag;
    setTrackOffset(missingPage, drag, false);
  };

  const onEnd = (x) => {
    if (!tracking && locked !== "x") {
      missingTrack.classList.remove("is-dragging");
      return;
    }
    tracking = false;
    missingTrack.classList.remove("is-dragging");
    if (locked !== "x") {
      startMissingAuto();
      return;
    }
    const dx = x - startX;
    const w = stageWidth();
    const need = Math.max(40, w * THRESHOLD_RATIO);
    let target = missingPage;
    if (dx < -need) target = missingPage + 1;
    else if (dx > need) target = missingPage - 1;

    if (target !== missingPage) {
      didSwipe = true;
      missingAnimating = true;
      renderMissingPage(target, { animate: true });
      window.setTimeout(() => {
        missingAnimating = false;
        startMissingAuto();
      }, 340);
    } else {
      // 원위치 스냅
      setTrackOffset(missingPage, 0, true);
      missingDragX = 0;
      startMissingAuto();
    }
  };

  stage.addEventListener(
    "click",
    (e) => {
      if (!didSwipe) return;
      e.preventDefault();
      e.stopPropagation();
      didSwipe = false;
    },
    true
  );

  stage.addEventListener(
    "touchstart",
    (e) => {
      if (!e.touches[0]) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );
  stage.addEventListener(
    "touchmove",
    (e) => {
      if (!e.touches[0]) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY, e);
    },
    { passive: false }
  );
  stage.addEventListener(
    "touchend",
    (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      onEnd(t ? t.clientX : startX);
    },
    { passive: true }
  );
  stage.addEventListener("touchcancel", () => {
    tracking = false;
    missingTrack.classList.remove("is-dragging");
    setTrackOffset(missingPage, 0, true);
  });

  let mouseDown = false;
  stage.addEventListener("mousedown", (e) => {
    mouseDown = true;
    onStart(e.clientX, e.clientY);
  });
  window.addEventListener("mousemove", (e) => {
    if (!mouseDown) return;
    onMove(e.clientX, e.clientY, e);
  });
  window.addEventListener("mouseup", (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    onEnd(e.clientX);
  });

  window.addEventListener("resize", () => {
    layoutMissingPages();
    setTrackOffset(missingPage, 0, false);
  });
}

function renderMissingItems(items) {
  missingItems = items;
  missingPage = 0;
  buildMissingTrack();
  renderMissingPage(0, { animate: false });
  startMissingAuto();
  missingNote.textContent = `자료 출처: 경찰청 · 총 ${items.length}명`;
}

// 실종 목록: 페이지 로드 1회 + 5분마다 + 탭 복귀 시 새로고침 (API page 순환)
const MISSING_REFRESH_MS = 5 * 60 * 1000;
let missingApiPage = 1;
let missingRefreshTimer = null;
let missingLoading = false;

async function loadMissingBoard({ silent = false } = {}) {
  if (missingLoading) return;
  missingLoading = true;
  try {
    const qs = `page=${missingApiPage}&_=${Date.now()}`;
    const { res, data } = await fetchJson(
      `/api/missing?${qs}`,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
      15_000
    );
    if (!res.ok) {
      if (!silent) {
        renderMissingEmpty(
          data.error || "지금은 목록을 불러오지 못했어요.",
          false
        );
      }
      return;
    }

    if (data.ok && Array.isArray(data.items) && data.items.length) {
      renderMissingItems(data.items);
      // 다음 갱신 때 다른 페이지 후보
      missingApiPage = missingApiPage >= 4 ? 1 : missingApiPage + 1;
      return;
    }

    // 빈 페이지면 1페이지로 되돌리고 한 번 더 시도하지 않음(루프 방지)
    if (!silent) {
      renderMissingEmpty(
        data.message ||
          "지금은 목록을 불러오지 못했어요. 안전Dream에서 직접 확인해 주세요.",
        Boolean(data.needKey)
      );
    }
    missingApiPage = 1;
  } catch {
    if (!silent) {
      renderMissingEmpty(
        "연결이 불안정해요. 안전Dream 홈페이지에서 확인해 주세요.",
        false
      );
    }
  } finally {
    missingLoading = false;
  }
}

function startMissingRefreshLoop() {
  if (missingRefreshTimer) window.clearInterval(missingRefreshTimer);
  missingRefreshTimer = window.setInterval(() => {
    loadMissingBoard({ silent: true });
  }, MISSING_REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadMissingBoard({ silent: true });
    }
  });
}

function updateCharCount() {
  const n = textarea.value.length;
  charCount.textContent = String(n);
  if (!charMeta) return;
  charMeta.classList.toggle("warn", n >= 1800);
  charMeta.classList.toggle("danger", n >= 2000);
}

function fillExample(key) {
  const text = EXAMPLE_MESSAGES[key];
  if (!text || !textarea) return;
  textarea.value = text;
  updateCharCount();
  textarea.focus();
  // 커서를 끝으로
  const end = textarea.value.length;
  textarea.setSelectionRange(end, end);

  document.querySelectorAll(".example-card").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.example === key);
  });

  const coach = document.getElementById("example-coach");
  if (coach) coach.hidden = true;
}

const exampleChips = document.getElementById("example-chips");
if (exampleChips) {
  exampleChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".example-card");
    if (!btn) return;
    fillExample(btn.dataset.example);
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runCheck();
});

bottomSubmit.addEventListener("click", () => {
  runCheck();
});

textarea.addEventListener("input", () => {
  updateCharCount();
  document
    .querySelectorAll(".example-card.is-active")
    .forEach((btn) => btn.classList.remove("is-active"));
  const coach = document.getElementById("example-coach");
  if (coach && textarea.value.length > 0) coach.hidden = true;
});

if (missingPrev) missingPrev.addEventListener("click", () => goMissingPage(-1));
if (missingNext) missingNext.addEventListener("click", () => goMissingPage(1));
bindMissingSwipe();

if (shareFamilyBtn) {
  shareFamilyBtn.addEventListener("click", () => {
    shareWithFamily();
  });
}
if (resetCheckBtn) {
  resetCheckBtn.addEventListener("click", () => {
    resetCheck();
  });
}
if (ttsBtn) {
  if ("speechSynthesis" in window) {
    ttsBtn.hidden = false;
    ttsBtn.addEventListener("click", () => speakResult());
  } else {
    ttsBtn.hidden = true;
  }
}

// Ctrl/Cmd+Enter 로 바로 확인
textarea.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runCheck();
  }
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* 오프라인 캐시 실패해도 본 기능은 동작 */
    });
  });
}
registerServiceWorker();

window.addEventListener("load", () => {
  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }
  updateCharCount();
  setHowtoVisible(true);
  loadMissingBoard();
  startMissingRefreshLoop();
});

/* 홈 화면에 추가 유도 — 부모님이 자주·쉽게 열 수 있게 */
(function initAddToHome() {
  const card = document.getElementById("install-card");
  const btn = document.getElementById("install-btn");
  const hint = document.getElementById("install-hint");
  const descEl = card && card.querySelector(".install-desc");
  if (!card || !btn) return;

  const isStandalone =
    (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  if (isStandalone) return; // 이미 홈 화면 앱으로 실행 중이면 숨김

  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isKakao = /kakaotalk/i.test(ua);
  // 카톡·인스타·페북·라인 등 인앱 브라우저 (홈 화면 추가 불가)
  const isInApp =
    isKakao || /(FBAN|FBAV|Instagram|Line\/|DaumApps|; wv\))/i.test(ua);

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function setHint(html) {
    if (!hint) return;
    hint.innerHTML = html;
    hint.hidden = false;
  }

  window.addEventListener("appinstalled", () => {
    card.hidden = true;
    showToast("홈 화면에 추가됐어요");
  });

  if (isInApp) {
    // 인앱 브라우저: 홈 화면 추가가 원천 차단됨 → 외부 브라우저로 열도록 유도
    btn.textContent = "크롬·사파리로 열기";
    if (descEl) {
      descEl.innerHTML =
        "카톡 같은 앱 안에서는 홈 화면 추가가 안 돼요.<br />크롬·사파리로 열면 아이콘으로 저장할 수 있어요.";
    }
    btn.addEventListener("click", () => {
      if (isKakao) {
        // 카카오톡 공식 스킴 — 기본 브라우저로 열기 (안드로이드·아이폰 공통)
        window.location.href =
          "kakaotalk://web/openExternal?url=" +
          encodeURIComponent(window.location.href);
        window.setTimeout(function () {
          setHint(
            "안 열리면 <strong>브라우저 메뉴</strong>에서 <strong>‘다른 브라우저로 열기’</strong>를 눌러 주세요."
          );
        }, 1200);
      } else if (isAndroid) {
        const clean = window.location.href.replace(/^https?:\/\//, "");
        window.location.href =
          "intent://" +
          clean +
          "#Intent;scheme=https;package=com.android.chrome;end";
        window.setTimeout(function () {
          setHint(
            "안 열리면 <strong>메뉴</strong>에서 <strong>‘다른 브라우저로 열기’</strong>를 눌러 주세요."
          );
        }, 1200);
      } else {
        setHint(
          "오른쪽 <strong>메뉴</strong>에서 <strong>‘Safari로 열기’</strong>를 누른 뒤, 홈 화면에 추가해 주세요."
        );
      }
    });
  } else {
    btn.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try {
          await deferredPrompt.userChoice;
        } catch {
          /* 사용자가 취소해도 무시 */
        }
        deferredPrompt = null;
      } else {
        setHint(
          isIOS
            ? "아이폰은 화면 아래 <strong>공유 버튼</strong>을 누른 뒤 <strong>‘홈 화면에 추가’</strong>를 선택해 주세요."
            : "브라우저 <strong>메뉴(⋮)</strong>를 열어 <strong>‘홈 화면에 추가’</strong> 또는 <strong>‘앱 설치’</strong>를 눌러 주세요."
        );
      }
    });
  }

  card.hidden = false;
})();
