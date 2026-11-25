#!/usr/bin/env node
// Generic MTAR packager for frontend-only (single-page-app) Web Client extensions.
// Run from an extension folder (cwd). Reads ID / version / provider / description
// from the extension's mta.yaml and zips packages/frontend/dist into
// mta_archives/<id>_<version>.mtar, ready for the SAP B1 Extension Manager.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const extDir = process.cwd();
const mtaPath = path.join(extDir, 'mta.yaml');
const frontendDist = path.join(extDir, 'packages/frontend/dist');
const outDir = path.join(extDir, 'mta_archives');

if (!fs.existsSync(mtaPath)) {
  console.error(`Error: ${mtaPath} not found. Run this from an extension folder.`);
  process.exit(1);
}
if (!fs.existsSync(frontendDist)) {
  console.error('Error: packages/frontend/dist does not exist. Run "npm run build" first.');
  process.exit(1);
}

const mta = fs.readFileSync(mtaPath, 'utf8');
const field = (key) => {
  const m = mta.match(new RegExp(`^${key}:\\s*"?([^"\\r\\n]*)"?\\s*$`, 'm'));
  if (!m) throw new Error(`mta.yaml is missing top-level "${key}"`);
  return m[1].trim();
};
const id = field('ID');
const version = field('version');
const provider = field('provider');
const description = field('description');

fs.rmSync(outDir, { recursive: true, force: true });
const staging = path.join(outDir, '.staging');
fs.mkdirSync(path.join(staging, 'META-INF'), { recursive: true });
fs.mkdirSync(path.join(staging, 'webclient'), { recursive: true });

execFileSync('zip', ['-r', '-q', path.join(staging, 'webclient/data.zip'), '.'], { cwd: frontendDist });

const mtad = `_schema-version: "3.2"
ID: ${id}
description: ${description}
version: ${version}
provider: ${provider}
modules:
- name: webclient
  type: single-page-app
  path: webclient
  parameters:
    deploy_mode: b1-webclient
`;
const manifest = [
  'manifest-Version: 1.0',
  'Created-By: SAP Application Archive Builder 1.2.53',
  '',
  'Name: webclient/data.zip',
  'MTA-Module: webclient',
  'Content-Type: application/zip',
  '',
  '',
  'Name: META-INF/mtad.yaml',
  'Content-Type: text/plain',
  '',
].join('\n');

fs.writeFileSync(path.join(staging, 'META-INF/mtad.yaml'), mtad, 'utf8');
fs.writeFileSync(path.join(staging, 'META-INF/MANIFEST.MF'), manifest, 'utf8');

const mtarPath = path.join(outDir, `${id}_${version}.mtar`);
execFileSync('zip', ['-r', '-q', mtarPath, 'META-INF', 'webclient'], { cwd: staging });
fs.rmSync(staging, { recursive: true, force: true });

console.log(`Ready: ${mtarPath}`);
