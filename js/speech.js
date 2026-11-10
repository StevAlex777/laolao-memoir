// Voice input: browser speech recognition (zh-CN) + a raw recording of her voice.
// The recording never leaves this computer; only the recognized text is sent to Claude.

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

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
  /** @param {{onText:(finalText:string, interim:string)=>void, onError:(msg:string)=>void}} cb */
  constructor(cb) {
    this.cb = cb;
    this.active = false;
    this.finalText = '';
  }

  async start(initialText = '') {
    this.finalText = initialText || '';
    this.active = true;
    this.chunks = [];
    this.startedAt = Date.now();

    if (speechSupport.recording) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const mimeType = pickMime();
        this.recorder = new MediaRecorder(this.stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32000 });
        this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        this.recorder.start(1000);
      } catch (e) {
        this.active = false;
        this.cb.onError(e.name === 'NotAllowedError'
          ? '浏览器没有麦克风权限。请点地址栏左边的图标，允许使用麦克风，然后再试。'
          : `打不开麦克风：${e.message}`);
        return false;
      }
    }

    if (speechSupport.recognition) this.#startRecognition();
    return true;
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
      if (e.error === 'not-allowed') this.cb.onError('浏览器不允许语音识别。录音仍在继续；文字可以手动输入，或在文本框里按两下 Fn 用 Mac 自带听写。');
      else if (e.error === 'network') this.cb.onError('语音识别连不上网络服务。录音仍在继续，文字可以稍后手动补。');
      else this.cb.onError(`语音识别出错（${e.error}），录音仍在继续。`);
    };
    // Chrome ends recognition after a pause; keep it going while we're recording.
    r.onend = () => { if (this.active) { try { r.start(); } catch { /* already restarting */ } } };
    this.recognition = r;
    try { r.start(); } catch { /* ignore double start */ }
  }

  /** @returns {Promise<{text:string, audio: null | {blob: Blob, mime: string, durationMs: number}}>} */
  async stop() {
    this.active = false;
    try { this.recognition?.stop(); } catch { /* ignore */ }
    let audio = null;
    if (this.recorder && this.recorder.state !== 'inactive') {
      await new Promise((resolve) => { this.recorder.onstop = resolve; this.recorder.stop(); });
      const mime = this.recorder.mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: mime });
      if (blob.size) audio = { blob, mime, durationMs: Date.now() - this.startedAt };
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = this.recognition = this.stream = null;
    return { text: this.finalText, audio };
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
