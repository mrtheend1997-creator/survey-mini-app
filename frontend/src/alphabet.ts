// Uzbek Latin: the current spelling (o‘, g‘, sh, ch) -> the new alphabet (ö, ğ, ş, ç).
// Same rules as backend/app/services/alphabet.py (see there for the details); both are
// checked against the same examples. Used only when an administrator presses the button
// next to an Uzbek Latin field, never on its own.

const APOS = "‘’ʻʼ'`´"
const PROTECT = /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+|@\w+)/
const WORD = new RegExp(`[A-Za-zÀ-ÿĞğŞşÇçÖö${APOS}]+`, 'g')
const FOREIGN = /[wW]|[cC](?![hH])/
const SEP_SH = new RegExp(`([sS])[${APOS}]([hH])`, 'g')
const O = new RegExp(`([oO])[${APOS}]`, 'g')
const G = new RegExp(`([gG])[${APOS}]`, 'g')
const MARK = '\u0000'

function word(w: string): string {
  if (FOREIGN.test(w) || /[ÖöĞğŞşÇç]/.test(w)) return w // not Uzbek, or already new
  return w
    .replace(SEP_SH, (_, s: string, h: string) => s + MARK + h)
    .replace(O, (_, o: string) => (o === 'O' ? 'Ö' : 'ö'))
    .replace(G, (_, g: string) => (g === 'G' ? 'Ğ' : 'ğ'))
    .replace(/([sS])([hH])/g, (_, s: string) => (s === 'S' ? 'Ş' : 'ş'))
    .replace(/([cC])([hH])/g, (_, c: string) => (c === 'C' ? 'Ç' : 'ç'))
    .split(MARK)
    .join('')
}

export function toNewLatin(text: string): string {
  if (!text) return text
  // split() with one group: even items are ordinary text, odd ones are links / e-mails / @names
  return text
    .split(PROTECT)
    .map((p, i) => (i % 2 ? p : p.replace(WORD, word)))
    .join('')
}

export function hasOldLetters(text: string): boolean {
  return !!text && toNewLatin(text) !== text
}
