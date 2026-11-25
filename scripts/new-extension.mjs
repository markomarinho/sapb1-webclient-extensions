#!/usr/bin/env node
// Scaffolds a new Web Client extension under extensions/<name>.
//
//   npm run new -- <name> [--title "Tile Title"] [--subtitle "Tile subtitle"] [--provider MARKO] [--icon sap-icon://...]
//
// Creates a frontend-only extension (React + UI5 Web Components, packaged as a
// single-page-app MTAR). Add packages/backend and packages/shared later if the
// extension needs its own API (see extensions/bank-reconciliation for an example).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && !isFlagValue(a));
function isFlagValue(a) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith('--');
}
function flag(key, fallback) {
  const i = args.indexOf(`--${key}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: npm run new -- <kebab-case-name> [--title "..."] [--subtitle "..."] [--provider ...] [--icon ...]');
  process.exit(1);
}

const extDir = path.join(rootDir, 'extensions', name);
if (fs.existsSync(extDir)) {
  console.error(`Error: extensions/${name} already exists.`);
  process.exit(1);
}

const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const humanTitle = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const title = flag('title', humanTitle);
const subtitle = flag('subtitle', '');
const provider = flag('provider', 'MARKO');
const icon = flag('icon', 'sap-icon://action');
const scope = `@b1-${name}`;

const files = {
  'package.json': json({
    name,
    version: '1.0.0',
    private: true,
    description: title,
    scripts: {
      dev: 'npm run dev --prefix packages/frontend',
      build: 'npm run build --prefix packages/frontend',
      'build:mtar': 'npm run build && node ../../scripts/build-mtar.mjs',
      typecheck: 'npm run typecheck --prefix packages/frontend',
    },
  }),

  'mta.yaml': `_schema-version: "3.2"
ID: ${pascal}
version: 1.0.0
description: "${title}"
provider: ${provider}

modules:
  - name: webclient
    type: single-page-app
    path: packages/frontend/dist
    parameters:
      deploy_mode: b1-webclient
`,

  'README.md': `# ${title}

SAP Business One Web Client extension.

## Development

\`\`\`bash
# from the repository root
npm install
npm run dev -w extensions/${name}       # http://localhost:5173
\`\`\`

## Packaging

\`\`\`bash
npm run build:mtar -w extensions/${name}
\`\`\`

Upload \`extensions/${name}/mta_archives/${pascal}_<version>.mtar\` in the
**SAP Business One Extension Manager** and assign it to your company database.
Bump \`version\` in \`mta.yaml\` (and \`package.json\`) before each new upload.

## Structure

| Path | Purpose |
| --- | --- |
| \`mta.yaml\` | MTA descriptor (ID, version, provider) |
| \`packages/frontend\` | React + UI5 Web Components SPA |
| \`packages/frontend/public/WebClientExtension.json\` | Launchpad tile definition |
`,

  'packages/frontend/package.json': json({
    name: `${scope}/frontend`,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --port 5173',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview --port 4173',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@ui5/webcomponents': '^2.7.0',
      '@ui5/webcomponents-fiori': '^2.7.0',
      '@ui5/webcomponents-icons': '^2.7.0',
      '@ui5/webcomponents-react': '^2.7.0',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
    },
    devDependencies: {
      '@types/react': '^18.3.18',
      '@types/react-dom': '^18.3.5',
      '@vitejs/plugin-react': '^4.3.4',
      vite: '^6.1.0',
    },
  }),

  'packages/frontend/tsconfig.json': json({
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
    },
    include: ['src'],
  }),

  'packages/frontend/vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so assets resolve inside the Web Client extension path
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@ui5/')) return 'ui5-vendor';
          if (id.includes('node_modules/react')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
});
`,

  'packages/frontend/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SAP Business One — ${title}</title>
    <script data-ui5-config type="application/json">
      { "defaultFontLoading": false }
    </script>
  </head>
  <body style="margin: 0; background-color: #f5f6f7; font-family: '72', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

  'packages/frontend/public/WebClientExtension.json': json({
    tiles: [
      {
        text: title,
        subtitle,
        icon,
        url: 'index.html',
        size: '1x1',
        enableTitleHeader: false,
      },
    ],
  }),

  'packages/frontend/src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { setDefaultFontLoading } from '@ui5/webcomponents-base/dist/config/Fonts.js';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import { ThemeProvider } from '@ui5/webcomponents-react';
import { App } from './App';

// Disable external CDN font loading to comply with the SAP B1 Web Client CSP (font-src 'self')
setDefaultFontLoading(false);

function detectSapWebClientTheme(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get('sap-ui-theme') || params.get('sap-theme');
    if (urlTheme) return urlTheme;

    const parentWin = window.parent as unknown as {
      sap?: { ui?: { getCore?: () => { getConfiguration?: () => { getTheme?: () => string } } } };
    };
    const parentTheme = parentWin?.sap?.ui?.getCore?.()?.getConfiguration?.()?.getTheme?.();
    if (parentTheme) return parentTheme;
  } catch {
    // Cross-origin or standalone fallback
  }
  return 'sap_horizon';
}

setTheme(detectSapWebClientTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
`,

  'packages/frontend/src/App.tsx': `import { Text, Title } from '@ui5/webcomponents-react';

export function App() {
  return (
    <div style={{ padding: '1rem 2rem' }}>
      <Title level="H2">${title}</Title>
      <Text>Your new SAP Business One Web Client extension is running.</Text>
    </div>
  );
}
`,
};

for (const [rel, content] of Object.entries(files)) {
  const full = path.join(extDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

console.log(`Created extensions/${name}

Next steps:
  npm install
  npm run dev -w extensions/${name}
  npm run build:mtar -w extensions/${name}
`);

function json(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}
