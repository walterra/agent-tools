import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Points the extension at a fresh data root and an OS-assigned port. */
export const useTempHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'todo-tracker-test-'));
  process.env.PI_TRACKER_HOME = home;
  process.env.PI_TRACKER_PORT = '0';
  return home;
};

export const tempProjectDir = (name: string): string =>
  mkdtempSync(join(tmpdir(), `todo-tracker-${name}-`));

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
