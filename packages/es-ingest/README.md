# ES Ingest - Agent Skill

> [!WARNING]
> **Deprecated:** This skill is no longer maintained in this repository.
> Use the official Elastic skill instead: **[`elasticsearch-file-ingest`](https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-file-ingest)** in [`elastic/agent-skills`](https://github.com/elastic/agent-skills).

Stream-based ingestion and transformation of large data files into Elasticsearch. Built on [node-es-transformer](https://github.com/walterra/node-es-transformer).

## Quick Start

### Install

```bash
# Install the official replacement skill
npx skills add elastic/agent-skills --skill elasticsearch-file-ingest

# Or browse/copy manually from
# https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-file-ingest
```

### Legacy Install (deprecated)

```bash
# Legacy copy from this repo (not maintained)
git clone https://github.com/walterra/agent-tools.git
cp -r agent-tools/packages/es-ingest ~/.cursor/skills/
cd ~/.cursor/skills/es-ingest && npm install
```

### Basic Usage

```bash
# Ingest a JSON file
~/.cursor/skills/es-ingest/scripts/ingest.js --file data.json --target my-index

# Ingest a CSV file
~/.cursor/skills/es-ingest/scripts/ingest.js --file data.csv --source-format csv --target my-index

# Ingest a Parquet file
~/.cursor/skills/es-ingest/scripts/ingest.js --file data.parquet --source-format parquet --target my-index

# Ingest an Arrow IPC file
~/.cursor/skills/es-ingest/scripts/ingest.js --file data.arrow --source-format arrow --target my-index

# Reindex with transformation
~/.cursor/skills/es-ingest/scripts/ingest.js \
  --source-index old-logs \
  --target new-logs \
  --transform transform.js

# Cross-version migration (ES 8.x → 9.x)
~/.cursor/skills/es-ingest/scripts/ingest.js \
  --source-index logs \
  --node https://es8.example.com:9200 --api-key $ES8_KEY \
  --target new-logs \
  --target-node https://es9.example.com:9200 --target-api-key $ES9_KEY
```

## Features

- ✅ Handle large files (20-30 GB) without memory issues
- ✅ High throughput (up to 20k docs/second)
- ✅ Cross-version migration (ES 8.x ↔ 9.x)
- ✅ NDJSON + CSV + Parquet + Arrow IPC support (node-es-transformer >= 1.2.0)
- ✅ Custom JavaScript transformations
- ✅ Document filtering and splitting
- ✅ Wildcard file patterns
- ✅ Stream-based processing

## Documentation

See [SKILL.md](./SKILL.md) for complete documentation, examples, and troubleshooting.

## Examples

### Ingest with Custom Mappings

```bash
cat > mappings.json << 'EOF'
{
  "properties": {
    "@timestamp": { "type": "date" },
    "user": { "type": "keyword" },
    "message": { "type": "text" }
  }
}
EOF

./scripts/ingest.js --file logs.json --target logs --mappings mappings.json
```

### Infer mappings/pipeline (CSV)

```bash
./scripts/ingest.js --file users.csv --source-format csv --infer-mappings --target users
```

### Transform During Ingestion

```bash
cat > transform.js << 'EOF'
export default function transform(doc) {
  return {
    ...doc,
    full_name: `${doc.first_name} ${doc.last_name}`,
    processed_at: new Date().toISOString(),
  };
}
EOF

./scripts/ingest.js --file users.json --target users --transform transform.js
```

### Filter and Reindex

```bash
cat > filter.json << 'EOF'
{
  "range": {
    "@timestamp": {
      "gte": "2024-01-01"
    }
  }
}
EOF

./scripts/ingest.js \
  --source-index all-logs \
  --target recent-logs \
  --query filter.json
```

## Agent Directories

| Agent | Install Path |
|-------|--------------|
| Cursor | `~/.cursor/skills/es-ingest` |
| Claude Code | `~/.claude/skills/es-ingest` |
| Codex | `~/.codex/skills/es-ingest` |
| Pi | `~/.pi/agent/skills/es-ingest` |
| Copilot | `~/.copilot/skills/es-ingest` |

## Migration Guide

If you currently use `es-ingest` from this repository:

1. Install the official replacement:
   `npx skills add elastic/agent-skills --skill elasticsearch-file-ingest`
2. Update any internal docs/scripts that reference `packages/es-ingest`.
3. Prefer the Elastic-maintained skill for future updates and fixes.

## Requirements

- Node.js 22+
- Elasticsearch 8.x or 9.x
- node-es-transformer >= 1.2.0 for CSV/Parquet/Arrow support

## License

MIT
