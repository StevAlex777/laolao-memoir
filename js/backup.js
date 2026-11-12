// Backups. Data lives only in this browser, so backups are the safety net.
//  - Quick backup (.json): all text — profile, interviews, timeline, chapters. Auto-downloaded after each session.
//  - Full backup (.zip): the same plus every voice recording.
import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/fflate-0.8.2.js';
import { db } from './db.js';
import { BACKUP_VERSION, validateBackup } from './core.js';

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };
const extFor = (mime) => EXT[String(mime).split(';')[0]] || 'webm';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function collect() {
  return {
    app: 'laolao-memoir',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: await db.getKV('profile', {}),
    webCues: await db.getKV('webCues', {}),
    sessions: await db.all('sessions'),
    turns: await db.all('turns'),
    timeline: await db.all('timeline'),
    chapters: await db.all('chapters'),
    photos: (await db.all('photos')).map(({ blob, ...meta }) => meta), // images themselves go in the full backup
  };
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export async function downloadQuickBackup() {
  const data = await collect();
  const name = `姥姥回忆录-备份-${stamp()}.json`;
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), name);
  await db.setKV('lastBackup', data.exportedAt);
  return name;
}

export async function downloadFullBackup() {
  const data = await collect();
  const files = { 'backup.json': strToU8(JSON.stringify(data, null, 1)) };
  for (const p of await db.all('photos')) files[`photos/${p.id}.jpg`] = [new Uint8Array(await p.blob.arrayBuffer()), { level: 0 }];
  for (const a of await db.all('audio')) {
    const buf = new Uint8Array(await a.blob.arrayBuffer());
    files[`audio/${a.id}.${extFor(a.mime)}`] = [buf, { level: 0 }]; // audio is already compressed
  }
  const zipped = zipSync(files);
  download(new Blob([zipped], { type: 'application/zip' }), `姥姥回忆录-完整备份含录音-${stamp()}.zip`);
  await db.setKV('lastBackup', data.exportedAt);
  await db.setKV('lastFullBackup', data.exportedAt);
}

/** Replace everything in this browser with the backup's contents. */
export async function restore(file) {
  let data;
  const audio = [];
  const photoBlobs = {};
  if (/\.zip$/i.test(file.name)) {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    if (!entries['backup.json']) throw new Error('压缩包里没有 backup.json，不是本应用的完整备份。');
    data = JSON.parse(strFromU8(entries['backup.json']));
    for (const [path, bytes] of Object.entries(entries)) {
      const pm = path.match(/^photos\/(.+)\.jpg$/);
      if (pm) { photoBlobs[pm[1]] = new Blob([bytes], { type: 'image/jpeg' }); continue; }
      const m = path.match(/^audio\/(.+)\.(\w+)$/);
      if (!m) continue;
      const mime = Object.entries(EXT).find(([, e]) => e === m[2])?.[0] || 'audio/webm';
      audio.push({ id: m[1], mime, blob: new Blob([bytes], { type: mime }) });
    }
  } else {
    data = JSON.parse(await file.text());
  }
  const problem = validateBackup(data);
  if (problem) throw new Error(problem);

  for (const s of ['sessions', 'turns', 'timeline', 'chapters']) {
    await db.clear(s);
    for (const row of data[s]) await db.put(s, row);
  }
  if (Object.keys(photoBlobs).length) {
    await db.clear('photos');
    for (const meta of data.photos || []) if (photoBlobs[meta.id]) await db.put('photos', { ...meta, blob: photoBlobs[meta.id] });
  }
  if (audio.length) {
    await db.clear('audio');
    for (const a of audio) await db.put('audio', a);
  }
  await db.setKV('profile', data.profile);
  if (data.webCues) await db.setKV('webCues', data.webCues);
  return { turns: data.turns.length, audio: audio.length, photos: Object.keys(photoBlobs).length };
}
