import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEWER_SESSION,
  isViewerAuthenticated,
  normalizeViewerSessionState
} from './gardenExtraApi.js'

test('normalizeViewerSessionState: пропускает только известные состояния', () => {
  assert.equal(normalizeViewerSessionState('authenticated'), VIEWER_SESSION.authenticated)
  assert.equal(normalizeViewerSessionState('guest'), VIEWER_SESSION.guest)
  assert.equal(normalizeViewerSessionState('unknown'), VIEWER_SESSION.unknown)
  assert.equal(normalizeViewerSessionState(''), VIEWER_SESSION.unknown)
  assert.equal(normalizeViewerSessionState(null), VIEWER_SESSION.unknown)
})

test('isViewerAuthenticated: true только для авторизованного посетителя', () => {
  assert.equal(isViewerAuthenticated(VIEWER_SESSION.authenticated), true)
  assert.equal(isViewerAuthenticated(VIEWER_SESSION.guest), false)
  assert.equal(isViewerAuthenticated(VIEWER_SESSION.unknown), false)
  assert.equal(isViewerAuthenticated(undefined), false)
})
