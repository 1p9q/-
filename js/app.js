import { buildWords, tokenize, align, summarize } from "./matcher.js";
import { Listener, speechSupported } from "./speech.js";
import { store, today } from "./store.js";

const $app = document.getElementById("app");
const AVATARS = ["🌙", "⭐", "🌿", "🌸", "📖", "🕌", "🌴", "☀️", "🐪", "🦅"];
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let chapters = [];
const surahCache = new Map();
async function loadSurah(n) {
  if (!surahCache.has(n)) surahCache.set(n, fetch(`data/surahs/${n}.json`).then((r) => r.json()));
  return surahCache.get(n);
}

let cleanup = null; // called when leaving a view
function setView(html) {
  if (cleanup) cleanup();
  cleanup = null;
  $app.innerHTML = html;
  window.scrollTo(0, 0);
}

function go(hash) {
  location.hash = hash;
}

// ---------- routing ----------
async function route() {
  if (!chapters.length) chapters = await fetch("data/chapters.json").then((r) => r.json());
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  if (!store.current() || parts[0] === "profiles") return viewProfiles();
  if (parts[0] === "s" && parts[1]) return viewSetup(+parts[1]);
  if (parts[0] === "r" && parts[1]) {
    const [from, to] = (parts[2] || "1-1").split("-").map(Number);
    return viewRecite(+parts[1], from, to, parts[3] === "h" ? "hidden" : "follow");
  }
  if (parts[0] === "mistakes") return viewMistakes();
  if (parts[0] === "settings") return viewSettings();
  return viewHome();
}
window.addEventListener("hashchange", route);

