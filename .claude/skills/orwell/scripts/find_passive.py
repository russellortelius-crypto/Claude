#!/usr/bin/env python3
"""Flag likely passive voice in text.

Usage:
  find_passive.py FILE [FILE ...]     check files (.json: every string value; others: whole text)
  find_passive.py -                   check text from stdin

Prints one line per hit: where, the matched phrase, whether an agent ("by ...")
follows, and the sentence. Exit code 0 when nothing is found, 1 when there are hits.

This is a pattern match, not a parser. It finds "be/get + past participle" and
leaves the judgment to the reader: some hits are adjectives ("is closed",
"was tired"), and some passives are the right choice.
"""
import json
import re
import sys
from pathlib import Path

BE = r"(?:am|is|are|was|were|be|been|being|'s|'re|isn't|aren't|wasn't|weren't|get|gets|got|gotten|getting)"
# Words that may sit between the auxiliary and the participle: "was not yet confirmed".
ADVERB = r"(?:\s+(?:not|never|also|still|already|now|then|yet|reportedly|reported|allegedly|later|again|just|only|since|partly|largely|widely|officially|independently|subsequently|previously|first|being|been)\b)*"

IRREGULAR = """
arisen awoken beaten become begun bent bet bid bitten bled blown broken bred brought built
burnt burst bought cast caught chosen clung come cost crept cut dealt dug done drawn dreamt
driven drunk eaten fallen fed felt fought found fled flung flown forbidden forgotten forgiven
frozen given gone ground grown hung had heard hidden hit held hurt kept knelt known laid led
leant leapt learnt left lent let lain lit lost made meant met paid put quit read ridden rung
risen run said seen sought sold sent set shaken shed shone shot shown shrunk shut sung sunk
sat slain slept slid slung slit spoken sped spent spilt spun spat split spread sprung stood
stolen stuck stung stunk struck strung sworn swept swollen swum swung taken taught torn told
thought thrown thrust trodden understood undertaken upset woken worn woven wept won wound
withdrawn written overseen overtaken overthrown shot-down
""".split()

PARTICIPLE = r"(?:[A-Za-z]+(?:ed|en)|" + "|".join(sorted(map(re.escape, IRREGULAR), key=len, reverse=True)) + r")"

PATTERN = re.compile(rf"\b{BE}{ADVERB}\s+({PARTICIPLE})\b", re.IGNORECASE)

# Common "-ed/-en" words that are not participles after "be" (or are almost always adjectives).
NOT_PARTICIPLES = {
    "need", "seed", "speed", "feed", "bleed", "breed", "deed", "heed", "weed", "indeed", "proceed",
    "succeed", "exceed", "red", "bed", "shed", "wed", "led", "fled", "sled", "hundred", "kindred",
    "sacred", "naked", "wicked", "rugged", "ragged", "jagged", "crooked", "beloved", "learned",
    "aged", "even", "open", "often", "seven", "eleven", "heaven", "garden", "golden", "wooden",
    "sudden", "hidden", "ten", "then", "when", "men", "women", "children", "citizen", "chicken",
    "kitchen", "listen", "token", "seen", "between", "screen", "green", "queen", "teen", "keen",
    "unseen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "thirteen", "fourteen",
    "burden", "warden", "linen", "omen", "oxygen", "pollen", "sullen", "siren", "open",
}
# Usually adjectives after "be": reported as "maybe" rather than dropped.
STATIVE = {
    "interested", "tired", "worried", "concerned", "married", "located", "based", "involved",
    "required", "supposed", "used", "pleased", "surprised", "excited", "bored", "confused",
    "scared", "satisfied", "prepared", "closed", "finished", "done", "gone", "unclear", "limited",
    "related", "aimed", "allowed", "expected", "designed", "committed", "determined", "qualified", "unaccounted", "unharmed", "unconfirmed",
}

SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")


def sentences(text):
    for line in text.splitlines():
        for s in SENTENCE_END.split(line):
            if s.strip():
                yield s.strip()


def hits_in(text):
    for sent in sentences(text):
        for m in PATTERN.finditer(sent):
            word = m.group(1).lower()
            if word in NOT_PARTICIPLES:
                continue
            after = sent[m.end():]
            agent = re.match(r"\s*,?\s*(?:[a-z]+\s+){0,3}?by\s+([^,.;]+)", after)
            kind = "maybe adjective" if word in STATIVE else "passive"
            yield {
                "phrase": m.group(0),
                "kind": kind,
                "agent": ("by " + agent.group(1).strip()) if agent else None,
                "sentence": sent,
            }


def strings(obj, path="$"):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from strings(v, f"{path}[{i}]")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("url", "date", "generated_at"):
                continue
            yield from strings(v, f"{path}.{k}")


def sources(args):
    if args == ["-"]:
        yield "stdin", sys.stdin.read()
        return
    for a in args:
        p = Path(a)
        text = p.read_text(encoding="utf-8")
        if p.suffix == ".json":
            for where, s in strings(json.loads(text)):
                yield f"{p}:{where}", s
        else:
            yield str(p), text


def main(argv):
    if not argv:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    total = 0
    for where, text in sources(argv):
        for h in hits_in(text):
            total += 1
            agent = f"  [{h['agent']}]" if h["agent"] else "  [no agent]"
            print(f"{where}: {h['kind']}: \"{h['phrase']}\"{agent}\n    {h['sentence']}")
    print(f"\n{total} hit(s).", file=sys.stderr)
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
