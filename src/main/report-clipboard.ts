import { clipboard, ClipboardItem, nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

async function writeClipboardImage(image: Electron.NativeImage): Promise<void> {
  const png = image.toPNG()
  if (!png.length) throw new Error('报告图片无法读取，请重新生成')
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
}

export async function copyReportImages(files: string[], allowed: ReadonlySet<string>): Promise<void> {
  if (!Array.isArray(files) || !files.length || files.length > 100 || files.some(file => typeof file !== 'string' || !allowed.has(file) || extname(file).toLowerCase() !== '.png')) {
    throw new Error('报告图片不存在，请重新生成')
  }
  const images: Electron.NativeImage[] = []
  let width = 0, height = 0, pixels = 0
  for (const file of files) {
    let bytes: Buffer
    try { bytes = await readFile(file) } catch { throw new Error('报告图片不存在，请重新生成') }
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('报告图片无法读取，请重新生成')
    const size = image.getSize()
    width = Math.max(width, size.width)
    height += size.height
    pixels += size.width * size.height
    if (pixels > 64_000_000 || width * height > 64_000_000) throw new Error('报告图片过大，无法复制，请打开所在文件夹获取图片')
    images.push(image)
  }
  if (images.length === 1) { await writeClipboardImage(images[0]); return }

  // Preserve every page, in report order, in the clipboard's single image.
  const bitmap = Buffer.alloc(width * height * 4, 255)
  let top = 0
  for (const image of images) {
    const size = image.getSize(), bytes = image.toBitmap({ scaleFactor: 1 })
    if (bytes.length !== size.width * size.height * 4) throw new Error('报告图片尺寸异常，请重新生成')
    for (let row = 0; row < size.height; row++) bytes.copy(bitmap, ((top + row) * width) * 4, row * size.width * 4, (row + 1) * size.width * 4)
    top += size.height
  }
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 })
  if (image.isEmpty()) throw new Error('报告图片合并失败，请重试')
  await writeClipboardImage(image)
}
