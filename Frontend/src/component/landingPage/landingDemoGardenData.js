export const DEMO_GARDEN_PLANTS = [
    {
        id: 'monstera',
        name: 'Монстера',
        glyph: '✳',
        note: 'Полить сегодня',
        dueToday: true,
        gender: 'f'
    },
    {
        id: 'ficus',
        name: 'Фикус',
        glyph: '❋',
        note: 'Полить сегодня',
        dueToday: true,
        gender: 'm',
        light: true
    },
    {
        id: 'sansevieria',
        name: 'Сансевиерия',
        glyph: '⌁',
        note: 'Полить через 2 дня',
        dueToday: false,
        gender: 'f'
    }
]

export const DEMO_GARDEN_NEXT_PLANT = 'Фикус'
export const DEMO_GARDEN_BASE_STREAK = 2

export function countDemoDueToday(wateredIds) {
    return DEMO_GARDEN_PLANTS.filter(
        plant => plant.dueToday && !wateredIds?.[plant.id]
    ).length
}

export function countDemoWatered(wateredIds) {
    return DEMO_GARDEN_PLANTS.filter(plant => wateredIds?.[plant.id]).length
}

export function getLastWateredPlant(wateredIds) {
    const watered = Object.keys(wateredIds ?? {}).filter(id => wateredIds[id])
    const lastId = watered[watered.length - 1]
    return DEMO_GARDEN_PLANTS.find(plant => plant.id === lastId) ?? null
}

export function pluralizeDays(count) {
    const value = Math.abs(Number(count)) || 0
    const mod100 = value % 100
    const mod10 = value % 10
    if (mod100 >= 11 && mod100 <= 14) return 'дней'
    if (mod10 === 1) return 'день'
    if (mod10 >= 2 && mod10 <= 4) return 'дня'
    return 'дней'
}
