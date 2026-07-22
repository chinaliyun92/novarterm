import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  ROOT_REMOTE_PATH,
  getRemoteParentPath,
  joinRemotePath,
  normalizeRemotePath,
} from '../src/renderer/src/types/file-browser'

test('normalizeRemotePath normalizes slashes and trims trailing slash', () => {
  assert.equal(normalizeRemotePath('  \\\\var\\\\log////  '), '/var/log')
})

test('joinRemotePath supports normal child join and absolute child replacement', () => {
  assert.equal(joinRemotePath('/home/user', 'docs'), '/home/user/docs')
  assert.equal(joinRemotePath('/home/user', '/etc/nginx'), '/etc/nginx')
})

test('joinRemotePath handles current and parent directory segments', () => {
  assert.equal(joinRemotePath('/home/user', '.'), '/home/user')
  assert.equal(joinRemotePath('/home/user', '..'), '/home')
  assert.equal(joinRemotePath(ROOT_REMOTE_PATH, '..'), ROOT_REMOTE_PATH)
})

test('getRemoteParentPath resolves parent directory for nested and root paths', () => {
  assert.equal(getRemoteParentPath('/a/b/c'), '/a/b')
  assert.equal(getRemoteParentPath('/a'), ROOT_REMOTE_PATH)
  assert.equal(getRemoteParentPath(ROOT_REMOTE_PATH), null)
})
