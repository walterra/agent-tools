import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claimPendingEvents } from '../extensions/todo-tracker/inbox.ts';
import { isValidProjectKey, projectDirOf, projectKeyOf } from '../extensions/todo-tracker/paths.ts';
import { registerProject } from '../extensions/todo-tracker/project.ts';
import {
  ensureServer,
  isServerWanted,
  type RunningServer,
} from '../extensions/todo-tracker/server.ts';
import {
  applyOp,
  bindSession,
  emptyTracker,
  mutateTracker,
  readTracker,
  saveTracker,
} from '../extensions/todo-tracker/store.ts';
import { sleep, tempProjectDir, useTempHome } from './helpers.ts';

let server: RunningServer;
let port: number;
let token: string;
const projectA = tempProjectDir('a');
const projectB = tempProjectDir('b');
const keyA = encodeURIComponent(projectKeyOf(projectA));
const keyB = encodeURIComponent(projectKeyOf(projectB));

const get = async (path: string) => {
  const response = await fetch(`${server.url}${path}`);
  return { status: response.status, text: await response.text() };
};

const post = (
  path: string,
  body: unknown,
  options: { token?: string; origin?: string; host?: string; raw?: string } = {}
) =>
  new Promise<number>((resolve) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-tracker-token': options.token ?? token,
    };
    if (options.origin) headers.origin = options.origin;
    if (options.host) headers.host = options.host;
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.end(options.raw ?? JSON.stringify(body));
  });

before(async () => {
  useTempHome();
  for (const cwd of [projectA, projectB]) {
    registerProject(cwd);
    saveTracker(projectDirOf(cwd), 'main', emptyTracker());
    mutateTracker(projectDirOf(cwd), 'main', (t) =>
      applyOp(t, { op: 'add', text: `item in ${cwd}` })
    );
  }
  bindSession(projectDirOf(projectA), {
    sessionId: 's1',
    tracker: 'main',
    label: 'sess-A',
    pid: process.pid,
    at: 1,
  });
  server = await ensureServer();
  port = Number(server.url.split(':').pop());
  token = /var TOKEN="([0-9a-f]+)"/.exec((await get('/')).text)?.[1] ?? '';
});

after(() => server.stop());

test('serves one page and a per-start token', async () => {
  assert.equal(token.length, 32);
  assert.equal((await get(`/p/${keyA}/t/main`)).status, 200);
  assert.equal((await get('/nope')).status, 404);
});

test('lists projects with live sessions; same tracker name stays isolated', async () => {
  const projects = JSON.parse((await get('/api/projects')).text) as {
    cwd: string;
    live: boolean;
  }[];
  assert.equal(projects.find((p) => p.cwd === projectA)?.live, true);
  assert.equal(projects.find((p) => p.cwd === projectB)?.live, false);
  const a = JSON.parse((await get(`/api/p/${keyA}/tracker/main`)).text);
  const b = JSON.parse((await get(`/api/p/${keyB}/tracker/main`)).text);
  assert.match(a.tracker.items[0].text, new RegExp(projectA));
  assert.match(b.tracker.items[0].text, new RegExp(projectB));
  assert.deepEqual(a.sessions, ['sess-A']);
});

test('invalid project keys and tracker names are never resolved', async () => {
  assert.equal(isValidProjectKey(decodeURIComponent('..%2F..%2Fetc')), false);
  for (const path of [
    '/api/p/..%2F..%2Fetc/tracker/x',
    '/api/p/--..--/tracker/x',
    `/api/p/${keyA}/tracker/..%2Fx`,
    `/api/p/${keyA}/tracker/missing`,
  ]) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('POST needs the token, a local origin and host, valid JSON, and a small body', async () => {
  const path = `/api/p/${keyA}/tracker/main/op`;
  const action = { kind: 'comment', id: 1, text: 'hi' };
  assert.equal(await post(path, action, { token: 'wrong' }), 403);
  assert.equal(await post(path, action, { origin: 'http://evil.example' }), 403);
  assert.equal(await post(path, action, { host: 'evil.example' }), 403);
  assert.equal(await post(path, null, { raw: '{nope' }), 400);
  assert.equal(await post(path, { kind: 'delete', id: 1 }), 400);
  assert.equal(
    await post(path, null, { raw: JSON.stringify({ kind: 'add', text: 'y'.repeat(20_000) }) }),
    413
  );
  assert.equal(await post(`/api/p/${keyA}/tracker/missing/op`, action), 404);
  assert.deepEqual(
    readTracker(projectDirOf(projectA), 'main')?.items[0].notes,
    [],
    'rejected requests change nothing'
  );
});

test('a POST changes only its own project and queues an inbox event', async () => {
  assert.equal(
    await post(`/api/p/${keyA}/tracker/main/op`, { kind: 'comment', id: 1, text: 'hi A' }),
    200
  );
  assert.deepEqual(readTracker(projectDirOf(projectA), 'main')?.items[0].notes, ['[user] hi A']);
  assert.deepEqual(readTracker(projectDirOf(projectB), 'main')?.items[0].notes, []);
  assert.equal(claimPendingEvents(projectDirOf(projectA), 'main').length, 1);
  assert.equal(claimPendingEvents(projectDirOf(projectB), 'main').length, 0);
});

test('writes from any process reach SSE clients as <project key>/<tracker>', async () => {
  const events: string[] = [];
  const controller = new AbortController();
  const response = await fetch(`${server.url}/events`, { signal: controller.signal });
  const reader = response.body?.getReader();
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        events.push(new TextDecoder().decode(chunk.value));
      }
    } catch {
      // aborted below
    }
  })();
  await sleep(200);
  mutateTracker(projectDirOf(projectB), 'main', (t) =>
    applyOp(t, { op: 'add', text: 'external write' })
  );
  await sleep(400);
  controller.abort();
  assert.ok(events.join('').includes(`data: ${decodeURIComponent(keyB)}/main`), events.join('|'));
});

test('concurrent processes elect one leader and share one URL', async () => {
  const racer = fileURLToPath(new URL('./fixtures/racer.ts', import.meta.url));
  // The test's own server already holds the lock; stop it so the racers compete for the port.
  server.stop();
  const env = { ...process.env, PI_TRACKER_PORT: '47911' };
  const outputs = await Promise.all(
    Array.from(
      { length: 5 },
      () =>
        new Promise<string>((resolve) =>
          execFile(
            'node',
            ['--experimental-strip-types', racer],
            { env, encoding: 'utf8' },
            (_error, stdout) => resolve(stdout.trim())
          )
        )
    )
  );
  assert.equal(outputs.filter((line) => line.startsWith('leader ')).length, 1, outputs.join('\n'));
  assert.equal(new Set(outputs.map((line) => line.split(' ')[1])).size, 1, outputs.join('\n'));
  assert.equal(isServerWanted(), true, 'the lock keeps the port after a clean stop');
});
