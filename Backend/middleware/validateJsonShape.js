const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_DEPTH = 20

function findProblem(value, depth = 0) {
    if (depth > MAX_DEPTH) return 'depth'
    if (Array.isArray(value)) {
        for (const item of value) {
            const problem = findProblem(item, depth + 1)
            if (problem) return problem
        }
        return null
    }
    if (!value || typeof value !== 'object') return null

    for (const [key, nested] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) return 'forbidden_key'
        const problem = findProblem(nested, depth + 1)
        if (problem) return problem
    }
    return null
}

export function validateJsonShape(req, res, next) {
    if (!req.body || typeof req.body !== 'object') return next()

    const problem = findProblem(req.body)
    if (problem === 'forbidden_key') {
        return res.status(400).json({ message: 'Некорректные данные запроса' })
    }
    if (problem === 'depth') {
        return res.status(400).json({ message: 'Слишком глубокая вложенность данных' })
    }
    return next()
}

export { findProblem }
