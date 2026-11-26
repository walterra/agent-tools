/**
 * tracker: model-managed checklists stored as named trackers outside the repo, in
 * ~/.pi/agent/tracker/projects/<project key>/<name>.json (see paths.ts). Each pi session
 * binds to one tracker (stored as a session entry); several sessions may bind to the same
 * one. One global web server (see server.ts) shows all projects and trackers live.
 * Commands: /todo-tracker (alias /tt) [open|use|new|list|where]. Tool: todo_tracker.
 */
import { type FSWatcher, mkdirSync, watch } from 'node:fs';
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { DIGEST_ENTRY, digestToInject, RULES } from './digest.ts';
import { claimPendingEvents, inboxFileName } from './inbox.ts';
import { projectDirOf, projectKeyOf } from './paths.ts';
import { registerProject } from './project.ts';
import { ensureServer, isServerWanted, type RunningServer } from './server.ts';
import {
  applyOp,
  bindSession,
  emptyTracker,
  isValidName,
  listTrackers,
  mutateTracker,
  type OpParams,
  readTracker,
  renderLines,
  saveTracker,
  unbindSession,
} from './store.ts';

const BINDING_ENTRY = 'tracker-binding';
const TOOL_NAME = 'todo_tracker';
const WIDGET_ID = 'todo-tracker';
// Alias registered with the same handler; if another extension takes "tt", pi suffixes it (tt:1).
const COMMAND_NAMES = ['todo-tracker', 'tt'] as const;

const Params = Type.Object({
  op: StringEnum(['list', 'add', 'split', 'check', 'drop', 'reopen', 'note'] as const),
  text: Type.Optional(Type.String({ description: 'item text (add) or note text (note)' })),
  parent: Type.Optional(
    Type.Number({ description: 'add: id of a top-level item to nest under (one level max)' })
  ),
  texts: Type.Optional(Type.Array(Type.String(), { description: 'split: child item texts' })),
  id: Type.Optional(Type.Number({ description: 'item id (check/drop/reopen/note)' })),
  evidence: Type.Optional(
    Type.String({ description: 'required for check: what was run/seen, in a few words' })
  ),
  reason: Type.Optional(Type.String({ description: 'required for drop' })),
});

interface BindingEntry {
  type?: string;
  customType?: string;
  data?: { name?: string };
}

