const lessons = window.RETRANSLATE_LESSONS;
const currentLessonKey = "retranslate.currentLesson";
const libraryRanges = [[1, 20], [21, 40], [41, 60], [61, 80], [81, 96]];
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
    libraryRangeIndex: libraryRanges.findIndex(([start, end]) => lesson.number >= start && lesson.number <= end),
  };
}

const state = readLessonState();
const root = document.getElementById("root");

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function renderChinese(value) {
  return value.split(/\n+/).map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("");
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins ? `${mins}分${String(secs).padStart(2, "0")}秒` : `${secs}秒`;
}

function wordCount() {
  return state.draft.trim().match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
}

function tokenizeForComparison(text) {
  const tokens = [];
  const normalized = text.replace(/\r\n/g, "\n");
  const chars = Array.from(normalized);
  let word = "";
  const flushWord = () => {
    if (!word) return;
    tokens.push({ type: "word", value: word });
    word = "";
  };
  chars.forEach((char, index) => {
    const nextIsLetterOrNumber = /[A-Za-z0-9]/.test(chars[index + 1] || "");
    if (/[A-Za-z0-9]/.test(char)) {
      word += char;
      return;
    }
    if ((char === "-" || char === "'" || char === "’") && word && nextIsLetterOrNumber) {
      word += char;
      return;
    }
    flushWord();
    if (char === " ") {
      tokens.push({ type: "space", value: char });
    } else if (char === "?" || char === "!" || char === "-") {
      tokens.push({ type: "mark", value: char });
    } else {
      tokens.push({ type: "ignored", value: char });
    }
  });
  flushWord();
  let wordIndex = 0;
  return tokens.map((token, index) => ({
    ...token,
    index,
    wordIndex: token.type === "word" ? wordIndex++ : null,
  }));
}

function wordLetters(token) {
  return token.value.replace(/['’-]/g, "");
}

function hyphenPositions(token) {
  const positions = [];
  let letters = 0;
  Array.from(token.value).forEach((char) => {
    if (/[A-Za-z0-9]/.test(char)) letters += 1;
    else if (char === "-") positions.push(letters);
  });
  return positions.join(",");
}

function renderComparedTokens(tokens, markedUser, originalKinds, side) {
  return tokens.map((token) => {
    if (token.value === "\n") return "<br>";
    if (token.type === "space") return " ";
    const value = escapeHTML(token.value);
    if (side === "original") {
      const kind = originalKinds.get(token.index);
      if (kind === "word") return `<span class="diff-reference" title="与回译不一致">${value}</span>`;
      if (kind === "format") return `<span class="diff-format-reference" title="格式与回译不一致">${value}</span>`;
      if (kind === "both") return `<span class="diff-reference diff-format-reference" title="单词和格式均与回译不一致">${value}</span>`;
      return value;
    }
    if (!markedUser.has(token.index)) return value;
    return `<mark class="diff-wrong" title="与原文不一致">${value}</mark>`;
  }).join("");
}

function alignWords(userWords, originalWords) {
  const rows = userWords.length + 1;
  const cols = originalWords.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  const previous = Array.from({ length: rows }, () => Array(cols).fill(null));
  dp[0][0] = 0;
  const relax = (fromI, fromJ, toI, toJ, cost, operation) => {
    const next = dp[fromI][fromJ] + cost;
    if (next < dp[toI][toJ]) {
      dp[toI][toJ] = next;
      previous[toI][toJ] = { i: fromI, j: fromJ, operation };
    }
  };
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      if (!Number.isFinite(dp[i][j])) continue;
      if (i < userWords.length && j < originalWords.length) {
        const same = wordLetters(userWords[i]) === wordLetters(originalWords[j]);
        relax(i, j, i + 1, j + 1, same ? 0 : 1, {
          type: same ? "equal" : "replace",
          userWords: [userWords[i]],
          originalWords: [originalWords[j]],
        });
      }
      if (i < userWords.length) {
        for (let count = 2; count <= 6 && j + count <= originalWords.length; count += 1) {
          const originals = originalWords.slice(j, j + count);
          if (wordLetters(userWords[i]) === originals.map(wordLetters).join("")) {
            relax(i, j, i + 1, j + count, 0, { type: "joined", userWords: [userWords[i]], originalWords: originals });
          }
        }
      }
      if (j < originalWords.length) {
        for (let count = 2; count <= 6 && i + count <= userWords.length; count += 1) {
          const users = userWords.slice(i, i + count);
          if (users.map(wordLetters).join("") === wordLetters(originalWords[j])) {
            relax(i, j, i + count, j + 1, 0, { type: "split", userWords: users, originalWords: [originalWords[j]] });
          }
        }
      }
      if (j < originalWords.length) {
        relax(i, j, i, j + 1, 1, { type: "missing", userWords: [], originalWords: [originalWords[j]] });
      }
      if (i < userWords.length) {
        relax(i, j, i + 1, j, 1, { type: "extra", userWords: [userWords[i]], originalWords: [] });
      }
    }
  }
  const operations = [];
  let i = userWords.length;
  let j = originalWords.length;
  while (i > 0 || j > 0) {
    const step = previous[i][j];
    if (!step) throw new Error("无法完成单词对齐");
    operations.push(step.operation);
    i = step.i;
    j = step.j;
  }
  return operations.reverse();
}

