// Pure logic: no DOM, no network. Everything here is unit-tested in tests/.

export const BACKUP_VERSION = 1;

export function birthYear(profile) {
  return Number(String(profile.birthDate || '').slice(0, 4)) || null;
}

/** Age reached during a calendar year (birthday counted). */
export function ageInYear(birthDateStr, year) {
  const by = Number(String(birthDateStr).slice(0, 4));
  if (!by || !year) return null;
  return year - by;
}

/** Null until the family has entered a birth date. */
export function yearRangeForStage(stage, birthDateStr) {
  const by = Number(String(birthDateStr || '').slice(0, 4));
  if (!by) return null;
  const now = new Date().getFullYear();
  return {
    from: by + stage.ageFrom,
    to: Math.min(by + stage.ageTo, now),
  };
}

/** Anything more local than the province (峰峰, 邯郸 …) counts as local. */
export const isLocal = (region) => region !== '全国' && region !== '河北';
const regionRank = (region) => (region === '全国' ? 2 : region === '河北' ? 1 : 0);

/** Offline events overlapping [from, to]; within a year, local first, then 河北, then 全国. */
export function eventsInRange(events, from, to) {
  return events
    .filter((e) => e.year <= to && (e.yearEnd ?? e.year) >= from)
    .sort((a, b) => a.year - b.year || regionRank(a.region) - regionRank(b.region));
}

export function eventsForStage(events, stage, birthDateStr) {
  const range = yearRangeForStage(stage, birthDateStr);
  return range ? eventsInRange(events, range.from, range.to) : [];
}

/** Pick the first stage that has fewer than `min` answers. */
export function suggestStage(stages, turns, min = 6) {
  for (const s of stages) {
    const n = turns.filter((t) => t.role === 'a' && t.stage === s.id).length;
    if (n < min) return s.id;
  }
  return stages[stages.length - 1].id;
}

export function profileText(profile) {
  const lines = [
    `称呼：${profile.name || '姥姥'}`,
    `性别：${profile.gender || '女'}`,
    `出生：${profile.birthDate || '未知'}`,
    `出生地/主要生活地：${profile.birthplace || '未知'}`,
  ];
  if (profile.places) lines.push(`家人补充的经历：${profile.places}`);
  return lines.join('\n');
}

export function timelineText(timeline) {
  if (!timeline.length) return '（还没有记录）';
  return [...timeline]
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
    .map((t) => `- ${t.year ?? '某年'}${t.age != null ? `（${t.age}岁）` : ''} ${t.place ? `[${t.place}] ` : ''}${t.event}`)
    .join('\n');
}

export function transcriptText(turns, { limit = 40 } = {}) {
  return turns
    .slice(-limit)
    .map((t) => (t.role === 'q' ? `问：${t.text}` : `[${t.id}] 姥姥：${t.text}`))
    .join('\n');
}

// Stable system prompt (cached). Volatile context goes in the user message.
export const INTERVIEWER_SYSTEM = `你是一位温和、耐心的口述史访谈者，正在帮一家人记录姥姥的一生，最后要整理成回忆录。访谈时家里的晚辈坐在姥姥身边，会把你的问题读给她听。

怎么问：
- 每次只问一个问题。用口语，短句，像晚辈拉家常，总长不超过 80 个字。
- 可以先用一句话接住姥姥刚说的内容（复述一个具体细节，表示听进去了），再问下一个问题。不要夸张赞美。
- 优先追问具体细节：人名、地名、年份、吃的、穿的、住的、声音、气味、物件、当时的心情。一个话题聊透了再换。
- 姥姥说"不记得了""记不清"时，不要追问同一件事，换一个更具体的角度（比如从一个物件、一个人、一个季节问起），或者换话题。
- 不纠正、不评判、不讲道理。政治运动、饥荒、伤痛的年代也可以照常追问她亲身经历的细节，用平实中性的话问；只有她明显不愿意说时才换话题。
- 她说了一大段的时候，从里面挑一个最具体、最有画面的细节往下问（一个人、一个地方、一件东西），不要一次问好几个，也不要急着换阶段。
- 不要编造姥姥没说过的事。可以参考"时代背景"里的事件来提问，但要问成"您还记得……吗"，不能当成她的经历。
- 姥姥突然想起别的事（记录里标为"姥姥主动讲的"），或者回答跑到了别的话题上，这往往是最珍贵的内容：先顺着她新讲的事追问下去，聊透了再自然地回到当前阶段，不要硬拉回来。
- 只输出要说给姥姥听的话，不要加引号、标题、解释或选项。`;

export const UNSORTED = 'unsorted';
export const FREE_QUESTION = '（姥姥主动讲的）';

