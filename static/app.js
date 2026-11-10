"use strict";

const POS_NAMES = {
  verb: "Verbs", phrasal: "Phrasal verbs", adjective: "Adjectives", preposition: "Prepositions",
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
};
const KIND_TEXT = {
  correct: "correct", grammar: "right word, wrong form", spelling: "spelling mistake",
  word: "wrong word", empty: "empty",
};

const view = document.getElementById("view");
let settings = { accent: "us", new_per_day: 20, model: "", has_key: false, tts: "browser" };
let prefill = null; // card draft handed from another page to the add page

// Example answers may contain {name} and {hometown}, filled in from Settings.
function personalise(text) {
  return text
    .replaceAll("{name}", settings.my_name || "[your name]")
    .replaceAll("{hometown}", settings.hometown || "[your hometown]");
}
const clozeFilters = { pos: "", scene: "", level: "", mode: "" };

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

// options: {tts, voice, pace} override the saved settings (used by the settings preview).
async function speak(text, accent, options = {}) {
  stopSpeaking();
  if (!text) return;
  const token = {};
  speakToken = token;
  const a = accent || settings.accent;
  const pace = options.pace || settings.pace;
  if ((options.tts || settings.tts) === "openai" && settings.has_key) {
    const voice = options.voice || settings.voice;
    const cacheKey = JSON.stringify([voice, a, pace, text]);
    try {
      let url = audioUrls.get(cacheKey);
      if (!url) {
        const response = await fetch("/api/tts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, accent: a, voice, pace }),
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
    ),
    h("div", { class: "card" },
      h("div", {}, `Cloze bank: ${s.cloze.total} questions · ${s.cloze.passed} passed · ${s.cloze.learning} learning · ${s.cloze.never} hidden`),
      h("div", {}, `Word bank: ${s.words.total} words · ${s.words.never} hidden`),
      s.has_key ? null : h("p", { class: "muted" }, "No OpenAI key yet, so AI explanations and feedback are off. Add it in Settings."),
    ),
    h("div", { class: "row" },
      h("a", { href: "#cloze" }, h("button", { class: "primary", type: "button" }, "Start cloze")),
      h("a", { href: "#review" }, h("button", { type: "button" }, "Review words")),
    ),
  );
}

// ---- cloze ------------------------------------------------------------
async function clozeView() {
  const meta = await api("GET", "cloze/meta");
  const select = (key, label, options) =>
    h("select", { "aria-label": label, onchange: (e) => { clozeFilters[key] = e.target.value; loadQuestion(); } },
      h("option", { value: "" }, label),
      options.map(([value, text]) => h("option", { value, selected: clozeFilters[key] === String(value) }, text)));
  const box = h("div", {});
  // Scenes (or grammar topics) offered depend on the chosen word class.
  const scenes = {};
  for (const [pos, counts] of Object.entries(meta.by_pos)) {
    if (clozeFilters.pos && clozeFilters.pos !== pos) continue;
    for (const [scene, n] of Object.entries(counts)) scenes[scene] = (scenes[scene] || 0) + n;
  }
  if (clozeFilters.scene && !(clozeFilters.scene in scenes)) clozeFilters.scene = "";
  const posList = Object.entries(meta.pos).sort(([a], [b]) =>
    (POS_ORDER.indexOf(a) + 1 || 99) - (POS_ORDER.indexOf(b) + 1 || 99));
  const posSelect = h("select", { "aria-label": "Word class", onchange: (e) => { clozeFilters.pos = e.target.value; clozeView(); } },
    h("option", { value: "" }, "All word classes and topics"),
    posList.map(([k, n]) => h("option", { value: k, selected: clozeFilters.pos === k }, `${POS_NAMES[k] || k} (${n})`)));
  show(
    h("h1", {}, clozeFilters.mode === "wrongbook" ? "Redo wrong answers" : "Translation cloze"),
    h("div", { class: "row", style: "margin-bottom:16px" },
      posSelect,
      select("scene", clozeFilters.pos === "grammar" ? "All topics" : "All scenes",
        Object.entries(scenes).map(([k, n]) => [k, `${SCENE_NAMES[k] || k} (${n})`])),
      select("level", "All levels", Object.entries(meta.levels).map(([k, n]) => [k, `L${k} (${n})`])),
      clozeFilters.mode === "wrongbook"
        ? h("button", { type: "button", onclick: () => { clozeFilters.mode = ""; clozeView(); } }, "Back to normal practice")
        : null,
    ),
    box,
  );

  async function loadQuestion() {
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
      h("div", { class: "zh" }, q.zh),
      sentence, feedback, actions);

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
      loadQuestion();
    }

    function finish(result, firstTry) {
      inputs.forEach((i) => { i.disabled = true; });
      speak(result.sentence);
      fill(feedback, 
        h("div", { class: firstTry ? "good" : "bad" },
          firstTry ? "Correct." : "This question comes back later today, then at growing intervals."),
        h("div", { class: "answer" }, result.sentence,
          h("button", { class: "link", type: "button", onclick: () => speak(result.sentence) }, "🔊")),
      );
      const next = h("button", { class: "primary", type: "button", onclick: loadQuestion }, "Next");
      const guessed = h("button", { type: "button", onclick: async () => {
        await api("POST", "cloze/mark", { id: q.id, outcome: "guessed" });
        guessed.disabled = true;
        toast("Added to the redo queue");
      } }, "I actually guessed");
      fill(actions, 
        next,
        firstTry ? guessed : null,
        h("button", { type: "button", onclick: () => {
          prefill = { term: result.answers[0], examples: [{ en: result.sentence, zh: result.zh }] };
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

async function wrongbookView() {
  const { items } = await api("GET", "cloze/wrongbook");
  show(
    h("h1", {}, `Wrong book (${items.length})`),
    items.length
      ? h("div", { class: "row", style: "margin-bottom:16px" },
          h("button", { class: "primary", type: "button", onclick: () => {
            Object.assign(clozeFilters, { pos: "", scene: "", level: "", mode: "wrongbook" });
            location.hash = "#cloze";
          } }, "Redo them all"))
      : h("div", { class: "card" }, "No wrong answers yet."),
    items.map((item) => h("div", { class: "card" },
      h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap" },
        h("div", { class: "muted" }, item.zh, ` · wrong ${item.wrong}×`),
        h("button", { class: "link", type: "button", title: "Take this question off the wrong book", onclick: async () => {
          if (!confirm("Remove this question from the wrong book? It comes back if you get it wrong again.")) return;
          await api("POST", "cloze/wrongbook/remove", { id: item.id });
          toast("Removed from the wrong book");
          wrongbookView();
        } }, "Remove")),
      h("div", { class: "answer" }, item.sentence,
        h("button", { class: "link", type: "button", onclick: () => speak(item.sentence) }, "🔊")))),
  );
}

// ---- words: review ----------------------------------------------------
function cardDetails(word) {
  return [
    word.respelling ? h("div", { class: "muted" }, word.respelling) : null,
    word.definition ? h("p", {}, word.definition) : null,
    word.examples.map((ex) => h("div", { class: "example" }, ex.en,
      h("button", { class: "link", type: "button", onclick: () => speak(ex.en) }, "🔊"),
      h("span", { class: "muted" }, ex.zh))),
    word.my_examples.map((ex) => h("div", { class: "example" }, "✍️ " + ex)),
    word.note ? h("pre", {}, word.note) : null,
  ];
}

async function reviewView() {
  const { word, counts } = await api("GET", "words/next");
  const header = h("h1", {}, "Review words");
  const info = h("div", { class: "muted", style: "margin-bottom:12px" },
    `Due ${counts.due} · New left today ${counts.new_today_left} · In word bank ${counts.total}`);
  if (!word) {
    show(header, info, h("div", { class: "card" },
      counts.total ? "All done for today." : "Your word bank is empty. Add a few words in Add / Capture first."));
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
    fill(back, ...cardDetails(word).flat().filter(Boolean), mine);
    const forget = h("button", { class: "bad", type: "button", onclick: () => rate("forget") }, "Forgot");
    fill(actions, 
      forget,
      h("button", { class: "warn", type: "button", onclick: () => rate("fuzzy") }, "Fuzzy"),
      h("button", { class: "good", type: "button", onclick: () => rate("remember") }, "Remembered"),
      h("button", { class: "link", type: "button", onclick: () => rate("never") }, "Never show again"),
    );
  };
  const showButton = h("button", { class: "primary", type: "button", onclick: reveal }, "Show answer");
  actions.append(showButton);
  show(header, info, h("div", { class: "card" },
    h("div", { class: "term" }, word.term, speakButtons(word.term)), back, actions));
  speak(word.term);
  showButton.focus();
}

// ---- words: add / capture ---------------------------------------------
function addView() {
  const draft = prefill || {};
  prefill = null;
  const field = (attrs) => h("input", { class: "wide", ...attrs });
  const sentence = h("textarea", { rows: 2, placeholder: "Paste the sentence you heard or read. A fragment is fine (optional)" });
  const focus = field({ placeholder: "Which part don't you understand? A word, phrase or pattern (blank = the whole sentence)" });
  const term = field({ value: draft.term || "" });
  const respelling = field({ placeholder: "e.g. post-POHN" });
  const definition = field({});
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
        term: term.value, respelling: respelling.value, definition: definition.value,
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
      h("label", {}, "Examples"), examplesBox,
      h("button", { class: "link", type: "button", onclick: () => addExample() }, "+ Add an example"),
      notesBox,
      h("label", {}, "Note"), note,
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { class: "primary", type: "button", onclick: save }, "Save to word bank"))),
  );
}

async function wordsView() {
  const { words } = await api("GET", "words");
  const body = h("tbody", {});
  const draw = (filter) => fill(body, ...words
    .filter((w) => !filter || w.term.includes(filter.toLowerCase()))
    .map((w) => h("tr", {},
      h("td", {}, h("b", {}, w.term), h("div", { class: "muted" }, w.respelling)),
      h("td", {}, w.definition, w.examples[0] ? h("div", { class: "muted" }, w.examples[0].en) : null),
      h("td", { class: "muted" }, w.srs.never ? "Hidden" : w.srs.due ? "Next " + w.srs.due : "New"),
      h("td", {}, h("button", { class: "link", type: "button", onclick: async () => {
        if (!confirm(`Delete "${w.term}"?`)) return;
        await api("DELETE", "words/" + w.id);
        wordsView();
      } }, "Delete")))));
  draw("");
  show(
    h("h1", {}, `Word bank (${words.length})`),
    h("input", { class: "wide", placeholder: "Search", oninput: (e) => draw(e.target.value.trim()), style: "margin-bottom:12px" }),
    h("div", { class: "card" }, h("table", {}, body)),
  );
}

// ---- keep writing / keep speaking / improv / toastmasters ---------------
const practiceTrack = {}; // remembered track per module
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
  const open = meta.tracks.filter((t) => !t.locked);
  // Default: the highest unlocked level of a ladder, otherwise the first group.
  const levels = open.filter((t) => t.level);
  let track = open.find((t) => t.id === practiceTrack[module]) || levels[levels.length - 1] || open[0];
  practiceTrack[module] = track.id;
  let voice = module !== "write";
  const box = h("div", {});

  const trackButton = (t) => h("button", {
    type: "button", class: t.id === track.id ? "primary" : "", disabled: t.locked,
    title: t.locked ? "Unlocks after the level below" : `${t.done} / ${t.count} prompts done`,
    onclick: () => { practiceTrack[module] = t.id; practiceView(module); },
  }, (t.locked ? "🔒 " : "") + t.name);
  // One row of buttons per group ("Levels", "Small talk"); no heading when there is only one group.
  const groups = [...new Set(meta.tracks.map((t) => t.group || ""))];
  const trackButtons = groups.map((g) => h("div", { class: "row", style: "margin-bottom:8px" },
    groups.length > 1 && g ? h("b", { class: "muted", style: "min-width:6em" }, g) : null,
    meta.tracks.filter((t) => (t.group || "") === g).map(trackButton)));
  const next = track.level && meta.tracks.find((t) => t.level === track.level + 1);
  const ladderNote = next && next.locked
    ? `${Math.max(0, meta.unlock_sessions - track.good)} more good sessions on this level unlock "${next.name}"`
    : `${track.done} / ${track.count} prompts done in this group`;

  show(
    h("h1", {}, meta.name),
    trackButtons,
    h("div", { class: "muted", style: "margin-bottom:16px" }, ladderNote),
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
      prompt.say ? h("div", { class: "en", style: "font-size:20px;line-height:1.6" }, "“" + prompt.say + "”",
        h("button", { class: "link", type: "button", onclick: () => speak(prompt.say) }, "🔊")) : null,
      // For translation prompts the Chinese is the sentence to translate, so it stays visible;
      // otherwise it is only a translation of the instruction.
      prompt.task.startsWith("Translate") ? h("div", { class: "zh" }, prompt.zh)
        : prompt.zh ? chineseToggle(prompt.zh) : null,
      work));
    if (prompt.say) speak(prompt.say);
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
    const nextButton = h("button", { class: "primary", type: "button", onclick: () => practiceView(module) }, "Next");
    fill(box, 
      h("div", { class: "card" },
        s.leveled_up ? h("p", { class: "feedback" }, h("b", { class: "good" }, `Level up: L${s.leveled_up} unlocked.`)) : null,
        h("div", { class: "muted" }, facts.join(" · ")),
        f && f.score ? h("div", {}, "★".repeat(f.score) + "☆".repeat(5 - f.score)) : null,
        f ? h("p", {}, f.comment) : null,
        r.ai_error ? h("p", { class: "feedback" }, h("span", { class: "bad" }, "No AI feedback: " + r.ai_error)) : null,
        !f && !r.ai_error && text ? h("p", { class: "muted" }, "No OpenAI key, so only the stats were recorded.") : null,
        h("div", { class: "row", style: "margin-top:10px" },
          nextButton,
          h("button", { type: "button", onclick: () => loadPrompt(prompt) }, "Same prompt again"))),
      text ? h("div", { class: "card" },
        h("label", {}, mode === "speak" ? "What you said (transcribed)" : "What you wrote"), h("div", {}, text),
        f && f.natural ? [h("label", {}, "A more natural way to say it"),
          h("div", { class: "answer" }, f.natural,
            h("button", { class: "link", type: "button", onclick: () => speak(f.natural) }, "🔊"))] : null) : null,
      prompt.example ? h("div", { class: "card" },
        h("label", {}, "One natural answer"),
        h("div", { class: "answer" }, personalise(prompt.example),
          h("button", { class: "link", type: "button", onclick: () => speak(personalise(prompt.example)) }, "🔊")),
        (prompt.example.includes("{name}") && !settings.my_name)
          || (prompt.example.includes("{hometown}") && !settings.hometown)
          ? h("div", { class: "muted" }, "Add your name and hometown in Settings to see them here.") : null) : null,
      f && f.issues.length ? h("div", { class: "card" },
        h("label", {}, "What to fix first"),
        f.issues.map((i) => h("div", { class: "example" },
          h("span", { class: "bad", style: "color:var(--bad)" }, i.original), " → ",
          h("b", {}, i.better), h("span", { class: "muted" }, i.why)))) : null,
      f && f.vocab.length ? h("div", { class: "card" },
        h("label", {}, "Expressions worth saving"),
        f.vocab.map((v) => {
          const add = h("button", { class: "link", type: "button", onclick: async () => {
            const res = await api("POST", "words", { term: v.term, note: v.zh,
              examples: v.example ? [{ en: v.example, zh: "" }] : [] });
            add.disabled = true;
            add.textContent = res.duplicate ? "Already saved" : "Saved";
          } }, "+ Add to word bank");
          return h("div", { class: "example" }, h("b", {}, v.term), " " + v.zh, add,
            h("span", { class: "muted" }, v.example));
        })) : null,
    );
    nextButton.focus();
  }

  await loadPrompt();
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
  const names = { write: "Keep writing", speak: "Keep speaking", improv: "Improv", toast: "Toastmasters" };
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
  const hometown = h("input", { class: "wide", maxlength: "40", value: settings.hometown || "", placeholder: "e.g. a city or region" });
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
      my_name: myName.value, hometown: hometown.value,
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
      h("label", {}, "Your name (used in small-talk example answers)"), myName,
      h("label", {}, "Where you're from (used in small-talk example answers)"), hometown,
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
  home: homeView, cloze: clozeView, wrongbook: wrongbookView, review: reviewView,
  add: addView, words: wordsView, settings: settingsView,
  write: () => practiceView("write"), speak: () => practiceView("speak"),
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
