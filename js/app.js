import { db } from './db.js';
import { VoiceCapture, speechSupport, speak } from './speech.js';
import * as ai from './ai.js';
import { downloadQuickBackup, downloadFullBackup, restore } from './backup.js';
import {
  suggestStage, eventsForStage, yearRangeForStage, mergeTimeline, profileText,
  parseChapter, chapterMarkdown, daysSince, cryptoId, birthYear, nextBankQuestion,
  UNSORTED, FREE_QUESTION,
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
  micError: '',
};

const $app = document.getElementById('app');
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stageById = (id) => state.stages.find((s) => s.id === id) || state.stages[0];
const answersFor = (pred) => state.turns.filter((t) => t.role === 'a' && pred(t)).sort((a, b) => a.ts - b.ts);
const hasAI = () => !!ai.getKey();
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
  arrow: '<path d="M5 12h13.5M13 6.5 18.5 12 13 17.5"/>',
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
  const sessions = await db.all('sessions');
  state.session = sessions.find((s) => !s.endedAt) || null;
  if (state.session) state.question = (await db.getKV('currentQuestion')) || stageById(state.session.stage).opening;
  db.persist();
  state.view = location.hash.slice(1) || 'interview';
  window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'interview', false));
  window.addEventListener('beforeunload', (e) => { if (state.voice) { e.preventDefault(); e.returnValue = ''; } });
  render();
}

function go(view, push = true) {
  state.view = view;
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
    box.addEventListener('input', () => { state.draft = box.value; });
  }
}

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
    return `<button class="band-seg ${cls}" data-action="${action}" data-stage="${s.id}" aria-pressed="${s.id === activeId}" title="${h(s.title)} · ${n ? `已聊 ${n} 段` : '还没聊'}"><span class="full">${h(s.title)}</span><span class="short" aria-hidden="true">${h(s.short || s.title)}</span></button>`;
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
  if (!state.session) return viewStart();
  const stage = stageById(state.session.stage);
  const sessionAnswers = answersFor((t) => t.sessionId === state.session.id);
  const rec = !!state.voice;
  const locked = state.questionBusy || !!state.busy;

  const questionBlock = state.free
    ? `<h1 class="q free">姥姥想起来的事</h1>
       <p class="q-sub">${clauses(`不用管问题，让姥姥想说什么就说什么。说完点保存${hasAI() ? '，AI 会把它归到对应的人生阶段，再顺着往下问' : '，先放进「待归类」，以后再归到对应阶段'}。`)}</p>
       <div class="pills"><button class="pill" data-action="cancel-free" ${rec ? 'disabled' : ''}>${icon('back')}回到原来的问题</button></div>`
    : `<h1 class="q ${state.questionBusy ? 'loading' : ''}" id="question" aria-live="polite">${clauses(state.question)}</h1>
       <div class="pills">
         <button class="pill" data-action="speak" ${state.questionBusy ? 'disabled' : ''}>${icon('speak')}读给姥姥听</button>
         <button class="pill" data-action="other-question" ${locked || rec ? 'disabled' : ''}>${icon('refresh')}换个问题</button>
         <button class="pill strong" data-action="free-memory" ${locked ? 'disabled' : ''}>${icon('memory')}姥姥想起别的事</button>
       </div>`;

  return `<div class="interview">
    <section class="work">
      <div class="work-top">
        ${stageBand(stage.id, 'switch-stage')}
        <button class="pill quiet" data-action="end-session" ${state.busy || rec ? 'disabled' : ''}>结束这次访谈</button>
      </div>
      ${questionBlock}
      <div class="rec">
        <div class="mic-col">
          <button class="mic ${rec ? 'recording' : ''}" data-action="toggle-mic" aria-pressed="${rec}">
            ${icon(rec ? 'stop' : 'mic', 34)}<span>${rec ? '停止' : '开始说'}</span>
          </button>
          <div class="mic-time" id="mic-time">${rec ? '0:00' : ''}</div>
        </div>
        <div class="well-col">
          <textarea id="answer-box" class="well ${rec ? 'live' : ''}" aria-label="姥姥说的话" placeholder="${rec ? '姥姥说的话会出现在这里…' : '点「开始说」录音，姥姥说的话会自动变成文字；也可以直接打字，随时能改。'}"></textarea>
          <div class="interim ${state.micError ? 'error' : ''}" id="interim" role="status">${h(state.micError || state.interim)}</div>
          ${!speechSupport.recognition ? `<p class="mode-note">这个浏览器不能把语音直接转成文字（建议用 Chrome）。录音照常保存；文字可以打字，或点进文本框后按两下 <kbd>fn</kbd> 用 Mac 听写。</p>` : ''}
          <div class="actions">
            <button class="btn-primary" data-action="save-answer" ${locked ? 'disabled' : ''}>${state.free ? '保存这段回忆' : '保存，问下一个'}${icon('arrow')}</button>
            <button class="pill quiet" data-action="clear-draft" ${rec ? 'disabled' : ''}>清空</button>
            <span class="hint">⌘ + 回车 也能保存</span>
          </div>
          ${!hasAI() && !state.free ? `<p class="hint mode-hint">现在按题库提问。在「设置」里填上 Claude 密钥，AI 就会接着姥姥的话追问。</p>` : ''}
        </div>
      </div>
      ${state.busy ? `<p class="busy"><span class="spinner"></span>${h(state.busy)}</p>` : ''}
      ${sessionAnswers.length ? `<section class="log" aria-label="这次记下的">
        <h2 class="log-title">这次记下的 · ${sessionAnswers.length} 段</h2>
        ${sessionAnswers.slice().reverse().map(logItem).join('')}
      </section>` : ''}
    </section>
    ${eraAside(stage)}
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
    <div class="log-tools">
      ${t.audioIds?.length ? `<button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听原声</button>` : ''}
      <button class="link" data-action="edit" data-id="${t.id}">${icon('edit', 16)}改文字</button>
      ${t.free ? stageSelect(t) : ''}
    </div>
  </article>`;
}

