const form = document.getElementById("check-form");
const textarea = document.getElementById("message-input");
const resultBox = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = textarea.value.trim();
  if (!message) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "확인 중...";
  resultBox.textContent = "";
  resultBox.classList.remove("visible", "error");

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "오류가 발생했습니다.");
    resultBox.textContent = data.answer;
    resultBox.classList.add("visible");
  } catch (err) {
    resultBox.textContent = "확인 중 오류가 발생했습니다: " + err.message;
    resultBox.classList.add("visible", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "확인하기";
  }
});
