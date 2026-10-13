import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DesktopModelManager} from '../desktop-models.mjs';
const createManager=(endpoint:string)=>{const m=new DesktopModelManager({directory:'/tmp/unused-test',enginePath:null,tools:{defaultModel:{sizeBytes:5627044224}}});m.endpoint=endpoint;m.key='synthetic-test-key';return m;};
async function server(handler:http.RequestListener){const s=http.createServer(handler);await new Promise<void>(resolve=>s.listen(0,'127.0.0.1',resolve));const address=s.address() as import('node:net').AddressInfo;return {s,url:`http://127.0.0.1:${address.port}`,close:async()=>{s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()));}};}
test('local transport uses the supplied total deadline while waiting for response headers',async()=>{
  const host=await server((req,res)=>{assert.equal(req.headers.authorization,'Bearer synthetic-test-key');setTimeout(()=>res.end('{"ready":true}'),80);});
  try{assert.deepEqual(await createManager(host.url).engineRequest('/health',null,1000),{ready:true});await assert.rejects(()=>createManager(host.url).engineRequest('/health',null,20),{code:'CANCELLED'});}finally{await host.close();}
});
test('an already cancelled native request cannot be sent',async()=>{
  let requests=0;const host=await server((_,res)=>{requests++;res.end('{}');});const c=new AbortController();c.abort();
  try{await assert.rejects(()=>createManager(host.url).engineRequest('/health',null,1000,c.signal),{code:'CANCELLED'});assert.equal(requests,0);}finally{await host.close();}
});
test('local engine redirects and unsafe endpoints cannot send keys outside the managed loopback server',async()=>{
  const host=await server((_,res)=>{res.writeHead(302,{Location:'https://example.com'});res.end('secret-response');});
  try{await assert.rejects(()=>createManager(host.url).engineRequest('/health',null),{code:'ENGINE_REQUEST'});await assert.rejects(()=>createManager('http://example.com').engineRequest('/health',null),{code:'ENDPOINT'});}finally{await host.close();}
});
test('oversized native JSON and malformed responses fail without returning their raw contents',async()=>{
  const host=await server((req,res)=>res.end(req.url==='/large'?'x'.repeat(9*1024*1024):'invalid-secret-json'));
  try{const m=createManager(host.url);await assert.rejects(()=>m.engineRequest('/large',null),{code:'OUTPUT'});await assert.rejects(()=>m.engineRequest('/bad',null),{code:'OUTPUT'});}finally{await host.close();}
});
