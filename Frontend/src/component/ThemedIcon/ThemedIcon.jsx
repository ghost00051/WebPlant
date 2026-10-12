import { useContext, useMemo } from 'react'
import ThemeContext from '../../context/themeContext.js'
import { ICON_SOURCES } from '../../utils/iconSources.js'
import { buildThemedIconSrc } from '../../utils/iconTheme.js'

function ThemedIcon({ src, alt = '', ...rest }) {
  const theme = useContext(ThemeContext)?.theme ?? 'light'
  const raw = ICON_SOURCES.get(src)
  const resolvedSrc = useMemo(
    () => (raw ? buildThemedIconSrc(raw, theme) : src),
    [raw, src, theme]
  )

  return <img src={resolvedSrc} alt={alt} {...rest} />
}

export default ThemedIcon
