import { db } from './db.js';
import { VoiceCapture, speechSupport, speak } from './speech.js';
import * as ai from './ai.js';
import * as asr from './asr.js';
import * as photos from './photos.js';
import { downloadQuickBackup, downloadFullBackup, restore, collect } from './backup.js';
import {
  suggestStage, eventsForStage, yearRangeForStage, mergeTimeline, profileText,
  parseChapter, chapterMarkdown, daysSince, cryptoId, birthYear, nextBankQuestion,
  UNSORTED, FREE_QUESTION, isLocal, asrContext, applyRefined, PHOTO_QUESTION,
  AUDIO_ONLY, pickQuote, tildePath,
} from './core.js';

// Personal details are entered on first use and stay in this browser; nothing about her is in the code.
const DEFAULT_PROFILE = { name: '姥姥', gender: '女', birthDate: '', birthplace: '', places: '' };

const state = {
  view: 'interview',
  profile: null,
  stages: [],
  events: [],
  turns: [],        // answers: {id, role:'a', sessionId, stage, question, text, ts, audioIds[], free?}
  timeline: [],
  chapters: [],
  session: null,    // {id, stage, startedAt, endedAt}
  question: '',
  questionBusy: false,
  free: false,      // capturing something 姥姥 suddenly remembered
  returnQuestion: '',
  draft: '',
  interim: '',
  voice: null,
  recordingSince: 0,
  webCues: {},
  cueBusy: false,
  busy: '',
  openSources: null,
  openTimelineSrc: null,
  editing: null,
  chapterStream: {},
  micError: null,   // {kind, text}: the mic wouldn't open; shown beside the mic with 再试一次
  speechNote: '',   // live-recognition hiccup while recording continues; cleared when she speaks again
  ending: false,    // the end-of-session choice is open
  recap: null,      // what the session that just ended kept; shown once, then the start screen
  justSaved: null,  // {id, n}: the answer just saved, acknowledged beside the save button for a few seconds
  asrStatus: null,  // local Qwen3-ASR service, or null when not installed/running
  pendingClips: [], // audio ids recorded for the answer being composed (already saved to disk)
  pendingPhotos: [], // photo ids shown during the answer being composed
  persisted: null,   // browser promised not to evict our data under disk pressure
  editingPara: null, // 'stageId:index' of a chapter paragraph being edited
  tlEditing: null,   // 'new' or a timeline id being edited
};

const $app = document.getElementById('app');
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageById = (id) => state.stages.find((s) => s.id === id) || state.stages[0];
const answersFor = (pred) => state.turns.filter((t) => t.role === 'a' && pred(t)).sort((a, b) => a.ts - b.ts);
const hasAI = () => !!ai.getKey();
// The bank for this stage ran out: not a question, so it never takes the question's place.
const BANK_DONE = '__bank_done__';
const AFTER_BANK = '（题库问完后接着聊的）';
const hometown = () => state.profile.birthplace || '家乡';
/** Chinese has no spaces; wrap each clause so a line only breaks after punctuation. */
const clauses = (text) => String(text ?? '').split(/(?<=[，、？。！；：…])/).map((c) => `<span class="clause">${h(c)}</span>`).join('');

// One stroke family for every icon: 24 grid, 2px round strokes.
const ICONS = {
  speak: '<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  memory: '<path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/><path d="M12 8.2v4.6M9.7 10.5h4.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  print: '<path d="M7 9V4.5h10V9M7 17H5a1.5 1.5 0 0 1-1.5-1.5V10.5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><path d="M7 14h10v5.5H7z"/>',
  download: '<path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/>',
  back: '<path d="M10 6.5 4.5 12l5.5 5.5M5 12h14.5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  arrow: '<path d="M5 12h13.5M13 6.5 18.5 12 13 17.5"/>',
  photo: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><circle cx="9" cy="10.5" r="1.8"/><path d="m20.5 16-5-4.5-7 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (name, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- boot ----------
async function boot() {
  const [q, t] = await Promise.all([
    fetch('data/questions.json').then((r) => r.json()),
    fetch('data/timeline.json').then((r) => r.json()),
  ]);
  state.stages = q.stages;
  state.events = t.events;
  state.profile = { ...DEFAULT_PROFILE, ...(await db.getKV('profile', {})) };
  await db.setKV('profile', state.profile);
  state.turns = await db.all('turns');
  state.timeline = await db.all('timeline');
  state.chapters = await db.all('chapters');
  state.webCues = (await db.getKV('webCues')) || {}; // paid web searches are kept, not repeated
  const sessions = await db.all('sessions');
  state.session = sessions.find((s) => !s.endedAt) || null;
  if (state.session) {
    state.question = (await db.getKV('currentQuestion')) || stageById(state.session.stage).opening;
    state.draft = (await db.getKV('draft')) || '';
    state.pendingClips = (await db.getKV('pendingClips')) || [];
    state.pendingPhotos = (await db.getKV('pendingPhotos')) || [];
  }
  checkASR();
  setInterval(checkASR, 30_000);
  state.persisted = await db.persist();
  state.view = location.hash.slice(1) || 'interview';
  window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'interview', false));
  window.addEventListener('beforeunload', (e) => { if (state.voice) { e.preventDefault(); e.returnValue = ''; } });
  render();
}

function go(view, push = true) {
  state.view = view;
  state.micError = null;
  state.recap = null;
  if (push) location.hash = view;
  render();
  $app.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

// ---------- render ----------
function render() {
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'));
  document.getElementById('brand-name').textContent = `${state.profile.name || '姥姥'}的回忆录`;
  renderBackupPill();
  const views = { interview: viewInterview, timeline: viewTimeline, book: viewBook, settings: viewSettings, help: viewHelp };
  $app.innerHTML = (views[state.view] || viewInterview)();
  const box = document.getElementById('answer-box');
  if (box) {
    box.value = state.draft;
    box.addEventListener('input', () => { state.draft = box.value; saveDraftSoon(); });
  }
  hydratePhotos();
  fitBands();
  requestAnimationFrame(fitBands); // again once layout has settled
}

/** The stage band must never hide part of her life: drop to short names, then tighter padding, when it doesn't fit. */
function fitBands() {
  for (const band of document.querySelectorAll('.band')) {
    band.classList.remove('compact', 'tight');
    if (band.scrollWidth <= band.clientWidth + 1) continue;
    band.classList.add('compact');
    if (band.scrollWidth > band.clientWidth + 1) band.classList.add('tight');
  }
}
window.addEventListener('resize', () => { clearTimeout(fitBands.t); fitBands.t = setTimeout(fitBands, 100); });
document.fonts?.ready.then(() => fitBands());

// Photos render as <img data-photo=id>; object URLs are filled in after each render.
const photoUrls = new Map();
async function hydratePhotos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo;
    if (!photoUrls.has(id)) {
      const p = await db.get('photos', id);
      if (!p) continue;
      photoUrls.set(id, URL.createObjectURL(p.blob));
    }
    img.src = photoUrls.get(id);
  }
}
const thumbs = (ids, removable = false) => ids?.length ? `<div class="thumbs">${ids.map((id) => `<figure class="thumb"><img data-photo="${id}" alt="老照片">${removable ? `<button class="thumb-x" data-action="drop-photo" data-id="${id}" aria-label="去掉这张">×</button>` : ''}</figure>`).join('')}</div>` : '';
const figures = (ids) => (ids || []).map((id) => `<figure class="photo"><img data-photo="${id}" alt="老照片"></figure>`).join('');

async function renderBackupPill() {
  const pill = document.getElementById('backup-pill');
  const last = await db.getKV('lastBackup');
  const d = daysSince(last);
  pill.hidden = !state.turns.length;
  pill.textContent = last == null ? '还没有备份 · 点这里备份' : d === 0 ? '今天已备份' : `上次备份：${d} 天前`;
  pill.classList.toggle('stale', last == null || d >= 3);
}

