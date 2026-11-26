import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIGEST_ENTRY,
  digestToInject,
  formatDigest,
  lastDigestIn,
  MAX_DIGEST_ITEMS,
  RULES,
} from '../extensions/todo-tracker/digest.ts';
import { applyOp, emptyTracker } from '../extensions/todo-tracker/store.ts';

test('rules name the todo_tracker tool', () => {
  assert.match(RULES, /todo_tracker/);
});

test('empty tracker has no digest; all done says so', () => {
  assert.equal(formatDigest('x', emptyTracker()), undefined);
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'a' });
  applyOp(tracker, { op: 'check', id: 1, evidence: 'e' });
  assert.equal(formatDigest('x', tracker), 'tracker x: 1/1 done; no open items');
});

test('digest lists open items only, children under open parents', () => {
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'parent' });
  applyOp(tracker, { op: 'split', id: 1, texts: ['c1', 'c2'] });
  applyOp(tracker, { op: 'check', id: 2, evidence: 'e' });
  const digest = formatDigest('n', tracker) ?? '';
  assert.match(digest, /1\/3 done/);
  assert.ok(!digest.includes('c1'));
  assert.ok(digest.includes('  [ ] #3 c2'));
});

test('digest is capped and says how many are hidden', () => {
  const tracker = emptyTracker();
  for (let i = 0; i < MAX_DIGEST_ITEMS + 5; i++) applyOp(tracker, { op: 'add', text: `item ${i}` });
  const lines = (formatDigest('n', tracker) ?? '').split('\n');
  assert.equal(lines.length, 1 + MAX_DIGEST_ITEMS + 1);
  assert.match(lines.at(-1) ?? '', /5 more open \(use todo_tracker op=list\)/);
});

test('digest is injected only when the context lacks the same one', () => {
  const tracker = emptyTracker();
  applyOp(tracker, { op: 'add', text: 'a' });
  const first = digestToInject('n', tracker, []);
  assert.ok(first);
  const context = [{ type: 'custom_message', customType: DIGEST_ENTRY, content: first }];
  assert.equal(digestToInject('n', tracker, context), undefined);
  applyOp(tracker, { op: 'add', text: 'b' });
  assert.ok(digestToInject('n', tracker, context));
  assert.ok(digestToInject('n', tracker, []), 'compaction removed the digest: inject again');
  assert.equal(digestToInject(undefined, tracker, []), undefined, 'unbound session');
  assert.equal(
    lastDigestIn([{ type: 'custom_message', customType: 'other', content: 'z' }]),
    undefined
  );
});
