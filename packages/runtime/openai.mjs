/** OpenAI-compatible protocol only. Provider identity and credentials come from user configuration. */
export class AdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'AdapterError'; this.code = code; }
}

const reserved = new Set(['model', 'messages', 'stream', 'max_tokens', 'temperature', 'tools', 'tool_choice']);
export function validateConfig(config,{requireModel=true}={}) {
  if (!config || typeof config !== 'object') throw new AdapterError('CONFIG', '请先保存 API 配置。');
  let url;
  try { url = new URL(config.baseUrl); } catch { throw new AdapterError('URL', 'Base URL 必须是完整的 http:// 或 https:// 地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new AdapterError('URL', 'Base URL 不允许内嵌凭据、查询参数或其他协议。');
  if (typeof config.modelId !== 'string' || (requireModel&&!config.modelId.trim()) || config.modelId.length > 200)
    throw new AdapterError('MODEL', '请输入服务实际支持的模型 ID。');
  const contextSize = Number(config.contextSize ?? 12800);
  const maxTokens = Number(config.maxTokens ?? 512);
  if (!Number.isInteger(contextSize) || contextSize < 512 || contextSize > 2_000_000 ||
      !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens >= contextSize)
    throw new AdapterError('BUDGET', '上下文长度必须大于最大输出长度。');
  const temperature = Number(config.temperature ?? 0.7);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    throw new AdapterError('TEMPERATURE', '温度需要在 0–2 之间。');
  const timeoutMs = Number(config.timeoutMs ?? 60000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
    throw new AdapterError('TIMEOUT', '超时需要在 1–300 秒之间。');
  const headers = {};
  for (const [key, value] of Object.entries(config.headers ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || /[\r\n]/.test(String(value)) ||
        /^(host|content-length|cookie|origin|connection|transfer-encoding|proxy-authorization)$/i.test(key))
      throw new AdapterError('HEADERS', '自定义请求头含有无效或不允许的字段。');
    if (String(value).length > 4096) throw new AdapterError('HEADERS', '自定义请求头过长。');
    headers[key] = String(value);
  }
  const extra = config.extra ?? {};
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new AdapterError('PARAMS', '额外参数必须是 JSON 对象。');
  for (const key of Object.keys(extra)) if (reserved.has(key))
    throw new AdapterError('PARAMS', `额外参数不能覆盖 ${key}。请使用对应设置。`);
  return { ...config, baseUrl: url.href.replace(/\/$/, ''), contextSize, maxTokens, temperature, timeoutMs, headers, extra };
}

function errorFromStatus(status) {
  const known = {401:'鉴权失败，请检查安全存储中的 API Key 或鉴权请求头。',403:'服务拒绝访问，请检查权限和模型授权。',404:'接口或模型不存在，请检查 Base URL 和模型 ID。',413:'输入超过服务允许的体积。',429:'服务限流或额度不足，请稍后再试。',503:'服务暂时不可用或模型尚未加载。'};
  return new AdapterError(`HTTP_${status}`, known[status] ?? `服务返回 HTTP ${status}。请检查服务运行记录。`);
}

function verifyMessages(messages, config) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 1000) throw new AdapterError('INPUT', '消息列表为空或过长。');
  for (const message of messages) {
    if (!message || !['system','user','assistant'].includes(message.role)) throw new AdapterError('INPUT', '消息角色无效。');
    if (typeof message.content === 'string') continue;
    if (!Array.isArray(message.content)) throw new AdapterError('INPUT', '消息内容无效。');
    for (const part of message.content) {
      if (part.type === 'text' && typeof part.text === 'string') continue;
      if (part.type === 'image_url' && config.capabilities?.image) {
        const data = part.image_url?.url;
        if (typeof data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(data) || data.length > 7_000_000)
          throw new AdapterError('IMAGE', '图片必须是压缩后的 PNG、JPEG 或 WebP，且小于 5 MB。');
        continue;
      }
      throw new AdapterError('CAPABILITY', '当前 API 配置没有启用此输入能力。');
    }
  }
  if (!config.capabilities?.text) throw new AdapterError('CAPABILITY', '当前 API 配置尚未确认文字生成能力。');
  if (JSON.stringify(messages).length > 12_000_000) throw new AdapterError('INPUT', '输入体积过大。');
}

async function readStream(response, onDelta) {
  if (!response.body) throw new AdapterError('STREAM', '服务没有返回流式内容。');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = '', text = '', usage;
  function handle(block) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') return;
    let payload; try { payload = JSON.parse(data); } catch { throw new AdapterError('STREAM', '服务流式响应不是有效 JSON。'); }
    if (payload.error) throw new AdapterError('SERVICE', '服务在流式生成过程中返回错误。');
    const delta = payload.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') { text += delta; onDelta?.(delta); }
    if (payload.usage) usage = payload.usage;
  }
  while (true) {
    const {done, value} = await reader.read();
    buffer += decoder.decode(value, {stream:!done}).replace(/\r\n/g, '\n');
    let pos; while ((pos = buffer.indexOf('\n\n')) >= 0) { handle(buffer.slice(0,pos)); buffer = buffer.slice(pos+2); }
    if (text.length > 2_000_000 || buffer.length > 2_000_000) { await reader.cancel(); throw new AdapterError('OUTPUT', '服务响应过长。'); }
    if (done) break;
  }
  if (buffer.trim()) handle(buffer);
  return {text, inputTokens:usage?.prompt_tokens, outputTokens:usage?.completion_tokens};
}

