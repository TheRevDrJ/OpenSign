#!/usr/bin/env python3
"""Generate frontend/src/data/verses.ts, the verse-of-the-day set.

WHAT: takes the top-ranked references from OpenBible.info's memory-verse list
(ranked by popularity, CC BY 4.0) and pulls each verse's text VERBATIM from the
Berean Standard Bible (public domain), then writes verses.ts. Scripture is never
typed by hand: this script is the only way the file's text gets written.
RUN:   python3 scripts/gen_verses.py      (fetches both sources; needs internet)
WRITES: frontend/src/data/verses.ts and scripts/verse_refs.json (the selected
       references, which scripts/fetch_translations.py reads). Nothing else.
SIZE:  every ranked entry except EXCLUDE. Length is NOT filtered here: whatever
       version is showing, the widget skips a verse too long for its card to
       the next one (version-agnostic; see MAX_CHARS in Widgets.tsx).
PRUNE: add a reference to EXCLUDE and re-run; lower-ranked verses move up.
"""
import json, sys, urllib.request
from pathlib import Path

BSB_URL = "https://bereanbible.com/bsb.txt"
RANKED_URL = "https://a.openbible.info/blog/2009-05-memory.txt"
OUT = Path(__file__).resolve().parent.parent / "frontend/src/data/verses.ts"
REFS_OUT = Path(__file__).resolve().parent / "verse_refs.json"

# References to leave out (OpenBible's form). Pastoral pruning: a lobby screen has
# no preacher to supply context, so a verse must stand on its own. Out: verses
# that read as condemning, shaming or bleak alone, that confuse without context,
# or that are current flashpoints. Lower-ranked verses move up to fill the set.
EXCLUDE = {
    "Ps.14.1",  # Psalm 14:1: calls unbelievers corrupt and vile
    "Prov.23.7",  # Proverbs 23:7: about a stingy host; searched for a KJV reading BSB doesn't have
    "Isa.1.9",  # Isaiah 1:9: Sodom and Gomorrah, confusing alone
    "Gen.1.27",  # Genesis 1:27: current flashpoint (gender)
    "Ezek.25.17",  # Ezekiel 25:17: vengeance; popular because of Pulp Fiction
    "Mark.16.15-Mark.16.16",  # Mark 16:15-16: ends 'will be condemned'
    "Jer.8.8",  # Jeremiah 8:8: 'lying pen of the scribes', confusing alone
    "1Cor.15.33-1Cor.15.34",  # 1 Corinthians 15:33-34: 'I say this to your shame'
    "Luke.12.48",  # Luke 12:48: 'beaten with few blows'
    "Prov.12.1",  # Proverbs 12:1: 'he who hates correction is stupid'
    "Jer.17.9",  # Jeremiah 17:9: 'heart deceitful beyond cure', bleak alone
    "Jer.1.5",  # Jeremiah 1:5: current flashpoint (abortion)
    "Prov.22.7",  # Proverbs 22:7: 'the rich rule over the poor'
    "Prov.24.10",  # Proverbs 24:10: shames the weak
    "Isa.30.15",  # Isaiah 30:15: ends 'but you were not willing'
    "Gen.2.24",  # Genesis 2:24: current flashpoint (marriage)
    "1Cor.6.9-1Cor.6.10",  # 1 Corinthians 6:9-10: list of sins that bar from the kingdom
    "Exod.35.2",  # Exodus 35:2: Sabbath-breakers 'must be put to death'
    "Gal.3.13",  # Galatians 3:13: ends 'Cursed is everyone who is hung on a tree'
    "Isa.5.20",  # Isaiah 5:20: 'Woe to those who call evil good', used as a culture-war line
    "Isa.38.14",  # Isaiah 38:14: 'I chirp like a swallow', confusing alone
    "Hos.4.6",  # Hosea 4:6: 'I will forget your children'
    "Isa.9.1",  # Isaiah 9:1: place names, confusing alone
    "Ps.33.12",  # Psalm 33:12: 'Blessed is the nation', current flashpoint (nationalism)
    "John.3.36",  # John 3:36: ends on 'the wrath of God remains on him'
    "Mark.10.18",  # Mark 10:18: 'Why do you call Me good?', confusing alone
    "Rom.1.24-Rom.1.25",  # Romans 1:24-25: lead-in to Romans 1's sexual-sin passage
    "Eccl.9.10",  # Ecclesiastes 9:10: ends 'in Sheol, where you are going'
    "Rev.21.8",  # Revelation 21:8: the lake of fire
    "Prov.26.11",  # Proverbs 26:11: dog returning to its vomit
    "Matt.5.29",  # Matthew 5:29: 'gouge it out'
    "Jas.4.4",  # James 4:4: 'You adulteresses!'
    "John.5.39-John.5.40",  # John 5:39-40: rebuke of Jewish leaders, easily misread
    "Zech.12.3",  # Zechariah 12:3: Jerusalem and the nations, current flashpoint
    "Luke.21.25",  # Luke 21:25: end-times signs, alarming alone
    "Ps.139.16",  # Psalm 139:16: current flashpoint (abortion)
    "Jas.2.20",  # James 2:20: 'O foolish man'
    "2Chr.16.9",  # 2 Chronicles 16:9: ends 'you will be at war'
    "Rom.1.18",  # Romans 1:18: the wrath of God
    "Gen.12.3",  # Genesis 12:3: 'curse those who curse you', current flashpoint (Israel)
}

