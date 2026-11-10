"use strict";

const POS_NAMES = {
  verb: "动词", phrasal: "动词词组", adjective: "形容词", preposition: "介词", adverb: "副词",
  noun: "名词", nounphrase: "名词词组", other: "连接词 / 委婉 / 习语 / 句式", combo: "组合（多空）",
  grammar: "语法专题",
};
const POS_ORDER = Object.keys(POS_NAMES);
const SCENE_NAMES = {
  work: "职场", tech: "IT 技术", restaurant: "餐厅饮食", sports: "体育", shopping: "购物",
  travel: "出行", health: "健康", home: "居家", social: "社交", money: "金钱", mixed: "混合",
  connector: "连接词", polite: "委婉表达", idiom: "习语俚语", pattern: "常用句式",
  past: "过去时专题", future: "将来时专题", continuous: "现在进行时专题", subjunctive: "虚拟语气专题",
  tenses: "其他常用时态专题", third: "第三人称专题", plural: "复数专题", misc: "其他语法专题",
};
const KIND_TEXT = {
  correct: "正确", grammar: "词对了，但词形/语法不对", spelling: "拼写不对",
  word: "词不对", empty: "没有填",
};

const view = document.getElementById("view");
let settings = { accent: "us", new_per_day: 20, model: "", has_key: false, tts: "browser" };
let prefill = null; // card draft handed from another page to the add page
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
  if (!response.ok) throw new Error(data.error || "请求失败");
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
        if (!response.ok) throw new Error((await response.json()).error || "语音生成失败");
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
        toast("自然语音暂时不可用，先用浏览器语音：" + e.message);
      }
    }
  }
  if (speakToken === token) browserSpeak(text, a, pace);
}