function stageBand(activeId, action) {
  return `<div class="band" role="group" aria-label="人生阶段">${state.stages.map((s) => {
    const n = answersFor((t) => t.stage === s.id).length;
    const cls = s.id === activeId ? 'on' : n ? 'done' : '';
    return `<button class="band-seg ${cls}" data-action="${action}" data-stage="${s.id}" aria-pressed="${s.id === activeId}" title="${h(s.title)} · ${n ? `已聊 ${n} 段` : '还没聊'}"><span class="full">${h(s.title)}</span><span class="short" aria-hidden="true">${h(s.short || s.title)}</span>${n ? `<span class="n" aria-hidden="true">${n}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

function stageSelect(t) {
  return `<label class="assign">归到
    <select data-assign="${t.id}">
      <option value="${UNSORTED}" ${t.stage === UNSORTED ? 'selected' : ''}>待归类</option>
      ${state.stages.map((s) => `<option value="${s.id}" ${t.stage === s.id ? 'selected' : ''}>${h(s.title)}</option>`).join('')}
    </select></label>`;
}

// ---------- interview ----------
function viewInterview() {
  if (!state.session) return state.recap ? viewRecap() : viewStart();
  const stage = stageById(state.session.stage);
  const sessionAnswers = answersFor((t) => t.sessionId === state.session.id);
  const rec = !!state.voice;
  const locked = state.questionBusy || !!state.busy || state.ending;
  const firstTime = !state.turns.some((t) => t.role === 'a'); // explain the modes once; after the first answer they're known

  const questionBlock = state.free
    ? `<h1 class="q free">姥姥想起来的事</h1>
       <p class="q-sub">${clauses(`不用管问题，让姥姥想说什么就说什么。说完点保存${hasAI() ? '，AI 会把它归到对应的人生阶段，再顺着往下问' : '，先放进「待归类」，以后再归到对应阶段'}。`)}</p>
       <div class="pills"><button class="pill" data-action="cancel-free" ${rec ? 'disabled' : ''}>${icon('back')}回到原来的问题</button></div>`
    : state.question === BANK_DONE && !state.questionBusy
    ? `<div class="bank-done" role="status"><p><b>「${h(stage.title)}」的题库问完了。</b>点上面换一个人生阶段接着聊；也可以让姥姥想到什么说什么，录完照样点保存。</p></div>`
    : `<h1 class="q ${state.questionBusy ? 'loading' : ''}" id="question" aria-live="polite">${clauses(state.question)}</h1>
       <div class="pills">
         <button class="pill" data-action="speak" ${state.questionBusy ? 'disabled' : ''}>${icon('speak')}读给姥姥听</button>
         <button class="pill" data-action="other-question" ${locked || rec ? 'disabled' : ''}>${icon('refresh')}换个问题</button>
       </div>`;

  return `<div class="interview ${state.ending ? 'is-ending' : ''}">
    <section class="work">
      <div class="work-top">
        ${stageBand(state.free ? null : stage.id, 'switch-stage')}
      </div>
      ${questionBlock}
      ${thumbs(state.pendingPhotos, true)}
      <div class="rec">
        <div class="mic-col">
          <button class="mic ${rec ? 'recording' : ''}" data-action="toggle-mic" aria-pressed="${rec}" aria-keyshortcuts="Space">
            ${icon(rec ? 'pause' : 'mic', 34)}<span>${rec ? '暂停' : state.draft.trim() || state.pendingClips.length ? '继续说' : '开始说'}</span>
          </button>
          <div class="mic-time" id="mic-time">${rec ? '0:00' : ''}</div>
          ${state.free ? '' : `<button class="pill strong" data-action="free-memory" aria-keyshortcuts="F" ${locked ? 'disabled' : ''}>${icon('memory')}姥姥想起别的事</button>`}
        </div>
        <div class="well-col">
          <textarea id="answer-box" class="well ${rec ? 'live' : ''}" aria-label="姥姥说的话" placeholder="${rec ? '姥姥说的话会出现在这里…' : '点「开始说」录音，姥姥说的话会自动变成文字；也可以直接打字，随时能改。'}"></textarea>
          ${state.micError ? `<div class="mic-alert" role="alert"><p>${h(state.micError.text)}</p><button class="pill" data-action="mic-retry">${icon('mic')}再试一次</button></div>`
            : `<div class="interim ${state.speechNote ? 'error' : ''}" id="interim" role="status">${h(state.speechNote || state.interim)}</div>`}
          ${!speechSupport.recognition ? `<p class="mode-note">这个浏览器不能把语音直接转成文字（建议用 Chrome）。录音照常保存；文字可以打字，或点进文本框后按两下 <kbd>fn</kbd> 用 Mac 听写。</p>` : ''}
          <div class="actions">
            <button class="btn-primary" data-action="save-answer" ${locked ? 'disabled' : ''}>${state.free ? '保存这段回忆' : '保存，问下一个'}${icon('arrow')}</button>
            ${state.justSaved ? `<span class="saved-note" id="saved-note" role="status">已记下第 ${state.justSaved.n} 段 · <button class="link" data-action="edit-saved" data-id="${state.justSaved.id}">改一下</button></span>`
              : `<button class="pill quiet" data-action="clear-draft" ${rec ? 'disabled' : ''}>清空</button>
            <span class="hint keys"><kbd>空格</kbd> 录音 / 暂停（文本框里 <kbd>⌥</kbd>+<kbd>空格</kbd>）· ${state.free ? '' : '<kbd>F</kbd> 想起别的事 · '}<kbd>⌘</kbd>+<kbd>回车</kbd> 保存</span>
            <a class="hint help-link" href="#help">怎么用？</a>`}
          </div>
          ${firstTime ? `<div class="first-hints">
            ${state.free ? '' : '<p class="hint">姥姥说起了和问题无关的事？点左边「姥姥想起别的事」单独记下，不用管问题。</p>'}
            ${state.asrStatus?.ready ? '<p class="hint">本机精修已连接：保存后会用录音自动校正文字。</p>' : ''}
            ${!hasAI() ? '<p class="hint">现在按题库提问。在「设置」里填上 Claude 密钥，AI 就会接着姥姥的话追问。</p>' : ''}
          </div>` : ''}
        </div>
      </div>
      ${state.busy ? `<p class="busy"><span class="spinner"></span>${h(state.busy)}</p>` : ''}
      ${state.ending ? endChoice() : `<div class="session-end">
        <div><b>今天聊完了？</b><span class="hint">结束后会把这次聊的内容存好，${hasAI() ? '整理进人生时间线，' : ''}并自动下载一份备份。</span></div>
        <button class="pill" data-action="end-session" ${state.busy || rec ? 'disabled' : ''}>结束这次访谈</button>
      </div>`}
      ${sessionAnswers.length ? `<section class="log" aria-label="这次记下的">
        <h2 class="log-title">这次记下的 · ${sessionAnswers.length} 段</h2>
        ${sessionAnswers.slice().reverse().map(logItem).join('')}
      </section>` : ''}
    </section>
    ${eraAside(stage)}
  </div>`;
}

/** Something typed, recorded or shown that isn't an answer yet. */
function hasUnsaved() {
  const box = document.getElementById('answer-box');
  if (box) state.draft = box.value;
  return !!(state.draft.trim() || state.pendingClips.length || state.pendingPhotos.length);
}

/** Ending with an unsaved answer: decide in place, never by a browser dialog. */
function endChoice() {
  const text = state.draft.trim();
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return `<div class="session-end ending" id="end-choice" tabindex="-1" role="group" aria-labelledby="end-title">
    <div class="end-copy">
      <b id="end-title">这段还没保存</b>
      ${preview ? `<q class="end-quote">${h(preview)}</q>` : `<span class="hint">只有录音，还没有文字。</span>`}
      <span class="hint">${preview && state.pendingClips.length ? '不保存的话，这段的文字不留，录音也不会放进回忆录。' : preview ? '不保存的话，这段文字就不留了。' : '不保存的话，这段录音不会放进回忆录。'}</span>
    </div>
    <div class="end-choices">
      <button class="btn-primary small" data-action="end-save" id="end-first">保存并结束</button>
      <button class="pill danger" data-action="end-discard">不保存，结束</button>
      <button class="pill quiet" data-action="end-cancel">还没聊完</button>
    </div>
  </div>`;
}

function logItem(t) {
  if (state.editing === t.id) {
    return `<article class="log-item">
      <div class="log-q">${h(t.question)}</div>
      <textarea class="well small" id="edit-${t.id}">${h(t.text)}</textarea>
      <div class="actions"><button class="btn-primary small" data-action="save-edit" data-id="${t.id}">保存修改</button><button class="pill quiet" data-action="cancel-edit">取消</button></div>
    </article>`;
  }
  return `<article class="log-item ${t.free ? 'is-free' : ''}">
    <div class="log-q">${t.free ? '姥姥主动讲的' : h(t.question)}</div>
    <p class="log-a">${h(t.text)}</p>
    ${thumbs(t.photoIds)}
    <div class="log-tools">
      ${t.audioIds?.length ? `<button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听原声</button>` : ''}
      <button class="link" data-action="edit" data-id="${t.id}">${icon('edit', 16)}改文字</button>
      ${t.refined && t.refined !== t.text ? `<button class="link" data-action="use-refined" data-id="${t.id}">改用精修稿</button>` : t.refined ? '<span class="hint">已精修</span>' : ''}
      ${t.free ? stageSelect(t) : ''}
      <button class="link danger" data-action="delete-answer" data-id="${t.id}">删除这段</button>
    </div>
  </article>`;
}

/** The close of a session: what was kept, one line of hers, where the backup went, where to pick up. */
function viewRecap() {
  const r = state.recap;
  const minutes = r.audioMs >= 60_000 ? `录了 ${Math.round(r.audioMs / 60_000)} 分钟的声音` : r.audioMs ? '录了不到一分钟的声音' : '';
  const kept = [`记下 ${r.count} 段`, minutes, r.added ? `人生时间线新增 ${r.added} 条` : ''].filter(Boolean).join('，');
  return `<div class="start recap">
    <h1 class="display">今天聊完了</h1>
    ${r.quote ? `<figure class="recap-quote"><blockquote>${clauses(r.quote)}</blockquote><figcaption>${h(state.profile.name)}今天说的</figcaption></figure>` : ''}
    <p class="lede">${h(kept)}。${r.stages.length ? `聊到了${r.stages.map((s) => `「${h(s)}」`).join('')}。` : ''}</p>
    <dl class="recap-facts">
      <div><dt>备份</dt><dd>${r.file ? `<b>${h(r.file)}</b>，在这台电脑的「下载」文件夹里。` : r.file === '' ? '已经下载到这台电脑的「下载」文件夹里。' : '这次没能自动下载备份，请到「设置」里手动备份一份。'}${r.archived ? `另存了一份在「${h(r.archived)}」。` : ''}隔几天把完整备份发给家人存一份。</dd></div>
      <div><dt>下次</dt><dd>建议从「${h(stageById(r.next).title)}」接着聊。</dd></div>
    </dl>
    <div class="pills">
      <button class="btn-primary" data-action="recap-done">好${icon('arrow')}</button>
      <button class="pill" data-action="goto" data-view="book">看看回忆录</button>
    </div>
  </div>`;
}

function viewSetup() {
  const p = state.profile;
  return `<div class="start">
    <h1 class="display">先认识一下${h(p.name)}</h1>
    <p class="lede">填好出生日期和家乡，访谈时旁边的「那一年」才能列出她那个年纪发生的事。这些只存在这台电脑上。</p>
    <div class="setup">
      <div class="field"><label for="s-name">称呼</label><input id="s-name" value="${h(p.name)}"></div>
      <div class="field"><label for="s-birth">出生日期</label><input id="s-birth" type="date" min="1900-01-01" max="2000-12-31"></div>
      <div class="field"><label for="s-place">出生地 / 主要生活的地方</label><input id="s-place" placeholder="比如：哪个省、哪个县"></div>
    </div>
    <button class="btn-primary" data-action="save-setup">好了，开始${icon('arrow')}</button>
  </div>`;
}

function viewStart() {
  if (!state.profile.birthDate) return viewSetup();
  const suggested = suggestStage(state.stages, state.turns);
  const total = answersFor(() => true).length;
  const unsorted = answersFor((t) => t.stage === UNSORTED).length;
  return `<div class="start">
    <h1 class="display">${total ? '接着聊吧' : `陪${h(state.profile.name)}聊聊她的一生`}</h1>
    <p class="lede">${total ? `已经记下 ${total} 段。` : '每次聊二三十分钟就好，姥姥累了随时停。'}点一个人生阶段就开始，${hasAI() ? 'AI 会接着姥姥的话一个一个地问' : '会按题库一个一个地问'}。</p>
    ${stageBand(suggested, 'start-session')}
    <p class="hint">${total ? `深色的是已经聊过的阶段。建议从「${h(stageById(suggested).title)}」接着聊。` : '建议从「家乡与家人」聊起，聊过的阶段会变成深色。'}${unsorted ? ` 还有 ${unsorted} 段回忆待归类，在「回忆录」里可以归一下。` : ''}</p>
    <div class="start-free"><button class="pill strong" data-action="start-free" data-stage="${suggested}">${icon('memory')}姥姥想起别的事</button><span class="hint">不选阶段，先把她想说的录下来，放进「待归类」。</span></div>
    ${total ? '' : `<p class="hint">第一次用？先花两分钟看看顶上的「使用说明」。</p>`}
    ${!hasAI() ? `<p class="mode-note">没填 Claude 密钥也完全能用：按题库提问、录音、存档、整理成稿。填上密钥后会多出 AI 追问、自动整理时间线和写成文章。</p>` : ''}
  </div>`;
}

function eraAside(stage) {
  const range = yearRangeForStage(stage, state.profile.birthDate);
  if (!range) return `<aside class="era" aria-label="那一年"><div class="era-head"><h2>那一年</h2></div><p class="era-note">在「设置」里填上出生日期，这里会列出她那个年纪发生的事。</p></aside>`;
  const { from, to } = range;
  const offline = eventsForStage(state.events, stage, state.profile.birthDate);
  const web = state.webCues[stage.id] || [];
  const cue = (c, isWeb) => `<article class="cue">
    <div class="cue-top"><span class="cue-year">${c.year}${c.yearEnd ? `–${String(c.yearEnd).slice(2)}` : ''}</span>
      <span class="tag ${isLocal(c.region) ? 'local' : ''}">${h(c.region)}</span>${isWeb ? '<span class="tag">网上找到</span>' : ''}</div>
    <h3 class="cue-title">${h(c.title)}</h3>
    <p class="cue-summary">${h(c.summary)}</p>
    <p class="cue-q">“${h(c.cue)}”</p>
    <div class="cue-tools"><button class="link" data-action="use-cue" data-q="${h(c.cue)}">用这个问</button>
      <a href="${h(c.source.url)}" target="_blank" rel="noopener">出处：${h(c.source.title)}</a></div>
  </article>`;
  return `<aside class="era" aria-label="那一年">
    <div class="era-head"><h2>那一年</h2><span>${from}–${to} 年 · ${h(state.profile.name)} ${stage.ageFrom}–${to - birthYear(state.profile)} 岁</span></div>
    <p class="era-note">只用来帮姥姥想起往事，是参考资料，不写进她的自述。</p>
    ${web.map((c) => cue(c, true)).join('')}
    ${offline.map((c) => cue(c, false)).join('') || '<p class="era-note">这个阶段暂无内置资料。</p>'}
    ${hasAI()
      ? `<button class="pill" data-action="find-cues" ${state.cueBusy ? 'disabled' : ''}>${state.cueBusy ? '<span class="spinner"></span>正在查找，约半分钟' : `${icon('search')}上网找${h(hometown())}当年的事`}</button><p class="era-note">每次大约一块钱，找到的资料会一直留在这里。</p>`
      : `<p class="era-note">填上密钥后，可以上网找更多${h(hometown())}当年的事。</p>`}
  </aside>`;
}

// ---------- timeline ----------
function tlForm(e = {}) {
  return `<div class="tl-form">
    <div class="field"><label for="tl-year">年份</label><input id="tl-year" type="number" min="1900" max="2100" value="${h(e.year ?? '')}" placeholder="比如 1966"></div>
    <div class="field"><label for="tl-place">地点</label><input id="tl-place" value="${h(e.place ?? '')}" placeholder="可不填"></div>
    <div class="field wide"><label for="tl-event">发生了什么</label><textarea id="tl-event" rows="2">${h(e.event ?? '')}</textarea></div>
    <div class="field wide"><label for="tl-people">人物（用顿号隔开，可不填）</label><input id="tl-people" value="${h((e.people || []).join('、'))}"></div>
    <div class="actions"><button class="btn-primary small" data-action="tl-save" data-id="${h(e.id ?? '')}">保存</button><button class="pill quiet" data-action="tl-cancel">取消</button></div>
  </div>`;
}

function viewTimeline() {
  const pending = pendingExtraction().length;
  const aiBtn = hasAI() && pending
    ? `<button class="btn-primary small" data-action="tl-extract-all" ${state.busy ? 'disabled' : ''}>用 AI 整理还没整理过的 ${pending} 段回答</button>`
    : '';
  const addBtn = state.tlEditing === 'new' ? tlForm()
    : `<div class="pills">${aiBtn}<button class="pill" data-action="tl-new">${icon('plus')}添加一条</button></div>${state.busy ? `<p class="busy"><span class="spinner"></span>${h(state.busy)}</p>` : ''}${!hasAI() && pending ? `<p class="hint">有 ${pending} 段回答还没整理进时间线。在「设置」里填上 Claude 密钥后，可以一键让 AI 整理。</p>` : ''}`;
  if (!state.timeline.length) {
    return `<div class="page narrow"><h1 class="display">人生时间线</h1><p class="lede">${hasAI()
      ? '每次「结束这次访谈」时，AI 会把姥姥讲到的事按年份整理到这里。也可以自己添加。'
      : '可以自己添加家里知道的事。填上 Claude 密钥后，每次结束访谈 AI 也会把姥姥讲到的事整理到这里。'}</p>${addBtn}</div>`;
  }
  const sorted = [...state.timeline].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  const groups = {};
  for (const e of sorted) (groups[e.year ? `${Math.floor(e.year / 10) * 10} 年代` : '年份不详'] ??= []).push(e);
  return `<div class="page narrow">
    <h1 class="display">${h(state.profile.name)}的人生时间线</h1>
    <p class="lede">AI 从访谈里整理的条目都能点「原话」核对；整理错了可以修改或删掉，家里知道的事也可以自己添加。</p>
    <div class="tl-add">${addBtn}</div>
    ${Object.entries(groups).map(([dec, items]) => `<section class="decade"><h2>${dec}</h2>${items.map((e) => state.tlEditing === e.id ? tlForm(e) : `
      <div class="tl-item">
        <div class="tl-when">${e.year ?? '—'}<small>${e.age != null ? `${e.age} 岁` : ''}${e.place ? ` · ${h(e.place)}` : ''}</small></div>
        <div class="tl-what">${h(e.event)}${e.people?.length ? `<small>人物：${h(e.people.join('、'))}</small>` : ''}
          ${state.openTimelineSrc === e.id ? (e.turnIds || []).map((id) => {
            const t = state.turns.find((x) => x.id === id);
            return t ? `<div class="src"><small>${t.free ? '姥姥主动讲的' : h(t.question)}</small>${h(t.text)}${t.audioIds?.length ? ` <button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听</button>` : ''}</div>` : '';
          }).join('') : ''}
        </div>
        <div class="tl-tools">${e.turnIds?.length ? `<button class="link" data-action="tl-src" data-id="${e.id}">${state.openTimelineSrc === e.id ? '收起' : '原话'}</button>` : '<span class="hint">家人添加</span>'}
          <button class="link" data-action="tl-edit" data-id="${e.id}">修改</button>
          <button class="link danger" data-action="tl-del" data-id="${e.id}">删除</button></div>
      </div>`).join('')}</section>`).join('')}
  </div>`;
}

// ---------- book ----------
function viewBook() {
  if (!answersFor(() => true).length) {
    return `<div class="page narrow"><h1 class="display">回忆录</h1><p class="lede">先去「访谈」聊几段，再回来这里整理成书。</p></div>`;
  }
  const unsorted = answersFor((t) => t.stage === UNSORTED);
  const by = birthYear(state.profile);
  return `<div class="page book">
    <section class="title-page print-only">
      <h1>${h(state.profile.name)}的回忆录</h1>
      <p>${h(state.profile.name)}口述${by ? ` · ${by} 年生` : ''}${state.profile.birthplace ? `于${h(state.profile.birthplace)}` : ''}</p>
      <p class="title-foot">家人整理 · ${new Date().getFullYear()} 年</p>
    </section>
    <div class="book-head no-print">
      <h1 class="display">${h(state.profile.name)}的回忆录</h1>
      <div class="pills"><button class="pill" data-action="print">${icon('print')}打印 / 存成 PDF</button><button class="pill" data-action="download-md">${icon('download')}下载文字版</button></div>
    </div>
    <p class="lede no-print">${hasAI()
      ? '每一章由 AI 用姥姥的口吻整理她的原话，不添加她没说过的事。点任意一段，能看出处、听原声、修改，或者标成「不印」。底色发黄的段落没找到出处，请核对。'
      : '现在每章按原话一问一答排好，可以直接打印。点任意一段可以修改，或者标成「不印」。填上 Claude 密钥后，可以让 AI 用姥姥的口吻写成连贯的文章。'}</p>
    ${unsorted.length ? `<section class="unsorted no-print"><h2>待归类的回忆 · ${unsorted.length}</h2><p class="era-note">姥姥主动讲的事，选一下属于哪个阶段，就会排进对应的章节。</p>
      ${unsorted.map((t) => `<article class="log-item is-free"><p class="log-a">${h(t.text)}</p>${thumbs(t.photoIds)}<div class="log-tools">${t.audioIds?.length ? `<button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听原声</button>` : ''}${stageSelect(t)}</div></article>`).join('')}
    </section>` : ''}
    ${state.stages.map(chapterBlock).join('')}
    ${unsorted.length ? `<section class="chapter print-only"><div class="chapter-head"><h2>其他回忆</h2></div>
      <div class="prose raw">${unsorted.filter((t) => !t.noprint).map((t) => `<div class="qa"><p>${h(t.text)}</p>${figures(t.photoIds)}</div>`).join('')}</div></section>` : ''}
  </div>`;
}

function chapterBlock(stage) {
  const answers = answersFor((t) => t.stage === stage.id);
  const ch = state.chapters.find((c) => c.stage === stage.id);
  const streaming = state.chapterStream[stage.id];
  if (!answers.length && !ch) return '';
  const newer = ch && answers.some((a) => a.ts > ch.generatedAt);
  const { from, to } = yearRangeForStage(stage, state.profile.birthDate) || {};
  const era = eventsForStage(state.events, stage, state.profile.birthDate).slice(0, 8);
  let body;
  if (streaming != null) body = `<div class="streaming">${h(streaming.replace(/\[\[[^\]]*\]\]/g, ''))}</div>`;
  else if (ch) {
    const shown = new Set();
    body = ch.paragraphs.map((p, i) => {
      const key = `${stage.id}:${i}`;
      // Photos from the answers this paragraph draws on, each shown once per chapter.
      const pics = p.ids.flatMap((id) => state.turns.find((t) => t.id === id)?.photoIds || []).filter((x) => !shown.has(x) && shown.add(x));
      if (state.editingPara === key) {
        return `<div class="para-edit no-print"><textarea class="well small" id="para-${key}">${h(p.text)}</textarea>
          <div class="actions"><button class="btn-primary small" data-action="para-save" data-key="${key}">保存这段</button><button class="pill quiet" data-action="para-cancel">取消</button></div></div>`;
      }
      return `<p class="${p.ids.length ? '' : 'uncited'} ${p.noprint ? 'noprint' : ''}" data-action="toggle-src" data-key="${key}" tabindex="0">${h(p.text)}</p>`
        + (state.openSources === key ? `<div class="para-tools no-print"><button class="link" data-action="para-edit" data-key="${key}">${icon('edit', 16)}改这段</button><button class="link" data-action="para-noprint" data-key="${key}">${p.noprint ? '恢复打印' : '这段不印'}</button></div>${sourcesBox(p.ids)}` : '')
        + (p.noprint ? '' : figures(pics));
    }).join('');
  } else {
    body = answers.map((a) => {
      const key = `${stage.id}:a:${a.id}`;
      if (state.editing === a.id) {
        return `<div class="para-edit no-print"><textarea class="well small" id="edit-${a.id}">${h(a.text)}</textarea>
          <div class="actions"><button class="btn-primary small" data-action="save-edit" data-id="${a.id}">保存修改</button><button class="pill quiet" data-action="cancel-edit">取消</button></div></div>`;
      }
      return `<div class="qa ${a.noprint ? 'noprint' : ''}" data-action="toggle-src" data-key="${key}" tabindex="0">${a.free ? '' : `<p class="qa-q">${h(a.question)}</p>`}<p>${h(a.text)}</p>${figures(a.photoIds)}</div>`
        + (state.openSources === key ? `<div class="para-tools no-print"><button class="link" data-action="edit" data-id="${a.id}">${icon('edit', 16)}改文字</button><button class="link" data-action="answer-noprint" data-id="${a.id}">${a.noprint ? '恢复打印' : '这段不印'}</button>${a.audioIds?.length ? `<button class="link" data-action="play" data-audio="${a.audioIds.join(',')}">${icon('play', 16)}听原声</button>` : ''}<button class="link danger" data-action="delete-answer" data-id="${a.id}">删除这段</button></div>` : '');
    }).join('');
  }
  return `<section class="chapter">
    <div class="chapter-head"><h2>${h(stage.title)}</h2>
      <div class="chapter-tools no-print"><span class="hint">${answers.length} 段原话${newer ? ' · 有新内容' : ''}</span>
        ${hasAI() ? `<button class="${ch ? 'pill' : 'btn-primary small'}" data-action="write-chapter" data-stage="${stage.id}" ${streaming != null || !answers.length ? 'disabled' : ''}>${streaming != null ? '<span class="spinner"></span>正在写' : ch ? '重新写' : '让 AI 写成文章'}</button>` : ''}
      </div>
    </div>
    <div class="prose ${ch || streaming != null ? '' : 'raw'}">${body}</div>
    ${era.length ? `<p class="that-year"><b>那一年（${from}–${to}）</b>${era.map((e) => `${e.year} ${h(e.title)}`).join('；')}。<span>时代背景，引自维基百科</span></p>` : ''}
  </section>`;
}

function sourcesBox(ids) {
  if (!ids.length) return `<div class="sources no-print">这段没有标出处，可能是 AI 写的衔接句，请核对。</div>`;
  return `<div class="sources no-print">${ids.map((id) => {
    const t = state.turns.find((x) => x.id === id);
    return t ? `<div><small>${t.free ? '姥姥主动讲的' : h(t.question)}</small>${h(t.text)} ${t.audioIds?.length ? `<button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听原声</button>` : ''}</div>` : '';
  }).join('')}</div>`;
}

// ---------- settings ----------
function viewSettings() {
  const key = ai.getKey();
  const p = state.profile;
  return `<div class="page settings">
    <h1 class="display">设置</h1>
    <div class="settings-grid">
      <section class="panel">
        <h2>备份</h2>
        <p class="${state.persisted ? 'hint' : 'warn'}">${state.persisted
          ? '存储保护：已开启。浏览器不会自动清理这里的内容。'
          : '存储保护：还没开启。电脑磁盘紧张时，浏览器有可能自动清理网站数据。把这个网址<b>加进书签</b>，或者在 Chrome 右上角菜单里选「安装为应用」，Chrome 一般就会开启保护；之后刷新这一页看看。'}</p>
        <p>所有内容存在这台电脑的浏览器里。清理浏览器数据或换电脑会丢，所以要常备份，并把备份文件发给家人存一份。每次结束访谈会自动下载一份文字备份。${state.asrStatus ? `装了本机精修时，每段录音和每次的备份还会另存一份普通文件在「${h(tildePath(state.asrStatus.archive || '~/姥姥的回忆录'))}」。` : ''}</p>
        <div class="stack">
          <button class="pill" data-action="quick-backup">${icon('download')}文字备份（.json，很小）</button>
          <button class="pill" data-action="full-backup">${icon('download')}完整备份含录音（.zip）</button>
          <label class="pill" for="restore-file">从备份恢复…</label><input id="restore-file" type="file" accept=".json,.zip" hidden>
        </div>
      </section>
      <section class="panel">
        <h2>AI 助手（可选）</h2>
        <p>${key ? '已开启。密钥只存在这台电脑的这个浏览器里。' : '不填也能用：按题库提问、录音、存档。填上 Claude 密钥后，AI 会接着姥姥的话追问、整理人生时间线、写成文章。'}</p>
        <div class="field"><label for="key">Claude 密钥</label><input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${h(key)}"></div>
        <div class="actions"><button class="btn-primary small" data-action="save-key">保存并检查</button>${key ? '<button class="pill quiet danger" data-action="remove-key">删除密钥</button>' : ''}</div>
        <p class="hint">追问、整理用 Sonnet 5.5，每次 AI 追问大约一毛钱人民币；「写成文章」用更擅长文笔的 Opus 5.5，一章大约一两块钱；「上网找」每次大约一块钱。给密钥设好每月消费上限，就不用担心超支。</p>
      </section>
      <section class="panel">
        <h2>姥姥的信息</h2>
        <div class="field"><label for="p-name">称呼</label><input id="p-name" value="${h(p.name)}"></div>
        <div class="field"><label for="p-birth">出生日期</label><input id="p-birth" type="date" value="${h(p.birthDate)}"></div>
        <div class="field"><label for="p-place">出生地 / 主要生活的地方</label><input id="p-place" value="${h(p.birthplace)}"></div>
        <div class="field"><label for="p-places">家人补充（搬过家、在哪工作过，可不填）</label><textarea id="p-places" rows="3">${h(p.places)}</textarea></div>
        <button class="pill" data-action="save-profile">保存</button>
      </section>
      <section class="panel">
        <h2>本机语音精修</h2>
        <p>${state.asrStatus?.ready ? `已连接（${h(String(state.asrStatus.model).replace('Qwen/', ''))}）。每段回答保存后，会用这台电脑上的开源 Qwen3-ASR 按录音重新识别，校正文字；录音不离开这台电脑。`
          : state.asrStatus ? '服务已启动，模型正在加载，稍等一会儿。' : '未检测到。需要在这台电脑上运行一次「asr / 安装.command」。没有它也能用，只是文字以浏览器的实时识别为准。'}</p>
        ${state.asrStatus?.ready ? '<button class="pill" data-action="refine-all">用录音精修以前的回答</button>' : '<button class="pill" data-action="check-asr">重新检测</button>'}
      </section>
      <section class="panel">
        <h2>清空访谈内容</h2>
        <p>试用完、正式开始之前用：删掉所有回答、录音、时间线和回忆录章节。姥姥的信息、Claude 密钥和上网找到的资料会保留。删掉就找不回来，除非有备份。</p>
        <button class="pill danger" data-action="wipe-all">清空所有访谈内容…</button>
      </section>
    </div>
  </div>`;
}

function viewHelp() {
  return `<div class="page narrow help">
    <h1 class="display">使用说明</h1>
    <p class="lede">一次聊二三十分钟就好。页面从上往下，就是使用的顺序。</p>

    <h2>第一次用（只做一次）</h2>
    <ol>
      <li>用 <b>Chrome</b> 打开这个网址，<b>加进书签</b>，或者在 Chrome 右上角菜单里选「安装为应用」。<b>以后一直用这一个网址</b>，内容和网址绑在一起，换了网址就看不到之前的内容。</li>
      <li>在「先认识一下姥姥」里填称呼、出生日期、出生地，点「好了，开始」。</li>
      <li>想要 AI 跟着姥姥的话追问：点顶上「设置」，在「AI 助手」里粘贴 Claude 密钥，点「保存并检查」。不填也能用，会按题库提问。</li>
      <li>「设置」里看一眼「本机语音精修」：显示「已连接」最好。如果 Chrome 问「是否允许访问本地网络上的设备」，点「允许」。</li>
      <li>「设置」→「备份」里看一眼「存储保护」：显示「已开启」最好。还没开启的话，确认上面第 1 步加了书签或装成了应用，再刷新这一页。</li>
    </ol>

    <h2>每次访谈</h2>
    <ol>
      <li><b>选阶段</b>：在「访谈」页点一个人生阶段，比如「家乡与家人」。深色的是聊过的阶段，赭色的是现在这个。</li>
      <li><b>问问题</b>：把大字的问题读给姥姥听，或者点「读给姥姥听」。问题不合适就点「换个问题」。右边「那一年」是她那个年纪发生的事，看到合适的可以点「用这个问」。</li>
      <li><b>录她说的</b>：点深色圆按钮「开始说」，姥姥说的话会出现在文本框里。
        <ul>
          <li>有人打断、她要喝口水：点「暂停」，回来点「继续说」，会接在同一段里。</li>
          <li>文字认错了，直接在文本框里改。</li>
        </ul>
      </li>
      <li><b>保存这段</b>：这个话题聊完了，点「保存，问下一个」，会出下一个问题。她停下来想一想时不用急着点，AI 也不会插嘴。</li>
      <li><b>她说起别的事</b>：姥姥突然讲起和问题无关的事，点「姥姥想起别的事」，让她尽管说，说完点「保存这段回忆」。她前面已经回答了一半的话，会先存成这个问题的回答，不会混进去。${hasAI() ? 'AI 会把它归到对应的人生阶段，再顺着往下问。' : '它会先放进「待归类」，以后在「回忆录」里选一下阶段就行。'}</li>
      <li><b>今天聊完了</b>：点最下面的「结束这次访谈」。这次的内容会存好，${hasAI() ? 'AI 会整理进「人生时间线」，' : ''}并<b>自动下载一份备份</b>到「下载」文件夹。</li>
    </ol>

    <h2>聊过之后</h2>
    <ul>
      <li><b>人生时间线</b>：按年份排好的人生大事。可以点「原话」核对，也可以「修改」「删除」，或者「添加一条」家里知道的事。</li>
      <li><b>回忆录</b>：按人生阶段排好的书稿。点任意一段，可以改文字、听原声，或者标成「这段不印」。${hasAI() ? '点「让 AI 写成文章」，会用姥姥的口吻把原话整理成连贯的文章。' : ''}准备好了点「打印 / 存成 PDF」。</li>
      <li><b>备份</b>：每隔几天在「设置」里点「完整备份含录音」，把文件发给家里人存一份。这是最重要的一件事。</li>
    </ul>

    <h2>内容会不会丢？</h2>
    <p><b>关掉网页、关掉浏览器、重启电脑，都不会丢。</b>用同一个网址重新打开，会回到原来的访谈，连还没点保存、正在打的字也会恢复。</p>
    <ul>
      <li><b>回答</b>：一点「保存」就存进这台电脑里了，不是只放在网页上。</li>
      <li><b>说到一半</b>：没保存的文字随时自动存；录音每一分钟存一次。最坏只会丢掉最后不到一分钟的录音。录音时不小心点了关闭，Chrome 会先问「确定要离开吗」。</li>
      <li><b>另存一份</b>：装了本机语音精修的话，每段录音和每次的备份，还会另存一份到这台电脑主目录的「姥姥的回忆录」文件夹。</li>
      <li><b>备份文件</b>：每次「结束这次访谈」自动下载一份；「设置」里还能下载含录音的完整备份。</li>
    </ul>
    <p>下面这些情况才会出问题，要避开：</p>
    <ul>
      <li><b>换了网址或浏览器</b>：内容还在原来那里，只是看不到。只用书签里的这个网址、只用 Chrome。</li>
      <li><b>用了无痕窗口</b>：关掉就没了。不要用无痕窗口。</li>
      <li><b>清除浏览数据</b>：如果在 Chrome 里清除浏览数据，<b>不要勾选「Cookie 及其他网站数据」</b>。</li>
      <li><b>电脑磁盘快满了</b>：「存储保护」没开时，浏览器可能自动清理。所以要把它打开（见「第一次用」第 5 步）。</li>
      <li><b>电脑坏了或丢了</b>：只有发出去的备份还在。所以<b>隔几天就把完整备份发给家里人一份</b>。</li>
    </ul>

    <h2>遇到问题</h2>
    <ul>
      <li><b>按「开始说」没反应、提示没有麦克风权限</b>：点地址栏左边的图标，把「麦克风」改成允许，再点一次。</li>
      <li><b>文字认得不准</b>：录音都存着。装了本机精修的话，保存后会用录音再认一遍；还不对就手动改。点「听原声」可以对照。</li>
      <li><b>「本机语音精修」显示未检测到</b>：重启一下电脑；还不行也没关系，应用照常能用，只是文字以实时识别为准。</li>
      <li><b>浏览器不小心关了</b>：重新打开同一个网址。录音每分钟存一次，没保存的文字也会恢复。</li>
      <li><b>换了电脑、内容不见了</b>：在新电脑的 Chrome 里打开同一个网址，到「设置」点「从备份恢复…」，选最近的备份文件。</li>
      <li><b>AI 提示密钥不对或余额不足</b>：不影响录音和保存，会自动改用题库提问；等家里人处理好密钥再说。</li>
    </ul>

    <h2>小提示</h2>
    <ul>
      <li>姥姥累了就停，下次接着聊。她说「不记得了」就换个话题。</li>
      <li>键盘快捷键：<kbd>空格</kbd> 开始 / 暂停录音（光标在文本框里时用 <kbd>⌥</kbd> + <kbd>空格</kbd>，或先按 <kbd>Esc</kbd> 退出文本框），<kbd>F</kbd> 记「姥姥想起别的事」，<kbd>⌘</kbd> + <kbd>回车</kbd> 保存。</li>
      <li>录音和内容都只存在这台电脑上。用 AI 时，发给 AI 的只有文字，不发录音。</li>
    </ul>
  </div>`;
}

// ---------- actions ----------
const actions = {
  goto: (el) => go(el.dataset.view),
  'start-session': async (el) => {
    const session = { id: `s_${cryptoId()}`, stage: el.dataset.stage, startedAt: Date.now(), endedAt: null };
    await db.put('sessions', session);
    state.session = session;
    const stage = stageById(session.stage);
    if (answersFor((t) => t.stage === stage.id).length) await askNext(); else setQuestion(stage.opening);
    render();
  },
  'switch-stage': async (el) => {
    if (state.voice || el.dataset.stage === state.session.stage) return;
    await keepWhatWasSaid();
    state.session.stage = el.dataset.stage;
    state.free = false;
    await db.put('sessions', state.session);
    const stage = stageById(el.dataset.stage);
    if (answersFor((t) => t.stage === stage.id).length) await askNext(); else setQuestion(stage.opening);
    render();
  },
  speak: () => { if (state.question !== BANK_DONE) speak(state.question); },
  'other-question': async () => { await keepWhatWasSaid(); return askNext(state.question); },
  'use-cue': async (el) => { await keepWhatWasSaid(); state.free = false; setQuestion(el.dataset.q); render(); },
  'free-memory': async () => {
    if (state.free) return;
    // What she said so far answers the question on screen; the new memory starts clean.
    const saved = await keepWhatWasSaid();
    state.returnQuestion = saved ? '' : state.question; // answered: ask the next one when coming back
    state.free = true;
    render();
    await startMic();
  },
  'start-free': async (el) => {
    const session = { id: `s_${cryptoId()}`, stage: el.dataset.stage, startedAt: Date.now(), endedAt: null };
    await db.put('sessions', session);
    state.session = session;
    setQuestion(stageById(session.stage).opening);
    state.returnQuestion = state.question;
    state.free = true;
    render();
    await startMic();
  },
  'save-setup': async () => {
    const birthDate = document.getElementById('s-birth').value;
    if (!birthDate) return toast('请填一下出生日期（记不清具体哪天，选那年的任意一天也行）。', true);
    state.profile = {
      ...state.profile,
      name: document.getElementById('s-name').value.trim() || '姥姥',
      birthDate,
      birthplace: document.getElementById('s-place').value.trim(),
    };
    await db.setKV('profile', state.profile);
    render();
  },
  'use-refined': async (el) => {
    const t = state.turns.find((x) => x.id === el.dataset.id);
    t.text = t.refined;
    await db.put('turns', t);
    render();
  },
  'check-asr': async () => { await checkASR(); toast(state.asrStatus?.ready ? '本机精修已连接。' : '还是没检测到本机精修服务。'); },
  'refine-all': async () => {
    const todo = state.turns.filter((t) => t.audioIds?.length && t.refined == null);
    if (!todo.length) return toast('以前的回答都已经精修过了。');
    toast(`开始精修 ${todo.length} 段，可以继续用，完成后会提示。`);
    let done = 0;
    for (const t of todo) if (await refineTurn(t)) done++;
    toast(`精修完成 ${done} / ${todo.length} 段。`);
  },
  'drop-photo': async (el) => {
    state.pendingPhotos = state.pendingPhotos.filter((x) => x !== el.dataset.id);
    await db.setKV('pendingPhotos', state.pendingPhotos);
    render();
  },
  'para-edit': (el) => { state.editingPara = el.dataset.key; render(); },
  'para-cancel': () => { state.editingPara = null; render(); },
  'para-save': async (el) => {
    const [stage, i] = el.dataset.key.split(':');
    const ch = state.chapters.find((c) => c.stage === stage);
    ch.paragraphs[i] = { ...ch.paragraphs[i], text: document.getElementById(`para-${el.dataset.key}`).value.trim(), edited: true };
    await db.put('chapters', ch);
    state.editingPara = null;
    render();
  },
  'para-noprint': async (el) => {
    const [stage, i] = el.dataset.key.split(':');
    const ch = state.chapters.find((c) => c.stage === stage);
    ch.paragraphs[i].noprint = !ch.paragraphs[i].noprint;
    await db.put('chapters', ch);
    render();
  },
  'answer-noprint': async (el) => {
    const t = state.turns.find((x) => x.id === el.dataset.id);
    t.noprint = !t.noprint;
    await db.put('turns', t);
    render();
  },
  'tl-new': () => { state.tlEditing = 'new'; render(); },
  'tl-extract-all': extractAllPending,
  'tl-edit': (el) => { state.tlEditing = el.dataset.id; render(); },
  'tl-cancel': () => { state.tlEditing = null; render(); },
  'tl-save': async (el) => {
    const year = Number(document.getElementById('tl-year').value) || null;
    const event = document.getElementById('tl-event').value.trim();
    if (!event) return toast('请写一下发生了什么。', true);
    const old = state.timeline.find((e) => e.id === el.dataset.id);
    const by = birthYear(state.profile);
    const item = {
      ...(old || { id: `t_${cryptoId()}`, turnIds: [], manual: true }),
      year, age: year && by ? year - by : null, event,
      place: document.getElementById('tl-place').value.trim() || null,
      people: document.getElementById('tl-people').value.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean),
    };
    await db.put('timeline', item);
    state.timeline = [...state.timeline.filter((e) => e.id !== item.id), item];
    state.tlEditing = null;
    render();
  },
  'delete-answer': async (el) => {
    const t = state.turns.find((x) => x.id === el.dataset.id);
    if (!t || !confirm(`删除这段回答和它的录音？\n\n「${t.text.slice(0, 40)}${t.text.length > 40 ? '…' : ''}」\n\n删掉就找不回来了。`)) return;
    for (const id of t.audioIds || []) await db.del('audio', id);
    await db.del('turns', t.id);
    state.turns = state.turns.filter((x) => x.id !== t.id);
    // Timeline entries that rested only on this answer go too; others just lose the reference.
    for (const e of [...state.timeline]) {
      if (!e.turnIds?.includes(t.id)) continue;
      e.turnIds = e.turnIds.filter((x) => x !== t.id);
      if (!e.turnIds.length && !e.manual) { await db.del('timeline', e.id); state.timeline = state.timeline.filter((x) => x.id !== e.id); }
      else await db.put('timeline', e);
    }
    toast('已删除这段。写好的章节如果用到过它，需要的话点「重新写」。');
    render();
  },
  'wipe-all': async () => {
    const n = state.turns.length;
    const typed = prompt(`将删除全部 ${n} 段回答、所有录音、人生时间线和回忆录章节。\n姥姥的信息、密钥和上网找到的资料会保留。\n\n确定的话，请输入「清空」两个字：`);
    if (typed?.trim() !== '清空') { if (typed != null) toast('没有输入「清空」，什么都没删。'); return; }
    if (state.voice) await stopMic();
    for (const store of ['turns', 'sessions', 'audio', 'timeline', 'chapters', 'photos']) await db.clear(store);
    for (const k of ['draft', 'pendingClips', 'pendingPhotos', 'currentQuestion', 'lastBackup', 'lastFullBackup']) await db.setKV(k, k.startsWith('pending') ? [] : '');
    Object.assign(state, { turns: [], timeline: [], chapters: [], session: null, question: '', draft: '', pendingClips: [], pendingPhotos: [], free: false, editing: null, openSources: null });
    toast(`已清空 ${n} 段回答。可以正式开始了。`);
    go('interview');
  },
  'cancel-free': async () => {
    await keepWhatWasSaid(); // a memory half told is still kept, in 待归类
    state.free = false;
    if (state.returnQuestion) { setQuestion(state.returnQuestion); render(); } else await askNext();
  },
  'toggle-mic': () => { state.ending = false; return state.voice ? stopMic() : startMic(); },
  'clear-draft': () => { state.draft = ''; state.interim = ''; render(); },
  'save-answer': saveAnswer,
  'end-session': endSession,
  'end-save': async () => { state.ending = false; await saveAnswerOnly(); await finishSession(); },
  'end-discard': async () => { state.ending = false; await discardUnsaved(); await finishSession(); },
  'end-cancel': () => {
    state.ending = false;
    render();
    document.querySelector('[data-action="end-session"]')?.focus();
  },
  'mic-retry': () => startMic(),
  'edit-saved': (el) => {
    state.editing = el.dataset.id;
    state.justSaved = null;
    render();
    const box = document.getElementById(`edit-${el.dataset.id}`);
    box?.scrollIntoView({ block: 'center' });
    box?.focus({ preventScroll: true });
  },
  'recap-done': () => { state.recap = null; render(); window.scrollTo({ top: 0 }); },
  play: (el) => playAudio(el.dataset.audio),
  edit: (el) => { state.editing = el.dataset.id; render(); },
  'cancel-edit': () => { state.editing = null; render(); },
  'save-edit': async (el) => {
    const t = state.turns.find((x) => x.id === el.dataset.id);
    t.text = document.getElementById(`edit-${t.id}`).value.trim();
    await db.put('turns', t);
    state.editing = null;
    render();
  },
  'find-cues': findCues,
  'tl-src': (el) => { state.openTimelineSrc = state.openTimelineSrc === el.dataset.id ? null : el.dataset.id; render(); },
  'tl-del': async (el) => {
    if (!confirm('删除这条时间线？（不会删除原话）')) return;
    await db.del('timeline', el.dataset.id);
    state.timeline = state.timeline.filter((e) => e.id !== el.dataset.id);
    render();
  },
  'write-chapter': (el) => writeChapter(el.dataset.stage),
  'toggle-src': (el) => { state.openSources = state.openSources === el.dataset.key ? null : el.dataset.key; render(); },
  print: () => window.print(),
  'download-md': () => {
    const md = chapterMarkdown(state.profile, state.chapters, state.stages, answersFor(() => true));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${state.profile.name}的回忆录.md`;
    a.click();
  },
  'save-key': async () => {
    const k = document.getElementById('key').value.trim();
    if (!k) return toast('请先粘贴密钥。', true);
    ai.setKey(k);
    toast('正在检查密钥…');
    try { await ai.testKey(); toast('密钥可以用，AI 追问已开启。'); go('interview'); }
    catch (e) { toast(ai.explain(e), true); render(); }
  },
  'remove-key': () => { if (confirm('删除这台电脑上保存的密钥？之后会按题库提问。')) { ai.setKey(''); render(); } },
  'save-profile': async () => {
    state.profile = {
      ...state.profile,
      name: document.getElementById('p-name').value.trim() || '姥姥',
      birthDate: document.getElementById('p-birth').value || state.profile.birthDate,
      birthplace: document.getElementById('p-place').value.trim(),
      places: document.getElementById('p-places').value.trim(),
    };
    await db.setKV('profile', state.profile);
    toast('已保存。');
    render();
  },
  'quick-backup': async () => { await downloadQuickBackup(); toast('备份已下载到「下载」文件夹。'); renderBackupPill(); },
  'full-backup': async () => {
    toast('正在打包录音…');
    try { await downloadFullBackup(); toast('完整备份已下载，记得发给家人存一份。'); renderBackupPill(); }
    catch (e) { toast(`备份失败：${e.message}`, true); }
  },
};

