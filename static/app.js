"use strict";

const POS_NAMES = {
  verb: "Verbs", phrasal: "Phrasal verbs", particle: "Particles & directions",
  adjective: "Adjectives", preposition: "Prepositions",
  adverb: "Adverbs", noun: "Nouns", nounphrase: "Noun phrases",
  other: "Connectors / polite / idioms / patterns", combo: "Combos (multiple blanks)",
  grammar: "Grammar topics",
};
const POS_ORDER = Object.keys(POS_NAMES);
const SCENE_NAMES = {
  work: "Work", tech: "IT", restaurant: "Restaurant & food", sports: "Sport", shopping: "Shopping",
  travel: "Travel", health: "Health", home: "Home", social: "Social", money: "Money", mixed: "Mixed",
  connector: "Connectors", polite: "Polite language", idiom: "Idioms & slang", pattern: "Sentence patterns",
  past: "Past simple", future: "Future", continuous: "Present continuous",
  subjunctive: "Subjunctive & conditionals", tenses: "Other tenses", third: "Third person",
  plural: "Plurals", misc: "Other grammar",
  calls: "Video calls & meetings", directions: "Directions & places (NZ)", everyday: "Everyday on / off / up / down",
  email: "Email & messages", driving: "Driving & commuting", family: "Family & kids", feelings: "Feelings",
  outdoors: "Weather & outdoors", admin: "Paperwork & services", speaking: "Presenting & speaking",
  study: "Learning & study", body: "Body & movement", nature: "Animals & plants", news: "News, law & society",
  media: "Phone & social media", hobbies: "Hobbies & arts", talk: "Ways of talking", mind: "Thinking & deciding",
  diy: "DIY & repairs",
};
// Sentence translation: one file per sentence type, in this order.
const TYPE_NAMES = {
  subjectless: "No subject in Chinese (下雨了 / 该走了)", topic: "Topic first & 把 (这事我来办)",
  existential: "有: there is / have", questions: "Questions", polite: "Polite requests & suggestions",
  relative: "Relative clauses (…的那个)", time_if: "Time & if clauses", reason_contrast: "Because / although",
  tense: "Tenses (已经 / 还没 / 一直)", passive: "Passive without 被", compare: "Comparisons",
};
const TYPE_ORDER = Object.keys(TYPE_NAMES);
const KIND_TEXT = {
  correct: "correct", grammar: "right word, wrong form", spelling: "spelling mistake",
  word: "wrong word", empty: "empty",
};

const view = document.getElementById("view");
let settings = { accent: "us", new_per_day: 20, model: "", has_key: false, tts: "browser" };
let prefill = null; // card draft handed from another page to the add page

// Example answers may contain {name}, {hometown}, {role} and {company}, filled in from Settings.
const PLACEHOLDERS = { name: ["my_name", "your name"], hometown: ["hometown", "your hometown"],
  role: ["my_role", "your job title"], company: ["my_company", "your company"] };
function personalise(text) {
  return Object.entries(PLACEHOLDERS).reduce((t, [key, [field, label]]) =>
    t.replaceAll(`{${key}}`, settings[field] || `[${label}]`), text);
}
const missingDetails = (text) => Object.entries(PLACEHOLDERS).some(([key, [field]]) =>
  text.includes(`{${key}}`) && !settings[field]);
const clozeFilters = { pos: "", scene: "", level: "", mode: "" };
const translateFilters = { type: "", scene: "", level: "", mode: "" };

// ---- helpers ----------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid != null && kid !== false) el.append(kid);
  }
  return el;
}

