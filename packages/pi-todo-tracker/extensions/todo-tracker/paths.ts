/**
 * Where tracker data lives: ~/.pi/agent/tracker/projects/<project key>/, outside any repo.
 * The project key follows the session directory naming (path separators become "-").
 * PI_TRACKER_HOME overrides the root, for tests.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const trackerRoot = (): string =>
  process.env.PI_TRACKER_HOME ?? join(homedir(), '.pi', 'agent', 'tracker');

export const projectsRoot = (): string => join(trackerRoot(), 'projects');

export const serverLockPath = (): string => join(trackerRoot(), 'server.json');

export const projectKeyOf = (cwd: string): string =>
  `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;

/** Rejects anything that could escape projects/ when used as a directory name. */
export const isValidProjectKey = (key: string): boolean =>
  /^--[^/\\\0]{1,400}--$/.test(key) && !key.includes('..');

export const projectDirOf = (cwd: string): string => join(projectsRoot(), projectKeyOf(cwd));

export const projectDirForKey = (key: string): string | undefined =>
  isValidProjectKey(key) ? join(projectsRoot(), key) : undefined;
