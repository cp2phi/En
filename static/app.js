"use strict";

const POS_NAMES = { verb: "动词", combo: "组合（多空）" };
const SCENE_NAMES = {
  work: "职场", tech: "IT 技术", restaurant: "餐厅饮食", sports: "体育", shopping: "购物",
  travel: "出行", health: "健康", home: "居家", social: "社交", money: "金钱", mixed: "混合",
};
const KIND_TEXT = {
  correct: "正确", grammar: "词对了，但词形/语法不对", spelling: "拼写不对",
  word: "词不对", empty: "没有填",
};

const view = document.getElementById("view");
let settings = { accent: "us", new_per_day: 20, model: "", has_key: false };
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

function speak(text, accent) {
  if (!("speechSynthesis" in window)) return;
  const lang = (accent || settings.accent) === "uk" ? "en-GB" : "en-US";
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-") === lang);
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function speakButtons(text) {
  return [
    h("button", { class: "link", type: "button", title: "英式发音", onclick: () => speak(text, "uk") }, "🔊 英"),
    h("button", { class: "link", type: "button", title: "美式发音", onclick: () => speak(text, "us") }, "🔊 美"),
  ];
}

function show(...nodes) {
  view.replaceChildren(...nodes);
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
  show(
    h("h1", {}, clozeFilters.mode === "wrongbook" ? "重做错题" : "翻译填空"),
    h("div", { class: "row", style: "margin-bottom:16px" },
      select("pos", "全部词类", Object.entries(meta.pos).map(([k, n]) => [k, `${POS_NAMES[k] || k}（${n}）`])),
      select("scene", "全部场景", Object.entries(meta.scenes).map(([k, n]) => [k, `${SCENE_NAMES[k] || k}（${n}）`])),
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
      box.replaceChildren(h("div", { class: "card" },
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
        class: "blank", placeholder: seg.hint + "…", autocomplete: "off", autocapitalize: "off",
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
      actions.replaceChildren(
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
      feedback.replaceChildren(...result.blanks.map((b, i) =>
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
      feedback.replaceChildren(
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
      actions.replaceChildren(
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
    box.replaceChildren(form);
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
    back.replaceChildren(...cardDetails(word).flat().filter(Boolean), mine);
    const forget = h("button", { class: "bad", type: "button", onclick: () => rate("forget") }, "忘记");
    actions.replaceChildren(
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
    examplesBox.replaceChildren();
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
      notesBox.replaceChildren(
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
  const draw = (filter) => body.replaceChildren(...words
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
  const save = async () => {
    const body = { accent: accent.value, model: model.value, new_per_day: perDay.value };
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
      h("label", {}, "朗读口音"), accent,
      h("label", {}, "每天新词上限"), perDay,
      h("div", { class: "row", style: "margin-top:16px" },
        h("button", { class: "primary", type: "button", onclick: save }, "保存"),
        h("button", { type: "button", onclick: () => speak("The meeting has been postponed to Friday.", accent.value) }, "试听"))),
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
};

async function render() {
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
