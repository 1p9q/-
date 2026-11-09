#!/usr/bin/env python3
"""Build the site's Quran data files from Tanzil JSON (via github.com/risan/quran-json).

Usage: python3 scripts/build-data.py <path-to-quran-json-checkout>

Writes:
  data/chapters.json      [[name, verseCount, type], ...]  (index 0 = surah 1)
  data/surahs/{n}.json    ["verse text", ...]  Uthmani script (Tanzil), with the
                          leading basmala of surahs 2..114 (except 9) split off,
                          because the site shows it as a header.
"""
import json
import os
import sys



def main(src: str) -> None:
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(os.path.join(root, "surahs"), exist_ok=True)

    chapters = json.load(open(os.path.join(src, "data/tanzil/chapters.json"), encoding="utf-8"))["chapters"]
    uthmani = json.load(open(os.path.join(src, "data/tanzil/uthmani.json"), encoding="utf-8"))

    basmala = uthmani["1"][0]["text"].split(" ")
    index = []
    for ch in chapters:
        n = ch["id"]
        verses = [v["text"].strip() for v in sorted(uthmani[str(n)], key=lambda v: v["verse"])]
        assert len(verses) == ch["total_verses"], n
        if n not in (1, 9):
            # The basmala is the first four words (a few surahs spell it with a
            # shadda on the ba, so compare against surah 1's words loosely).
            words = verses[0].split(" ")
            assert words[1:4] == basmala[1:4] and words[0].replace("\u0651", "") == basmala[0], n
            verses[0] = " ".join(words[4:])
        index.append([ch["name"], ch["total_verses"], "m" if ch["type"] == "meccan" else "d"])
        with open(os.path.join(root, "surahs", f"{n}.json"), "w", encoding="utf-8") as f:
            json.dump(verses, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(root, "chapters.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(index)} surahs")


if __name__ == "__main__":
    main(sys.argv[1])
