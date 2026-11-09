// Runs the Quran speech model (Tarteel's open whisper-base-ar-quran, ONNX) on the
// device, in a worker so the page stays responsive. The model is downloaded once
// from Hugging Face and then cached by the browser.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL = "YunusZJ/whisper-base-ar-quran-ONNX";
env.allowLocalModels = false;

let asr = null;
let loading = null;

async function load() {
  if (asr) return asr;
  if (!loading) {
    const files = {};
    loading = pipeline("automatic-speech-recognition", MODEL, {
      dtype: "q4",
      device: "wasm",
      progress_callback: (p) => {
        if (p.status === "progress" && p.total) {
          files[p.file] = [p.loaded, p.total];
          const loaded = Object.values(files).reduce((s, f) => s + f[0], 0);
          const total = Object.values(files).reduce((s, f) => s + f[1], 0);
          postMessage({ type: "progress", loaded, total });
        }
      },
    }).then((p) => (asr = p));
  }
  return loading;
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await load();
      postMessage({ type: "ready" });
    } else if (msg.type === "transcribe") {
      const model = await load();
      const t0 = performance.now();
      const out = await model(msg.audio, { language: "arabic", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
      postMessage({ type: "result", id: msg.id, text: (out.text || "").trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    postMessage({ type: "error", id: msg.id, message: String((err && err.message) || err) });
  }
};
