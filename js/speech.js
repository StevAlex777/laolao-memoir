// Voice input: browser speech recognition (zh-CN) as a live draft, plus a recording of her voice.
// The recording is cut into ~1-minute clips; each clip is handed over (and saved) the moment it
// ends, so a crash or closed tab loses at most the last minute. Clips stay on this computer.

import { micProblem } from './core.js';

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const CLIP_MS = 60_000;

export const speechSupport = {
  recognition: !!Recognition,
  recording: !!(globalThis.MediaRecorder && navigator.mediaDevices?.getUserMedia),
};

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']) {
    if (globalThis.MediaRecorder?.isTypeSupported?.(m)) return m;
  }
  return '';
}

export class VoiceCapture {
  /** @param {{onText:(finalText:string, interim:string)=>void, onError:(problem:{kind:string,text:string})=>void, onClip:(clip:{blob:Blob,mime:string,durationMs:number})=>void}} cb */
  constructor(cb) {
    this.cb = cb;
    this.active = false;
    this.finalText = '';
  }

  async start(initialText = '') {
    this.finalText = initialText || '';
    this.active = true;
    if (speechSupport.recording) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        this.active = false;
        this.cb.onError(micProblem(e));
        return false;
      }
      this.#startClip();
      this.rotator = setInterval(() => this.#rotate(), CLIP_MS);
    }
    if (speechSupport.recognition) this.#startRecognition();
    return true;
  }

  #startClip() {
    const mimeType = pickMime();
    const rec = new MediaRecorder(this.stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 64000 });
    const chunks = [];
    const startedAt = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.done = new Promise((resolve) => {
      rec.onstop = () => {
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mime });
        if (blob.size) this.cb.onClip({ blob, mime, durationMs: Date.now() - startedAt });
        resolve();
      };
    });
    rec.start(1000);
    this.recorder = rec;
  }

  /** End the current clip and immediately begin the next one on the same microphone stream. */
  #rotate() {
    if (!this.active || !this.recorder) return;
    const old = this.recorder;
    this.#startClip();
    old.stop();
  }

  #startRecognition() {
    const r = new Recognition();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      this.cb.onText(this.finalText, interim);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      // Recording carries on; only the live draft text is affected.
      const text = e.error === 'not-allowed' ? '浏览器不允许语音识别。录音仍在继续；文字可以手动输入，或在文本框里按两下 fn 用 Mac 自带听写。'
        : e.error === 'network' ? '语音识别连不上网络服务。录音仍在继续，文字之后可以用录音精修。'
        : `语音识别出错（${e.error}），录音仍在继续。`;
      this.cb.onError({ kind: 'speech', text });
    };
    // Chrome ends recognition after a pause or a few minutes; keep it going while recording,
    // with a short delay so rapid restarts don't get throttled.
    r.onend = () => { if (this.active) setTimeout(() => { if (this.active) { try { r.start(); } catch { /* restarting */ } } }, 250); };
    this.recognition = r;
    try { r.start(); } catch { /* ignore double start */ }
  }

  /** Pause: finish the current clip and stop listening. The draft text is kept by the caller. */
  async stop() {
    this.active = false;
    clearInterval(this.rotator);
    try { this.recognition?.stop(); } catch { /* ignore */ }
    const rec = this.recorder;
    if (rec && rec.state !== 'inactive') { rec.stop(); await rec.done; }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = this.recognition = this.stream = null;
    return { text: this.finalText };
  }
}

/** Read a question aloud in Mandarin, a bit slower than default. */
export function speak(text) {
  if (!globalThis.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.85;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === 'zh-CN' && /Tingting|婷婷|Google/.test(v.name))
    || speechSynthesis.getVoices().find((v) => v.lang?.startsWith('zh'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
