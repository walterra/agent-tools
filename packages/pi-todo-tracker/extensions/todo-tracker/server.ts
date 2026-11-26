/**
 * One global web server for all projects. The first pi process to ask becomes the leader
 * and records {pid, port} in ~/.pi/agent/tracker/server.json; later processes reuse that
 * URL. A recursive fs.watch on projects/ turns writes from any process into SSE events
 * ("<project key>/<tracker>"), so every open page stays current.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, type FSWatcher, mkdirSync, readFileSync, watch } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handleWebAction, parseWebAction } from './actions.ts';
import { PAGE } from './page.ts';
import { projectDirForKey, projectsRoot, serverLockPath } from './paths.ts';
import { listProjects, readProjectInfo } from './project.ts';
import { isValidName, readBindings, readTracker, writeJsonAtomic } from './store.ts';

export interface RunningServer {
  url: string;
  role: 'leader' | 'follower';
  stop: () => void;
}

interface Lock {
  pid: number;
  port: number;
}

/** Stable default so the bookmarked URL survives restarts; a random port is the fallback. */
const DEFAULT_PORT = 7331;
const MAX_BODY_BYTES = 16 * 1024;

const readLock = (): Lock | undefined => {
  try {
    return JSON.parse(readFileSync(serverLockPath(), 'utf8')) as Lock;
  } catch {
    return undefined;
  }
};

/** True when a server ran before and none is alive now, so a bound session should restart it. */
export const isServerWanted = (): boolean => {
  const lock = readLock();
  return lock !== undefined && lock.port > 0;
};

