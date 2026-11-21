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
  renting: "Renting & flatting", utilities: "Power, internet & phone plans", neighbours: "Neighbours & community",
  leisure: "Hobbies & going out", emergency: "Emergencies & police", jobhunt: "Job hunting", pets: "Pets & the vet",
  repairs: "Tradies & repairs", occasions: "Holidays & special occasions",
};
// Translation scenes, in the order the dropdown shows them.
const TRANSLATE_SCENES = ["work", "tech", "jobhunt", "study", "home", "renting", "neighbours", "utilities", "repairs",
  "shopping", "restaurant", "money", "admin", "health", "emergency", "driving", "travel", "outdoors", "sports",
  "leisure", "social", "occasions", "family", "pets", "feelings"];
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

async function api(method, path, body, extra = {}) {
  const options = { method, ...extra };
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

// "Add to word bank" from a Cloze or Translate card: the page is set aside as it is (live
// nodes, so the card, its buttons and ← Previous all keep working) and put back when the
// learner returns, unless the filters changed in between (e.g. "Redo them all").
let parked = null;
function parkPage(hash, filters) {
  parked = { hash, filters: JSON.stringify(filters), nodes: [...view.childNodes] };
}
function unparkPage(hash, filters) {
  const p = parked;
  parked = null;
  if (!p || p.hash !== hash || p.filters !== JSON.stringify(filters)) return false;
  show(p.nodes);
  return true;
}

// "← Previous": look back at answers you have moved on from, then return to where you were.
// Past cards are kept as live DOM nodes, so their buttons (Never show again, Add to word bank,
// I don't know, ☆ Save) still work. `past` holds {nodes, label?}, newest last; pass an
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
  const fmt = (n) => Number(n).toLocaleString("en");
  const num = (n, label) => h("div", {}, h("b", { class: n ? "" : "zero" }, fmt(n)), h("span", { class: "muted" }, label));
  // One card per daily activity: what is waiting, the bank behind it, and a way in.
  const activity = (title, nums, foot, href, button) => h("div", { class: "card" },
    h("h2", {}, title),
    h("div", { class: "nums" }, nums),
    h("div", { class: "foot" }, foot),
    h("a", { href }, h("button", { class: "primary", type: "button" }, button)));
  show(
    h("h1", {}, "What to practise today"),
    h("div", { class: "today" },
      activity("Words",
        [num(s.words.due, "due"), num(s.words.new_today_left, "new today")],
        `${fmt(s.words.total)} in the bank` + (s.words.never ? ` · ${fmt(s.words.never)} hidden` : ""),
        "#review", "Review words"),
      activity("Cloze",
        [num(s.cloze.due, "to redo"), num(s.cloze.unseen, "not done")],
        `${fmt(s.cloze.passed)} passed · ${fmt(s.cloze.learning)} learning` + (s.cloze.never ? ` · ${fmt(s.cloze.never)} hidden` : ""),
        "#cloze", "Start cloze"),
      activity("Translate",
        [num(s.translate.due, "to redo"), num(s.translate.unseen, "not done")],
        `${fmt(s.translate.passed)} passed · ${fmt(s.translate.learning)} learning` + (s.translate.never ? ` · ${fmt(s.translate.never)} hidden` : ""),
        "#translate", "Translate sentences"),
    ),
    s.has_key ? null : h("p", { class: "notice" }, "No OpenAI key yet, so AI explanations and feedback are off. Add it in Settings."),
  );
}

// ---- cloze ------------------------------------------------------------
// A solved cloze sentence with the blank words bold and highlighted. parts come from the
// server ({text} | {fill, blank}); fills (optional, per blank) replace the main answers.
function filledSentence(parts, fills) {
  return parts.map((p) => (p.text !== undefined ? p.text
    : h("mark", { class: "fill" }, (fills && fills[p.blank]) || p.fill)));
}
const sameAnswer = (a, b) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
// Every accepted answer, main one first, one line per blank that has alternatives (the full
// list, so it can be copied onto a flashcard). given (optional): what the learner typed; the
// answer they used is marked "yours". Each answer is highlighted.
function acceptedLines(accepted, given) {
  return accepted.map((answers, i) => {
    if (answers.length < 2) return null;
    const lead = accepted.length > 1 ? `Blank ${i + 1}, accepted: ` : "Accepted: ";
    return h("div", { class: "also" }, h("span", { class: "muted" }, lead),
      answers.flatMap((a, k) => [k ? " · " : "", h("mark", { class: "fill" }, a),
        given && given[i] && sameAnswer(given[i], a) ? " (yours)" : ""]));
  });
}

