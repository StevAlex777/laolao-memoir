import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ageInYear, yearRangeForStage, eventsForStage, eventsInRange, suggestStage,
  mergeTimeline, validateCues, parseChapter, validateBackup, daysSince,
  interviewUserMessage, chapterMarkdown, timelineText, nextBankQuestion, classifyTool, UNSORTED,
} from '../js/core.js';

const timeline = JSON.parse(readFileSync(new URL('../data/timeline.json', import.meta.url)));
const { stages } = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url)));
const BIRTH = '1948-01-01';
const profile = { name: '姥姥', gender: '女', birthDate: BIRTH, birthplace: '某地' };

test('age and stage year ranges follow the 1948 birth year', () => {
  assert.equal(ageInYear(BIRTH, 1966), 18);
  const childhood = stages.find((s) => s.id === 'childhood');
  assert.deepEqual(yearRangeForStage(childhood, BIRTH), { from: 1954, to: 1962 });
});

test('childhood stage surfaces the famine years and Handan steel mill, local first in the same year', () => {
  const ev = eventsForStage(timeline.events, stages.find((s) => s.id === 'childhood'), BIRTH);
  const titles = ev.map((e) => e.title);
  assert.ok(titles.includes('三年困难时期'));
  assert.ok(titles.includes('邯郸钢铁厂成立'));
  const y1958 = ev.filter((e) => e.year === 1958);
  assert.equal(y1958[0].region, '邯郸');
});

test('multi-year events overlap ranges correctly', () => {
  const ev = eventsInRange(timeline.events, 1970, 1970).map((e) => e.title);
  assert.ok(ev.includes('文化大革命'));
  assert.ok(!ev.includes('唐山大地震'));
});

