/** Check image dimensions from bounded headers before any native decoder allocates pixels. */
export function validateLocalImage(image) {
  const data=image?.data;
  if(typeof data!=='string'||data.length>7_000_000)throw Object.assign(new Error('请选择一张小于 5 MB 的图片。'),{code:'IMAGE'});
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(data);
  if(!match)throw Object.assign(new Error('本地图片仅支持 PNG、JPEG 和 WebP。'),{code:'IMAGE'});
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>5*1024*1024||bytes.length<24)throw Object.assign(new Error('图片为空、损坏或超过 5 MB。'),{code:'IMAGE'});
  let width,height;
  if(match[1]==='png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR') {
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
  } else if(match[1]==='jpeg'&&bytes[0]===255&&bytes[1]===216) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset++]!==255)break;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>bytes.length)break;
      const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7) {
        height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;
      }
      offset+=length;
    }
  } else if(match[1]==='webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP') {
    const format=bytes.toString('ascii',12,16);
    if(format==='VP8X'&&bytes.length>=30) {width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
    else if(format==='VP8L'&&bytes.length>=25&&bytes[20]===0x2f) {const bits=bytes.readUInt32LE(21);width=1+(bits&0x3fff);height=1+((bits>>>14)&0x3fff);}
    else if(format==='VP8 '&&bytes.length>=30&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a) {width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
  }
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1280||height>1280||width*height>4_000_000)
    throw Object.assign(new Error('图片尺寸无效或超过上限。请缩小至最长边 1,280 像素；首版每次仅分析一张图片。'),{code:'IMAGE_DIMENSIONS'});
  return {data,width,height,sizeBytes:bytes.length,mime:`image/${match[1]}`};
}
