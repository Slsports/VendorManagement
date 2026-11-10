// Phone photos for VMS's packets (Dana, Nov 10, 2026: "She could scan the cover of each empty book … on her phone"). The
// picture is turned the right way up and saved as a JPEG of a sensible size before it is uploaded, so the packet builder
// can put it on a page and a 12 MB photo does not go up as is. A PDF or a file that is not a picture is left alone.

const MAX_SIDE = 1800

export async function photoForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${file.name} is a picture format this browser cannot read (an iPhone HEIC photo on a computer, for instance). Take the picture from the phone itself, or set the phone's camera to Most Compatible, and try again.`)
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (!blob) return file
    const name = file.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}
