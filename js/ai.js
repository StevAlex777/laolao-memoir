// All Claude calls. Uses the official Anthropic SDK in the browser; the key is pasted
// into Settings and stored only in this browser (localStorage).
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
import {
  INTERVIEWER_SYSTEM, interviewUserMessage,
  EXTRACT_SYSTEM, EXTRACT_TOOL,
  CUES_SYSTEM, CUES_TOOL, cuesUserMessage, validateCues,
  CHAPTER_SYSTEM, chapterUserMessage,
  CLASSIFY_SYSTEM, classifyTool, classifyUserMessage,
} from './core.js';

export const MODEL = 'claude-opus-5-5';
const KEY_STORAGE = 'laolao-memoir.apiKey';

// Server-side refusal fallback: if a request is declined, the API retries it on a
// suitable model inside the same call.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

export function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setKey(k) {
  try { k ? localStorage.setItem(KEY_STORAGE, k.trim()) : localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
}

function client() {
  const apiKey = getKey();
  if (!apiKey) throw new FriendlyError('还没有填写 Claude 密钥。请到「设置」里粘贴密钥。');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

export class FriendlyError extends Error {}

/** Turn SDK errors into a sentence a non-programmer can act on. */
export function explain(err) {
  if (err instanceof FriendlyError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return '密钥不对或已失效。请到「设置」重新粘贴密钥。';
  if (err instanceof Anthropic.PermissionDeniedError) return '这个密钥没有权限使用该模型，或当前地区无法使用 Claude。';
  if (err instanceof Anthropic.RateLimitError) return '请求太频繁了，等一分钟再试。';
  if (err instanceof Anthropic.BadRequestError) return `请求被拒绝：${err.message}（如果提到 credit / billing，说明账户余额不足，需要在 Anthropic 控制台充值。）`;
  if (err instanceof Anthropic.InternalServerError) return 'Claude 服务暂时繁忙，稍等一会儿再试。';
  if (err instanceof Anthropic.APIConnectionError) return '连不上 Claude。请检查网络（如需代理，请确认已打开）。';
  if (err instanceof Anthropic.APIError) return `Claude 出错（${err.status}）：${err.message}`;
  return `出错了：${err?.message || err}`;
}

function refusalCheck(msg) {
  if (msg.stop_reason === 'refusal') throw new FriendlyError('Claude 没有回答这个请求。可以换个说法，或跳过这个问题。');
}

/** Check that the key works (cheap: model metadata lookup, no tokens billed). */
export async function testKey() {
  await client().models.retrieve(MODEL);
}

/** Stream the interviewer's next line. onDelta gets the text so far. */
export async function nextQuestion(ctx, onDelta) {
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: INTERVIEWER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: interviewUserMessage(ctx) }],
  });
  let text = '';
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      text += ev.delta.text;
      onDelta?.(text);
    }
  }
  const msg = await stream.finalMessage();
  refusalCheck(msg);
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/** Extract life events from this session's answers. Returns raw events (validated by mergeTimeline). */
export async function extractEvents({ profileText, turnsText }) {
  // tool_choice "auto" doesn't guarantee a call on this model, so check and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: 'low' },
      system: EXTRACT_SYSTEM,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: `${profileText}\n\n访谈记录：\n${turnsText}\n\n请整理后调用 record_life_events 工具保存。没有可记录的事件就传空数组。` }],
    });
    refusalCheck(msg);
    const call = msg.content.find((b) => b.type === 'tool_use' && b.name === EXTRACT_TOOL.name);
    if (call && Array.isArray(call.input?.events)) return call.input.events;
  }
  return [];
}

/** File a spontaneous memory under a life stage. Returns {stage, year} or null if the model didn't answer. */
export async function classifyMemory({ profile, stages, text }) {
  const tool = classifyTool(stages);
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: 'low' },
      system: CLASSIFY_SYSTEM,
      tools: [tool],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: classifyUserMessage(profile, stages, text) }],
    });
    refusalCheck(msg);
    const call = msg.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (call && stages.some((s) => s.id === call.input?.stage)) return call.input;
  }
  return null;
}

/** Search the web for era cues; only cues whose source URL came back from the search are kept. */
export async function findCues(ctx) {
  const c = client();
  const messages = [{ role: 'user', content: cuesUserMessage(ctx) }];
  const urls = new Set();
  let msg;
  for (let i = 0; i < 4; i++) {
    msg = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: 'medium' },
      system: CUES_SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }, CUES_TOOL],
      tool_choice: { type: 'auto' },
      messages,
    });
    for (const b of msg.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.type === 'web_search_result') urls.add(r.url);
      }
    }
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content }); // let the server continue the paused turn
  }
  refusalCheck(msg);
  const call = msg.content.find((b) => b.type === 'tool_use' && b.name === CUES_TOOL.name);
  const raw = call?.input?.cues || [];
  return { cues: validateCues(raw, urls), dropped: raw.length - validateCues(raw, urls).length };
}

/** Stream a chapter in her voice with [[answer-id]] citations per paragraph. */
export async function writeChapter(ctx, onDelta) {
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...FALLBACK,
    output_config: { effort: 'high' },
    system: CHAPTER_SYSTEM,
    messages: [{ role: 'user', content: chapterUserMessage(ctx) }],
  });
  let text = '';
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      text += ev.delta.text;
      onDelta?.(text);
    }
  }
  const msg = await stream.finalMessage();
  refusalCheck(msg);
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}