function speakButtons(text) {
  return [
    h("button", { class: "link", type: "button", title: "英式发音", onclick: () => speak(text, "uk") }, "🔊 英"),
    h("button", { class: "link", type: "button", title: "美式发音", onclick: () => speak(text, "us") }, "🔊 美"),
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
    h("h1", {}, "今天练什么"),
    h("div", { class: "grid" },
      stat(s.words.due, "个单词待复习"),
      stat(s.words.new_today_left, "个新词今天可学"),
      stat(s.cloze.due, "道填空题待重做"),
      stat(s.cloze.unseen, "道填空题还没做过"),
    ),
    h("div", { class: "card" },
      h("div", {}, `填空题库 ${s.cloze.total} 题：已通过 ${s.cloze.passed}，练习中 ${s.cloze.learning}，永不出现 ${s.cloze.never}`),
      h("div", {}, `单词本 ${s.words.total} 个：永不出现 ${s.words.never}`),
      s.has_key ? null : h("p", { class: "muted" }, "还没有设置 OpenAI key，AI 解释暂时不可用。到「设置」里填写。"),
    ),
    h("div", { class: "row" },
      h("a", { href: "#cloze" }, h("button", { class: "primary", type: "button" }, "开始填空")),
      h("a", { href: "#review" }, h("button", { type: "button" }, "背单词")),
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
  const posSelect = h("select", { "aria-label": "词类", onchange: (e) => { clozeFilters.pos = e.target.value; clozeView(); } },
    h("option", { value: "" }, "全部词类和专题"),
    posList.map(([k, n]) => h("option", { value: k, selected: clozeFilters.pos === k }, `${POS_NAMES[k] || k}（${n}）`)));
  show(
    h("h1", {}, clozeFilters.mode === "wrongbook" ? "重做错题" : "翻译填空"),
    h("div", { class: "row", style: "margin-bottom:16px" },
      posSelect,
      select("scene", clozeFilters.pos === "grammar" ? "全部专题" : "全部场景",
        Object.entries(scenes).map(([k, n]) => [k, `${SCENE_NAMES[k] || k}（${n}）`])),
      select("level", "全部难度", Object.entries(meta.levels).map(([k, n]) => [k, `L${k}（${n}）`])),
      clozeFilters.mode === "wrongbook"
        ? h("button", { type: "button", onclick: () => { clozeFilters.mode = ""; clozeView(); } }, "回到普通练习")
        : null,
    ),
    box,
  );

  async function loadQuestion() {
    const params = new URLSearchParams(Object.entries(clozeFilters).filter(([, v]) => v));
    const { question: q, redo } = await api("GET", "cloze/next?" + params);
    if (!q) {
      fill(box, h("div", { class: "card" },
        clozeFilters.mode === "wrongbook" ? "错题集是空的。" : "这个范围的题目都做完了，换一个词类、场景或难度吧。"));
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
        class: "blank", placeholder: seg.cue ? `(${seg.cue})` : seg.hint ? seg.hint + "…" : "",
        style: `width:${Math.max(6, seg.length + 3, (seg.cue || "").length + 3)}ch`,
        autocomplete: "off", autocapitalize: "off",
        spellcheck: "false", "aria-label": `第 ${seg.blank + 1} 个空`,
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
        redo ? h("span", { class: "tag redo" }, "重做") : null),
      h("div", { class: "zh" }, q.zh),
      sentence, feedback, actions);

    function answeringActions() {
      fill(actions, 
        h("button", { class: "primary", type: "submit" }, attempted ? "再试一次" : "提交"),
        h("button", { type: "button", onclick: revealAnswer }, "看答案"),
        h("button", { class: "link", type: "button", onclick: never }, "永不出现"),
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
        h("div", { class: b.kind === "correct" ? "good" : "bad" }, `第 ${i + 1} 空：${KIND_TEXT[b.kind]}`)));
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
      toast("这道题不会再出现");
      loadQuestion();
    }

    function finish(result, firstTry) {
      inputs.forEach((i) => { i.disabled = true; });
      speak(result.sentence);
      fill(feedback, 
        h("div", { class: firstTry ? "good" : "bad" },
          firstTry ? "答对了。" : "这道题会在今天再出现，之后按间隔重做。"),
        h("div", { class: "answer" }, result.sentence,
          h("button", { class: "link", type: "button", onclick: () => speak(result.sentence) }, "🔊")),
      );
      const next = h("button", { class: "primary", type: "button", onclick: loadQuestion }, "下一题");
      const guessed = h("button", { type: "button", onclick: async () => {
        await api("POST", "cloze/mark", { id: q.id, outcome: "guessed" });
        guessed.disabled = true;
        toast("已加入重做");
      } }, "其实是蒙对的");
      fill(actions, 
        next,
        firstTry ? guessed : null,
        h("button", { type: "button", onclick: () => {
          prefill = { term: result.answers[0], examples: [{ en: result.sentence, zh: result.zh }] };
          location.hash = "#add";
        } }, "加入生词"),
        h("button", { class: "link", type: "button", onclick: never }, "永不出现"),
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
    h("h1", {}, `错题集（${items.length}）`),
    items.length
      ? h("div", { class: "row", style: "margin-bottom:16px" },
          h("button", { class: "primary", type: "button", onclick: () => {
            Object.assign(clozeFilters, { pos: "", scene: "", level: "", mode: "wrongbook" });
            location.hash = "#cloze";
          } }, "全部重做一遍"))
      : h("div", { class: "card" }, "还没有错题。"),
    items.map((item) => h("div", { class: "card" },
      h("div", { class: "muted" }, item.zh, `　错 ${item.wrong} 次`),
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
  const header = h("h1", {}, "背单词");
  const info = h("div", { class: "muted", style: "margin-bottom:12px" },
    `待复习 ${counts.due}　今天还可学新词 ${counts.new_today_left}　单词本共 ${counts.total}`);
  if (!word) {
    show(header, info, h("div", { class: "card" },
      counts.total ? "今天的单词都背完了。" : "单词本还是空的，先去「添加 / 积累」加几个词。"));
    return;
  }
  const back = h("div", {});
  const actions = h("div", { class: "row", style: "margin-top:16px" });
  const rate = async (rating) => {
    await api("POST", "words/rate", { id: word.id, rating });
    reviewView();
  };
  const reveal = () => {
    const mine = h("input", { class: "wide", placeholder: "自己写一个例句，回车保存" });
    mine.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !mine.value.trim()) return;
      word.my_examples.push(mine.value.trim());
      await api("PUT", "words/" + word.id, { my_examples: word.my_examples });
      mine.value = "";
      toast("例句已保存");
    });
    fill(back, ...cardDetails(word).flat().filter(Boolean), mine);
    const forget = h("button", { class: "bad", type: "button", onclick: () => rate("forget") }, "忘记");
    fill(actions, 
      forget,
      h("button", { class: "warn", type: "button", onclick: () => rate("fuzzy") }, "模糊"),
      h("button", { class: "good", type: "button", onclick: () => rate("remember") }, "记住"),
      h("button", { class: "link", type: "button", onclick: () => rate("never") }, "永不再出现"),
    );
  };
  const showButton = h("button", { class: "primary", type: "button", onclick: reveal }, "显示答案");
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
  const sentence = h("textarea", { rows: 2, placeholder: "粘贴听到或看到的句子，残缺的也可以（可不填）" });
  const focus = field({ placeholder: "哪里不懂？单词、词组或句式（不填就是整句）" });
  const term = field({ value: draft.term || "" });
  const respelling = field({ placeholder: "例如 post-POHN" });
  const definition = field({});
  const note = h("textarea", { rows: 3 });
  const examplesBox = h("div", {});
  const notesBox = h("div", {});
  const aiStatus = h("span", { class: "muted" });

  const addExample = (ex = {}) => examplesBox.append(h("div", { class: "row example-row", style: "margin-bottom:6px" },
    h("input", { style: "flex:2", placeholder: "英文例句", value: ex.en || "" }),
    h("input", { style: "flex:1", placeholder: "中文", value: ex.zh || "" })));
  const setExamples = (list) => {
    fill(examplesBox);
    list.forEach(addExample);
    for (let i = list.length; i < 3; i++) addExample();
  };
  setExamples(draft.examples || []);

  async function explain() {
    aiStatus.textContent = "AI 正在解释…";
    try {
      const r = await api("POST", "ai/explain", { sentence: sentence.value, focus: focus.value });
      term.value = r.term;
      respelling.value = r.respelling;
      definition.value = r.definition;
      const mine = r.sentence ? [{ en: r.sentence, zh: r.sentence_zh }] : [];
      setExamples([...mine, ...r.examples]);
      fill(notesBox, 
        h("label", {}, "AI 解释（勾选的会放进备注）"),
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
      toast(r.duplicate ? "这个词已经在单词本里，新例句已合并进去" : "已加入单词本");
      addView();
    } catch (e) {
      toast(e.message);
    }
  }

  show(
    h("h1", {}, "添加 / 日常积累"),
    h("div", { class: "card" },
      h("label", {}, "原句"), sentence,
      h("label", {}, "不懂的部分"), focus,
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { type: "button", onclick: explain }, "让 AI 解释并填好卡片"), aiStatus)),
    h("div", { class: "card" },
      h("label", {}, "单词 / 词组 / 句式"), term,
      h("label", {}, "拼读注音"), respelling,
      h("label", {}, "英文释义"), definition,
      h("label", {}, "例句"), examplesBox,
      h("button", { class: "link", type: "button", onclick: () => addExample() }, "+ 加一行例句"),
      notesBox,
      h("label", {}, "备注"), note,
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { class: "primary", type: "button", onclick: save }, "保存到单词本"))),
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
      h("td", { class: "muted" }, w.srs.never ? "永不出现" : w.srs.due ? "下次 " + w.srs.due : "新词"),
      h("td", {}, h("button", { class: "link", type: "button", onclick: async () => {
        if (!confirm(`删除「${w.term}」？`)) return;
        await api("DELETE", "words/" + w.id);
        wordsView();
      } }, "删除")))));
  draw("");
  show(
    h("h1", {}, `单词本（${words.length}）`),
    h("input", { class: "wide", placeholder: "搜索", oninput: (e) => draw(e.target.value.trim()), style: "margin-bottom:12px" }),
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
  let track = open.find((t) => t.id === practiceTrack[module]) || open[open.length - 1];
  if (!meta.ladder) track = open.find((t) => t.id === practiceTrack[module]) || open[0];
  practiceTrack[module] = track.id;
  let voice = module !== "write";
  const box = h("div", {});

  const trackButtons = meta.tracks.map((t) => h("button", {
    type: "button", class: t.id === track.id ? "primary" : "", disabled: t.locked,
    title: t.locked ? "完成上一级后解锁" : `做过 ${t.done} / ${t.count} 题`,
    onclick: () => { practiceTrack[module] = t.id; practiceView(module); },
  }, (t.locked ? "🔒 " : "") + t.name));
  const next = meta.tracks[meta.tracks.indexOf(track) + 1];
  const ladderNote = meta.ladder && next && next.locked
    ? `本级再完成 ${Math.max(0, meta.unlock_sessions - track.good)} 次合格练习，解锁「${next.name}」`
    : `本组做过 ${track.done} / ${track.count} 题`;

  show(
    h("h1", {}, meta.name),
    h("div", { class: "row", style: "margin-bottom:8px" }, trackButtons),
    h("div", { class: "muted", style: "margin-bottom:16px" }, ladderNote),
    box,
  );

  async function loadPrompt(same) {
    const prompt = same || (await api("GET", `practice/next?module=${module}&track=${track.id}`)).prompt;
    if (!prompt) {
      fill(box, h("div", { class: "card" }, "这一组还没有题目。"));
      return;
    }
    const work = h("div", {});
    fill(box, h("div", { class: "card" },
      h("div", { class: "answer" }, prompt.task),
      prompt.say ? h("div", { class: "en", style: "font-size:20px;line-height:1.6" }, "“" + prompt.say + "”",
        h("button", { class: "link", type: "button", onclick: () => speak(prompt.say) }, "🔊")) : null,
      h("div", { class: "muted" }, prompt.zh),
      work));
    if (prompt.say) speak(prompt.say);
    if (voice) voiceInput(prompt, work); else textInput(prompt, work);
  }

  function textInput(prompt, work) {
    let startedAt = null;
    const area = h("textarea", { rows: 8, placeholder: "直接写英文。不会的词可以先写中文，反馈时会告诉你怎么说。" });
    const counter = h("span", { class: "muted" }, "0 词");
    const timer = setInterval(() => {
      if (!area.isConnected) return clearInterval(timer);
      const words = (area.value.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
      counter.textContent = `${words} 词　${startedAt ? clock((Date.now() - startedAt) / 1000) : "0:00"}`;
    }, 500);
    area.addEventListener("input", () => { startedAt = startedAt || Date.now(); });
    const send = () => {
      if (!area.value.trim()) return toast("先写点什么");
      submit(prompt, area.value, startedAt ? (Date.now() - startedAt) / 1000 : 0, "write", 0);
    };
    area.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); });
    fill(work, 
      h("div", { style: "margin-top:12px" }, area),
      h("div", { class: "row", style: "margin-top:10px" },
        h("button", { class: "primary", type: "button", onclick: send }, "提交（⌘ + Enter）"),
        h("button", { class: "link", type: "button", onclick: () => loadPrompt() }, "换一题"),
        module !== "write" ? h("button", { class: "link", type: "button", onclick: () => { voice = true; loadPrompt(prompt); } }, "改用说的") : null,
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

    const startButton = h("button", { class: "primary", type: "button", onclick: start }, "开始说");
    const controls = h("div", { class: "row", style: "margin-top:12px" },
      startButton,
      h("button", { class: "link", type: "button", onclick: () => loadPrompt() }, "换一题"),
      h("button", { class: "link", type: "button", onclick: () => { voice = false; loadPrompt(prompt); } }, "改用打字"),
      status);
    fill(work, controls);
    if (!settings.has_key) status.textContent = "没有设置 OpenAI key：只会记录说话时长，没有文字和反馈。";
    startButton.focus();

    async function start() {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        status.textContent = "无法使用麦克风：" + e.message;
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
          const [text, color] = s >= red ? ["红灯：该收尾了", "var(--bad)"]
            : s >= yellow ? ["黄灯", "var(--warn)"] : s >= green ? ["绿灯：时间够了", "var(--good)"] : ["", ""];
          light.textContent = text;
          light.style.color = light.style.borderColor = color;
          light.style.visibility = text ? "visible" : "hidden";
        }
      }, 250);
      light.style.visibility = "hidden";
      const stuckButton = h("button", { class: "warn", type: "button", onclick: () => {
        stuck += 1;
        stuckButton.textContent = `卡壳了（${stuck}）`;
      } }, "卡壳了（0）");
      const stop = h("button", { class: "primary", type: "button", onclick: () => recorder && recorder.stop() }, "说完了");
      fill(work, 
        h("div", { class: "row", style: "margin-top:12px" }, time, light),
        h("div", { class: "muted" }, "别停。想不起来的词直接说中文，或者点「卡壳了」，然后接着说。"),
        h("div", { class: "row", style: "margin-top:10px" }, stop, stuckButton));
      stop.focus();
    }

    async function finish(blob, seconds) {
      if (!settings.has_key) return submit(prompt, "", seconds, "speak", stuck);
      fill(work, h("div", { class: "muted", style: "margin-top:12px" }, "正在把录音转成文字…"));
      try {
        const { text } = await api("POST", "practice/transcribe", { audio_b64: await blobToBase64(blob), mime: blob.type });
        submit(prompt, text, seconds, "speak", stuck);
      } catch (e) {
        fill(work, 
          h("p", { class: "feedback" }, h("span", { class: "bad" }, "转文字失败：" + e.message)),
          h("div", { class: "row" },
            h("button", { type: "button", onclick: () => finish(blob, seconds) }, "重试"),
            h("button", { type: "button", onclick: () => submit(prompt, "", seconds, "speak", stuck) }, "只记录时长")));
      }
    }
  }

  async function submit(prompt, text, seconds, mode, stuck) {
    fill(box, h("div", { class: "card muted" }, "正在看你的内容…"));
    let r;
    try {
      r = await api("POST", "practice/submit", { prompt_id: prompt.id, text, seconds, mode, stuck });
    } catch (e) {
      fill(box, h("div", { class: "card" }, "提交失败：" + e.message,
        h("pre", {}, text),
        h("button", { type: "button", onclick: () => submit(prompt, text, seconds, mode, stuck) }, "重试")));
      return;
    }
    const s = r.session;
    const f = r.feedback;
    const facts = [`${s.words} 词`, clock(s.seconds)];
    if (s.seconds >= 30 && s.words) facts.push(`${Math.round(s.words / (s.seconds / 60))} 词/分钟`);
    if (mode === "speak") facts.push(`卡壳 ${s.stuck} 次`, `口头禅 ${s.fillers} 次`);
    facts.push(`+${s.xp} 经验`, `总等级 ${r.rank.level}`);
    const nextButton = h("button", { class: "primary", type: "button", onclick: () => practiceView(module) }, "下一题");
    fill(box, 
      h("div", { class: "card" },
        s.leveled_up ? h("p", { class: "feedback" }, h("b", { class: "good" }, `升级了，解锁 L${s.leveled_up}。`)) : null,
        h("div", { class: "muted" }, facts.join("　")),
        f && f.score ? h("div", {}, "★".repeat(f.score) + "☆".repeat(5 - f.score)) : null,
        f ? h("p", {}, f.comment) : null,
        r.ai_error ? h("p", { class: "feedback" }, h("span", { class: "bad" }, "没有拿到 AI 反馈：" + r.ai_error)) : null,
        !f && !r.ai_error && text ? h("p", { class: "muted" }, "没有设置 OpenAI key，所以只做了统计。") : null,
        h("div", { class: "row", style: "margin-top:10px" },
          nextButton,
          h("button", { type: "button", onclick: () => loadPrompt(prompt) }, "同一题再来一遍"))),
      text ? h("div", { class: "card" },
        h("label", {}, mode === "speak" ? "你说的（自动转写）" : "你写的"), h("div", {}, text),
        f && f.natural ? [h("label", {}, "更自然的说法"),
          h("div", { class: "answer" }, f.natural,
            h("button", { class: "link", type: "button", onclick: () => speak(f.natural) }, "🔊"))] : null) : null,
      f && f.issues.length ? h("div", { class: "card" },
        h("label", {}, "最值得改的地方"),
        f.issues.map((i) => h("div", { class: "example" },
          h("span", { class: "bad", style: "color:var(--bad)" }, i.original), " → ",
          h("b", {}, i.better), h("span", { class: "muted" }, i.why)))) : null,
      f && f.vocab.length ? h("div", { class: "card" },
        h("label", {}, "可以收进生词本的表达"),
        f.vocab.map((v) => {
          const add = h("button", { class: "link", type: "button", onclick: async () => {
            const res = await api("POST", "words", { term: v.term, note: v.zh,
              examples: v.example ? [{ en: v.example, zh: "" }] : [] });
            add.disabled = true;
            add.textContent = res.duplicate ? "已在生词本" : "已加入";
          } }, "+ 加入生词");
          return h("div", { class: "example" }, h("b", {}, v.term), "　" + v.zh, add,
            h("span", { class: "muted" }, v.example));
        })) : null,
    );
    nextButton.focus();
  }

  await loadPrompt();
}