function setQuestion(q) {
  state.question = q;
  db.setKV('currentQuestion', q);
}

function bankQuestion(stage, current) {
  const asked = answersFor((t) => t.stage === stage.id).map((t) => t.question);
  return nextBankQuestion(stage, asked, current) || BANK_DONE;
}

async function askNext(avoidQuestion, photo) {
  const stage = stageById(state.session.stage);
  const prev = state.question;
  if (!hasAI()) {
    let q = photo ? PHOTO_QUESTION : bankQuestion(stage, prev);
    // 换个问题 on the last unasked one: keep it rather than declare the bank empty.
    if (q === BANK_DONE && avoidQuestion && prev && prev !== BANK_DONE) { toast('这个阶段的题库里没有别的问题了。'); q = prev; }
    setQuestion(q);
    render();
    return;
  }
  state.questionBusy = true;
  state.question = '';
  render();
  try {
    const q = await ai.nextQuestion({
      profile: state.profile,
      timeline: state.timeline,
      stage,
      stageTurns: expand(answersFor((t) => t.stage === stage.id && t.sessionId !== state.session.id)),
      recentTurns: expand(answersFor((t) => t.sessionId === state.session.id)),
      events: eventsForStage(state.events, stage, state.profile.birthDate),
      avoidQuestion,
    }, (text) => {
      const el = document.getElementById('question');
      if (el) el.textContent = text;
    }, photo);
    setQuestion(q || bankQuestion(stage, prev));
  } catch (e) {
    toast(`${ai.explain(e)} 先按题库问。`, true);
    setQuestion(bankQuestion(stage, prev) || prev);
  } finally {
    state.questionBusy = false;
    render();
  }
}

