// Harakat (short-vowel) check: compares the vowels the model wrote on each
// consonant with the vowels in the mushaf.
//
// The mushaf is Uthmani script and the model writes ordinary (imla'i) spelling,
// so both are reduced to the same consonant skeleton used by matcher.js
// (long-vowel letters ا و ي and hamza dropped inside a word) and each remaining
// consonant keeps the short vowel written on it. Vowels are compared only where
// both sides wrote one, and the final vowel of a verse is skipped (stopping on
// it with sukun is correct recitation).

const FATHA = "َ", DAMMA = "ُ", KASRA = "ِ", SUKUN = "ْ", SHADDA = "ّ";
const FATHATAN = "ً", DAMMATAN = "ٌ", KASRATAN = "ٍ";
const VOWEL = {
  [FATHA]: "a", [DAMMA]: "u", [KASRA]: "i",
  [FATHATAN]: "an", [DAMMATAN]: "un", [KASRATAN]: "in",
  "ٖ": "i", // subscript alef (kasra-like, rare)
};
const IS_LETTER = /[ء-يٱۥۦـ]/; // base letters, small waw/yeh, tatweel
const VOWEL_LETTERS = new Set(["ا", "و", "ي"]);

function unify(ch) {
  if ("ٱأإآ".includes(ch)) return "ا";
  if (ch === "ؤ") return "و";
  if (ch === "ئ" || ch === "ى") return "ي";
  if (ch === "ة") return "ه";
  return ch;
}

/**
 * Consonant skeleton of a diacritized word with the vowel on each consonant.
 * @returns {{c:string, v:string|null}[]}  v: "a"|"i"|"u"|"an"|"in"|"un"|"0" (sukun)|null (none written)
 */
export function vowelSeq(word) {
  const letters = [];
  for (const ch of word) {
    if (IS_LETTER.test(ch)) letters.push({ ch, marks: "" });
    else if (letters.length) letters[letters.length - 1].marks += ch;
  }
  const out = [];
  for (const { ch, marks } of letters) {
    if (ch === "ء" || ch === "ـ" || ch === "ۥ" || ch === "ۦ") continue; // hamza, tatweel, small waw/yeh
    const c = unify(ch);
    if (out.length && VOWEL_LETTERS.has(c)) continue; // long vowel / seat letter inside the word
    let v = null;
    for (const m of marks) {
      if (VOWEL[m]) v = VOWEL[m];
      else if (m === SUKUN || m === "ۡ") v = v || "0";
    }
    out.push({ c, v, shadda: marks.includes(SHADDA) });
  }
  return out;
}

const NAMES = { a: "فتحة", i: "كسرة", u: "ضمة", an: "تنوين فتح", in: "تنوين كسر", un: "تنوين ضم", 0: "سكون" };
const base = (v) => (v === "an" ? "a" : v === "in" ? "i" : v === "un" ? "u" : v);

/**
 * Compare the vowels of an expected (Uthmani) word with what the model wrote.
 * @param {string} expected  Uthmani word with diacritics
 * @param {string} heard     model output for that word, with diacritics
 * @param {{verseEnd?: boolean}} opts
 * @returns {null | {letter:string, expected:string, heard:string}[]}
 *   null when it can't be compared (no diacritics heard, or different letters);
 *   otherwise the list of vowel mismatches (empty = harakat correct)
 */
export function compareHarakat(expected, heard, opts = {}) {
  if (!heard || !/[ً-ِ]/.test(heard)) return null;
  const e = vowelSeq(expected);
  const h = vowelSeq(heard);
  if (e.length !== h.length || e.some((x, i) => x.c !== h[i].c)) return null;
  const diffs = [];
  const last = e.length - 1;
  e.forEach((x, i) => {
    const y = h[i];
    if (opts.verseEnd && i === last) return; // waqf
    if (!x.v || !y.v || x.v === "0" || y.v === "0") return; // compare written short vowels only
    // tanween vs plain vowel of the same kind is a different reading only mid-verse
    if (x.v === y.v) return;
    if (base(x.v) === base(y.v) && (x.v.length === 2) !== (y.v.length === 2) && i === last && opts.pauseOk) return;
    diffs.push({ letter: x.c, expected: NAMES[x.v] || x.v, heard: NAMES[y.v] || y.v, index: i });
  });
  return diffs;
}
