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

const missingGrid = document.getElementById("missing-grid");
const missingNote = document.getElementById("missing-note");
const missingPrev = document.getElementById("missing-prev");
const missingNext = document.getElementById("missing-next");
const missingCounter = document.getElementById("missing-counter");
const missingControls = document.getElementById("missing-controls");

const LEVEL_UI = {
  high: { label: "높음", emoji: "🚨", cls: "level-high" },
  mid: { label: "중간", emoji: "⚠️", cls: "level-mid" },
  low: { label: "낮음", emoji: "✅", cls: "level-low" },
  unknown: { label: "확인 완료", emoji: "💬", cls: "level-unknown" },
};

const FETCH_TIMEOUT_MS = 25_000;
let inFlight = false;

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

function parseAnswer(text) {
  const raw = String(text || "").trim();
  const levelMatch = raw.match(/위험도\s*[:：]\s*(높음|중간|낮음)/);
  let level = "unknown";
  if (levelMatch) {
    if (levelMatch[1] === "높음") level = "high";
    else if (levelMatch[1] === "중간") level = "mid";
    else if (levelMatch[1] === "낮음") level = "low";
  }

  const reasons = extractBullets(
    raw,
    /의심되는\s*이유\s*[:：]?/,
    /지금\s*할\s*일\s*[:：]?/
  );
  const actions = extractBullets(raw, /지금\s*할\s*일\s*[:：]?/, null);

  return { level, reasons, actions, raw };
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
    li.textContent = item; // XSS 방지: textContent only
    el.appendChild(li);
  }
}

function showResult(answerText) {
  const parsed = parseAnswer(answerText);
  const ui = LEVEL_UI[parsed.level] || LEVEL_UI.unknown;

  resultStatus.className = "result-status " + ui.cls;
  resultEmoji.textContent = ui.emoji;
  resultLevel.textContent = ui.label;
  resultPanel.setAttribute(
    "aria-label",
    `확인 결과, 위험도 ${ui.label}`
  );

  renderList(resultReasons, parsed.reasons, "분석 내용을 확인해 주세요.");
  renderList(
    resultActions,
    parsed.actions,
    "가족에게 먼저 물어보거나 대표번호로 확인하세요."
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
  resultLevel.textContent = "확인 실패";
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
  missingGrid.innerHTML = "";
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
  missingGrid.appendChild(empty);
  missingNote.textContent = "자료 출처: 경찰청";
  stopMissingAuto();
  if (missingControls) missingControls.hidden = true;
}

// ---- 실종보드 캐러셀 상태 ----
const MISSING_PAGE_SIZE = 4;
const MISSING_AUTO_MS = 7000;
let missingItems = [];
let missingPage = 0;
let missingTimer = null;
const prefersReducedMotion =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function missingPageCount() {
  return Math.max(1, Math.ceil(missingItems.length / MISSING_PAGE_SIZE));
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

function renderMissingPage(page) {
  const count = missingPageCount();
  missingPage = ((page % count) + count) % count; // wrap
  const start = missingPage * MISSING_PAGE_SIZE;
  const slice = missingItems.slice(start, start + MISSING_PAGE_SIZE);

  missingGrid.classList.add("is-fading");
  window.setTimeout(() => {
    missingGrid.innerHTML = "";
    slice.forEach((item) => missingGrid.appendChild(buildMissingCard(item)));
    missingGrid.classList.remove("is-fading");
  }, 160);

  if (missingCounter) {
    missingCounter.textContent = `${missingPage + 1} / ${count}`;
  }
  if (missingControls) missingControls.hidden = count <= 1;
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
    () => renderMissingPage(missingPage + 1),
    MISSING_AUTO_MS
  );
}

// 사용자가 화살표를 누르면 자동전환을 잠시 멈췄다 재개
function goMissingPage(delta) {
  stopMissingAuto();
  renderMissingPage(missingPage + delta);
  startMissingAuto();
}

function renderMissingItems(items) {
  missingItems = items;
  missingPage = 0;
  renderMissingPage(0);
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

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runCheck();
});

bottomSubmit.addEventListener("click", () => {
  runCheck();
});

textarea.addEventListener("input", updateCharCount);

if (missingPrev) missingPrev.addEventListener("click", () => goMissingPage(-1));
if (missingNext) missingNext.addEventListener("click", () => goMissingPage(1));

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