/** Answers -> q/a pairs for prompts. */
function expand(answers) {
  return answers.flatMap((t) => [{ role: 'q', text: t.free ? FREE_QUESTION : t.question }, { role: 'a', id: t.id, text: t.text }]);
}

let timer;
async function startMic() {
  const v = new VoiceCapture({
    onText: (finalText, interim) => {
      state.draft = finalText;
      state.interim = interim;
      state.speechNote = '';
      const box = document.getElementById('answer-box');
      if (box) { box.value = finalText; box.scrollTop = box.scrollHeight; }
      const im = document.getElementById('interim');
      if (im) { im.textContent = interim; im.classList.remove('error'); }
      saveDraftSoon();
    },
    onClip: (clip) => saveClip(clip),
    onError: (problem) => {
      if (problem.kind === 'speech') {
        state.speechNote = problem.text;
        const im = document.getElementById('interim');
        if (im) { im.textContent = problem.text; im.classList.add('error'); }
        return;
      }
      state.micError = problem;
    },
  });
  state.micError = null;
  state.speechNote = '';
  const box = document.getElementById('answer-box');
  if (box) state.draft = box.value;
  if (!(await v.start(state.draft))) { render(); return; } // the alert is announced (role=alert); focus stays put so shortcuts keep working
  state.voice = v;
  state.recordingSince = Date.now();
  render();
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById('mic-time');
    if (!el || !state.voice) return;
    const s = Math.floor((Date.now() - state.recordingSince) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}

async function stopMic() {
  clearInterval(timer);
  const v = state.voice;
  state.voice = null;
  const { text } = await v.stop();
  if (text) state.draft = text;
  state.interim = '';
  state.speechNote = '';
  saveDraftSoon(0);
  render();
}

// ---------- crash-safe recording + local refinement ----------
let draftTimer;
function saveDraftSoon(delay = 800) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => db.setKV('draft', state.draft), delay);
}

