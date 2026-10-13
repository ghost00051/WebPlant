const MAX_NAME_LENGTH = 40

export function getFirstName(name) {
    if (typeof name !== 'string') return ''

    const first = name.trim().split(/\s+/).find(Boolean) || ''
    const cleaned = first.replace(/[<>]/g, '').trim()
    if (!cleaned) return ''

    return cleaned.length > MAX_NAME_LENGTH ? cleaned.slice(0, MAX_NAME_LENGTH) : cleaned
}
