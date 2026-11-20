"""OpenAI calls (stdlib only): explanations, feedback, transcription and speech."""

import base64
import json
import urllib.error
import urllib.request

API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4o-mini"

SYSTEM_PROMPT = """You help a Chinese-speaking adult learn practical English.
The learner gives an English word, phrase or sentence pattern they do not understand,
usually with the sentence where they met it. Reply with one JSON object and nothing else:
{
  "term": the dictionary form of the word/phrase/pattern to learn (lowercase),
  "respelling": pronunciation respelling with the stressed syllable in capitals, e.g. "post-POHN",
  "definition": one short, simple English definition matching the meaning in the sentence,
  "sentence_zh": Chinese translation of the learner's sentence ("" if none was given),
  "notes": 2 to 4 short Chinese notes, each one separate point (meaning here, tone/register,
           origin of the idiom, common pattern). Skip anything obvious. No filler.,
  "examples": exactly 3 objects {"en": natural everyday example, "zh": Chinese translation}
}"""


class AIError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status  # HTTP status from OpenAI, None for network or parse errors


def _request(url: str, body: bytes, content_type: str, api_key: str, timeout: float) -> bytes:
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": content_type, "Authorization": f"Bearer {api_key}"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            pass
        raise AIError(f"OpenAI API error {e.code}: {detail}", e.code) from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise AIError(f"Cannot reach OpenAI: {e}") from e


def _post(payload: dict, api_key: str, timeout: float = 60) -> dict:
    raw = _request(API_URL, json.dumps(payload).encode("utf-8"), "application/json", api_key, timeout)
    return json.loads(raw.decode("utf-8"))


