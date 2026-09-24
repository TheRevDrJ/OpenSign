"""Licensed Bible translations for the verse widget, fetched live from API.Bible.

The built-in BSB (public domain) needs none of this. For anything else, each
church enters its OWN API.Bible key in admin; the server fetches the day's verse
with it. API.Bible's terms require cached verses to be deleted after 30 days, so
every cached verse is stamped and purged at 30 days (CACHE_DAYS). The cache only
exists so several displays share one call per verse.
The key lives in its own file (KEY_PATH), NOT in config.json, because config.json
is served to every display on the LAN.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from .paths import DATA_DIR

API = "https://rest.api.bible/v1"
KEY_PATH = DATA_DIR / "api_bible.json"
CACHE_DIR = DATA_DIR / "verse-cache"
CACHE_DAYS = 30

# OpenBible/OSIS book abbreviations (as stored in verses.ts) -> API.Bible's USFM codes.
USFM = {
    "Gen": "GEN", "Exod": "EXO", "Lev": "LEV", "Num": "NUM", "Deut": "DEU",
    "Josh": "JOS", "Judg": "JDG", "Ruth": "RUT", "1Sam": "1SA", "2Sam": "2SA",
    "1Kgs": "1KI", "2Kgs": "2KI", "1Chr": "1CH", "2Chr": "2CH", "Ezra": "EZR",
    "Neh": "NEH", "Esth": "EST", "Job": "JOB", "Ps": "PSA", "Prov": "PRO",
    "Eccl": "ECC", "Song": "SNG", "Isa": "ISA", "Jer": "JER", "Lam": "LAM",
    "Ezek": "EZK", "Dan": "DAN", "Hos": "HOS", "Joel": "JOL", "Amos": "AMO",
    "Obad": "OBA", "Jonah": "JON", "Mic": "MIC", "Nah": "NAM", "Hab": "HAB",
    "Zeph": "ZEP", "Hag": "HAG", "Zech": "ZEC", "Mal": "MAL", "Matt": "MAT",
    "Mark": "MRK", "Luke": "LUK", "John": "JHN", "Acts": "ACT", "Rom": "ROM",
    "1Cor": "1CO", "2Cor": "2CO", "Gal": "GAL", "Eph": "EPH", "Phil": "PHP",
    "Col": "COL", "1Thess": "1TH", "2Thess": "2TH", "1Tim": "1TI", "2Tim": "2TI",
    "Titus": "TIT", "Phlm": "PHM", "Heb": "HEB", "Jas": "JAS", "1Pet": "1PE",
    "2Pet": "2PE", "1John": "1JN", "2John": "2JN", "3John": "3JN", "Jude": "JUD",
    "Rev": "REV",
}

# USFM paragraph styles that are headings, not scripture: chapter labels, psalm
# titles (d), section headings, cross-reference lines, speaker labels.
# ⚠ Do NOT filter on verseId instead: red-letter words of Jesus (char 'wj') come
# back WITHOUT a verseId, so that drops them silently (Revelation 3:20 came back empty).
HEADING_STYLES = {"cl", "d", "ms", "ms1", "ms2", "mr", "s", "s1", "s2", "s3", "s4",
                  "sr", "r", "sp", "qa", "mt", "mt1", "mt2", "ip", "is"}

# Languages offered in admin (ISO 639-3 -> label). A key also unlocks free Bibles
# in ~145 languages; listing all of them would bury the church's own picks.
LANGUAGES = {"eng": "English", "spa": "Spanish", "kor": "Korean"}

_list_cache: dict = {}  # key -> (fetched_at, bibles); metadata only, not scripture


class BibleError(Exception):
    pass


def get_key() -> str:
    try:
        return json.loads(KEY_PATH.read_text(encoding="utf-8")).get("key", "")
    except (OSError, ValueError):
        return ""


def set_key(key: str) -> list:
    """Validate by listing Bibles with it, then save. Raises BibleError if bad."""
    key = key.strip()
    if not key:
        KEY_PATH.unlink(missing_ok=True)
        return []
    bibles = list_bibles(key)
    KEY_PATH.write_text(json.dumps({"key": key}), encoding="utf-8")
    return bibles


def _get(path: str, key: str) -> dict:
    req = urllib.request.Request(f"{API}{path}", headers={"api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise BibleError(f"API.Bible HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise BibleError("API.Bible unreachable") from e


def list_bibles(key: str = "") -> list:
    """Bibles this key can use in LANGUAGES: [{id, abbr, name, lang}]."""
    key = key or get_key()
    if not key:
        return []
    hit = _list_cache.get(key)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    data = _get("/bibles", key)["data"]
    bibles = sorted(
        ({"id": b["id"], "abbr": b.get("abbreviationLocal") or b["abbreviation"],
          "name": b.get("nameLocal") or b["name"], "lang": b["language"]["id"]}
         for b in data if b["language"]["id"] in LANGUAGES),
        key=lambda b: (list(LANGUAGES).index(b["lang"]), b["abbr"].lower()),
    )
    _list_cache[key] = (time.time(), bibles)
    return bibles


def _passage_id(osis: str) -> str:
    def one(r):
        b, c, v = r.split(".")
        return f"{USFM[b]}.{c}.{v}"
    a, _, b = osis.partition("-")
    return one(a) + (f"-{one(b)}" if b else "")


def _verse_text(content) -> str:
    """Scripture text only: skips heading paragraphs and verse-number markers.
    Poetry line breaks become spaces; divine-name small caps ('nd') become LORD."""
    paras = []

    def walk(node, acc, nd=False):
        if isinstance(node, list):
            for x in node:
                walk(x, acc, nd)
            return
        if node.get("type") == "text":
            acc.append(node["text"].upper() if nd else node["text"])
            return
        if node.get("name") == "verse":
            return
        if node.get("name") == "char" and node.get("attrs", {}).get("style") == "qs":
            return  # "Selah" (NLT prints "Interlude"): a musical mark, dropped
        is_nd = nd or (node.get("name") == "char" and node.get("attrs", {}).get("style") == "nd")
        walk(node.get("items", []), acc, is_nd)

    for para in content:
        if (para.get("attrs") or {}).get("style") in HEADING_STYLES:
            continue
        acc = []
        walk(para, acc)
        if acc:
            paras.append("".join(acc).strip())
    return re.sub(r"\s+", " ", " ".join(paras)).strip()


def purge_cache() -> None:
    """Delete every cached verse older than CACHE_DAYS (API.Bible's terms)."""
    if not CACHE_DIR.is_dir():
        return
    cutoff = time.time() - CACHE_DAYS * 86400
    for p in CACHE_DIR.glob("*/*.json"):
        try:
            if json.loads(p.read_text(encoding="utf-8"))["fetched_at"] < cutoff:
                p.unlink()
        except (OSError, ValueError, KeyError):
            p.unlink(missing_ok=True)


def get_verse(bible_id: str, osis: str, ref: str) -> dict:
    """{ref, text, abbr, fums} for one curated reference in one translation."""
    if not re.fullmatch(r"[\w-]+", bible_id) or not re.fullmatch(r"[\w.\-]+", osis):
        raise BibleError("bad request")
    purge_cache()
    path = CACHE_DIR / bible_id / f"{osis}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))["verse"]
    except (OSError, ValueError, KeyError):
        pass
    key = get_key()
    if not key:
        raise BibleError("no API key")
    q = urllib.parse.urlencode({
        "content-type": "json", "include-notes": "false", "include-titles": "false",
        "include-chapter-numbers": "false", "include-verse-numbers": "false",
    })
    res = _get(f"/bibles/{bible_id}/passages/{_passage_id(osis)}?{q}", key)
    d = res["data"]
    text = _verse_text(d["content"])
    if not text:
        raise BibleError("empty passage")
    # Show our own label (book names vary by translation: "Phil.", "Acts of the
    # Apostles") unless the translation returned a DIFFERENT range, which a
    # paraphrase does when it merges verses; then show what it really is.
    shown = ref
    theirs = re.search(r"\d+:\d+\S*$", d.get("reference") or "")
    ours = re.search(r"\d+:\d+\S*$", ref)
    if theirs and ours and theirs.group(0) != ours.group(0):
        shown = ref[: ours.start()] + theirs.group(0)
    abbr = next((b["abbr"] for b in list_bibles(key) if b["id"] == bible_id), "")
    verse = {"ref": shown, "text": text, "abbr": abbr, "fums": res.get("meta", {}).get("fumsToken", "")}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"fetched_at": time.time(), "verse": verse}, ensure_ascii=False), encoding="utf-8")
    return verse
