export interface PixelArea { x: number; y: number; width: number; height: number }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the image could not be loaded'));
    img.src = src;
  });
}

/** Draws the chosen part on a canvas and returns a JPEG, at most 900 px high — plenty for a CV photo, far below 5 MB. */
export async function cropToJpeg(src: string, area: PixelArea): Promise<Blob> {
  const img = await loadImage(src);
  const scale = Math.min(1, 900 / area.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is not available');
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the photo could not be prepared'))), 'image/jpeg', 0.9);
  });
}