async function api(method, path, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch("/api/" + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ---- read aloud --------------------------------------------------------
// Natural OpenAI voice when enabled (generated once, cached on disk by the server and
// in memory here), otherwise the browser's built-in voice.
const audioUrls = new Map();
let currentAudio = null;
let speakToken = null; // only the latest speak() call may start playing
let ttsWarned = false;

function stopSpeaking() {
  speakToken = null;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function bestBrowserVoice(lang) {
  const score = (v) => (/natural|neural|premium|enhanced/i.test(v.name) ? 4 : 0)
    + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return speechSynthesis.getVoices()
    .filter((v) => v.lang.replace("_", "-") === lang)
    .sort((a, b) => score(b) - score(a))[0];
}

function browserSpeak(text, accent, pace) {
  if (!("speechSynthesis" in window)) return;
  const lang = accent === "uk" ? "en-GB" : "en-US";
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = bestBrowserVoice(lang);
  if (voice) utterance.voice = voice;
  if (pace === "slow") utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

// options: {tts, voice, pace} override the saved settings (used by the settings preview);
// {private: true} keeps the generated audio in private/ (lines about real work projects).
async function speak(text, accent, options = {}) {
  stopSpeaking();
  if (!text) return;
  const token = {};
  speakToken = token;
  const a = accent || settings.accent;
  const pace = options.pace || settings.pace;
  if ((options.tts || settings.tts) === "openai" && settings.has_key) {
    const voice = options.voice || settings.voice;
    const cacheKey = JSON.stringify([voice, a, pace, text, !!options.private]);
    try {
      let url = audioUrls.get(cacheKey);
      if (!url) {
        const response = await fetch("/api/tts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, accent: a, voice, pace, private: !!options.private }),
        });
        if (!response.ok) throw new Error((await response.json()).error || "Could not generate speech");
        url = URL.createObjectURL(await response.blob());
        audioUrls.set(cacheKey, url);
      }
      if (speakToken !== token) return; // a newer speak(), or the page changed
      currentAudio = new Audio(url);
      await currentAudio.play();
      return;
    } catch (e) {
      // NotAllowedError: autoplay blocked before any click; AbortError: stopped by a newer call.
      if (speakToken !== token || e.name === "NotAllowedError" || e.name === "AbortError") return;
      if (!ttsWarned) {
        ttsWarned = true;
        toast("Natural voice unavailable, using the browser voice: " + e.message);
      }
    }
  }
  if (speakToken === token) browserSpeak(text, a, pace);
}

function speakButtons(text) {
  return [
    h("button", { class: "link", type: "button", title: "British pronunciation", onclick: () => speak(text, "uk") }, "🔊 UK"),
    h("button", { class: "link", type: "button", title: "American pronunciation", onclick: () => speak(text, "us") }, "🔊 US"),
  ];
}

// replaceChildren, but accepts nested arrays and skips null/false (as h() does).
function fill(el, ...nodes) {
  el.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
}

function show(...nodes) {
  fill(view, ...nodes);
}

// "← Previous": look back at answers you have moved on from, then return to where you were.
// Past cards are kept as live DOM nodes, so their buttons (Never show again, Add to word bank,
// I actually guessed, ☆ Save) still work. `past` holds {nodes, label?}, newest last; pass an
// array that outlives the view to keep it across re-renders. Nothing here is saved.
const PAST_LIMIT = 20;
function answerHistory(box, past = [], noun = "answer") {
  let at = -1;        // index into past while looking back, -1 when showing the current content
  let saved = null;   // the current content, set aside while looking back
  const nav = h("span", { class: "row history-nav" });

  function draw() {
    const button = (text, onclick, attrs = {}) => h("button", { type: "button", onclick, ...attrs }, text);
    if (at < 0) {
      fill(nav, past.length ? button("← Previous", back,
        { class: "link", title: `See your last ${noun} again` }) : null);
      return;
    }
    const home = button("Back to current", toCurrent, { class: "primary" });
    fill(nav,
      h("span", { class: "muted" }, `Earlier ${noun} ${past.length - at} of ${past.length}`),
      button("←", back, { disabled: at === 0, title: "Older", "aria-label": "Older" }),
      button("→", forward, { title: "Newer", "aria-label": "Newer" }),
      home);
    home.focus();
  }

  function showPast() {
    const entry = past[at];
    fill(box, h("div", { class: "past" },
      entry.label ? h("div", { class: "card muted" }, entry.label) : null, entry.nodes));
    draw();
  }

  function back() {
    if (at < 0) {
      if (!past.length) return;
      saved = [...box.childNodes];
      at = past.length;
    }
    if (at > 0) { at -= 1; showPast(); }
  }

  function toCurrent() {
    if (at < 0) return;
    at = -1;
    fill(box, saved);
    saved = null;
    draw();
    const target = box.querySelector("input:not(:disabled), textarea:not(:disabled), button.primary");
    if (target) target.focus();
  }

  function forward() {
    if (at < 0) return;
    if (at + 1 < past.length) { at += 1; showPast(); } else toCurrent();
  }

  draw();
  return {
    nav,
    get reviewing() { return at >= 0; },
    forward,
    // A finished card the learner is moving on from.
    keep(entry) {
      past.push(entry);
      if (past.length > PAST_LIMIT) past.shift();
      draw();
    },
    // New content is going into the box: stop looking back.
    reset() { at = -1; saved = null; draw(); },
  };
}

// ---- home -------------------------------------------------------------
async function homeView() {
  const s = await api("GET", "summary");
  const stat = (n, label) => h("div", { class: "card stat" }, h("b", {}, String(n)), label);
  show(
    h("h1", {}, "What to practise today"),
    h("div", { class: "grid" },
      stat(s.words.due, "words due for review"),
      stat(s.words.new_today_left, "new words left today"),
      stat(s.cloze.due, "cloze questions to redo"),
      stat(s.cloze.unseen, "cloze questions not yet done"),
      stat(s.translate.due, "translations to redo"),
    ),
    h("div", { class: "card" },
      h("div", {}, `Cloze bank: ${s.cloze.total} questions · ${s.cloze.passed} passed · ${s.cloze.learning} learning · ${s.cloze.never} hidden`),
      h("div", {}, `Translation bank: ${s.translate.total} sentences · ${s.translate.passed} passed · ${s.translate.learning} learning`),
      h("div", {}, `Word bank: ${s.words.total} words · ${s.words.never} hidden`),
      s.has_key ? null : h("p", { class: "muted" }, "No OpenAI key yet, so AI explanations and feedback are off. Add it in Settings."),
    ),
    h("div", { class: "row" },
      h("a", { href: "#cloze" }, h("button", { class: "primary", type: "button" }, "Start cloze")),
      h("a", { href: "#translate" }, h("button", { type: "button" }, "Translate sentences")),
      h("a", { href: "#review" }, h("button", { type: "button" }, "Review words")),
    ),
  );
}

// ---- cloze ------------------------------------------------------------
const clozeMeta = () => api("GET", "cloze/meta?" + new URLSearchParams(
  Object.entries({ pos: clozeFilters.pos, scene: clozeFilters.scene }).filter(([, v]) => v)));

async function clozeView() {
  let { counts } = await clozeMeta();
  // Scenes (or grammar topics) offered depend on the chosen word class; drop a stale scene.
  if (clozeFilters.scene && !(clozeFilters.scene in counts.scenes)) {
    clozeFilters.scene = "";
    ({ counts } = await clozeMeta());
  }
  if (clozeFilters.level && !(clozeFilters.level in counts.levels)) clozeFilters.level = "";
  const names = { pos: (k) => POS_NAMES[k] || k, scenes: (k) => SCENE_NAMES[k] || k, levels: (k) => "L" + k };
  const label = (group, k, c) => `${names[group](k)} (${c.total} / ${c.left})`; // total / not yet attempted
  // group: which counts feed the options; key: the filter it sets; rerender: whether other counts change.
  const select = (group, key, placeholder, rerender) => {
    const entries = Object.entries(counts[group]);
    if (group === "pos") entries.sort(([a], [b]) => (POS_ORDER.indexOf(a) + 1 || 99) - (POS_ORDER.indexOf(b) + 1 || 99));
    return h("select", { "aria-label": placeholder, "data-group": group,
      onchange: (e) => { clozeFilters[key] = e.target.value; if (rerender) clozeView(); else loadQuestion(); } },
      h("option", { value: "" }, placeholder),
      entries.map(([k, c]) => h("option", { value: k, selected: clozeFilters[key] === k }, label(group, k, c))));
  };
  // After each question the "left" numbers change: relabel the options in place.
  async function refreshCounts() {
    ({ counts } = await clozeMeta());
    for (const sel of view.querySelectorAll("select[data-group]")) {
      for (const opt of sel.options) {
        const c = counts[sel.dataset.group][opt.value];
        if (opt.value && c) opt.textContent = label(sel.dataset.group, opt.value, c);
      }
    }
  }
  const box = h("div", {});
  const earlier = answerHistory(box);
  let current = null; // {nodes, done}: the question on screen
  show(
    h("h1", {}, clozeFilters.mode === "wrongbook" ? "Redo wrong answers" : "Translation cloze"),
    h("div", { class: "row", style: "margin-bottom:16px" },
      select("pos", "pos", "All word classes and topics", true),
      select("scenes", "scene", clozeFilters.pos === "grammar" ? "All topics" : "All scenes", true),
      select("levels", "level", "All levels", false),
      clozeFilters.mode === "wrongbook"
        ? h("button", { type: "button", onclick: () => { clozeFilters.mode = ""; clozeView(); } }, "Back to normal practice")
        : null,
      earlier.nav,
    ),
    box,
  );

  // "Next" on a card: the next question, or, on an earlier card, the next newer one.
  const advance = () => (earlier.reviewing ? earlier.forward() : loadQuestion());

  async function loadQuestion() {
    if (current && current.done) earlier.keep(current);
    current = null;
    earlier.reset();
    refreshCounts();
    const params = new URLSearchParams(Object.entries(clozeFilters).filter(([, v]) => v));
    const { question: q, redo } = await api("GET", "cloze/next?" + params);
    if (!q) {
      fill(box, h("div", { class: "card" },
        clozeFilters.mode === "wrongbook" ? "The wrong book is empty." : "You have done every question in this range. Try another word class, scene or level."));
      return;
    }
    renderQuestion(q, redo);
  }

  function renderQuestion(q, redo) {
    let attempted = false;
    const inputs = [];
    const sentence = h("div", { class: "en" }, q.segments.map((seg) => {
      if (seg.text !== undefined) return seg.text;
      const input = h("input", {
        class: "blank", placeholder: seg.hint ? seg.hint + "…" : "",
        style: `width:${Math.max(6, seg.length + 3)}ch`,
        autocomplete: "off", autocapitalize: "off",
        spellcheck: "false", "aria-label": `Blank ${seg.blank + 1}`,
      });
      inputs.push(input);
      return input;
    }));
    const feedback = h("div", { class: "feedback" });
    const actions = h("div", { class: "row" });
    const form = h("form", { class: "card", onsubmit: (e) => { e.preventDefault(); submit(); } },
      h("div", {},
        h("span", { class: "tag" }, POS_NAMES[q.pos] || q.pos),
        h("span", { class: "tag" }, SCENE_NAMES[q.scene] || q.scene),
        h("span", { class: "tag" }, "L" + q.level),
        redo ? h("span", { class: "tag redo" }, "Redo") : null),
      // English first; the Chinese sits underneath as the meaning to aim for.
      sentence, h("div", { class: "zh zh-below" }, q.zh), feedback, actions);
    const entry = { nodes: [form], done: false };
    current = entry;

    function answeringActions() {
      fill(actions, 
        h("button", { class: "primary", type: "submit" }, attempted ? "Try again" : "Check"),
        h("button", { type: "button", onclick: revealAnswer }, "Show answer"),
        h("button", { class: "link", type: "button", onclick: never }, "Never show again"),
      );
    }

    async function submit() {
      const result = await api("POST", "cloze/answer", {
        id: q.id, answers: inputs.map((i) => i.value), record: !attempted,
      });
      result.blanks.forEach((b, i) => { inputs[i].className = "blank " + b.kind; });
      if (result.correct) return finish(result, !attempted);
      attempted = true;
      fill(feedback, ...result.blanks.map((b, i) =>
        h("div", { class: b.kind === "correct" ? "good" : "bad" }, `Blank ${i + 1}: ${KIND_TEXT[b.kind]}`)));
      answeringActions();
      (inputs.find((i) => !i.classList.contains("correct")) || inputs[0]).focus();
    }

    async function revealAnswer() {
      const result = attempted
        ? await api("GET", "cloze/solution?id=" + encodeURIComponent(q.id))
        : await api("POST", "cloze/mark", { id: q.id, outcome: "reveal" });
      finish(result, false);
    }

    async function never() {
      await api("POST", "cloze/mark", { id: q.id, outcome: "never" });
      toast("This question won't appear again");
      advance();
    }

    function finish(result, firstTry) {
      entry.done = true;
      inputs.forEach((i) => { i.disabled = true; });
      speak(result.sentence);
      fill(feedback, 
        h("div", { class: firstTry ? "good" : "bad" },
          firstTry ? "Correct." : "This question comes back later today, then at growing intervals."),
        h("div", { class: "answer" }, result.sentence,
          h("button", { class: "link", type: "button", onclick: () => speak(result.sentence) }, "🔊")),
        result.note ? h("div", { class: "note" }, "💡 " + result.note) : null,
      );
      const next = h("button", { class: "primary", type: "button", onclick: advance }, "Next");
      const guessed = h("button", { type: "button", onclick: async () => {
        await api("POST", "cloze/mark", { id: q.id, outcome: "guessed" });
        guessed.disabled = true;
        toast("Added to the redo queue");
      } }, "I actually guessed");
      fill(actions, 
        next,
        firstTry ? guessed : null,
        h("button", { type: "button", onclick: () => {
          prefill = { term: result.answers[0], examples: [{ en: result.sentence, zh: result.zh }], tags: ["Cloze"] };
          location.hash = "#add";
        } }, "Add to word bank"),
        h("button", { class: "link", type: "button", onclick: never }, "Never show again"),
      );
      next.focus();
    }

    answeringActions();
    fill(box, form);
    inputs[0].focus();
  }

  await loadQuestion();
}

// ---- sentence translation -------------------------------------------
const VERDICT_TEXT = {
  good: ["good", "✅ Correct and natural."],
  fix: ["warn", "⚠️ Almost. Fix these:"],
  wrong: ["bad", "❌ Not quite. The meaning is off:"],
};
const translateMeta = () => api("GET", "translate/meta?" + new URLSearchParams(
  Object.entries({ type: translateFilters.type, scene: translateFilters.scene }).filter(([, v]) => v)));

async function translateView() {
  let { counts } = await translateMeta();
  if (translateFilters.scene && !(translateFilters.scene in counts.scenes)) translateFilters.scene = "";
  if (translateFilters.level && !(translateFilters.level in counts.levels)) translateFilters.level = "";
  const names = { types: (k) => TYPE_NAMES[k] || k, scenes: (k) => SCENE_NAMES[k] || k, levels: (k) => "L" + k };
  const label = (group, k, c) => `${names[group](k)} (${c.total} / ${c.left})`; // total / not yet attempted
  const select = (group, key, placeholder, rerender) => {
    const entries = Object.entries(counts[group]);
    if (group === "types") entries.sort(([a], [b]) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99));
    return h("select", { "aria-label": placeholder, "data-group": group,
      onchange: (e) => { translateFilters[key] = e.target.value; if (rerender) translateView(); else loadQuestion(); } },
      h("option", { value: "" }, placeholder),
      entries.map(([k, c]) => h("option", { value: k, selected: translateFilters[key] === k }, label(group, k, c))));
  };
  async function refreshCounts() {
    ({ counts } = await translateMeta());
    for (const sel of view.querySelectorAll("select[data-group]")) {
      for (const opt of sel.options) {
        const c = counts[sel.dataset.group][opt.value];
        if (opt.value && c) opt.textContent = label(sel.dataset.group, opt.value, c);
      }
    }
  }
  const wrongbook = translateFilters.mode === "wrongbook";
  const box = h("div", {});
  const earlier = answerHistory(box);
  let current = null; // {nodes, done, refresh}: the sentence on screen
  show(
    h("h1", {}, wrongbook ? "Redo saved and wrong translations" : "Translate the sentence"),
    h("div", { class: "row", style: "margin-bottom:16px" },
      select("types", "type", "All sentence types", true),
      select("scenes", "scene", "All scenes", true),
      select("levels", "level", "All levels", false),
      wrongbook
        ? h("button", { type: "button", onclick: () => { translateFilters.mode = ""; translateView(); } }, "Back to normal practice")
        : null,
      earlier.nav,
    ),
    box,
  );

  // "Next" on a card: the next sentence, or, on an earlier card, the next newer one.
  const advance = () => (earlier.reviewing ? earlier.forward() : loadQuestion());

  async function loadQuestion() {
    if (current && current.done) {
      current.refresh(); // its buttons now reflect what was recorded on leaving it
      earlier.keep(current);
    }
    current = null;
    earlier.reset();
    refreshCounts();
    const params = new URLSearchParams(Object.entries(translateFilters).filter(([, v]) => v));
    const r = await api("GET", "translate/next?" + params);
    if (!r.question) {
      fill(box, h("div", { class: "card" },
        wrongbook ? "Nothing in the wrong book here." : "You have done every sentence in this range. Try another type, scene or level."));
      return;
    }
    renderQuestion(r.question, r.redo, r.in_wrong_book);
  }

  function renderQuestion(q, redo, inBook) {
    let attempted = false;
    // Whether this question's result is recorded: a right first answer, a revealed
    // answer, or the learner's choice after a wrong one (next, or save + next).
    let settled = false;
    let tries = 0;
    const input = h("textarea", { class: "translation", rows: 2, autocomplete: "off", spellcheck: "false",
      placeholder: "Type the whole sentence in English. Enter to check, Shift+Enter for a new line.",
      onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); check(); } } });
    const feedback = h("div", { class: "feedback" });
    const actions = h("div", { class: "row" });
    const tags = h("div", {});
    const card = h("div", { class: "card" },
      tags, h("div", { class: "zh translate-zh" }, q.zh), input, feedback, actions);
    let shown = null; // the last answer shown, for redrawing the buttons
    const entry = { nodes: [card], done: false, refresh: () => { input.disabled = true; if (shown) drawActions(shown); } };
    current = entry;

    function drawTags() {
      fill(tags,
        h("span", { class: "tag" }, TYPE_NAMES[q.type] || q.type),
        h("span", { class: "tag" }, SCENE_NAMES[q.scene] || q.scene),
        h("span", { class: "tag" }, "L" + q.level),
        redo ? h("span", { class: "tag redo" }, "Redo") : null);
    }

    const starButton = () => h("button", { type: "button", title: inBook ? "Take it off the wrong book" : "Save to the wrong book to review later",
      onclick: async (e) => {
        if (inBook) {
          await api("POST", "translate/wrongbook/remove", { id: q.id });
          inBook = false;
          toast("Removed from the wrong book");
        } else {
          await api("POST", "translate/mark", { id: q.id, outcome: "star" });
          inBook = true;
          toast("Saved to the wrong book");
        }
        e.target.replaceWith(starButton());
      } }, inBook ? "★ In wrong book" : "☆ Save");

    const never = async () => {
      await api("POST", "translate/mark", { id: q.id, outcome: "never" });
      toast("This sentence won't appear again");
      advance();
    };

    function answering() {
      input.disabled = false;
      fill(feedback);
      fill(actions,
        h("button", { class: "primary", type: "button", onclick: check }, "Check"),
        h("button", { type: "button", onclick: showAnswer }, "Show answer"),
        starButton(),
        h("button", { class: "link", type: "button", onclick: never }, "Never show again"));
      input.focus();
    }

    async function check() {
      const answer = input.value.trim();
      if (!answer) return input.focus();
      input.disabled = true;
      fill(actions, h("span", { class: "muted" }, "Checking…"));
      let r;
      try {
        r = await api("POST", "translate/check", { id: q.id, answer, record: !attempted });
        tries += 1;
      } catch (e) {
        toast(e.message);
        return answering();
      }
      inBook = r.in_wrong_book;
      if (r.verdict === "good" && !attempted) settled = true;
      attempted = true;
      finish(r, answer);
    }

    async function showAnswer() {
      const r = await api("POST", "translate/mark", { id: q.id, outcome: "reveal" });
      inBook = r.in_wrong_book;
      attempted = true;
      settled = true;
      input.disabled = true;
      finish(r, null);
    }

    // r: the reference (en, alt, point) plus, after a check, verdict / issues / fixed.
    function finish(r, answer) {
      entry.done = true;
      shown = r;
      speak(r.en);
      const verdict = r.verdict && VERDICT_TEXT[r.verdict];
      const selfMark = answer && !r.verdict; // no key, or the AI call failed
      const markBox = h("div", { class: "row" });
      if (selfMark) {
        const firstTry = !settled && tries === 1;
        const gotIt = async () => {
          if (firstTry) {
            const m = await api("POST", "translate/mark", { id: q.id, outcome: "correct" });
            inBook = m.in_wrong_book;
            settled = true;
          }
          fill(markBox, h("span", { class: "good" }, "Marked right."));
          drawActions(r);
        };
        const notQuite = () => {
          fill(markBox, h("span", { class: "bad" }, "Marked wrong."));
          drawActions(r);
        };
        fill(markBox, h("span", { class: "muted" }, "Compare with the answer below. Did you get it?"),
          h("button", { class: "good", type: "button", onclick: gotIt }, "I got it"),
          h("button", { class: "bad", type: "button", onclick: notQuite }, "Not quite"));
      }
      fill(feedback,
        r.ai_error ? h("div", { class: "bad" }, "No AI check: " + r.ai_error) : null,
        answer && !r.verdict && !r.ai_error ? h("div", { class: "muted" }, "No OpenAI key, so there is no AI check.") : null,
        verdict ? h("div", { class: "verdict " + verdict[0] }, verdict[1]) : null,
        r.issues && r.issues.length ? h("div", { class: "issues" }, r.issues.map((i) => h("div", { class: "issue" },
          h("span", { class: "wrong-part" }, i.original), " → ", h("b", {}, i.better),
          i.why ? h("span", { class: "muted" }, "  " + i.why) : null))) : null,
        r.fixed ? h("div", { class: "fixed" }, h("span", { class: "muted" }, "Yours, fixed: "), r.fixed,
          h("button", { class: "link", type: "button", onclick: () => speak(r.fixed) }, "🔊")) : null,
        selfMark ? markBox : null,
        h("div", { class: "answer" }, r.en,
          h("button", { class: "link", type: "button", onclick: () => speak(r.en) }, "🔊")),
        r.alt.length ? h("div", { class: "muted" }, "Also: " + r.alt.join(" / ")) : null,
        r.point ? h("div", { class: "note" }, "💡 " + r.point) : null,
        !answer ? h("div", { class: "muted" }, "Revealed sentences go to the wrong book and come back later today, then at growing intervals.") : null,
      );
      if (selfMark) fill(actions); // the learner marks it first
      else drawActions(r);
    }

    // After a wrong answer nothing is recorded yet: the learner picks "Next" (done,
    // not saved) or "Save to wrong book & next".
    async function decide(outcome) {
      if (!settled) await api("POST", "translate/mark", { id: q.id, outcome });
      settled = true;
      if (outcome === "wrong") toast("Saved to the wrong book");
      advance();
    }

    function drawActions(r) {
      const choose = !settled;
      const next = h("button", { class: "primary", type: "button",
        onclick: choose ? () => decide("tried") : advance }, "Next");
      fill(actions,
        next,
        choose && !inBook
          ? h("button", { class: "warn", type: "button", onclick: () => decide("wrong") }, "Save to wrong book & next")
          : null,
        h("button", { type: "button", onclick: answering }, "Try again"),
        choose ? null : starButton(),
        h("button", { type: "button", title: "Capture a word or pattern from this sentence", onclick: () => {
          prefill = { sentence: r.en, examples: [{ en: r.en, zh: r.zh }], tags: ["Translate"] };
          location.hash = "#add";
        } }, "Add to word bank"),
        h("button", { class: "link", type: "button", onclick: never }, "Never show again"));
      next.focus();
    }

    drawTags();
    fill(box, card);
    answering();
  }

  await loadQuestion();
}

