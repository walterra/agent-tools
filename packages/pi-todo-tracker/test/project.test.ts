import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isValidProjectKey, projectKeyOf } from '../extensions/todo-tracker/paths.ts';
import { describeProject } from '../extensions/todo-tracker/project.ts';

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('project keys follow the session directory naming and reject traversal', () => {
  assert.equal(projectKeyOf('/Users/me/dev/repo'), '--Users-me-dev-repo--');
  assert.equal(isValidProjectKey('--Users-me-dev-repo--'), true);
  for (const bad of ['a/b', '--../x--', '--a/b--', 'plain', ''])
    assert.equal(isValidProjectKey(bad), false, bad);
});

test('worktrees group under their repository and report their branch', { skip: !hasGit }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'todo-tracker-git-')));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd,
      stdio: 'ignore',
    });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'worktree', 'add', '-q', join(root, 'wt'), '-b', 'feature');

  const main = describeProject(repo);
  const worktree = describeProject(join(root, 'wt'));
  assert.equal(main.repoRoot, repo);
  assert.equal(worktree.repoRoot, repo);
  assert.equal(worktree.repo, 'repo');
  assert.equal(worktree.branch, 'feature');
});

test('a directory outside git is its own group', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'todo-tracker-plain-')));
  const info = describeProject(dir);
  assert.equal(info.repoRoot, dir);
  assert.equal(info.branch, undefined);
});
