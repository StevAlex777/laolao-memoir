// Local speech refinement: talks to the Qwen3-ASR service installed on this Mac
// (asr/安装.command). Audio goes to 127.0.0.1 only. Without the service the app
// simply keeps the browser's live draft.
import { encodeWav } from './core.js';

const URL_BASE = 'http://127.0.0.1:8765';
const RATE = 16000;

/** {ready, model} when the service answers, otherwise null. */
export async function status() {
  try {
    const r = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Any recorded clip (webm/mp4) -> 16 kHz mono WAV, decoded by the browser itself. */
export async function toWav(blob) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
    const off = new OfflineAudioContext(1, frames, RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), RATE);
  } finally {
    ctx.close();
  }
}

/** Transcribe one clip. Throws on network/service errors so callers can retry later. */
export async function transcribe(blob, context = '') {
  const wav = await toWav(blob);
  const r = await fetch(`${URL_BASE}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', ...(context && { 'X-Context': encodeURIComponent(context) }) },
    body: wav,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!r.ok) throw new Error(`本机精修出错（${r.status}）`);
  return (await r.json()).text || '';
}

/** Second copy on disk via the local service (~/姥姥的回忆录/). kind: 'audio' | 'backup' | 'photo'. */
export async function archive(blob, kind, name) {
  const r = await fetch(`${URL_BASE}/archive?kind=${kind}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`存档失败（${r.status}）`);
  return (await r.json()).saved;
}