async function statsView() {
  const s = await api("GET", "practice/stats");
  const w = s.modules.write;
  const sp = s.modules.spoken;
  const dash = (v, unit = "") => (v === null || v === undefined ? "—" : v + unit);
  const row = (label, ...cells) => h("tr", {}, h("td", { class: "muted" }, label), cells.map((c) => h("td", {}, String(c))));
  const names = { write: "一直写", speak: "一直说", improv: "Improv", toast: "Toastmasters" };
  show(
    h("h1", {}, "统计"),
    h("div", { class: "grid" },
      h("div", { class: "card stat" }, h("b", {}, String(s.rank.level)), `总等级（${s.rank.xp} / ${s.rank.next_at} 经验）`),
      h("div", { class: "card stat" }, h("b", {}, String(s.streak)), "天连续练习"),
      h("div", { class: "card stat" }, h("b", {}, "L" + s.levels.write), "一直写 已解锁"),
      h("div", { class: "card stat" }, h("b", {}, "L" + s.levels.speak), "一直说 已解锁")),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "写"), h("th", {}, "今天"), h("th", {}, "近 7 天"), h("th", {}, "前 7 天"), h("th", {}, "累计"))),
      h("tbody", {},
        row("词数", w.today.words, w.this_week.words, w.last_week.words, w.all.words),
        row("时长（分钟）", w.today.minutes, w.this_week.minutes, w.last_week.minutes, w.all.minutes),
        row("打字速度（词/分钟）", dash(w.today.wpm), dash(w.this_week.wpm), dash(w.last_week.wpm), dash(w.all.wpm)),
        row("每 100 词的问题数", dash(w.today.issues_per_100), dash(w.this_week.issues_per_100), dash(w.last_week.issues_per_100), dash(w.all.issues_per_100)),
        row("平均得分", dash(w.today.avg_score), dash(w.this_week.avg_score), dash(w.last_week.avg_score), dash(w.all.avg_score)),
        row("用过的不同单词", "", "", "", w.unique_words),
        row("单次最多词数", "", "", "", w.all.most_words)))),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "说（含 Improv、Toastmasters）"), h("th", {}, "今天"), h("th", {}, "近 7 天"), h("th", {}, "前 7 天"), h("th", {}, "累计"))),
      h("tbody", {},
        row("开口时长（分钟）", sp.today.minutes, sp.this_week.minutes, sp.last_week.minutes, sp.all.minutes),
        row("说出的词数", sp.today.words, sp.this_week.words, sp.last_week.words, sp.all.words),
        row("语速（词/分钟）", dash(sp.today.wpm), dash(sp.this_week.wpm), dash(sp.last_week.wpm), dash(sp.all.wpm)),
        row("卡壳次数", sp.today.stuck, sp.this_week.stuck, sp.last_week.stuck, sp.all.stuck),
        row("口头禅次数", sp.today.fillers, sp.this_week.fillers, sp.last_week.fillers, sp.all.fillers),
        row("每 100 词的问题数", dash(sp.today.issues_per_100), dash(sp.this_week.issues_per_100), dash(sp.last_week.issues_per_100), dash(sp.all.issues_per_100)),
        row("用过的不同单词", "", "", "", sp.unique_words),
        row("单次最长（分钟）", "", "", "", (sp.all.longest_seconds / 60).toFixed(1))))),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "模块"), h("th", {}, "练习次数"), h("th", {}, "词数"), h("th", {}, "分钟"))),
      h("tbody", {}, Object.entries(s.by_module).map(([m, v]) => row(names[m] || m, v.sessions, v.words, v.minutes))))),
    h("div", { class: "card" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "最近 14 天"), h("th", {}, "写（词）"), h("th", {}, "说（分钟）"), h("th", {}, "经验"))),
      h("tbody", {}, [...s.days].reverse().map((d) => row(d.date, d.write_words, d.spoken_minutes, d.xp))))),
  );
}