function topbar(title, back = "#/") {
  const p = store.current();
  return `
  <header class="topbar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="رجوع">→</a>` : `<span class="brand">رفيق الحفظ</span>`}
    <h1>${esc(title)}</h1>
    <a class="who" href="#/profiles" title="تبديل الشخص">${p ? `${p.avatar || "🌙"} ${esc(p.name)}` : ""}</a>
  </header>`;
}

// ---------- profiles ----------
function viewProfiles() {
  const list = store.profiles();
  setView(`
  ${topbar("من يسمّع؟", list.length && store.current() ? "#/" : "")}
  <main class="wrap">
    <div class="profiles">
      ${list
        .map(
          (p) => `<button class="profile" data-id="${p.id}"><span class="avatar">${p.avatar || "🌙"}</span><span>${esc(p.name)}</span></button>`
        )
        .join("")}
    </div>
    <form class="card add-profile" id="addForm">
      <h2>${list.length ? "إضافة شخص" : "أهلاً بك 👋 ابدأ بإضافة اسمك"}</h2>
      <input name="name" required maxlength="20" placeholder="الاسم" autocomplete="off" />
      <div class="avatars">${AVATARS.map((a, i) => `<label><input type="radio" name="avatar" value="${a}" ${i === 0 ? "checked" : ""}/><span>${a}</span></label>`).join("")}</div>
      <button class="btn primary" type="submit">إضافة</button>
    </form>
    ${list.length ? `<p class="muted center">كل شخص له تقدمه الخاص على هذا الجهاز.</p>` : ""}
  </main>`);
  $app.querySelectorAll(".profile").forEach((b) =>
    b.addEventListener("click", () => {
      store.select(b.dataset.id);
      go("#/");
    })
  );
  $app.querySelector("#addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    if (!name) return;
    store.addProfile(name, f.get("avatar"));
    go("#/");
    route();
  });
}

// ---------- home ----------
function viewHome() {
  const d = store.data();
  const done = d.days[today()] || 0;
  const goal = d.goal;
  const streak = store.streak();
  const last = d.last;
  const pct = Math.min(100, Math.round((done / goal) * 100));
  setView(`
  ${topbar("", "")}
  <main class="wrap">
    <section class="stats">
      <div class="stat"><b>${ar(streak)}</b><span>أيام متتالية 🔥</span></div>
      <div class="stat goal">
        <div class="ring" style="--p:${pct}"><b>${ar(done)}/${ar(goal)}</b></div>
        <span>آيات اليوم</span>
      </div>
      <a class="stat link" href="#/mistakes"><b>${ar(Object.keys(d.words).length)}</b><span>كلمات للمراجعة</span></a>
    </section>
    ${
      last
        ? `<a class="card continue" href="#/r/${last.surah}/${last.from}-${last.to}/${last.mode === "hidden" ? "h" : "f"}">
            <span>تابع آخر تسميع</span><b>سورة ${esc(chapters[last.surah - 1][0])} · ${ar(last.from)}–${ar(last.to)}</b></a>`
        : ""
    }
    ${!speechSupported ? `<div class="card warn">المتصفح هذا ما يدعم التعرّف على الصوت. افتح الموقع من <b>Safari</b> على الآيفون أو <b>Chrome</b> على الأندرويد والكمبيوتر.</div>` : ""}
    <a class="card lab" href="tashkeel.html${last ? `#/${last.surah}` : ""}"><span>🧪 جديد (تجريبي)</span><b>تدقيق التشكيل بالذكاء الاصطناعي ←</b></a>
    <div class="search"><input id="q" type="search" placeholder="ابحث عن سورة…" autocomplete="off" /></div>
    <ol class="surahs" id="list">
      ${chapters
        .map(([name, count, type], i) => {
          const pr = store.surahProgress(i + 1, count);
          return `<li data-name="${esc(name)}" data-n="${i + 1}"><a href="#/s/${i + 1}">
            <span class="num">${ar(i + 1)}</span>
            <span class="nm"><b>${esc(name)}</b><small>${type === "m" ? "مكية" : "مدنية"} · ${ar(count)} آية</small></span>
            <span class="bar" title="محفوظ بدون أخطاء"><i style="width:${Math.round(pr.clean * 100)}%"></i><i class="tried" style="width:${Math.round(pr.tried * 100)}%"></i></span>
          </a></li>`;
        })
        .join("")}
    </ol>
    <nav class="footer-links"><a href="#/settings">⚙️ الإعدادات والنسخ الاحتياطي</a></nav>
  </main>`);
  const q = $app.querySelector("#q");
  const items = [...$app.querySelectorAll("#list li")];
  const norm = (s) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  q.addEventListener("input", () => {
    const v = norm(q.value.trim());
    items.forEach((li) => (li.hidden = v && !norm(li.dataset.name).includes(v) && li.dataset.n !== v.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS.indexOf(d))));
  });
}

// ---------- setup ----------
async function viewSetup(n) {
  const [name, count] = chapters[n - 1];
  const verses = await loadSurah(n);
  const d = store.data();
  // suggest the first verse not yet recited cleanly
  let start = 1;
  while (start <= count && d.ayat[`${n}:${start}`] && d.ayat[`${n}:${start}`].errs === 0) start++;
  if (start > count) start = 1;
  const end = Math.min(count, start + (count > 20 ? 4 : count));
  const opts = (sel) => verses.map((_, i) => `<option value="${i + 1}" ${i + 1 === sel ? "selected" : ""}>${ar(i + 1)}</option>`).join("");
  setView(`
  ${topbar(`سورة ${name}`)}
  <main class="wrap">
    <form class="card setup" id="setup">
      <div class="row">
        <label>من آية <select name="from">${opts(start)}</select></label>
        <label>إلى آية <select name="to">${opts(end)}</select></label>
      </div>
      <fieldset class="modes">
        <label><input type="radio" name="mode" value="h" checked /><span><b>🙈 اختبار حفظ</b><small>الآيات مخفية وتظهر كلمة كلمة مع قراءتك</small></span></label>
        <label><input type="radio" name="mode" value="f" /><span><b>👀 قراءة مع متابعة</b><small>النص ظاهر ويتلوّن حسب قراءتك</small></span></label>
      </fieldset>
      <button class="btn primary big" type="submit">ابدأ التسميع 🎙️</button>
    </form>
    <div class="ayah-list">
      ${verses
        .map((t, i) => {
          const a = d.ayat[`${n}:${i + 1}`];
          const cls = !a ? "" : a.errs === 0 ? "good" : "bad";
          return `<p class="${cls}"><span class="mark">${ar(i + 1)}</span> ${esc(t)}</p>`;
        })
        .join("")}
    </div>
  </main>`);
  const form = $app.querySelector("#setup");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    let from = +f.get("from");
    let to = +f.get("to");
    if (to < from) [from, to] = [to, from];
    go(`#/r/${n}/${from}-${to}/${f.get("mode")}`);
  });
}

