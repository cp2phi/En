"""Small text helpers: normalising, rough stemming, edit distance.

The stemmer is a heuristic. It is only used to tell "right word, wrong form"
apart from "wrong word", and to spot duplicate word cards.
"""

import re

_IRREGULAR_GROUPS = """
be: am is are was were been being
have: has had
do: does did done
go: goes went gone
run: ran
hold: held
make: made
take: took taken
come: came
see: saw seen
get: got gotten
give: gave given
find: found
think: thought
tell: told
become: became
leave: left
feel: felt
bring: brought
begin: began begun
keep: kept
write: wrote written
stand: stood
hear: heard
meet: met
pay: paid
sit: sat
speak: spoke spoken
lead: led
grow: grew grown
lose: lost
fall: fell fallen
send: sent
build: built
spend: spent
catch: caught
draw: drew drawn
choose: chose chosen
break: broke broken
buy: bought
wear: wore worn
sell: sold
throw: threw thrown
drive: drove driven
eat: ate eaten
drink: drank drunk
win: won
teach: taught
forget: forgot forgotten
rise: rose risen
fly: flew flown
know: knew known
say: said
mean: meant
deal: dealt
sleep: slept
swim: swam swum
shoot: shot
stick: stuck
hang: hung
lay: laid
freeze: froze frozen
shake: shook shaken
strike: struck
sweep: swept
bend: bent
feed: fed
fight: fought
hide: hid hidden
ride: rode ridden
ring: rang rung
sing: sang sung
wake: woke woken
tear: tore torn
blow: blew blown
lend: lent
seek: sought
agree: agreed
"""

IRREGULAR: dict[str, str] = {}
for _line in _IRREGULAR_GROUPS.strip().splitlines():
    _base, _forms = _line.split(":")
    for _form in _forms.split():
        IRREGULAR[_form] = _base.strip()

_VOWELS = set("aeiouy")


def normalize(text: str) -> str:
    text = text.strip().lower().replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", text)


def _tidy(base: str) -> str:
    if len(base) >= 2 and base[-1] == base[-2] and base[-1] not in "lsfz":
        base = base[:-1]
    if len(base) >= 3 and base.endswith("e"):
        base = base[:-1]
    return base


def stem(word: str) -> str:
    w = normalize(word)
    w = IRREGULAR.get(w, w)
    if w.endswith(("ies", "ied")) and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("ing"):
        base = w[:-3]
        if len(base) >= 2 and _VOWELS & set(base):
            return _tidy(base)
    if w.endswith("ed") and not w.endswith("eed"):
        base = w[:-2]
        if len(base) >= 2 and _VOWELS & set(base):
            return _tidy(base)
    if w.endswith("es") and len(w) > 3:
        base = w[:-2]
        if base.endswith(("s", "x", "z", "ch", "sh", "o")):
            return base
        return _tidy(w[:-1])
    if w.endswith("s") and len(w) > 3 and not w.endswith(("ss", "us", "is")):
        return stem(w[:-1])  # "meetings" -> "meeting" -> "meet"
    return _tidy(w)


def stem_phrase(text: str) -> str:
    return " ".join(stem(w) for w in re.findall(r"[a-z']+", normalize(text)))


def edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]
