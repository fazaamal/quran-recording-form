const MIN_INK_PIXELS = 350
const MIN_BBOX_WIDTH = 100
const MIN_BBOX_HEIGHT = 20
const INK_ALPHA_THRESHOLD = 30

const TOO_SMALL_MESSAGE =
  "Please sign using your full name — your signature looks too small."

export type SignatureValidation = {
  valid: boolean
  message?: string
  inkPixels: number
  bboxWidth: number
  bboxHeight: number
}

export function analyzeSignatureCanvas(
  canvas: HTMLCanvasElement
): SignatureValidation {
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return {
      valid: false,
      message: TOO_SMALL_MESSAGE,
      inkPixels: 0,
      bboxWidth: 0,
      bboxHeight: 0,
    }
  }

  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let inkPixels = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const alpha = data[i + 3]!
      if (alpha > INK_ALPHA_THRESHOLD) {
        inkPixels++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  const bboxWidth = inkPixels > 0 ? maxX - minX + 1 : 0
  const bboxHeight = inkPixels > 0 ? maxY - minY + 1 : 0

  const valid =
    inkPixels >= MIN_INK_PIXELS &&
    bboxWidth >= MIN_BBOX_WIDTH &&
    bboxHeight >= MIN_BBOX_HEIGHT

  return {
    valid,
    message: valid ? undefined : TOO_SMALL_MESSAGE,
    inkPixels,
    bboxWidth,
    bboxHeight,
  }
}
