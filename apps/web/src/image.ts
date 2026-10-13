/** Read bounded encoded dimensions before decoding; never allocate an arbitrary large bitmap. */
export async function normalizeImage(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.slice(0, 524288).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0,
    height = 0;
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (
    bytes.length >= 10 &&
    String.fromCharCode(...bytes.slice(0, 3)) === "GIF"
  ) {
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    const format = String.fromCharCode(...bytes.slice(12, 16));
    if (format === "VP8X") {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (
      format === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 16383;
      height = view.getUint16(28, true) & 16383;
    } else if (format === "VP8L" && bytes[20] === 0x2f) {
      const value = view.getUint32(21, true);
      width = (value & 16383) + 1;
      height = ((value >>> 14) & 16383) + 1;
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) break;
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = view.getUint16(at);
      if (size < 2 || at + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = view.getUint16(at + 3);
        width = view.getUint16(at + 5);
        break;
      }
      at += size;
    }
  }
  if (!width || !height || width * height > 4_000_000)
    throw new Error(
      "图片需为 PNG、JPEG、WebP 或 GIF，原始像素不超过400万；请先缩小大图。",
    );
  const ratio = Math.min(1, 1280 / Math.max(width, height)),
    w = Math.max(1, Math.round(width * ratio)),
    h = Math.max(1, Math.round(height * ratio));
  const bitmap = await createImageBitmap(file, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: "high",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("本机无法准备图片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, w, h);
    context.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("图片准备失败。"))),
        "image/png",
      ),
    );
    if (blob.size > 5 * 1024 * 1024)
      throw new Error("缩小后的图片仍超过5MB，请继续压缩。");
    return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".png", {
      type: "image/png",
    });
  } finally {
    bitmap.close();
  }
}
