// Thin wrapper around the browser's built-in speech recognition (Web Speech API).
// Free and needs no server of ours: Chrome sends audio to Google's recognizer,
// Safari to Apple's. Recognition stops on silence, so we restart it until stop().

const Recognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const speechSupported = !!Recognition;

export class Listener {
  /**
   * @param {{onText:(text:string)=>void, onState:(listening:boolean)=>void, onError:(code:string)=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.listening = false;
    this.committed = ""; // text from earlier recognition sessions
    this.current = "";
    this.rec = null;
  }

  get text() {
    return (this.committed + " " + this.current).trim();
  }

  reset() {
    this.committed = "";
    this.current = "";
  }

  start() {
    if (!Recognition || this.listening) return;
    this.listening = true;
    this.cb.onState(true);
    this._spawn();
  }

  stop() {
    this.listening = false;
    if (this.rec) {
      try {
        this.rec.stop();
      } catch {}
    }
    this.cb.onState(false);
  }

  _spawn() {
    const rec = new Recognition();
    this.rec = rec;
    rec.lang = "ar-SA";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      // Some Android builds repeat the whole transcript in each new result;
      // drop results that are a prefix of the next one.
      const parts = [];
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (!t) continue;
        if (parts.length && t.startsWith(parts[parts.length - 1])) parts[parts.length - 1] = t;
        else parts.push(t);
      }
      this.current = parts.join(" ");
      this.cb.onText(this.text);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // restart on end
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        this.listening = false;
        this.cb.onState(false);
      }
      this.cb.onError(e.error);
    };
    rec.onend = () => {
      this.committed = this.text;
      this.current = "";
      if (this.listening) {
        try {
          this._spawn();
        } catch {
          setTimeout(() => this.listening && this._spawn(), 300);
        }
      }
    };
    try {
      rec.start();
    } catch (err) {
      this.cb.onError(String(err && err.message || err));
    }
  }
}
