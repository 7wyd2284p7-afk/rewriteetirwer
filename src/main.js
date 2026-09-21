const lessons = window.RETRANSLATE_LESSONS;
const currentLessonKey = "retranslate.currentLesson";
function bookNumber(item) { return Number(item.id.match(/^nce(\d+)-/)?.[1]); }
const libraryBooks = [...new Set(lessons.map(bookNumber))];
function bookLessons(book) { return lessons.filter((item) => bookNumber(item) === book); }
function rangesForBook(book) {
  const last = Math.max(...bookLessons(book).map((item) => item.number));
  return Array.from({ length: Math.ceil(last / 20) }, (_, index) => [index * 20 + 1, Math.min((index + 1) * 20, last)]);
}

function routeFromLocation() {
  const lessonMatch = location.hash.match(/^#\/book\/(\d+)\/lesson\/(\d+)$/);
  if (lessonMatch) {
    const book = Number(lessonMatch[1]);
    const number = Number(lessonMatch[2]);
    const index = lessons.findIndex((item) => bookNumber(item) === book && item.number === number);
    if (index >= 0) return { view: "lesson", book, number, index };
  }
  const bookMatch = location.hash.match(/^#\/book\/(\d+)$/) || location.hash.match(/^#book-(\d+)$/);
  const book = Number(bookMatch?.[1]);
  if (libraryBooks.includes(book)) return { view: "book-detail", book };
  return { view: "home" };
}

function bookRoute(book) {
  return `#/book/${book}`;
}

function lessonRoute(item) {
  return `#/book/${bookNumber(item)}/lesson/${item.number}`;
}

const initialRoute = routeFromLocation();
const savedLessonIndex = Math.min(Math.max(Number(localStorage.getItem(currentLessonKey) || 0), 0), lessons.length - 1);
let currentIndex = initialRoute.view === "lesson" ? initialRoute.index : savedLessonIndex;
let lesson = lessons[currentIndex];
let keys = lessonKeys(lesson);
let homeBook = initialRoute.book || libraryBooks[0];
let currentView = initialRoute.view;
let detailBook = initialRoute.view === "book-detail" ? initialRoute.book : homeBook;
let detailRangeIndex = 0;
let settingsReturnFocusId = null;
let libraryReturnFocusId = null;

function lessonKeys(item) {
  const prefix = `retranslate.lesson${bookNumber(item)}.${item.number}`;
  return {
    draft: `${prefix}.draft`,
    completed: `${prefix}.completed`,
    duration: `${prefix}.duration`,
  };
}

function readLessonState() {
  return {
    mode: localStorage.getItem(keys.completed) === "true" ? "complete" : "ready",
    draft: localStorage.getItem(keys.draft) || "",
    original: lesson.original || "",
    duration: Number(localStorage.getItem(keys.duration) || 0),
    startedAt: null,
    settingsOpen: false,
    libraryOpen: false,
    libraryBook: bookNumber(lesson),
    libraryRangeIndex: rangesForBook(bookNumber(lesson)).findIndex(([start, end]) => lesson.number >= start && lesson.number <= end),
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

function switchLesson(index, updateHistory = true) {
  if (index < 0 || index >= lessons.length) return;
  currentIndex = index;
  lesson = lessons[currentIndex];
  keys = lessonKeys(lesson);
  currentView = "lesson";
  if (updateHistory) history.pushState({ view: "lesson", book: bookNumber(lesson), lesson: lesson.number }, "", lessonRoute(lesson));
  localStorage.setItem(currentLessonKey, String(currentIndex));
  Object.assign(state, readLessonState());
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function bookLabel(book) {
  return book === 2 ? "二" : book === 3 ? "三" : String(book);
}

function currentLessonForBook(book) {
  const items = bookLessons(book);
  const current = items.find((item) => lessons.indexOf(item) === currentIndex);
  if (current) return current;
  const completed = items.filter((item) => localStorage.getItem(lessonKeys(item).completed) === "true");
  return completed.at(-1) || items[0];
}

function openBookDetail(book, updateHistory = true) {
  if (!libraryBooks.includes(book)) return;
  detailBook = book;
  homeBook = book;
  detailRangeIndex = 0;
  currentView = "book-detail";
  state.libraryOpen = false;
  state.settingsOpen = false;
  if (updateHistory) history.pushState({ view: "book-detail", book }, "", bookRoute(book));
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function returnHome(updateHistory = true) {
  currentView = "home";
  state.libraryOpen = false;
  state.settingsOpen = false;
  if (updateHistory) history.pushState({ view: "home" }, "", `${location.pathname}${location.search}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function renderBookDetail() {
  const book = detailBook;
  const items = bookLessons(book);
  const current = currentLessonForBook(book);
  const ranges = rangesForBook(book);
  detailRangeIndex = Math.min(detailRangeIndex, ranges.length - 1);
  const [start, end] = ranges[detailRangeIndex];
  const rangeItems = items.filter((item) => item.number >= start && item.number <= end);
  const descriptions = {
    2: "从日常场景到完整叙事，通过 96 篇经典课文积累常用句型。选择课程区间，可以更快找到想练习的课目。",
    3: "用更长的文章训练阅读、复述和英文表达。课程详情页按区间展示全部课目，查找和继续学习都会更直接。",
  };
  const englishTitles = { 2: "Practice &amp; Progress", 3: "Developing Skills" };
  const rangeButtons = ranges.map(([from, to], index) => `<button class="book-detail-range ${index === detailRangeIndex ? "active" : ""}" type="button" data-detail-range="${index}" aria-pressed="${index === detailRangeIndex}">
    <strong>${String(from).padStart(2, "0")}—${String(to).padStart(2, "0")}</strong><small>${to - from + 1} LESSONS</small>
  </button>`).join("");
  const lessonRows = rangeItems.map((item) => {
    const index = lessons.indexOf(item);
    const completed = localStorage.getItem(lessonKeys(item).completed) === "true";
    return `<button class="book-detail-lesson" type="button" data-detail-lesson="${index}">
      <span class="book-detail-lesson-number">LESSON ${String(item.number).padStart(2, "0")}</span>
      <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.titleCn)}</small></span>
      <span class="book-detail-lesson-status">${completed ? "已完成 ✓" : "进入课程 →"}</span>
    </button>`;
  }).join("");
  const currentIndexInAll = lessons.indexOf(current);
  const progress = Math.max(2, current.number / items.length * 100);
  document.title = `回译室 · 新概念英语 第${bookLabel(book)}册`;
  document.body.classList.remove("has-modal");
  root.innerHTML = `<div class="book-detail-shell"><div class="book-detail-wrap">
    <header class="home-header"><div class="home-brand">RE:WRITE <span>回译室</span></div><button class="book-detail-home" type="button">课程库</button></header>
    <main class="book-detail-page">
      <button class="book-detail-back" id="book-detail-back" type="button">← BACK</button>
      <section class="book-detail-hero">
        <div class="book-detail-main" data-number="${String(book).padStart(2, "0")}">
          <div class="book-detail-kicker">NEW CONCEPT ENGLISH · BOOK ${String(book).padStart(2, "0")}</div>
          <h1>新概念英语 第${bookLabel(book)}册</h1>
          <div class="book-detail-english">${englishTitles[book] || "New Concept English"}</div>
          <p>${descriptions[book] || "按课程区间浏览全部课目，选择想要练习的课程。"}</p>
        </div>
        <aside class="book-detail-side">
          <div><div class="book-detail-progress-label">YOUR PROGRESS / 学习进度</div>
            <div class="book-detail-progress"><strong>${current.number}</strong><span>/ ${items.length} 课</span></div>
            <div class="book-detail-track"><i style="width:${progress}%"></i></div>
          </div>
          <button class="book-detail-continue" type="button" data-detail-lesson="${currentIndexInAll}"><span>继续 Lesson ${String(current.number).padStart(2, "0")}</span><span>→</span></button>
        </aside>
      </section>
      <section class="book-detail-catalogue">
        <div class="book-detail-catalogue-head"><div><div class="book-detail-kicker">COURSE CATALOGUE / 课程目录</div><h2>选择课程</h2></div><p>先选区间，再进入具体课目</p></div>
        <div class="book-detail-ranges">${rangeButtons}</div>
        <div class="book-detail-lessons">${lessonRows}</div>
      </section>
    </main>
    <footer class="home-footer"><span>RE:WRITE · 回译室</span><span>NEW CONCEPT ENGLISH · RETRANSLATION PRACTICE</span></footer>
  </div></div>`;
  document.getElementById("book-detail-back").addEventListener("click", () => returnHome());
  document.querySelector(".book-detail-home").addEventListener("click", () => returnHome());
  document.querySelectorAll("[data-detail-range]").forEach((button) => button.addEventListener("click", () => {
    detailRangeIndex = Number(button.dataset.detailRange);
    renderBookDetail();
    document.querySelector(`[data-detail-range="${detailRangeIndex}"]`)?.focus();
  }));
  document.querySelectorAll("[data-detail-lesson]").forEach((button) => button.addEventListener("click", () => switchLesson(Number(button.dataset.detailLesson))));
}

function renderHome() {
  const savedIndex = localStorage.getItem(currentLessonKey);
  const recentLesson = savedIndex === null ? lessons[0] : lesson;
  const bookCards = libraryBooks.map((book) => `<button class="home-book" type="button" data-home-book="${book}" aria-pressed="${homeBook === book}">
    <span class="home-book-top"><span>NEW CONCEPT ENGLISH</span><span>已收录 ${bookLessons(book).length} 课</span></span>
    <span class="home-book-num">${String(book).padStart(2, "0")}</span>
    <span class="home-book-bottom"><span class="home-book-title">新概念英语 第${book === 2 ? "二" : "三"}册<small>${book === 2 ? "Practice &amp; Progress" : "Developing Skills"}</small></span><span class="home-book-cta">查看课程 ↗</span></span>
  </button>`).join("");
  const previewLessons = bookLessons(homeBook).slice(0, 3).map((item) => `<button class="home-lesson" type="button" data-home-lesson="${lessons.indexOf(item)}">
    <span>LESSON ${String(item.number).padStart(2, "0")}</span><strong>${escapeHTML(item.title)}</strong><em>${escapeHTML(item.titleCn)}</em>
  </button>`).join("");
  document.title = "回译室 · 首页";
  document.body.classList.toggle("has-modal", state.libraryOpen);
  root.innerHTML = `<div class="home-shell"><div class="home-wrap" ${state.libraryOpen ? "inert" : ""}>
    <header class="home-header"><div class="home-brand">RE:WRITE <span>回译室</span></div><button class="home-header-link" id="home-library" type="button">课程库 ↗</button></header>
    <main>
      <section class="home-hero" aria-labelledby="home-title">
        <div><div class="home-eyebrow">NEW CONCEPT ENGLISH</div><h1 id="home-title">Your next lesson<br><em>starts here.</em></h1>
          <p class="home-intro">Choose a textbook. Read the original, then rewrite it in your own English—one lesson at a time.</p>
          <div class="home-hero-foot"><span></span> READ · RECALL · REWRITE</div>
        </div>
        <aside class="home-continue" data-book="${String(bookNumber(recentLesson)).padStart(2, "0")}"><div class="home-continue-top"><span>${savedIndex === null ? "从第一课开始" : "继续上次学习"}</span><span class="home-dot" aria-hidden="true"></span></div>
          <h2>Lesson ${String(recentLesson.number).padStart(2, "0")}<br>${escapeHTML(recentLesson.title)}</h2><p>${escapeHTML(recentLesson.titleCn)}</p>
          <button id="home-continue" type="button">${savedIndex === null ? "开始练习" : "继续练习"} <span aria-hidden="true">↗</span></button>
        </aside>
      </section>
      <section class="home-courses" aria-labelledby="home-courses-title">
        <div class="home-section-head"><div><div class="home-kicker">YOUR LIBRARY / 课程入口</div><h2 id="home-courses-title">Choose a textbook</h2></div></div>
        <div class="home-books">${bookCards}</div>
        <div class="home-preview"><div class="home-preview-head"><strong>第${homeBook === 2 ? "二" : "三"}册 · 课程预览</strong><button id="home-all-lessons" type="button">查看全部课程 ↗</button></div><div class="home-lessons">${previewLessons}</div></div>
      </section>
    </main><footer class="home-footer"><span>RE:WRITE · 回译室</span><span>NEW CONCEPT ENGLISH · RETRANSLATION PRACTICE</span></footer>
  </div>${renderLibraryModal()}</div>`;
  document.getElementById("home-continue").addEventListener("click", () => switchLesson(savedIndex === null ? 0 : currentIndex));
  document.querySelectorAll("[data-home-book]").forEach((button) => button.addEventListener("click", () => openBookDetail(Number(button.dataset.homeBook))));
  document.querySelectorAll("[data-home-lesson]").forEach((button) => button.addEventListener("click", () => switchLesson(Number(button.dataset.homeLesson))));
  document.getElementById("home-library").addEventListener("click", () => openLibrary(homeBook));
  document.getElementById("home-all-lessons").addEventListener("click", () => openBookDetail(homeBook));
  attachLibraryEvents();
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
  const previousInBook = lessons[currentIndex - 1]?.book === lesson.book;
  const nextInBook = lessons[currentIndex + 1]?.book === lesson.book;
  return `<nav class="lesson-switcher" aria-label="课程切换">
    <button type="button" id="previous-lesson" ${previousInBook ? "" : "disabled"}>← 上一课</button>
    <span>${lesson.number} / ${bookLessons(bookNumber(lesson)).length} 已录入</span>
    <button type="button" id="next-lesson" ${nextInBook ? "" : "disabled"}>下一课 →</button>
  </nav>`;
}

function renderSettingsModal() {
  if (!state.settingsOpen) return "";
  return `<div class="modal-backdrop" id="settings-backdrop">
    <section class="modal original-modal" id="original-modal" role="dialog" aria-modal="true" aria-label="英文原文">
      <button class="close-button" id="close-modal" type="button" aria-label="关闭">×</button>
      <div class="modal-drag-handle" id="original-drag-handle">
        <div class="eyebrow">LESSON ${String(lesson.number).padStart(2, "0")}</div>
        <div class="mobile-original-heading"><strong>${escapeHTML(lesson.title)}</strong><span>${escapeHTML(lesson.titleCn)}</span></div>
      </div>
      <div class="original-modal-copy" tabindex="0">${state.original ? escapeHTML(state.original) : "暂无英文原文。"}</div>
      <div class="mobile-bilingual-view">
        <section class="bilingual-pane bilingual-original" aria-label="英文原文" tabindex="0">
          <div class="bilingual-pane-label">ENGLISH · 原文</div>
          <div>${state.original ? escapeHTML(state.original) : "暂无英文原文。"}</div>
        </section>
        <section class="bilingual-pane bilingual-translation" aria-label="中文翻译" tabindex="0">
          <div class="bilingual-pane-label">中文翻译</div>
          <div>${escapeHTML(lesson.chinese)}</div>
        </section>
      </div>
    </section>
  </div>`;
}

function enableModalDragging() {
  const modal = document.getElementById("original-modal");
  const handle = document.getElementById("original-drag-handle");
  if (!modal || !handle) return;
  if (window.matchMedia("(max-width: 680px)").matches) return;
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
  const book = state.libraryBook;
  const ranges = rangesForBook(book);
  const [start, end] = ranges[state.libraryRangeIndex];
  const bookTabs = libraryBooks.map((number) => `<button class="library-book" type="button" role="tab" aria-selected="${number === book}" data-library-book="${number}">新概念英语 ${number}</button>`).join("");
  const rangeTabs = ranges.map(([from, to], index) => `<button class="library-range" type="button" role="tab" aria-label="${from}–${to}课" aria-selected="${index === state.libraryRangeIndex}" data-library-range="${index}">
    <strong>${from}–${to}</strong><small>LESSONS</small>
  </button>`).join("");
  const rangeLessons = lessons.map((item, index) => ({ item, index })).filter(({ item }) => bookNumber(item) === book && item.number >= start && item.number <= end);
  const cards = rangeLessons.map(({ item, index }) => {
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
      <div class="eyebrow">NEW CONCEPT ENGLISH ${book}</div>
      <h2 id="library-title">课程库</h2>
      <p>每一课分别保存练习记录。本册已录入 ${bookLessons(book).length} 课。</p>
      <div class="library-books" role="tablist" aria-label="教材册数">${bookTabs}</div>
      ${ranges.length > 1 ? `<div class="library-ranges" role="tablist" aria-label="课程范围">${rangeTabs}</div>` : ""}
      <div class="library-range-summary"><strong>第 ${start}–${end} 课</strong><span>已录入 ${rangeLessons.length} 课</span></div>
      <div class="lesson-list">${cards}</div>
    </section>
  </div>`;
}

function render() {
  if (currentView === "home") return renderHome();
  if (currentView === "book-detail") return renderBookDetail();
  document.title = `回译室 · ${lesson.title}`;
  const modalOpen = state.settingsOpen || state.libraryOpen;
  document.body.classList.toggle("has-modal", modalOpen);
  root.innerHTML = `<div class="app-shell ${state.mode === "writing" ? "is-writing" : ""}">
    <header class="topbar" ${modalOpen ? "inert" : ""}>
      <button class="brand brand-button" id="go-home" type="button" aria-label="返回首页"><span>RE:</span>WRITE</button>
      <div class="top-actions">
        <button class="ghost-button" id="library" type="button">课程库</button>
        <button class="ghost-button" id="view-original" type="button">原文</button>
      </div>
    </header>
    <main class="lesson-page" ${modalOpen ? "inert" : ""}>
      <nav class="breadcrumb" aria-label="当前位置"><button class="breadcrumb-home" id="breadcrumb-home" type="button">‹ ${escapeHTML(lesson.book)}</button><span>/</span> Lesson ${lesson.number}</nav>
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
    <footer ${modalOpen ? "inert" : ""}><span>NEW CONCEPT ENGLISH · RETRANSLATION PRACTICE</span><span>本地自动保存</span></footer>
    ${renderSettingsModal()}
    ${renderLibraryModal()}
  </div>`;

  document.getElementById("view-original")?.addEventListener("click", openSettings);
  document.getElementById("go-home")?.addEventListener("click", () => returnHome());
  document.getElementById("breadcrumb-home")?.addEventListener("click", () => returnHome());
  document.getElementById("library")?.addEventListener("click", () => openLibrary());
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
  attachLibraryEvents();
  document.getElementById("close-modal")?.addEventListener("click", closeSettings);
  document.getElementById("settings-backdrop")?.addEventListener("mousedown", (event) => event.target === event.currentTarget && closeSettings());
  enableModalDragging();
}

function attachLibraryEvents() {
  document.querySelectorAll("[data-library-range]").forEach((button) => button.addEventListener("click", () => {
    state.libraryRangeIndex = Number(button.dataset.libraryRange);
    render();
    document.querySelector(`[data-library-range="${state.libraryRangeIndex}"]`)?.focus();
  }));
  document.querySelectorAll("[data-library-book]").forEach((button) => button.addEventListener("click", () => {
    state.libraryBook = Number(button.dataset.libraryBook);
    state.libraryRangeIndex = 0;
    render();
    document.querySelector(`[data-library-book="${state.libraryBook}"]`)?.focus();
  }));
  document.querySelectorAll("[data-lesson-index]").forEach((button) => button.addEventListener("click", () => switchLesson(Number(button.dataset.lessonIndex))));
  document.getElementById("close-library")?.addEventListener("click", closeLibrary);
  document.getElementById("library-backdrop")?.addEventListener("mousedown", (event) => event.target === event.currentTarget && closeLibrary());
}

function restoreModalFocus(id) {
  if (id) document.getElementById(id)?.focus();
}

function openSettings() {
  settingsReturnFocusId = document.activeElement?.id || "view-original";
  state.settingsOpen = true;
  render();
  document.getElementById("close-modal")?.focus();
}

function closeSettings() {
  const returnFocusId = settingsReturnFocusId;
  settingsReturnFocusId = null;
  state.settingsOpen = false;
  render();
  restoreModalFocus(returnFocusId);
}

function openLibrary(book = bookNumber(lesson)) {
  libraryReturnFocusId = document.activeElement?.id || (currentView === "home" ? "home-library" : "library");
  state.libraryBook = book;
  state.libraryRangeIndex = currentView === "home" ? 0 : rangesForBook(book).findIndex(([start, end]) => lesson.number >= start && lesson.number <= end);
  state.libraryOpen = true;
  render();
  document.getElementById("close-library")?.focus();
}

function closeLibrary() {
  const returnFocusId = libraryReturnFocusId;
  libraryReturnFocusId = null;
  state.libraryOpen = false;
  render();
  restoreModalFocus(returnFocusId);
}

function trapModalFocus(event) {
  if (event.key !== "Tab") return;
  const dialog = document.querySelector(".modal-backdrop [role='dialog']");
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter((element) => element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.settingsOpen) {
      event.preventDefault();
      closeSettings();
    } else if (state.libraryOpen) {
      event.preventDefault();
      closeLibrary();
    }
    return;
  }
  if (state.settingsOpen || state.libraryOpen) trapModalFocus(event);
});

window.addEventListener("popstate", () => {
  const route = routeFromLocation();
  if (route.view === "lesson") {
    currentIndex = route.index;
    lesson = lessons[currentIndex];
    keys = lessonKeys(lesson);
    homeBook = route.book;
    currentView = "lesson";
    localStorage.setItem(currentLessonKey, String(currentIndex));
    Object.assign(state, readLessonState());
  } else if (route.view === "book-detail") {
    detailBook = route.book;
    homeBook = route.book;
    detailRangeIndex = 0;
    currentView = "book-detail";
  } else {
    currentView = "home";
    state.libraryOpen = false;
    state.settingsOpen = false;
  }
  settingsReturnFocusId = null;
  libraryReturnFocusId = null;
  state.libraryOpen = false;
  state.settingsOpen = false;
  window.scrollTo(0, 0);
  render();
});

if (initialRoute.view === "lesson") localStorage.setItem(currentLessonKey, String(currentIndex));
if (location.hash.match(/^#book-(\d+)$/)) history.replaceState({ view: "book-detail", book: detailBook }, "", bookRoute(detailBook));
render();
