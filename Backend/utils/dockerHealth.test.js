import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_LOG_RESPONSE_LENGTH,
    MAX_PROBLEM_TEXT_LENGTH,
    demuxDockerLogs,
    describeContainer,
    describeContainerProblem,
    dockerConfigProblem,
    dockerUnavailable,
    normalizeDockerLogs,
    parseLogsQuery,
    summarizeContainers
} from './dockerHealth.js'

function makeInspect({
    status = 'running',
    health = null,
    healthLog = null,
    exitCode = 0,
    oomKilled = false,
    error = '',
    startedAt = '2026-10-20T10:00:00.000000000Z',
    finishedAt = '0001-01-01T00:00:00Z',
    restartCount = 0
} = {}) {
    const inspect = {
        RestartCount: restartCount,
        State: {
            Status: status,
            StartedAt: startedAt,
            FinishedAt: finishedAt,
            ExitCode: exitCode,
            OOMKilled: oomKilled,
            Error: error
        }
    }

    if (health) {
        inspect.State.Health = {
            Status: health,
            Log: healthLog === null ? [] : [{ Start: startedAt, End: startedAt, ExitCode: 0, Output: healthLog }]
        }
    }

    return inspect
}

const info = (state = 'running', status = 'Up 2 hours') => ({ State: state, Status: status })

test('describeContainerProblem: running + healthy — проблем нет', () => {
    const result = describeContainerProblem(makeInspect({ health: 'healthy' }), info())
    assert.equal(result.problem, null)
    assert.equal(result.problemLevel, 'ok')
})

test('describeContainerProblem: running без healthcheck — проблем нет', () => {
    const inspect = makeInspect({})
    const result = describeContainerProblem(inspect, info())
    assert.equal(describeContainer(inspect, info()).healthStatus, 'none')
    assert.equal(result.problem, null)
    assert.equal(result.problemLevel, 'ok')
})

test('describeContainerProblem: unhealthy — причина с последним выводом healthcheck', () => {
    const inspect = makeInspect({ health: 'unhealthy', healthLog: 'curl: (7) Failed to connect to localhost:3000\n' })
    const result = describeContainerProblem(inspect, info())
    assert.equal(result.problemLevel, 'error')
    assert.match(result.problem, /^Healthcheck не проходит: curl: \(7\) Failed to connect to localhost:3000$/)
})

test('describeContainerProblem: длинный вывод healthcheck обрезается', () => {
    const longLog = 'x'.repeat(1000)
    const result = describeContainerProblem(
        makeInspect({ health: 'unhealthy', healthLog: longLog }),
        info()
    )
    assert.ok(result.problem.length <= MAX_PROBLEM_TEXT_LENGTH + 'Healthcheck не проходит: '.length)
    assert.ok(result.problem.endsWith('…'))
    assert.ok(!result.problem.includes(longLog))
})

test('describeContainerProblem: exited(1) — ошибка с кодом выхода', () => {
    const inspect = makeInspect({ status: 'exited', exitCode: 1, finishedAt: '2026-10-20T11:00:00Z' })
    const result = describeContainerProblem(inspect, info('exited', 'Exited (1) 5 minutes ago'))
    assert.equal(result.problemLevel, 'error')
    assert.equal(result.problem, 'Остановлен: код выхода 1')
})

test('describeContainerProblem: exited(0) — предупреждение без ошибки', () => {
    const inspect = makeInspect({ status: 'exited', exitCode: 0 })
    const result = describeContainerProblem(inspect, info('exited', 'Exited (0) 1 day ago'))
    assert.equal(result.problemLevel, 'warn')
    assert.equal(result.problem, 'Остановлен: код выхода 0')
})

test('describeContainer: exited(137) + OOMKilled — приоритетная причина OOM', () => {
    const inspect = makeInspect({ status: 'exited', exitCode: 137, oomKilled: true, error: 'killed' })
    const container = describeContainer(inspect, info('exited', 'Exited (137) 2 minutes ago'))
    assert.equal(container.exitCode, 137)
    assert.equal(container.oomKilled, true)
    assert.equal(container.problem, 'Убит из-за нехватки памяти (OOM)')
    assert.equal(container.problemLevel, 'error')
})

test('describeContainerProblem: restarting — предупреждение со счётчиком перезапусков', () => {
    const inspect = makeInspect({ status: 'restarting', restartCount: 4 })
    const result = describeContainerProblem(inspect, info('restarting', 'Restarting (1) 3 seconds ago'))
    assert.equal(result.problemLevel, 'warn')
    assert.equal(result.problem, 'Перезапускается (4 перезапусков)')
})

test('describeContainerProblem: paused — предупреждение', () => {
    const result = describeContainerProblem(makeInspect({ status: 'paused' }), info('paused', 'Up 1 hour (Paused)'))
    assert.equal(result.problemLevel, 'warn')
    assert.equal(result.problem, 'Приостановлен')
})

test('describeContainerProblem: dead — ошибка', () => {
    const result = describeContainerProblem(makeInspect({ status: 'dead' }), info('dead', 'Dead'))
    assert.equal(result.problemLevel, 'error')
    assert.equal(result.problem, 'Контейнер в состоянии dead')
})

test('describeContainer: inspect пустой — поля по умолчанию без падения', () => {
    const container = describeContainer(null, info('running', 'Up 1 minute'))
    assert.deepEqual(container, {
        healthStatus: 'none',
        restartCount: 0,
        startedAt: null,
        uptimeSeconds: null,
        exitCode: null,
        oomKilled: false,
        error: null,
        problem: null,
        problemLevel: 'ok'
    })
})