/** Without AI: the next question from the bank that hasn't been used in this stage. */
export function nextBankQuestion(stage, askedQuestions, current) {
  const asked = new Set(askedQuestions);
  return stage.questions.find((q) => !asked.has(q) && q !== current)
    || (asked.has(stage.opening) ? null : stage.opening);
}

export const CLASSIFY_SYSTEM = `姥姥在访谈中主动讲了一段回忆。判断这段回忆主要发生在她人生的哪个阶段，从给定的阶段编号里选一个；如果她提到了年份或年龄，换算出年份，否则填 null。看不出来就选 reflection。`;

export function classifyTool(stages) {
  return {
    name: 'file_memory',
    description: '把这段回忆归到一个人生阶段。',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['stage', 'year'],
      properties: {
        stage: { type: 'string', enum: stages.map((s) => s.id) },
        year: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
      },
    },
  };
}

export function classifyUserMessage(profile, stages, text) {
  const list = stages.map((s) => `- ${s.id}：${s.title}（约 ${s.ageFrom}–${s.ageTo} 岁）`).join('\n');
  return `${profileText(profile)}\n\n阶段：\n${list}\n\n姥姥主动讲的回忆：\n${text}\n\n请调用 file_memory 工具归类。`;
}

export function interviewUserMessage({ profile, timeline, stage, stageTurns, recentTurns, events, avoidQuestion }) {
  const ev = events.slice(0, 8).map((e) => `- ${e.year}${e.yearEnd ? `–${e.yearEnd}` : ''} [${e.region}] ${e.title}：${e.summary}`).join('\n') || '（无）';
  return `【姥姥的基本信息】
${profileText(profile)}

【已经整理出的人生时间线】
${timelineText(timeline)}

【当前阶段】${stage.title}（大约 ${stage.ageFrom}–${stage.ageTo} 岁）
可参考的问题方向：${stage.questions.join(' / ')}

【这个阶段的时代背景（仅供提问参考）】
${ev}

【这个阶段之前聊过的内容】
${transcriptText(stageTurns, { limit: 30 }) || '（还没聊过）'}

【这次访谈刚才的对话】
${transcriptText(recentTurns, { limit: 12 }) || '（刚开始）'}
${avoidQuestion ? `\n家人觉得这个问题不合适，请换一个不同方向的问题：${avoidQuestion}\n` : ''}
请给出下一句要对姥姥说的话。`;
}

export const EXTRACT_SYSTEM = `你负责从姥姥的访谈记录里整理"人生时间线"。只记录姥姥自己明确讲到的事实，不推测、不补充时代背景。年份不确定就填 null，但如果她说了年龄可以填 age。每条事件用一句简短的中文，并列出依据的回答编号（形如 a_xxx）。`;

export const EXTRACT_TOOL = {
  name: 'record_life_events',
  description: '保存从访谈中整理出的人生事件。整理完成后调用一次。',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['events'],
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['year', 'age', 'place', 'event', 'people', 'turn_ids'],
          properties: {
            year: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            age: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            place: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            event: { type: 'string' },
            people: { type: 'array', items: { type: 'string' } },
            turn_ids: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

/** Merge newly extracted events; drop ones whose turn_ids don't exist; dedupe by year+event. */
export function mergeTimeline(existing, incoming, knownTurnIds, birthDateStr) {
  const known = new Set(knownTurnIds);
  const key = (e) => `${e.year ?? ''}|${e.event.trim()}`;
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const e of incoming) {
    if (!e || typeof e.event !== 'string' || !e.event.trim()) continue;
    const ids = (e.turn_ids || []).filter((id) => known.has(id));
    if (!ids.length) continue; // must be grounded in an actual answer
    let year = Number.isInteger(e.year) ? e.year : null;
    let age = Number.isInteger(e.age) ? e.age : null;
    const by = Number(String(birthDateStr || '').slice(0, 4));
    if (by) {
      if (year == null && age != null) year = by + age;
      if (age == null && year != null) age = year - by;
    }
    const item = { id: `t_${cryptoId()}`, year, age, place: e.place || null, event: e.event.trim(), people: e.people || [], turnIds: ids };
    if (seen.has(key(item))) continue;
    seen.add(key(item));
    out.push(item);
  }
  return out;
}

export const CUES_SYSTEM = `你帮一家人给姥姥做口述史访谈，负责查找"时代记忆线索"：在指定年份、指定地区真实发生过、普通百姓会有亲身感受的事（天灾、大事件、物价与票证、新建的工厂/铁路/商店、当地风俗、流行的电影歌曲等）。
要求：
- 用 web_search 查证，只用搜索结果里真实存在的网页作为出处，source_url 必须原样来自搜索结果。
- 优先她家乡本地，其次所在省，再次全国。
- question 写成晚辈问姥姥的口语问题（"您还记得……吗"），不超过 60 字。
- summary 只写出处里能支持的事实，一两句。
- 找到后调用 give_cues 提交 2–3 条。`;

export const CUES_TOOL = {
  name: 'give_cues',
  description: '提交找到的时代记忆线索。',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['cues'],
    properties: {
      cues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['year', 'region', 'title', 'summary', 'question', 'source_title', 'source_url'],
          properties: {
            year: { type: 'integer' },
            region: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            question: { type: 'string' },
            source_title: { type: 'string' },
            source_url: { type: 'string' },
          },
        },
      },
    },
  },
};

