/**
 * Tracker storage: one JSON file per named tracker in a project directory (see paths.ts),
 * plus .bindings.json recording which live pi session uses which tracker.
 * Node builtins only; no pi imports, so it is testable with plain node.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Status = 'open' | 'done' | 'dropped';

export interface Item {
  id: number;
  text: string;
  status: Status;
  parent?: number;
  by?: 'user';
  evidence?: string;
  reason?: string;
  notes: string[];
}

export interface Tracker {
  nextId: number;
  items: Item[];
  updatedAt: number;
}

export interface Binding {
  sessionId: string;
  tracker: string;
  label: string;
  pid: number;
  at: number;
}

export interface TrackerSummary {
  name: string;
  total: number;
  done: number;
  updatedAt: number;
  sessions: string[];
}

export interface OpParams {
  op: 'list' | 'add' | 'split' | 'check' | 'drop' | 'reopen' | 'note';
  text?: string;
  parent?: number;
  texts?: string[];
  id?: number;
  evidence?: string;
  reason?: string;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export const isValidName = (name: string): boolean => NAME_PATTERN.test(name);

const trackerPath = (dir: string, name: string): string => join(dir, `${name}.json`);

const bindingsPath = (dir: string): string => join(dir, '.bindings.json');

/** Write to a temp file and rename, so readers never see a partial file. */
export const writeJsonAtomic = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
};

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

export const emptyTracker = (): Tracker => ({ nextId: 1, items: [], updatedAt: Date.now() });

export const readTracker = (dir: string, name: string): Tracker | undefined =>
  isValidName(name) ? readJson<Tracker>(trackerPath(dir, name)) : undefined;

export const saveTracker = (dir: string, name: string, tracker: Tracker): void => {
  tracker.updatedAt = Date.now();
  writeJsonAtomic(trackerPath(dir, name), tracker);
};

/** Re-reads the file, applies fn, saves. Error string means nothing was written. */
export const mutateTracker = (
  dir: string,
  name: string,
  fn: (tracker: Tracker) => string | undefined
): { error?: string; tracker: Tracker } => {
  const tracker = readTracker(dir, name) ?? emptyTracker();
  const error = fn(tracker);
  if (error) return { error, tracker };
  saveTracker(dir, name, tracker);
  return { tracker };
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
};

/** Bindings of sessions whose pi process is still running. */
export const readBindings = (dir: string): Binding[] => {
  const all = readJson<Record<string, Binding>>(bindingsPath(dir)) ?? {};
  return Object.values(all).filter((binding) => isAlive(binding.pid));
};

export const bindSession = (dir: string, binding: Binding): void => {
  const all = readJson<Record<string, Binding>>(bindingsPath(dir)) ?? {};
  all[binding.sessionId] = binding;
  writeJsonAtomic(bindingsPath(dir), all);
};

export const unbindSession = (dir: string, sessionId: string): void => {
  const all = readJson<Record<string, Binding>>(bindingsPath(dir)) ?? {};
  delete all[sessionId];
  writeJsonAtomic(bindingsPath(dir), all);
};

export const listTrackers = (dir: string): TrackerSummary[] => {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const bindings = readBindings(dir);
  return files
    .filter((file) => file.endsWith('.json') && !file.startsWith('.'))
    .map((file) => file.slice(0, -'.json'.length))
    .filter(isValidName)
    .flatMap((name) => {
      const tracker = readTracker(dir, name);
      if (!tracker) return [];
      return [
        {
          name,
          total: tracker.items.length,
          done: tracker.items.filter((item) => item.status !== 'open').length,
          updatedAt: tracker.updatedAt,
          sessions: bindings
            .filter((binding) => binding.tracker === name)
            .map((binding) => binding.label),
        },
      ];
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

/** Top-level items in order, each followed by its children. */
export const orderedItems = (tracker: Tracker): Item[] =>
  tracker.items
    .filter((item) => item.parent === undefined)
    .flatMap((item) => [item, ...tracker.items.filter((child) => child.parent === item.id)]);

export const renderLines = (tracker: Tracker): string[] =>
  orderedItems(tracker).map((item) => {
    const box = item.status === 'done' ? '[x]' : item.status === 'dropped' ? '[-]' : '[ ]';
    const tail = item.evidence
      ? ` (${item.evidence})`
      : item.reason
        ? ` (dropped: ${item.reason})`
        : '';
    const indent = item.parent === undefined ? '' : '  ';
    const origin = item.by === 'user' ? ' [added by user]' : '';
    return `${indent}${box} #${item.id} ${item.text}${origin}${tail}`;
  });

/** Enforces one nesting level: the parent must exist, be open, and be top-level. */
const checkParent = (tracker: Tracker, parentId: number): string | undefined => {
  const parent = tracker.items.find((candidate) => candidate.id === parentId);
  if (!parent) return `parent #${parentId} not found`;
  if (parent.parent !== undefined)
    return `#${parentId} is already a child; only one nesting level allowed`;
  if (parent.status !== 'open') return `parent #${parentId} is not open`;
  return undefined;
};

/** Returns an error string, or undefined on success. Mutates the tracker. */
export const applyOp = (tracker: Tracker, params: OpParams): string | undefined => {
  if (params.op === 'list') return undefined;
  if (params.op === 'add') {
    if (!params.text) return 'text required for add';
    if (params.parent !== undefined) {
      const parentError = checkParent(tracker, params.parent);
      if (parentError) return parentError;
    }
    tracker.items.push({
      id: tracker.nextId++,
      text: params.text,
      status: 'open',
      parent: params.parent,
      notes: [],
    });
    return undefined;
  }
  const item = tracker.items.find((candidate) => candidate.id === params.id);
  if (!item) return `item #${params.id} not found`;
  if (params.op === 'split') {
    if (!params.texts || params.texts.length === 0) return 'texts required for split';
    const parentError = checkParent(tracker, item.id);
    if (parentError) return parentError;
    for (const text of params.texts) {
      tracker.items.push({
        id: tracker.nextId++,
        text,
        status: 'open',
        parent: item.id,
        notes: [],
      });
    }
    return undefined;
  }
  if (params.op === 'check' || params.op === 'drop') {
    const openChildren = tracker.items.filter(
      (child) => child.parent === item.id && child.status === 'open'
    );
    if (openChildren.length > 0)
      return `open children: ${openChildren.map((child) => `#${child.id}`).join(', ')}`;
  }
  if (params.op === 'check') {
    if (!params.evidence) return 'evidence required for check';
    item.status = 'done';
    item.evidence = params.evidence;
    return undefined;
  }
  if (params.op === 'drop') {
    if (!params.reason) return 'reason required for drop';
    item.status = 'dropped';
    item.reason = params.reason;
    return undefined;
  }
  if (params.op === 'reopen') {
    const parent = tracker.items.find((candidate) => candidate.id === item.parent);
    if (parent && parent.status !== 'open') return `reopen parent #${parent.id} first`;
    item.status = 'open';
    delete item.evidence;
    delete item.reason;
    return undefined;
  }
  if (params.op === 'note') {
    if (!params.text) return 'text required for note';
    item.notes.push(params.text);
    return undefined;
  }
  return 'unknown op';
};