async function saveClip(clip) {
  const id = `r_${cryptoId()}`;
  await db.put('audio', { id, ...clip, recordedAt: Date.now() });
  state.pendingClips.push(id);
  await db.setKV('pendingClips', state.pendingClips);
  refineClip(id).catch(() => {}); // start early so it's ready by the time the answer is saved
  archiveClip(id);
}

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };
/** Local time as 2026-11-10-09-05-30, matching the dated folders the service creates. */
const localStamp = (t = Date.now()) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; };
/** Copy one clip to ~/姥姥的回忆录/录音/ through the local service; remembered so it's done once. */
async function archiveClip(id) {
  if (!state.asrStatus) return false;
  try {
    const a = await db.get('audio', id);
    if (!a || a.archived) return true;
    await asr.archive(a.blob, 'audio', `${localStamp(a.recordedAt)}_${id}.${EXT[String(a.mime).split(';')[0]] || 'webm'}`);
    a.archived = true;
    await db.put('audio', a);
    return true;
  } catch { return false; }
}

let catchingUp = false;
/** Clips recorded while the service was off get copied once it's back. */
async function archiveBacklog() {
  if (catchingUp || !state.asrStatus) return;
  catchingUp = true;
  try {
    for (const a of await db.all('audio')) if (!a.archived && !(await archiveClip(a.id))) break;
  } finally { catchingUp = false; }
}

