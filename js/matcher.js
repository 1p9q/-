// Recitation matcher: compares what speech recognition heard with the expected
// Quran words and marks each expected word as ok / wrong / missed / corrected.
//
// Speech recognition writes plain modern Arabic ("الصلاة", "الرحمن") while the
// mushaf text is Uthmani script ("ٱلصَّلَوٰةَ", "ٱلرَّحْمَٰنِ"), so both sides are
// reduced to a loose "skeleton" before comparing: diacritics removed, letter
// variants unified, and long vowels (ا و ي) dropped except at the start of a word.

const DIACRITICS = /[ً-ْٕٖٓٔ-ٟۖ-ۜ۟-۪ۤۧۨ-ۭـ]/g;

/** Normalize Arabic text (Uthmani or plain) to bare letters with unified forms. */
export function normalize(text) {
  return text
    .replace(/ٰ/g, "ا") // superscript (dagger) alef -> alef
    .replace(/ۥ/g, "و") // small waw -> waw
    .replace(/ۦ/g, "ي") // small yeh -> yeh
    .replace(DIACRITICS, "")
    .replace(/[ٱأإآ]/g, "ا") // ٱ أ إ آ -> ا
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/[^ء-ي\s]/g, "") // drop anything that's not an Arabic letter
    .trim();
}

/** Loose consonant skeleton of a normalized word. */
export function skeleton(norm) {
  const w = norm.replace(/ء/g, ""); // hamza
  if (!w) return "";
  return w[0] + w.slice(1).replace(/[اوي]/g, "");
}

// Disjointed letters (الٓمٓ, كٓهيعٓصٓ ...) are recited by their letter names.
const LETTER_NAMES = {
  "ا": "الف", "ل": "لام", "م": "ميم", "ص": "صاد", "ر": "را", "ك": "كاف", "ه": "ها",
  "ي": "يا", "ع": "عين", "ط": "طا", "س": "سين", "ح": "حا", "ق": "قاف", "ن": "نون",
};
const NAME_TO_LETTER = Object.fromEntries(Object.entries(LETTER_NAMES).map(([l, n]) => [n, l]));
const MUQATTAAT = new Set(["الم", "المص", "الر", "المر", "كهيعص", "طه", "طسم", "طس", "يس", "ص", "حم", "عسق", "ق", "ن"]);

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function formSim(a, b) {
  // a, b: {norm, skel}
  if (a.skel === b.skel || a.norm === b.norm) return 1;
  const L = Math.max(a.skel.length, b.skel.length);
  if (L <= 2) return 0.4; // very short words must match exactly
  const s1 = 1 - lev(a.skel, b.skel) / L;
  const s2 = 1 - lev(a.norm, b.norm) / Math.max(a.norm.length, b.norm.length);
  return Math.max(s1, s2);
}

function makeForm(norm) {
  return { norm, skel: skeleton(norm) };
}

/** Similarity between a spoken token and an expected word (0..1). */
export function similarity(token, word) {
  let best = formSim(token, word);
  for (const alt of word.alts || []) best = Math.max(best, formSim(token, alt));
  return best;
}

/**
 * Turn verses into the list of expected words.
 * @param {{surah:number, ayah:number, text:string}[]} verses
 */
export function buildWords(verses) {
  const words = [];
  for (const v of verses) {
    const parts = v.text.split(/\s+/).filter(Boolean);
    parts.forEach((display, i) => {
      const norm = normalize(display);
      const w = { display, surah: v.surah, ayah: v.ayah, index: i, ...makeForm(norm) };
      if (i === 0 && MUQATTAAT.has(norm.replace(/ء/g, ""))) {
        const names = [...norm].map((ch) => LETTER_NAMES[ch] || ch);
        w.alts = [makeForm(names.join(""))];
        w.muqattaat = true;
      }
      words.push(w);
    });
  }
  return words;
}

/** Split a recognized transcript into comparable tokens. */
export function tokenize(transcript) {
  const raw = normalize(transcript).split(/\s+/).filter(Boolean);
  // Join runs of spelled letter names ("الف لام ميم") into one token so they can be
  // compared with disjointed letters. "يا"/"ها" are also common words, so a run must
  // contain at least one unambiguous letter name.
  const out = [];
  for (let i = 0; i < raw.length; ) {
    let j = i;
    while (j < raw.length && NAME_TO_LETTER[raw[j].replace(/ء/g, "")]) j++;
    const run = raw.slice(i, j).map((t) => t.replace(/ء/g, ""));
    if (run.length >= 2 && run.some((t) => t !== "يا" && t !== "ها")) {
      out.push(makeForm(run.join("")));
      i = j;
    } else {
      out.push(makeForm(raw[i]));
      i++;
    }
  }
  return out;
}