// ---- settings / sync --------------------------------------------------
async function settingsView() {
  settings = await api("GET", "settings");
  const key = h("input", { class: "wide", type: "password", autocomplete: "off",
    placeholder: settings.has_key ? "已设置（留空表示不修改）" : "sk-…" });
  const model = h("input", { class: "wide", value: settings.model });
  const accent = h("select", {},
    h("option", { value: "us", selected: settings.accent === "us" }, "美式"),
    h("option", { value: "uk", selected: settings.accent === "uk" }, "英式"));
  const perDay = h("input", { type: "number", min: "0", max: "500", value: String(settings.new_per_day) });
  const option = (value, text, current) => h("option", { value, selected: value === current }, text);
  const engine = h("select", {},
    option("openai", "OpenAI 自然语音（需要 key，每句只生成一次）", settings.tts),
    option("browser", "浏览器自带语音（免费，较生硬）", settings.tts));
  const voice = h("select", {}, settings.voices.map((v) =>
    option(v, v === "marin" || v === "cedar" ? `${v}（推荐）` : v, settings.voice)));
  const pace = h("select", {}, option("normal", "正常", settings.pace), option("slow", "稍慢", settings.pace));
  const ttsModel = h("select", {},
    option("gpt-4o-mini-tts", "gpt-4o-mini-tts（便宜；2027-01-06 停用后自动改用下一个）", settings.tts_model),
    option("gpt-audio-1.5", "gpt-audio-1.5（贵约 5 倍，没有停用日期）", settings.tts_model));
  const preview = () => speak("Hey, sorry I'm running a bit late. Can we push the meeting back ten minutes?",
    accent.value, { tts: engine.value, voice: voice.value, pace: pace.value });
  const save = async () => {
    const body = { accent: accent.value, model: model.value, new_per_day: perDay.value,
      tts: engine.value, voice: voice.value, pace: pace.value, tts_model: ttsModel.value };
    if (key.value.trim()) body.openai_key = key.value.trim();
    try {
      settings = await api("PUT", "settings", body);
      toast("已保存");
      settingsView();
    } catch (e) {
      toast(e.message);
    }
  };
  show(
    h("h1", {}, "设置"),
    h("div", { class: "card" },
      h("label", {}, "OpenAI key（只保存在本机的 config.local.json，不会被同步上传）"), key,
      h("label", {}, "AI 模型"), model,
      h("label", {}, "每天新词上限"), perDay,
      h("div", { class: "row", style: "margin-top:16px" },
        h("button", { class: "primary", type: "button", onclick: save }, "保存"))),
    h("div", { class: "card" },
      h("label", {}, "朗读语音"), engine,
      h("label", {}, "口音"), accent,
      h("label", {}, "声音"), voice,
      h("label", {}, "语速"), pace,
      h("label", {}, "语音模型"), ttsModel,
      h("p", { class: "muted" }, "自然语音：每句第一次播放时生成（约 1 秒），之后从本机缓存播放，不再花钱。没有 key 或生成失败时自动改用浏览器语音。"),
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { type: "button", onclick: preview }, "试听当前选择"),
        h("button", { class: "primary", type: "button", onclick: save }, "保存"))),
  );
}

document.getElementById("sync").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = "同步中…";
  try {
    const r = await api("POST", "sync", {});
    toast(r.message);
    if (!r.ok) {
      show(h("h1", {}, "同步没有完成"), h("div", { class: "card" }, h("p", {}, r.message),
        h("pre", {}, r.steps.map((s) => `$ ${s.cmd}\n${s.output}`).join("\n\n"))));
    }
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "同步";
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
    show(h("div", { class: "card" }, "出错了：" + e.message));
  }
}

window.addEventListener("unhandledrejection", (e) => toast("出错了：" + (e.reason?.message || e.reason)));
window.addEventListener("hashchange", render);
api("GET", "settings").then((s) => { settings = s; }).catch(() => {}).finally(render);
