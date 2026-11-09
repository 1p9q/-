// Family profiles and progress, kept in this browser's localStorage.
// Nothing leaves the device; use export/import to move progress between devices.

const KEY = "tartil.v1";

function blank() {
  return { profiles: [], current: null, data: {} };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch {}
  return blank();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function today(d = new Date()) {
  const z = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function profileData(id = state.current) {
  if (!state.data[id]) state.data[id] = { ayat: {}, words: {}, days: {}, sessions: [], goal: 10, last: null };
  return state.data[id];
}

export const store = {
  profiles: () => state.profiles,
  current: () => state.profiles.find((p) => p.id === state.current) || null,
  addProfile(name, avatar) {
    const id = Math.random().toString(36).slice(2, 10);
    state.profiles.push({ id, name: name.trim(), avatar, createdAt: Date.now() });
    state.current = id;
    profileData(id);
    save();
    return id;
  },
  removeProfile(id) {
    state.profiles = state.profiles.filter((p) => p.id !== id);
    delete state.data[id];
    if (state.current === id) state.current = state.profiles[0]?.id || null;
    save();
  },
  select(id) {
    state.current = id;
    save();
  },
  data: () => profileData(),
  setGoal(n) {
    profileData().goal = Math.max(1, Math.min(300, n | 0));
    save();
  },

  /**
   * Record a finished session.
   * @param {{surah:number, from:number, to:number, mode:string, words:object[], status:string[]}} s
   */
  recordSession(s) {
    const d = profileData();
    const now = Date.now();
    const perAyah = {};
    s.words.forEach((w, i) => {
      const st = s.status[i];
      if (st === "pending") return;
      const k = `${w.surah}:${w.ayah}`;
      perAyah[k] = perAyah[k] || { errs: 0, done: 0, len: 0 };
      perAyah[k].done++;
      if (st !== "ok") {
        perAyah[k].errs++;
        const wk = `${w.surah}:${w.ayah}:${w.index}`;
        d.words[wk] = (d.words[wk] || 0) + 1;
      }
    });
    s.words.forEach((w) => {
      const k = `${w.surah}:${w.ayah}`;
      if (perAyah[k]) perAyah[k].len++;
    });
    let completed = 0;
    for (const [k, v] of Object.entries(perAyah)) {
      if (v.done < v.len) continue; // only count fully recited verses
      completed++;
      const a = (d.ayat[k] = d.ayat[k] || { n: 0, clean: 0 });
      a.n++;
      a.last = now;
      a.errs = v.errs;
      if (v.errs === 0) a.clean++;
    }
    const day = today();
    d.days[day] = (d.days[day] || 0) + completed;
    const counts = s.status.reduce((c, x) => ((c[x] = (c[x] || 0) + 1), c), {});
    d.sessions.unshift({ at: now, surah: s.surah, from: s.from, to: s.to, mode: s.mode, counts, completed });
    d.sessions = d.sessions.slice(0, 100);
    d.last = { surah: s.surah, from: s.from, to: s.to, mode: s.mode };
    save();
    return completed;
  },

  /** Share of a surah's verses recited at least once with no mistakes (0..1), and attempted share. */
  surahProgress(surah, count) {
    const d = profileData();
    let clean = 0;
    let tried = 0;
    for (let a = 1; a <= count; a++) {
      const v = d.ayat[`${surah}:${a}`];
      if (!v) continue;
      tried++;
      if (v.errs === 0) clean++;
    }
    return { clean: clean / count, tried: tried / count };
  },

  streak() {
    const d = profileData();
    let n = 0;
    const day = new Date();
    if (!d.days[today(day)]) day.setDate(day.getDate() - 1); // today not done yet doesn't break it
    while (d.days[today(day)]) {
      n++;
      day.setDate(day.getDate() - 1);
    }
    return n;
  },

  /** Words this profile gets wrong most often. */
  topMistakes(limit = 30) {
    return Object.entries(profileData().words)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, n]) => {
        const [surah, ayah, index] = k.split(":").map(Number);
        return { surah, ayah, index, n };
      });
  },
  clearMistake(surah, ayah, index) {
    delete profileData().words[`${surah}:${ayah}:${index}`];
    save();
  },

  exportJSON: () => JSON.stringify(state),
  importJSON(text) {
    const next = JSON.parse(text);
    if (!next || !Array.isArray(next.profiles) || typeof next.data !== "object") throw new Error("bad file");
    // merge: imported profiles replace same-id ones, others are kept
    for (const p of next.profiles) {
      state.profiles = state.profiles.filter((x) => x.id !== p.id);
      state.profiles.push(p);
      state.data[p.id] = next.data[p.id] || {};
    }
    if (!state.current) state.current = state.profiles[0]?.id || null;
    save();
  },

  prefs() {
    state.prefs = state.prefs || { font: 30, reciter: "Alafasy_128kbps" };
    return state.prefs;
  },
  setPref(k, v) {
    store.prefs()[k] = v;
    save();
  },
};
