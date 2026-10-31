import test from 'node:test'
import assert from 'node:assert/strict'
import {
    describePod,
    describePods,
    isPodResourceId,
    podNameFromResourceId,
    podResourceId
} from './k8sHealth.js'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')

function makePod({
    name = 'backend-abc123-xyz',
    phase = 'Running',
    owner = { kind: 'ReplicaSet', name: 'backend-abc123' },
    nodeName = 'desktop-worker2',
    startTime = '2026-10-22T11:00:00Z',
    containers = [{ name: 'backend', ready: true, restartCount: 0 }],
    conditions = [
        { type: 'PodScheduled', status: 'True' },
        { type: 'Ready', status: 'True' }
    ]
} = {}) {
    return {
        metadata: {
            name,
            ownerReferences: owner ? [owner] : []
        },
        spec: {
            nodeName,
            containers: containers.map(container => ({ name: container.name, image: 'webplant-backend:1.2.6' }))
        },
        status: {
            phase,
            startTime,
            conditions,
            containerStatuses: containers.map(container => ({
                name: container.name,
                ready: Boolean(container.ready),
                restartCount: container.restartCount ?? 0,
                state: container.state ?? (container.ready ? { running: {} } : { waiting: { reason: 'ContainerCreating' } })
            }))
        }
    }
}

test('podResourceId: id пода распознаётся и разбирается', () => {
    const id = podResourceId('backend-abc123-xyz')
    assert.equal(id, 'pod:backend-abc123-xyz')
    assert.equal(isPodResourceId(id), true)
    assert.equal(podNameFromResourceId(id), 'backend-abc123-xyz')
    assert.equal(isPodResourceId('07d7e320df96'), false)
    assert.equal(podNameFromResourceId('pod:'), '')
    assert.equal(podNameFromResourceId('pod:плохое имя'), '')
})

test('describePod: под Ready — без проблем, uptime и владелец', () => {
    const pod = describePod(makePod(), { now: NOW })
    assert.equal(pod.state, 'running')
    assert.equal(pod.healthStatus, 'healthy')
    assert.equal(pod.problem, null)
    assert.equal(pod.problemLevel, 'ok')
    assert.equal(pod.service, 'deployment/backend')
    assert.equal(pod.node, 'desktop-worker2')
    assert.equal(pod.uptimeSeconds, 3600)
    assert.equal(pod.status, 'Running 1/1')
    assert.equal(pod.restartCount, 0)
})

test('describePod: ErrImageNeverPull — понятная причина про доставку образа', () => {
    const pod = describePod(makePod({
        phase: 'Pending',
        conditions: [{ type: 'PodScheduled', status: 'True' }],
        containers: [{
            name: 'backend',
            ready: false,
            state: { waiting: { reason: 'ErrImageNeverPull', message: 'Container image is not present with pull policy of Never' } }
        }]
    }), { now: NOW })

    assert.equal(pod.state, 'pending')
    assert.equal(pod.problemLevel, 'error')
    assert.match(pod.problem, /ErrImageNeverPull/)
    assert.match(pod.problem, /pull policy of Never/)
})

test('describePod: CrashLoopBackOff — ошибка с перезапусками', () => {
    const pod = describePod(makePod({
        phase: 'Running',
        conditions: [{ type: 'PodScheduled', status: 'True' }],
        containers: [{
            name: 'backend',
            ready: false,
            restartCount: 7,
            state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container' } }
        }]
    }), { now: NOW })

    assert.equal(pod.problemLevel, 'error')
    assert.match(pod.problem, /CrashLoopBackOff/)
    assert.equal(pod.restartCount, 7)
    assert.equal(pod.healthStatus, 'unhealthy')
})

test('describePod: Pending без планирования — ошибка с сообщением планировщика', () => {
    const pod = describePod(makePod({
        phase: 'Pending',
        startTime: null,
        conditions: [{
            type: 'PodScheduled',
            status: 'False',
            reason: 'Unschedulable',
            message: '0/6 nodes are available: insufficient cpu'
        }],
        containers: [{ name: 'backend', ready: false, state: { waiting: {} } }]
    }), { now: NOW })

    assert.equal(pod.problemLevel, 'error')
    assert.match(pod.problem, /Не запланирован/)
    assert.match(pod.problem, /insufficient cpu/)
})

test('describePod: Pending без причин — предупреждение, а не ошибка', () => {
    const pod = describePod(makePod({
        phase: 'Pending',
        startTime: null,
        conditions: [{ type: 'PodScheduled', status: 'True' }],
        containers: [{ name: 'backend', ready: false, state: { waiting: { reason: 'ContainerCreating' } } }]
    }), { now: NOW })

    assert.equal(pod.problemLevel, 'warn')
    assert.equal(pod.state, 'pending')
})

test('describePod: завершённый Job — completed без проблем', () => {
    const pod = describePod(makePod({
        name: 'db-backup-29877060-cc56l',
        phase: 'Succeeded',
        owner: { kind: 'Job', name: 'db-backup-29877060' },
        containers: [{
            name: 'backup',
            ready: false,
            state: { terminated: { exitCode: 0, reason: 'Completed' } }
        }],
        conditions: [{ type: 'PodScheduled', status: 'True' }]
    }), { now: NOW })

    assert.equal(pod.state, 'completed')
    assert.equal(pod.problem, null)
    assert.equal(pod.problemLevel, 'ok')
    assert.equal(pod.exitCode, 0)
    assert.equal(pod.service, 'job/db-backup-29877060')
})

test('describePod: упавший под — код выхода в причине', () => {
    const pod = describePod(makePod({
        phase: 'Failed',
        containers: [{
            name: 'backend',
            ready: false,
            state: { terminated: { exitCode: 1, reason: 'Error' } }
        }],
        conditions: [{ type: 'PodScheduled', status: 'True' }]
    }), { now: NOW })

    assert.equal(pod.state, 'exited')
    assert.equal(pod.exitCode, 1)
    assert.equal(pod.problemLevel, 'error')
    assert.match(pod.problem, /код 1/)
})

test('describePods: пустой список и несколько подов', () => {
    assert.deepEqual(describePods([]), [])
    const pods = describePods([makePod(), makePod({ name: 'redis-1', owner: { kind: 'ReplicaSet', name: 'redis-b6cfb4764' } })], { now: NOW })
    assert.equal(pods.length, 2)
    assert.equal(pods[0].id, 'pod:backend-abc123-xyz')
})