async function checkASR() {
  const before = !!state.asrStatus?.ready;
  state.asrStatus = await asr.status();
  archiveBacklog();
  if (before !== !!state.asrStatus?.ready && !isTyping()) render();
}

/** Elements where Space or a letter already means something. */
const takesKeys = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(el.tagName) || el.matches?.('[data-action][tabindex]'));
const isTyping = () => document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';

const refining = new Map();
/** Refined text of one clip (cached on the clip), or null if the local service isn't available. */
function refineClip(id) {
  if (!state.asrStatus?.ready) return Promise.resolve(null);
  if (!refining.has(id)) {
    refining.set(id, (async () => {
      const a = await db.get('audio', id);
      if (!a) return null;
      if (a.refined != null) return a.refined;
      a.refined = await asr.transcribe(a.blob, asrContext(state.profile, state.timeline));
      await db.put('audio', a);
      return a.refined;
    })().finally(() => refining.delete(id)));
  }
  return refining.get(id);
}

/** Re-recognize a saved answer from its recording; replaces the text only if it wasn't hand-edited. */
async function refineTurn(turn) {
  if (!turn.audioIds?.length || !state.asrStatus?.ready) return false;
  try {
    const parts = [];
    for (const id of turn.audioIds) parts.push(await refineClip(id));
    if (parts.some((p) => p == null)) return false;
    const current = state.turns.find((t) => t.id === turn.id) || turn;
    const updated = applyRefined({ ...current, draft: current.draft ?? current.text }, parts.join(''));
    Object.assign(current, updated);
    await db.put('turns', current);
    if (!isTyping()) render();
    return true;
  } catch {
    return false; // service hiccup: the draft stays; can be retried from Settings
  }
}

