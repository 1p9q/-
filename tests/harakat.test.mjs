// Run: node tests/harakat.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { vowelSeq, compareHarakat } from "../js/harakat.js";
import { normalize, skeleton } from "../js/matcher.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("✓", name); };

test("correct harakat in imla'i spelling match the Uthmani text", () => {
  assert.deepEqual(compareHarakat("ٱلْعَٰلَمِينَ", "الْعَالَمِينَ"), []);
  assert.deepEqual(compareHarakat("ٱلرَّحْمَٰنِ", "الرَّحْمَنِ"), []);
  assert.deepEqual(compareHarakat("ٱلصَّلَوٰةَ", "الصَّلَاةَ"), []);
  assert.deepEqual(compareHarakat("إِيَّاكَ", "إِيَّاكَ"), []);
});

test("wrong vowel is reported with the letter", () => {
  assert.deepEqual(compareHarakat("رَبِّ", "رَبَّ").map((d) => [d.letter, d.expected, d.heard]), [["ب", "كسرة", "فتحة"]]);
  assert.equal(compareHarakat("نَعْبُدُ", "نَعْبِدُ").length, 1);
});

test("stopping on the last letter of a verse is not a mistake", () => {
  assert.deepEqual(compareHarakat("ٱلدِّينِ", "الدِّينْ", { verseEnd: true }), []);
  assert.deepEqual(compareHarakat("أَحَدٌ", "أَحَدَ", { verseEnd: true }), []);
});

test("no diacritics or different letters cannot be judged", () => {
  assert.equal(compareHarakat("رَبِّ", "رب"), null);
  assert.equal(compareHarakat("قُلْ", "قَالَ").length, 1); // same consonants: reported as a vowel error
});

test("consonant skeleton agrees with the matcher for every word of the Quran", () => {
  let n = 0;
  for (let s = 1; s <= 114; s++) {
    for (const v of JSON.parse(readFileSync(new URL(`../data/surahs/${s}.json`, import.meta.url), "utf8"))) {
      for (const w of v.split(" ")) {
        assert.equal(vowelSeq(w).map((x) => x.c).join(""), skeleton(normalize(w)), w);
        n++;
      }
    }
  }
  assert.ok(n > 77000);
});

console.log(`\n${passed} tests passed`);