test('describeContainer: uptimeSeconds считается от StartedAt для running', () => {
    const now = Date.parse('2026-10-22T12:00:00.000Z')
    const inspect = makeInspect({ startedAt: '2026-10-22T10:00:00.000Z' })
    const container = describeContainer(inspect, info(), { now })
    assert.equal(container.startedAt, '2026-10-22T10:00:00.000Z')
    assert.equal(container.uptimeSeconds, 7200)
})

test('describeContainer: нулевой StartedAt не превращается в 1970 год', () => {
    const inspect = makeInspect({ startedAt: '0001-01-01T00:00:00Z' })
    const container = describeContainer(inspect, info('exited', 'Exited (0) 1 hour ago'))
    assert.equal(container.startedAt, null)
    assert.equal(container.uptimeSeconds, null)
})

test('summarizeContainers: считает total/running/stopped/restarting/healthy/problems', () => {
    const containers = [
        { state: 'running', healthStatus: 'healthy', problemLevel: 'ok', problem: null },
        { state: 'running', healthStatus: 'unhealthy', problemLevel: 'error', problem: 'Healthcheck не проходит' },
        { state: 'exited', healthStatus: 'none', problemLevel: 'warn', problem: 'Остановлен: код выхода 0' },
        { state: 'restarting', healthStatus: 'none', problemLevel: 'warn', problem: 'Перезапускается (2 перезапусков)' },
        { state: 'paused', healthStatus: 'none', problemLevel: 'warn', problem: 'Приостановлен' }
    ]
    const summary = summarizeContainers(containers)
    assert.deepEqual(summary, {
        available: true,
        ok: false,
        total: 5,
        running: 2,
        stopped: 1,
        unhealthy: 1,
        restarting: 1,
        healthy: 1,
        problems: 4
    })
})

test('summarizeContainers: пустой список — ok', () => {
    const summary = summarizeContainers([])
    assert.equal(summary.total, 0)
    assert.equal(summary.ok, true)
    assert.equal(summary.available, true)
})

test('dockerConfigProblem: disabled важнее отсутствия DOCKER_HOST', () => {
    assert.equal(dockerConfigProblem({ dockerHost: 'tcp://proxy:2375', statsEnabled: 'false' }), 'disabled')
    assert.equal(dockerConfigProblem({ dockerHost: '', statsEnabled: 'true' }), 'not_configured')
    assert.equal(dockerConfigProblem({ dockerHost: 'tcp://proxy:2375', statsEnabled: 'true' }), null)
})

test('dockerUnavailable: структурный ответ с причиной и сообщением', () => {
    assert.deepEqual(dockerUnavailable('disabled'), {
        available: false,
        reason: 'disabled',
        message: 'Docker stats выключены: DOCKER_STATS_ENABLED=false (обычно так в Kubernetes)'
    })
    assert.equal(dockerUnavailable('not_configured').reason, 'not_configured')
    assert.equal(dockerUnavailable('unknown-reason').reason, 'unreachable')
    assert.equal(dockerUnavailable('unreachable', 'кастомное сообщение').message, 'кастомное сообщение')
})

test('parseLogsQuery: валидные id и tail', () => {
    assert.deepEqual(parseLogsQuery({ id: 'a'.repeat(64) }), { ok: true, id: 'a'.repeat(64), tail: 100 })
    assert.deepEqual(
        parseLogsQuery({ id: 'ABCDEF012345', tail: '200' }),
        { ok: true, id: 'abcdef012345', tail: 200 }
    )
})

test('parseLogsQuery: отклоняет неверный id и tail', () => {
    assert.equal(parseLogsQuery({ id: 'ctp_backend' }).ok, false)
    assert.equal(parseLogsQuery({ id: 'a'.repeat(11) }).ok, false)
    assert.equal(parseLogsQuery({ id: 'a'.repeat(65) }).ok, false)
    assert.equal(parseLogsQuery({ id: 'a'.repeat(64), tail: '0' }).ok, false)
    assert.equal(parseLogsQuery({ id: 'a'.repeat(64), tail: '201' }).ok, false)
    assert.equal(parseLogsQuery({ id: 'a'.repeat(64), tail: 'abc' }).ok, false)
})

function dockerFrame(streamType, text) {
    const payload = Buffer.from(text, 'utf8')
    const header = Buffer.alloc(8)
    header[0] = streamType
    header.writeUInt32BE(payload.length, 4)
    return Buffer.concat([header, payload])
}

test('demuxDockerLogs: разделяет stdout и stderr по кадрам', () => {
    const raw = Buffer.concat([
        dockerFrame(1, 'server started\n'),
        dockerFrame(2, 'warning: cache cold\n')
    ])
    assert.equal(demuxDockerLogs(raw), 'server started\nwarning: cache cold\n')
})

test('demuxDockerLogs: сырой (TTY) поток возвращает как есть', () => {
    const raw = Buffer.from('plain log line\nsecond line\n')
    assert.equal(demuxDockerLogs(raw), raw.toString('utf8'))
})

test('normalizeDockerLogs: убирает ANSI-escape и обрезает до лимита', () => {
    assert.equal(normalizeDockerLogs('\u001b[31merror\u001b[0m ok'), 'error ok')
    const long = 'a'.repeat(MAX_LOG_RESPONSE_LENGTH + 500)
    const result = normalizeDockerLogs(long)
    assert.ok(result.startsWith('…'))
    assert.equal(result.length, MAX_LOG_RESPONSE_LENGTH + 1)
    assert.equal(result.slice(1), 'a'.repeat(MAX_LOG_RESPONSE_LENGTH))
})

test('normalizeDockerLogs: пустой поток — пустая строка', () => {
    assert.equal(normalizeDockerLogs(Buffer.alloc(0)), '')
    assert.equal(normalizeDockerLogs(''), '')
})