BOOKS = {
    "Gen": "Genesis", "Exod": "Exodus", "Lev": "Leviticus", "Num": "Numbers",
    "Deut": "Deuteronomy", "Josh": "Joshua", "Judg": "Judges", "Ruth": "Ruth",
    "1Sam": "1 Samuel", "2Sam": "2 Samuel", "1Kgs": "1 Kings", "2Kgs": "2 Kings",
    "1Chr": "1 Chronicles", "2Chr": "2 Chronicles", "Ezra": "Ezra",
    "Neh": "Nehemiah", "Esth": "Esther", "Job": "Job", "Ps": "Psalm",
    "Prov": "Proverbs", "Eccl": "Ecclesiastes", "Song": "Song of Solomon",
    "Isa": "Isaiah", "Jer": "Jeremiah", "Lam": "Lamentations", "Ezek": "Ezekiel",
    "Dan": "Daniel", "Hos": "Hosea", "Joel": "Joel", "Amos": "Amos",
    "Obad": "Obadiah", "Jonah": "Jonah", "Mic": "Micah", "Nah": "Nahum",
    "Hab": "Habakkuk", "Zeph": "Zephaniah", "Hag": "Haggai", "Zech": "Zechariah",
    "Mal": "Malachi", "Matt": "Matthew", "Mark": "Mark", "Luke": "Luke",
    "John": "John", "Acts": "Acts", "Rom": "Romans", "1Cor": "1 Corinthians",
    "2Cor": "2 Corinthians", "Gal": "Galatians", "Eph": "Ephesians",
    "Phil": "Philippians", "Col": "Colossians", "1Thess": "1 Thessalonians",
    "2Thess": "2 Thessalonians", "1Tim": "1 Timothy", "2Tim": "2 Timothy",
    "Titus": "Titus", "Phlm": "Philemon", "Heb": "Hebrews", "Jas": "James",
    "1Pet": "1 Peter", "2Pet": "2 Peter", "1John": "1 John", "2John": "2 John",
    "3John": "3 John", "Jude": "Jude", "Rev": "Revelation",
}

# BSB prints a psalm's superscription at the front of verse 1. Dropping it is an
# excerpt, not a change of wording. Each prefix must match EXACTLY or the run
# fails; a psalm verse 1 that is in neither table also fails, so a new one can't
# slip through with its superscription attached.
SUPERSCRIPTIONS = {
    9: "For the choirmaster. To the tune of “The Death of the Son.” A Psalm of David. ",
    14: "For the choirmaster. Of David. ",
    16: "A Miktam of David. ",
    18: "For the choirmaster. Of David the servant of the LORD, who sang this song to the LORD on the day the LORD had delivered him from the hand of all his enemies and from the hand of Saul. He said: ",
    19: "For the choirmaster. A Psalm of David. ",
    23: "A Psalm of David. ",
    24: "A Psalm of David. ",
    27: "Of David. ",
    34: "Of David, when he pretended to be insane before Abimelech, so that the king drove him away. ",
    40: "For the choirmaster. A Psalm of David. ",
    32: "Of David. A Maskil. ",
    42: "For the choirmaster. A Maskil of the sons of Korah. ",
    46: "For the choirmaster. Of the sons of Korah. According to Alamoth. A song. ",
    62: "For the choirmaster. According to Jeduthun. A Psalm of David. ",
    89: "A Maskil of Ethan the Ezrahite. ",
    122: "A song of ascents. Of David. ",
    103: "Of David. ",
    130: "A song of ascents. ",
    133: "A song of ascents. Of David. ",
    143: "A Psalm of David. ",
    145: "A Psalm of praise. Of David. ",
}
NO_SUPERSCRIPTION = {1, 91, 105, 107, 115, 118, 136}
# A few verses END with a musical note (Habakkuk's psalm). Stripped the same way:
# exact match, or the run fails.
SUBSCRIPTIONS = {"Habakkuk 3:19": " For the choirmaster. With stringed instruments."}


def fetch(url: str) -> str:
    with urllib.request.urlopen(url) as r:
        return r.read().decode("utf-8-sig")


def parse_ref(osis: str):
    book, ch, vs = osis.split(".")
    if book not in BOOKS:
        sys.exit(f"unknown book abbreviation: {osis}")
    return BOOKS[book], int(ch), int(vs)