const ping = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ping`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** Resolves to the body text, or undefined when it is too large or the request fails. */
const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(undefined));
  });

const listen = (server: Server, port: number): Promise<'ok' | 'in-use'> =>
  new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') return resolve('in-use');
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => resolve('ok'));
  });

const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

/** Resolves a project key and tracker name from the URL to a directory; undefined if either is invalid or missing. */
const resolveTracker = (key: string, name: string): { dir: string } | undefined => {
  const dir = projectDirForKey(key);
  if (!dir || !isValidName(name) || !existsSync(dir)) return undefined;
  return readTracker(dir, name) ? { dir } : undefined;
};

const startLeader = async (preferredPort: number): Promise<RunningServer> => {
  const clients = new Set<ServerResponse>();
  const timers = new Map<string, NodeJS.Timeout>();
  // Per-start secret embedded in the served page; required for every state change.
  const token = randomBytes(16).toString('hex');

  const handlePost = async (
    req: IncomingMessage,
    res: ServerResponse,
    key: string,
    name: string
  ): Promise<void> => {
    const origin = req.headers.origin;
    if (origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
      return sendJson(res, { error: 'bad origin' }, 403);
    if (req.headers['x-tracker-token'] !== token)
      return sendJson(res, { error: 'bad token; reload the page' }, 403);
    const target = resolveTracker(key, name);
    if (!target) return sendJson(res, { error: 'not found' }, 404);
    const raw = await readBody(req);
    if (raw === undefined) {
      // Answer first, then drop the connection so the rest of the upload is not read.
      res.setHeader('connection', 'close');
      res.on('finish', () => req.destroy());
      return sendJson(res, { error: 'body too large' }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return sendJson(res, { error: 'invalid json' }, 400);
    }
    const action = parseWebAction(body);
    if (typeof action === 'string') return sendJson(res, { error: action }, 400);
    const error = handleWebAction(target.dir, name, action);
    if (error) return sendJson(res, { error }, 400);
    return sendJson(res, { ok: true });
  };

  const server = createServer((req, res) => {
    // Rejects DNS-rebinding: only 127.0.0.1 / localhost Host headers are served.
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')) {
      res.writeHead(403).end();
      return;
    }
    const url = req.url ?? '/';
    const post = /^\/api\/p\/([^/]+)\/tracker\/([^/]+)\/op$/.exec(url);
    if (req.method === 'POST' && post) {
      void handlePost(req, res, decodeURIComponent(post[1]), decodeURIComponent(post[2]));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (url === '/ping') {
      res.writeHead(200).end('ok');
      return;
    }
    if (url === '/api/projects') {
      sendJson(res, listProjects());
      return;
    }
    const detail = /^\/api\/p\/([^/]+)\/tracker\/([^/]+)$/.exec(url);
    if (detail) {
      const key = decodeURIComponent(detail[1]);
      const name = decodeURIComponent(detail[2]);
      const target = resolveTracker(key, name);
      const tracker = target && readTracker(target.dir, name);
      if (!target || !tracker) return sendJson(res, { error: 'not found' }, 404);
      const sessions = readBindings(target.dir)
        .filter((binding) => binding.tracker === name)
        .map((binding) => binding.label);
      return sendJson(res, { name, key, tracker, sessions, project: readProjectInfo(target.dir) });
    }
    if (url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url === '/' || /^\/p\/[^/]+\/t\/[^/]+$/.test(url)) {
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE.replace('__TOKEN__', token));
      return;
    }
    res.writeHead(404).end();
  });

  const broadcast = (event: string): void => {
    for (const client of clients) client.write(`data: ${event}\n\n`);
  };

  const status = await listen(server, preferredPort);
  if (status === 'in-use') {
    // Binding the port is the real mutual exclusion: if a leader answers there, join it. Falling
    // back to a random port here would let the loser of a takeover race win the lock file.
    if (await ping(preferredPort)) {
      server.close();
      return { url: `http://127.0.0.1:${preferredPort}`, role: 'follower', stop: () => undefined };
    }
    await listen(server, 0);
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  writeJsonAtomic(serverLockPath(), { pid: process.pid, port } satisfies Lock);
  const winner = readLock();
  if (winner && winner.pid !== process.pid && (await ping(winner.port))) {
    server.close();
    return { url: `http://127.0.0.1:${winner.port}`, role: 'follower', stop: () => undefined };
  }

  mkdirSync(projectsRoot(), { recursive: true });
  const watcher: FSWatcher = watch(
    projectsRoot(),
    { persistent: false, recursive: true },
    (_event, filename) => {
      const parts = (filename ?? '').split(/[\\/]/);
      if (parts.length !== 2 || !parts[1].endsWith('.json')) return;
      const [key, file] = parts;
      // Dot files (.bindings.json, .project.json) affect the index only; "*" redraws the project.
      const event = `${key}/${file.startsWith('.') ? '*' : file.slice(0, -'.json'.length)}`;
      clearTimeout(timers.get(event));
      timers.set(
        event,
        setTimeout(() => {
          timers.delete(event);
          broadcast(event);
        }, 60)
      );
    }
  );
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n');
  }, 20_000);
  heartbeat.unref();
  server.unref();

  return {
    url: `http://127.0.0.1:${port}`,
    role: 'leader',
    stop: () => {
      clearInterval(heartbeat);
      for (const timer of timers.values()) clearTimeout(timer);
      watcher.close();
      for (const client of clients) client.end();
      server.close();
      // pid 0 with the port kept: no live server, but one was wanted and this is its port.
      if (readLock()?.pid === process.pid)
        writeJsonAtomic(serverLockPath(), { pid: 0, port } satisfies Lock);
    },
  };
};

/** Returns the running global server, starting one in this process if none answers. */
export const ensureServer = async (): Promise<RunningServer> => {
  const lock = readLock();
  if (lock && lock.port > 0 && lock.pid !== process.pid && (await ping(lock.port))) {
    return { url: `http://127.0.0.1:${lock.port}`, role: 'follower', stop: () => undefined };
  }
  const preferred =
    lock && lock.port > 0 ? lock.port : Number(process.env.PI_TRACKER_PORT ?? DEFAULT_PORT);
  return startLeader(preferred);
};
