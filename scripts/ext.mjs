#!/usr/bin/env node
// Runs an npm script in every extension under extensions/ (or only the ones named).
//
//   node scripts/ext.mjs --list
//   node scripts/ext.mjs <script> [extension ...]
//
// Extensions that don't define the script are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = path.join(rootDir, 'extensions');

function listExtensions() {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(extensionsDir, d.name, 'package.json')))
    .map((d) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(extensionsDir, d.name, 'package.json'), 'utf8'));
      return { dir: d.name, pkg };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

const [script, ...only] = process.argv.slice(2);
const extensions = listExtensions();

if (!script || script === '--list') {
  for (const { dir, pkg } of extensions) {
    console.log(`${dir.padEnd(28)} v${pkg.version ?? '?'}  ${pkg.description ?? ''}`);
  }
  process.exit(0);
}

const unknown = only.filter((name) => !extensions.some((e) => e.dir === name));
if (unknown.length) {
  console.error(`Unknown extension(s): ${unknown.join(', ')}`);
  process.exit(1);
}

const targets = extensions.filter((e) => only.length === 0 || only.includes(e.dir));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const { dir, pkg } of targets) {
  if (!pkg.scripts?.[script]) {
    console.log(`- ${dir}: no "${script}" script, skipping`);
    continue;
  }
  console.log(`\n▶ ${dir}: npm run ${script}`);
  const res = spawnSync(npm, ['run', script], {
    cwd: path.join(extensionsDir, dir),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`✖ ${dir}: "${script}" failed`);
    process.exit(res.status ?? 1);
  }
}
