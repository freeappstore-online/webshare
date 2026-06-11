/**
 * Downscale a picked image to a small square JPEG data URL.
 *
 * It travels in every roster broadcast from the signaling worker (which caps
 * pfps at 16KB), so we walk down size/quality until it fits comfortably.
 * Returns null if the image can't be decoded or compressed small enough.
 */
const MAX_DATA_URL_CHARS = 12000

export async function fileToPfp(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    for (const size of [192, 128, 96]) {
      const canvas = drawSquare(img, size)
      for (const quality of [0.7, 0.5, 0.35]) {
        const data = canvas.toDataURL('image/jpeg', quality)
        if (data.length <= MAX_DATA_URL_CHARS) return data
      }
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawSquare(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // center-crop to square
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas
}