// ---- wrong book --------------------------------------------------------
let wrongbookTab = "translate";

async function wrongbookView() {
  const [clozeBook, translateBook] = await Promise.all([api("GET", "cloze/wrongbook"), api("GET", "translate/wrongbook")]);
  const tab = (id, text, n) => h("button", { type: "button", class: "chip" + (wrongbookTab === id ? " on" : ""),
    onclick: () => { wrongbookTab = id; wrongbookView(); } }, `${text} (${n})`);
  const remove = (path, id, what) => h("button", { class: "link", type: "button", title: "Take it off the wrong book", onclick: async () => {
    if (!confirm(`Remove this ${what} from the wrong book? It comes back if you get it wrong again.`)) return;
    await api("POST", path, { id });
    toast("Removed from the wrong book");
    wrongbookView();
  } }, "Remove");
  const redoAll = (onclick) => h("div", { class: "row", style: "margin-bottom:16px" },
    h("button", { class: "primary", type: "button", onclick }, "Redo them all"));

  const translateRows = translateBook.items;
  const clozeRows = clozeBook.items;
  const body = wrongbookTab === "translate"
    ? [translateRows.length
        ? redoAll(() => {
            Object.assign(translateFilters, { type: "", scene: "", level: "", mode: "wrongbook" });
            location.hash = "#translate";
          })
        : h("div", { class: "card" }, "Nothing here yet. Sentences whose answer you reveal land here, and so do the ones you save (☆, or Save to wrong book after a wrong answer)."),
      translateRows.map((item) => h("div", { class: "card" },
        h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap" },
          h("div", { class: "zh", style: "margin:0" }, item.zh),
          remove("translate/wrongbook/remove", item.id, "sentence")),
        h("div", { class: "muted" },
          [TYPE_NAMES[item.type] || item.type, SCENE_NAMES[item.scene] || item.scene, "L" + item.level,
            item.starred ? "★ saved" : null, item.wrong ? `wrong ${item.wrong}×` : null].filter(Boolean).join(" · ")),
        h("div", { class: "answer" }, item.en,
          h("button", { class: "link", type: "button", onclick: () => speak(item.en) }, "🔊")),
        item.last_answer ? h("div", { class: "muted" }, "Your last answer: " + item.last_answer) : null,
        item.point ? h("div", { class: "note" }, "💡 " + item.point) : null))]
    : [clozeRows.length
        ? redoAll(() => {
            Object.assign(clozeFilters, { pos: "", scene: "", level: "", mode: "wrongbook" });
            location.hash = "#cloze";
          })
        : h("div", { class: "card" }, "No wrong answers yet."),
      clozeRows.map((item) => h("div", { class: "card" },
        h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap" },
          h("div", { class: "muted" }, item.zh, ` · wrong ${item.wrong}×`),
          remove("cloze/wrongbook/remove", item.id, "question")),
        h("div", { class: "answer" }, item.sentence,
          h("button", { class: "link", type: "button", onclick: () => speak(item.sentence) }, "🔊"))))];
  show(
    h("h1", {}, "Wrong book"),
    h("div", { class: "row chips", style: "margin-bottom:16px" },
      tab("translate", "Translation", translateRows.length), tab("cloze", "Cloze", clozeRows.length)),
    ...body,
  );
}

// ---- words: tags, pictures, review -----------------------------------
const UNTAGGED = "~untagged";
const tagName = (t) => (t === UNTAGGED ? "No tag" : t.split("/").pop());

function loadSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function remember(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: not remembered */ }
}

// Tag chips: top-level tags in the first row; picking one shows its sub-topics below.
// counts: {tag: n}. selected: array of tags (shared, mutated). onchange() after each click.
function tagFilter(counts, selected, onchange) {
  const box = h("div", { class: "tagfilter" });
  const chip = (tag, label) => h("button", {
    type: "button", class: "chip" + (selected.includes(tag) ? " on" : ""), "aria-pressed": String(selected.includes(tag)),
    onclick: () => {
      const i = selected.indexOf(tag);
      if (i >= 0) selected.splice(i, 1);
      else {
        // A parent and its own children are never selected together.
        for (let j = selected.length - 1; j >= 0; j--) {
          if (selected[j].startsWith(tag + "/") || tag.startsWith(selected[j] + "/")) selected.splice(j, 1);
        }
        selected.push(tag);
      }
      draw();
      onchange();
    },
  }, `${label} (${counts[tag]})`);
  function draw() {
    // Drop selections that no longer exist (e.g. after deleting the last card with that tag).
    for (let j = selected.length - 1; j >= 0; j--) if (!(selected[j] in counts)) selected.splice(j, 1);
    const tops = Object.keys(counts).filter((t) => !t.includes("/"));
    const open = tops.filter((t) => selected.some((x) => x === t || x.startsWith(t + "/")));
    fill(box,
      h("div", { class: "row chips" },
        h("button", { type: "button", class: "chip" + (selected.length ? "" : " on"),
          onclick: () => { selected.splice(0); draw(); onchange(); } }, "All"),
        tops.map((t) => chip(t, tagName(t)))),
      open.map((top) => {
        const subs = Object.keys(counts).filter((t) => t.startsWith(top + "/"));
        return subs.length ? h("div", { class: "row chips sub" },
          h("span", { class: "muted" }, top + ":"), subs.map((t) => chip(t, t.slice(top.length + 1)))) : null;
      }));
  }
  draw();
  return box;
}

function tagList(tags) {
  return (tags || []).length ? h("div", {}, tags.map((t) => h("span", { class: "tag" }, t))) : null;
}

// Shrink a picture in the browser before uploading (keeps data/images/ small).
function shrinkImage(file, max = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => reject(new Error("That file is not a picture this browser can read."));
    img.src = URL.createObjectURL(file);
  });
}

// The card's picture plus buttons to find, generate, upload or remove one.
// onchange(word) runs with the updated card.
function pictureBox(word, onchange) {
  const box = h("div", { class: "picture" });
  const status = h("span", { class: "muted" });
  async function set(body, busy) {
    status.textContent = busy;
    try {
      const r = await api("POST", `words/${word.id}/image`, body);
      Object.assign(word, r.word);
      draw();
      onchange?.(word);
    } catch (e) {
      status.textContent = e.message;
    }
  }
  const upload = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await set({ source: "upload", data_b64: await shrinkImage(file) }, "Uploading…");
    } catch (err) {
      status.textContent = err.message;
    }
  } });
  function draw() {
    const img = word.image;
    fill(box,
      img ? h("figure", {},
        h("img", { class: "card-img", src: `/api/words/${word.id}/image?v=${img.v}`, alt: word.term, loading: "lazy" }),
        h("figcaption", { class: "muted" }, img.credit)) : null,
      h("div", { class: "row picture-tools" },
        img && img.by === "wiki" ? null : h("button", { class: "link", type: "button", title: "Free: the lead photo of the matching Wikipedia article",
          onclick: () => set({ source: "wiki" }, "Looking on Wikipedia…") }, "🔎 Find a photo (free)"),
        h("button", { class: "link", type: "button", title: "Uses your OpenAI key, about US$0.005 per picture",
          onclick: () => set({ source: "ai" }, "Drawing… (about 10–30 seconds)") }, "🎨 AI picture (~US$0.005)"),
        h("button", { class: "link", type: "button", onclick: () => upload.click() }, "📁 Upload"),
        img ? h("button", { class: "link", type: "button", onclick: async () => {
          const r = await api("DELETE", `words/${word.id}/image`);
          Object.assign(word, r.word);
          draw();
          onchange?.(word);
        } }, "Remove picture") : null,
        upload, status));
    status.textContent = "";
  }
  draw();
  // Pack cards name a Wikipedia article: fetch its photo the first time the card is shown.
  if (!word.image && word.wiki && !pictureBox.tried.has(word.id)) {
    pictureBox.tried.add(word.id);
    set({ source: "wiki" }, "Loading photo…");
  }
  return box;
}
pictureBox.tried = new Set(); // one automatic attempt per card per page load

