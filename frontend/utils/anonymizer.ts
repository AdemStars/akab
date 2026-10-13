export interface RedactionBox {
  id: string;
  x: number; // in pixels relative to original image
  y: number;
  width: number;
  height: number;
}

/**
 * Loads an image File into an HTMLImageElement
 */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Creates an anonymized image Blob by drawing black boxes over designated areas
 */
export async function anonymizeImage(
  file: File,
  boxes: RedactionBox[]
): Promise<{ blob: Blob; previewUrl: string }> {
  const image = await loadImageFile(file);

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Impossible d’initialiser le contexte canvas 2D');
  }

  // Draw original image
  ctx.drawImage(image, 0, 0);

  // Apply opaque solid black rectangles
  ctx.fillStyle = '#000000';
  for (const box of boxes) {
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Échec de la génération de l’image anonymisée'));
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        resolve({ blob, previewUrl });
      },
      file.type === 'image/png' ? 'image/png' : 'image/jpeg',
      0.92
    );
  });
}

/**
 * Estimates simple centered blackout zones if citizen requests quick 1-click anonymization
 */
export function generateQuickAnonymizationBoxes(width: number, height: number): RedactionBox[] {
  // Common zones for faces/identifying signs in portrait or landscape
  return [
    {
      id: 'quick-1',
      x: Math.round(width * 0.35),
      y: Math.round(height * 0.2),
      width: Math.round(width * 0.3),
      height: Math.round(height * 0.25),
    },
  ];
}
