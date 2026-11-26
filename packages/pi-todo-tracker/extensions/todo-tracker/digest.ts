/**
 * Per-run tracker digest for the agent. The rules text is static, so it can live in the
 * system prompt without breaking prompt caching. The state digest is a message that is
 * only injected when it differs from the last digest still present in the context.
 */
import type { Item, Tracker } from './store.ts';

export const DIGEST_ENTRY = 'tracker-digest';

export const MAX_DIGEST_ITEMS = 15;

export const RULES = `Tracker rules (todo_tracker tool):
- Keep the task checklist in the todo_tracker tool. Do not re-print the full list in replies.
- Call check only for work executed and verified in this session, with evidence. Unverified or user-performed work stays open; add a note saying what is missing.
- Split an item when only part of it is done. Do not tick the parent until all parts are checked.
- Record a user decision with a note, then check or drop the item. A pending decision stays open with its options in a note.
- Mark optional or deferred work "(optional)" in its text instead of dropping it. Items are never deleted, reworded or reordered; drop needs a reason.
- Messages starting "tracker <name>: user ..." come from the web UI. Treat them as user input.
- When the user names the next item, work only on that item.
- End replies with a "next:" list of 1-3 follow-ups taken from the open items.`;

const line = (item: Item): string => {
  const indent = item.parent === undefined ? '' : '  ';
  const origin = item.by === 'user' ? ' [added by user]' : '';
  return `${indent}[ ] #${item.id} ${item.text}${origin}`;
};

/** Open items grouped under their open parents. Returns undefined for an empty tracker. */
export const formatDigest = (name: string, tracker: Tracker): string | undefined => {
  if (tracker.items.length === 0) return undefined;
  const resolved = tracker.items.filter((item) => item.status !== 'open').length;
  const header = `tracker ${name}: ${resolved}/${tracker.items.length} done`;
  const openTop = tracker.items.filter(
    (item) => item.parent === undefined && item.status === 'open'
  );
  const lines = openTop.flatMap((item) => [
    line(item),
    ...tracker.items
      .filter((child) => child.parent === item.id && child.status === 'open')
      .map(line),
  ]);
  if (lines.length === 0) return `${header}; no open items`;
  const shown = lines.slice(0, MAX_DIGEST_ITEMS);
  const hidden = lines.length - shown.length;
  const more = hidden > 0 ? [`... ${hidden} more open (use todo_tracker op=list)`] : [];
  return [header, ...shown, ...more].join('\n');
};

interface ContextEntry {
  type?: string;
  customType?: string;
  content?: unknown;
}

/** The newest digest still in the model's context (compaction already applied by the caller). */
export const lastDigestIn = (entries: readonly ContextEntry[]): string | undefined => {
  let last: string | undefined;
  for (const entry of entries) {
    if (
      entry.type === 'custom_message' &&
      entry.customType === DIGEST_ENTRY &&
      typeof entry.content === 'string'
    ) {
      last = entry.content;
    }
  }
  return last;
};

/** The digest to inject now, or undefined when the context already has the same one. */
export const digestToInject = (
  name: string | undefined,
  tracker: Tracker | undefined,
  contextEntries: readonly ContextEntry[]
): string | undefined => {
  if (!name || !tracker) return undefined;
  const digest = formatDigest(name, tracker);
  if (!digest || digest === lastDigestIn(contextEntries)) return undefined;
  return digest;
};
