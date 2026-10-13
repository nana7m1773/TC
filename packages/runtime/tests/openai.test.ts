import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestOpenAI,validateConfig} from '../openai.mjs';

const config={id:'one',baseUrl:'https://example.invalid/v1',modelId:'user-specified-model',contextSize:12800,maxTokens:512,temperature:0.7,timeoutMs:1000,stream:false,
  capabilities:{text:true,image:false,audio:false},headers:{'X-Project':'chosen-by-user'},extra:{top_p:0.9}};
const message=[{role:'user',content:'hello'}];

test('external chat data requires permission, even with a valid key',async()=>{
  let called=false;
  await assert.rejects(requestOpenAI({config,messages:message},{apiKey:'secret',fetchImpl:async()=>{called=true;return new Response();}}),{code:'CONSENT'});
  assert.equal(called,false);
});
test('URL, header and extra-parameter validation prevent credential or protocol overrides',()=>{
  assert.throws(()=>validateConfig({...config,baseUrl:'https://key@example.invalid'}),{code:'URL'});
  assert.throws(()=>validateConfig({...config,headers:{Host:'wrong'}}),{code:'HEADERS'});
  assert.throws(()=>validateConfig({...config,headers:{'X-Test':'value\r\nInjected:yes'}}),{code:'HEADERS'});
  assert.throws(()=>validateConfig({...config,extra:{messages:[]}}),{code:'PARAMS'});
});
test('user chosen base URL, model, custom headers and extra params are actually sent',async()=>{
  const result=await requestOpenAI({config,messages:message,allowExternalData:true},{apiKey:'test-key',fetchImpl:async(url,init)=>{
    assert.equal(url,'https://example.invalid/v1/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer test-key');
    assert.equal(init.headers['X-Project'],'chosen-by-user');
    const body=JSON.parse(init.body);assert.equal(body.model,'user-specified-model');assert.equal(body.top_p,0.9);
    assert.equal(init.redirect,'error');
    return Response.json({choices:[{message:{content:'hello back'}}],usage:{prompt_tokens:7,completion_tokens:2}});
  }});
  assert.deepEqual(result,{text:'hello back',inputTokens:7,outputTokens:2});
});
test('unsupported images never leave the device',async()=>{
  let called=false;
  await assert.rejects(requestOpenAI({config,allowExternalData:true,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}]},
    {fetchImpl:async()=>{called=true;return new Response();}}),{code:'CAPABILITY'});
  assert.equal(called,false);
});
test('models lists are bounded, filtered, and do not need permission to send chat',async()=>{
  const result=await requestOpenAI({config:{...config,modelId:''},operation:'models'},{fetchImpl:async()=>Response.json({data:[{id:'model-a',secret:'not-returned'},{bad:true}]})});
  assert.deepEqual(result,{models:[{id:'model-a'}]});
});
test('authentication errors do not echo body containing credentials or chat',async()=>{
  await assert.rejects(requestOpenAI({config,allowExternalData:true,messages:message},{apiKey:'sensitive-key',fetchImpl:async()=>new Response('sensitive-key hello',{status:401})}),error=>
    error.code==='HTTP_401'&&!error.message.includes('sensitive-key')&&!error.message.includes('hello'));
});
test('streaming parser handles byte-split SSE and usage',async()=>{
  const payload='data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\ndata: [DONE]\n\n';
  const bytes=new TextEncoder().encode(payload);
  const stream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}});
  const deltas:string[]=[];
  const result=await requestOpenAI({config:{...config,stream:true},messages:message,allowExternalData:true},{fetchImpl:async()=>new Response(stream),onDelta:(delta:string)=>deltas.push(delta)});
  assert.equal(result.text,'你好');assert.deepEqual(deltas,['你','好']);assert.equal(result.inputTokens,4);
});
test('audio requires explicit supported capability before upload',async()=>{
  let called=false;
  await assert.rejects(requestOpenAI({config,operation:'transcribe',allowExternalData:true,audio:{base64:'AA==',mime:'audio/wav'}},
    {fetchImpl:async()=>{called=true;return new Response();}}),{code:'CAPABILITY'});
  assert.equal(called,false);
});