function gapTokens(tokens, leftWord, rightWord) {
  const start = leftWord ? leftWord.index + 1 : 0;
  const end = rightWord ? rightWord.index : tokens.length;
  return tokens.slice(start, end);
}

function logicalSpaceCount(tokens) {
  if (tokens.some((token) => token.value === "\n")) return 1;
  return tokens.filter((token) => token.type === "space").length;
}

function hasSpaceIssue(tokens) {
  const lastNewline = tokens.map((token) => token.value).lastIndexOf("\n");
  if (lastNewline >= 0) {
    const lineStart = tokens.slice(lastNewline + 1);
    const quoteIndex = lineStart.findLastIndex((token) => token.type === "ignored" && /['‘“"]/.test(token.value));
    return quoteIndex >= 0 && lineStart.slice(quoteIndex + 1).some((token) => token.type === "space");
  }
  return logicalSpaceCount(tokens) !== 1;
}

function compareFormatMarks(userGap, originalGap, setOriginalKind) {
  const userMarks = userGap.filter((token) => token.type === "mark" && token.value !== "-");
  const originalMarks = originalGap.filter((token) => token.type === "mark" && token.value !== "-");
  const rows = userMarks.length + 1;
  const cols = originalMarks.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (userMarks[i - 1].value === originalMarks[j - 1].value ? 0 : 1),
      );
    }
  }
  let i = userMarks.length;
  let j = originalMarks.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && userMarks[i - 1].value === originalMarks[j - 1].value && dp[i][j] === dp[i - 1][j - 1]) {
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      setOriginalKind(originalMarks[j - 1], "format");
      i -= 1;
      j -= 1;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      setOriginalKind(originalMarks[j - 1], "format");
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return dp[userMarks.length][originalMarks.length];
}

