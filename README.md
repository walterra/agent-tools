# agent-tools

Agent tooling packages - pi extensions, agent skills, and more.

## Packages

### Pi Extensions

| Package | Description | Install |
|---------|-------------|---------|
| [@walterra/pi-charts](./packages/pi-charts) | Vega-Lite chart extension for pi | `pi install npm:@walterra/pi-charts` |
| [@walterra/pi-graphviz](./packages/pi-graphviz) | Graphviz DOT diagram extension for pi | `pi install npm:@walterra/pi-graphviz` |

### Agent Skills

Universal agent skills compatible with Cursor, Claude Code, Codex, Pi, and other agents following the [Agent Skills specification](https://agentskills.io/).

| Skill | Description |
|-------|-------------|
| [es-ingest](./packages/es-ingest) | **Deprecated** in this repo. Use official [`elasticsearch-file-ingest`](https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-file-ingest) in `elastic/agent-skills`. |
| [git-commit](./packages/git-commit) | Commit staged files with precise messages, safe pre-commit hook handling |
| [post-mortem](./packages/post-mortem) | Analyze chat sessions to improve project rules and skills |
| [searxng-search](./packages/searxng-search) | Web search via SearXNG - no API keys, no rate limits |

## Deprecations

- `es-ingest` is deprecated in this repository.
- Official replacement: [`elasticsearch-file-ingest`](https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-file-ingest)
- Install replacement via:
  `npx skills add elastic/agent-skills --skill elasticsearch-file-ingest`

## Install Skills

### From GitHub

```bash
# Using npx skills (Vercel)
npx skills add walterra/agent-tools --skill git-commit
npx skills add walterra/agent-tools --skill post-mortem
npx skills add walterra/agent-tools --skill searxng-search

# Official Elastic file ingest skill (replacement for deprecated es-ingest)
npx skills add elastic/agent-skills --skill elasticsearch-file-ingest

# Install directly to pi from a subpath (one command)
npx skills add https://github.com/walterra/agent-tools/tree/main/packages/git-commit -a pi -g
npx skills add https://github.com/walterra/agent-tools/tree/main/packages/post-mortem -a pi -g
npx skills add https://github.com/walterra/agent-tools/tree/main/packages/searxng-search -a pi -g
npx skills add https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-file-ingest -a pi -g

# Using ai-agent-skills
npx ai-agent-skills install walterra/agent-tools

# Install to specific agents
npx skills add walterra/agent-tools --skill git-commit -a cursor -a claude-code
npx skills add walterra/agent-tools --skill post-mortem -a cursor -a claude-code
npx skills add walterra/agent-tools --skill searxng-search -a cursor -a claude-code
npx skills add elastic/agent-skills --skill elasticsearch-file-ingest -a cursor -a claude-code
```

Some skills require setup after installation (e.g. `npm install` for skills with dependencies).
`git-commit` and `post-mortem` are pure markdown and need no setup. For skills with dependencies in this repo:

```bash
cd ~/.cursor/skills/searxng-search && npm install
```

For Elastic's replacement ingest skill, follow setup instructions in:
https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-file-ingest

### Manual Installation

```bash
git clone https://github.com/walterra/agent-tools.git
cp -r agent-tools/packages/searxng-search ~/.cursor/skills/
cd ~/.cursor/skills/searxng-search && npm install
```

## Skill Directories by Agent

| Agent | Global Path |
|-------|-------------|
| **Cursor** | `~/.cursor/skills/` |
| **Claude Code** | `~/.claude/skills/` |
| **Codex** | `~/.codex/skills/` |
| **Pi** | `~/.pi/agent/skills/` |
| **Copilot** | `~/.copilot/skills/` |

## Package Naming Convention

| Package | Target | Distribution |
|---------|--------|--------------|
| `@walterra/pi-*` | pi-coding-agent | Published to npm |
| Skills | Cursor, Claude Code, Codex, Pi, etc. | GitHub only (not published to npm) |

## Development

```bash
# Install dependencies (also installs git hooks via Husky)
pnpm install

# Fast local fix
pnpm lint:fix

# Match CI quality gate locally (frozen lockfile + lint + build)
pnpm verify
```

Git hooks:
- `pre-commit`: runs `pnpm lint`
- `pre-push`: runs `pnpm verify`

## License

MIT