def explain(focus: str, sentence: str, api_key: str, model: str = DEFAULT_MODEL, post=_post) -> dict:
    """Explain `focus` (the part the learner does not understand) in `sentence`."""
    if not api_key:
        raise AIError("No OpenAI key yet. Add it in Settings.")
    focus, sentence = focus.strip(), sentence.strip()
    if not focus and not sentence:
        raise AIError("Enter a sentence or a word.")
    user = f"Sentence: {sentence or '(none)'}\nWhat I do not understand: {focus or sentence}"
    body = post(
        {
            "model": model or DEFAULT_MODEL,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
        },
        api_key,
    )
    try:
        data = json.loads(body["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise AIError("Could not read the AI reply. Please try again.") from e
    if not isinstance(data, dict):
        raise AIError("Could not read the AI reply. Please try again.")
    examples = [
        {"en": str(ex.get("en", "")), "zh": str(ex.get("zh", ""))}
        for ex in data.get("examples") or []
        if isinstance(ex, dict) and ex.get("en")
    ]
    return {
        "term": str(data.get("term") or focus or sentence).strip().lower(),
        "respelling": str(data.get("respelling") or ""),
        "definition": str(data.get("definition") or ""),
        "sentence": sentence,
        "sentence_zh": str(data.get("sentence_zh") or ""),
        "notes": [str(n) for n in data.get("notes") or [] if n],
        "examples": examples[:3],
    }


# ---- feedback on writing and speaking ---------------------------------

FEEDBACK_PROMPT = """You coach a Chinese-speaking adult who practises English {kind}.
They want to keep producing English and get short, useful feedback - not a lecture.
You get the task and what the learner {verb}. Reply with one JSON object and nothing else:
{{
  "natural": the learner's own message rewritten the way a fluent speaker would naturally {say} it.
             Keep their meaning, their ideas and roughly their length. Simple words.,
  "issues": at most 3 objects {{"original": exact fragment from the learner, "better": the fix,
            "why": one short sentence in Chinese}}. Only things that would confuse a listener or
            sound clearly unnatural. Ignore small slips.{speech_note} Empty list if none.,
  "vocab": at most 5 objects {{"term": English word or phrase worth learning, "zh": Chinese meaning,
           "example": a short example sentence}}. First give the English for anything the learner
           wrote in Chinese because they did not know the word; then useful natural expressions
           from your rewrite that the learner did not use.,
  "score": integer 1-5. 5 = clear, natural, does the task. 3 = understandable with effort.
           1 = mostly not understandable or off task.,
  "comment": one or two sentences in Chinese: name one specific thing they did well and one
             specific thing to try next time.{focus}
}}"""

SPEECH_NOTE = (" This is an automatic transcript of speech: ignore punctuation, capitals,"
               " repeated words and likely transcription mistakes.")

MODULE_FOCUS = {
    "improv": " This is improv practice: say whether they accepted the offer and added something"
              " new, and whether they answered quickly and simply. Never criticise silliness.",
    "toast": " This is Toastmasters practice: comment on structure (opening, points, closing).",
    "smalltalk": " This is small-talk practice: a quick spoken reply in a casual conversation."
                 " Judge whether it sounds natural, warm and relaxed (not formal or textbook), whether"
                 " it fits the situation, and whether it keeps the conversation going (adds a detail,"
                 " asks something back, or closes politely when that is the task). In \"natural\","
                 " give what a friendly New Zealander would actually say, short. In \"vocab\", prefer"
                 " ready-to-use small-talk phrases.",
    "data": " This is practice for presenting data analysis at work. Check that every number is said"
            " correctly and matches the task: percent vs percentage points, increase by vs increase to,"
            " month-on-month vs year-on-year, the right trend verb (rise, dip, plateau, peak) and how"
            " big the change is (slight, sharp). Judge whether a listener in a meeting would get the"
            " main point quickly: lead with the takeaway, then the numbers. In \"natural\", give what a"
            " confident analyst in a New Zealand office would say. In \"vocab\", prefer reusable"
            " phrases for describing data.",
    "intro": " This is practice for introducing yourself professionally (client meetings, kick-offs,"
             " new teams). Judge whether it is clear, confident and the right length for the situation:"
             " name, role, what they do or will do for the listener, and a friendly close or hand-over."
             " Flag anything too long, too modest, too formal or too vague (\"I do IT stuff\")."
             " In \"natural\", give what a confident, friendly professional in New Zealand would say."
             " In \"vocab\", prefer reusable self-introduction phrases.",
    "meeting": " This is practice for the language of meetings: joining in, interrupting politely, clarifying,"
               " pushing back, saying you don't know and will follow up, agreeing next steps, online-meeting"
               " moments. Judge whether the reply does that job clearly in one go, at the right level of"
               " directness for a New Zealand workplace (not blunt, not over-apologetic), and is short enough to"
               " say in a live meeting. In \"natural\", give what a confident NZ colleague would say. In"
               " \"vocab\", prefer ready-to-use meeting phrases.",
    "workwriting": " This is practice for everyday work writing: Teams messages, status updates, risk and issue"
                   " reports, meeting notes, work emails. Judge whether the main point (the ask, the status or"
                   " the decision needed) comes first, whether every fact from the task (dates, numbers, owners)"
                   " is there and correct, whether length and tone fit the reader (manager, client, peer), and"
                   " whether it is plain and easy to scan. In \"natural\", give a clear, friendly, professional"
                   " New Zealand version, keeping line breaks and bullets where they help. In \"vocab\", prefer"
                   " reusable work-writing phrases.",
    "showcase": " This is practice for presenting a technical project to colleagues who know nothing about it."
                " Judge clarity for a non-expert: the point of each part first, one idea per sentence, jargon"
                " explained or avoided, signposting (first, next, so what this means is), a concrete example."
                " If reference notes are given, say in \"comment\" which key point was missed and flag any"
                " statement that contradicts them. In \"natural\", give a clear, confident spoken version a"
                " New Zealand audience would enjoy listening to. In \"vocab\", prefer reusable presenting"
                " phrases.",
}


def _chat_json(system: str, user: str, api_key: str, model: str, post) -> dict:
    if not api_key:
        raise AIError("No OpenAI key yet. Add it in Settings.")
    body = post(
        {
            "model": model or DEFAULT_MODEL,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        },
        api_key,
    )
    try:
        data = json.loads(body["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise AIError("Could not read the AI reply. Please try again.") from e
    if not isinstance(data, dict):
        raise AIError("Could not read the AI reply. Please try again.")
    return data


def _dicts(value, keys: tuple[str, ...], limit: int) -> list[dict]:
    out = []
    for item in value if isinstance(value, list) else []:
        if isinstance(item, dict) and item.get(keys[0]):
            out.append({k: str(item.get(k) or "") for k in keys})
    return out[:limit]


def feedback(module: str, task: str, text: str, mode: str, api_key: str,
             model: str = DEFAULT_MODEL, post=_post) -> dict:
    """Feedback on one piece of writing (mode "write") or one speech transcript (mode "speak")."""
    spoken = mode == "speak"
    system = FEEDBACK_PROMPT.format(
        kind="speaking" if spoken else "writing",
        verb="said (transcribed)" if spoken else "wrote",
        say="say" if spoken else "write",
        speech_note=SPEECH_NOTE if spoken else "",
        focus=MODULE_FOCUS.get(module, ""),
    )
    data = _chat_json(system, f"Task: {task}\n\nLearner:\n{text}", api_key, model, post)
    try:
        score = max(1, min(5, int(data.get("score"))))
    except (TypeError, ValueError):
        score = None
    return {
        "natural": str(data.get("natural") or ""),
        "issues": _dicts(data.get("issues"), ("original", "better", "why"), 3),
        "vocab": _dicts(data.get("vocab"), ("term", "zh", "example"), 5),
        "score": score,
        "comment": str(data.get("comment") or ""),
    }


# ---- conversation (role-play with follow-up questions) -------------------

TALK_PROMPT = """You are role-playing one person in a spoken workplace conversation with a Chinese-speaking
adult who is practising English. Stay in character the whole time.

Who you are: {role}
The situation: {setting}
What the learner has to do: {task}{brief}{name}

How to talk:
- Like a real New Zealand colleague: natural, spoken, short. One to three sentences, at most 45 words.
- React to what they actually said in a few words, then ask ONE follow-up question that digs into it:
  a specific (a date, a number, an example, what exactly), why or how, what happens if it goes wrong,
  or what a term they used means. If an answer was vague, press for something concrete. Now and then,
  politely challenge or disagree.
- One question at a time. No lectures, no summaries, no praise for every answer.
- Never correct their English and never mention that this is practice.
- If they say they don't know or will get back to you, accept it briefly and move on to something else.
- Never invent facts about the learner's own work; ask about it instead.
Reply with one JSON object and nothing else: {{"line": "what you say"}}"""

TALK_HINT_PROMPT = """A Chinese-speaking adult practising English is stuck in a spoken workplace conversation and
needs a nudge to answer the other person's last line. Situation: {setting}
What the learner has to do: {task}{brief}
Reply with one JSON object and nothing else:
{{"starter": one natural first sentence they could begin their answer with (at most 20 words),
  "points": 2 or 3 very short English notes on what to cover next (a few words each),
  "zh": one short Chinese line on how to approach the answer, e.g. 先直接回答，再给一个具体例子}}
Use only facts the learner has already said or that appear in the background. Never decide a fact for
them (whether something is on track, a date, a number, a cause): write a slot instead, e.g.
"We've used about [x]% of the budget so far, and the main risk is [risk]." """

TALK_FEEDBACK_PROMPT = """You coach a Chinese-speaking adult who just practised a spoken workplace conversation in
English: the other person kept asking follow-up questions. The learner's lines are automatic speech
transcripts: ignore punctuation, capitals, repeated words and likely transcription mistakes.
Situation: {setting}
What the learner had to do: {task}{brief}
Reply with one JSON object and nothing else:
{{
  "score": integer 1-5. 5 = answered every question clearly and directly, with specifics, in natural
           English. 3 = got the point across with effort. 1 = mostly unclear or off the point.,
  "comment": two or three sentences in Chinese: one specific thing they did well, one specific thing to
             do differently next time.{facts}
  "handling": one or two sentences in Chinese on HOW they handled the follow-up questions: did they
              answer the question first, give specifics (numbers, dates, examples), deal with not knowing
              gracefully, keep a good length, ask to clarify when needed.,
  "turns": one object per learner line, in order: {{"you": the learner's line (shorten with … if
           long), "better": how a confident, friendly New Zealand professional would say the same thing,
           keeping their meaning and facts, the same length or shorter}},
  "issues": at most 3 objects {{"original": exact fragment from the learner, "better": the fix, "why":
            one short sentence in Chinese}}. Only things that would confuse a listener or sound clearly
            unnatural.,
  "vocab": at most 5 objects {{"term": a reusable English phrase for this kind of conversation (answering
           follow-ups, buying time, clarifying, pushing back, explaining), "zh": Chinese meaning,
           "example": a short example sentence}} that the learner did not use.
}}"""


def _transcript(history: list[dict]) -> str:
    return "\n".join(("Learner: " if m["who"] == "me" else "Other person: ") + m["text"] for m in history)


def _talk_fields(scenario: dict) -> dict:
    brief = scenario.get("brief") or ""
    return {"role": scenario.get("role") or "A colleague.", "setting": scenario.get("setting") or "",
            "task": scenario.get("task") or "",
            "brief": f"\nBackground facts (true; the learner knows them):\n{brief}" if brief else ""}


def talk_reply(scenario: dict, history: list[dict], turns_left: int, learner_name: str,
               api_key: str, model: str = DEFAULT_MODEL, post=_post) -> str:
    """The other person's next line. `turns_left`: learner answers still to come after this line."""
    name = f"\nThe learner's name is {learner_name}." if learner_name else ""
    system = TALK_PROMPT.format(**_talk_fields(scenario), name=name)
    if not history:
        cue = "Open the conversation with your first line."
    elif turns_left <= 0:
        cue = ("This is your last line: respond briefly and close the conversation naturally (thank them,"
               " mention a next step if it fits). Do not ask a question.")
    else:
        cue = f"Your next line. The learner will answer {turns_left} more time(s) after it."
    data = _chat_json(system, f"Conversation so far:\n{_transcript(history) or '(nothing yet)'}\n\n{cue}",
                      api_key, model, post)
    line = " ".join(str(data.get("line") or "").split())
    if not line:
        raise AIError("Could not read the AI reply. Please try again.")
    return line


def talk_hint(scenario: dict, history: list[dict], api_key: str, model: str = DEFAULT_MODEL,
              post=_post) -> dict:
    fields = _talk_fields(scenario)
    system = TALK_HINT_PROMPT.format(setting=fields["setting"], task=fields["task"], brief=fields["brief"])
    data = _chat_json(system, f"Conversation so far:\n{_transcript(history)}", api_key, model, post)
    points = data.get("points") if isinstance(data.get("points"), list) else []
    return {"starter": str(data.get("starter") or ""), "points": [str(p) for p in points][:3],
            "zh": str(data.get("zh") or "")}


def talk_feedback(scenario: dict, history: list[dict], api_key: str, model: str = DEFAULT_MODEL,
                  post=_post) -> dict:
    fields = _talk_fields(scenario)
    facts = (" If the learner said something that contradicts the background facts, add one more"
             " Chinese sentence naming it." if fields["brief"] else "")
    system = TALK_FEEDBACK_PROMPT.format(setting=fields["setting"], task=fields["task"],
                                         brief=fields["brief"], facts=facts)
    data = _chat_json(system, f"Conversation:\n{_transcript(history)}", api_key, model, post)
    try:
        score = max(1, min(5, int(data.get("score"))))
    except (TypeError, ValueError):
        score = None
    return {
        "score": score,
        "comment": str(data.get("comment") or ""),
        "handling": str(data.get("handling") or ""),
        "turns": _dicts(data.get("turns"), ("you", "better"), 10),
        "issues": _dicts(data.get("issues"), ("original", "better", "why"), 3),
        "vocab": _dicts(data.get("vocab"), ("term", "zh", "example"), 5),
    }


# ---- sentence translation ----------------------------------------------

TRANSLATE_PROMPT = """You check one sentence a Chinese-speaking adult translated from Chinese into English.
You get the Chinese, a reference translation and the learner's English. The reference is only one
of many good answers: accept any translation a fluent New Zealander would find correct and natural.
Never count spelling variants (US/UK), contractions, punctuation or capitals. The learner may write
Chinese for a word they did not know: that is an issue, give the English.
Be brief. Reply with one JSON object and nothing else:
{
  "verdict": "good" if the meaning is right, the grammar is right and it sounds natural (a tiny slip
             is still good); "fix" if the meaning is mostly right but something is wrong or clearly
             unnatural; "wrong" if the meaning is wrong, a key part is missing, or it is hard to follow,
  "issues": at most 3 objects {"original": the exact fragment from the learner, "better": the fix,
            "why": 中文, 最多 20 个字, 说清楚是什么问题}. Most important first. [] when verdict is good,
  "fixed": the learner's sentence with only those issues fixed, keeping their own words otherwise.
           "" when verdict is good
}"""


def grade_translation(zh: str, reference: str, answer: str, api_key: str,
                      model: str = DEFAULT_MODEL, post=_post) -> dict:
    """{"verdict": good | fix | wrong, "issues": [...], "fixed": str}."""
    user = f"Chinese: {zh}\nReference: {reference}\nLearner: {answer.strip()}"
    data = _chat_json(TRANSLATE_PROMPT, user, api_key, model, post)
    verdict = data.get("verdict") if data.get("verdict") in ("good", "fix", "wrong") else "fix"
    issues = _dicts(data.get("issues"), ("original", "better", "why"), 3)
    return {"verdict": verdict, "issues": [] if verdict == "good" else issues,
            "fixed": "" if verdict == "good" else str(data.get("fixed") or "")}


# ---- speech to text ----------------------------------------------------

TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions"
TRANSCRIBE_MODEL = "whisper-1"
# Nudges the model to keep hesitations and Chinese words instead of cleaning them up.
TRANSCRIBE_HINT = "Um, uh, so... I mean, er, 这个怎么说, you know."
AUDIO_EXTENSIONS = {"webm": "webm", "mp4": "mp4", "mpeg": "mp3", "ogg": "ogg", "wav": "wav", "m4a": "m4a"}


def _multipart(fields: dict[str, str], filename: str, mime: str, audio: bytes) -> tuple[bytes, str]:
    boundary = "----englishpractice7f3a9c1e"
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode() + audio + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _post_audio(body: bytes, content_type: str, api_key: str, timeout: float = 180) -> dict:
    return json.loads(_request(TRANSCRIBE_URL, body, content_type, api_key, timeout).decode("utf-8"))


def transcribe(audio: bytes, mime: str, api_key: str, post=_post_audio) -> str:
    if not api_key:
        raise AIError("No OpenAI key yet, so the recording cannot be transcribed.")
    if not audio:
        raise AIError("The recording is empty.")
    subtype = mime.split(";")[0].split("/")[-1].strip().lower()
    extension = AUDIO_EXTENSIONS.get(subtype, "webm")
    clean_mime = mime.split(";")[0].strip() or "audio/webm"
    body, content_type = _multipart(
        {"model": TRANSCRIBE_MODEL, "prompt": TRANSCRIBE_HINT},
        f"speech.{extension}", clean_mime, audio,
    )
    result = post(body, content_type, api_key)
    return str(result.get("text") or "").strip()


# ---- text to speech ----------------------------------------------------
#
# gpt-4o-mini-tts on /v1/audio/speech is cheap (about $12 per 1M audio tokens) and follows
# accent instructions, but OpenAI shuts it down on 2027-01-06. gpt-audio-1.5 on Chat
# Completions costs about five times as much and has no shutdown date. speech() uses the
# chosen model and falls back to gpt-audio-1.5 when the speech model is no longer available.

SPEECH_URL = "https://api.openai.com/v1/audio/speech"
TTS_MODEL = "gpt-4o-mini-tts"
TTS_FALLBACK_MODEL = "gpt-audio-1.5"
TTS_MODELS = (TTS_MODEL, TTS_FALLBACK_MODEL)
# Voices both models accept; marin and cedar are OpenAI's recommended most natural voices.
TTS_VOICES = ("marin", "cedar", "coral", "alloy", "ash", "ballad", "echo", "sage", "shimmer", "verse")
MAX_TTS_CHARS = 1500
ACCENTS = {"us": "a natural General American accent", "uk": "a natural Southern British accent"}
PACES = {
    "normal": "at a relaxed, natural conversational pace",
    "slow": "a little slower than normal, with clear words but still natural rhythm, never robotic",
}
# HTTP statuses that mean "this model cannot be used any more", as opposed to a bad key or quota.
MODEL_GONE = {400, 404, 410}


def _style(accent: str, pace: str) -> str:
    return (f"Speak in {ACCENTS.get(accent, ACCENTS['us'])}, {PACES.get(pace, PACES['normal'])}, "
            "like a friendly colleague in everyday conversation.")


def _post_speech(payload: dict, api_key: str, timeout: float = 60) -> bytes:
    return _request(SPEECH_URL, json.dumps(payload).encode("utf-8"), "application/json", api_key, timeout)


def _speech_tts(text: str, voice: str, style: str, api_key: str, post_speech) -> bytes:
    audio = post_speech({"model": TTS_MODEL, "voice": voice, "input": text,
                         "instructions": style, "response_format": "mp3"}, api_key)
    if not audio:
        raise AIError("OpenAI returned empty audio.")
    return audio


def _speech_chat(text: str, voice: str, style: str, api_key: str, post) -> bytes:
    body = post({
        "model": TTS_FALLBACK_MODEL,
        "modalities": ["text", "audio"],
        "audio": {"voice": voice, "format": "mp3"},
        "messages": [
            {"role": "system", "content": "You are a text-to-speech engine. Read the user's message aloud "
                                          "exactly as written, word for word. Do not answer it, comment on it "
                                          f"or add anything. {style}"},
            {"role": "user", "content": text},
        ],
    }, api_key)
    try:
        return base64.b64decode(body["choices"][0]["message"]["audio"]["data"])
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise AIError("Could not read the audio returned by the AI.") from e


def speech(text: str, voice: str, accent: str, pace: str, api_key: str, model: str = TTS_MODEL,
           post_speech=_post_speech, post=_post) -> tuple[bytes, str]:
    """Return (mp3 bytes, model actually used)."""
    if not api_key:
        raise AIError("No OpenAI key yet.")
    text = " ".join(text.split())[:MAX_TTS_CHARS]
    if not text:
        raise AIError("Nothing to read aloud.")
    voice = voice if voice in TTS_VOICES else TTS_VOICES[0]
    style = _style(accent, pace)
    if model == TTS_MODEL:
        try:
            return _speech_tts(text, voice, style, api_key, post_speech), TTS_MODEL
        except AIError as e:
            if e.status not in MODEL_GONE:
                raise
    return _speech_chat(text, voice, style, api_key, post), TTS_FALLBACK_MODEL
