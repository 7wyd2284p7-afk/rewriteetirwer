const lessons = window.RETRANSLATE_LESSONS;
const currentLessonKey = "retranslate.currentLesson";
let currentIndex = Math.min(Math.max(Number(localStorage.getItem(currentLessonKey) || 0), 0), lessons.length - 1);
let lesson = lessons[currentIndex];
let keys = lessonKeys(lesson);

function lessonKeys(item) {
  const prefix = `retranslate.lesson2.${item.number}`;
  return {
    original: `${prefix}.original`,
    draft: `${prefix}.draft`,
    completed: `${prefix}.completed`,
    duration: `${prefix}.duration`,
  };
}

function readLessonState() {
  const savedOriginal = localStorage.getItem(keys.original);
  return {
    mode: localStorage.getItem(keys.completed) === "true" ? "complete" : "ready",
    draft: localStorage.getItem(keys.draft) || "",
    original: savedOriginal === null ? lesson.original || "" : savedOriginal,
    duration: Number(localStorage.getItem(keys.duration) || 0),
    startedAt: null,
    settingsOpen: false,
    libraryOpen: false,
  };
}

const state = readLessonState();
const root = document.getElementById("root");

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function withBreaks(value) {
  return escapeHTML(value).replace(/\n/g, "<br>");
}

function renderChinese(value) {
  return value.split(/\n+/).map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("");
}

function renderOriginal(value) {
  return value.split(/\r?\n/).map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("");
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins ? `${mins}分${String(secs).padStart(2, "0")}秒` : `${secs}秒`;
}

function wordCount() {
  return state.draft.trim().match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
}