function viewSetup() {
  const p = state.profile;
  return `<div class="start">
    <h1 class="display">先认识一下${h(p.name)}</h1>
    <p class="lede">填好出生日期和家乡，右边的「那一年」才能找到她那个年纪发生的事。只存在这台电脑上。</p>
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
      <span class="tag ${c.region === '邯郸' ? 'local' : ''}">${h(c.region)}</span>${isWeb ? '<span class="tag">网上找到</span>' : ''}</div>
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
      ? `<button class="pill" data-action="find-cues" ${state.cueBusy ? 'disabled' : ''}>${state.cueBusy ? '<span class="spinner"></span>正在查找，约半分钟' : `${icon('search')}上网找${h(hometown())}当年的事`}</button>`
      : `<p class="era-note">填上密钥后，可以上网找更多${h(hometown())}当年的事。</p>`}
  </aside>`;
}

// ---------- timeline ----------
function viewTimeline() {
  if (!state.timeline.length) {
    return `<div class="page narrow"><h1 class="display">人生时间线</h1><p class="lede">${hasAI()
      ? '每次「结束这次访谈」时，AI 会把姥姥讲到的事按年份整理到这里。'
      : '填上 Claude 密钥后，每次结束访谈 AI 会把姥姥讲到的事按年份整理到这里。没有密钥时，原话都在「回忆录」里按阶段排好。'}</p></div>`;
  }
  const sorted = [...state.timeline].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  const groups = {};
  for (const e of sorted) (groups[e.year ? `${Math.floor(e.year / 10) * 10} 年代` : '年份不详'] ??= []).push(e);
  return `<div class="page narrow">
    <h1 class="display">${h(state.profile.name)}的人生时间线</h1>
    <p class="lede">AI 从访谈里整理的，每条都能点「原话」核对，整理错了可以删掉。</p>
    ${Object.entries(groups).map(([dec, items]) => `<section class="decade"><h2>${dec}</h2>${items.map((e) => `
      <div class="tl-item">
        <div class="tl-when">${e.year ?? '—'}<small>${e.age != null ? `${e.age} 岁` : ''}${e.place ? ` · ${h(e.place)}` : ''}</small></div>
        <div class="tl-what">${h(e.event)}${e.people?.length ? `<small>人物：${h(e.people.join('、'))}</small>` : ''}
          ${state.openTimelineSrc === e.id ? (e.turnIds || []).map((id) => {
            const t = state.turns.find((x) => x.id === id);
            return t ? `<div class="src"><small>${t.free ? '姥姥主动讲的' : h(t.question)}</small>${h(t.text)}${t.audioIds?.length ? ` <button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听</button>` : ''}</div>` : '';
          }).join('') : ''}
        </div>
        <div class="tl-tools"><button class="link" data-action="tl-src" data-id="${e.id}">${state.openTimelineSrc === e.id ? '收起' : '原话'}</button>
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
      ? '每一章由 AI 用姥姥的口吻整理她的原话，不添加她没说过的事。点任意一段，能看到它出自哪几段原话、听原声。底色发黄的段落没找到出处，请核对。'
      : '现在每章按原话一问一答排好，可以直接打印。填上 Claude 密钥后，可以让 AI 用姥姥的口吻写成连贯的文章。'}</p>
    ${unsorted.length ? `<section class="unsorted no-print"><h2>待归类的回忆 · ${unsorted.length}</h2><p class="era-note">姥姥主动讲的事，选一下属于哪个阶段，就会排进对应的章节。</p>
      ${unsorted.map((t) => `<article class="log-item is-free"><p class="log-a">${h(t.text)}</p><div class="log-tools">${t.audioIds?.length ? `<button class="link" data-action="play" data-audio="${t.audioIds.join(',')}">${icon('play', 16)}听原声</button>` : ''}${stageSelect(t)}</div></article>`).join('')}
    </section>` : ''}
    ${state.stages.map(chapterBlock).join('')}
    ${unsorted.length ? `<section class="chapter print-only"><div class="chapter-head"><h2>其他回忆</h2></div>
      <div class="prose raw">${unsorted.map((t) => `<div class="qa"><p>${h(t.text)}</p></div>`).join('')}</div></section>` : ''}
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
  else if (ch) body = ch.paragraphs.map((p, i) => `<p class="${p.ids.length ? '' : 'uncited'}" data-action="toggle-src" data-key="${stage.id}:${i}" tabindex="0">${h(p.text)}</p>${state.openSources === `${stage.id}:${i}` ? sourcesBox(p.ids) : ''}`).join('');
  else body = answers.map((a) => `<div class="qa">${a.free ? '' : `<p class="qa-q">${h(a.question)}</p>`}<p>${h(a.text)}</p></div>`).join('');
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
        <h2>AI 助手（可选）</h2>
        <p>${key ? '已开启。密钥只存在这台电脑的这个浏览器里。' : '不填也能用：按题库提问、录音、存档。填上 Claude 密钥后，AI 会接着姥姥的话追问、整理人生时间线、写成文章。'}</p>
        <div class="field"><label for="key">Claude 密钥</label><input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${h(key)}"></div>
        <div class="actions"><button class="btn-primary small" data-action="save-key">保存并检查</button>${key ? '<button class="pill quiet danger" data-action="remove-key">删除密钥</button>' : ''}</div>
        <p class="hint">每次 AI 追问大约两毛钱人民币，写一章大约一两块钱。给密钥设好每月消费上限，就不用担心超支。</p>
      </section>
      <section class="panel">
        <h2>姥姥的信息</h2>
        <div class="field"><label for="p-name">称呼</label><input id="p-name" value="${h(p.name)}"></div>
        <div class="field"><label for="p-birth">出生日期</label><input id="p-birth" type="date" value="${h(p.birthDate)}"></div>
        <div class="field"><label for="p-place">出生地 / 主要生活的地方</label><input id="p-place" value="${h(p.birthplace)}"></div>
        <div class="field"><label for="p-places">家人补充（搬过家、在哪工作过，可不填）</label><textarea id="p-places" rows="3">${h(p.places)}</textarea></div>
        <button class="btn-primary small" data-action="save-profile">保存</button>
      </section>
      <section class="panel">
        <h2>备份</h2>
        <p>所有内容只存在这台电脑的浏览器里。清理浏览器数据或换电脑会丢，所以要常备份，并把备份文件发给家人存一份。每次结束访谈会自动下载一份文字备份。</p>
        <div class="stack">
          <button class="pill" data-action="quick-backup">${icon('download')}文字备份（.json，很小）</button>
          <button class="pill" data-action="full-backup">${icon('download')}完整备份含录音（.zip）</button>
          <label class="pill" for="restore-file">从备份恢复…</label><input id="restore-file" type="file" accept=".json,.zip" hidden>
        </div>
      </section>
    </div>
  </div>`;
}

function viewHelp() {
  return `<div class="page narrow help">
    <h1 class="display">使用说明</h1>
    <h2>第一次</h2>
    <ol>
      <li>用 <b>Chrome</b> 打开这个网址（Safari 也行，但语音转文字 Chrome 更稳）。</li>
      <li>想要 AI 追问的话，在「设置」里粘贴家人给的 Claude 密钥。不填也能用。</li>
      <li>第一次按「开始说」时，浏览器会问能不能用麦克风，点「允许」。</li>
    </ol>
    <h2>每次聊天</h2>
    <ol>
      <li>在「访谈」里点一个人生阶段开始。</li>
      <li>把问题读给姥姥听，或者点「读给姥姥听」。</li>
      <li>点深色的大按钮「开始说」，姥姥说完点「停止」。文字不对可以直接改。</li>
      <li>点「保存，问下一个」。问题不合适就点「换个问题」。</li>
      <li><b>姥姥突然想起别的事</b>：随时点「姥姥想起别的事」，让她尽管说。${'有密钥时 AI 会把它归到对应阶段并顺着往下问；没有密钥时先放进「待归类」，以后在「回忆录」里选一下阶段就行。'}</li>
      <li>右边「那一年」是姥姥那个年纪时发生的事，可以问她还记不记得。</li>
      <li>聊完点「结束这次访谈」，会<b>自动下载一份备份</b>。</li>
    </ol>
    <h2>小提示</h2>
    <ul>
      <li>一次聊二三十分钟就好，姥姥累了就停，下次接着聊。</li>
      <li>姥姥说「不记得了」没关系，换个话题。老照片、老物件特别能勾起回忆。</li>
      <li>录音只存在这台电脑上，不会上传；发给 AI 的只有文字。</li>
      <li>每隔几天在「设置」里下载一份<b>完整备份（含录音）</b>，发给家人。</li>
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
    state.session.stage = el.dataset.stage;
    state.free = false;
    await db.put('sessions', state.session);
    const stage = stageById(el.dataset.stage);
    if (answersFor((t) => t.stage === stage.id).length) await askNext(); else setQuestion(stage.opening);
    render();
  },
  speak: () => speak(state.question),
  'other-question': () => askNext(state.question),
  'use-cue': (el) => { state.free = false; setQuestion(el.dataset.q); render(); },
  'free-memory': async () => {
    state.returnQuestion = state.question;
    state.free = true;
    render();
    if (!state.voice) await startMic();
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
  'cancel-free': () => { state.free = false; setQuestion(state.returnQuestion || state.question); render(); },
  'toggle-mic': () => (state.voice ? stopMic() : startMic()),
  'clear-draft': () => { state.draft = ''; state.interim = ''; render(); },
  'save-answer': saveAnswer,
  'end-session': endSession,
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
  return nextBankQuestion(stage, asked, current)
    || '这个阶段的题库问完了。可以换一个人生阶段，或者让姥姥想到什么说什么。';
}

async function askNext(avoidQuestion) {
  const stage = stageById(state.session.stage);
  const prev = state.question;
  if (!hasAI()) { setQuestion(bankQuestion(stage, prev)); render(); return; }
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
    });
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
      const box = document.getElementById('answer-box');
      if (box) { box.value = finalText; box.scrollTop = box.scrollHeight; }
      const im = document.getElementById('interim');
      if (im) im.textContent = interim;
    },
    onError: (msg) => {
      state.micError = msg;
      const im = document.getElementById('interim');
      if (im) { im.textContent = msg; im.classList.add('error'); }
    },
  });
  state.micError = '';
  const box = document.getElementById('answer-box');
  if (box) state.draft = box.value;
  if (!(await v.start(state.draft))) return;
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

let pendingAudio = [];
async function stopMic() {
  clearInterval(timer);
  const v = state.voice;
  state.voice = null;
  const { text, audio } = await v.stop();
  if (text) state.draft = text;
  state.interim = '';
  if (audio) pendingAudio.push(audio);
  render();
}

async function saveAnswer() {
  if (state.voice) await stopMic();
  const box = document.getElementById('answer-box');
  if (box) state.draft = box.value;
  const text = state.draft.trim();
  if (!text && !pendingAudio.length) return toast('还没有内容。先录音或者打字。', true);

  const audioIds = [];
  for (const a of pendingAudio) {
    const id = `r_${cryptoId()}`;
    await db.put('audio', { id, ...a });
    audioIds.push(id);
  }
  pendingAudio = [];
  const free = state.free;
  const turn = {
    id: `a_${cryptoId()}`, role: 'a', sessionId: state.session.id,
    stage: free ? UNSORTED : state.session.stage,
    question: free ? FREE_QUESTION : state.question,
    text: text || '（只有录音，文字待补）', ts: Date.now(), audioIds, free,
  };
  await db.put('turns', turn);
  state.turns.push(turn);
  state.draft = '';

  if (!free) return askNext();

  state.free = false;
  if (!hasAI() || !text) {
    toast('记下了，放在「待归类」。');
    setQuestion(state.returnQuestion || state.question);
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

async function endSession() {
  const sessionAnswers = answersFor((t) => t.sessionId === state.session.id);
  if (state.draft.trim() && !confirm('文本框里还有没保存的话，确定结束吗？')) return;
  let added = 0;
  if (sessionAnswers.length && hasAI()) {
    state.busy = '正在整理这次聊到的人生经历…';
    render();
    try {
      const events = await ai.extractEvents({
        profileText: profileText(state.profile),
        turnsText: expand(sessionAnswers).map((t) => (t.role === 'q' ? `问：${t.text}` : `[${t.id}] 姥姥：${t.text}`)).join('\n'),
      });
      const merged = mergeTimeline(state.timeline, events, state.turns.map((t) => t.id), state.profile.birthDate);
      added = merged.length - state.timeline.length;
      for (const e of merged.slice(state.timeline.length)) await db.put('timeline', e);
      state.timeline = merged;
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
    await downloadQuickBackup();
    toast(`这次记下 ${sessionAnswers.length} 段${hasAI() ? `，时间线新增 ${added} 条` : ''}。备份已自动下载。`);
  }
  render();
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
    state.webCues[stage.id] = cues.map((c) => ({
      year: c.year, region: c.region, title: c.title, summary: c.summary, cue: c.question,
      source: { title: c.source_title, url: c.source_url },
    }));
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
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return go(tab.dataset.view);
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) Promise.resolve(fn(el)).catch((err) => toast(ai.explain(err), true));
});

document.addEventListener('change', async (e) => {
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
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.view === 'interview' && state.session) {
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