// ---------- recite ----------
async function viewRecite(n, from, to, mode) {
  const [name, count] = chapters[n - 1];
  from = Math.max(1, Math.min(count, from || 1));
  to = Math.max(from, Math.min(count, to || from));
  const verses = (await loadSurah(n)).slice(from - 1, to).map((text, i) => ({ surah: n, ayah: from + i, text }));
  const words = buildWords(verses);
  const hinted = new Set();
  const accepted = new Set();
  const prefs = store.prefs();
  let result = align(words, [], { hinted, accepted });
  let finished = false;

  const showBasmala = from === 1 && n !== 1 && n !== 9;
  let html = "";
  let wi = 0;
  for (const v of verses) {
    const count = v.text.split(/\s+/).filter(Boolean).length;
    for (let k = 0; k < count; k++, wi++) html += `<span class="w" data-i="${wi}">${esc(words[wi].display)}</span> `;
    html += `<span class="end" data-ayah="${v.ayah}">${ar(v.ayah)}</span> `;
  }

  setView(`
  ${topbar(`سورة ${name} · ${ar(from)}–${ar(to)}`, `#/s/${n}`)}
  <main class="recite ${mode}" style="--qfont:${prefs.font}px">
    ${showBasmala ? `<div class="basmala">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>` : ""}
    <div class="mushaf" id="mushaf" dir="rtl">${html}</div>
    <div class="heard" id="heard" aria-live="polite"></div>
    <div class="summary" id="summary" hidden></div>
  </main>
  <footer class="controls" id="controls">
    <button class="ctl" id="listen" title="استمع للآية">🔊<small>استمع</small></button>
    ${mode === "hidden" ? `<button class="ctl" id="hint" title="أظهر الكلمة التالية">💡<small>تلميح</small></button>` : `<button class="ctl" id="toggle" title="إخفاء/إظهار">🙈<small>إخفاء</small></button>`}
    <button class="mic" id="mic" ${speechSupported ? "" : "disabled"} aria-label="ابدأ التسميع"><span>🎙️</span></button>
    <button class="ctl" id="restart" title="من البداية">↺<small>إعادة</small></button>
    <button class="ctl" id="finish" title="إنهاء">✓<small>إنهاء</small></button>
  </footer>`);

  const $m = $app.querySelector("#mushaf");
  const spans = [...$m.querySelectorAll(".w")];
  const $heard = $app.querySelector("#heard");
  const $mic = $app.querySelector("#mic");
  const $summary = $app.querySelector("#summary");
  const $main = $app.querySelector(".recite");
  let lastPointer = -1;

  function paint() {
    const { status, pointer } = result;
    spans.forEach((s, i) => {
      s.className = "w " + status[i] + (i === pointer && !finished ? " cur" : "");
    });
    $m.querySelectorAll(".end").forEach((e) => {
      const ay = +e.dataset.ayah;
      const lastIdx = words.findLastIndex((w) => w.ayah === ay);
      e.classList.toggle("shown", status[lastIdx] !== "pending" || finished);
    });
    if (pointer !== lastPointer) {
      lastPointer = pointer;
      const el = spans[Math.min(pointer, spans.length - 1)];
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function update(text, final = false) {
    result = align(words, tokenize(text), { hinted, accepted, final });
    $heard.textContent = text ? "سمعت: " + text.split(/\s+/).slice(-12).join(" ") : "";
    paint();
    if (!finished && result.pointer >= words.length && !result.status.includes("pending")) finish();
  }

  const listener = new Listener({
    onText: (t) => update(t),
    onState: (on) => {
      $mic.classList.toggle("on", on);
      $mic.setAttribute("aria-label", on ? "إيقاف" : "ابدأ التسميع");
      if (!on && !finished) $heard.textContent = listener.text ? "متوقف مؤقتاً — اضغط المايك للمتابعة" : "";
    },
    onError: (code) => {
      const msg = {
        "not-allowed": "الرجاء السماح باستخدام المايكروفون من إعدادات المتصفح.",
        "service-not-allowed": "التعرّف على الصوت غير مسموح. في الآيفون: الإعدادات ← عام ← لوحة المفاتيح ← فعّل الإملاء.",
        "audio-capture": "ما لقيت مايكروفون.",
        network: "تحتاج اتصال إنترنت للتعرّف على الصوت.",
      }[code];
      if (msg) $heard.textContent = "⚠️ " + msg;
    },
  });

  function finish() {
    if (finished) return;
    finished = true;
    listener.stop();
    result = align(words, tokenize(listener.text), { hinted, accepted, final: true });
    paint();
    const c = summarize(result.status);
    const recited = c.total - c.pending;
    if (recited > 0) store.recordSession({ surah: n, from, to, mode, words, status: result.status });
    const mistakes = result.status
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s !== "ok" && x.s !== "pending")
      .map(({ s, i }) => `<li><b>${esc(words[i].display)}</b> <span class="tag ${s}">${{ wrong: "خطأ", missed: "سقطت", corrected: "صحّحتها", hinted: "تلميح" }[s]}</span>${result.heard[i] && s === "wrong" ? ` <small>سمعت: ${esc(result.heard[i])}</small>` : ""} <small class="muted">آية ${ar(words[i].ayah)}</small></li>`)
      .join("");
    const nextFrom = to + 1;
    const nextTo = Math.min(count, to + (to - from + 1));
    const modeCode = mode === "hidden" ? "h" : "f";
    $main.classList.add("done");
    $summary.hidden = false;
    $summary.innerHTML = `
      <div class="score ${c.accuracy >= 90 ? "great" : c.accuracy >= 70 ? "ok" : "low"}">
        <b>${ar(c.accuracy)}٪</b><span>${recited === 0 ? "ما سمعت شي بعد" : c.accuracy === 100 ? "ما شاء الله، بدون أخطاء! 🌟" : c.accuracy >= 90 ? "ممتاز 👏" : c.accuracy >= 70 ? "جيد، راجع الكلمات تحت" : "تحتاج مراجعة"}</span>
      </div>
      <div class="counts">
        <span class="ok">✓ ${ar(c.ok)} صحيحة</span>
        ${c.wrong ? `<span class="wrong">✗ ${ar(c.wrong)} خطأ</span>` : ""}
        ${c.missed ? `<span class="missed">⊘ ${ar(c.missed)} سقطت</span>` : ""}
        ${c.corrected ? `<span class="corrected">↺ ${ar(c.corrected)} صحّحتها</span>` : ""}
        ${c.hinted ? `<span class="hinted">💡 ${ar(c.hinted)} تلميح</span>` : ""}
        ${c.pending ? `<span class="muted">${ar(c.pending)} لم تُقرأ</span>` : ""}
      </div>
      ${mistakes ? `<ul class="mistakes">${mistakes}</ul>` : ""}
      <div class="actions">
        <a class="btn" href="#/r/${n}/${from}-${to}/${modeCode}" id="again">↺ أعد التسميع</a>
        ${nextFrom <= count ? `<a class="btn primary" href="#/r/${n}/${nextFrom}-${nextTo}/${modeCode}">التالي: ${ar(nextFrom)}–${ar(nextTo)} ←</a>` : `<a class="btn primary" href="#/">🏠 الرئيسية</a>`}
      </div>`;
    $app.querySelector("#controls").hidden = true;
    $summary.scrollIntoView({ behavior: "smooth", block: "start" });
    $app.querySelector("#again").addEventListener("click", (e) => {
      e.preventDefault();
      viewRecite(n, from, to, mode);
    });
  }

  $mic.addEventListener("click", () => {
    if (listener.listening) listener.stop();
    else {
      stopAudio();
      listener.start();
    }
  });
  $app.querySelector("#restart").addEventListener("click", () => {
    listener.stop();
    listener.reset();
    hinted.clear();
    accepted.clear();
    lastPointer = -1;
    update("");
  });
  $app.querySelector("#finish").addEventListener("click", finish);
  // tap the current (gold-underlined) word when the recognizer can't catch it
  $m.addEventListener("click", (e) => {
    const el = e.target.closest(".w");
    if (!el || finished || +el.dataset.i !== result.pointer) return;
    accepted.add(result.pointer);
    update(listener.text);
  });
  $app.querySelector("#hint")?.addEventListener("click", () => {
    if (result.pointer < words.length) {
      hinted.add(result.pointer);
      update(listener.text);
    }
  });
  $app.querySelector("#toggle")?.addEventListener("click", (e) => {
    const hid = $main.classList.toggle("hidden");
    $main.classList.toggle("follow", !hid);
    e.currentTarget.querySelector("small").textContent = hid ? "إظهار" : "إخفاء";
  });

  // listen to a reciter (EveryAyah), from the current verse to the end of the range.
  // Verses are fetched ahead of time into memory, so playback starts at once and
  // there's no gap between verses; one <audio> element plays them all (iPhone
  // only lets an element that the user started keep playing).
  const audio = new Audio();
  let playing = false;
  let playToken = 0;
  const $listen = $app.querySelector("#listen");
  const pad = (x) => String(x).padStart(3, "0");
  const clips = new Map(); // ayah -> Promise<blob URL | null>
  function fetchAyah(ay) {
    if (ay < from || ay > to) return Promise.resolve(null);
    if (!clips.has(ay)) {
      const url = `https://everyayah.com/data/${prefs.reciter}/${pad(n)}${pad(ay)}.mp3`;
      clips.set(
        ay,
        fetch(url)
          .then((r) => (r.ok ? r.blob() : Promise.reject()))
          .then((b) => URL.createObjectURL(b))
          .catch(() => url) // fall back to streaming the file directly
      );
    }
    return clips.get(ay);
  }
  function stopAudio() {
    playing = false;
    playToken++;
    audio.pause();
    $listen.classList.remove("on", "loading");
  }
  async function playAyah(ay) {
    if (ay > to) return stopAudio();
    const token = ++playToken;
    $listen.classList.add("loading");
    const src = await fetchAyah(ay);
    if (token !== playToken || !playing) return;
    $listen.classList.remove("loading");
    fetchAyah(ay + 1); // get the next verse ready while this one plays
    audio.src = src;
    audio.dataset.ayah = ay;
    audio.play().catch(() => stopAudio());
  }
  audio.addEventListener("ended", () => playing && playAyah(+audio.dataset.ayah + 1));
  $listen.addEventListener("click", () => {
    if (playing) return stopAudio();
    listener.stop();
    playing = true;
    $listen.classList.add("on");
    const cur = words[Math.min(result.pointer, words.length - 1)];
    playAyah(cur ? cur.ayah : from);
  });
  // get the first verse ready as soon as the screen opens (small: ~100-200 KB)
  setTimeout(() => fetchAyah(from), 1500);

  cleanup = () => {
    listener.stop();
    stopAudio();
    for (const c of clips.values()) c.then((u) => u && u.startsWith("blob:") && URL.revokeObjectURL(u));
  };
  paint();
  if (!speechSupported) $heard.textContent = "⚠️ المتصفح لا يدعم التعرّف على الصوت. استخدم Safari أو Chrome.";
  else $heard.textContent = "اضغط 🎙️ وابدأ القراءة. إذا ما تلوّنت كلمة كمّل القراءة، أو المسها إذا متأكد إنك قلتها صح";
}