/** Store what's in the box (and its recorded clips) as one answer. Returns the turn, or null if empty. */
async function saveAnswerOnly() {
  if (state.voice) await stopMic();
  const box = document.getElementById('answer-box');
  if (box) state.draft = box.value;
  const text = state.draft.trim();
  if (!text && !state.pendingClips.length && !state.pendingPhotos.length) return null;

  const audioIds = [...state.pendingClips];
  state.pendingClips = [];
  await db.setKV('pendingClips', []);
  await db.setKV('draft', '');
  const free = state.free;
  const turn = {
    id: `a_${cryptoId()}`, role: 'a', sessionId: state.session.id,
    stage: free ? UNSORTED : state.session.stage,
    question: free ? FREE_QUESTION : state.question === BANK_DONE ? AFTER_BANK : state.question,
    text: text || AUDIO_ONLY, ts: Date.now(), audioIds, free,
    photoIds: [...state.pendingPhotos],
  };
  state.pendingPhotos = [];
  await db.setKV('pendingPhotos', []);
  turn.draft = turn.text;
  await db.put('turns', turn);
  state.turns.push(turn);
  state.draft = '';
  refineTurn(turn); // runs in the background; the interview continues
  return turn;
}

/** Before moving to another question, stage or mode: what's already been said stays with where it was said. */
async function keepWhatWasSaid() {
  if (!hasUnsaved()) return null;
  const turn = await saveAnswerOnly();
  if (!turn) return null;
  acknowledge(turn);
  if (turn.free) toast('刚才想起的事先记下了，放在「待归类」，在「回忆录」里可以归到对应阶段。');
  return turn;
}

let savedTimer;
/** Acknowledge a save right where the operator is looking, then get out of the way. */
function acknowledge(turn) {
  state.justSaved = { id: turn.id, n: answersFor((t) => t.sessionId === turn.sessionId).length };
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    state.justSaved = null;
    if (!isTyping() && document.getElementById('saved-note')) render();
  }, 8000);
}

async function saveAnswer() {
  if (state.ending) return;
  const free = state.free;
  const turn = await saveAnswerOnly();
  if (!turn) {
    return state.justSaved
      ? toast(`刚才那段已经记下了（第 ${state.justSaved.n} 段）。`)
      : toast('还没有内容。先录音或者打字。', true);
  }
  acknowledge(turn);
  const text = turn.draft === AUDIO_ONLY ? '' : turn.text;
  if (!free) return askNext();

  state.free = false;
  if (!hasAI() || !text) {
    toast('记下了，放在「待归类」。');
    if (!state.returnQuestion) return askNext();
    setQuestion(state.returnQuestion);
    render();
    return;
  }
  state.busy = '正在把这段回忆归到对应的人生阶段…';
  render();
  try {
    const r = await ai.classifyMemory({ profile: state.profile, stages: state.stages, text });
    if (r) {
      turn.stage = r.stage;
      await db.put('turns', turn);
      toast(`记下了，归到「${stageById(r.stage).title}」。`);
    } else toast('记下了，暂时放在「待归类」。');
  } catch (e) {
    toast(`记下了，暂时放在「待归类」（${ai.explain(e)}）。`, true);
  } finally {
    state.busy = '';
  }
  await askNext(); // AI follows her thread first, then drifts back to the stage
}

const realText = (t) => t.text && t.text !== AUDIO_ONLY;

/** Extract life events from these answers into the timeline, then mark them as done. Returns how many were added. */
async function extractInto(answers) {
  const events = await ai.extractEvents({
    profileText: profileText(state.profile),
    turnsText: expand(answers).map((t) => (t.role === 'q' ? `问：${t.text}` : `[${t.id}] 姥姥：${t.text}`)).join('\n'),
  });
  const merged = mergeTimeline(state.timeline, events, state.turns.map((t) => t.id), state.profile.birthDate);
  const added = merged.length - state.timeline.length;
  for (const e of merged.slice(state.timeline.length)) await db.put('timeline', e);
  state.timeline = merged;
  for (const t of answers) { t.extracted = true; await db.put('turns', t); }
  return added;
}

const pendingExtraction = () => answersFor((t) => !t.extracted && realText(t));

