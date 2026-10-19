function frontendIdempotencyKey({ title, body, url = '/', targetMode = 'all', selectedIds = [], includeGuests = false }) {
    const source = JSON.stringify({
        title,
        body,
        url: url.trim() || '/',
        targetMode,
        selectedIds: targetMode === 'users' ? selectedIds : [],
        includeGuests: targetMode === 'all' ? includeGuests : false
    })
    let hash = 2166136261
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `push-${(hash >>> 0).toString(16)}-${source.length}`
}

const base = {
    title: 'Плановые работы',
    body: 'Сегодня с 22:00 до 23:00 сервис будет недоступен.',
    url: '/home',
    targetMode: 'all',
    includeGuests: false
}

const immediate = frontendIdempotencyKey(base)
const scheduledTomorrow = frontendIdempotencyKey(base)
const secondAdmin = frontendIdempotencyKey(base)
const differentUsers = frontendIdempotencyKey({ ...base, targetMode: 'users', selectedIds: [1, 2] })

console.log('immediate          :', immediate)
console.log('scheduled tomorrow :', scheduledTomorrow)
console.log('second admin       :', secondAdmin)
console.log('different users    :', differentUsers)
console.log('')
console.log('immediate === scheduled tomorrow :', immediate === scheduledTomorrow)
console.log('immediate === second admin       :', immediate === secondAdmin)