function cardDetails(word) {
  return [
    word.respelling ? h("div", { class: "muted" }, word.respelling) : null,
    word.zh ? h("div", { class: "zh" }, (word.emoji ? word.emoji + " " : "") + word.zh) : null,
    word.definition ? h("p", {}, word.definition) : null,
    pictureBox(word),
    word.examples.map((ex) => h("div", { class: "example" }, ex.en,
      h("button", { class: "link", type: "button", onclick: () => speak(ex.en) }, "🔊"),
      h("span", { class: "muted" }, ex.zh))),
    word.my_examples.map((ex) => h("div", { class: "example" }, "✍️ " + ex)),
    word.note ? h("pre", {}, word.note) : null,
    tagList(word.tags),
  ];
}

const reviewTags = loadSaved("reviewTags", []);
const RATING_TEXT = { forget: "Forgot", fuzzy: "Fuzzy", remember: "Remembered", never: "Never show again" };

// undone: {word, rating} from words/undo, shown with its answer so it can be rated again.
async function reviewView(undone) {
  const query = reviewTags.length ? "?tags=" + encodeURIComponent(reviewTags.join(",")) : "";
  const next = await api("GET", "words/next" + query);
  const { counts, tags } = next;
  const word = undone ? undone.word : next.word;
  const header = h("h1", {}, "Review words");
  const filter = Object.keys(tags).length
    ? tagFilter(tags, reviewTags, () => { remember("reviewTags", reviewTags); reviewView(); }) : null;
  const previous = next.can_undo ? h("button", { class: "link", type: "button",
    title: "Take back your last rating and see that card again",
    onclick: async () => {
      try {
        reviewView(await api("POST", "words/undo", {}));
      } catch (e) {
        toast(e.message);
        reviewView();
      }
    } }, "← Previous card") : null;
  const info = h("div", { class: "row muted", style: "margin-bottom:12px" },
    `Due ${counts.due} · New left today ${counts.new_today_left} · ${reviewTags.length ? "Cards with these tags" : "In word bank"} ${counts.total}`,
    previous);
  if (!word) {
    show(header, filter, info, h("div", { class: "card" },
      counts.total ? "All done for today" + (reviewTags.length ? " with these tags." : ".")
        : reviewTags.length ? "No cards with these tags."
          : "Your word bank is empty. Add a few words in Add / Capture, or add a word pack in Word bank."));
    return;
  }
  const back = h("div", {});
  const actions = h("div", { class: "row", style: "margin-top:16px" });
  const rate = async (rating) => {
    await api("POST", "words/rate", { id: word.id, rating });
    reviewView();
  };
  const reveal = () => {
    const mine = h("input", { class: "wide", placeholder: "Write your own example and press Enter to save" });
    mine.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !mine.value.trim()) return;
      word.my_examples.push(mine.value.trim());
      await api("PUT", "words/" + word.id, { my_examples: word.my_examples });
      mine.value = "";
      toast("Example saved");
    });
    fill(back, cardDetails(word), mine);
    fill(actions,
      h("button", { class: "bad", type: "button", onclick: () => rate("forget") }, "Forgot"),
      h("button", { class: "warn", type: "button", onclick: () => rate("fuzzy") }, "Fuzzy"),
      h("button", { class: "good", type: "button", onclick: () => rate("remember") }, "Remembered"),
      h("button", { class: "link", type: "button", onclick: () => rate("never") }, "Never show again"),
    );
  };
  const showButton = h("button", { class: "primary", type: "button", onclick: reveal }, "Show answer");
  actions.append(showButton);
  show(header, filter, info, h("div", { class: "card" },
    undone ? h("div", { class: "muted" },
      `Your rating “${RATING_TEXT[undone.rating] || undone.rating}” was taken back. Rate this card again.`) : null,
    h("div", { class: "term" }, word.term, speakButtons(word.term)), back, actions));
  speak(word.term);
  if (undone) reveal(); else showButton.focus();
}

// ---- words: add / capture ---------------------------------------------
function addView() {
  const draft = prefill || {};
  prefill = null;
  const field = (attrs) => h("input", { class: "wide", ...attrs });
  const sentence = h("textarea", { rows: 2, placeholder: "Paste the sentence you heard or read. A fragment is fine (optional)" });
  sentence.value = draft.sentence || "";
  const focus = field({ placeholder: "Which part don't you understand? A word, phrase or pattern (blank = the whole sentence)" });
  const term = field({ value: draft.term || "" });
  const respelling = field({ placeholder: "e.g. post-POHN" });
  const definition = field({});
  const zh = field({ value: draft.zh || "", placeholder: "Chinese meaning (optional)" });
  const tags = field({ value: (draft.tags || ["Manual"]).join(", "),
    placeholder: "Comma-separated, e.g. Manual, Work/Meetings" });
  const note = h("textarea", { rows: 3 });
  const examplesBox = h("div", {});
  const notesBox = h("div", {});
  const aiStatus = h("span", { class: "muted" });

  const addExample = (ex = {}) => examplesBox.append(h("div", { class: "row example-row", style: "margin-bottom:6px" },
    h("input", { style: "flex:2", placeholder: "English example", value: ex.en || "" }),
    h("input", { style: "flex:1", placeholder: "Chinese", value: ex.zh || "" })));
  const setExamples = (list) => {
    fill(examplesBox);
    list.forEach(addExample);
    for (let i = list.length; i < 3; i++) addExample();
  };
  setExamples(draft.examples || []);

  async function explain() {
    aiStatus.textContent = "Asking the AI…";
    try {
      const r = await api("POST", "ai/explain", { sentence: sentence.value, focus: focus.value });
      term.value = r.term;
      respelling.value = r.respelling;
      definition.value = r.definition;
      const mine = r.sentence ? [{ en: r.sentence, zh: r.sentence_zh }] : [];
      setExamples([...mine, ...r.examples]);
      fill(notesBox, 
        h("label", {}, "AI notes (ticked ones go into the note)"),
        ...r.notes.map((n) => h("div", {}, h("label", { style: "color:inherit;font-size:16px;margin:4px 0" },
          h("input", { type: "checkbox", value: n }), " " + n))));
      aiStatus.textContent = "";
    } catch (e) {
      aiStatus.textContent = e.message;
    }
  }

  async function save() {
    const picked = [...notesBox.querySelectorAll("input:checked")].map((c) => c.value);
    const examples = [...examplesBox.querySelectorAll(".example-row")].map((row) => {
      const [en, zh] = row.querySelectorAll("input");
      return { en: en.value, zh: zh.value };
    });
    try {
      const r = await api("POST", "words", {
        term: term.value, respelling: respelling.value, definition: definition.value, zh: zh.value,
        tags: tags.value.split(","),
        examples, note: [...picked, note.value.trim()].filter(Boolean).join("\n"),
      });
      toast(r.duplicate ? "Already in your word bank. New examples were merged in" : "Added to your word bank");
      addView();
    } catch (e) {
      toast(e.message);
    }
  }

  show(
    h("h1", {}, "Add / Capture"),
    h("div", { class: "card" },
      h("label", {}, "Original sentence"), sentence,
      h("label", {}, "The part you don't understand"), focus,
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { type: "button", onclick: explain }, "Explain with AI and fill in the card"), aiStatus)),
    h("div", { class: "card" },
      h("label", {}, "Word / phrase / pattern"), term,
      h("label", {}, "Pronunciation respelling"), respelling,
      h("label", {}, "English definition"), definition,
      h("label", {}, "Chinese meaning"), zh,
      h("label", {}, "Examples"), examplesBox,
      h("button", { class: "link", type: "button", onclick: () => addExample() }, "+ Add an example"),
      notesBox,
      h("label", {}, "Note"), note,
      h("label", {}, "Tags (use / for a sub-topic, e.g. Restaurant/Coffee)"), tags,
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { class: "primary", type: "button", onclick: save }, "Save to word bank"))),
  );
}

function addedToast(r) {
  toast(`Added ${r.added} new card${r.added === 1 ? "" : "s"}`
    + (r.merged ? `, ${r.merged} already in your bank got the tag` : ""));
}

// One pack on the Word bank page: "Add all", or preview its cards and pick some.
function packCard(p) {
  const left = p.count - p.in_bank;
  const preview = h("div", { class: "pack-preview", hidden: true });
  const previewButton = h("button", { type: "button", class: "primary", onclick: async () => {
    if (!preview.dataset.loaded) {
      previewButton.disabled = true;
      try { await loadPreview(); } catch (e) { toast(e.message); return; } finally { previewButton.disabled = false; }
    }
    preview.hidden = !preview.hidden;
    previewButton.textContent = preview.hidden ? "Preview & choose" : "Hide preview";
  } }, "Preview & choose");

  async function loadPreview() {
    const pack = await api("GET", "words/packs/" + encodeURIComponent(p.id));
    preview.dataset.loaded = "1";
    const selected = new Set(); // terms ticked for adding
    const topics = [...new Set(pack.words.map((w) => w.topic))];
    const fresh = (list) => list.filter((w) => !w.in_bank);
    const topicChecks = [];
    const addButton = h("button", { class: "primary", type: "button", disabled: true, onclick: async () => {
      addButton.disabled = true;
      addedToast(await api("POST", "words/packs/add", { id: p.id, terms: [...selected] }));
      wordsView();
    } }, "Add 0 selected cards");
    function update() {
      addButton.textContent = `Add ${selected.size} selected card${selected.size === 1 ? "" : "s"}`;
      addButton.disabled = !selected.size;
      for (const { box, items, rows } of topicChecks) {
        const n = items.filter((w) => selected.has(w.term)).length;
        box.checked = n > 0 && n === items.length;
        box.indeterminate = n > 0 && n < items.length;
        rows.forEach(([w, check]) => { check.checked = selected.has(w.term); });
      }
    }
    const setAll = (list, on) => { list.forEach((w) => (on ? selected.add(w.term) : selected.delete(w.term))); update(); };

    function cardRow(w) {
      const check = w.in_bank ? null : h("input", { type: "checkbox", "aria-label": "Select " + w.term,
        onchange: (e) => { if (e.target.checked) selected.add(w.term); else selected.delete(w.term); update(); } });
      const ex = w.examples[0];
      const row = h("label", { class: "pack-row" + (w.in_bank ? " in-bank" : "") },
        h("div", {}, check || h("span", { class: "good", title: "Already in your word bank" }, "✓")),
        w.wiki ? h("img", { class: "pack-thumb", loading: "lazy", alt: "", src: "/api/wiki/photo?title=" + encodeURIComponent(w.wiki),
          onerror: (e) => e.target.remove() }) : h("div", { class: "pack-thumb empty" }, w.emoji || ""),
        h("div", {},
          h("div", {}, h("b", {}, w.term), w.respelling ? h("span", { class: "muted" }, "  " + w.respelling) : null,
            h("button", { class: "link", type: "button", onclick: (e) => { e.preventDefault(); speak(w.term); } }, "🔊"),
            w.in_bank ? h("span", { class: "muted" }, " in your bank") : null),
          h("div", {}, w.zh),
          h("div", { class: "muted" }, w.definition),
          ex ? h("div", { class: "pack-ex" }, ex.en, h("span", { class: "muted" }, " " + ex.zh)) : null,
          w.note ? h("div", { class: "muted pack-note" }, "💡 " + w.note) : null));
      return [row, check];
    }

    const topicBlocks = topics.map((t) => {
      const all = pack.words.filter((w) => w.topic === t);
      const items = fresh(all);
      const list = h("div", {});
      const rows = [];
      const box = h("input", { type: "checkbox", disabled: !items.length, "aria-label": "Select all in " + t,
        onclick: (e) => { e.stopPropagation(); setAll(items, e.target.checked); } });
      topicChecks.push({ box, items, rows });
      // Cards (and their photos) are built the first time a topic is opened.
      const block = h("details", { class: "pack-topic", ontoggle: () => {
        if (!block.open || list.childElementCount) return;
        for (const w of all) {
          const [row, check] = cardRow(w);
          if (check) rows.push([w, check]);
          list.append(row);
        }
        update();
      } }, h("summary", {}, box, ` ${t} `,
        h("span", { class: "muted" }, `${all.length} cards` + (all.length - items.length ? ` · ${all.length - items.length} in your bank` : ""))),
      list);
      return block;
    });
    fill(preview,
      h("div", { class: "row pack-bar" }, addButton,
        h("button", { class: "link", type: "button", onclick: () => setAll(fresh(pack.words), true) }, "Select all new"),
        h("button", { class: "link", type: "button", onclick: () => setAll(pack.words, false) }, "Clear"),
        h("span", { class: "muted" }, "Open a topic to see its cards; tick a topic to take all of it.")),
      topicBlocks);
  }

  return h("div", { class: "pack" },
    h("div", {}, h("b", {}, p.name), " ", h("span", { class: "tag" }, p.tag)),
    h("div", { class: "muted" }, p.description),
    h("div", { class: "muted" }, `${p.count} cards · ${Object.keys(p.topics).length} topics · ${p.in_bank} already in your bank`),
    h("div", { class: "row", style: "margin-top:6px" },
      previewButton,
      left ? h("button", { type: "button", onclick: async () => {
        if (!confirm(`Add all ${left} new cards from "${p.name}"?`)) return;
        addedToast(await api("POST", "words/packs/add", { id: p.id }));
        wordsView();
      } }, `Add all ${left} new cards`) : h("span", { class: "muted" }, "All cards are in your bank")),
    preview);
}