function compareTexts(userText, originalText) {
  const userTokens = tokenizeForComparison(userText);
  const originalTokens = tokenizeForComparison(originalText);
  const userWords = userTokens.filter((token) => token.type === "word");
  const originalWords = originalTokens.filter((token) => token.type === "word");
  const operations = alignWords(userWords, originalWords);
  const markedUser = new Set();
  const originalKinds = new Map();
  const setOriginalKind = (token, kind) => {
    if (!token) return;
    const current = originalKinds.get(token.index);
    if (!current) originalKinds.set(token.index, kind);
    else if (current !== kind) originalKinds.set(token.index, "both");
  };
  let wrongWords = 0;
  let missingWords = 0;
  let extraWords = 0;
  let formatErrors = 0;
  const userToOriginal = new Map();

  operations.forEach((operation) => {
    if (operation.type === "replace") {
      userToOriginal.set(operation.userWords[0].wordIndex, operation.originalWords[0]);
      markedUser.add(operation.userWords[0].index);
      setOriginalKind(operation.originalWords[0], "word");
      wrongWords += 1;
    } else if (operation.type === "missing") {
      setOriginalKind(operation.originalWords[0], "word");
      missingWords += 1;
    } else if (operation.type === "extra") {
      markedUser.add(operation.userWords[0].index);
      extraWords += 1;
    } else if (operation.type === "joined") {
      userToOriginal.set(operation.userWords[0].wordIndex, operation.originalWords.at(-1));
      formatErrors += operation.originalWords.length - 1;
      operation.originalWords.slice(1).forEach((word) => setOriginalKind(word, "format"));
    } else if (operation.type === "split") {
      operation.userWords.forEach((word) => userToOriginal.set(word.wordIndex, operation.originalWords[0]));
      formatErrors += operation.userWords.length - 1;
      setOriginalKind(operation.originalWords[0], "format");
    } else {
      userToOriginal.set(operation.userWords[0].wordIndex, operation.originalWords[0]);
      if (hyphenPositions(operation.userWords[0]) !== hyphenPositions(operation.originalWords[0])) {
        formatErrors += 1;
        setOriginalKind(operation.originalWords[0], "format");
      }
    }
  });

  for (let index = 1; index < userWords.length; index += 1) {
    const previousUser = userWords[index - 1];
    const currentUser = userWords[index];
    const previousOriginal = userToOriginal.get(previousUser.wordIndex);
    const currentOriginal = userToOriginal.get(currentUser.wordIndex);
    if (previousOriginal && currentOriginal && previousOriginal.wordIndex === currentOriginal.wordIndex) continue;
    if (hasSpaceIssue(gapTokens(userTokens, previousUser, currentUser))) {
      formatErrors += 1;
      setOriginalKind(currentOriginal, "format");
    }
  }

  operations.filter((operation) => operation.userWords.length && operation.originalWords.length).forEach((operation) => {
    const userWord = operation.userWords.at(-1);
    const originalWord = operation.originalWords.at(-1);
    const userNext = userWords[userWord.wordIndex + 1] || null;
    const originalNext = originalWords[originalWord.wordIndex + 1] || null;
    const userGap = gapTokens(userTokens, userWord, userNext);
    const originalGap = gapTokens(originalTokens, originalWord, originalNext);
    formatErrors += compareFormatMarks(userGap, originalGap, setOriginalKind);
  });

  const errors = wrongWords + missingWords + extraWords + formatErrors;
  const denominator = Math.max(userWords.length, originalWords.length, 1);
  return {
    highlightedUser: renderComparedTokens(userTokens, markedUser, originalKinds, "user"),
    highlightedOriginal: renderComparedTokens(originalTokens, markedUser, originalKinds, "original"),
    accuracy: Math.max(0, Math.round((1 - errors / denominator) * 100)),
    wrongWords,
    missingWords,
    extraWords,
    formatErrors,
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
  return `<section class="result-stack">
    <div class="completion-strip">
      <div><span>✓</span><strong>本次回译完成</strong></div>
      <div class="stats"><span>准确率 ${comparison.accuracy}%</span><span>用时 ${formatDuration(state.duration)}</span><span>${wordCount()} words</span></div>
    </div>
    <article class="answer-card user-answer">
      <div class="section-label"><span>02</span> 你的回译</div>
      <div class="english-copy diff-copy">${comparison.highlightedUser || "本次没有保存回译内容。"}</div>
      <div class="comparison-summary"><strong>错词 ${comparison.wrongWords}</strong><span>漏词 ${comparison.missingWords}</span><span>多词 ${comparison.extraWords}</span><span>格式错误 ${comparison.formatErrors}</span><em>错词整词标红；原文对应错误加橙色下划线。</em></div>
    </article>
    <article class="answer-card original-answer">
      <div class="section-label"><span>03</span> 英文原文</div>
      ${state.original ? `<div class="english-copy"><p>${comparison.highlightedOriginal.replace(/<br>/g, "</p><p>")}</p></div>` : `<div class="empty-original">
        <div class="book-mark">Aa</div>
        <div><strong>暂无英文原文</strong><p>这节课尚未提供英文原文。</p></div>
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
    <section class="modal original-modal" id="original-modal" role="dialog" aria-modal="true" aria-label="英文原文">
      <button class="close-button" id="close-modal" type="button" aria-label="关闭">×</button>
      <div class="modal-drag-handle" id="original-drag-handle">
        <div class="eyebrow">LESSON ${String(lesson.number).padStart(2, "0")}</div>
      </div>
      <div class="original-modal-copy">${state.original ? escapeHTML(state.original) : "暂无英文原文。"}</div>
    </section>
  </div>`;
}

function enableModalDragging() {
  const modal = document.getElementById("original-modal");
  const handle = document.getElementById("original-drag-handle");
  if (!modal || !handle) return;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = Number(modal.dataset.offsetX || 0);
    const initialY = Number(modal.dataset.offsetY || 0);
    const rect = modal.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("is-dragging");
    const move = (moveEvent) => {
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      const x = Math.min(Math.max(initialX + moveEvent.clientX - startX, initialX - rect.left), initialX + maxLeft - rect.left);
      const y = Math.min(Math.max(initialY + moveEvent.clientY - startY, initialY - rect.top), initialY + maxTop - rect.top);
      modal.dataset.offsetX = String(x);
      modal.dataset.offsetY = String(y);
      modal.style.transform = `translate(${x}px, ${y}px)`;
    };
    const stop = () => {
      handle.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

function renderLibraryModal() {
  if (!state.libraryOpen) return "";
  const [start, end] = libraryRanges[state.libraryRangeIndex];
  const rangeTabs = libraryRanges.map(([from, to], index) => `<button class="library-range" type="button" role="tab" aria-label="${from}–${to}课" aria-selected="${index === state.libraryRangeIndex}" data-library-range="${index}">
    <strong>${from}–${to}</strong><small>LESSONS</small>
  </button>`).join("");
  const cards = lessons.map((item, index) => ({ item, index })).filter(({ item }) => item.number >= start && item.number <= end).map(({ item, index }) => {
    const completed = localStorage.getItem(lessonKeys(item).completed) === "true";
    return `<button class="lesson-card ${index === currentIndex ? "active" : ""}" type="button" data-lesson-index="${index}">
      <span class="lesson-card-number">${String(item.number).padStart(2, "0")}</span>
      <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.titleCn)}</small></span>
      <em aria-label="${completed ? "已完成" : index === currentIndex ? "当前课程" : "开始课程"}">${completed ? "✓" : index === currentIndex ? "当前" : "→"}</em>
    </button>`;
  }).join("");
  return `<div class="modal-backdrop" id="library-backdrop">
    <section class="modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title">
      <button class="close-button" id="close-library" type="button" aria-label="关闭">×</button>
      <div class="eyebrow">NEW CONCEPT ENGLISH 2</div>
      <h2 id="library-title">课程库</h2>
      <p>每一课分别保存练习记录。选择课数范围，再选择课程。</p>
      <div class="library-ranges" role="tablist" aria-label="课程范围">${rangeTabs}</div>
      <div class="library-range-summary"><strong>第 ${start}–${end} 课</strong><span>共 ${end - start + 1} 课</span></div>
      <div class="lesson-list">${cards}</div>
    </section>
  </div>`;
}

function render() {
  document.title = `回译室 · ${lesson.title}`;
  document.body.classList.toggle("has-modal", state.settingsOpen || state.libraryOpen);
  root.innerHTML = `<div class="app-shell ${state.mode === "writing" ? "is-writing" : ""}">
    <header class="topbar">
      <div class="brand"><span>RE:</span>WRITE</div>
      <div class="top-actions">
        <button class="ghost-button" id="library" type="button">课程库</button>
        <button class="ghost-button" id="view-original" type="button">查看原文</button>
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

  document.getElementById("view-original")?.addEventListener("click", openSettings);
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
  document.querySelectorAll("[data-library-range]").forEach((button) => button.addEventListener("click", () => {
    state.libraryRangeIndex = Number(button.dataset.libraryRange);
    render();
    document.querySelector(`[data-library-range="${state.libraryRangeIndex}"]`)?.focus();
  }));
  document.querySelectorAll("[data-lesson-index]").forEach((button) => button.addEventListener("click", () => switchLesson(Number(button.dataset.lessonIndex))));
  document.getElementById("close-modal")?.addEventListener("click", closeSettings);
  document.getElementById("settings-backdrop")?.addEventListener("mousedown", (event) => event.target === event.currentTarget && closeSettings());
  enableModalDragging();
  document.getElementById("close-library")?.addEventListener("click", closeLibrary);
  document.getElementById("library-backdrop")?.addEventListener("mousedown", (event) => event.target === event.currentTarget && closeLibrary());
}

function openSettings() { state.settingsOpen = true; render(); document.getElementById("close-modal")?.focus(); }
function closeSettings() { state.settingsOpen = false; render(); }
function openLibrary() {
  state.libraryRangeIndex = libraryRanges.findIndex(([start, end]) => lesson.number >= start && lesson.number <= end);
  state.libraryOpen = true;
  render();
  document.getElementById("close-library")?.focus();
}
function closeLibrary() { state.libraryOpen = false; render(); }

render();
