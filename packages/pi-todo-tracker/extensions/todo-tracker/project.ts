/** Project metadata for the index page: which repo, worktree and branch a tracker directory belongs to. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { projectDirOf, projectsRoot } from './paths.ts';
import { listTrackers, readBindings, type TrackerSummary, writeJsonAtomic } from './store.ts';

export interface ProjectInfo {
  cwd: string;
  /** Directory that groups worktrees of one repository; equals cwd outside git. */
  repoRoot: string;
  repo: string;
  branch?: string;
  lastSeen: number;
}

export interface ProjectListing extends ProjectInfo {
  key: string;
  live: boolean;
  cwdExists: boolean;
  trackers: TrackerSummary[];
}

const git = (cwd: string, args: string[]): string | undefined => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};

export const describeProject = (cwd: string): ProjectInfo => {
  const commonDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const repoRoot =
    commonDir && basename(commonDir) === '.git' ? dirname(commonDir) : (commonDir ?? cwd);
  return {
    cwd,
    repoRoot,
    repo: basename(repoRoot),
    branch: git(cwd, ['branch', '--show-current']) || undefined,
    lastSeen: Date.now(),
  };
};

/** Writes project.json so the global index can group and label this directory. */
export const registerProject = (cwd: string): void => {
  writeJsonAtomic(join(projectDirOf(cwd), '.project.json'), describeProject(cwd));
};

export const readProjectInfo = (dir: string): ProjectInfo | undefined => {
  try {
    return JSON.parse(readFileSync(join(dir, '.project.json'), 'utf8')) as ProjectInfo;
  } catch {
    return undefined;
  }
};

export const listProjects = (): ProjectListing[] => {
  let keys: string[] = [];
  try {
    keys = readdirSync(projectsRoot());
  } catch {
    return [];
  }
  return keys.flatMap((key) => {
    const dir = join(projectsRoot(), key);
    const info = readProjectInfo(dir);
    if (!info) return [];
    return [
      {
        ...info,
        key,
        live: readBindings(dir).length > 0,
        cwdExists: existsSync(info.cwd),
        trackers: listTrackers(dir),
      },
    ];
  });
};
