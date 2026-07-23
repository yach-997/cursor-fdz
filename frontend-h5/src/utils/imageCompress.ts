/** 客户端压缩图片，减小上传体积；兼容不支持 createImageBitmap 的手机浏览器。 */
export async function compressImage(file: File, maxEdge = 1280, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const source = await loadImageSource(file);
  const { width, height } = source;
  const aspect = height / Math.max(width, 1);
  // 阳光云等超长截图：按宽度压，高度可更高，避免内容被压糊
  const scale =
    aspect > 2.2
      ? Math.min(1, Math.max(maxEdge, 1440) / width, 4096 / height)
      : Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    source.close();
    return file;
  }
  ctx.drawImage(source.image, 0, 0, w, h);
  source.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) return file;

  const name = file.name.replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

async function loadImageSource(file: File): Promise<{
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // 部分 iOS/HEIC 图片无法走 ImageBitmap，继续使用 img 解码。
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = document.createElement('img');
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读取失败，请重新拍照或选择 JPG 图片'));
      img.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
