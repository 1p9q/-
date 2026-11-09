// Microphone capture at 16 kHz with simple pause detection: every time the reciter
// pauses, the phrase just recited is handed over for analysis.

const RATE = 16000;

export class PhraseRecorder {
  /**
   * @param {{onPhrase:(audio:Float32Array)=>void, onLevel?:(speaking:boolean, rms:number)=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.active = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.src.connect(this.proc);
    this.proc.connect(this.ctx.destination);

    const ratio = this.ctx.sampleRate / RATE;
    let pos = 0; // fractional read position carried across buffers
    let prev = 0;
    this.chunks = [];
    this.segLen = 0;
    this.preroll = [];
    this.speaking = false;
    this.silence = 0;
    this.floor = 0.004;
    this.active = true;

    this.proc.onaudioprocess = (e) => {
      if (!this.active) return;
      const input = e.inputBuffer.getChannelData(0);
      // linear-interpolation resample to 16 kHz
      const out = [];
      while (pos < input.length) {
        const i = Math.floor(pos);
        const f = pos - i;
        const a = i === 0 ? prev : input[i - 1];
        const b = input[i];
        out.push(a + (b - a) * f);
        pos += ratio;
      }
      pos -= input.length;
      prev = input[input.length - 1];
      const buf = Float32Array.from(out);
      this._feed(buf);
    };
  }

  _feed(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const thr = Math.max(0.01, this.floor * 3);
    const loud = rms > thr;
    if (!this.speaking) this.floor = this.floor * 0.95 + Math.min(rms, 0.05) * 0.05;
    const dur = buf.length / RATE;

    if (!this.speaking) {
      this.preroll.push(buf);
      while (this.preroll.length > 2) this.preroll.shift(); // ~0.5 s before speech starts
      if (loud) {
        this.speaking = true;
        this.silence = 0;
        this.chunks = this.preroll.slice();
        this.segLen = this.chunks.reduce((s, c) => s + c.length, 0);
        this.preroll = [];
      }
    } else {
      this.chunks.push(buf);
      this.segLen += buf.length;
      this.silence = loud ? 0 : this.silence + dur;
      if (this.silence > 0.9 || this.segLen > RATE * 28) this._flush();
    }
    this.cb.onLevel && this.cb.onLevel(this.speaking, rms);
  }

  _flush() {
    const len = this.segLen;
    if (len > RATE * 0.6) {
      const audio = new Float32Array(len);
      let o = 0;
      for (const c of this.chunks) {
        audio.set(c, o);
        o += c.length;
      }
      this.cb.onPhrase(audio);
    }
    this.chunks = [];
    this.segLen = 0;
    this.speaking = false;
    this.silence = 0;
  }

  stop() {
    if (!this.active) return;
    if (this.speaking) this._flush();
    this.active = false;
    try {
      this.proc.disconnect();
      this.src.disconnect();
      this.stream.getTracks().forEach((t) => t.stop());
      this.ctx.close();
    } catch {}
  }
}
