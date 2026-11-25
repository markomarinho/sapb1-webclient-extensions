-- ============================================================================
-- SAP Business One on SAP HANA — Least-Privilege Read-Only User Setup
-- ============================================================================
-- PURPOSE:
-- Creates a restricted database user (B1_RECON_RO) for the Bank Reconciliation
-- matching engine. Following SAP Business One certification & support rules:
--   1. This user has ZERO write privileges (cannot INSERT, UPDATE, DELETE, DROP, or ALTER).
--   2. All writes (IncomingPayments, VendorPayments, BankPages, Reconciliations)
--      are executed strictly through the SAP Business One Service Layer.
--
-- INSTRUCTIONS:
-- Replace "SBO_COMPANY_PT" with your actual SAP B1 company schema name and
-- replace the password before running as SYSTEM or a user with USER ADMIN.
-- ============================================================================

CREATE RESTRICTED USER B1_RECON_RO PASSWORD "ChangeMe_StrongReadOnlyPassword_2026!" NO FORCE_FIRST_PASSWORD_CHANGE;

-- Allow JDBC / ODBC / @sap/hana-client SQL connectivity
ALTER USER B1_RECON_RO ENABLE CLIENT CONNECT;

-- Grant SELECT ONLY on the exact SAP B1 tables needed for bank matching:
-- House Banks & Bank Statements
GRANT SELECT ON "SBO_COMPANY_PT"."ODSC" TO B1_RECON_RO; -- Banks Master
GRANT SELECT ON "SBO_COMPANY_PT"."DSC1" TO B1_RECON_RO; -- House Bank Accounts & G/L Mapping
GRANT SELECT ON "SBO_COMPANY_PT"."OACT" TO B1_RECON_RO; -- Chart of Accounts (Bank G/L Accounts)
GRANT SELECT ON "SBO_COMPANY_PT"."OBNK" TO B1_RECON_RO; -- External Bank Statement Pages (avoid duplicate BankPages)
GRANT SELECT ON "SBO_COMPANY_PT"."OMTH" TO B1_RECON_RO; -- Reconciliation History Header

-- Business Partners & Bank/Tax Identifiers
GRANT SELECT ON "SBO_COMPANY_PT"."OCRD" TO B1_RECON_RO; -- Business Partners (CardCode, CardName, LicTradNum / NIF)
GRANT SELECT ON "SBO_COMPANY_PT"."OCRB" TO B1_RECON_RO; -- BP Bank Accounts (IBAN, BankCode, Account)

-- Open Receivables & Payables
GRANT SELECT ON "SBO_COMPANY_PT"."OINV" TO B1_RECON_RO; -- A/R Invoices
GRANT SELECT ON "SBO_COMPANY_PT"."ORIN" TO B1_RECON_RO; -- A/R Credit Memos
GRANT SELECT ON "SBO_COMPANY_PT"."OPCH" TO B1_RECON_RO; -- A/P Invoices
GRANT SELECT ON "SBO_COMPANY_PT"."ORPC" TO B1_RECON_RO; -- A/P Credit Memos

-- Existing Payments & Journal Entries on Bank G/L Accounts
GRANT SELECT ON "SBO_COMPANY_PT"."ORCT" TO B1_RECON_RO; -- Incoming Payments
GRANT SELECT ON "SBO_COMPANY_PT"."OVPM" TO B1_RECON_RO; -- Outgoing Payments
GRANT SELECT ON "SBO_COMPANY_PT"."OJDT" TO B1_RECON_RO; -- Journal Entries Header
GRANT SELECT ON "SBO_COMPANY_PT"."JDT1" TO B1_RECON_RO; -- Journal Entries Lines (ExtrMatch = 0 check)