const bankTags = loadSaved("bankTags", []);

async function wordsView() {
  const [{ words, tags }, { packs }] = await Promise.all([api("GET", "words"), api("GET", "words/packs")]);
  const matches = (w) => !bankTags.length || bankTags.some((t) =>
    t === UNTAGGED ? !(w.tags || []).length : (w.tags || []).some((x) => x === t || x.startsWith(t + "/")));
  const body = h("tbody", {});
  const title = h("h1", {});
  let search = "";
  const LIMIT = 300; // rows drawn at once; search or filter to narrow down
  const draw = () => {
    const list = words.filter((w) => matches(w) && (!search || w.term.toLowerCase().includes(search.toLowerCase())
      || (w.zh || "").includes(search)));
    title.textContent = `Word bank (${list.length}${list.length === words.length ? "" : " of " + words.length})`;
    fill(body, list.slice(0, LIMIT).map(row),
      list.length > LIMIT ? h("tr", {}, h("td", { colspan: 4, class: "muted" }, `Showing ${LIMIT} of ${list.length}. Search or pick a tag to see the rest.`)) : null);
  };
  function row(w) {
    const details = h("tr", { hidden: true }, h("td", { colspan: 4 }));
    const editTags = h("button", { class: "link", type: "button", onclick: async () => {
      const value = prompt("Tags, comma-separated (use / for a sub-topic):", (w.tags || []).join(", "));
      if (value === null) return;
      const r = await api("PUT", "words/" + w.id, { tags: value.split(",") });
      Object.assign(w, r.word);
      wordsView();
    } }, "Edit tags");
    const main = h("tr", {},
      h("td", {}, h("b", {}, (w.emoji ? w.emoji + " " : "") + w.term), h("div", { class: "muted" }, w.respelling)),
      h("td", {}, w.zh ? h("div", {}, w.zh) : null, h("div", { class: w.zh ? "muted" : "" }, w.definition),
        tagList(w.tags)),
      h("td", { class: "muted" }, w.srs.never ? "Hidden" : w.srs.due ? "Next " + w.srs.due : "New",
        w.image ? h("div", {}, "🖼") : null),
      h("td", {},
        h("button", { class: "link", type: "button", onclick: () => {
          details.hidden = !details.hidden;
          if (!details.hidden) fill(details.firstChild, cardDetails(w), editTags);
        } }, "Details"),
        h("button", { class: "link", type: "button", onclick: async () => {
          if (!confirm(`Delete "${w.term}"?`)) return;
          await api("DELETE", "words/" + w.id);
          wordsView();
        } }, "Delete")));
    return [main, details];
  }

  const packCards = packs.map(packCard);

  draw();
  show(
    title,
    packs.length ? h("details", { class: "card", open: !words.length },
      h("summary", {}, h("b", {}, "Word packs"), h("span", { class: "muted" }, " · themed lists you can add with one click")),
      h("p", { class: "muted" }, "Preview a pack, tick the topics or single cards you want, and add only those. New cards join the review queue in pack order, within your daily new-word limit (Settings)."),
      packCards) : null,
    Object.keys(tags).length ? tagFilter(tags, bankTags, () => { remember("bankTags", bankTags); draw(); }) : null,
    h("input", { class: "wide", placeholder: "Search English or Chinese", style: "margin:8px 0 12px",
      oninput: (e) => { search = e.target.value.trim(); draw(); } }),
    h("div", { class: "card" }, h("table", {}, body)),
  );
}

// ---- keep writing / keep speaking / improv / toastmasters ---------------
const practiceTrack = {}; // remembered track per module
const practicePast = {}; // per module: feedback you moved on from, for "← Previous" (this visit only)
// Tag given to words saved from each practice module's feedback.
const MODULE_TAGS = { write: "Keep writing", speak: "Keep speaking", improv: "Improv", toast: "Toastmasters",
  talk: "Conversation" };
// Saved words from private practice get this tag and no example sentence, so nothing about the
// project reaches data/words.json (which is synced).
const PRIVATE_TAG = "My projects";
let talkSeed = null; // a conversation handed over from a work-writing piece ("Talk it through")
let recorder = null; // active MediaRecorder, stopped when leaving the page

function cancelRecording() {
  if (recorder && recorder.state !== "inactive") {
    recorder.cancelled = true;
    recorder.stop();
  }
}

// The Chinese version of an instruction, hidden until asked for.
function chineseToggle(text) {
  const body = h("div", { class: "muted", hidden: true }, text);
  const link = h("button", { class: "link", type: "button", onclick: () => {
    body.hidden = !body.hidden;
    link.textContent = body.hidden ? "Show Chinese" : "Hide Chinese";
  } }, "Show Chinese");
  return h("div", {}, link, body);
}

