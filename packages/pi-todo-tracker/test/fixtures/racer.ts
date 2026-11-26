// Child process for the takeover-race test: asks for the global server, reports its role, exits.
import { ensureServer } from '../../extensions/todo-tracker/server.ts';

const server = await ensureServer();
console.log(`${server.role} ${server.url}`);
await new Promise((resolve) => setTimeout(resolve, 1500));
if (server.role === 'leader') server.stop();
process.exit(0);
