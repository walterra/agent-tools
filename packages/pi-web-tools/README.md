# @walterra/pi-web-tools

Web research extension for [pi coding agent](https://github.com/badlogic/pi-mono) providing:

- `web_search`: paid Kagi Search API
- `web_fetch`: Jina Reader Markdown extraction

## Compatibility

- Tested with `pi` **0.84.3** (`@earendil-works/pi-coding-agent`)

## Configuration

Set credentials before starting Pi:

```bash
export KAGI_API_KEY='...'

# Optional; defaults to hosted Jina Reader
export JINA_READER_URL='https://r.jina.ai'

# Optional for authenticated/higher-limit hosted Jina usage
export JINA_API_KEY='...'
```

For a self-hosted Reader, set `JINA_READER_URL` to its private endpoint. The current `web_fetch` URL policy only accepts source URLs on ports 80 and 443; this does not restrict the Reader endpoint itself.

Never commit API keys or place them in tool arguments.

## Installation

```bash
pi install npm:@walterra/pi-web-tools
```

For local development from this repository:

```bash
pi -e ./packages/pi-web-tools/extensions/web-tools/index.ts
```

Environment changes require restarting Pi because `/reload` does not change the parent process environment.

## Behavior

### `web_search`

- Returns 5 results by default, maximum 10.
- Makes one Kagi API request per uncached invocation.
- Uses a 15-minute in-memory cache.
- Never paginates automatically.
- Set `noCache: true` only when freshness requires another paid request.

### `web_fetch`

- Uses `https://r.jina.ai` by default.
- Returns frontmatter plus Markdown.
- Uses a one-hour in-memory cache.
- Supports Reader `auto`, `curl`, and `browser` engines.
- Rejects credentials, non-HTTP protocols, unusual source ports, and source hostnames resolving to private/reserved addresses.
- Marks retrieved text as untrusted external content.
- Truncates output to Pi's tool-output limits.

## Verification

Check that the extension loads:

```bash
pi --no-extensions -e ./extensions/web-tools/index.ts --list-models >/dev/null
```
