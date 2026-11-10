"""AI explanations through the OpenAI chat completions API (stdlib only)."""

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
    pass


def _post(payload: dict, api_key: str, timeout: float = 60) -> dict:
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            pass
        raise AIError(f"OpenAI API error {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise AIError(f"Cannot reach OpenAI: {e}") from e


def explain(focus: str, sentence: str, api_key: str, model: str = DEFAULT_MODEL, post=_post) -> dict:
    """Explain `focus` (the part the learner does not understand) in `sentence`."""
    if not api_key:
        raise AIError("还没有设置 OpenAI key，请先到「设置」里填写。")
    focus, sentence = focus.strip(), sentence.strip()
    if not focus and not sentence:
        raise AIError("请输入句子或单词。")
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
        raise AIError("AI 返回的内容无法解析，请重试。") from e
    if not isinstance(data, dict):
        raise AIError("AI 返回的内容无法解析，请重试。")
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
}


def _chat_json(system: str, user: str, api_key: str, model: str, post) -> dict:
    if not api_key:
        raise AIError("还没有设置 OpenAI key，请先到「设置」里填写。")
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
        raise AIError("AI 返回的内容无法解析，请重试。") from e
    if not isinstance(data, dict):
        raise AIError("AI 返回的内容无法解析，请重试。")
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
    request = urllib.request.Request(
        TRANSCRIBE_URL, data=body,
        headers={"Content-Type": content_type, "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            pass
        raise AIError(f"OpenAI API error {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise AIError(f"Cannot reach OpenAI: {e}") from e


def transcribe(audio: bytes, mime: str, api_key: str, post=_post_audio) -> str:
    if not api_key:
        raise AIError("还没有设置 OpenAI key，无法把录音转成文字。")
    if not audio:
        raise AIError("录音是空的。")
    subtype = mime.split(";")[0].split("/")[-1].strip().lower()
    extension = AUDIO_EXTENSIONS.get(subtype, "webm")
    clean_mime = mime.split(";")[0].strip() or "audio/webm"
    body, content_type = _multipart(
        {"model": TRANSCRIBE_MODEL, "prompt": TRANSCRIBE_HINT},
        f"speech.{extension}", clean_mime, audio,
    )
    result = post(body, content_type, api_key)
    return str(result.get("text") or "").strip()
