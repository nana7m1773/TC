import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateLocalAudio,DesktopSpeechManager} from '../desktop-speech.mjs';

const manifest={filename:'ggml-base.bin',maxAudioBytes:20*1024*1024,maxAudioSeconds:120,languages:['zh','en','auto']};
function wav(seconds:number,rate=16000,channels=1) {
  const bytes=Buffer.alloc(44+Math.ceil(seconds*rate*channels*2));
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*channels*2,28);
  bytes.writeUInt16LE(channels*2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  return {data:'data:audio/wav;base64,'+bytes.toString('base64')};
}
test('local audio verifies actual PCM format, sample rate and duration',()=>{
  assert.equal(validateLocalAudio(wav(1),manifest).durationSeconds,1);
  assert.throws(()=>validateLocalAudio(wav(1,44100,2),manifest),{code:'AUDIO_FORMAT'});
  assert.throws(()=>validateLocalAudio(wav(121),manifest),{code:'AUDIO_DURATION'});
  assert.throws(()=>validateLocalAudio({base64:'AAAA'},manifest),{code:'AUDIO_FORMAT'});
});
test('malformed/truncated WAV is refused before native inference',()=>{
  const valid=wav(1);const bytes=Buffer.from(valid.data.split(',')[1],'base64');bytes.writeUInt32LE(10000000,40);
  assert.throws(()=>validateLocalAudio({base64:bytes.toString('base64')},manifest),{code:'AUDIO_FORMAT'});
});
test('missing native speech engine cannot upload audio as fallback',async()=>{
  const manager=new DesktopSpeechManager({directory:'unused',enginePath:null,manifest,tools:{}});
  await assert.rejects(manager.transcribeLocal({audio:wav(1)}),{code:'ENGINE'});
  assert.equal(manager.process,null);assert.equal(manager.busy,false);
});