const clozeMeta = () => api("GET", "cloze/meta?" + new URLSearchParams(
  Object.entries({ pos: clozeFilters.pos, scene: clozeFilters.scene }).filter(([, v]) => v)));

async function clozeView() {
  if (unparkPage("#cloze", clozeFilters)) return;
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
    h("div", { class: "page-head" },
      h("h1", {}, clozeFilters.mode === "wrongbook" ? "Redo wrong answers" : "Translation cloze"),
      h("div", { class: "actions" },
        earlier.nav,
        clozeFilters.mode === "wrongbook"
          ? h("button", { type: "button", onclick: () => { clozeFilters.mode = ""; clozeView(); } }, "Back to normal practice")
          : null)),
    h("div", { class: "filters" },
      select("pos", "pos", "All word classes", true),
      select("scenes", "scene", clozeFilters.pos === "grammar" ? "All topics" : "All scenes", true),
      select("levels", "level", "All levels", false)),
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
        h("button", { type: "button", onclick: revealAnswer }, "I don't know"),
        h("button", { class: "link", type: "button", onclick: never }, "Never show again"),
      );
    }

    let checking = false; // a second Enter while the first check is on its way is ignored
    async function submit() {
      if (checking || entry.done) return;
      checking = true;
      let result;
      try {
        result = await api("POST", "cloze/answer", {
          id: q.id, answers: inputs.map((i) => i.value), record: !attempted,
        });
      } finally {
        checking = false;
      }
      result.blanks.forEach((b, i) => { inputs[i].className = "blank " + b.kind; });
      if (result.correct) return finish(result, !attempted, inputs.map((i) => i.value));
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

    // The best answer first, then the other accepted answers. given: what the learner typed,
    // when it was accepted.
    function finish(result, firstTry, given) {
      entry.done = true;
      inputs.forEach((i) => { i.disabled = true; });
      speak(result.sentence);
      fill(feedback, 
        h("div", { class: firstTry ? "good" : "bad" },
          firstTry ? "Correct." : "This question comes back later today, then at growing intervals."),
        h("div", { class: "answer" }, filledSentence(result.parts),
          h("button", { class: "link", type: "button", onclick: () => speak(result.sentence) }, "🔊")),
        acceptedLines(result.accepted, given),
        result.note ? h("div", { class: "note" }, "💡 " + result.note) : null,
      );
      const next = h("button", { class: "primary", type: "button", onclick: advance }, "Next");
      // Right, but not really known: the same as not knowing it.
      const dontKnow = h("button", { type: "button", onclick: async () => {
        await api("POST", "cloze/mark", { id: q.id, outcome: "guessed" });
        dontKnow.disabled = true;
        toast("Added to the wrong book");
      } }, "I don't know");
      fill(actions, 
        next,
        firstTry ? dontKnow : null,
        h("button", { type: "button", onclick: async () => {
          // A word worth saving is a question worth redoing: it goes in the wrong book too
          // (if it isn't already), without counting as a mistake.
          if (firstTry && !dontKnow.disabled) {
            await api("POST", "cloze/mark", { id: q.id, outcome: "star" });
            dontKnow.disabled = true;
            toast("Also added to the wrong book");
          }
          parkPage("#cloze", clozeFilters); // come back to this same card after saving the word
          // The sentence and the blank word(s) go to the top, and the AI fills in the card.
          prefill = { sentence: result.sentence, focus: result.answers.join(", "), explain: true,
            term: result.answers[0], examples: [{ en: result.sentence, zh: result.zh }],
            tags: ["Cloze"], returnTo: "#cloze" };
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
  fix: ["warn", "⚠️ Almost."],
  wrong: ["bad", "❌ Not quite. The meaning is off."],
};

// Loose sentence key: case, punctuation and spacing don't count.
const sentenceKey = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

// Word-level LCS from one sentence to another; punctuation and case don't count.
// Returns runs of { tag: null | "del" | "ins", words }.
function wordRuns(from, to) {
  const a = from.match(/\S+/g) || [], b = to.match(/\S+/g) || [];
  const ka = a.map(sentenceKey), kb = b.map(sentenceKey);
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const put = (tag, word) => {
    const last = out[out.length - 1];
    if (last && last.tag === tag) last.words.push(word);
    else out.push({ tag, words: [word] });
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) { put(null, b[j]); i++; j++; }
    else if (i < a.length && (j >= b.length || L[i + 1][j] >= L[i][j + 1])) put("del", a[i++]);
    else put("ins", b[j++]);
  }
  return out;
}
// The learner's sentence with the fix written into it: removed words struck out
// in red, added words in green.
function diffWords(from, to) {
  return wordRuns(from, to).flatMap((part, n) => [n ? " " : null,
    part.tag ? h(part.tag, {}, part.words.join(" ")) : part.words.join(" ")]);
}
// Another way to say the model sentence, with the words that differ from it
// bold and highlighted (words only in the model are left out).
function markChanges(model, other) {
  return wordRuns(model, other).filter((part) => part.tag !== "del").flatMap((part, n) => [n ? " " : null,
    part.tag ? h("mark", { class: "fill" }, part.words.join(" ")) : part.words.join(" ")]);
}
const translateMeta = () => api("GET", "translate/meta?" + new URLSearchParams(
  Object.entries({ type: translateFilters.type, scene: translateFilters.scene }).filter(([, v]) => v)));

// The Translate card on screen. If it was answered (checked) but the learner has not
// picked "Next" or "Save to wrong book" yet, leaving it any other way (a filter,
// another page, closing the tab) counts as wrong and saves it to the wrong book.
// A card that was never answered is left alone and stays new.
let leaveTranslateCard = null;
function settleTranslateCard(keepalive = false) {
  const leave = leaveTranslateCard;
  leaveTranslateCard = null;
  return leave ? leave(keepalive) : undefined;
}
window.addEventListener("pagehide", () => settleTranslateCard(true));

async function translateView() {
  if (unparkPage("#translate", translateFilters)) return;
  await settleTranslateCard();
  let { counts } = await translateMeta();
  if (translateFilters.scene && !(translateFilters.scene in counts.scenes)) translateFilters.scene = "";
  if (translateFilters.level && !(translateFilters.level in counts.levels)) translateFilters.level = "";
  const names = { types: (k) => TYPE_NAMES[k] || k, scenes: (k) => SCENE_NAMES[k] || k, levels: (k) => "L" + k };
  const label = (group, k, c) => `${names[group](k)} (${c.total} / ${c.left})`; // total / not yet attempted
  const select = (group, key, placeholder, rerender) => {
    const entries = Object.entries(counts[group]);
    const order = { types: TYPE_ORDER, scenes: TRANSLATE_SCENES }[group];
    if (order) entries.sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
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
    h("div", { class: "page-head" },
      h("h1", {}, wrongbook ? "Redo saved and wrong translations" : "Translate the sentence"),
      h("div", { class: "actions" },
        earlier.nav,
        wrongbook
          ? h("button", { type: "button", onclick: () => { translateFilters.mode = ""; translateView(); } }, "Back to normal practice")
          : null)),
    h("div", { class: "filters" },
      select("types", "type", "All sentence types", true),
      select("scenes", "scene", "All scenes", true),
      select("levels", "level", "All levels", false)),
    box,
  );

  // "Next" on a card: the next sentence, or, on an earlier card, the next newer one.
  const advance = () => (earlier.reviewing ? earlier.forward() : loadQuestion());

  async function loadQuestion() {
    await settleTranslateCard();
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
    leaveTranslateCard = (keepalive) => {
      if (!attempted || settled) return undefined; // not answered, or already recorded
      settled = true;
      inBook = true;
      if (!keepalive) toast("Saved to the wrong book");
      return api("POST", "translate/mark", { id: q.id, outcome: "wrong" }, keepalive ? { keepalive: true } : {})
        .catch((e) => toast(e.message));
    };

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
      settled = true; // recorded: leaving it must not save it to the wrong book as well
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
      // Layout, top to bottom: verdict → your sentence corrected in place, with the
      // reasons under it → the model answer and other ways to say it → tip.
      // Each sentence appears once: if your fixed sentence is the model answer,
      // the model block only keeps the alternatives.
      const fixed = r.fixed && answer && sentenceKey(r.fixed) !== sentenceKey(answer) ? r.fixed : "";
      const fixedIsModel = fixed && sentenceKey(fixed) === sentenceKey(r.en);
      const whole = (orig) => sentenceKey(orig).split(" ").length >= sentenceKey(answer).split(" ").length - 1;
      const reasons = (r.issues || []).filter((i) => i.why);
      fill(feedback,
        r.ai_error ? h("div", { class: "bad" }, "No AI check: " + r.ai_error) : null,
        answer && !r.verdict && !r.ai_error ? h("div", { class: "muted" }, "No OpenAI key, so there is no AI check.") : null,
        verdict ? h("div", { class: "verdict " + verdict[0] }, verdict[1]) : null,
        fixed ? h("div", { class: "fb-block" },
          h("div", { class: "fb-label" }, fixedIsModel ? "Yours, corrected (= model answer)" : "Yours, corrected"),
          h("div", { class: "fb-sentence diff" }, diffWords(answer, fixed),
            h("button", { class: "link", type: "button", onclick: () => speak(fixed) }, "🔊")),
          reasons.length ? h("ul", { class: "reasons" }, reasons.map((i) => h("li", {},
            i.original && i.better && !whole(i.original)
              ? [h("del", {}, i.original), " → ", h("ins", {}, i.better), "  "] : null,
            i.why))) : null) : null,
        // a "fix" verdict without a fixed sentence: fall back to the issue list
        !fixed && r.issues && r.issues.length ? h("ul", { class: "reasons" }, r.issues.map((i) => h("li", {},
          h("del", {}, i.original), " → ", h("ins", {}, i.better), i.why ? "  " + i.why : null))) : null,
        selfMark ? markBox : null,
        h("div", { class: "fb-block model" },
          fixedIsModel ? null : [
            h("div", { class: "fb-label" }, answer ? "Model answer" : "Answer"),
            h("div", { class: "fb-sentence answer" }, r.en,
              h("button", { class: "link", type: "button", onclick: () => speak(r.en) }, "🔊"))],
          r.alt.length ? h("div", { class: "alt" }, h("span", { class: "fb-label" }, "Also: "),
            r.alt.flatMap((s, k) => [k ? " · " : null, ...markChanges(r.en, s)])) : null),
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
          parkPage("#translate", translateFilters); // come back to this same card after saving
          prefill = { sentence: r.en, examples: [{ en: r.en, zh: r.zh }], tags: ["Translate"],
            returnTo: "#translate" };
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
  const tab = (id, text, n) => h("button", { type: "button", class: wrongbookTab === id ? "on" : "",
    onclick: () => { wrongbookTab = id; wrongbookView(); } }, text, h("span", { class: "count" }, String(n)));
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
        h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap;align-items:flex-start" },
          h("div", { class: "answer", style: "margin:0" }, item.en,
            h("button", { class: "link", type: "button", onclick: () => speak(item.en) }, "🔊")),
          remove("translate/wrongbook/remove", item.id, "sentence")),
        h("div", { class: "book-zh" }, item.zh),
        h("details", { class: "fold", style: "margin-top:4px" }, h("summary", {}, "Details"),
          h("div", { class: "muted" },
            [TYPE_NAMES[item.type] || item.type, SCENE_NAMES[item.scene] || item.scene, "L" + item.level,
              item.starred ? "★ saved" : null, item.wrong ? `wrong ${item.wrong}×` : null].filter(Boolean).join(" · ")),
          item.last_answer ? h("div", { class: "muted" }, "Your last answer: " + item.last_answer) : null,
          item.point ? h("div", { class: "note" }, "💡 " + item.point) : null)))]
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
        h("div", { class: "answer" }, filledSentence(item.parts),
          h("button", { class: "link", type: "button", onclick: () => speak(item.sentence) }, "🔊")),
        acceptedLines(item.accepted)))];
  show(
    h("h1", {}, "Wrong book"),
    h("div", { class: "tabs" },
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

// A regex for term inside a sentence, allowing common endings on each word
// (make → makes / making, stop → stopped, carry → carried, bleeding → bleeds).
// "restart · reboot" matches either. null if term has no letters.
function termPattern(term) {
  const word = (t) => {
    let stem = t;
    if (stem.length > 5 && stem.endsWith("ing")) stem = stem.slice(0, -3);
    else if (stem.length > 5 && /[^e]ed$/.test(stem)) stem = stem.slice(0, -2);
    else if (stem.length > 3 && /[ey]$/.test(stem)) stem = stem.slice(0, -1);
    const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `${esc}${esc.slice(-1)}?(?:e|y|s|es|ed|d|ing|ies|ied|ier|iest|er|est|ly)?`;
  };
  const phrases = term.toLowerCase().split(/[·,;/|]/)
    .map((p) => p.match(/[a-z0-9']+/g)).filter(Boolean)
    .map((tokens) => tokens.map(word).join("[\\s-]+"));
  return phrases.length ? new RegExp(`\\b(?:${phrases.join("|")})\\b`, "gi") : null;
}

// The sentence with each occurrence of term bold and highlighted.
function highlightTerm(sentence, term) {
  const re = term && termPattern(term);
  if (!re) return sentence;
  const out = [];
  let last = 0;
  for (const m of sentence.matchAll(re)) {
    out.push(sentence.slice(last, m.index), h("mark", { class: "fill" }, m[0]));
    last = m.index + m[0].length;
  }
  return last ? [...out, sentence.slice(last)] : sentence;
}

const SHOWN_EXAMPLES = 3;

function cardDetails(word) {
  const examples = [
    ...word.examples.map((ex) => h("div", { class: "example" }, highlightTerm(ex.en, word.term),
      h("button", { class: "link", type: "button", onclick: () => speak(ex.en) }, "🔊"),
      h("span", { class: "muted" }, ex.zh))),
    ...word.my_examples.map((ex) => h("div", { class: "example" }, "✍️ ", highlightTerm(ex, word.term))),
  ];
  // A fresh order every time the card is shown, so a different example leads.
  for (let i = examples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [examples[i], examples[j]] = [examples[j], examples[i]];
  }
  const hidden = examples.slice(SHOWN_EXAMPLES);
  hidden.forEach((el) => { el.hidden = true; });
  const more = hidden.length ? h("button", { class: "link", type: "button", onclick: () => {
    const open = hidden[0].hidden;
    hidden.forEach((el) => { el.hidden = !open; });
    more.textContent = open ? "Show fewer" : `View more (${hidden.length})`;
  } }, `View more (${hidden.length})`) : null;
  return [
    word.respelling ? h("div", { class: "muted" }, word.respelling) : null,
    word.zh ? h("div", { class: "zh" }, (word.emoji ? word.emoji + " " : "") + word.zh) : null,
    word.definition ? h("p", {}, word.definition) : null,
    pictureBox(word),
    examples,
    more,
    word.note ? h("div", { class: "note pre" }, word.note) : null,
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
  const header = h("div", { class: "page-head" }, h("h1", {}, "Review words"), h("div", { class: "actions" }, previous));
  const info = h("div", { class: "facts", style: "margin:0 0 12px" },
    h("span", {}, h("b", {}, String(counts.due)), h("span", { class: "muted" }, " due")),
    h("span", {}, h("b", {}, String(counts.new_today_left)), h("span", { class: "muted" }, " new left today")),
    h("span", {}, h("b", {}, String(counts.total)), h("span", { class: "muted" }, reviewTags.length ? " cards with these tags" : " in word bank")));
  if (!word) {
    show(header, filter, info, h("div", { class: "card" },
      counts.total ? "All done for today" + (reviewTags.length ? " with these tags." : ".")
        : reviewTags.length ? "No cards with these tags."
          : "Your word bank is empty. Add a few words in Add / Capture, or add a word pack in Word bank."));
    return;
  }
  const back = h("div", { class: "card-back" });
  const actions = h("div", { class: "rate" });
  let rating = false; // a rating is being sent: ignore further presses
  const rate = async (choice) => {
    if (rating) return;
    rating = true;
    try {
      await api("POST", "words/rate", { id: word.id, rating: choice });
    } catch (e) {
      rating = false;
      return toast(e.message);
    }
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
      h("button", { class: "bad", type: "button", onclick: () => rate("forget") }, "Forgot", h("kbd", {}, "1")),
      h("button", { class: "warn", type: "button", onclick: () => rate("fuzzy") }, "Fuzzy", h("kbd", {}, "2")),
      h("button", { class: "good", type: "button", onclick: () => rate("remember") }, "Remembered", h("kbd", {}, "3")),
      h("button", { class: "link", type: "button", onclick: () => rate("never") }, "Never show again"),
    );
    revealed = true;
  };
  let revealed = false;
  // Keys: Space shows the answer, then 1 / 2 / 3 rate it (not while typing an example).
  const onKey = (e) => {
    if (!card.isConnected) return document.removeEventListener("keydown", onKey);
    if (e.target.closest?.("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!revealed && e.key === " ") { e.preventDefault(); reveal(); }
    else if (revealed && ["1", "2", "3"].includes(e.key)) rate(["forget", "fuzzy", "remember"][Number(e.key) - 1]);
  };
  document.addEventListener("keydown", onKey);
  const showButton = h("button", { class: "primary", type: "button", onclick: reveal }, "Show answer", h("kbd", {}, "Space"));
  actions.append(showButton);
  const card = h("div", { class: "card review-card" },
    undone ? h("div", { class: "muted" },
      `Your rating “${RATING_TEXT[undone.rating] || undone.rating}” was taken back. Rate this card again.`) : null,
    h("div", { class: "term" }, word.term),
    h("div", { class: "say" }, speakButtons(word.term)), back, actions);
  show(header, filter, info, card);
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
  focus.value = draft.focus || "";
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
      // Keep the source card's own Chinese for its sentence (e.g. from Cloze).
      const known = (draft.examples || []).find((ex) => ex.zh && r.sentence && sentenceKey(ex.en) === sentenceKey(r.sentence));
      const mine = r.sentence ? [{ en: r.sentence, zh: known ? known.zh : r.sentence_zh }] : [];
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
      if (draft.returnTo) location.hash = draft.returnTo; // back to the card you came from
      else addView();
    } catch (e) {
      toast(e.message);
    }
  }

  show(
    h("div", { class: "page-head" }, h("h1", {}, "Add / Capture"),
      // Came from a Cloze or Translate card: a way back to it without saving anything.
      draft.returnTo ? h("div", { class: "actions" }, h("button", { type: "button",
        onclick: () => { location.hash = draft.returnTo; } }, "← Back to the card")) : null),
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
  if (draft.explain && settings.has_key && sentence.value.trim()) explain();
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
let bankSearch = ""; // kept while the list redraws after an edit or delete

async function wordsView() {
  const [{ words, tags }, { packs }] = await Promise.all([api("GET", "words"), api("GET", "words/packs")]);
  const matches = (w) => !bankTags.length || bankTags.some((t) =>
    t === UNTAGGED ? !(w.tags || []).length : (w.tags || []).some((x) => x === t || x.startsWith(t + "/")));
  const body = h("div", { class: "wordlist" });
  const count = h("span", { class: "muted" });
  let search = bankSearch;
  const LIMIT = 300; // rows drawn at once; search or filter to narrow down
  const draw = () => {
    const list = words.filter((w) => matches(w) && (!search || w.term.toLowerCase().includes(search.toLowerCase())
      || (w.zh || "").includes(search)));
    count.textContent = list.length === words.length ? `${words.length} words` : `${list.length} of ${words.length} words`;
    fill(body, list.slice(0, LIMIT).map(row),
      list.length > LIMIT ? h("div", { class: "word-more muted" }, `Showing ${LIMIT} of ${list.length}. Search or pick a tag to see the rest.`) : null,
      list.length ? null : h("div", { class: "word-more muted" }, words.length ? "No words match." : "No words yet. Add a word pack above, or use Add / Capture."));
  };
  function row(w) {
    const details = h("div", { class: "word-details", hidden: true });
    const editTags = h("button", { class: "link", type: "button", onclick: async () => {
      const value = prompt("Tags, comma-separated (use / for a sub-topic):", (w.tags || []).join(", "));
      if (value === null) return;
      const r = await api("PUT", "words/" + w.id, { tags: value.split(",") });
      Object.assign(w, r.word);
      wordsView();
    } }, "Edit tags");
    const status = w.srs.never ? ["Hidden", "off"] : w.srs.due ? ["Next " + shortDate(w.srs.due), ""] : ["New", "new"];
    const toggle = h("button", { class: "link", type: "button", onclick: () => {
      details.hidden = !details.hidden;
      toggle.textContent = details.hidden ? "Details" : "Hide";
      if (!details.hidden) fill(details, cardDetails(w), editTags);
    } }, "Details");
    const main = h("div", { class: "word-row" },
      h("div", { class: "word-term" }, h("b", {}, (w.emoji ? w.emoji + " " : "") + w.term),
        w.respelling ? h("div", { class: "muted small" }, w.respelling) : null),
      h("div", { class: "word-meaning" }, w.zh ? h("div", {}, w.zh) : null,
        w.definition ? h("div", { class: w.zh ? "muted small" : "" }, w.definition) : null, tagList(w.tags)),
      h("div", { class: "word-meta" },
        h("span", { class: "pill " + status[1] }, status[0]), w.image ? h("span", { title: "Has a picture" }, "🖼") : null,
        toggle,
        h("button", { class: "link danger", type: "button", onclick: async () => {
          if (!confirm(`Delete "${w.term}"?`)) return;
          await api("DELETE", "words/" + w.id);
          wordsView();
        } }, "Delete")));
    return h("div", { class: "word" }, main, details);
  }

  const packCards = packs.map(packCard);

  draw();
  show(
    h("div", { class: "page-head" }, h("h1", {}, "Word bank"), count),
    packs.length ? h("details", { class: "card", open: !words.length },
      h("summary", {}, h("b", {}, "Word packs"), h("span", { class: "muted" }, " · themed lists you can add with one click")),
      h("p", { class: "muted" }, "Preview a pack, tick the topics or single cards you want, and add only those. New cards join the review queue in pack order, within your daily new-word limit (Settings)."),
      packCards) : null,
    h("input", { class: "wide search", type: "search", placeholder: "Search English or Chinese", value: bankSearch,
      oninput: (e) => { search = bankSearch = e.target.value.trim(); draw(); } }),
    Object.keys(tags).length ? tagFilter(tags, bankTags, () => { remember("bankTags", bankTags); draw(); }) : null,
    h("div", { class: "card flush" }, body),
  );
}

// ---- keep writing / keep speaking / improv / toastmasters ---------------
const practiceTrack = {}; // remembered track per module
const practiceGroupTrack = {}; // remembered track per module/group
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

  // Picking a topic: group tabs on one line (Levels, Small talk, ...), then one dropdown for
  // the topics in that group. Each group remembers the topic last used in it.
  const groupOf = (t) => t.group || "";
  const pick = (t) => {
    practiceTrack[module] = t.id;
    practiceGroupTrack[`${module}/${groupOf(t)}`] = t.id;
    practiceView(module);
  };
  practiceGroupTrack[`${module}/${groupOf(track)}`] = track.id;
  const groups = [...new Set(meta.tracks.map(groupOf))];
  const firstIn = (g) => {
    const inGroup = open.filter((t) => groupOf(t) === g);
    const ladder = inGroup.filter((t) => t.level);
    return inGroup.find((t) => t.id === practiceGroupTrack[`${module}/${g}`]) || ladder[ladder.length - 1] || inGroup[0];
  };
  const tabs = groups.length > 1 ? h("div", { class: "tabs", role: "tablist" },
    groups.map((g) => h("button", { type: "button", role: "tab", class: g === groupOf(track) ? "on" : "",
      "aria-selected": String(g === groupOf(track)),
      onclick: () => { const t = firstIn(g); if (t && t.id !== track.id) pick(t); } }, g || "Other"))) : null;
  const siblings = meta.tracks.filter((t) => groupOf(t) === groupOf(track));
  const picker = siblings.length > 1 ? h("select", { "aria-label": "Topic",
    onchange: (e) => pick(meta.tracks.find((t) => t.id === e.target.value)) },
    siblings.map((t) => h("option", { value: t.id, selected: t.id === track.id, disabled: t.locked },
      (t.locked ? "🔒 " : "") + t.name + (t.private ? " (private)" : "")))) : null;
  const next = track.level && meta.tracks.find((t) => t.level === track.level + 1);
  const progress = next && next.locked
    ? h("div", { class: "muted" }, `${Math.max(0, meta.unlock_sessions - track.good)} more good sessions unlock “${next.name}”`)
    : track.id === FREE_TALK.id
      ? h("div", { class: "muted" }, "Pick who you're talking to and what about. The AI asks follow-up questions about whatever you say.")
      : h("div", { class: "muted" }, `${track.done} / ${track.count} done`,
          h("div", { class: "bar" }, h("i", { style: `width:${track.count ? Math.round(100 * track.done / track.count) : 0}%` })));

  show(
    h("div", { class: "page-head" }, h("h1", {}, meta.name), h("div", { class: "actions" }, earlier.nav)),
    tabs,
    h("div", { class: "trackbar" }, picker, h("div", { class: "progress" }, progress)),
    track.private || track.id === FREE_TALK.id ? h("p", { class: "notice" },
      "🔒 Private: kept in private/ on this computer and never synced to GitHub. "
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
        mode === "speak" && !text && settings.has_key
          ? h("p", { class: "muted" }, "Nothing was heard in the recording, so there is no feedback. Try again a bit closer to the microphone.") : null,
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

let statsTab = "write"; // Writing / Speaking table on the stats page

async function statsView() {
  const s = await api("GET", "practice/stats");
  const dash = (v, unit = "") => (v === null || v === undefined ? "—" : v + unit);
  const names = { write: "Keep writing", speak: "Keep speaking", improv: "Improv", toast: "Toastmasters", talk: "Conversation" };
  // A table of numbers: label column on the left, figures right-aligned.
  const table = (head, rows) => h("div", { class: "table-scroll" }, h("table", { class: "data" },
    h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: i ? "num" : "" }, t)))),
    h("tbody", {}, rows.map(([label, ...cells]) => h("tr", {}, h("td", {}, label),
      cells.map((c) => h("td", { class: "num" }, String(c))))))));
  const periods = ["", "Today", "Last 7 days", "7 before", "All time"];
  const across = (m, key, f = (v) => v) => ["today", "this_week", "last_week", "all"].map((p) => f(m[p][key]));
  const fact = (label, value) => h("span", {}, h("span", { class: "muted" }, label + " "), h("b", {}, String(value)));

  // Rank: XP needed grows with the square of the level (level L starts at step × (L-1)²).
  const start = s.rank.next_at * ((s.rank.level - 1) / s.rank.level) ** 2;
  const rankPct = Math.max(0, Math.min(100, Math.round(100 * (s.rank.xp - start) / (s.rank.next_at - start || 1))));
  const kpi = (value, label, ...extra) => h("div", { class: "kpi" }, h("b", {}, value), h("span", { class: "muted" }, label), extra);

  const panel = h("div", {});
  const drawPanel = () => {
    const w = s.modules.write;
    const sp = s.modules.spoken;
    fill(tabs, [["write", "Writing"], ["speak", "Speaking"]].map(([id, text]) => h("button", { type: "button",
      class: statsTab === id ? "on" : "", onclick: () => { statsTab = id; drawPanel(); } }, text)));
    fill(panel, statsTab === "write"
      ? [table(periods, [
          ["Words", ...across(w, "words")],
          ["Minutes", ...across(w, "minutes")],
          ["Typing speed (words/min)", ...across(w, "wpm", dash)],
          ["Issues per 100 words", ...across(w, "issues_per_100", dash)],
          ["Average score", ...across(w, "avg_score", dash)]]),
        h("div", { class: "facts" }, fact("Different words used", w.unique_words), fact("Most words in one session", w.all.most_words))]
      : [table(periods, [
          ["Minutes speaking", ...across(sp, "minutes")],
          ["Words spoken", ...across(sp, "words")],
          ["Speaking speed (words/min)", ...across(sp, "wpm", dash)],
          ["Times stuck", ...across(sp, "stuck")],
          ["Filler words", ...across(sp, "fillers")],
          ["Issues per 100 words", ...across(sp, "issues_per_100", dash)]]),
        h("div", { class: "facts" }, fact("Different words used", sp.unique_words),
          fact("Longest session", (sp.all.longest_seconds / 60).toFixed(1) + " min")),
        h("div", { class: "muted small" }, "Speaking includes Improv, Toastmasters and Conversation.")]);
  };
  const tabs = h("div", { class: "tabs" });
  drawPanel();

  show(
    h("h1", {}, "Stats"),
    h("div", { class: "card kpis" },
      kpi(String(s.rank.level), "Rank", h("div", { class: "bar" }, h("i", { style: `width:${rankPct}%` })),
        h("span", { class: "muted small" }, `${s.rank.xp} / ${s.rank.next_at} XP`)),
      kpi(String(s.streak), s.streak === 1 ? "day streak" : "days streak"),
      kpi("L" + s.levels.write, "Writing level"),
      kpi("L" + s.levels.speak, "Speaking level")),
    growthCharts(s.growth),
    h("div", { class: "card" }, tabs, panel),
    h("div", { class: "card" },
      h("h2", { class: "card-title" }, "By module"),
      table(["", "Sessions", "Words", "Minutes"],
        Object.entries(s.by_module).map(([m, v]) => [names[m] || m, v.sessions, v.words, v.minutes])),
      h("details", { class: "fold" }, h("summary", {}, "Last 14 days"),
        table(["", "Words written", "Minutes spoken", "XP"],
          [...s.days].reverse().map((d) => [shortDate(d.date), d.write_words, d.spoken_minutes, d.xp])))),
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
  // "add" parks the Translate card and comes back to it; "translate" settles it itself.
  if (name !== "add" && name !== "translate") await settleTranslateCard();
  if ((location.hash.slice(1) || "home") !== name) return; // another link was clicked meanwhile
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + name));
  // On phones the links are one scrolling strip: keep the current page's link in view.
  const active = document.querySelector("nav a.active");
  if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  try {
    await (routes[name] || homeView)();
  } catch (e) {
    show(h("div", { class: "card" }, "Something went wrong: " + e.message));
  }
}

window.addEventListener("unhandledrejection", (e) => toast("Something went wrong: " + (e.reason?.message || e.reason)));
window.addEventListener("hashchange", render);
api("GET", "settings").then((s) => { settings = s; }).catch(() => {}).finally(render);
