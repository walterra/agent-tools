/**
 * Web UI actions: validate the request body, change the tracker, and queue an inbox
 * event describing what the user did. Browser edits use the same guards as the tool.
 */
import { randomBytes } from 'node:crypto';
import { appendInbox, type InboxEvent } from './inbox.ts';
import { applyOp, mutateTracker, type OpParams, type Tracker } from './store.ts';

export type WebAction =
  | { kind: 'tick'; id: number }
  | { kind: 'reopen'; id: number }
  | { kind: 'drop'; id: number; reason: string }
  | { kind: 'comment'; id: number; text: string }
  | { kind: 'add'; text: string; parent?: number };

const MAX_TEXT = 2000;
const USER_EVIDENCE = 'ticked by user in web UI';

const asId = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT
    ? value.trim()
    : undefined;

/** Returns the typed action, or an error string. */
export const parseWebAction = (body: unknown): WebAction | string => {
  if (typeof body !== 'object' || body === null) return 'body must be an object';
  const input = body as Record<string, unknown>;
  const id = asId(input.id);
  switch (input.kind) {
    case 'tick':
    case 'reopen':
      return id === undefined ? 'id required' : { kind: input.kind, id };
    case 'drop': {
      const reason = asText(input.reason);
      return id === undefined || reason === undefined
        ? 'id and reason required'
        : { kind: 'drop', id, reason };
    }
    case 'comment': {
      const text = asText(input.text);
      return id === undefined || text === undefined
        ? 'id and text required'
        : { kind: 'comment', id, text };
    }
    case 'add': {
      const text = asText(input.text);
      const parent = input.parent === undefined ? undefined : asId(input.parent);
      if (text === undefined) return 'text required';
      if (input.parent !== undefined && parent === undefined) return 'invalid parent';
      return { kind: 'add', text, parent };
    }
    default:
      return 'unknown action';
  }
};

const toOp = (action: WebAction): OpParams => {
  switch (action.kind) {
    case 'tick':
      return { op: 'check', id: action.id, evidence: USER_EVIDENCE };
    case 'reopen':
      return { op: 'reopen', id: action.id };
    case 'drop':
      return { op: 'drop', id: action.id, reason: action.reason };
    case 'comment':
      return { op: 'note', id: action.id, text: `[user] ${action.text}` };
    case 'add':
      return { op: 'add', text: action.text, parent: action.parent };
  }
};

const shorten = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

const describe = (action: WebAction, tracker: Tracker, itemId: number): string => {
  const item = tracker.items.find((candidate) => candidate.id === itemId);
  const label = `#${itemId} "${shorten(item?.text ?? '')}"`;
  switch (action.kind) {
    case 'tick':
      return `user ticked ${label} in the web UI (marked done)`;
    case 'reopen':
      return `user reopened ${label} in the web UI`;
    case 'drop':
      return `user dropped ${label} in the web UI: ${action.reason}`;
    case 'comment':
      return `user comment on ${label}: ${action.text}`;
    case 'add':
      return `user added ${label}${action.parent === undefined ? '' : ` under #${action.parent}`} in the web UI`;
  }
};

/** Applies the action and queues an inbox event. Returns an error string if nothing changed. */
export const handleWebAction = (
  dir: string,
  trackerName: string,
  action: WebAction
): string | undefined => {
  const firstNewId = { value: 0 };
  const { error, tracker } = mutateTracker(dir, trackerName, (current) => {
    firstNewId.value = current.nextId;
    const opError = applyOp(current, toOp(action));
    if (opError) return opError;
    for (const item of current.items) if (item.id >= firstNewId.value) item.by = 'user';
    return undefined;
  });
  if (error) return error;
  const itemId = action.kind === 'add' ? firstNewId.value : action.id;
  const event: InboxEvent = {
    id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
    at: Date.now(),
    kind: action.kind,
    itemId,
    summary: describe(action, tracker, itemId),
    // Comments should reach the agent mid-turn; state changes wait for the next prompt.
    deliver: action.kind === 'comment' ? 'steer' : 'nextTurn',
  };
  appendInbox(dir, trackerName, event);
  return undefined;
};