export default function (pi: ExtensionAPI) {
  let bound: string | undefined;
  let latestCtx: ExtensionContext | undefined;
  let fileWatcher: FSWatcher | undefined;
  let widgetTimer: NodeJS.Timeout | undefined;
  let server: RunningServer | undefined;
  let takeoverTimer: NodeJS.Timeout | undefined;

  /** Project data directory for this session's working directory. */
  const dirOf = (ctx: ExtensionContext): string => projectDirOf(ctx.cwd);

  const sessionLabel = (ctx: ExtensionContext): string =>
    pi.getSessionName() ?? ctx.sessionManager.getSessionId().slice(0, 8);

  const trackerUrl = (ctx: ExtensionContext, base: string): string =>
    bound ? `${base}/p/${encodeURIComponent(projectKeyOf(ctx.cwd))}/t/${bound}` : base;

  const updateWidget = (ctx: ExtensionContext): void => {
    if (!bound) {
      ctx.ui.setWidget(WIDGET_ID, [
        'tracker: not bound - /todo-tracker use <name> or /todo-tracker new <name>',
      ]);
      return;
    }
    const tracker = readTracker(dirOf(ctx), bound) ?? emptyTracker();
    const done = tracker.items.filter((item) => item.status !== 'open').length;
    const url = server ? ` - ${trackerUrl(ctx, server.url)}` : '';
    const openLines = renderLines(tracker).filter((line) => line.trimStart().startsWith('[ ]'));
    ctx.ui.setWidget(WIDGET_ID, [
      `tracker ${bound} ${done}/${tracker.items.length} done${url}`,
      ...openLines.slice(0, 6),
    ]);
  };

  /** Sends web UI events for the bound tracker to the agent; each event is delivered by one session only. */
  const deliverInbox = (ctx: ExtensionContext, source: 'live' | 'backlog'): void => {
    if (!bound) return;
    for (const event of claimPendingEvents(dirOf(ctx), bound)) {
      // Only a live comment wakes an idle agent. Clicks (tick, add, drop) just queue, and
      // backlog from before this session bound never starts a turn on its own at startup.
      const wake = source === 'live' && event.kind === 'comment';
      pi.sendMessage(
        {
          customType: 'tracker-event',
          content: `tracker ${bound}: ${event.summary}`,
          display: true,
          details: event,
        },
        { deliverAs: event.deliver, triggerTurn: wake }
      );
    }
  };

  /** Refreshes the widget when another process or the web UI changes the bound file. */
  const watchBoundFile = (ctx: ExtensionContext): void => {
    fileWatcher?.close();
    fileWatcher = undefined;
    if (!bound) return;
    mkdirSync(dirOf(ctx), { recursive: true });
    const fileName = `${bound}.json`;
    const inboxName = inboxFileName(bound);
    fileWatcher = watch(dirOf(ctx), { persistent: false }, (_event, changed) => {
      if (changed !== fileName && changed !== inboxName) return;
      clearTimeout(widgetTimer);
      widgetTimer = setTimeout(() => {
        try {
          updateWidget(ctx);
          deliverInbox(ctx, 'live');
        } catch {
          // ctx can be stale after a session switch; the next session_start rebinds.
        }
      }, 100);
    });
  };

  const bindTo = (ctx: ExtensionContext, name: string, mode: 'use' | 'new'): string | undefined => {
    if (!isValidName(name)) return `invalid name "${name}": use a-z, 0-9, - and _ (max 48 chars)`;
    const exists = readTracker(dirOf(ctx), name) !== undefined;
    if (mode === 'use' && !exists)
      return `tracker "${name}" not found; /todo-tracker new ${name} creates it`;
    if (mode === 'new' && exists)
      return `tracker "${name}" exists; /todo-tracker use ${name} binds to it`;
    if (mode === 'new') saveTracker(dirOf(ctx), name, emptyTracker());
    bound = name;
    registerProject(ctx.cwd);
    startTakeoverTimer(ctx);
    pi.appendEntry(BINDING_ENTRY, { name });
    bindSession(dirOf(ctx), {
      sessionId: ctx.sessionManager.getSessionId(),
      tracker: name,
      label: sessionLabel(ctx),
      pid: process.pid,
      at: Date.now(),
    });
    watchBoundFile(ctx);
    updateWidget(ctx);
    deliverInbox(ctx, 'backlog');
    return undefined;
  };

  const restoreBinding = (ctx: ExtensionContext): void => {
    bound = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      const candidate = entry as BindingEntry;
      if (
        candidate.type === 'custom' &&
        candidate.customType === BINDING_ENTRY &&
        candidate.data?.name
      ) {
        bound = candidate.data.name;
      }
    }
    if (bound && readTracker(dirOf(ctx), bound) === undefined) bound = undefined;
    if (bound) {
      registerProject(ctx.cwd);
      bindSession(dirOf(ctx), {
        sessionId: ctx.sessionManager.getSessionId(),
        tracker: bound,
        label: sessionLabel(ctx),
        pid: process.pid,
        at: Date.now(),
      });
    }
    watchBoundFile(ctx);
    updateWidget(ctx);
    // Deferred: sending messages from inside session_start can run before the agent is ready.
    setTimeout(() => {
      try {
        deliverInbox(ctx, 'backlog');
      } catch {
        // ctx can be stale if the session was replaced within the delay.
      }
    }, 500).unref();
  };

  /**
   * Every bound session watches the global server: if it died (leader session ended) and one
   * was in use before, this process starts it again on the same port.
   */
  const startTakeoverTimer = (ctx: ExtensionContext): void => {
    if (takeoverTimer) return;
    takeoverTimer = setInterval(async () => {
      if (server?.role === 'leader') return;
      if (!server && !isServerWanted()) return;
      try {
        const next = await ensureServer();
        if (next.url === server?.url) return;
        server = next;
        updateWidget(ctx);
      } catch {
        // Port busy or ctx stale; the next tick retries.
      }
    }, 5000);
    takeoverTimer.unref();
  };

  /** Starts or reuses the global server and returns this session's tracker URL. */
  const openServer = async (ctx: ExtensionContext): Promise<string> => {
    registerProject(ctx.cwd);
    server = await ensureServer();
    startTakeoverTimer(ctx);
    updateWidget(ctx);
    return trackerUrl(ctx, server.url);
  };

  pi.on('session_start', async (_event, ctx) => {
    latestCtx = ctx;
    restoreBinding(ctx);
    if (bound) startTakeoverTimer(ctx);
  });

  // Rules are static (cache-safe). The state digest is injected only when the context
  // does not already hold the same one, which also covers resume, branching and compaction.
  pi.on('before_agent_start', async (event, ctx) => {
    const systemPrompt = `${event.systemPrompt}\n\n${RULES}`;
    const tracker = bound ? readTracker(dirOf(ctx), bound) : undefined;
    const digest = digestToInject(bound, tracker, ctx.sessionManager.buildContextEntries());
    if (!digest) return { systemPrompt };
    return { systemPrompt, message: { customType: DIGEST_ENTRY, content: digest, display: false } };
  });

  pi.on('session_shutdown', async () => {
    fileWatcher?.close();
    clearTimeout(widgetTimer);
    clearInterval(takeoverTimer);
    takeoverTimer = undefined;
    if (server?.role === 'leader') server.stop();
    server = undefined;
    if (latestCtx) unbindSession(dirOf(latestCtx), latestCtx.sessionManager.getSessionId());
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Todo tracker',
    description:
      "Manage this session's persistent tracker checklist. Ops: list, add(text, parent?), split(id, texts), " +
      'check(id, evidence), drop(id, reason), reopen(id), note(id, text). One nesting level. ' +
      'Items cannot be deleted or reordered. check only for work executed and verified this session. ' +
      'The tracker is chosen by the user with /todo-tracker use|new; the tool has no name parameter.',
    promptSnippet: `Keep the task checklist in the ${TOOL_NAME} tool instead of re-printing it in replies`,
    parameters: Params,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      if (!bound) {
        const existing = listTrackers(dirOf(ctx)).map((tracker) => tracker.name);
        if (existing.length > 0) {
          const text = `error: no tracker bound to this session. Ask the user to run /todo-tracker use <name> (existing: ${existing.join(', ')}) or /todo-tracker new <name>.`;
          return { content: [{ type: 'text', text }], details: { error: 'unbound' } };
        }
        bindTo(ctx, `s-${ctx.sessionManager.getSessionId().replace(/-/g, '').slice(-8)}`, 'new');
      }
      const name = bound as string;
      const op = params as OpParams;
      if (op.op === 'list') {
        const tracker = readTracker(dirOf(ctx), name) ?? emptyTracker();
        return {
          content: [
            {
              type: 'text',
              text: `tracker: ${name}\n${renderLines(tracker).join('\n') || 'empty'}`,
            },
          ],
          details: { name, tracker },
        };
      }
      const { error, tracker } = mutateTracker(dirOf(ctx), name, (current) => applyOp(current, op));
      if (error)
        return { content: [{ type: 'text', text: `error: ${error}` }], details: { error } };
      updateWidget(ctx);
      return {
        content: [{ type: 'text', text: `tracker: ${name}\n${renderLines(tracker).join('\n')}` }],
        details: { name, tracker },
      };
    },
  });

  const todoTrackerCommand: Parameters<ExtensionAPI['registerCommand']>[1] = {
    description: 'Todo tracker web UI and binding: [open] | use <name> | new <name> | list | where',
    getArgumentCompletions: (prefix: string) => {
      const [first, second] = prefix.split(/\s+/);
      if (second === undefined) {
        return ['open', 'use', 'new', 'list', 'where']
          .filter((sub) => sub.startsWith(first))
          .map((sub) => ({ value: sub, label: sub }));
      }
      if (first !== 'use') return null;
      return listTrackers(projectDirOf(process.cwd()))
        .filter((tracker) => tracker.name.startsWith(second))
        .map((tracker) => ({ value: `use ${tracker.name}`, label: tracker.name }));
    },
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const [sub = 'open', name = ''] = args.trim().split(/\s+/);
      if (sub === 'use' || sub === 'new') {
        const error = bindTo(ctx, name, sub);
        ctx.ui.notify(
          error ? `tracker: ${error}` : `tracker: bound to ${name}`,
          error ? 'error' : 'info'
        );
        return;
      }
      if (sub === 'where') {
        ctx.ui.notify(`tracker data: ${dirOf(ctx)}`, 'info');
        return;
      }
      if (sub === 'list') {
        const lines = listTrackers(dirOf(ctx)).map((tracker) => {
          const marker = tracker.name === bound ? '*' : ' ';
          const live = tracker.sessions.length ? ` [${tracker.sessions.join(', ')}]` : '';
          return `${marker} ${tracker.name} ${tracker.done}/${tracker.total}${live}`;
        });
        ctx.ui.notify(lines.join('\n') || 'tracker: no trackers', 'info');
        return;
      }
      const url = await openServer(ctx);
      ctx.ui.notify(`tracker: ${url}`, 'info');
    },
  };
  for (const commandName of COMMAND_NAMES) pi.registerCommand(commandName, todoTrackerCommand);
}
