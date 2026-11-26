/**
 * Per-tracker inbox of web UI events, as JSONL next to the tracker file. The server
 * appends; the pi session bound to the tracker delivers each event to the agent once.
 * Claims use exclusive file creation so two sessions on one tracker never both deliver.
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InboxEvent {
  id: string;
  at: number;
  kind: 'tick' | 'reopen' | 'drop' | 'comment' | 'add';
  itemId: number;
  summary: string;
  deliver: 'steer' | 'nextTurn';
}

export const inboxFileName = (tracker: string): string => `${tracker}.inbox.jsonl`;

const inboxPath = (dir: string, tracker: string): string => join(dir, inboxFileName(tracker));

const claimDir = (dir: string): string => join(dir, '.claims');

export const appendInbox = (dir: string, tracker: string, event: InboxEvent): void => {
  mkdirSync(dir, { recursive: true });
  appendFileSync(inboxPath(dir, tracker), `${JSON.stringify(event)}\n`);
};

const readInbox = (dir: string, tracker: string): InboxEvent[] => {
  let text = '';
  try {
    text = readFileSync(inboxPath(dir, tracker), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    if (!line) return [];
    try {
      return [JSON.parse(line) as InboxEvent];
    } catch {
      return [];
    }
  });
};

/** True when this process created the claim, i.e. it may deliver the event. */
const claim = (dir: string, tracker: string, eventId: string): boolean => {
  mkdirSync(claimDir(dir), { recursive: true });
  try {
    closeSync(openSync(join(claimDir(dir), `${tracker}-${eventId}`), 'wx'));
    return true;
  } catch {
    return false;
  }
};

/** Events not yet delivered by any session; each returned event is now claimed by the caller. */
export const claimPendingEvents = (dir: string, tracker: string): InboxEvent[] =>
  readInbox(dir, tracker).filter((event) => claim(dir, tracker, event.id));
