export function integerParam(req, res, next, value) {
    if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
        return res.status(400).json({ message: 'Некорректный идентификатор' })
    }
    return next()
}

export function integerParamMiddleware(name, { required = true } = {}) {
    return (req, res, next) => {
        const value = req.params?.[name]
        if (value === undefined) {
            return required
                ? res.status(400).json({ message: 'Некорректный идентификатор' })
                : next()
        }
        return integerParam(req, res, next, value)
    }
}
