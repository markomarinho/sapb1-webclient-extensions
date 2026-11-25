# SAP Business One Web Client — Delivery Note to Invoice Extension

An on-premise **SAP Business One Web Client** extension that converts open **Delivery Notes (`ODLN`)** into **A/R Invoices (`OINV`)** via the SAP B1 Service Layer and automatically emails the invoice PDF to the customer.

> Part of the [SAP B1 Web Client Extensions monorepo](../../README.md). Run `npm install` once at the repository root; run the commands below from this folder (`extensions/delivery-to-invoice`), or from the root with `-w extensions/delivery-to-invoice`.

## Features

- **Manual & Scheduled Automation:** Run conversions on demand from the SAP Fiori Web Client UI, or enable the built-in background scheduler with configurable interval, customer eligibility (`U_AutoInvoice`), and minimum delivery age.
- **Flexible Grouping:** Create **one invoice per delivery note** (`PER_DELIVERY`) or **consolidate multiple open deliveries per customer** (`CONSOLIDATED_BY_CUSTOMER`) into a single A/R Invoice.
- **Native SAP B1 Base Document Linking:** Creates `/Invoices` referencing `BaseType: 15`, `BaseEntry`, and `BaseLine` so SAP B1 automatically links and closes the source delivery notes.
- **Crystal Reports PDF Export (SAP B1 API Gateway) & Built-in Fallback:** Exports your company's native SAP B1 Crystal Reports invoice layout via the API Gateway Reporting Service (`POST /login` -> `POST /rs/v1/ExportPDFData?DocCode=<DocCode>` with `DocKey@` & `ObjectId@=13`), or uses the built-in PDF generator for mock/offline environments.
- **Email Dispatch:** Sends the invoice PDF via SMTP (`nodemailer`) using customizable subject/body templates (`{{InvoiceDocNum}}`, `{{CardName}}`, `{{DeliveryRefs}}`, `{{DocTotal}}`, etc.), resolving recipient emails from BP UDF -> BP `EmailAddress` -> Contact Person email.
- **Idempotency & Email-Only Retry:** Tracks processed delivery notes in SQLite to prevent duplicate invoices. If invoice creation succeeds but SMTP fails (or the customer has no email), you can edit the address and retry sending the email without creating a duplicate invoice.

## Quick Start (Local Development / Mock Mode)

```bash
# 1. Install dependencies from repository root
npm install

# 2. Run automated tests
npm test -w extensions/delivery-to-invoice

# 3. Start Backend API (:4020) + SAP Fiori UI (:5174)
npm run dev -w extensions/delivery-to-invoice
```

Open `http://localhost:5174`. In mock mode (`B1_MODE=mock`, `EMAIL_MODE=mock`), 5 realistic open delivery notes are pre-loaded and sent emails can be inspected directly in the **Histórico & Emails** tab.

## Production Setup (On-Premise SAP B1 + Extension Manager)

1. **Configure `.env`:**
   Copy `.env.example` to `.env`, set `B1_MODE=live` and `EMAIL_MODE=smtp`, and fill in your Service Layer and SMTP settings.
2. **Start the Backend Container:**
   ```bash
   docker compose up -d --build
   ```
3. **Build `.mtar` Archive for SAP B1 Extension Manager:**
   ```bash
   npm run build:mtar -w extensions/delivery-to-invoice
   ```
   Upload `extensions/delivery-to-invoice/mta_archives/Delivery-To-Invoice_<version>.mtar` in **SAP Business One Extension Manager** (`https://<b1-server>:40000/ExtensionManager`) and assign it to your company database.