function compareTexts(userText, originalText) {
  const userChars = Array.from(userText.replace(/\r\n/g, "\n"));
  const originalChars = Array.from(originalText.replace(/\r\n/g, "\n"));
  const rows = userChars.length + 1;
  const cols = originalChars.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = userChars[i - 1] === originalChars[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matchedUser = new Set();
  const matchedOriginal = new Set();
  let i = userChars.length;
  let j = originalChars.length;
  while (i > 0 && j > 0) {
    if (userChars[i - 1] === originalChars[j - 1]) {
      matchedUser.add(i - 1); matchedOriginal.add(j - 1); i -= 1; j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  let highlighted = "";
  userChars.forEach((char, index) => {
    if (char === "\n") {
      highlighted += matchedUser.has(index) ? "<br>" : `<mark class="diff-wrong diff-newline" title="换行与原文不一致">↵</mark><br>`;
    } else if (char === " ") {
      highlighted += matchedUser.has(index) ? " " : `<mark class="diff-wrong diff-space" title="空格与原文不一致"> </mark>`;
    } else {
      highlighted += matchedUser.has(index)
        ? escapeHTML(char)
        : `<mark class="diff-wrong" title="字符与原文不一致">${escapeHTML(char)}</mark>`;
    }
  });
  const missingChars = originalChars.filter((_, index) => !matchedOriginal.has(index));
  const matches = matchedUser.size;
  const denominator = userChars.length + originalChars.length;
  const accuracy = denominator ? Math.round((2 * matches / denominator) * 100) : 100;
  return {
    highlighted,
    accuracy,
    wrongCount: userChars.length - matches,
    missingCount: missingChars.length,
    missingChars,
  };
}

function switchLesson(index) {
  if (index < 0 || index >= lessons.length) return;
  currentIndex = index;
  lesson = lessons[currentIndex];
  keys = lessonKeys(lesson);
  localStorage.setItem(currentLessonKey, String(currentIndex));
  Object.assign(state, readLessonState());
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function renderWritingArea() {
  if (state.mode === "ready") {
    return `<section class="start-panel">
      <p>准备好后，从中文重新组织英文。开始后不会出现原文或提示。</p>
      <button class="primary-button" id="start-writing" type="button">开始回译 <span>↗</span></button>
    </section>`;
  }
  if (state.mode === "writing") {
    return `<section class="writing-panel">
      <div class="section-label"><span>02</span> 你的回译</div>
      <textarea id="draft" aria-label="英文回译输入区" spellcheck="false" autocapitalize="sentences"></textarea>
      <div class="finish-row"><button class="finish-button" id="finish-writing" type="button" ${state.draft.trim() ? "" : "disabled"}>完成回译 <span>✓</span></button></div>
    </section>`;
  }
  const comparison = compareTexts(state.draft, state.original);
  const visibleChar = (char) => char === " " ? "空格" : char === "\n" ? "换行" : char === "\t" ? "制表符" : char;
  const missingPreview = comparison.missingChars.slice(0, 80).map((char) => `<span>${escapeHTML(visibleChar(char))}</span>`).join("");
  return `<section class="result-stack">
    <div class="completion-strip">
      <div><span>✓</span><strong>本次回译完成</strong></div>
      <div class="stats"><span>准确率 ${comparison.accuracy}%</span><span>用时 ${formatDuration(state.duration)}</span><span>${wordCount()} words</span></div>
    </div>
    <article class="answer-card user-answer">
      <div class="section-label"><span>02</span> 你的回译</div>
      <div class="english-copy diff-copy">${comparison.highlighted || "本次没有保存回译内容。"}</div>
      <div class="comparison-summary"><strong>红色 ${comparison.wrongCount} 字符</strong><span>遗漏 ${comparison.missingCount} 字符</span><em>严格逐字符比对：大小写、空格、换行、引号和标点均计入。</em></div>
      ${comparison.missingCount ? `<details class="missing-panel"><summary>查看遗漏的原文字符</summary><div>${missingPreview}${comparison.missingCount > 80 ? `<span>另有 ${comparison.missingCount - 80} 字符…</span>` : ""}</div></details>` : ""}
    </article>
    <article class="answer-card original-answer">
      <div class="section-label"><span>03</span> 英文原文</div>
      ${state.original ? `<div class="english-copy">${renderOriginal(state.original)}</div>` : `<div class="empty-original">
        <div class="book-mark">Aa</div>
        <div><strong>还没有录入英文原文</strong><p>点击“编辑内容”，粘贴你书中的 Lesson ${lesson.number} 原文。保存后会在这里显示。</p></div>
        <button type="button" id="add-original">现在录入</button>
      </div>`}
    </article>
    <button class="restart-button" id="restart" type="button">重新练习这一课</button>
  </section>`;
}

function renderLessonSwitcher() {
  if (state.mode === "writing") return "";
  return `<nav class="lesson-switcher" aria-label="课程切换">
    <button type="button" id="previous-lesson" ${currentIndex === 0 ? "disabled" : ""}>← 上一课</button>
    <span>${currentIndex + 1} / ${lessons.length} 已录入</span>
    <button type="button" id="next-lesson" ${currentIndex === lessons.length - 1 ? "disabled" : ""}>下一课 →</button>
  </nav>`;
}

function renderSettingsModal() {
  if (!state.settingsOpen) return "";
  return `<div class="modal-backdrop" id="settings-backdrop">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button class="close-button" id="close-modal" type="button" aria-label="关闭">×</button>
      <div class="eyebrow">LESSON ${String(lesson.number).padStart(2, "0")}</div>
      <h2 id="modal-title">录入英文原文</h2>
      <p>把你拥有的新概念英语课文粘贴到这里。内容只保存在当前浏览器中。</p>
      <textarea id="original-editor" placeholder="粘贴 ${escapeHTML(lesson.title)} 英文原文…"></textarea>
      <div class="modal-actions">
        <button type="button" class="secondary-button" id="cancel-modal">取消</button>
        <button type="button" class="primary-button compact" id="save-original">保存原文</button>
      </div>
    </section>
  </div>`;
}

function renderLibraryModal() {
  if (!state.libraryOpen) return "";
  const cards = lessons.map((item, index) => {
    const completed = localStorage.getItem(lessonKeys(item).completed) === "true";
    return `<button class="lesson-card ${index === currentIndex ? "active" : ""}" type="button" data-lesson-index="${index}">
      <span class="lesson-card-number">${String(item.number).padStart(2, "0")}</span>
      <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.titleCn)}</small></span>
      <em>${completed ? "已完成 ✓" : index === currentIndex ? "当前" : "开始"}</em>
    </button>`;
  }).join("");
  return `<div class="modal-backdrop" id="library-backdrop">
    <section class="modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title">
      <button class="close-button" id="close-library" type="button" aria-label="关闭">×</button>
      <div class="eyebrow">NEW CONCEPT ENGLISH 2</div>
      <h2 id="library-title">课程库</h2>
      <p>每一课分别保存练习记录。目前已录入 ${lessons.length} 课。</p>
      <div class="lesson-list">${cards}</div>
    </section>
  </div>`;
}

function render() {
  document.title = `回译室 · ${lesson.title}`;
  root.innerHTML = `<div class="app-shell ${state.mode === "writing" ? "is-writing" : ""}">
    <header class="topbar">
      <div class="brand"><span>RE:</span>WRITE <em>回译室</em></div>
      <div class="top-actions">
        <button class="ghost-button" id="library" type="button">课程库</button>
        <button class="ghost-button" id="edit-content" type="button">编辑内容</button>
      </div>
    </header>
    <main class="lesson-page">
      <nav class="breadcrumb" aria-label="当前位置">‹ ${lesson.book} <span>/</span> Lesson ${lesson.number}</nav>
      <section class="lesson-heading">
        <div><div class="eyebrow">LESSON ${String(lesson.number).padStart(2, "0")}</div><h1>${escapeHTML(lesson.title)}</h1><p>${escapeHTML(lesson.titleCn)}</p></div>
        <div class="lesson-progress"><strong>${String(lesson.number).padStart(2, "0")}</strong><span>/ ${lesson.total}</span></div>
      </section>
      <section class="prompt-card">
        <div class="section-label"><span>01</span> 中文原意</div>
        <div class="chinese-copy">${renderChinese(lesson.chinese)}</div>
      </section>
      ${renderWritingArea()}
      ${renderLessonSwitcher()}
    </main>
    <footer><span>NEW CONCEPT ENGLISH · RETRANSLATION PRACTICE</span><span>本地自动保存</span></footer>
    ${renderSettingsModal()}
    ${renderLibraryModal()}
  </div>`;

  document.getElementById("edit-content")?.addEventListener("click", openSettings);
  document.getElementById("library")?.addEventListener("click", openLibrary);
  document.getElementById("start-writing")?.addEventListener("click", () => {
    state.startedAt = Date.now(); state.mode = "writing"; render();
    document.getElementById("draft")?.focus();
  });
  const draft = document.getElementById("draft");
  if (draft) {
    draft.value = state.draft;
    draft.addEventListener("input", (event) => {
      state.draft = event.target.value;
      localStorage.setItem(keys.draft, state.draft);
      document.getElementById("finish-writing").disabled = !state.draft.trim();
    });
  }
  document.getElementById("finish-writing")?.addEventListener("click", () => {
    state.duration = state.startedAt ? Math.max(1, Math.round((Date.now() - state.startedAt) / 1000)) : state.duration;
    localStorage.setItem(keys.duration, String(state.duration));
    localStorage.setItem(keys.completed, "true");
    state.mode = "complete"; render();
  });
  document.getElementById("restart")?.addEventListener("click", () => {
    state.mode = "ready"; state.draft = ""; state.duration = 0; state.startedAt = null;
    localStorage.removeItem(keys.draft); localStorage.removeItem(keys.duration); localStorage.removeItem(keys.completed); render();
  });
  document.getElementById("previous-lesson")?.addEventListener("click", () => switchLesson(currentIndex - 1));
  document.getElementById("next-lesson")?.addEventListener("click", () => switchLesson(currentIndex + 1));
  document.querySelectorAll("[data-lesson-index]").forEach((button) => button.addEventListener("click", () => switchLesson(Number(button.dataset.lessonIndex))));
  document.getElementById("add-original")?.addEventListener("click", openSettings);
  document.getElementById("close-modal")?.addEventListener("click", closeSettings);
  document.getElementById("cancel-modal")?.addEventListener("click", closeSettings);
  document.getElementById("settings-backdrop")?.addEventListener("mousedown", (event) => event.target === event.currentTarget && closeSettings());
  const editor = document.getElementById("original-editor");
  if (editor) editor.value = state.original;
  document.getElementById("save-original")?.addEventListener("click", () => {
    state.original = editor.value.trim(); localStorage.setItem(keys.original, state.original); closeSettings();
  });
  document.getElementById("close-library")?.addEventListener("click", closeLibrary);
  document.getElementById("library-backdrop")?.addEventListener("mousedown", (event) => event.target === event.currentTarget && closeLibrary());
}

function openSettings() { state.settingsOpen = true; render(); document.getElementById("original-editor")?.focus(); }
function closeSettings() { state.settingsOpen = false; render(); }
function openLibrary() { state.libraryOpen = true; render(); }
function closeLibrary() { state.libraryOpen = false; render(); }

render();