// ---------- mistakes ----------
async function viewMistakes() {
  const list = store.topMistakes(50);
  const surahs = new Map();
  for (const m of list) if (!surahs.has(m.surah)) surahs.set(m.surah, await loadSurah(m.surah));
  setView(`
  ${topbar("كلمات تخطئ فيها")}
  <main class="wrap">
    ${
      list.length
        ? `<ul class="mistake-list">${list
            .map((m) => {
              const words = surahs.get(m.surah)[m.ayah - 1].split(/\s+/);
              const ctx = words.map((w, i) => (i === m.index ? `<mark>${esc(w)}</mark>` : esc(w))).slice(Math.max(0, m.index - 4), m.index + 5).join(" ");
              return `<li>
                <p class="ctx">${ctx}</p>
                <div class="meta"><span>سورة ${esc(chapters[m.surah - 1][0])} · آية ${ar(m.ayah)} · ${ar(m.n)} مرة</span>
                <span><a class="btn small" href="#/r/${m.surah}/${m.ayah}-${m.ayah}/h">سمّعها</a>
                <button class="btn small ghost" data-k="${m.surah}:${m.ayah}:${m.index}">أتقنتها ✓</button></span></div>
              </li>`;
            })
            .join("")}</ul>`
        : `<div class="card center">ما فيه كلمات للمراجعة. ابدأ التسميع وبتظهر هنا الكلمات اللي تخطئ فيها.</div>`
    }
  </main>`);
  $app.querySelectorAll("[data-k]").forEach((b) =>
    b.addEventListener("click", () => {
      const [s, a, i] = b.dataset.k.split(":").map(Number);
      store.clearMistake(s, a, i);
      b.closest("li").remove();
    })
  );
}

