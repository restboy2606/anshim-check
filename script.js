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

const FETCH_TIMEOUT_MS = 25_000;
let inFlight = false;

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
        !/^의심되는/.test(l) &&
        !/^지금\s*할\s*일/.test(l)
    );
}

function renderList(el, items, emptyText) {
  el.innerHTML = "";
  const list = items.length ? items : [emptyText];
  for (const item of list) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "result-item-text";
    text.textContent = item; // XSS 방지: textContent only
    li.appendChild(text);
    el.appendChild(li);
  }
}

function showResult(answerText) {
  const parsed = parseAnswer(answerText);
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

  renderList(
    resultReasons,
    parsed.reasons,
    "이 연락에서 눈에 띈 점을 다시 확인해 주세요."
  );
  renderList(
    resultActions,
    parsed.actions,
    "피싱안심SOS나 112로 확인해 보세요."
  );

  const weakParse = parsed.reasons.length === 0 && parsed.actions.length === 0;
  resultRaw.hidden = !weakParse;
  resultRaw.textContent = weakParse ? parsed.raw : "";

  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showError(message) {
  resultStatus.className = "result-status level-unknown";
  resultEmoji.textContent = "❗";
  if (resultScoreEl) resultScoreEl.textContent = "—";
  resultLevel.textContent = "실패";
  if (resultScoreFill) resultScoreFill.style.width = "0%";
  resultPanel.setAttribute("aria-label", "확인 실패");
  renderList(resultReasons, [message], message);
  renderList(resultActions, ["잠시 후 다시 시도해 주세요."], "");
  resultRaw.hidden = true;
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

  try {
    const { res, data } = await fetchJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      throw new Error(data.error || "오류가 발생했습니다.");
    }
    showResult(data.answer || "");
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
        ? `<p class="snack-empty-tip">안전Dream OpenAPI 인증키를 연결하면<br/>과자 뒷면처럼 실제 공개 사진이 여기에 표시됩니다.</p>`
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

async function loadMissingBoard() {
  try {
    const { res, data } = await fetchJson("/api/missing", {}, 15_000);
    if (!res.ok) {
      renderMissingEmpty(
        data.error || "지금은 목록을 불러오지 못했어요.",
        false
      );
      return;
    }

    if (data.ok && Array.isArray(data.items) && data.items.length) {
      renderMissingItems(data.items);
      return;
    }

    renderMissingEmpty(
      data.message ||
        "지금은 목록을 불러오지 못했어요. 안전Dream에서 직접 확인해 주세요.",
      Boolean(data.needKey)
    );
  } catch {
    renderMissingEmpty(
      "연결이 불안정해요. 안전Dream 홈페이지에서 확인해 주세요.",
      false
    );
  }
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
});

if (missingPrev) missingPrev.addEventListener("click", () => goMissingPage(-1));
if (missingNext) missingNext.addEventListener("click", () => goMissingPage(1));
bindMissingSwipe();

// Ctrl/Cmd+Enter 로 바로 확인
textarea.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runCheck();
  }
});

window.addEventListener("load", () => {
  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }
  updateCharCount();
  loadMissingBoard();
});