const MATCH = 0.75; // counts as the right word
const WRONG = 0.45; // close enough to be an attempt at this word (but wrong)
const WINDOW = 6; // how far ahead to look for skipped words
const BACK = 3; // how far back a repetition/correction may go

/**
 * Align spoken tokens with expected words.
 * Re-run from scratch on every transcript update (cheap for a few pages).
 *
 * @param {object[]} words   output of buildWords
 * @param {object[]} tokens  output of tokenize
 * @param {{final?: boolean, hinted?: Set<number>}} opts
 *   final: transcript is complete (commit tentative skips at the end)
 *   hinted: indexes the reciter revealed with the hint button
 * @returns {{status: string[], heard: (string|null)[], pointer: number, extras: number}}
 *   status per word: "pending" | "ok" | "wrong" | "missed" | "corrected" | "hinted"
 */
export function align(words, tokens, opts = {}) {
  const n = words.length;
  const status = new Array(n).fill("pending");
  const heard = new Array(n).fill(null);
  const hinted = opts.hinted || new Set();
  let p = 0;
  let extras = 0;

  const skipHinted = () => {
    while (p < n && hinted.has(p) && status[p] === "pending") {
      status[p] = "hinted";
      p++;
    }
  };
  const markOk = (k) => {
    status[k] = status[k] === "wrong" || status[k] === "missed" ? "corrected" : status[k] === "hinted" || status[k] === "corrected" ? status[k] : "ok";
  };

  for (let t = 0; t < tokens.length; t++) {
    skipHinted();
    const tok = tokens[t];
    const next = tokens[t + 1];
    const atEnd = p >= n;

    // 1) the expected word itself (also: one word heard as two tokens, or two words as one)
    if (!atEnd && similarity(tok, words[p]) >= MATCH) {
      markOk(p);
      heard[p] = tok.norm;
      p++;
      continue;
    }
    if (!atEnd && next) {
      const joined = makeForm(tok.norm + next.norm);
      if (similarity(joined, words[p]) >= MATCH) {
        markOk(p);
        heard[p] = tok.norm + " " + next.norm;
        p++;
        t++;
        continue;
      }
    }
    if (p + 1 < n && similarity(tok, words[p + 1]) < MATCH) {
      // two expected words heard as one token: compare skeletons strictly
      const both = words[p].skel + words[p + 1].skel;
      if (1 - lev(tok.skel, both) / Math.max(tok.skel.length, both.length) >= 0.85) {
        markOk(p);
        markOk(p + 1);
        heard[p] = tok.norm;
        p += 2;
        continue;
      }
    }

    // 2) repetition / self-correction: the reciter went back a few words
    let back = -1;
    for (let k = p - 1; k >= Math.max(0, p - BACK); k--) {
      if (similarity(tok, words[k]) >= MATCH) {
        back = k;
        break;
      }
    }
    if (back >= 0) {
      markOk(back);
      p = back + 1;
      continue;
    }
    if (atEnd) {
      extras++;
      continue;
    }

    // 3) skipped ahead: words between p and j were left out
    let jump = -1;
    for (let j = p + 1; j < Math.min(n, p + WINDOW); j++) {
      if (similarity(tok, words[j]) >= MATCH) {
        jump = j;
        break;
      }
    }
    if (jump > 0) {
      // Common short words repeat a lot, so confirm the jump with the next token
      // unless the transcript is finished.
      const confirmed = next
        ? jump + 1 >= n || similarity(next, words[jump + 1]) >= MATCH
        : opts.final;
      if (confirmed) {
        for (let k = p; k < jump; k++) if (status[k] === "pending") status[k] = hinted.has(k) ? "hinted" : "missed";
        markOk(jump);
        heard[jump] = tok.norm;
        p = jump + 1;
        continue;
      }
      if (!next) break; // wait for more speech before deciding
    }

    // 4) an attempt at the current word that came out wrong
    if (similarity(tok, words[p]) >= WRONG) {
      status[p] = "wrong";
      heard[p] = tok.norm;
      p++;
      continue;
    }

    // 5) noise / something not in the text
    extras++;
  }
  skipHinted();
  return { status, heard, pointer: p, extras };
}

/** Summary counts for a finished alignment. */
export function summarize(status) {
  const c = { ok: 0, wrong: 0, missed: 0, corrected: 0, hinted: 0, pending: 0 };
  for (const s of status) c[s]++;
  const done = status.length - c.pending;
  c.total = status.length;
  c.accuracy = done ? Math.round((c.ok / done) * 100) : 0;
  return c;
}
