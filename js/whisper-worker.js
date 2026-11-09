// Runs a Quran speech model (Tarteel's open whisper-*-ar-quran, ONNX) on the
// device, in a worker so the page stays responsive. The model is downloaded once
// from Hugging Face and then cached by the browser.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;

export const MODELS = {
  base: "YunusZJ/whisper-base-ar-quran-ONNX",
  tiny: "omartariq612/tarteel-ai-whisper-tiny-ar-quran-onnx",
};

let asr = null;
let loading = null;
let device = "wasm";

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

async function hasWebGPU() {
  try {
    const adapter = await Promise.race([self.navigator.gpu?.requestAdapter(), timeout(3000)]);
    return !!adapter;
  } catch {
    return false;
  }
}

function create(model, dev, files) {
  let downloaded = false;
  return pipeline("automatic-speech-recognition", model, {
    dtype: "q4",
    device: dev,
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        const loaded = Object.values(files).reduce((s, f) => s + f[0], 0);
        postMessage({ type: "progress", loaded });
      } else if (p.status === "done" && /decoder/.test(p.file || "") && !downloaded) {
        downloaded = true; // the big file is in: what's left is preparing it in memory
        postMessage({ type: "preparing" });
      }
    },
  });
}

async function load(opts) {
  if (asr) return asr;
  if (!loading) {
    loading = (async () => {
      const model = MODELS[opts.model] || MODELS.base;
      const files = {};
      // The graphics chip (WebGPU) is several times faster where it works, but on
      // some devices it hangs while preparing: give it 25 s, then use the CPU.
      if (opts.webgpu !== false && (await hasWebGPU())) {
        try {
          asr = await Promise.race([create(model, "webgpu", files), timeout(25000)]);
          device = "webgpu";
        } catch {
          asr = null;
          postMessage({ type: "webgpu-failed" });
        }
      }
      if (!asr) {
        asr = await create(model, "wasm", files);
        device = "wasm";
      }
      // Warm-up: the first run prepares the model, so do it now on a second of
      // silence instead of on the reciter's first phrase.
      postMessage({ type: "warming" });
      await asr(new Float32Array(16000), { language: "arabic", task: "transcribe" });
      return asr;
    })();
  }
  return loading;
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await load(msg);
      postMessage({ type: "ready", device });
    } else if (msg.type === "transcribe") {
      const model = await load({});
      const t0 = performance.now();
      const out = await model(msg.audio, { language: "arabic", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
      postMessage({ type: "result", id: msg.id, text: (out.text || "").trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    loading = null;
    asr = null;
    postMessage({ type: "error", id: msg.id, message: String((err && err.message) || err) });
  }
};
