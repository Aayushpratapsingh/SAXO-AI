const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPendingAction, consumeApproval, rejectAction, validateAction } = require('../dist/main/approval.js');

const taskId = () => randomUUID();

test('browser proposals accept HTTPS navigation and typed search actions', () => {
  assert.equal(validateAction({ type: 'navigate', url: 'https://example.com', reason: 'Open it' }).url, 'https://example.com/');
  assert.deepEqual(validateAction({ type: 'search-web', query: 'python projects', site: 'github.com', reason: 'Search GitHub' }), {
    type: 'search-web', query: 'python projects', site: 'github.com', reason: 'Search GitHub'
  });
  assert.throws(() => validateAction({ type: 'navigate', url: 'file:///etc/passwd', reason: 'bad' }), /HTTP and HTTPS/);
  assert.throws(() => validateAction({ type: 'search-web', query: 'x', site: 'github.com; rm -rf', reason: 'bad' }), /site is invalid/);
});

test('approval is bound to its task and exact action and can be consumed once', () => {
  const id = taskId();
  const action = { type: 'search-youtube', query: 'lofi hip hop', reason: 'Submit query' };
  const pending = createPendingAction(id, action);
  assert.equal(consumeApproval(id, pending.actionId, pending.approvalToken).query, 'lofi hip hop');
  assert.throws(() => consumeApproval(id, pending.actionId, pending.approvalToken), /expired or no longer matches/);
});

test('rejected approvals cannot later be consumed', () => {
  const id = taskId();
  const pending = createPendingAction(id, { type: 'navigate', url: 'https://example.com', reason: 'Open' });
  assert.equal(rejectAction(pending.actionId), true);
  assert.throws(() => consumeApproval(id, pending.actionId, pending.approvalToken), /expired or no longer matches/);
});

test('approval token cannot be used for a different task', () => {
  const pending = createPendingAction(taskId(), { type: 'navigate', url: 'https://example.com', reason: 'Open' });
  assert.throws(() => consumeApproval(taskId(), pending.actionId, pending.approvalToken), /expired or no longer matches/);
});
