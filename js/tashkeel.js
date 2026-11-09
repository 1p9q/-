// Experimental page: recitation check with an on-device Quran speech model that
// writes diacritics, so wrong harakat can be caught as well as wrong words.
import { buildWords, tokenize, align, summarize } from "./matcher.js";
import { compareHarakat } from "./harakat.js";
import { PhraseRecorder } from "./recorder.js";
import { store } from "./store.js";

const $app = document.getElementById("app");
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mb = (b) => ar((b / 1048576).toFixed(0));

let chapters = [];
const surahCache = new Map();
const loadSurah = (n) => {
  if (!surahCache.has(n)) surahCache.set(n, fetch(`data/surahs/${n}.json`).then((r) => r.json()));
  return surahCache.get(n);
};

// ---------- model worker (shared across views) ----------
// Two sizes of the same Tarteel model; sizes are the exact bytes downloaded.
const MODEL_INFO = {
  base: { bytes: 162453466, label: "الدقيقة", mbText: "١٥٥" },
  tiny: { bytes: 98000516, label: "الخفيفة", mbText: "٩٣" },
};
const LS = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};
let modelName = LS.get("tartil.model") === "tiny" ? "tiny" : "base";
let modelState = "idle"; // idle | loading | preparing | warming | ready | error
let modelLoaded = 0;
let modelError = "";
let modelDevice = "";
let worker = null;
let watchdog = null;
const pending = new Map();
let nextId = 1;
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

// A load that started but never finished means the browser closed the model
// (usually not enough memory) or the page was reloaded mid-way.
const unfinished = LS.get("tartil.loading");
const crashes = +(LS.get("tartil.crashes") || 0) + (unfinished ? 1 : 0);
if (unfinished) {
  LS.set("tartil.crashes", String(crashes));
  LS.set("tartil.loading", null);
  LS.set("tartil.nowebgpu", "1"); // the graphics-chip path is the usual suspect
}

function fail(message) {
  if (/load file|fetch|network|Failed to/i.test(message)) message = "تعذّر تحميل ملفات النموذج. تأكد من الاتصال بالإنترنت وأعد المحاولة.";
  else if (/memory|allocation|out of/i.test(message)) message = "ذاكرة الجهاز ما كفت لتجهيز النموذج.";
  clearTimeout(watchdog);
  modelState = "error";
  modelError = message;
  LS.set("tartil.loading", null);
  LS.set("tartil.crashes", String(+(LS.get("tartil.crashes") || 0) + 1));
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
  if (worker) worker.terminate();
  worker = null;
  notify();
}

// If nothing at all arrives from the worker for a long time while loading, it
// has died silently.
function kick() {
  clearTimeout(watchdog);
  if (modelState === "ready" || modelState === "error" || modelState === "idle") return;
  const limit = modelState === "loading" ? 60000 : 150000;
  watchdog = setTimeout(() => fail("توقّف تجهيز النموذج — غالباً ذاكرة الجهاز ما كفت."), limit);
}

function startWorker() {
  worker = new Worker(new URL("./whisper-worker.js", import.meta.url), { type: "module" });
  worker.onerror = (e) => {
    e.preventDefault?.();
    fail("تعطّل النموذج في المتصفح" + (e.message ? `: ${e.message}` : ""));
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") {
      if (modelState !== "preparing") modelState = "loading";
      modelLoaded = m.loaded;
    } else if (m.type === "preparing") modelState = "preparing";
    else if (m.type === "webgpu-failed") LS.set("tartil.nowebgpu", "1");
    else if (m.type === "warming") modelState = "warming";
    else if (m.type === "ready") {
      modelState = "ready";
      modelDevice = m.device;
      LS.set("tartil.loading", null);
      LS.set("tartil.crashes", "0");
      LS.set("tartil.modelCached", modelName);
    } else if (m.type === "result" || m.type === "error") {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.type === "result" ? p.resolve(m) : p.reject(new Error(m.message));
        if (m.type === "result") modelState = "ready";
      } else if (m.type === "error") return fail(m.message);
    }
    kick();
    notify();
  };
}

function loadModel() {
  if (modelState !== "idle" && modelState !== "error") return;
  if (!worker) startWorker();
  modelError = "";
  modelLoaded = 0;
  modelState = "loading";
  LS.set("tartil.loading", String(Date.now()));
  worker.postMessage({ type: "load", model: modelName, webgpu: LS.get("tartil.nowebgpu") !== "1" });
  kick();
  notify();
}

