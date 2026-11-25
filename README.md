# SAP Business One Web Client Extensions

A monorepo of on-premise **SAP Business One (SAP HANA) Web Client** extensions. Each extension is self-contained under [`extensions/`](extensions/), has its own MTA descriptor and version, and is packaged separately as an `.mtar` for the **SAP B1 Extension Manager**. All extensions share one npm workspace, toolchain and lockfile.

## Extensions

| Extension | Description | Type |
| --- | --- | --- |
| [bank-reconciliation](extensions/bank-reconciliation/README.md) | SWIFT MT940 & Norma 43 statement import, HANA-backed match suggestions, Service Layer reconciliation | SPA + Node backend |
| [delivery-to-invoice](extensions/delivery-to-invoice/README.md) | Automatic & manual Delivery Note (`ODLN`) to A/R Invoice (`OINV`) conversion with PDF generation and customer email dispatch | SPA + Node backend |

> Run `npm run list` to print every extension with its version.

## Repository layout

```
.
├── package.json              # npm workspaces root + cross-extension scripts
├── tsconfig.base.json        # shared TypeScript compiler settings
├── scripts/
│   ├── ext.mjs               # run an npm script across one/all extensions
│   ├── new-extension.mjs     # scaffold a new extension
│   └── build-mtar.mjs        # generic SPA → .mtar packager
└── extensions/
    └── <extension-name>/
        ├── package.json      # extension scripts: dev, build, build:mtar, test, typecheck
        ├── mta.yaml          # MTA ID, version, provider
        ├── README.md         # extension docs
        └── packages/
            ├── frontend/     # React + UI5 Web Components SPA (required)
            ├── backend/      # optional Node API
            └── shared/       # optional types/logic shared by frontend and backend
```

Workspaces are `extensions/*` (one per extension) and `extensions/*/packages/*` (its packages). Package names are scoped per extension (e.g. `@b1-recon/backend`) so they don't clash.

## Prerequisites

- Node.js 22+ and npm 10+
- `zip` on the `PATH` (used for `.mtar` packaging)
- Docker (only for extensions with a backend)

## Common commands

Run these from the repository root.

```bash
npm install                                   # install all extensions

# All extensions
npm run build
npm run test
npm run typecheck
npm run build:mtar

# One extension (by folder)
npm run dev        -w extensions/bank-reconciliation
npm run test       -w extensions/bank-reconciliation
npm run build:mtar -w extensions/bank-reconciliation

# Or run a script on selected extensions only
node scripts/ext.mjs build bank-reconciliation
```

Extensions that don't define a given script are skipped.

## Creating a new extension

```bash
npm run new -- my-extension --title "My Extension" --subtitle "Short tile text" --icon sap-icon://action
npm install
npm run dev -w extensions/my-extension          # http://localhost:5173
```

This creates `extensions/my-extension/` with:

- a React + UI5 frontend (theme detection, CSP-safe fonts) set up like the existing extensions
- `public/WebClientExtension.json` with the launchpad tile
- `mta.yaml` (`ID` defaults to the PascalCase name, `provider` to `MARKO`; override with `--provider`)
- `build:mtar`, which uses [`scripts/build-mtar.mjs`](scripts/build-mtar.mjs) to write `mta_archives/<ID>_<version>.mtar`

Then add a row for it to the [Extensions](#extensions) table above.

**Need a backend?** Add `packages/backend` (and `packages/shared` if needed) inside the extension, give them a scope like `@b1-<name>/…`, and extend the extension's `package.json` scripts. Use [bank-reconciliation](extensions/bank-reconciliation/) as the reference (Fastify API, Dockerfile, docker-compose).

## Conventions

- **Self-contained:** everything specific to an extension (config, `.env`, samples, SQL, Docker files) lives in its own folder. Don't import code from another extension. If code needs to be shared, promote it to a top-level package first.
- **Versioning:** bump `version` in the extension's `mta.yaml` and `package.json` before each upload. Extension Manager rejects re-uploads of the same version.
- **Secrets:** each extension keeps its own `.env` (ignored by git) next to an `.env.example`.
- **Deployment:** upload `extensions/<name>/mta_archives/*.mtar` at `https://<b1-server>:40000/ExtensionManager` and assign it to the company database.
