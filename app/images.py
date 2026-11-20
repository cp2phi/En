"""Pictures for word cards: a free Wikipedia photo, an AI picture, or the learner's own upload.

Pictures are saved in data/images/<card id>.<ext>, so Sync carries them to other computers.
"""

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse

from .ai import AIError, _request

USER_AGENT = "EnglishPractice/1.0 (personal learning tool)"
WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"
WIKI_SEARCH = "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch="
MAX_IMAGE_BYTES = 5 * 1024 * 1024

IMAGE_URL = "https://api.openai.com/v1/images/generations"
IMAGE_MODEL = "gpt-image-1-mini"  # about USD 0.005 per low-quality 1024x1024 picture
IMAGE_COST = "about US$0.005"

# Magic bytes -> (extension, MIME type). Anything else is refused.
SIGNATURES = (
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"GIF8", "gif", "image/gif"),
)
MIME_BY_EXT = {"jpg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}


class ImageError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status  # HTTP status when Wikipedia answered with an error


def sniff(data: bytes) -> str:
    """The file extension for an image's bytes, or raise ImageError."""
    if not data:
        raise ImageError("The picture is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageError("The picture is larger than 5 MB.")
    for magic, ext, _ in SIGNATURES:
        if data.startswith(magic):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise ImageError("Only JPEG, PNG, GIF or WebP pictures can be used.")


def _get(url: str, timeout: float = 20) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read(MAX_IMAGE_BYTES + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ImageError("Not found on Wikipedia.", 404) from e
        raise ImageError(f"Wikipedia is busy or unavailable (HTTP {e.code}). Try again in a minute.", e.code) from e
    except Exception as e:  # noqa: BLE001 - network and timeout errors
        raise ImageError(f"Wikipedia could not be reached: {e}") from e


def _summary(title: str, get) -> dict | None:
    try:
        data = json.loads(get(WIKI_SUMMARY + urllib.parse.quote(title.replace(" ", "_"), safe="")))
    except ImageError as e:
        if e.status == 404:
            return None
        raise  # busy or offline: say so instead of "no photo"
    except ValueError:
        return None
    if data.get("type") != "standard" or not (data.get("thumbnail") or {}).get("source"):
        return None
    return data


def wiki_photo(title: str, search: str = "", get=_get) -> tuple[bytes, str]:
    """Lead photo of a Wikipedia article: (image bytes, credit).

    Tries `title` first, then the best search hit for `search` (or the title).
    """
    data = _summary(title, get) if title else None
    if data is None:
        query = search or title
        try:
            hits = json.loads(get(WIKI_SEARCH + urllib.parse.quote(query)))["query"]["search"]
        except (ValueError, KeyError, TypeError):
            hits = []
        if hits:
            data = _summary(hits[0]["title"], get)
    if data is None:
        raise ImageError("No Wikipedia photo found. Try an AI picture or upload one.")
    source = data["thumbnail"]["source"]
    host = urlparse(source).hostname or ""
    if urlparse(source).scheme != "https" or not host.endswith(".wikimedia.org"):
        raise ImageError("Unexpected picture address from Wikipedia.")
    image = get(source)
    sniff(image)
    return image, f"Photo: Wikipedia, {data.get('title', title)}"


def ai_prompt(word: dict) -> str:
    meaning = "; ".join(x for x in (word.get("definition"), word.get("zh")) if x)
    context = ", ".join(t for t in word.get("tags") or [] if "/" not in t)
    return (f'A clear, realistic picture that shows what "{word["term"]}" means'
            + (f" ({meaning})" if meaning else "")
            + (f", in the context of {context}" if context else "")
            + ". One obvious subject, simple background, good light. No text, letters or labels.")


def _post_image(payload: dict, api_key: str, timeout: float = 120) -> dict:
    raw = _request(IMAGE_URL, json.dumps(payload).encode("utf-8"), "application/json", api_key, timeout)
    return json.loads(raw.decode("utf-8"))


def ai_picture(word: dict, api_key: str, post=_post_image) -> tuple[bytes, str]:
    """An AI picture for the card: (image bytes, credit). Raises AIError."""
    if not api_key:
        raise AIError("No OpenAI key yet. Add it in Settings, or upload a picture instead.")
    body = post({"model": IMAGE_MODEL, "prompt": ai_prompt(word), "size": "1024x1024",
                 "quality": "low", "output_format": "webp", "output_compression": 70, "n": 1}, api_key)
    try:
        image = base64.b64decode(body["data"][0]["b64_json"])
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise AIError("Could not read the picture returned by the AI.") from e
    try:
        sniff(image)
    except ImageError as e:
        raise AIError(str(e)) from e
    return image, f"AI picture ({IMAGE_MODEL})"
