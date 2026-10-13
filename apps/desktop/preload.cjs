const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name)=>async(input)=>{
  const result=await ipcRenderer.invoke(`assistant:${name}`,input??{});
  if(result?.__error){const error=new Error(result.message);error.code=result.code;throw error;}
  return result;
};
const methods=['loadState','saveState','saveApiKey','hasApiKey','deleteApiKey','request','models','testConnection','deviceInfo','modelStatus',
  'listModels','installDefault','importModel','loadModel','stop','deleteModel','infer','tokenize','setAutostart','getAutostart','clearCache',
  'exportProtected','importProtected','deleteHistory','installVision','analyzeImage','installSpeech','transcribeLocal','listSocialWindows','readSocialWindow','captureSocialWindow','prepareSocialReply','commitSocialReply'];
const bridge=Object.fromEntries(methods.map(name=>[name,invoke(name)]));
bridge.platform='desktop';
bridge.onPause=(callback)=>{
  if(typeof callback!=='function')throw new Error('暂停监听器必须是函数。');
  const listener=()=>callback();ipcRenderer.on('assistant:pause',listener);
  return ()=>ipcRenderer.removeListener('assistant:pause',listener);
};
contextBridge.exposeInMainWorld('assistant',Object.freeze(bridge));
