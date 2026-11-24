import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = process.cwd();
const frontendDist = path.join(rootDir, 'packages/frontend/dist');
const outDir = path.join(rootDir, 'mta_archives');
const cachedMbtBin =
  '/Users/marcomarinho/.npm/_npx/32f204a681b479b0/node_modules/mbt/unpacked_bin/mbt';

if (!fs.existsSync(frontendDist)) {
  console.error('Error: packages/frontend/dist does not exist. Run "npm run build" first.');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

if (fs.existsSync(cachedMbtBin)) {
  console.log('Building MTAR using official SAP Cloud MTA Build Tool (mbt v1.2.53)...');
  execFileSync(
    cachedMbtBin,
    ['build', '-t', outDir, '--mtar', 'pt-bank-reconciliation_1.0.1.mtar'],
    {
      cwd: rootDir,
      stdio: 'inherit',
    }
  );
} else {
  console.log('Building MTAR using zip archive builder...');
  const spaStaging = path.join(outDir, '.staging-spa');
  const spaMtarPath = path.join(outDir, 'pt-bank-reconciliation_1.0.1.mtar');
  fs.mkdirSync(path.join(spaStaging, 'META-INF'), { recursive: true });
  fs.mkdirSync(path.join(spaStaging, 'webclient'), { recursive: true });
  execFileSync('zip', ['-r', '-q', path.join(spaStaging, 'webclient/data.zip'), '.'], {
    cwd: frontendDist,
  });

  const mtadYaml = `_schema-version: "3.2"
ID: Bank-Reconciliation
description: Bank Reconciliation (SWIFT MT940 & Norma 43)
version: 1.0.1
provider: MARKO
modules:
- name: webclient
  type: single-page-app
  path: webclient
  parameters:
    deploy_mode: b1-webclient
`;
  const manifestMf = [
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

  fs.writeFileSync(path.join(spaStaging, 'META-INF/mtad.yaml'), mtadYaml, 'utf8');
  fs.writeFileSync(path.join(spaStaging, 'META-INF/MANIFEST.MF'), manifestMf, 'utf8');
  execFileSync('zip', ['-r', '-q', spaMtarPath, 'META-INF', 'webclient'], { cwd: spaStaging });
  fs.rmSync(spaStaging, { recursive: true, force: true });
}

// Keep a copy named pt-bank-reconciliation_1.0.0.mtar for convenience
fs.cpSync(
  path.join(outDir, 'pt-bank-reconciliation_1.0.1.mtar'),
  path.join(outDir, 'pt-bank-reconciliation_1.0.0.mtar')
);

console.log(`Ready: ${path.join(outDir, 'pt-bank-reconciliation_1.0.1.mtar')}`);