function clock(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function practiceView(module) {
  cancelRecording();
  const meta = (await api("GET", "practice/meta"))[module];
  settings = await api("GET", "settings");
  if (module === "talk") meta.tracks.push(FREE_TALK);
  if (module === "talk" && talkSeed) practiceTrack.talk = FREE_TALK.id;
  const open = meta.tracks.filter((t) => !t.locked);
  // Default: the highest unlocked level of a ladder, otherwise the first group.
  const levels = open.filter((t) => t.level);
  let track = open.find((t) => t.id === practiceTrack[module]) || levels[levels.length - 1] || open[0];
  practiceTrack[module] = track.id;
  let voice = module !== "write";
  const box = h("div", {});
  const earlier = answerHistory(box, practicePast[module] ||= [], "feedback");
  // Leaving a feedback screen (Next, Same prompt again): keep it for "← Previous".
  // label: the task, for screens that don't show it themselves.
  const keepFeedback = (label) => earlier.keep({ nodes: [...box.childNodes], label });

  const trackButton = (t) => h("button", {
    type: "button", class: t.id === track.id ? "primary" : "", disabled: t.locked,
    title: t.locked ? "Unlocks after the level below" : `${t.done} / ${t.count} prompts done`,
    onclick: () => { practiceTrack[module] = t.id; practiceView(module); },
  }, (t.locked ? "🔒 " : "") + t.name + (t.private ? " (private)" : ""));
  // One row of buttons per group ("Levels", "Small talk"); no heading when there is only one group.
  const groups = [...new Set(meta.tracks.map((t) => t.group || ""))];
  const trackButtons = groups.map((g) => h("div", { class: "row", style: "margin-bottom:8px" },
    groups.length > 1 && g ? h("b", { class: "muted", style: "min-width:6em" }, g) : null,
    meta.tracks.filter((t) => (t.group || "") === g).map(trackButton)));
  const next = track.level && meta.tracks.find((t) => t.level === track.level + 1);
  const ladderNote = next && next.locked
    ? `${Math.max(0, meta.unlock_sessions - track.good)} more good sessions on this level unlock "${next.name}"`
    : track.id === FREE_TALK.id ? "Pick who you're talking to and what about. The AI asks follow-up questions about whatever you say."
    : `${track.done} / ${track.count} prompts done in this group`;

  show(
    h("h1", {}, meta.name),
    trackButtons,
    h("div", { class: "row", style: "margin-bottom:16px" }, h("span", { class: "muted" }, ladderNote), earlier.nav),
    track.private || track.id === FREE_TALK.id ? h("div", { class: "card muted" },
      "Private: what you say here is kept in private/ on this computer and never synced to GitHub. "
      + "It is still sent to OpenAI for transcription and feedback.") : null,
    track.pack ? phrasePanel(track.pack) : null,
    box,
  );

  async function loadPrompt(same) {
    const prompt = same || (await api("GET", `practice/next?module=${module}&track=${track.id}`)).prompt;
    if (!prompt) {
      fill(box, h("div", { class: "card" }, "This group has no prompts yet."));
      return;
    }
    const work = h("div", {});
    fill(box, h("div", { class: "card" },
      h("div", { class: "answer" }, prompt.task),
      prompt.say && module !== "talk" ? h("div", { class: "en", style: "font-size:20px;line-height:1.6" }, "“" + prompt.say + "”",
        h("button", { class: "link", type: "button", onclick: () => say(prompt, prompt.say) }, "🔊")) : null,
      // For translation prompts the Chinese is the sentence to translate, so it stays visible;
      // otherwise it is only a translation of the instruction.
      prompt.task.startsWith("Translate") ? h("div", { class: "zh" }, prompt.zh)
        : prompt.zh ? chineseToggle(prompt.zh) : null,
      work));
    if (module === "talk") return talkInput(prompt, work);
    if (prompt.say) say(prompt, prompt.say);
    if (voice) voiceInput(prompt, work); else textInput(prompt, work);
  }

  function textInput(prompt, work) {
    let startedAt = null;
    const area = h("textarea", { rows: 8, placeholder: "Write in English. If you don't know a word, write it in Chinese and the feedback will tell you the English." });
    const counter = h("span", { class: "muted" }, "0 words");
    const timer = setInterval(() => {
      if (!area.isConnected) return clearInterval(timer);
      const words = (area.value.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
      counter.textContent = `${words} words · ${startedAt ? clock((Date.now() - startedAt) / 1000) : "0:00"}`;
    }, 500);
    area.addEventListener("input", () => { startedAt = startedAt || Date.now(); });
    const send = () => {
      if (!area.value.trim()) return toast("Write something first");
      submit(prompt, area.value, startedAt ? (Date.now() - startedAt) / 1000 : 0, "write", 0);
    };
    area.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); });
    fill(work, 
      h("div", { style: "margin-top:12px" }, area),
      h("div", { class: "row", style: "margin-top:10px" },
        h("button", { class: "primary", type: "button", onclick: send }, "Submit (⌘ + Enter)"),
        h("button", { class: "link", type: "button", onclick: () => loadPrompt() }, "Skip"),
        module !== "write" ? h("button", { class: "link", type: "button", onclick: () => { voice = true; loadPrompt(prompt); } }, "Speak instead") : null,
        counter));
    area.focus();
  }

  function voiceInput(prompt, work) {
    const [green, yellow, red] = track.timing || [];
    const time = h("b", { style: "font-size:28px" }, "0:00");
    const light = h("span", { class: "tag" }, "");
    const status = h("span", { class: "muted" });
    let stuck = 0;
    let startedAt = null;
    let ticker = null;

    const startButton = h("button", { class: "primary", type: "button", onclick: start }, "Start speaking");
    const controls = h("div", { class: "row", style: "margin-top:12px" },
      startButton,
      h("button", { class: "link", type: "button", onclick: () => loadPrompt() }, "Skip"),
      h("button", { class: "link", type: "button", onclick: () => { voice = false; loadPrompt(prompt); } }, "Type instead"),
      status);
    fill(work, controls);
    if (!settings.has_key) status.textContent = "No OpenAI key: only your speaking time is recorded, with no transcript or feedback.";
    startButton.focus();

    async function start() {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        status.textContent = "Cannot use the microphone: " + e.message;
        return;
      }
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(ticker);
        const cancelled = recorder.cancelled;
        const type = recorder.mimeType || "audio/webm";
        recorder = null;
        if (!cancelled) finish(new Blob(chunks, { type }), (Date.now() - startedAt) / 1000);
      };
      recorder.start();
      startedAt = Date.now();
      ticker = setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        time.textContent = clock(s);
        if (green) {
          const [text, color] = s >= red ? ["Red: wrap up now", "var(--bad)"]
            : s >= yellow ? ["Yellow", "var(--warn)"] : s >= green ? ["Green: minimum time reached", "var(--good)"] : ["", ""];
          light.textContent = text;
          light.style.color = light.style.borderColor = color;
          light.style.visibility = text ? "visible" : "hidden";
        }
      }, 250);
      light.style.visibility = "hidden";
      const stuckButton = h("button", { class: "warn", type: "button", onclick: () => {
        stuck += 1;
        stuckButton.textContent = `Stuck (${stuck})`;
      } }, "Stuck (0)");
      const stop = h("button", { class: "primary", type: "button", onclick: () => recorder && recorder.stop() }, "Done");
      fill(work, 
        h("div", { class: "row", style: "margin-top:12px" }, time, light),
        h("div", { class: "muted" }, "Keep going. If a word won't come, say it in Chinese or press Stuck, then carry on."),
        h("div", { class: "row", style: "margin-top:10px" }, stop, stuckButton));
      stop.focus();
    }

    async function finish(blob, seconds) {
      if (!settings.has_key) return submit(prompt, "", seconds, "speak", stuck);
      fill(work, h("div", { class: "muted", style: "margin-top:12px" }, "Transcribing your recording…"));
      try {
        const { text } = await api("POST", "practice/transcribe", { audio_b64: await blobToBase64(blob), mime: blob.type });
        submit(prompt, text, seconds, "speak", stuck);
      } catch (e) {
        fill(work, 
          h("p", { class: "feedback" }, h("span", { class: "bad" }, "Transcription failed: " + e.message)),
          h("div", { class: "row" },
            h("button", { type: "button", onclick: () => finish(blob, seconds) }, "Retry"),
            h("button", { type: "button", onclick: () => submit(prompt, "", seconds, "speak", stuck) }, "Record the time only")));
      }
    }
  }

  async function submit(prompt, text, seconds, mode, stuck) {
    fill(box, h("div", { class: "card muted" }, "Reading your answer…"));
    let r;
    try {
      r = await api("POST", "practice/submit", { prompt_id: prompt.id, text, seconds, mode, stuck });
    } catch (e) {
      fill(box, h("div", { class: "card" }, "Submit failed: " + e.message,
        h("pre", {}, text),
        h("button", { type: "button", onclick: () => submit(prompt, text, seconds, mode, stuck) }, "Retry")));
      return;
    }
    const s = r.session;
    const f = r.feedback;
    const facts = [`${s.words} words`, clock(s.seconds)];
    if (s.seconds >= 30 && s.words) facts.push(`${Math.round(s.words / (s.seconds / 60))} words/min`);
    if (mode === "speak") facts.push(`stuck ${s.stuck}×`, `fillers ${s.fillers}×`);
    facts.push(`+${s.xp} XP`, `rank ${r.rank.level}`);
    const label = "Task: " + prompt.task;
    const nextButton = h("button", { class: "primary", type: "button",
      onclick: () => { keepFeedback(label); practiceView(module); } }, "Next");
    fill(box, 
      h("div", { class: "card" },
        s.leveled_up ? h("p", { class: "feedback" }, h("b", { class: "good" }, `Level up: L${s.leveled_up} unlocked.`)) : null,
        h("div", { class: "muted" }, facts.join(" · ")),
        f && f.score ? h("div", {}, "★".repeat(f.score) + "☆".repeat(5 - f.score)) : null,
        f ? h("p", {}, f.comment) : null,
        r.ai_error ? h("p", { class: "feedback" }, h("span", { class: "bad" }, "No AI feedback: " + r.ai_error)) : null,
        !f && !r.ai_error && text ? h("p", { class: "muted" }, "No OpenAI key, so only the stats were recorded.") : null,
        h("div", { class: "row live-only", style: "margin-top:10px" },
          nextButton,
          h("button", { type: "button", onclick: () => { keepFeedback(label); loadPrompt(prompt); } }, "Same prompt again"))),
      text ? h("div", { class: "card" },
        h("label", {}, mode === "speak" ? "What you said (transcribed)" : "What you wrote"), h("div", {}, text),
        f && f.natural ? [h("label", {}, "A more natural way to say it"),
          h("div", { class: "answer pre" }, f.natural,
            h("button", { class: "link", type: "button", onclick: () => say(prompt, f.natural) }, "🔊"))] : null) : null,
      prompt.example ? h("div", { class: "card" },
        h("label", {}, "One natural answer"),
        h("div", { class: "answer pre" }, personalise(prompt.example),
          h("button", { class: "link", type: "button", onclick: () => say(prompt, personalise(prompt.example)) }, "🔊")),
        missingDetails(prompt.example)
          ? h("div", { class: "muted" }, "Add your name, hometown, job title and company in Settings to see them here.") : null) : null,
      f && f.issues.length ? h("div", { class: "card" },
        h("label", {}, "What to fix first"),
        f.issues.map((i) => h("div", { class: "example" },
          h("span", { class: "bad", style: "color:var(--bad)" }, i.original), " → ",
          h("b", {}, i.better), h("span", { class: "muted" }, i.why)))) : null,
      f && f.vocab.length ? h("div", { class: "card" },
        h("label", {}, "Expressions worth saving"),
        f.vocab.map((v) => vocabRow(v, prompt))) : null,
      track.focus === "workwriting" && text ? h("div", { class: "card" },
        h("label", {}, "Now say it"),
        h("p", { class: "muted" }, "The person you wrote to calls you about it. Answer their follow-up questions out loud."),
        h("button", { type: "button", onclick: () => {
          talkSeed = {
            id: "c-custom", private: true, turns: 4,
            task: "You've just sent the message below. Now the reader calls you about it: answer their follow-up questions out loud. Lead with the point, then give details.",
            zh: "你刚发出下面这段文字。现在读的人打电话来问你：口头回答他们的追问。先说结论，再讲细节。",
            note: text,
            custom: { turns: 4,
              role: "The person this message was written to, as described in the writing task. React the way they would: ask what you'd want to know before acting on it.",
              setting: `The writing task was: ${prompt.task}\nThe learner sent you this:\n"""${text}"""\nYou've read it and now call them to talk it through.`,
              task: "Answer follow-up questions about the message you just sent." },
          };
          location.hash = "#talk";
        } }, "Talk it through")) : null,
    );
    nextButton.focus();
  }

  // A line read aloud; audio for private practice is cached in private/.
  function say(prompt, text) {
    return speak(text, null, { private: !!prompt.private });
  }

  // "+ Add to word bank" for an expression from the feedback.
  function vocabRow(v, prompt) {
    const add = h("button", { class: "link", type: "button", onclick: async () => {
      const res = await api("POST", "words", prompt.private
        ? { term: v.term, zh: v.zh, tags: [PRIVATE_TAG], examples: [] }
        : { term: v.term, zh: v.zh, tags: [MODULE_TAGS[module], `${MODULE_TAGS[module]}/${track.name}`],
          examples: v.example ? [{ en: v.example, zh: "" }] : [] });
      add.disabled = true;
      add.textContent = res.duplicate ? "Already saved" : "Saved";
    } }, "+ Add to word bank");
    return h("div", { class: "example" }, h("b", {}, v.term), " " + v.zh, add,
      h("span", { class: "muted" }, v.example));
  }

  // Free topic: the learner picks who they talk to and what about.
  function freeForm() {
    const who = h("select", {}, Object.entries(TALK_PEOPLE).map(([k, p]) => h("option", { value: k }, p.label)));
    const topic = h("textarea", { rows: 4, placeholder: "e.g. the project I'm working on: it moves 40 servers to Azure by March, we're a week behind because of firewall approvals" });
    const turns = h("select", {}, [3, 4, 5].map((n) => h("option", { value: n, selected: n === 4 }, `${n} answers`)));
    const go = () => {
      if (!topic.value.trim()) return toast("Write what you want to talk about first");
      const p = TALK_PEOPLE[who.value];
      const n = Number(turns.value);
      loadPrompt({ id: "c-custom", private: true, turns: n,
        task: `Talk to ${p.label.toLowerCase()} about: ${topic.value.trim()}`,
        custom: { role: p.role, turns: n, task: `Talk about: ${topic.value.trim()}`,
          setting: `${p.setting} The learner wants to talk about: ${topic.value.trim()}` } });
    };
    fill(box, h("div", { class: "card" },
      h("label", {}, "Who are you talking to?"), who,
      h("label", {}, "What about? A few facts help the AI ask good questions."), topic,
      h("div", { class: "row", style: "margin-top:10px" }, turns,
        h("button", { class: "primary", type: "button", onclick: go }, "Start the conversation"))));
    topic.focus();
  }

  // Conversation: the AI plays a person and asks follow-up questions; the learner answers out loud.
  function talkInput(prompt, work) {
    const history = [];
    const total = prompt.turns || 4;
    const scenario = prompt.custom ? { custom: prompt.custom } : { prompt_id: prompt.id };
    let seconds = 0;
    let stuck = 0;
    let typed = 0;
    let ended = false;
    const log = h("div", { class: "talk-log" });
    const controls = h("div", { style: "margin-top:12px" });
    const hintBox = h("div", {});
    fill(work, prompt.note ? h("div", { class: "example pre" }, prompt.note) : null, log, hintBox, controls);

    const answered = () => history.filter((m) => m.who === "me").length;
    function addLine(who, text) {
      history.push({ who, text });
      log.append(h("div", { class: "talk-line " + who },
        h("b", {}, who === "ai" ? "Them" : "You"),
        h("span", {}, text),
        who === "ai" ? h("button", { class: "link", type: "button", onclick: () => say(prompt, text) }, "🔊") : null));
    }

    function busy(text) {
      fill(controls, h("div", { class: "muted" }, text));
    }

    function failed(message, retry) {
      fill(controls, h("p", { class: "feedback" }, h("span", { class: "bad" }, message)),
        h("div", { class: "row" }, h("button", { type: "button", onclick: retry }, "Retry"),
          answered() ? h("button", { type: "button", onclick: finish }, "End and get feedback") : null));
    }

    async function theirTurn() {
      busy("…");
      try {
        const r = await api("POST", "talk/turn", { ...scenario, history });
        addLine("ai", r.line);
        say(prompt, r.line);
        if (r.done) return finish();
        yourTurn();
      } catch (e) {
        failed(e.message, theirTurn);
      }
    }

    function yourTurn() {
      if (ended) return;
      const start = h("button", { class: "primary", type: "button", onclick: record }, "🎙 Answer");
      fill(controls, h("div", { class: "row" },
        start,
        h("button", { type: "button", onclick: typeAnswer }, "Type instead"),
        h("button", { type: "button", onclick: hint }, "💡 Help me start"),
        answered() ? h("button", { class: "link", type: "button", onclick: finish }, "End and get feedback") : null,
        h("span", { class: "muted" }, `Answer ${answered() + 1} of ${total}`)));
      start.focus();
    }

    async function hint() {
      fill(hintBox, h("div", { class: "muted" }, "Thinking of a way in…"));
      try {
        const r = await api("POST", "talk/hint", { ...scenario, history });
        fill(hintBox, h("div", { class: "card hint" },
          r.starter ? h("div", { class: "answer" }, r.starter,
            h("button", { class: "link", type: "button", onclick: () => say(prompt, r.starter) }, "🔊")) : null,
          r.points.length ? h("ul", {}, r.points.map((p) => h("li", {}, p))) : null,
          r.zh ? h("div", { class: "muted" }, r.zh) : null));
      } catch (e) {
        fill(hintBox, h("div", { class: "muted" }, "No hint: " + e.message));
      }
    }

    function mine(text, secs) {
      fill(hintBox);
      seconds += secs;
      addLine("me", text);
      theirTurn();
    }

    function typeAnswer() {
      const area = h("textarea", { rows: 3, placeholder: "Type your answer, then press Enter" });
      const send = () => {
        if (!area.value.trim()) return;
        typed += 1;
        mine(area.value.trim(), 0);
      };
      area.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
      fill(controls, area, h("div", { class: "row", style: "margin-top:8px" },
        h("button", { class: "primary", type: "button", onclick: send }, "Send"),
        h("button", { class: "link", type: "button", onclick: yourTurn }, "Speak instead")));
      area.focus();
    }

    async function record() {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        return failed("Cannot use the microphone: " + e.message, yourTurn);
      }
      stopSpeaking();
      const chunks = [];
      const startedAt = Date.now();
      const time = h("b", { style: "font-size:22px" }, "0:00");
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(ticker);
        const cancelled = recorder.cancelled;
        const type = recorder.mimeType || "audio/webm";
        recorder = null;
        if (cancelled) return;
        const secs = (Date.now() - startedAt) / 1000;
        const blob = new Blob(chunks, { type });
        const transcribe = async () => {
          busy("Transcribing…");
          try {
            const { text } = await api("POST", "practice/transcribe", { audio_b64: await blobToBase64(blob), mime: blob.type });
            if (!text.trim()) return failed("Nothing was heard. Try again a bit closer to the microphone.", yourTurn);
            mine(text.trim(), secs);
          } catch (e) {
            failed("Transcription failed: " + e.message, transcribe);
          }
        };
        transcribe();
      };
      recorder.start();
      const ticker = setInterval(() => { time.textContent = clock((Date.now() - startedAt) / 1000); }, 250);
      const stuckButton = h("button", { class: "warn", type: "button", onclick: () => {
        stuck += 1;
        stuckButton.textContent = `Stuck (${stuck})`;
      } }, `Stuck (${stuck})`);
      const done = h("button", { class: "primary", type: "button", onclick: () => recorder && recorder.stop() }, "Done");
      fill(controls, h("div", { class: "row" }, time, done, stuckButton,
        h("span", { class: "muted" }, "Answer the question first, then add one detail.")));
      done.focus();
    }

    async function finish() {
      if (ended) return;
      ended = true;
      busy("Reading the whole conversation…");
      let r;
      try {
        r = await api("POST", "talk/finish", { ...scenario, history, seconds, stuck,
          mode: typed && typed === answered() ? "write" : "speak" });
      } catch (e) {
        ended = false;
        return failed("Feedback failed: " + e.message, finish);
      }
      const f = r.feedback;
      const s = r.session;
      const facts = [`${s.words} words`, clock(s.seconds), `stuck ${s.stuck}×`, `+${s.xp} XP`, `rank ${r.rank.level}`];
      const next = h("button", { class: "primary", type: "button",
        onclick: () => { keepFeedback(); practiceView(module); } }, "Next");
      fill(controls,
        h("div", { class: "card" },
          h("div", { class: "muted" }, facts.join(" · ")),
          f.score ? h("div", {}, "★".repeat(f.score) + "☆".repeat(5 - f.score)) : null,
          h("p", {}, f.comment),
          f.handling ? h("p", {}, h("b", {}, "Handling follow-ups: "), f.handling) : null,
          h("div", { class: "row live-only" }, next,
            h("button", { type: "button", onclick: () => { keepFeedback(); loadPrompt(prompt); } }, "Same conversation again"))),
        f.turns.length ? h("div", { class: "card" },
          h("label", {}, "Your answers, said more naturally"),
          f.turns.map((t) => h("div", { class: "example" },
            h("div", { class: "muted" }, t.you),
            h("div", {}, h("b", {}, t.better),
              h("button", { class: "link", type: "button", onclick: () => say(prompt, t.better) }, "🔊"))))) : null,
        f.issues.length ? h("div", { class: "card" },
          h("label", {}, "What to fix first"),
          f.issues.map((i) => h("div", { class: "example" },
            h("span", { class: "bad", style: "color:var(--bad)" }, i.original), " → ",
            h("b", {}, i.better), h("span", { class: "muted" }, i.why)))) : null,
        f.vocab.length ? h("div", { class: "card" },
          h("label", {}, "Phrases for next time"), f.vocab.map((v) => vocabRow(v, prompt))) : null);
      next.focus();
    }

    if (prompt.say) {
      addLine("ai", prompt.say);
      say(prompt, prompt.say);
      yourTurn();
    } else {
      theirTurn();
    }
  }

  if (module === "talk" && talkSeed) {
    const seed = talkSeed;
    talkSeed = null;
    return loadPrompt(seed);
  }
  if (track.id === FREE_TALK.id) return freeForm();
  await loadPrompt();
}