function switchModel(name) {
  if (name === modelName && modelState !== "error") return;
  if (worker) worker.terminate();
  worker = null;
  clearTimeout(watchdog);
  modelName = name;
  LS.set("tartil.model", name);
  modelState = "idle";
  loadModel();
}

function transcribe(audio) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error("النموذج غير جاهز"));
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}

function modelCard() {
  const info = MODEL_INFO[modelName];
  if (modelState === "ready")
    return `<div class="model ok">✓ نموذج التلاوة جاهز (النسخة ${info.label})${modelDevice === "webgpu" ? " ⚡ يستخدم معالج الرسوميات" : ""}</div>`;
  if (modelState === "preparing" || modelState === "warming")
    return `<div class="model"><div>✓ اكتمل التحميل · ⏳ جاري تجهيز النموذج في ذاكرة الجهاز…</div>
      <div class="progress indeterminate"><i></i></div><small class="muted">قد يأخذ حتى دقيقة على بعض الأجهزة.</small></div>`;
  if (modelState === "loading") {
    const pct = Math.min(100, Math.round((modelLoaded / info.bytes) * 100));
    return `<div class="model"><div>جاري تحميل نموذج التلاوة… ${ar(pct)}٪ (${mb(modelLoaded)} من ${info.mbText} ميجا)</div>
      <div class="progress"><i style="width:${pct}%"></i></div><small class="muted">يتحمّل مرة وحدة فقط ويبقى محفوظ في الجهاز.</small></div>`;
  }
  const offerTiny = modelName === "base" ? `<button class="btn small primary" id="tiny">جرّب النسخة الخفيفة (${MODEL_INFO.tiny.mbText} ميجا)</button>` : "";
  if (modelState === "error")
    return `<div class="model warn"><div>⚠️ ${esc(modelError)}</div>
      <div class="actions"><button class="btn small" id="retry">إعادة المحاولة</button>${offerTiny}</div></div>`;
  if (crashes > 0 && modelName === "base")
    return `<div class="model warn"><div>آخر محاولة لتجهيز النموذج ما اكتملت، غالباً لأن ذاكرة الجهاز ما كفت.</div>
      <div class="actions">${offerTiny}<button class="btn small" id="dl">أعد المحاولة بالنسخة الدقيقة</button></div></div>`;
  return `<div class="model">النموذج يحتاج تحميل أول مرة (حوالي ${info.mbText} ميجا). يُفضّل على شبكة واي فاي. <button class="btn small primary" id="dl">تحميل الآن</button></div>`;
}
function bindModelCard(root) {
  root.querySelector("#dl")?.addEventListener("click", loadModel);
  root.querySelector("#retry")?.addEventListener("click", loadModel);
  root.querySelector("#tiny")?.addEventListener("click", () => switchModel("tiny"));
}

// ---------- views ----------
let cleanup = null;
function setView(html) {
  if (cleanup) cleanup();
  cleanup = null;
  listeners.clear();
  $app.innerHTML = html;
  window.scrollTo(0, 0);
}

function topbar(title, back) {
  return `<header class="topbar">
    <a class="icon-btn" href="${back}" aria-label="رجوع">→</a>
    <h1>${esc(title)}</h1>
    <span class="beta">تجريبي</span>
  </header>`;
}

async function route() {
  if (!chapters.length) chapters = await fetch("data/chapters.json").then((r) => r.json());
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] && parts[1]) {
    const [from, to] = parts[1].split("-").map(Number);
    return viewRecite(+parts[0], from, to, parts[2] === "f" ? "follow" : "hidden");
  }
  return viewSetup(+parts[0] || (store.current() && store.data().last?.surah) || 1);
}
window.addEventListener("hashchange", route);

