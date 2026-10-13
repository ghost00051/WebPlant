import { useMemo } from 'react'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import plantPlaceholder from '../../assets/PlantTile.svg'
import { plantThumbUrl } from '../../utils/photo.js'

/**
 * Фото растения для компактных превью: сначала миниатюра, затем оригинал,
 * затем заглушка. Миниатюры могут быть ещё не сгенерированы для старых
 * загрузок — тогда браузер просто возьмёт оригинал.
 */
function PlantPhoto({ src, alt = '', fallback = plantPlaceholder, ...rest }) {
  const { primary, backup } = useMemo(() => {
    const thumb = plantThumbUrl(src)
    return {
      primary: thumb ?? src ?? fallback,
      backup: thumb ? src : null,
    }
  }, [src, fallback])

  const handleError = event => {
    const image = event.currentTarget
    const step = image.dataset.photoStep ?? '0'

    if (step === '0' && backup) {
      image.dataset.photoStep = '1'
      image.src = backup
      return
    }

    if (step !== '2') {
      image.dataset.photoStep = '2'
      image.src = fallback
    }
  }

  return <ThemedIcon src={primary} alt={alt} onError={handleError} {...rest} />
}

export default PlantPhoto