// Conversation: a "Free topic" button beside the scenario groups, and who the AI can play there.
const FREE_TALK = { id: "free", name: "Free topic", group: "Your own", count: 0, done: 0, locked: false, good: 0 };
const TALK_PEOPLE = {
  manager: { label: "Your manager", role: "The learner's manager. Friendly but busy; wants the point first, then dates, risks and whether they need to do anything.",
    setting: "A quick catch-up at the learner's desk." },
  client: { label: "A client", role: "A client stakeholder sponsoring the work. Polite and business-focused; cares about outcomes, cost, timing and risk; not technical.",
    setting: "A short call with the client." },
  newbie: { label: "A colleague who knows nothing about it", role: "A colleague from a non-technical team. Curious; asks what things mean, why they matter and for everyday examples.",
    setting: "Chatting in the office kitchen." },
  audience: { label: "Someone in the audience after your talk", role: "A colleague in the audience at the learner's internal presentation. Mix of curious and sceptical; asks how, why and what could go wrong.",
    setting: "Q&A after the learner's presentation." },
  interviewer: { label: "A job interviewer", role: "A hiring manager in a job interview. Professional; asks for specific examples, the learner's own part in them and the result.",
    setting: "A job interview." },
};

// "Useful phrases" for a track: the cards of its word pack, grouped by topic, collapsed by default.
function phrasePanel(packId) {
  const body = h("div", {}, h("div", { class: "muted" }, "Loading…"));
  const panel = h("details", { class: "card phrases", ontoggle: async () => {
    if (!panel.open || panel.dataset.loaded) return;
    panel.dataset.loaded = "1";
    try {
      const pack = await api("GET", "words/packs/" + encodeURIComponent(packId));
      const topics = [...new Set(pack.words.map((w) => w.topic))];
      const add = h("button", { type: "button", onclick: async () => {
        const r = await api("POST", "words/packs/add", { id: packId });
        add.disabled = true;
        add.textContent = `Added ${r.added} new cards`;
      } }, "Add all of these to my word bank");
      fill(body,
        h("p", { class: "muted" }, "Read a few aloud before you start, then try to use one or two in your answer."),
        topics.map((t) => h("div", {}, h("h3", {}, t),
          pack.words.filter((w) => w.topic === t).map((w) => h("div", { class: "example" },
            h("b", {}, w.term), h("button", { class: "link", type: "button", onclick: () => speak(w.term) }, "🔊"),
            " ", h("span", {}, w.zh),
            w.examples[0] ? h("span", { class: "muted" }, w.examples[0].en) : null)))),
        h("div", { class: "row", style: "margin-top:10px" }, add));
    } catch (e) {
      fill(body, h("div", { class: "muted" }, "Could not load the phrases: " + e.message));
    }
  } }, h("summary", {}, h("b", {}, "Useful phrases"), h("span", { class: "muted" }, " · words and sentence patterns for this kind of answer")), body);
  return panel;
}

// ---- line chart (inline SVG, no library) --------------------------------
// series: [{name, color (CSS var), values: number[]}], dates: string[] (one per value).
const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

function niceStep(max, ticks = 4) {
  const raw = Math.max(max, 1) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

function formatTick(v) {
  return v >= 10000 ? `${+(v / 1000).toFixed(1)}K` : v.toLocaleString("en-NZ");
}

function shortDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

function lineChart({ title, unit, dates, series }) {
  const W = 760, H = 220, M = { top: 14, right: 70, bottom: 26, left: 48 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const n = dates.length;
  const x = (i) => M.left + (n === 1 ? iw : (i / (n - 1)) * iw);
  const y = (v) => M.top + ih - (v / top) * ih;
  // unit: "min", or [singular, plural] such as ["word", "words"].
  const fmt = (v) => `${v.toLocaleString("en-NZ")} ${Array.isArray(unit) ? unit[v === 1 ? 0 : 1] : unit}`;

  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(svg("line", { x1: M.left, x2: M.left + iw, y1: y(v), y2: y(v),
      stroke: v === 0 ? "var(--chart-axis)" : "var(--line)", "stroke-width": 1 }));
    grid.push(svg("text", { x: M.left - 8, y: y(v) + 4, "text-anchor": "end", class: "chart-tick" }, formatTick(v)));
  }
  const xTicks = [...new Set([0, Math.round((n - 1) / 2), n - 1])].map((i) =>
    svg("text", { x: x(i), y: H - 6, "text-anchor": n === 1 ? "end" : i === 0 ? "start" : i === n - 1 ? "end" : "middle",
      class: "chart-tick" }, shortDate(dates[i])));

  const lines = series.map((s) => n > 1 ? svg("path", {
    d: s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""),
    fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }) : null);
  const endDot = (s, i) => svg("circle", { cx: x(i), cy: y(s.values[i]), r: 4, fill: s.color,
    stroke: "var(--card)", "stroke-width": 2 });
  // Value at the end of each line; skipped when two end labels would collide (legend + tooltip carry it).
  const ends = series.map((s) => y(s.values[n - 1]));
  const collide = ends.some((a, i) => ends.some((b, j) => i < j && Math.abs(a - b) < 14));
  const endLabels = collide ? [] : series.map((s) =>
    svg("text", { x: x(n - 1) + 8, y: y(s.values[n - 1]) + 4, class: "chart-end" }, formatTick(s.values[n - 1])));

  const cross = svg("line", { y1: M.top, y2: M.top + ih, stroke: "var(--chart-axis)", "stroke-width": 1, visibility: "hidden" });
  const hoverDots = svg("g", { visibility: "hidden" });
  const hit = svg("rect", { x: M.left, y: 0, width: iw, height: H, fill: "transparent" });
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", tabindex: 0, role: "img",
    "aria-label": `${title}. Latest: ${series.map((s) => `${s.name} ${fmt(s.values[n - 1])}`).join(", ")}. Use the arrow keys to read each day.` },
    grid, xTicks, lines, series.map((s) => endDot(s, n - 1)), endLabels, cross, hoverDots, hit);
  const tip = h("div", { class: "chart-tip", hidden: true });
  const box = h("div", { class: "chart-box" }, chart, tip);

  let current = n - 1;
  function showAt(i) {
    current = Math.max(0, Math.min(n - 1, i));
    const px = x(current);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    hoverDots.replaceChildren(...series.map((s) => endDot(s, current)));
    hoverDots.setAttribute("visibility", "visible");
    fill(tip, h("div", { class: "muted" }, shortDate(dates[current])),
      series.map((s) => h("div", { class: "chart-tip-row" },
        h("span", { class: "chart-key", style: `background:${s.color}` }),
        h("b", {}, fmt(s.values[current])),
        // One series: the chart title already names it.
        series.length > 1 ? [" ", h("span", { class: "muted" }, s.name)] : null)));
    tip.hidden = false;
    const rect = chart.getBoundingClientRect();
    const left = (px / W) * rect.width;
    tip.style.left = `${Math.min(rect.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2))}px`;
  }
  function hide() {
    cross.setAttribute("visibility", "hidden");
    hoverDots.setAttribute("visibility", "hidden");
    tip.hidden = true;
  }
  hit.addEventListener("pointermove", (e) => {
    const rect = chart.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    showAt(n === 1 ? 0 : Math.round(((sx - M.left) / iw) * (n - 1)));
  });
  hit.addEventListener("pointerleave", hide);
  chart.addEventListener("focus", () => showAt(current));
  chart.addEventListener("blur", hide);
  chart.addEventListener("keydown", (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n };
    if (e.key in moves) { e.preventDefault(); showAt(current + moves[e.key]); }
  });

  const legend = series.length > 1 ? h("div", { class: "chart-legend" }, series.map((s) =>
    h("span", {}, h("span", { class: "chart-key", style: `background:${s.color}` }), s.name))) : null;
  return h("div", { class: "chart-wrap" }, h("div", { class: "chart-title" }, title), legend, box);
}