async function viewSetup(n) {
  const count = chapters[n - 1][1];
  const verses = await loadSurah(n);
  const opts = (sel, max) => Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${i + 1 === sel ? "selected" : ""}>${ar(i + 1)}</option>`).join("");
  setView(`
  ${topbar("تدقيق التشكيل", "./")}
  <main class="wrap">
    <div class="card intro">
      <b>🧪 صفحة تجريبية للمقارنة</b>
      <p>هنا يسمعك نموذج ذكاء اصطناعي مدرّب على تلاوة القرآن، يشتغل داخل جهازك، ويكتب ما يسمعه <b>بالتشكيل</b>. فيكشف أخطاء الحركات إضافة لأخطاء الكلمات.</p>
      <p class="muted">الحكم يظهر بعد كل وقفة (مو كلمة كلمة). اقرأ، ثم توقّف ثانية، وتتلوّن الكلمات.</p>
    </div>
    <div id="model">${modelCard()}</div>
    <form class="card setup" id="setup">
      <label>السورة <select name="surah">${chapters.map(([name], i) => `<option value="${i + 1}" ${i + 1 === n ? "selected" : ""}>${ar(i + 1)}. ${esc(name)}</option>`).join("")}</select></label>
      <div class="row">
        <label>من آية <select name="from">${opts(1, count)}</select></label>
        <label>إلى آية <select name="to">${opts(Math.min(count, 5), count)}</select></label>
      </div>
      <fieldset class="modes">
        <label><input type="radio" name="mode" value="h" checked /><span><b>🙈 اختبار حفظ</b><small>الآيات مخفية وتظهر بعد قراءتها</small></span></label>
        <label><input type="radio" name="mode" value="f" /><span><b>👀 قراءة مع متابعة</b><small>النص ظاهر ويتلوّن حسب قراءتك</small></span></label>
      </fieldset>
      <fieldset class="modes model-pick">
        <label><input type="radio" name="model" value="base" ${modelName === "base" ? "checked" : ""} /><span><b>🎯 النسخة الدقيقة</b><small>${MODEL_INFO.base.mbText} ميجا · أدق في التشكيل</small></span></label>
        <label><input type="radio" name="model" value="tiny" ${modelName === "tiny" ? "checked" : ""} /><span><b>🪶 النسخة الخفيفة</b><small>${MODEL_INFO.tiny.mbText} ميجا · للجوالات الأقدم، أقل دقة قليلاً</small></span></label>
      </fieldset>
      <button class="btn primary big" type="submit">ابدأ 🎙️</button>
    </form>
    <div class="legend card">
      <b>الألوان</b>
      <span class="w ok">صحيحة</span> <span class="w harakah">خطأ تشكيل</span> <span class="w wrong">كلمة خطأ</span> <span class="w missed">سقطت</span> <span class="w unchecked">صحيحة (التشكيل غير واضح)</span>
    </div>
  </main>`);
  const form = $app.querySelector("#setup");
  const sel = form.querySelector("[name=surah]");
  sel.addEventListener("change", () => (location.hash = `#/${sel.value}`));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    let from = +f.get("from"), to = +f.get("to");
    if (to < from) [from, to] = [to, from];
    const want = f.get("model") === "tiny" ? "tiny" : "base";
    if (want !== modelName) switchModel(want);
    else if (!(crashes > 0 && modelName === "base")) loadModel();
    location.hash = `#/${f.get("surah")}/${from}-${to}/${f.get("mode")}`;
  });
  const $model = $app.querySelector("#model");
  bindModelCard($model);
  listeners.add(() => {
    $model.innerHTML = modelCard();
    bindModelCard($model);
  });
}

