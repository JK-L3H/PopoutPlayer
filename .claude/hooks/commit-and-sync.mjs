/**
 * Validate, then git add -A, commit with message, push (so Bash PostToolUse git hooks can run).
 * Usage: node .claude/hooks/commit-and-sync.mjs "feat: your message"
 * Run from repo root or any cwd — resolves paths from this file.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function runNode(script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0 && r.status != null) {
    process.exit(r.status);
  }
}

function runGit(args) {
  const r = spawnSync('git', args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0 && r.status != null) {
    process.exit(r.status);
  }
}

runNode(join(here, 'validate-extension.mjs'));

runGit(['add', '-A']);
const noStagedDiff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root });
if (noStagedDiff.status === 0) {
  console.log('Nothing to commit.');
  process.exit(0);
}

const msg = process.argv.slice(2).join(' ').trim() || 'chore: sync extension changes';
runGit(['commit', '-m', msg]);
runGit(['push']);
