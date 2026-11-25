# SAP Business One Web Client — Bank Reconciliation Extension (MT940 & Norma 43)

An on-premise **SAP Business One (SAP HANA) Web Client** extension for **SWIFT MT940** and **Norma 43 (AEB Cuaderno 43)** bank statement ingestion, HANA-accelerated match suggestions, and one-click Service Layer reconciliation.

## Architecture & Security Highlights

* **100% Internal / Air-Gapped On-Premise:** Zero third-party cloud or internet traffic required.
* **Generic Banking Standards:** Supports any bank exporting standard **SWIFT MT940** (`.mt940`, `.sta`, `.940`) or **Norma 43 / AEB Cuaderno 43** (`.n43`, `.c43`, `.aeb`, `.txt`) statements.
* **Direct Read-Only SAP HANA (`@sap/hana-client`):** Sub-10ms `SELECT` queries using a dedicated restricted HANA user (`B1_RECON_RO`) created via `sql/01_create_hana_readonly_user.sql` (physically incapable of `INSERT`/`UPDATE`/`DELETE`).
* **Strict SAP B1 Service Layer Writes:** All postings (`IncomingPayments`, `VendorPayments`, `BankPages`, and `ExternalReconciliationsService_Reconcile`) run through the official Service Layer with resumable crash recovery.
* **Native SAP Fiori Horizon UI:** Built with React + `@ui5/webcomponents-react` (`sap_horizon` theme) to blend seamlessly inside the SAP B1 10.0 Web Client.
* **Mathematical Balance & Idempotency Verification:** Verifies `Opening + Credits - Debits == Closing` (and Norma 43 Record `33` control totals) and deduplicates overlapping statements automatically.

---

## Quick Start (Local Development / Mock SAP HANA Mode)

> Part of the [SAP B1 Web Client Extensions monorepo](../../README.md). Run `npm install` once at the repository root; run the commands below from this folder (`extensions/bank-reconciliation`), or from the root with `-w extensions/bank-reconciliation`.

```bash
# 1. Install dependencies
npm install

# 2. Run automated test suite (MT940, Norma 43, Vault, Matching Engine, Crash Recovery)
npm test

# 3. Launch Backend API (:4010) + SAP Fiori Web Client UI (:5173)
npm run dev
```

Open `http://localhost:5173` and click **"Carregar Exemplos (MT940 + Norma 43)"** (or drag-and-drop `samples/statement_2026_11.mt940` and `samples/statement_2026_11.n43`).

---

## Production Setup (On-Premise SAP HANA + SAP B1 Extension Manager)

1. **Create Restricted Read-Only HANA User:**
   Inspect and run `sql/01_create_hana_readonly_user.sql` in SAP HANA Studio / HANA Cockpit (replacing `"SBO_COMPANY_PT"` with your company schema).
2. **Configure `.env`:**
   Copy `.env.example` to `.env`, set `B1_MODE=live`, and fill in your internal `HANA_HOST`, `HANA_SCHEMA`, `HANA_READONLY_USER`, and `B1_SERVICE_LAYER_URL`.
3. **Start the Internal Backend Container:**
   ```bash
   docker compose up -d --build
   ```
4. **Build `.mtar` Archive for SAP B1 Extension Manager:**
   ```bash
   npm run build:mtar
   ```
   Upload `extensions/bank-reconciliation/mta_archives/pt-bank-reconciliation_1.0.1.mtar` in **SAP Business One Extension Manager** (`https://<b1-server>:40000/ExtensionManager`) and assign it to your company database.