function growthCharts(growth) {
  if (!growth.length) {
    return h("div", { class: "card muted" }, "Charts appear once you have added words or practised.");
  }
  const dates = growth.map((d) => d.date);
  const table = h("details", { class: "chart-table" }, h("summary", {}, "Table view"),
    h("table", {}, h("thead", {}, h("tr", {}, ["Date", "Words in word bank", "Minutes speaking", "Minutes writing"].map((t) => h("th", {}, t)))),
      h("tbody", {}, [...growth].reverse().map((d) => h("tr", {},
        h("td", {}, d.date), h("td", {}, String(d.words)), h("td", {}, String(d.speak_minutes)), h("td", {}, String(d.write_minutes)))))));
  return h("div", { class: "card" },
    lineChart({ title: "Word bank size", unit: ["word", "words"], dates,
      series: [{ name: "Words", color: "var(--series-1)", values: growth.map((d) => d.words) }] }),
    lineChart({ title: "Practice minutes, cumulative", unit: "min", dates, series: [
      { name: "Speaking (incl. Improv, Toastmasters)", color: "var(--series-1)", values: growth.map((d) => d.speak_minutes) },
      { name: "Writing", color: "var(--series-2)", values: growth.map((d) => d.write_minutes) }] }),
    table);
}

async function statsView() {
  const s = await api("GET", "practice/stats");
  const w = s.modules.write;
  const sp = s.modules.spoken;
  const dash = (v, unit = "") => (v === null || v === undefined ? "—" : v + unit);
  const row = (label, ...cells) => h("tr", {}, h("td", { class: "muted" }, label), cells.map((c) => h("td", {}, String(c))));
  const names = { write: "Keep writing", speak: "Keep speaking", improv: "Improv", toast: "Toastmasters", talk: "Conversation" };
  show(
    h("h1", {}, "Stats"),
    h("div", { class: "grid" },
      h("div", { class: "card stat" }, h("b", {}, String(s.rank.level)), `Rank (${s.rank.xp} / ${s.rank.next_at} XP)`),
      h("div", { class: "card stat" }, h("b", {}, String(s.streak)), "day streak"),
      h("div", { class: "card stat" }, h("b", {}, "L" + s.levels.write), "Keep writing unlocked"),
      h("div", { class: "card stat" }, h("b", {}, "L" + s.levels.speak), "Keep speaking unlocked")),
    growthCharts(s.growth),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Writing"), h("th", {}, "Today"), h("th", {}, "Last 7 days"), h("th", {}, "7 days before"), h("th", {}, "All time"))),
      h("tbody", {},
        row("Words", w.today.words, w.this_week.words, w.last_week.words, w.all.words),
        row("Minutes", w.today.minutes, w.this_week.minutes, w.last_week.minutes, w.all.minutes),
        row("Typing speed (words/min)", dash(w.today.wpm), dash(w.this_week.wpm), dash(w.last_week.wpm), dash(w.all.wpm)),
        row("Issues per 100 words", dash(w.today.issues_per_100), dash(w.this_week.issues_per_100), dash(w.last_week.issues_per_100), dash(w.all.issues_per_100)),
        row("Average score", dash(w.today.avg_score), dash(w.this_week.avg_score), dash(w.last_week.avg_score), dash(w.all.avg_score)),
        row("Different words used", "", "", "", w.unique_words),
        row("Most words in one session", "", "", "", w.all.most_words)))),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Speaking (incl. Improv, Toastmasters)"), h("th", {}, "Today"), h("th", {}, "Last 7 days"), h("th", {}, "7 days before"), h("th", {}, "All time"))),
      h("tbody", {},
        row("Minutes speaking", sp.today.minutes, sp.this_week.minutes, sp.last_week.minutes, sp.all.minutes),
        row("Words spoken", sp.today.words, sp.this_week.words, sp.last_week.words, sp.all.words),
        row("Speaking speed (words/min)", dash(sp.today.wpm), dash(sp.this_week.wpm), dash(sp.last_week.wpm), dash(sp.all.wpm)),
        row("Times stuck", sp.today.stuck, sp.this_week.stuck, sp.last_week.stuck, sp.all.stuck),
        row("Filler words", sp.today.fillers, sp.this_week.fillers, sp.last_week.fillers, sp.all.fillers),
        row("Issues per 100 words", dash(sp.today.issues_per_100), dash(sp.this_week.issues_per_100), dash(sp.last_week.issues_per_100), dash(sp.all.issues_per_100)),
        row("Different words used", "", "", "", sp.unique_words),
        row("Longest session (minutes)", "", "", "", (sp.all.longest_seconds / 60).toFixed(1))))),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Module"), h("th", {}, "Sessions"), h("th", {}, "Words"), h("th", {}, "Minutes"))),
      h("tbody", {}, Object.entries(s.by_module).map(([m, v]) => row(names[m] || m, v.sessions, v.words, v.minutes))))),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Last 14 days"), h("th", {}, "Written (words)"), h("th", {}, "Spoken (minutes)"), h("th", {}, "XP"))),
      h("tbody", {}, [...s.days].reverse().map((d) => row(d.date, d.write_words, d.spoken_minutes, d.xp))))),
  );
}

// ---- settings / sync --------------------------------------------------
async function settingsView() {
  settings = await api("GET", "settings");
  const key = h("input", { class: "wide", type: "password", autocomplete: "off",
    placeholder: settings.has_key ? "Saved (leave empty to keep it)" : "sk-…" });
  const model = h("input", { class: "wide", value: settings.model });
  const accent = h("select", {},
    h("option", { value: "us", selected: settings.accent === "us" }, "American"),
    h("option", { value: "uk", selected: settings.accent === "uk" }, "British"));
  const perDay = h("input", { type: "number", min: "0", max: "500", value: String(settings.new_per_day) });
  const myName = h("input", { class: "wide", maxlength: "40", value: settings.my_name || "", placeholder: "The name you use in English" });
  const letterHint = h("input", { type: "checkbox", checked: settings.letter_hint !== false });
  const hometown = h("input", { class: "wide", maxlength: "40", value: settings.hometown || "", placeholder: "e.g. a city or region" });
  const myRole = h("input", { class: "wide", maxlength: "60", value: settings.my_role || "", placeholder: "e.g. Data Engineer" });
  const myCompany = h("input", { class: "wide", maxlength: "60", value: settings.my_company || "", placeholder: "The company you work for" });
  const option = (value, text, current) => h("option", { value, selected: value === current }, text);
  const engine = h("select", {},
    option("openai", "OpenAI natural voice (needs a key; each sentence is generated once)", settings.tts),
    option("browser", "Browser voice (free, more robotic)", settings.tts));
  const voice = h("select", {}, settings.voices.map((v) =>
    option(v, v === "marin" || v === "cedar" ? `${v} (recommended)` : v, settings.voice)));
  const pace = h("select", {}, option("normal", "Normal", settings.pace), option("slow", "A little slower", settings.pace));
  const ttsModel = h("select", {},
    option("gpt-4o-mini-tts", "gpt-4o-mini-tts (cheap; after its shutdown on 2027-01-06 the next one is used automatically)", settings.tts_model),
    option("gpt-audio-1.5", "gpt-audio-1.5 (about 5× the price, no shutdown date)", settings.tts_model));
  const preview = () => speak("Hey, sorry I'm running a bit late. Can we push the meeting back ten minutes?",
    accent.value, { tts: engine.value, voice: voice.value, pace: pace.value });
  const save = async () => {
    const body = { accent: accent.value, model: model.value, new_per_day: perDay.value,
      my_name: myName.value, hometown: hometown.value, my_role: myRole.value, my_company: myCompany.value,
      letter_hint: letterHint.checked,
      tts: engine.value, voice: voice.value, pace: pace.value, tts_model: ttsModel.value };
    if (key.value.trim()) body.openai_key = key.value.trim();
    try {
      settings = await api("PUT", "settings", body);
      toast("Saved");
      settingsView();
    } catch (e) {
      toast(e.message);
    }
  };
  show(
    h("h1", {}, "Settings"),
    h("div", { class: "card" },
      h("label", {}, "OpenAI key (kept only in config.local.json on this computer, never uploaded by Sync)"), key,
      h("label", {}, "AI model"), model,
      h("label", {}, "New words per day"), perDay,
      h("label", { style: "color:inherit;font-size:16px;margin-top:14px" }, letterHint,
        " Show the first letter in cloze blanks"),
      h("div", { class: "muted" }, "Turn it off to recall every word with no hint. Particle choices such as up/down never show a letter."),
      h("label", {}, "Your name (used in small-talk example answers)"), myName,
      h("label", {}, "Where you're from (used in small-talk example answers)"), hometown,
      h("label", {}, "Your job title (used in self-introduction example answers)"), myRole,
      h("label", {}, "Your company (used in self-introduction example answers)"), myCompany,
      h("div", { class: "row", style: "margin-top:16px" },
        h("button", { class: "primary", type: "button", onclick: save }, "Save"))),
    h("div", { class: "card" },
      h("label", {}, "Read-aloud voice"), engine,
      h("label", {}, "Accent"), accent,
      h("label", {}, "Voice"), voice,
      h("label", {}, "Pace"), pace,
      h("label", {}, "Speech model"), ttsModel,
      h("p", { class: "muted" }, "Natural voice: each sentence is generated the first time it plays (about 1 second), then played from the local cache at no cost. Without a key, or if generation fails, the browser voice is used."),
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { type: "button", onclick: preview }, "Preview this choice"),
        h("button", { class: "primary", type: "button", onclick: save }, "Save"))),
  );
}

document.getElementById("sync").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    const r = await api("POST", "sync", {});
    toast(r.message);
    if (!r.ok) {
      show(h("h1", {}, "Sync did not finish"), h("div", { class: "card" }, h("p", {}, r.message),
        h("pre", {}, r.steps.map((s) => `$ ${s.cmd}\n${s.output}`).join("\n\n"))));
    }
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Sync";
  }
});

// ---- router -----------------------------------------------------------
const routes = {
  home: homeView, cloze: clozeView, translate: translateView, wrongbook: wrongbookView, review: reviewView,
  add: addView, words: wordsView, settings: settingsView,
  write: () => practiceView("write"), speak: () => practiceView("speak"), talk: () => practiceView("talk"),
  improv: () => practiceView("improv"), toast: () => practiceView("toast"), stats: statsView,
};

async function render() {
  cancelRecording();
  stopSpeaking();
  const name = location.hash.slice(1) || "home";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + name));
  try {
    await (routes[name] || homeView)();
  } catch (e) {
    show(h("div", { class: "card" }, "Something went wrong: " + e.message));
  }
}

window.addEventListener("unhandledrejection", (e) => toast("Something went wrong: " + (e.reason?.message || e.reason)));
window.addEventListener("hashchange", render);
api("GET", "settings").then((s) => { settings = s; }).catch(() => {}).finally(render);