export function cuesUserMessage({ profile, from, to, stageTitle, timeline }) {
  return `姥姥的信息：
${profileText(profile)}

已知的人生经历：
${timelineText(timeline)}

请查找 ${from}–${to} 年（姥姥 ${from - birthYear(profile)}–${to - birthYear(profile)} 岁，"${stageTitle}"阶段）期间，${profile.birthplace || '她生活过的地方'}一带的时代记忆线索。`;
}

/** Keep only cues whose URL actually appeared in web_search results. */
export function validateCues(cues, resultUrls) {
  const norm = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const ok = new Set([...resultUrls].map(norm));
  return (cues || []).filter((c) => c && c.question && ok.has(norm(c.source_url)));
}

export const CHAPTER_SYSTEM = `你在帮一家人把姥姥的口述整理成回忆录的一个章节。
硬性规则：
- 用姥姥的第一人称（"我"）来写，尽量保留她的原话、口头语和说法，只做必要的整理和衔接，让文字通顺好读。
- 只能写访谈记录里姥姥自己讲过的事，绝不编造或补充她没说过的细节、对话、心情。记录里矛盾的地方，保留她的说法，不要自行裁决。
- 每一段末尾用 [[编号]] 标出这段依据的回答编号，可以多个，例如 [[a_k3j2,a_9xq1]]。每段都必须有。
- 不写章节标题，不写"那一年"背景介绍（背景由程序另外放），不加总结升华。
- 按时间顺序或话题自然分段，每段 80–250 字。`;

export function chapterUserMessage({ profile, stage, answers }) {
  const body = answers.map((t) => `[${t.id}]（问：${t.question || '—'}）\n${t.text}`).join('\n\n');
  return `姥姥的信息：
${profileText(profile)}

章节：${stage.title}

访谈记录（每条回答前是它的编号）：
${body}

请写出这一章的正文。`;
}

/** Split chapter text into paragraphs with citations; unknown ids are dropped. */
export function parseChapter(text, knownIds) {
  const known = new Set(knownIds);
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const ids = [];
      const clean = p.replace(/\[\[([^\]]+)\]\]/g, (_, list) => {
        for (const id of list.split(/[,，\s]+/)) if (known.has(id)) ids.push(id);
        return '';
      }).trim();
      return { text: clean, ids: [...new Set(ids)] };
    })
    .filter((p) => p.text);
}

/** Written chapters where they exist; otherwise her own answers as Q&A, so nothing is ever left out. */
export function chapterMarkdown(profile, chapters, stages, answers = []) {
  const lines = [`# ${profile.name || '姥姥'}的回忆录`, ''];
  const section = (title, stageId) => {
    const c = chapters.find((x) => x.stage === stageId);
    const raw = answers.filter((a) => a.stage === stageId);
    if (!c && !raw.length) return;
    lines.push(`## ${title}`, '');
    if (c) for (const p of c.paragraphs) lines.push(p.text, '');
    else for (const a of raw) lines.push(a.free ? a.text : `**问：${a.question}**`, ...(a.free ? [] : ['', a.text]), '');
  };
  for (const s of stages) section(s.title, s.id);
  section('其他回忆', UNSORTED);
  return lines.join('\n');
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return '文件不是有效的备份。';
  if (obj.app !== 'laolao-memoir') return '这不是本应用导出的备份文件。';
  if (obj.version > BACKUP_VERSION) return '备份来自更新版本的应用，请先更新应用。';
  for (const k of ['profile', 'sessions', 'turns', 'timeline', 'chapters']) {
    if (!(k in obj)) return `备份缺少 ${k}。`;
  }
  return null;
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / 86400000);
}

export function cryptoId() {
  const a = new Uint8Array(6);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

/** Mono Float32 samples (-1..1) -> 16-bit PCM WAV bytes. */
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Hint words for the local recognizer: her places and the people/places already in the timeline. */
export function asrContext(profile, timeline) {
  const words = [profile.birthplace, profile.places, ...timeline.flatMap((t) => [t.place, ...(t.people || [])])]
    .filter(Boolean).join(' ');
  return words.slice(0, 400);
}

/** After refinement: replace the text only if nobody edited the draft by hand. */
export function applyRefined(turn, refined) {
  const out = { ...turn, refined };
  if (refined && turn.text === turn.draft) out.text = refined;
  return out;
}