async function viewRecite(n, from, to, mode) {
  const [name, count] = chapters[n - 1];
  from = Math.max(1, Math.min(count, from || 1));
  to = Math.max(from, Math.min(count, to || from));
  const verses = (await loadSurah(n)).slice(from - 1, to).map((text, i) => ({ surah: n, ayah: from + i, text }));
  const words = buildWords(verses);
  const verseEnd = new Set(verses.map((v) => words.findLastIndex((w) => w.ayah === v.ayah)));
  if (!(crashes > 0 && modelName === "base")) loadModel(); // after a crash, let the reciter choose

  let html = "";
  let wi = 0;
  for (const v of verses) {
    const c = v.text.split(/\s+/).filter(Boolean).length;
    for (let k = 0; k < c; k++, wi++) html += `<span class="w" data-i="${wi}">${esc(words[wi].display)}</span> `;
    html += `<span class="end" data-ayah="${v.ayah}">${ar(v.ayah)}</span> `;
  }
  const showBasmala = from === 1 && n !== 1 && n !== 9;
  const modeCode = mode === "hidden" ? "h" : "f";
  setView(`
  ${topbar(`سورة ${name} · ${ar(from)}–${ar(to)}`, `#/${n}`)}
  <main class="recite ${mode}" style="--qfont:${store.prefs().font}px">
    <div id="model">${modelCard()}</div>
    ${showBasmala ? `<div class="basmala">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>` : ""}
    <div class="mushaf" id="mushaf">${html}</div>
    <div class="heard" id="heard"></div>
    <div class="detail" id="detail" hidden></div>
    <div class="summary" id="summary" hidden></div>
  </main>
  <footer class="controls" id="controls">
    <button class="ctl" id="restart">↺<small>إعادة</small></button>
    <button class="mic" id="mic" aria-label="ابدأ"><span>🎙️</span></button>
    <button class="ctl" id="finish">✓<small>إنهاء</small></button>
  </footer>`);

  const $m = $app.querySelector("#mushaf");
  const spans = [...$m.querySelectorAll(".w")];
  const $heard = $app.querySelector("#heard");
  const $mic = $app.querySelector("#mic");
  const $model = $app.querySelector("#model");
  const $detail = $app.querySelector("#detail");
  const $summary = $app.querySelector("#summary");
  const $main = $app.querySelector(".recite");

  let phrases = []; // transcripts in order (null while processing)
  let busy = 0;
  let finished = false;
  let state = { status: words.map(() => "pending"), harakat: [], pointer: 0 };

  const refreshModel = () => {
    $model.innerHTML = modelState === "ready" ? "" : modelCard();
    bindModelCard($model);
    $mic.disabled = modelState !== "ready";
  };
  listeners.add(refreshModel);
  refreshModel();

  function evaluate(final) {
    const text = phrases.filter(Boolean).join(" ");
    const r = align(words, tokenize(text), { final });
    const status = r.status.slice();
    const harakat = [];
    status.forEach((s, i) => {
      if (s !== "ok" && s !== "corrected") return;
      const d = compareHarakat(words[i].display, r.heardRaw[i], { verseEnd: verseEnd.has(i) });
      if (d === null) {
        if (s === "ok") status[i] = "unchecked";
      } else if (d.length) {
        status[i] = "harakah";
        harakat[i] = d;
      }
    });
    state = { status, harakat, pointer: r.pointer, heardRaw: r.heardRaw, heard: r.heard };
    paint();
  }

  function paint() {
    spans.forEach((s, i) => (s.className = "w " + state.status[i] + (i === state.pointer && !finished ? " cur" : "")));
    $m.querySelectorAll(".end").forEach((e) => {
      const i = words.findLastIndex((w) => w.ayah === +e.dataset.ayah);
      e.classList.toggle("shown", state.status[i] !== "pending" || finished);
    });
    const el = spans[Math.min(state.pointer, spans.length - 1)];
    if (el && !finished) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // tap a word to see what was heard
  $m.addEventListener("click", (e) => {
    const el = e.target.closest(".w");
    if (!el) return;
    const i = +el.dataset.i;
    const st = state.status[i];
    if (st === "pending" && mode === "hidden" && !finished) return;
    const d = state.harakat[i];
    $detail.hidden = false;
    $detail.innerHTML = `<b class="q">${esc(words[i].display)}</b>
      ${state.heardRaw?.[i] ? `<div>سمعت: <b class="q">${esc(state.heardRaw[i])}</b></div>` : state.heard?.[i] ? `<div>سمعت: ${esc(state.heard[i])}</div>` : ""}
      ${d ? d.map((x) => `<div class="harakah-note">حرف «${esc(x.letter)}»: الصحيح ${x.expected}، وسمعت ${x.heard}</div>`).join("") : ""}
      ${st === "unchecked" ? `<div class="muted">الكلمة صحيحة، بس ما قدرت أتحقق من تشكيلها.</div>` : ""}`;
  });

  const recorder = new PhraseRecorder({
    onPhrase: async (audio) => {
      const slot = phrases.length;
      phrases.push(null);
      busy++;
      $heard.textContent = "⏳ أحلّل المقطع…";
      try {
        const res = await transcribe(audio);
        phrases[slot] = res.text;
        if (!finished) $heard.innerHTML = `سمعت: <span class="q">${esc(res.text)}</span>`;
      } catch (err) {
        phrases[slot] = "";
        $heard.textContent = "⚠️ " + err.message;
      }
      busy--;
      if (!finished) {
        evaluate(false);
        if (state.pointer >= words.length) finish();
      }
    },
    onLevel: (speaking) => $mic.classList.toggle("speaking", speaking),
  });

  async function startRec() {
    try {
      await recorder.start();
      $mic.classList.add("on");
      $heard.textContent = "🎙️ اقرأ… وتوقّف ثانية بعد كل مقطع";
    } catch (err) {
      $heard.textContent = "⚠️ الرجاء السماح باستخدام المايكروفون.";
    }
  }
  function stopRec() {
    recorder.stop();
    $mic.classList.remove("on", "speaking");
  }

  async function finish() {
    if (finished) return;
    stopRec();
    finished = true;
    $app.querySelector("#controls").hidden = true;
    if (busy) {
      $heard.textContent = "⏳ أكمل تحليل آخر مقطع…";
      while (busy) await new Promise((r) => setTimeout(r, 200));
    }
    evaluate(true);
    const all = phrases.filter(Boolean).join(" ");
    $heard.innerHTML = all ? `كل ما سمعته: <span class="q">${esc(all)}</span>` : "";
    $main.classList.add("done");
    const st = state.status;
    const c = summarize(st.map((s) => (s === "harakah" ? "wrong" : s === "unchecked" ? "ok" : s)));
    const harakahCount = st.filter((s) => s === "harakah").length;
    const unchecked = st.filter((s) => s === "unchecked").length;
    const wrongWords = st.filter((s) => s === "wrong").length;
    const list = st
      .map((s, i) => ({ s, i }))
      .filter((x) => ["harakah", "wrong", "missed", "corrected"].includes(x.s))
      .map(({ s, i }) => {
        const label = { harakah: "تشكيل", wrong: "كلمة خطأ", missed: "سقطت", corrected: "صحّحتها" }[s];
        const det = s === "harakah" ? state.harakat[i].map((x) => `«${esc(x.letter)}» ${x.expected} ← سمعت ${x.heard}`).join("، ") : state.heardRaw?.[i] || state.heard?.[i] || "";
        return `<li><b class="q">${esc(words[i].display)}</b> <span class="tag ${s}">${label}</span> <small>${esc(det)}</small> <small class="muted">آية ${ar(words[i].ayah)}</small></li>`;
      })
      .join("");
    $summary.hidden = false;
    $summary.innerHTML = `
      <div class="score ${c.accuracy >= 90 ? "great" : c.accuracy >= 70 ? "ok" : "low"}"><b>${ar(c.accuracy)}٪</b>
        <span>${c.total - c.pending === 0 ? "ما سمعت شي" : c.accuracy === 100 ? "ما شاء الله، بدون أخطاء! 🌟" : "راجع الأخطاء تحت"}</span></div>
      <div class="counts">
        <span class="ok">✓ ${ar(c.ok)} صحيحة</span>
        ${harakahCount ? `<span class="harakah">${ar(harakahCount)} خطأ تشكيل</span>` : ""}
        ${wrongWords ? `<span class="wrong">${ar(wrongWords)} كلمة خطأ</span>` : ""}
        ${c.missed ? `<span class="missed">${ar(c.missed)} سقطت</span>` : ""}
        ${unchecked ? `<span class="muted">${ar(unchecked)} تشكيلها غير واضح</span>` : ""}
      </div>
      ${list ? `<ul class="mistakes">${list}</ul>` : ""}
      <p class="muted small">المس أي كلمة في النص لترى ما سمعه النموذج.</p>
      <div class="actions">
        <a class="btn" href="#/${n}/${from}-${to}/${modeCode}" id="again">↺ أعد</a>
        ${to < count ? `<a class="btn primary" href="#/${n}/${to + 1}-${Math.min(count, to + 1 + (to - from))}/${modeCode}">التالي ←</a>` : `<a class="btn primary" href="./">🏠 الرئيسية</a>`}
      </div>`;
    $summary.scrollIntoView({ behavior: "smooth", block: "start" });
    $app.querySelector("#again").addEventListener("click", (e) => {
      e.preventDefault();
      viewRecite(n, from, to, mode);
    });
  }

  $mic.addEventListener("click", () => (recorder.active ? stopRec() : startRec()));
  $app.querySelector("#finish").addEventListener("click", finish);
  $app.querySelector("#restart").addEventListener("click", () => {
    stopRec();
    phrases = [];
    $detail.hidden = true;
    evaluate(false);
    $heard.textContent = "";
  });
  cleanup = () => stopRec();
  paint();
  $heard.textContent = modelState === "ready" ? "اضغط 🎙️ وابدأ القراءة" : "";
}

// Once the model has been downloaded and prepared on this device before, load it
// as soon as the page opens so it's ready by the time the surah is chosen (but
// not after a load that didn't finish, to avoid crashing again on open).
if (LS.get("tartil.modelCached") === modelName && !unfinished) loadModel();

route();
