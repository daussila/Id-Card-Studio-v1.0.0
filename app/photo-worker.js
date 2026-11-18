/**
 * Shrinks photos in the background, so the app stays responsive while hundreds of large
 * photos (for example straight from a camera) are prepared for the cards.
 * Message in: {id, bytes, mime, maxSide, quality}. Message out: {id, dataUrl} or {id, error}.
 */
'use strict';
self.onmessage = async event => {
  const {id, bytes, mime, maxSide, quality, keepSmall} = event.data;
  try {
    const blob = new Blob([bytes], {type: mime});
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && bytes.byteLength < keepSmall) {
      bitmap.close();
      self.postMessage({id, dataUrl: new FileReaderSync().readAsDataURL(blob)});
      return;
    }
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({type: 'image/jpeg', quality});
    self.postMessage({id, dataUrl: new FileReaderSync().readAsDataURL(jpeg)});
  } catch (error) {
    self.postMessage({id, error: String(error && error.message || error)});
  }
};
