const PLANT_PHOTO_PATH = /^(.*)\/uploads\/plants\/([a-f0-9]{32})\.(?:jpe?g|png|webp|heic)$/i

export function plantThumbUrl(url) {
  if (typeof url !== 'string' || !url) return null

  const [clean] = url.split(/[?#]/, 1)
  const match = PLANT_PHOTO_PATH.exec(clean)
  if (!match) return null

  return `${match[1]}/uploads/thumbs/${match[2].toLowerCase()}.thumb.jpg`
}
