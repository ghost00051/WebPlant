
export const DARK_ICON_TOKENS = {
  '--wp-plate-soft': '#1f1f24',
  '--wp-plate-surface': '#1f1f24',
  '--wp-plate-warm': '#1f1f24',
  '--wp-plate-green': '#1f1f24',
  '--wp-plate-green-alpha': '0.22',
  '--wp-plate-red-alpha': '0.2',
  '--wp-border-subtle': '#303238',
  '--wp-glyph-strong': 'rgb(244,245,244)',
  '--wp-glyph-mid': 'rgb(201,204,201)',
}

const TOKEN_PATTERN = /var\(\s*(--wp-[a-z0-9-]+)\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g

export function resolveIconMarkup(markup, theme) {
  if (typeof markup !== 'string') return markup

  return markup.replace(TOKEN_PATTERN, (match, token, fallback) => {
    const themed = theme === 'dark' ? DARK_ICON_TOKENS[token] : undefined
    return (themed ?? fallback).trim()
  })
}

export function toIconDataUri(markup) {
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

const srcCache = new Map()

export function buildThemedIconSrc(markup, theme) {
  if (typeof markup !== 'string') return markup

  const key = `${theme}\u0000${markup}`
  const cached = srcCache.get(key)
  if (cached) return cached

  const src = toIconDataUri(resolveIconMarkup(markup, theme))
  srcCache.set(key, src)
  return src
}
