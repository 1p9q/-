// Run: node tests/matcher.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildWords, tokenize, align, summarize, normalize, skeleton } from "../js/matcher.js";

const surah = (n) => JSON.parse(readFileSync(new URL(`../data/surahs/${n}.json`, import.meta.url), "utf8"));
const verses = (n, from, to) => surah(n).slice(from - 1, to).map((text, i) => ({ surah: n, ayah: from + i, text }));
const run = (n, from, to, transcript, opts) => {
  const words = buildWords(verses(n, from, to));
  return { words, ...align(words, tokenize(transcript), opts) };
};

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log("✓", name);
  } catch (e) {
    console.error("✗", name);
    throw e;
  }
};

test("normalize Uthmani to plain letters", () => {
  assert.equal(normalize("ٱلرَّحْمَٰنِ"), "الرحمان");
  assert.equal(skeleton(normalize("ٱلصَّلَوٰةَ")), skeleton(normalize("الصلاة")));
  assert.equal(skeleton(normalize("ٱلْعَٰلَمِينَ")), skeleton(normalize("العالمين")));
  assert.equal(skeleton(normalize("بِـَٔايَٰتِنَا")), skeleton(normalize("بآياتنا")));
});

test("perfect Al-Fatiha recitation is all ok", () => {
  const r = run(1, 1, 7,
    "بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين إياك نعبد وإياك نستعين اهدنا الصراط المستقيم صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين",
    { final: true });
  assert.deepEqual(summarize(r.status).ok, r.words.length);
});

test("skipped word is marked missed", () => {
  // "رب" left out
  const r = run(1, 2, 2, "الحمد لله العالمين", { final: true });
  assert.deepEqual(r.status, ["ok", "ok", "missed", "ok"]);
});

test("wrong word is marked wrong", () => {
  // نستعين -> نستغفر
  const r = run(1, 5, 5, "إياك نعبد وإياك نستغفر", { final: true });
  assert.deepEqual(r.status, ["ok", "ok", "ok", "wrong"]);
});

test("self-correction is marked corrected", () => {
  const r = run(1, 5, 5, "إياك نعبد وإياك نستغفر نستعين", { final: true });
  assert.deepEqual(r.status, ["ok", "ok", "ok", "corrected"]);
});

test("partial recitation leaves rest pending", () => {
  const r = run(1, 2, 4, "الحمد لله رب");
  assert.equal(r.pointer, 3);
  assert.equal(r.status[3], "pending");
});

test("disjointed letters spelled out", () => {
  const r = run(2, 1, 2, "الف لام ميم ذلك الكتاب لا ريب فيه هدى للمتقين", { final: true });
  assert.ok(r.status.every((s) => s === "ok"), r.status.join(","));
});

test("basmala before a surah is ignored as extra", () => {
  const r = run(112, 1, 2, "بسم الله الرحمن الرحيم قل هو الله أحد الله الصمد", { final: true });
  assert.ok(r.status.every((s) => s === "ok"), r.status.join(","));
});

test("Uthmani spellings vs plain spellings", () => {
  // البقرة 3: يقيمون الصلوة ... رزقناهم
  const r = run(2, 3, 3, "الذين يؤمنون بالغيب ويقيمون الصلاة ومما رزقناهم ينفقون", { final: true });
  assert.ok(r.status.every((s) => s === "ok"), r.status.join(","));
});

test("يا أيها heard as two tokens for one Uthmani word", () => {
  // البقرة 21: يَٰٓأَيُّهَا ٱلنَّاسُ ٱعْبُدُوا۟ رَبَّكُمُ ...
  const r = run(2, 21, 21, "يا أيها الناس اعبدوا ربكم الذي خلقكم والذين من قبلكم لعلكم تتقون", { final: true });
  assert.ok(r.status.every((s) => s === "ok"), r.status.join(","));
});

test("hinted words are counted as hinted", () => {
  const r = run(1, 2, 2, "الحمد لله العالمين", { final: true, hinted: new Set([2]) });
  assert.deepEqual(r.status, ["ok", "ok", "hinted", "ok"]);
});

test("all 114 surahs build words", () => {
  let count = 0;
  for (let n = 1; n <= 114; n++) {
    const s = surah(n);
    const w = buildWords(s.map((text, i) => ({ surah: n, ayah: i + 1, text })));
    assert.ok(w.every((x) => x.norm.length > 0), `empty word in surah ${n}`);
    count += w.length;
  }
  assert.ok(count > 77000, String(count));
});

console.log(`\n${passed} tests passed`);
