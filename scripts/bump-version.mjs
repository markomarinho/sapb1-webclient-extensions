#!/usr/bin/env node
// Bumps the patch version of the given extensions (mta.yaml + package.json).
//   node scripts/bump-version.mjs <extension> [extension ...]
// Prints "<extension> <old> -> <new>" per extension.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = process.argv.slice(2);
if (!names.length) {
  console.error('Usage: bump-version.mjs <extension> [extension ...]');
  process.exit(1);
}

for (const name of names) {
  const dir = path.join(rootDir, 'extensions', name);
  const mtaPath = path.join(dir, 'mta.yaml');
  const pkgPath = path.join(dir, 'package.json');
  const mta = fs.readFileSync(mtaPath, 'utf8');
  const m = mta.match(/^version:\s*"?(\d+)\.(\d+)\.(\d+)"?\s*$/m);
  if (!m) throw new Error(`${name}: no x.y.z "version" in mta.yaml`);
  const oldV = `${m[1]}.${m[2]}.${m[3]}`;
  const newV = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  fs.writeFileSync(mtaPath, mta.replace(/^version:.*$/m, `version: ${newV}`));
  const pkg = fs.readFileSync(pkgPath, 'utf8');
  fs.writeFileSync(pkgPath, pkg.replace(/("version":\s*")[^"]+(")/, `$1${newV}$2`));
  console.log(`${name} ${oldV} -> ${newV}`);
}