test('every offline event has a wikipedia source and a cue question', () => {
  for (const e of timeline.events) {
    assert.match(e.source.url, /^https:\/\/zh\.wikipedia\.org\/zh-cn\//, e.title);
    assert.ok(e.cue.length > 5, e.title);
  }
});

test('suggestStage picks the first stage with too few answers', () => {
  const turns = Array.from({ length: 6 }, (_, i) => ({ id: `a_${i}`, role: 'a', stage: 'roots' }));
  assert.equal(suggestStage(stages, turns), 'childhood');
  assert.equal(suggestStage(stages, []), 'roots');
});

test('mergeTimeline drops ungrounded events, fills year from age, dedupes', () => {
  const incoming = [
    { year: null, age: 10, place: '邯郸', event: '进了村里的小学', people: [], turn_ids: ['a_1'] },
    { year: 1966, age: null, place: null, event: '编造的事', people: [], turn_ids: ['a_missing'] },
    { year: 1958, age: null, place: null, event: '进了村里的小学', people: [], turn_ids: ['a_1'] },
  ];
  const out = mergeTimeline([], incoming, ['a_1'], BIRTH);
  assert.equal(out.length, 1);
  assert.equal(out[0].year, 1958);
  assert.equal(out[0].age, 10);
  assert.equal(mergeTimeline(out, incoming, ['a_1'], BIRTH).length, 1);
});

test('validateCues keeps only URLs that came back from search', () => {
  const cues = [
    { question: 'q1', source_url: 'https://example.com/a' },
    { question: 'q2', source_url: 'https://made-up.cn/x' },
  ];
  const kept = validateCues(cues, ['http://example.com/a/']);
  assert.deepEqual(kept.map((c) => c.question), ['q1']);
});

test('parseChapter splits paragraphs, strips markers, drops unknown ids', () => {
  const text = '我出生在邯郸。[[a_1,a_x]]\n\n那年发大水。[[a_2]]\n\n没有出处的段落';
  const p = parseChapter(text, ['a_1', 'a_2']);
  assert.deepEqual(p, [
    { text: '我出生在邯郸。', ids: ['a_1'] },
    { text: '那年发大水。', ids: ['a_2'] },
    { text: '没有出处的段落', ids: [] },
  ]);
});

test('interview prompt carries profile, stage and avoided question', () => {
  const stage = stages[0];
  const msg = interviewUserMessage({ profile, timeline: [], stage, stageTurns: [], recentTurns: [], events: [], avoidQuestion: '旧问题' });
  assert.match(msg, /1948-01-01/);
  assert.match(msg, /家乡与家人/);
  assert.match(msg, /旧问题/);
});

test('backup validation and markdown export', () => {
  assert.equal(validateBackup({ app: 'other' }), '这不是本应用导出的备份文件。');
  assert.equal(validateBackup({ app: 'laolao-memoir', version: 1, profile: {}, sessions: [], turns: [], timeline: [], chapters: [] }), null);
  const md = chapterMarkdown(profile, [{ stage: 'roots', paragraphs: [{ text: '我出生在邯郸。', ids: [] }] }], stages);
  assert.match(md, /# 姥姥的回忆录\n\n## 家乡与家人\n\n我出生在邯郸。/);
  assert.equal(daysSince('2026-11-01T00:00:00Z', Date.parse('2026-11-09T00:00:00Z')), 8);
  assert.equal(timelineText([]), '（还没有记录）');
});

test('without AI, the bank hands out unused questions, then the opening, then nothing', () => {
  const stage = { opening: 'O', questions: ['A', 'B'] };
  assert.equal(nextBankQuestion(stage, [], 'O'), 'A');
  assert.equal(nextBankQuestion(stage, ['A'], 'A'), 'B');
  assert.equal(nextBankQuestion(stage, ['A', 'B'], 'B'), 'O');
  assert.equal(nextBankQuestion(stage, ['A', 'B', 'O'], 'O'), null);
});

test('classify tool only allows real stage ids', () => {
  const tool = classifyTool(stages);
  assert.deepEqual(tool.input_schema.properties.stage.enum, stages.map((s) => s.id));
  assert.equal(tool.strict, true);
});

test('markdown export falls back to her raw answers and keeps unsorted memories', () => {
  const answers = [
    { stage: 'roots', question: '您在哪儿出生？', text: '邯郸东边。' },
    { stage: UNSORTED, free: true, question: '（姥姥主动讲的）', text: '我想起来那年下大雪。' },
  ];
  const md = chapterMarkdown(profile, [], stages, answers);
  assert.match(md, /## 家乡与家人\n\n\*\*问：您在哪儿出生？\*\*\n\n邯郸东边。/);
  assert.match(md, /## 其他回忆\n\n我想起来那年下大雪。/);
});

test('no birth date yet: no year range and no era events, nothing crashes', () => {
  const stage = stages[0];
  assert.equal(yearRangeForStage(stage, ''), null);
  assert.deepEqual(eventsForStage(timeline.events, stage, ''), []);
});

import { encodeWav, asrContext, applyRefined } from '../js/core.js';

test('encodeWav writes a valid 16 kHz mono PCM header and clamps samples', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(48, true), -32768);
  assert.equal(v.getInt16(50, true), 32767);
});

test('refined text replaces the draft only when the draft was not edited', () => {
  const untouched = { text: '那几年怀化拌面', draft: '那几年怀化拌面' };
  assert.equal(applyRefined(untouched, '那几年槐花拌面').text, '那几年槐花拌面');
  const edited = { text: '那几年槐花拌面（她笑了）', draft: '那几年怀化拌面' };
  const r = applyRefined(edited, '那几年槐花拌面');
  assert.equal(r.text, '那几年槐花拌面（她笑了）');
  assert.equal(r.refined, '那几年槐花拌面');
});

test('recognizer hints include her places and timeline names', () => {
  const ctx = asrContext({ birthplace: '河北邯郸峰峰', places: '女儿住邯郸市区' }, [{ place: '彭城', people: ['王老师'] }]);
  assert.match(ctx, /峰峰/); assert.match(ctx, /彭城/); assert.match(ctx, /王老师/);
});
