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
