/**
 * Post-edit sanity check for PopoutPlayer (manifest JSON + JS syntax).
 * Invoked from .claude/settings.json PostToolUse hooks; resolves paths from this file so cwd is optional.
 */
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
} catch (e) {
  console.error('manifest.json:', e.message);
  process.exit(1);
}

const jsFiles = ['content/content.js', 'background.js'];
for (let i = 0; i < jsFiles.length; i++) {
  const rel = jsFiles[i];
  const r = spawnSync(process.execPath, ['--check', join(root, rel)], { stdio: 'inherit' });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}
