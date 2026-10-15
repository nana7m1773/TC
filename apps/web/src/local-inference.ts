import type {NativeBridge} from './runtime';
/** Preserve an explicitly loaded model; the default is selected only when no model is loaded. */
export async function prepareLocalInference(native:NativeBridge){
  let status=await native.modelStatus();
  if(status.engineAvailable===false)throw new Error('本地推理引擎不可用，请安装完整原生版本，或在 API 设置中选择可用服务。');
  if(status.loaded!==true&&status.state!=='ready'){
    const modelPath=typeof status.modelPath==='string'?status.modelPath:undefined;
    status=await native.loadModel({contextSize:Number.isSafeInteger(status.contextSize)&&Number(status.contextSize)>=512?Number(status.contextSize):12800,...(modelPath?{modelPath}:{})});
  }
  const contextSize=Number.isSafeInteger(status.contextSize)&&Number(status.contextSize)>=512?Math.min(12800,Number(status.contextSize)):12800;
  const modelPath=typeof status.modelPath==='string'?status.modelPath:undefined;
  return {contextSize,modelPath,status};
}