export async function requestOpenAI(input, {apiKey='', fetchImpl=fetch, onDelta}={}) {
  const operation = input.operation ?? 'infer';
  const config = validateConfig(input.config,{requireModel:operation!=='models'});
  if (!['models','test','infer','transcribe'].includes(operation)) throw new AdapterError('OPERATION','不支持的 API 操作。');
  if (['infer','transcribe'].includes(operation) && input.allowExternalData !== true)
    throw new AdapterError('CONSENT', '尚未允许向此 API 发送聊天数据。完全本地模式不会调用外部服务。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = {...config.headers};
  if (apiKey) { for (const key of Object.keys(headers)) if (key.toLowerCase() === 'authorization') delete headers[key]; headers.Authorization = `Bearer ${apiKey}`; }
  let route = '/chat/completions', method = 'POST', body;
  try {
    if (operation === 'models') { route = '/models'; method = 'GET'; }
    else if (operation === 'transcribe') {
      if (!config.capabilities?.audio) throw new AdapterError('CAPABILITY','此 API 未确认语音转写能力。');
      const audio = input.audio;
      if (!audio || typeof audio.base64 !== 'string' || audio.base64.length > 28_000_000 ||
          !['audio/wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/x-m4a'].includes(audio.mime))
        throw new AdapterError('AUDIO', '音频格式不支持或超过 20 MB。');
      const form = new FormData();
      const bytes = Uint8Array.from(Buffer.from(audio.base64,'base64'));
      form.set('file',new Blob([bytes],{type:audio.mime}),String(audio.name ?? 'audio.webm').replace(/[^\w.\-]/g,'_'));
      form.set('model',config.modelId); form.set('response_format','json');
      body = form; route = '/audio/transcriptions';
    } else {
      const messages = operation === 'test' ? [{role:'user',content:'请只回复“连接成功”。'}] : input.messages;
      verifyMessages(messages,config);
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({...config.extra,model:config.modelId,messages,max_tokens:operation==='test'?32:config.maxTokens,
        temperature:config.temperature,stream:operation==='test'?false:!!config.stream});
    }
    const response = await fetchImpl(config.baseUrl+route,{method,headers,body,signal:controller.signal,redirect:'error'});
    if (!response.ok) { await response.body?.cancel(); throw errorFromStatus(response.status); }
    if (operation === 'infer' && config.stream) return await readStream(response,onDelta);
    const raw = await response.text();
    if (raw.length > 5_000_000) throw new AdapterError('OUTPUT','API 响应过大。');
    let json; try { json = JSON.parse(raw); } catch { throw new AdapterError('PROTOCOL','API 返回内容不是有效 JSON，请检查协议和地址。'); }
    if (operation === 'models') {
      if (!Array.isArray(json.data)) throw new AdapterError('PROTOCOL','此服务没有返回兼容的模型列表；可以手动填写模型 ID。');
      return {models:json.data.filter(x=>typeof x?.id==='string').map(x=>({id:x.id})).slice(0,500)};
    }
    if (operation === 'transcribe') {
      if (typeof json.text !== 'string') throw new AdapterError('PROTOCOL','此服务没有返回转写文字。');
      return {text:json.text};
    }
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new AdapterError('PROTOCOL','此服务没有返回兼容的文字回复。');
    return {text,inputTokens:json.usage?.prompt_tokens,outputTokens:json.usage?.completion_tokens};
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    if (controller.signal.aborted) throw new AdapterError('TIMEOUT','API 请求超时，已取消。请检查网络、模型加载状态或延长超时。');
    throw new AdapterError('NETWORK','无法连接服务。请检查地址、TLS 证书、网络和服务状态；重定向不会传递凭据。');
  } finally { clearTimeout(timer); }
}
