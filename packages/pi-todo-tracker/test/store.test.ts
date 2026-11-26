import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyOp,
  bindSession,
  emptyTracker,
  isValidName,
  listTrackers,
  mutateTracker,
  readBindings,
  readTracker,
  renderLines,
  saveTracker,
  unbindSession,
} from '../extensions/todo-tracker/store.ts';

const freshDir = (): string => mkdtempSync(join(tmpdir(), 'todo-tracker-store-'));

test('tracker names are restricted to safe file names', () => {
  assert.equal(isValidName('pr-review'), true);
  assert.equal(isValidName('a_b-1'), true);
  for (const bad of ['', '../x', 'a/b', 'A', '.hidden', 'x'.repeat(49), 'has space']) {
    assert.equal(isValidName(bad), false, bad);
  }
});

test('check requires evidence, drop requires a reason, nothing is deleted', () => {
  const tracker = emptyTracker();
  assert.equal(applyOp(tracker, { op: 'add', text: 'a' }), undefined);
  assert.match(applyOp(tracker, { op: 'check', id: 1 }) ?? '', /evidence required/);
  assert.match(applyOp(tracker, { op: 'drop', id: 1 }) ?? '', /reason required/);
  assert.equal(applyOp(tracker, { op: 'check', id: 1, evidence: 'ran tests' }), undefined);
  assert.equal(tracker.items[0].status, 'done');
  assert.match(applyOp(tracker, { op: 'check', id: 99, evidence: 'x' }) ?? '', /not found/);
});

test('one nesting level: depth guard, open-children guard, split, reopen guard', () => {
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'parent' });
  assert.equal(applyOp(tracker, { op: 'split', id: 1, texts: ['c1', 'c2'] }), undefined);
  assert.match(
    applyOp(tracker, { op: 'add', text: 'deep', parent: 2 }) ?? '',
    /only one nesting level/
  );
  assert.match(
    applyOp(tracker, { op: 'check', id: 1, evidence: 'x' }) ?? '',
    /open children: #2, #3/
  );
  applyOp(tracker, { op: 'check', id: 2, evidence: 'e' });
  applyOp(tracker, { op: 'drop', id: 3, reason: 'r' });
  assert.equal(applyOp(tracker, { op: 'check', id: 1, evidence: 'all' }), undefined);
  assert.match(applyOp(tracker, { op: 'reopen', id: 2 }) ?? '', /reopen parent #1 first/);
  assert.match(applyOp(tracker, { op: 'add', text: 'late', parent: 1 }) ?? '', /not open/);
});

test('reopen clears evidence and reason', () => {
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'a' });
  applyOp(tracker, { op: 'check', id: 1, evidence: 'e' });
  applyOp(tracker, { op: 'reopen', id: 1 });
  assert.equal(tracker.items[0].evidence, undefined);
});

test('renderLines indents children under their parent', () => {
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'p' });
  applyOp(tracker, { op: 'add', text: 'other' });
  applyOp(tracker, { op: 'split', id: 1, texts: ['kid'] });
  assert.deepEqual(renderLines(tracker), ['[ ] #1 p', '  [ ] #3 kid', '[ ] #2 other']);
});

test('mutateTracker writes only when the op succeeds', () => {
  const dir = freshDir();
  saveTracker(dir, 't', emptyTracker());
  const failed = mutateTracker(dir, 't', (t) => applyOp(t, { op: 'check', id: 1, evidence: 'x' }));
  assert.match(failed.error ?? '', /not found/);
  assert.equal(readTracker(dir, 't')?.items.length, 0);
  mutateTracker(dir, 't', (t) => applyOp(t, { op: 'add', text: 'a' }));
  assert.equal(readTracker(dir, 't')?.items.length, 1);
});

test('readTracker refuses invalid names instead of touching the file system', () => {
  assert.equal(readTracker(freshDir(), '../etc/passwd'), undefined);
});

test('bindings keep only live processes; listTrackers reports live sessions', () => {
  const dir = freshDir();
  saveTracker(dir, 'dev', emptyTracker());
  bindSession(dir, { sessionId: 'live', tracker: 'dev', label: 'me', pid: process.pid, at: 1 });
  bindSession(dir, { sessionId: 'dead', tracker: 'dev', label: 'gone', pid: 2 ** 22 - 3, at: 2 });
  assert.deepEqual(
    readBindings(dir).map((b) => b.sessionId),
    ['live']
  );
  assert.deepEqual(listTrackers(dir)[0].sessions, ['me']);
  unbindSession(dir, 'live');
  assert.deepEqual(readBindings(dir), []);
});