/** Timeline page: run AI over every answer that hasn't been turned into timeline entries yet. */
async function extractAllPending() {
  const todo = pendingExtraction();
  if (!todo.length) return toast('所有回答都已经整理过了。');
  const batches = [];
  for (let i = 0; i < todo.length; i += 25) batches.push(todo.slice(i, i + 25));
  let added = 0;
  try {
    for (let i = 0; i < batches.length; i++) {
      state.busy = `正在整理第 ${i + 1} / ${batches.length} 批（共 ${todo.length} 段回答）…`;
      render();
      added += await extractInto(batches[i]);
    }
    toast(`整理完了，时间线新增 ${added} 条。`);
  } catch (e) {
    toast(`整理到一半停了（${ai.explain(e)}）。已整理的会保留，再点一次会接着整理剩下的。`, true);
  } finally {
    state.busy = '';
    render();
  }
}

function endSession() {
  if (state.ending || finishing) return;
  state.micError = null;
  if (hasUnsaved()) {
    state.ending = true;
    render();
    // Focus the choice itself, not a button: Space here means "she's talking again", never "end".
    const box = document.getElementById('end-choice');
    box?.scrollIntoView({ block: 'center' });
    box?.focus({ preventScroll: true });
    return;
  }
  return finishSession();
}

/** Drop the answer being composed. Its clips stay in the audio store (and any archive copy) but belong to no answer, so the next session can't pick them up. */
async function discardUnsaved() {
  clearTimeout(draftTimer);
  state.draft = '';
  state.interim = '';
  state.pendingClips = [];
  state.pendingPhotos = [];
  await db.setKV('draft', '');
  await db.setKV('pendingClips', []);
  await db.setKV('pendingPhotos', []);
}

let finishing = false;
async function finishSession() {
  if (finishing) return;
  finishing = true;
  try { await closeSession(); } finally { finishing = false; }
}

async function closeSession() {
  const sessionAnswers = answersFor((t) => t.sessionId === state.session.id);
  let added = 0;
  if (sessionAnswers.length && hasAI()) {
    state.busy = '正在整理这次聊到的人生经历…';
    render();
    try {
      const todo = sessionAnswers.filter((t) => !t.extracted && realText(t));
      if (todo.length) added = await extractInto(todo);
    } catch (e) {
      toast(`时间线这次没整理成（${ai.explain(e)}），原话都已保存，不影响。`, true);
    }
  }
  state.session.endedAt = Date.now();
  await db.put('sessions', state.session);
  state.session = null;
  state.busy = '';
  state.free = false;
  await db.setKV('currentQuestion', '');
  if (sessionAnswers.length) {
    // A cached older backup.js returns nothing, so success is "didn't throw"; the name is a bonus.
    let file = null;
    try { file = (await downloadQuickBackup()) || ''; } catch { /* recap says so */ }
    let archived = '';
    if (state.asrStatus) {
      try {
        const d = await collect();
        await asr.archive(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }), 'backup', `backup-${localStamp()}.json`);
        archived = `${tildePath(state.asrStatus.archive || '~/姥姥的回忆录')}/备份`;
      } catch { /* the download is the backup that counts */ }
    }
    let audioMs = 0;
    for (const id of sessionAnswers.flatMap((t) => t.audioIds || [])) audioMs += (await db.get('audio', id))?.durationMs || 0;
    const stages = [...new Set(sessionAnswers.map((t) => t.stage).filter((s) => s !== UNSORTED))].map((s) => stageById(s).title);
    state.recap = {
      count: sessionAnswers.length, audioMs, added, file, archived, stages,
      quote: pickQuote(sessionAnswers.map((t) => t.text)),
      next: suggestStage(state.stages, state.turns),
    };
    renderBackupPill();
  } else toast('这次没有记下内容，访谈已结束。');
  render();
  window.scrollTo({ top: 0 });
  $app.focus({ preventScroll: true });
}

async function findCues() {
  const stage = stageById(state.session.stage);
  const range = yearRangeForStage(stage, state.profile.birthDate);
  if (!range) return toast('先在「设置」里填上出生日期。', true);
  const { from, to } = range;
  state.cueBusy = true;
  render();
  try {
    const { cues, dropped } = await ai.findCues({ profile: state.profile, from, to, stageTitle: stage.title, timeline: state.timeline });
    const found = cues.map((c) => ({
      year: c.year, region: c.region, title: c.title, summary: c.summary, cue: c.question,
      source: { title: c.source_title, url: c.source_url },
    }));
    // Add to what earlier searches found for this stage, skipping repeats of the same source.
    const prev = state.webCues[stage.id] || [];
    state.webCues[stage.id] = [...prev, ...found.filter((c) => !prev.some((p) => p.source.url === c.source.url))];
    await db.setKV('webCues', state.webCues);
    toast(cues.length ? `找到 ${cues.length} 条${dropped ? `（另有 ${dropped} 条找不到可靠出处，已丢弃）` : ''}。` : '这次没找到有可靠出处的资料，可以稍后再试。');
  } catch (e) {
    toast(ai.explain(e), true);
  } finally {
    state.cueBusy = false;
    render();
  }
}

async function writeChapter(stageId) {
  const stage = stageById(stageId);
  const answers = answersFor((t) => t.stage === stageId);
  state.chapterStream[stageId] = '';
  render();
  try {
    let lastPaint = 0;
    const text = await ai.writeChapter({ profile: state.profile, stage, answers: answers.map((a) => ({ ...a, question: a.free ? FREE_QUESTION : a.question })) }, (t) => {
      state.chapterStream[stageId] = t;
      if (Date.now() - lastPaint > 250) { lastPaint = Date.now(); render(); }
    });
    const chapter = { id: stageId, stage: stageId, generatedAt: Date.now(), paragraphs: parseChapter(text, answers.map((a) => a.id)) };
    await db.put('chapters', chapter);
    state.chapters = [...state.chapters.filter((c) => c.stage !== stageId), chapter];
  } catch (e) {
    toast(ai.explain(e), true);
  } finally {
    delete state.chapterStream[stageId];
    render();
  }
}

let player;
let playToken = 0;
/** Play one answer's clips back to back. */
async function playAudio(idList) {
  const token = ++playToken;
  player?.pause();
  for (const id of String(idList).split(',').filter(Boolean)) {
    const a = await db.get('audio', id);
    if (!a) { toast('找不到这段录音。', true); continue; }
    if (token !== playToken) return;
    player = new Audio(URL.createObjectURL(a.blob));
    try {
      await player.play();
      await new Promise((r) => { player.onended = r; player.onpause = r; });
    } catch { toast('这段录音放不了。', true); return; }
  }
}

let toastTimer;
function toast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 8000 : 4500);
}

// ---------- events ----------
const MODE_CHANGES = new Set(['switch-stage', 'start-session', 'start-free', 'free-memory', 'cancel-free', 'use-cue', 'other-question', 'save-answer', 'end-session']);
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return go(tab.dataset.view);
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  // A mic error belongs to the moment it happened; moving on to another question or mode clears it.
  if (MODE_CHANGES.has(el.dataset.action)) state.micError = null;
  if (fn) Promise.resolve(fn(el)).catch((err) => toast(ai.explain(err), true));
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'photo-input' && e.target.files.length) {
    const files = [...e.target.files];
    e.target.value = '';
    let last = null;
    for (const f of files) {
      try {
        const { blob, w, h } = await photos.shrink(f);
        const id = `p_${cryptoId()}`;
        await db.put('photos', { id, blob, w, h, ts: Date.now(), name: f.name });
        state.pendingPhotos.push(id);
        last = blob;
        if (state.asrStatus) asr.archive(blob, 'photo', `${localStamp()}_${id}.jpg`).catch(() => {});
      } catch { toast(`这张照片打不开：${f.name}`, true); }
    }
    await db.setKV('pendingPhotos', state.pendingPhotos);
    render();
    if (last && state.session) await askNext(undefined, hasAI() ? await photos.toBase64(last) : true);
    return;
  }
  const assign = e.target.closest?.('[data-assign]');
  if (assign) {
    const t = state.turns.find((x) => x.id === assign.dataset.assign);
    t.stage = assign.value;
    await db.put('turns', t);
    toast(t.stage === UNSORTED ? '放回「待归类」。' : `归到「${stageById(t.stage).title}」。`);
    render();
    return;
  }
  if (e.target.id !== 'restore-file' || !e.target.files[0]) return;
  if (!confirm('从备份恢复会用备份里的内容替换这台电脑上现有的内容。确定吗？')) { e.target.value = ''; return; }
  try {
    const r = await restore(e.target.files[0]);
    toast(`已恢复 ${r.turns} 段回答${r.audio ? `、${r.audio} 段录音` : ''}。`);
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast(`恢复失败：${err.message}`, true);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.ending) { e.preventDefault(); actions['end-cancel'](); return; }
  const interviewing = state.view === 'interview' && state.session;
  // ⌥Space toggles the mic from anywhere, the transcript well included.
  if (interviewing && e.altKey && e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const mic = document.querySelector('[data-action="toggle-mic"]');
    if (mic && !mic.disabled && !e.repeat) mic.click();
    return;
  }
  // Esc leaves the well so the one-key shortcuts work again.
  if (e.key === 'Escape' && document.activeElement?.id === 'answer-box') { document.activeElement.blur(); return; }
  // One-key shortcuts while interviewing, only when nothing else would take the key.
  if (state.view === 'interview' && state.session && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !takesKeys(document.activeElement)) {
    const target = e.code === 'Space' ? 'toggle-mic' : e.code === 'KeyF' ? 'free-memory' : null;
    const btn = target && document.querySelector(`[data-action="${target}"]`);
    if (btn) { e.preventDefault(); if (!btn.disabled) btn.click(); return; }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.view === 'interview' && state.session && !state.ending) {
    e.preventDefault();
    saveAnswer();
  }
  // Enter/space on a chapter paragraph opens its sources, like a click.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.prose p[data-action]')) {
    e.preventDefault();
    e.target.click();
  }
});

boot().catch((e) => {
  $app.innerHTML = `<div class="page narrow"><h1 class="display">打不开</h1><p class="lede">${h(e.message)}</p><p>请确认网络正常，然后刷新页面。</p></div>`;
});
