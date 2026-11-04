"""Uzbek Latin: the current spelling (o‘, g‘, sh, ch) and the new one (ö, ğ, ş, ç).

The letter changes are the ones given in the task (law O‘RQ-1184 of 21.10.2026, in force from
22.04.2027): O‘→Ö, G‘→Ğ, Sh→Ş, Ch→Ç. Nothing here runs by itself: survey texts are converted
only when an administrator asks for it in the builder and sees every change first.

Rules:
* o / g followed by any apostrophe form (‘ ’ ʻ ʼ ' ` ´) is one letter: ö / ğ;
* "s’h" (s and h said apart, e.g. Is’hoq) becomes "sh", which no longer means ş;
* sh → ş, ch → ç; the case follows the first letter (Sh/SH → Ş);
* the tutuq belgisi (ma’no, san’at) stays as it is;
* links, e-mail addresses, @usernames, words that are clearly not Uzbek (with w, or a c that
  is not part of ch) and words already written with ö, ğ, ş or ç are left alone.

Text that is already in the new alphabet must not be converted again: there "sh" is s + h.

frontend/src/alphabet.ts does the same in the browser; both are tested on the same examples.
"""

import re

APOS = "‘’ʻʼ'`´"
_PROTECT = re.compile(r"(https?://\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+|@\w+)", re.ASCII)
_WORD = re.compile(rf"[A-Za-zÀ-ÿĞğŞşÇçÖö{APOS}]+")
_FOREIGN = re.compile(r"[wW]|[cC](?![hH])")
_NEW = re.compile(r"[ÖöĞğŞşÇç]")
_SEP_SH = re.compile(rf"([sS])[{APOS}]([hH])")
_O = re.compile(rf"([oO])[{APOS}]")
_G = re.compile(rf"([gG])[{APOS}]")
_SH = re.compile(r"([sS])([hH])")
_CH = re.compile(r"([cC])([hH])")
_MARK = "\u0000"


def _word(w: str) -> str:
    if _FOREIGN.search(w) or _NEW.search(w):
        return w  # not Uzbek, or already written in the new alphabet
    w = _SEP_SH.sub(lambda m: m[1] + _MARK + m[2], w)
    w = _O.sub(lambda m: "Ö" if m[1] == "O" else "ö", w)
    w = _G.sub(lambda m: "Ğ" if m[1] == "G" else "ğ", w)
    w = _SH.sub(lambda m: "Ş" if m[1] == "S" else "ş", w)
    w = _CH.sub(lambda m: "Ç" if m[1] == "C" else "ç", w)
    return w.replace(_MARK, "")


def to_new_latin(text: str) -> str:
    if not text:
        return text
    parts = _PROTECT.split(text)
    # split() with one group: even items are ordinary text, odd ones are protected
    return "".join(p if i % 2 else _WORD.sub(lambda m: _word(m[0]), p) for i, p in enumerate(parts))


def has_old_letters(text: str) -> bool:
    return bool(text) and to_new_latin(text) != text
