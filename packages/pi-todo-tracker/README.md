# @walterra/pi-todo-tracker

Todo tracker for the [pi coding agent](https://github.com/badlogic/pi-mono). The agent keeps its checklist in a tool instead of re-printing it every reply, and you get a live web board for all your projects and sessions.

- **Agent-managed list.** One tool, `todo_tracker`: add, split, check, drop, reopen, note. Items close only with evidence, and are never deleted or reordered.
- **Live web board.** One local page for every project, repo, worktree and tracker, updated as the agent works.
- **Two-way.** Tick, drop, comment or add items in the browser. A comment wakes an idle agent. Other clicks queue for its next turn.
- **Shared across sessions.** Several pi sessions can bind to one tracker. Different sessions can keep separate trackers in the same directory.
- **Outside your repo.** Data lives in `~/.pi/agent/tracker/`, so nothing shows up in `git status` and nothing needs a `.gitignore` entry.

## Installation

```bash
pi install npm:@walterra/pi-todo-tracker
```

## Quick start

```text
/tt new my-task       create a tracker and bind this session to it
```

Ask the agent to plan its work, then open the board:

```text
/tt                   print the URL of this tracker's page
```

Binding is stored in the session, so `/resume` and `/reload` keep it.

## Commands

`/todo-tracker` and its alias `/tt` take the same arguments.

| Command | What it does |
| --- | --- |
| `/tt` or `/tt open` | Start or reuse the web server, show this tracker's URL |
| `/tt new <name>` | Create a tracker and bind this session to it |
| `/tt use <name>` | Bind this session to an existing tracker |
| `/tt list` | List this directory's trackers, with live sessions |
| `/tt where` | Show the directory holding this project's data |

Names are `a-z`, `0-9`, `-` and `_`, up to 48 characters. If another extension already uses `/tt`, pi suffixes the later one (`/tt:1`). `/todo-tracker` always works.

## Tool: `todo_tracker`

The tool has no tracker-name parameter. It always acts on the tracker bound to the session, which you choose with `/tt use` or `/tt new`.

| Op | Parameters | Rule |
| --- | --- | --- |
| `list` | | Show the tracker |
| `add` | `text`, `parent?` | `parent` nests under a top-level open item (one level only) |
| `split` | `id`, `texts` | Create children under an open top-level item |
| `check` | `id`, `evidence` | Evidence required. Blocked while the item has open children. |
| `drop` | `id`, `reason` | Reason required. Blocked while the item has open children. |
| `reopen` | `id` | Clears evidence and reason. Blocked if the parent is closed. |
| `note` | `id`, `text` | Append a note |

An unbound session gets an error naming the existing trackers and the command to run. If the directory has no trackers yet, the first tool call creates one named `s-<session id>`.

## What the agent sees

- **Rules.** A short block is appended to the system prompt on every run: use the tool instead of re-printing the list, `check` only with verified evidence, split partial work, record decisions, `(optional)` instead of deleting, a `next:` list at the end. The text is constant, so prompt caching is unaffected.
- **Digest.** The open items (children under their parents, at most 15 lines) go in as a hidden message, but only when they differ from the last digest still in the context. Compaction, `/resume` and branching therefore need no extra handling.
- **Events.** Browser actions arrive as `tracker <name>: user …` messages. Comments are delivered right after the current tool calls and start a turn if the agent is idle. Ticks, drops, reopens and new items wait for the next turn and never start one. Events that arrived while no session was bound are delivered on the next bind, without starting a turn.

## The web board

The server listens on `127.0.0.1`, by default port 7331. If that port is taken it falls back to a free one and remembers it.

- **Index.** Repository → worktree (branch) → trackers, with progress and the labels of live sessions. Projects without a live session sit under "inactive". There is a filter box.
- **Tracker page.** Click a checkbox to tick or reopen. Hover an item for `comment`, `drop` and `+child`. The box at the bottom adds an item. Items you add are marked `(user)`.
- **Live.** The page follows file changes, so edits from any session or from another browser tab show up without refresh.

One server serves all projects. The first pi process that needs it becomes the leader. Other processes reuse its URL. If the leader's session ends, any session bound to a tracker starts the server again on the same port within about five seconds.

## Where data lives

```text
~/.pi/agent/tracker/
  server.json                         {pid, port} of the running server
  projects/--Users-me-dev-repo--/     one directory per working directory
    .project.json                     repo, branch, last seen
    my-task.json                      one file per tracker
    my-task.inbox.jsonl               browser events waiting for the agent
    .bindings.json                    live sessions per tracker
    .claims/                          one marker per delivered event
```

Directory names follow pi's session directory naming. Each working directory has its own set of trackers, so two worktrees of one repo do not share trackers. Moving or renaming a directory leaves its trackers under the old name.

| Environment variable | Effect |
| --- | --- |
| `PI_TRACKER_HOME` | Use another data root |
| `PI_TRACKER_PORT` | Preferred server port (`0` picks a free one) |

## Security model

The server is for you, on your machine.

- Binds to `127.0.0.1` only. Requests whose `Host` is not `127.0.0.1` or `localhost` get `403`, which stops DNS rebinding.
- Every change needs a random token, created when the server starts and embedded in the page, plus a local `Origin`. Request bodies are capped at 16 KB and text fields at 2000 characters.
- The browser names a project by its directory name, which must match the key pattern and exist under `projects/`. It never sends a path.
- The tool writes only inside that data root. Reads go through the same validated names.

Other local processes that can read the page can read the token. Do not run the server on a shared machine you do not trust.

## Limitations

- Two processes changing the same tracker within a few milliseconds can lose one update. Writes are atomic, so files are never corrupted.
- The `.claims/` marker files are never cleaned up.
- Developed and tested on macOS with Node 24. Linux and Windows are untested. Node 20 or newer is required.

## Development

```bash
pnpm --filter @walterra/pi-todo-tracker test
```

Tests use `node:test` with Node's built-in type stripping and a temporary data root. They start real servers on local ports, including a five-process leader election.

## License

MIT
