"""Interface and content languages.

Codes are kept two letters long so the existing columns (users.language, responses.language,
String(2)) need no change and every stored "uz" / "ru" keeps its meaning:

* "uz" — Uzbek, Latin script (uz-Latn). The interface uses the new alphabet (ö, ğ, ş, ç);
  survey texts are shown exactly as the administrator wrote them.
* "oz" — Uzbek, Cyrillic script (uz-Cyrl). "oz" is the usual code for Ўзбекча on Uzbek sites.
* "ru" — Russian.

Content fields are stored per language: title_uz, title_oz, title_ru. A missing translation is
never made up: the text in the next language of FALLBACK is shown instead.
"""

LANGS = ("uz", "oz", "ru")
DEFAULT = "uz"
LANG_PATTERN = "^(uz|oz|ru)$"

# BCP 47 names the frontend and other systems may send
ALIASES = {
    "uz-latn": "uz",
    "uz_latn": "uz",
    "uz-cyrl": "oz",
    "uz_cyrl": "oz",
    "cyrl": "oz",
}

FALLBACK = {
    "uz": ("uz", "ru", "oz"),
    "oz": ("oz", "uz", "ru"),
    "ru": ("ru", "uz", "oz"),
}


def normalize(code: str | None, default: str = DEFAULT) -> str:
    if not code:
        return default
    c = code.strip().lower()
    c = ALIASES.get(c, c)
    return c if c in LANGS else default


def pick(obj, field: str, lang: str) -> str:
    """The text of `field` in `lang`, or the first filled fallback (dicts and ORM objects)."""
    get = obj.get if isinstance(obj, dict) else (lambda k, d=None: getattr(obj, k, d))
    for code in FALLBACK.get(lang, FALLBACK[DEFAULT]):
        v = get(f"{field}_{code}")
        if v:
            return v
    return ""


def any_filled(*values: str | None) -> bool:
    return any(v and v.strip() for v in values)
