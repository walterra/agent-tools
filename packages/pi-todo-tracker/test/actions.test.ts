import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleWebAction, parseWebAction } from '../extensions/todo-tracker/actions.ts';
import { claimPendingEvents } from '../extensions/todo-tracker/inbox.ts';
import {
  applyOp,
  emptyTracker,
  readTracker,
  saveTracker,
} from '../extensions/todo-tracker/store.ts';
import { tempProjectDir } from './helpers.ts';

test('parseWebAction rejects malformed bodies', () => {
  const bad: unknown[] = [
    null,
    'x',
    {},
    { kind: 'delete', id: 1 },
    { kind: 'tick' },
    { kind: 'tick', id: -1 },
    { kind: 'tick', id: 1.5 },
    { kind: 'drop', id: 1 },
    { kind: 'comment', id: 1, text: '  ' },
    { kind: 'add', text: 'x'.repeat(2001) },
    { kind: 'add', text: 'ok', parent: '1' },
  ];
  for (const body of bad) assert.equal(typeof parseWebAction(body), 'string', JSON.stringify(body));
  assert.deepEqual(parseWebAction({ kind: 'add', text: ' hi ', parent: 2 }), {
    kind: 'add',
    text: 'hi',
    parent: 2,
  });
});

test('web actions use the same guards, mark user items, and queue inbox events', () => {
  const dir = tempProjectDir('actions');
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'parent' });
  applyOp(tracker, { op: 'split', id: 1, texts: ['child'] });
  saveTracker(dir, 'dev', tracker);

  assert.match(handleWebAction(dir, 'dev', { kind: 'tick', id: 1 }) ?? '', /open children/);
  assert.equal(handleWebAction(dir, 'dev', { kind: 'tick', id: 2 }), undefined);
  assert.equal(handleWebAction(dir, 'dev', { kind: 'comment', id: 1, text: 'hello' }), undefined);
  assert.equal(handleWebAction(dir, 'dev', { kind: 'add', text: 'from browser' }), undefined);
  assert.match(
    handleWebAction(dir, 'dev', { kind: 'add', text: 'deep', parent: 2 }) ?? '',
    /only one nesting level/
  );

  const items = readTracker(dir, 'dev')?.items ?? [];
  assert.equal(items[1].evidence, 'ticked by user in web UI');
  assert.deepEqual(items[0].notes, ['[user] hello']);
  assert.equal(items[2].by, 'user');

  const events = claimPendingEvents(dir, 'dev');
  assert.deepEqual(
    events.map((e) => [e.kind, e.deliver]),
    [
      ['tick', 'nextTurn'],
      ['comment', 'steer'],
      ['add', 'nextTurn'],
    ]
  );
  assert.deepEqual(claimPendingEvents(dir, 'dev'), [], 'each event is claimed once');
});