// ---------- settings ----------
function viewSettings() {
  const d = store.data();
  const prefs = store.prefs();
  const p = store.current();
  const reciters = [
    ["Alafasy_128kbps", "مشاري العفاسي"],
    ["Husary_128kbps", "محمود خليل الحصري"],
    ["Husary_Muallim_128kbps", "الحصري (المعلّم)"],
    ["Minshawy_Murattal_128kbps", "محمد صديق المنشاوي"],
    ["Abdul_Basit_Murattal_192kbps", "عبد الباسط عبد الصمد"],
    ["Maher_AlMuaiqly_64kbps", "ماهر المعيقلي"],
    ["Yasser_Ad-Dussary_128kbps", "ياسر الدوسري"],
  ];
  setView(`
  ${topbar("الإعدادات")}
  <main class="wrap settings">
    <section class="card">
      <h2>الهدف اليومي</h2>
      <label class="row">عدد الآيات يومياً <input type="number" id="goal" min="1" max="300" value="${d.goal}" inputmode="numeric" /></label>
    </section>
    <section class="card">
      <h2>العرض والصوت</h2>
      <label class="row">حجم خط المصحف <input type="range" id="font" min="20" max="48" value="${prefs.font}" /></label>
      <p class="preview" id="preview" style="font-size:${prefs.font}px">ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ</p>
      <label class="row">القارئ <select id="reciter">${reciters.map(([k, v]) => `<option value="${k}" ${k === prefs.reciter ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    </section>
    <section class="card">
      <h2>نسخة احتياطية</h2>
      <p class="muted">التقدّم محفوظ على هذا الجهاز فقط. صدّر ملف واستورده في جهاز ثاني لنقل التقدّم.</p>
      <div class="actions"><button class="btn" id="export">⬇️ تصدير</button><label class="btn">⬆️ استيراد<input type="file" id="import" accept="application/json" hidden /></label></div>
    </section>
    <section class="card">
      <h2>الحساب</h2>
      <div class="actions"><a class="btn" href="#/profiles">تبديل الشخص</a><button class="btn danger" id="del">حذف ${esc(p.name)}</button></div>
    </section>
    <p class="muted center small">نص المصحف من <a href="https://tanzil.net" target="_blank" rel="noopener">Tanzil.net</a> · التلاوات من <a href="https://everyayah.com" target="_blank" rel="noopener">EveryAyah</a></p>
  </main>`);
  $app.querySelector("#goal").addEventListener("change", (e) => store.setGoal(+e.target.value));
  $app.querySelector("#font").addEventListener("input", (e) => {
    store.setPref("font", +e.target.value);
    $app.querySelector("#preview").style.fontSize = e.target.value + "px";
  });
  $app.querySelector("#reciter").addEventListener("change", (e) => store.setPref("reciter", e.target.value));
  $app.querySelector("#export").addEventListener("click", () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rafiq-alhifz-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $app.querySelector("#import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      alert("تم الاستيراد ✓");
      go("#/");
    } catch {
      alert("الملف غير صالح");
    }
  });
  $app.querySelector("#del").addEventListener("click", () => {
    if (confirm(`حذف ${p.name} وكل تقدّمه؟`)) {
      store.removeProfile(p.id);
      go("#/profiles");
      route();
    }
  });
}

route();