def main():
    bsb = fetch(BSB_URL)
    assert "dedicated to the public domain" in bsb[:600], "BSB copy lacks the public-domain dedication"
    keys, text = [], {}
    for line in bsb.splitlines():
        if "\t" not in line:
            continue
        ref, t = line.split("\t", 1)
        if ":" in ref and t.strip():
            keys.append(ref)
            text[ref] = t.strip()
    index = {k: i for i, k in enumerate(keys)}

    out, total = [], 0
    for line in fetch(RANKED_URL).splitlines():
        osis = line.split("\t", 1)[0].strip()
        if not osis or osis in EXCLUDE:
            continue
        a, _, b = osis.partition("-")
        (bk, c1, v1) = parse_ref(a)
        (_, c2, v2) = parse_ref(b) if b else (bk, c1, v1)
        start, end = f"{bk} {c1}:{v1}", f"{bk} {c2}:{v2}"
        if start not in index or end not in index:
            sys.exit(f"reference not found in BSB: {osis}")
        parts = []
        for k in keys[index[start]: index[end] + 1]:
            t = text[k]
            if bk == "Psalm" and k.endswith(":1"):
                ps = int(k.split(" ")[1].split(":")[0])
                if ps in SUPERSCRIPTIONS:
                    pre = SUPERSCRIPTIONS[ps]
                    assert t.startswith(pre), f"superscription mismatch in {k}: {t[:80]!r}"
                    t = t[len(pre):]
                elif ps not in NO_SUPERSCRIPTION:
                    sys.exit(f"{k} is not in SUPERSCRIPTIONS or NO_SUPERSCRIPTION; check it by eye")
            # "Selah" (a musical/liturgical mark, not read aloud) is dropped from
            # the end of a verse, since the card shows only what is read.
            if t.endswith(" Selah"):
                t = t[: -len(" Selah")]
            if k in SUBSCRIPTIONS:
                assert t.endswith(SUBSCRIPTIONS[k]), f"subscription mismatch in {k}"
                t = t[: -len(SUBSCRIPTIONS[k])]
            parts.append(t)
        if c1 == c2:
            label = f"{bk} {c1}:{v1}" + (f"-{v2}" if v2 != v1 else "")
        else:
            label = f"{bk} {c1}:{v1}–{c2}:{v2}"
        joined = " ".join(parts)
        total += index[end] - index[start] + 1
        out.append({"osis": osis, "ref": label, "text": joined})
    assert out

    rows = "\n".join(f"  {{ osis: {json.dumps(v['osis'])}, ref: {json.dumps(v['ref'], ensure_ascii=False)}, text: {json.dumps(v['text'], ensure_ascii=False)} }}," for v in out)
    OUT.write_text(HEADER + "export const VERSES: Verse[] = [\n" + rows + "\n]\n" + FOOTER, encoding="utf-8")
    REFS_OUT.write_text(json.dumps([{"osis": v["osis"], "ref": v["ref"], "bsb_chars": len(v["text"])} for v in out], ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    lens = sorted(len(v["text"]) for v in out)
    print(f"wrote {len(out)} entries = {total} verses to {OUT}; last: {out[-1]['ref']}")
    print(f"text length: median {lens[len(lens)//2]}, max {lens[-1]} chars")


HEADER = """// Verse-of-the-day source set. GENERATED by scripts/gen_verses.py; do not
// hand-edit. To change the set, edit the script (EXCLUDE) and re-run it.
// Other translations are NOT stored here: the server fetches them live from
// API.Bible with the church's own key (backend/app/bible.py).
//
// Bundled so the widget works with NO internet connection, the same local-first
// principle as the rest of OpenSign.
//
// SELECTION: the top-ranked references from OpenBible.info's memory-verse list
//   (https://a.openbible.info/blog/2009-05-memory.txt), licensed CC BY 4.0
//   (https://creativecommons.org/licenses/by/4.0/). Credit: OpenBible.info.
//   Only the references are used; that list's own text is not.
// TEXT: Berean Standard Bible (BSB), dedicated to the public domain 2023-04-30
//   (https://berean.bible/terms.htm, "All uses are freely permitted"). Pulled
//   verbatim from https://bereanbible.com/bsb.txt. The BSB asks that text using
//   its name not vary from the official wording, so the only edit is dropping
//   psalm superscriptions from the front of a quoted verse (an excerpt).

export interface Verse {
  /** machine reference, e.g. "John.3.16", used to fetch other translations */
  osis: string
  /** human reference, e.g. "John 3:16" */
  ref: string
  text: string
}

export const VERSION_LABEL = 'BSB'

"""

FOOTER = """
/**
 * Deterministic verse for a given moment: the same day yields the same verse on
 * every display, with no server push. The widget passes a clock-shifted Date
 * (see Widgets.tsx), so the day rolls over at the chosen wall-clock midnight.
 */
export function verseIndexForDate(d: Date): number {
  const day = Math.floor(d.getTime() / 86_400_000)
  return ((day % VERSES.length) + VERSES.length) % VERSES.length
}
export function verseForDate(d: Date): Verse {
  return VERSES[verseIndexForDate(d)]
}
"""

if __name__ == "__main__":
    main()
