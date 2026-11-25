import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type SupportedLocale = 'pt' | 'en' | 'es' | 'de';
export type LocalePreference = 'auto' | SupportedLocale;

const STORAGE_KEY = 'b1_recon_locale_pref';

export function normalizeLocaleTag(raw?: string | null): SupportedLocale | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();
  if (clean.startsWith('pt')) return 'pt';
  if (clean.startsWith('en')) return 'en';
  if (clean.startsWith('es')) return 'es';
  if (clean.startsWith('de')) return 'de';
  return null;
}

/**
 * Detects the active language from SAP Business One Web Client:
 * 1. URL query parameters (`sap-ui-language`, `sap-language`, `lang`) on current or parent window
 * 2. Parent / Top window SAPUI5 Core configuration (`sap.ui.getCore().getConfiguration().getLanguage()`)
 * 3. Parent / Top window `<html lang="...">` attribute (e.g. `lang="pt-PT"` in SAP B1 Web Client)
 * 4. SAP `sap-usercontext` cookie (`sap-language=EN`)
 * 5. Current document `<html lang="...">` or browser `navigator.language`
 */
export function detectSapB1WebClientLocale(): {
  locale: SupportedLocale;
  source: string;
} {
  if (typeof window === 'undefined') {
    return { locale: 'pt', source: 'default' };
  }

  const searchSources: string[] = [window.location.search];
  try {
    if (window.parent && window.parent !== window && window.parent.location?.search) {
      searchSources.push(window.parent.location.search);
    }
  } catch {
    // Cross-origin parent
  }

  for (const search of searchSources) {
    const params = new URLSearchParams(search);
    const paramLang =
      params.get('sap-ui-language') || params.get('sap-language') || params.get('lang');
    const norm = normalizeLocaleTag(paramLang);
    if (norm) return { locale: norm, source: 'SAP URL' };
  }

  const candidateWindows: Array<Window & Record<string, unknown>> = [
    window as unknown as Window & Record<string, unknown>,
  ];
  try {
    if (window.parent && window.parent !== window) {
      candidateWindows.push(window.parent as unknown as Window & Record<string, unknown>);
    }
    if (window.top && window.top !== window && window.top !== window.parent) {
      candidateWindows.push(window.top as unknown as Window & Record<string, unknown>);
    }
  } catch {
    // Cross-origin parent
  }

  for (const win of candidateWindows) {
    try {
      const sapObj = win.sap as
        | {
            ui?: {
              getCore?: () => {
                getConfiguration?: () => { getLanguage?: () => string };
              };
            };
          }
        | undefined;
      const ui5Lang = sapObj?.ui?.getCore?.()?.getConfiguration?.()?.getLanguage?.();
      const norm = normalizeLocaleTag(ui5Lang);
      if (norm) return { locale: norm, source: 'SAPUI5 Core' };
    } catch {
      // Ignore
    }
  }

  for (const win of candidateWindows) {
    try {
      const htmlLang = win.document?.documentElement?.getAttribute('lang');
      if (htmlLang && (win as unknown) !== window) {
        const norm = normalizeLocaleTag(htmlLang);
        if (norm) return { locale: norm, source: 'SAP Web Client HTML' };
      }
    } catch {
      // Ignore
    }
  }

  try {
    const cookieMatch = document.cookie.match(/sap-language=([a-zA-Z-]+)/);
    if (cookieMatch?.[1]) {
      const norm = normalizeLocaleTag(cookieMatch[1]);
      if (norm) return { locale: norm, source: 'SAP Cookie' };
    }
  } catch {
    // Ignore
  }

  const navLang = normalizeLocaleTag(navigator.language || navigator.languages?.[0]);
  if (navLang) return { locale: navLang, source: 'Browser' };

  return { locale: 'pt', source: 'Default' };
}

export const RECON_TRANSLATIONS = {
  pt: {
    appTitle: 'Processar extratos bancários externos',
    appSubtitle: 'SWIFT MT940 & Norma 43',
    connectedB1: 'Ligado ao SAP B1',
    sapHanaLive: 'SAP HANA Live',
    localSimulation: 'Simulação Local',
    importStatementBtn: 'Importar extrato',
    loadSampleBtn: 'Carregar demonstração',
    glRulesBtn: 'Regras de contabilização G/L',
    auditLogBtn: 'Registo de auditoria',
    diagnosticsBtn: 'Diagnóstico',
    editConnectionBtn: 'Editar ligação SAP B1',
    refreshBtn: 'Atualizar',
    langAutoPrefix: 'Auto (SAP B1',
    headerCollapse: 'Ocultar cabeçalho',
    headerExpand: 'Expandir cabeçalho',
    // Facets
    facetOpenMovements: 'Movimentos em aberto',
    movementUnit: 'movimento(s)',
    reconciledShort: 'Reconciliados',
    facetAutoReady: 'Prontos p/ automático (≥85%)',
    manualReviewShort: 'Revisão manual',
    facetPendingInflow: 'Recebimentos pendentes',
    bankCreditsSub: 'Créditos bancários',
    facetPendingOutflow: 'Pagamentos pendentes',
    bankDebitsSub: 'Débitos bancários',
    facetReconCoverage: 'Cobertura de reconciliação',
    // Anchor Tabs
    tabPending: 'Em aberto / Por reconciliar',
    tabAutoReady: 'Prontos p/ automático ≥85%',
    tabReview: 'Revisão recomendada',
    tabReconciled: 'Reconciliados',
    tabIgnored: 'Ignorados',
    tabAll: 'Todos os movimentos',
    // Section General
    sectionGeneral: 'Geral',
    subBankAndState: 'Conta bancária e estado',
    houseBankLabel: 'Banco da empresa:',
    allAccountsOption: 'Todas as contas',
    movementStateLabel: 'Estado do movimento:',
    subSearchAndMatch: 'Filtros de pesquisa e correspondência',
    searchMovementLabel: 'Procurar movimento:',
    searchPlaceholder: 'Descrição, NIF, IBAN, Multibanco, Nº Doc, Valor...',
    confidenceLevelLabel: 'Nível de confiança:',
    confAll: 'Todos',
    confHigh: 'Automático / Elevada (≥85%)',
    confReview: 'Revisão recomendada (50%–84%)',
    confNone: 'Sem correspondência direta',
    resetBtn: 'Repor',
    // Statement Lines Table
    statementLinesTitle: 'Linhas do extrato bancário',
    importFileBtn: 'Importar ficheiro',
    exportCsvBtn: 'Exportar CSV',
    noMovementsTitle: 'Não foram encontrados movimentos bancários',
    noMovementsDesc:
      'Importe um ficheiro de extrato bancário (SWIFT MT940 ou Norma 43) ou ajuste os filtros acima.',
    colDate: 'Data',
    colAccount: 'Conta',
    colDescAndPartner: 'Descrição e parceiro sugerido',
    colAmount: 'Montante',
    colStateSuggestion: 'Estado / Sugestão',
    statusReconciled: 'Reconciliado',
    statusError: 'Erro',
    statusIgnored: 'Ignorado',
    tierAuto: 'Automático',
    tierReview: 'Rever',
    statusManual: 'Manual',
    // Footer Bar
    openFooterLabel: 'Em aberto',
    autoReadyFooterLabel: 'Automáticos prontos (≥85%)',
    reconcileAutoBtn: 'Reconciliar automáticos',
    // Suggestion Inspector
    movementHeaderPrefix: 'Movimento',
    glAccountPrefix: 'Conta G/L',
    reconcileSuggestionBtn: 'Reconciliar Sugestão',
    reopenBtn: 'Reativar',
    ignoreBtn: 'Ignorar',
    bookingDateLabel: 'Data de Lançamento',
    valueDateLabel: 'Data Valor',
    bankRefCodeLabel: 'Ref. Bancária / Cód.',
    detectedNifLabel: 'NIF Detetado',
    mbRefLabel: 'Ref. Multibanco',
    creditTypeDesc: 'Recebimento (Crédito Bancário)',
    debitTypeDesc: 'Pagamento (Débito Bancário)',
    inspTabSuggestions: 'Sugestões',
    inspTabCustomerDocs: 'Documentos de clientes',
    inspTabVendorDocs: 'Documentos de fornecedores',
    inspTabJournal: 'Lançamentos no razão',
    inspTabDirectGl: 'Conta do razão (G/L)',
    noDirectSuggestionTitle: 'Sem sugestão automática direta',
    noDirectSuggestionDesc:
      'Selecione faturas/notas de crédito em aberto, um lançamento existente no Razão ou uma conta de custos/juros nos separadores acima.',
    selectInvoicesBtn: 'Selecionar Faturas / Notas de Crédito',
    searchJournalBtn: 'Procurar Lançamento no Razão',
    postAndReconcileBtn: 'Lançar & Reconciliar',
    confidencePrefix: 'Confiança',
    allSeriesOption: 'Todas as Séries',
    openDocsFilterPlaceholder: 'Filtrar por Nº Doc, Ref. Parceiro, CardCode, Nome, NIF ou Valor...',
    amountBtnPrefix: 'Valor',
    clearBtn: 'Limpar',
    openDocsCountLabel: 'Documentos em Aberto',
    colSeriesDocNum: 'Série / Nº Doc.',
    colBusinessPartner: 'Parceiro de Negócios',
    colDueDate: 'Vencimento',
    colOpenBalance: 'Saldo Aberto',
    colTotalPayment: 'Pagamento Total',
    selectedAmountLabel: 'Montante Selecionado',
    differenceLabel: 'Diferença',
    createPaymentAndReconcileBtn: 'Criar Pagamento & Reconciliar',
    directGlDesc:
      'Contabiliza um Pagamento ou Recebimento direto em Conta do Razão (SAP B1 DocType = rAccount) para despesas bancárias, comissões, imposto do selo ou juros, e reconcilia automaticamente a linha do extrato.',
    presetRuleLabel: 'Regra / Conta Predefinida',
    glAccountInputLabel: 'Conta do Razão (G/L)',
    hideRawRecord: '▾ Ocultar Registo Original do Extrato',
    showRawRecord: '▸ Ver Registo Original do Extrato',
    // Dialogs
    auditDialogTitle: 'Registo de Auditoria & Segurança (SAP B1 Reconciliação)',
    noAuditLogs: 'Sem registos de auditoria até ao momento.',
    colDateTime: 'Data / Hora',
    colB1User: 'Utilizador B1',
    colAction: 'Ação',
    colDetails: 'Detalhes',
    closeBtn: 'Fechar',
    cancelBtn: 'Cancelar',
    uploadDialogTitle: 'Importar Extrato Bancário (SWIFT MT940 / Norma 43)',
    importBtnPrefix: 'Importar',
    dragDropPrompt: 'Arraste o ficheiro aqui ou selecione do computador',
    browseFileBtn: 'Procurar Ficheiro (.mt940 / .n43)...',
    supportedFormatsHint:
      'Suporta os formatos standard SWIFT MT940 (.mt940, .sta, .940) e Norma 43 / AEB Cuaderno 43 (.n43, .c43, .aeb, .txt)',
    glRulesDialogTitle: 'Regras Automáticas de Contabilização G/L (Comissões, Imposto do Selo, Juros)',
    addRuleBtn: 'Adicionar Regra',
    removeBtn: 'Remover',
    connDialogTitle: 'Configuração & Diagnóstico de Ligação (SAP HANA + Service Layer)',
    saveAndTestBtn: 'Guardar & Testar Ligação',
    saveAndApplyBtn: 'Guardar & Aplicar',
  },
  en: {
    appTitle: 'Process External Bank Statements',
    appSubtitle: 'SWIFT MT940 & Norma 43',
    connectedB1: 'Connected to SAP B1',
    sapHanaLive: 'SAP HANA Live',
    localSimulation: 'Local Simulation',
    importStatementBtn: 'Import Statement',
    loadSampleBtn: 'Load Sample Data',
    glRulesBtn: 'G/L Posting Rules',
    auditLogBtn: 'Audit Log',
    diagnosticsBtn: 'Diagnostics',
    editConnectionBtn: 'Edit SAP B1 Connection',
    refreshBtn: 'Refresh',
    langAutoPrefix: 'Auto (SAP B1',
    headerCollapse: 'Collapse header',
    headerExpand: 'Expand header',
    facetOpenMovements: 'Open Transactions',
    movementUnit: 'transaction(s)',
    reconciledShort: 'Reconciled',
    facetAutoReady: 'Auto-Match Ready (≥85%)',
    manualReviewShort: 'Manual review',
    facetPendingInflow: 'Pending Inflows',
    bankCreditsSub: 'Bank credits',
    facetPendingOutflow: 'Pending Outflows',
    bankDebitsSub: 'Bank debits',
    facetReconCoverage: 'Reconciliation Coverage',
    tabPending: 'Open / Unreconciled',
    tabAutoReady: 'Auto-Match Ready ≥85%',
    tabReview: 'Review Recommended',
    tabReconciled: 'Reconciled',
    tabIgnored: 'Ignored',
    tabAll: 'All Transactions',
    sectionGeneral: 'General',
    subBankAndState: 'House Bank Account & Status',
    houseBankLabel: 'House Bank:',
    allAccountsOption: 'All accounts',
    movementStateLabel: 'Transaction Status:',
    subSearchAndMatch: 'Search & Matching Filters',
    searchMovementLabel: 'Search Transaction:',
    searchPlaceholder: 'Description, Tax ID, IBAN, Reference, Doc No., Amount...',
    confidenceLevelLabel: 'Confidence Level:',
    confAll: 'All',
    confHigh: 'Automatic / High (≥85%)',
    confReview: 'Review Recommended (50%–84%)',
    confNone: 'No Direct Match',
    resetBtn: 'Reset',
    statementLinesTitle: 'Bank Statement Lines',
    importFileBtn: 'Import File',
    exportCsvBtn: 'Export CSV',
    noMovementsTitle: 'No bank transactions found',
    noMovementsDesc:
      'Import a bank statement file (SWIFT MT940 or Norma 43) or adjust the filters above.',
    colDate: 'Date',
    colAccount: 'Account',
    colDescAndPartner: 'Description & Suggested Partner',
    colAmount: 'Amount',
    colStateSuggestion: 'Status / Suggestion',
    statusReconciled: 'Reconciled',
    statusError: 'Error',
    statusIgnored: 'Ignored',
    tierAuto: 'Auto',
    tierReview: 'Review',
    statusManual: 'Manual',
    openFooterLabel: 'Open',
    autoReadyFooterLabel: 'Auto-ready (≥85%)',
    reconcileAutoBtn: 'Reconcile Auto-Matched',
    movementHeaderPrefix: 'Transaction',
    glAccountPrefix: 'G/L Account',
    reconcileSuggestionBtn: 'Reconcile Suggestion',
    reopenBtn: 'Reopen',
    ignoreBtn: 'Ignore',
    bookingDateLabel: 'Booking Date',
    valueDateLabel: 'Value Date',
    bankRefCodeLabel: 'Bank Ref. / Code',
    detectedNifLabel: 'Detected Tax ID',
    mbRefLabel: 'Payment Ref.',
    creditTypeDesc: 'Incoming Payment (Bank Credit)',
    debitTypeDesc: 'Outgoing Payment (Bank Debit)',
    inspTabSuggestions: 'Suggestions',
    inspTabCustomerDocs: 'Customer Documents',
    inspTabVendorDocs: 'Vendor Documents',
    inspTabJournal: 'Journal Entries',
    inspTabDirectGl: 'G/L Account',
    noDirectSuggestionTitle: 'No direct automatic suggestion',
    noDirectSuggestionDesc:
      'Select open invoices/credit memos, an existing journal entry, or a G/L expense/interest account in the tabs above.',
    selectInvoicesBtn: 'Select Invoices / Credit Memos',
    searchJournalBtn: 'Search Journal Entries',
    postAndReconcileBtn: 'Post & Reconcile',
    confidencePrefix: 'Confidence',
    allSeriesOption: 'All Series',
    openDocsFilterPlaceholder: 'Filter by Doc No., Partner Ref., CardCode, Name, Tax ID, or Amount...',
    amountBtnPrefix: 'Amount',
    clearBtn: 'Clear',
    openDocsCountLabel: 'Open Documents',
    colSeriesDocNum: 'Series / Doc No.',
    colBusinessPartner: 'Business Partner',
    colDueDate: 'Due Date',
    colOpenBalance: 'Open Balance',
    colTotalPayment: 'Total Payment',
    selectedAmountLabel: 'Selected Amount',
    differenceLabel: 'Difference',
    createPaymentAndReconcileBtn: 'Create Payment & Reconcile',
    directGlDesc:
      'Posts a direct Incoming or Outgoing Payment to a G/L Account (SAP B1 DocType = rAccount) for bank fees, commissions, stamp duty, or interest, and reconciles the statement line.',
    presetRuleLabel: 'Preset Rule / Account',
    glAccountInputLabel: 'G/L Account Code',
    hideRawRecord: '▾ Hide Raw Statement Record',
    showRawRecord: '▸ View Raw Statement Record',
    auditDialogTitle: 'Security & Audit Log (SAP B1 Bank Reconciliation)',
    noAuditLogs: 'No audit log records found yet.',
    colDateTime: 'Date / Time',
    colB1User: 'B1 User',
    colAction: 'Action',
    colDetails: 'Details',
    closeBtn: 'Close',
    cancelBtn: 'Cancel',
    uploadDialogTitle: 'Import Bank Statement (SWIFT MT940 / Norma 43)',
    importBtnPrefix: 'Import',
    dragDropPrompt: 'Drag and drop file here or browse from your computer',
    browseFileBtn: 'Browse File (.mt940 / .n43)...',
    supportedFormatsHint:
      'Supports standard SWIFT MT940 (.mt940, .sta, .940) and Norma 43 / AEB Cuaderno 43 (.n43, .c43, .aeb, .txt) formats',
    glRulesDialogTitle: 'Automatic G/L Posting Rules (Fees, Stamp Duty, Interest)',
    addRuleBtn: 'Add Rule',
    removeBtn: 'Remove',
    connDialogTitle: 'Connection Configuration & Diagnostics (SAP HANA + Service Layer)',
    saveAndTestBtn: 'Save & Test Connection',
    saveAndApplyBtn: 'Save & Apply',
  },
  es: {
    appTitle: 'Procesar extractos bancarios externos',
    appSubtitle: 'SWIFT MT940 & Norma 43',
    connectedB1: 'Conectado a SAP B1',
    sapHanaLive: 'SAP HANA Live',
    localSimulation: 'Simulación Local',
    importStatementBtn: 'Importar extracto',
    loadSampleBtn: 'Cargar demostración',
    glRulesBtn: 'Reglas de contabilización G/L',
    auditLogBtn: 'Registro de auditoría',
    diagnosticsBtn: 'Diagnóstico',
    editConnectionBtn: 'Editar conexión SAP B1',
    refreshBtn: 'Actualizar',
    langAutoPrefix: 'Auto (SAP B1',
    headerCollapse: 'Ocultar cabecera',
    headerExpand: 'Expandir cabecera',
    facetOpenMovements: 'Movimientos abiertos',
    movementUnit: 'movimiento(s)',
    reconciledShort: 'Reconciliados',
    facetAutoReady: 'Listos p/ automático (≥85%)',
    manualReviewShort: 'Revisión manual',
    facetPendingInflow: 'Cobros pendientes',
    bankCreditsSub: 'Créditos bancarios',
    facetPendingOutflow: 'Pagos pendientes',
    bankDebitsSub: 'Débitos bancarios',
    facetReconCoverage: 'Cobertura de reconciliación',
    tabPending: 'Abiertos / Por reconciliar',
    tabAutoReady: 'Listos p/ automático ≥85%',
    tabReview: 'Revisión recomendada',
    tabReconciled: 'Reconciliados',
    tabIgnored: 'Ignorados',
    tabAll: 'Todos los movimientos',
    sectionGeneral: 'General',
    subBankAndState: 'Cuenta bancaria y estado',
    houseBankLabel: 'Banco propio:',
    allAccountsOption: 'Todas las cuentas',
    movementStateLabel: 'Estado del movimiento:',
    subSearchAndMatch: 'Filtros de búsqueda y coincidencia',
    searchMovementLabel: 'Buscar movimiento:',
    searchPlaceholder: 'Descripción, NIF, IBAN, Referencia, Nº Doc, Importe...',
    confidenceLevelLabel: 'Nivel de confianza:',
    confAll: 'Todos',
    confHigh: 'Automático / Alta (≥85%)',
    confReview: 'Revisión recomendada (50%–84%)',
    confNone: 'Sin coincidencia directa',
    resetBtn: 'Restablecer',
    statementLinesTitle: 'Líneas del extracto bancario',
    importFileBtn: 'Importar archivo',
    exportCsvBtn: 'Exportar CSV',
    noMovementsTitle: 'No se encontraron movimientos bancarios',
    noMovementsDesc:
      'Importe un archivo de extracto bancario (SWIFT MT940 o Norma 43) o ajuste los filtros.',
    colDate: 'Fecha',
    colAccount: 'Cuenta',
    colDescAndPartner: 'Descripción e interlocutor sugerido',
    colAmount: 'Importe',
    colStateSuggestion: 'Estado / Sugerencia',
    statusReconciled: 'Reconciliado',
    statusError: 'Error',
    statusIgnored: 'Ignorado',
    tierAuto: 'Automático',
    tierReview: 'Revisar',
    statusManual: 'Manual',
    openFooterLabel: 'Abiertos',
    autoReadyFooterLabel: 'Automáticos listos (≥85%)',
    reconcileAutoBtn: 'Reconciliar automáticos',
    movementHeaderPrefix: 'Movimiento',
    glAccountPrefix: 'Cuenta G/L',
    reconcileSuggestionBtn: 'Reconciliar Sugerencia',
    reopenBtn: 'Reactivar',
    ignoreBtn: 'Ignorar',
    bookingDateLabel: 'Fecha contabilización',
    valueDateLabel: 'Fecha valor',
    bankRefCodeLabel: 'Ref. Bancaria / Cód.',
    detectedNifLabel: 'NIF Detectado',
    mbRefLabel: 'Ref. Pago',
    creditTypeDesc: 'Cobro recibido (Crédito Bancario)',
    debitTypeDesc: 'Pago efectuado (Débito Bancario)',
    inspTabSuggestions: 'Sugerencias',
    inspTabCustomerDocs: 'Documentos de clientes',
    inspTabVendorDocs: 'Documentos de proveedores',
    inspTabJournal: 'Asientos en el mayor',
    inspTabDirectGl: 'Cuenta de mayor (G/L)',
    noDirectSuggestionTitle: 'Sin sugerencia automática directa',
    noDirectSuggestionDesc:
      'Seleccione facturas/abonos abiertos, un asiento existente o una cuenta de gastos/intereses en las pestañas superiores.',
    selectInvoicesBtn: 'Seleccionar Facturas / Abonos',
    searchJournalBtn: 'Buscar Asiento en el Mayor',
    postAndReconcileBtn: 'Contabilizar y Reconciliar',
    confidencePrefix: 'Confianza',
    allSeriesOption: 'Todas las Series',
    openDocsFilterPlaceholder: 'Filtrar por Nº Doc, Ref., CardCode, Nombre, NIF o Importe...',
    amountBtnPrefix: 'Importe',
    clearBtn: 'Limpiar',
    openDocsCountLabel: 'Documentos Abiertos',
    colSeriesDocNum: 'Serie / Nº Doc.',
    colBusinessPartner: 'Interlocutor Comercial',
    colDueDate: 'Vencimiento',
    colOpenBalance: 'Saldo Abierto',
    colTotalPayment: 'Pago Total',
    selectedAmountLabel: 'Importe Seleccionado',
    differenceLabel: 'Diferencia',
    createPaymentAndReconcileBtn: 'Crear Pago y Reconciliar',
    directGlDesc:
      'Contabiliza un Pago o Cobro directo en Cuenta de Mayor (SAP B1 DocType = rAccount) para comisiones, gastos bancarios o intereses y reconcilia la línea.',
    presetRuleLabel: 'Regla / Cuenta Predefinida',
    glAccountInputLabel: 'Cuenta de Mayor (G/L)',
    hideRawRecord: '▾ Ocultar Registro Original del Extracto',
    showRawRecord: '▸ Ver Registro Original del Extracto',
    auditDialogTitle: 'Registro de Auditoría y Seguridad (SAP B1 Reconciliación)',
    noAuditLogs: 'Sin registros de auditoría hasta el momento.',
    colDateTime: 'Fecha / Hora',
    colB1User: 'Usuario B1',
    colAction: 'Acción',
    colDetails: 'Detalles',
    closeBtn: 'Cerrar',
    cancelBtn: 'Cancelar',
    uploadDialogTitle: 'Importar Extracto Bancario (SWIFT MT940 / Norma 43)',
    importBtnPrefix: 'Importar',
    dragDropPrompt: 'Arrastre el archivo aquí o selecciónelo del equipo',
    browseFileBtn: 'Buscar Archivo (.mt940 / .n43)...',
    supportedFormatsHint:
      'Soporta los formatos estándar SWIFT MT940 (.mt940, .sta, .940) y Norma 43 / AEB Cuaderno 43 (.n43, .c43, .aeb, .txt)',
    glRulesDialogTitle: 'Reglas Automáticas de Contabilización G/L (Comisiones, Impuestos, Intereses)',
    addRuleBtn: 'Añadir Regla',
    removeBtn: 'Eliminar',
    connDialogTitle: 'Configuración y Diagnóstico de Conexión (SAP HANA + Service Layer)',
    saveAndTestBtn: 'Guardar y Probar Conexión',
    saveAndApplyBtn: 'Guardar y Aplicar',
  },
  de: {
    appTitle: 'Externe Kontoauszüge verarbeiten',
    appSubtitle: 'SWIFT MT940 & Norma 43',
    connectedB1: 'Verbunden mit SAP B1',
    sapHanaLive: 'SAP HANA Live',
    localSimulation: 'Lokale Simulation',
    importStatementBtn: 'Kontoauszug importieren',
    loadSampleBtn: 'Beispieldaten laden',
    glRulesBtn: 'Sachkonten-Buchungsregeln',
    auditLogBtn: 'Audit-Protokoll',
    diagnosticsBtn: 'Diagnose',
    editConnectionBtn: 'SAP B1-Verbindung',
    refreshBtn: 'Aktualisieren',
    langAutoPrefix: 'Auto (SAP B1',
    headerCollapse: 'Kopfzeile ausblenden',
    headerExpand: 'Kopfzeile einblenden',
    facetOpenMovements: 'Offene Umsätze',
    movementUnit: 'Umsatz/Umsätze',
    reconciledShort: 'Abgestimmt',
    facetAutoReady: 'Auto-Abstimmung bereit (≥85%)',
    manualReviewShort: 'Manuelle Prüfung',
    facetPendingInflow: 'Offene Eingänge',
    bankCreditsSub: 'Bankgutschriften',
    facetPendingOutflow: 'Offene Ausgänge',
    bankDebitsSub: 'Banklastschriften',
    facetReconCoverage: 'Abstimmungsquote',
    tabPending: 'Offen / Abzustimmen',
    tabAutoReady: 'Auto-bereit ≥85%',
    tabReview: 'Prüfung empfohlen',
    tabReconciled: 'Abgestimmt',
    tabIgnored: 'Ignoriert',
    tabAll: 'Alle Umsätze',
    sectionGeneral: 'Allgemein',
    subBankAndState: 'Hausbankkonto & Status',
    houseBankLabel: 'Hausbank:',
    allAccountsOption: 'Alle Konten',
    movementStateLabel: 'Umsatzstatus:',
    subSearchAndMatch: 'Such- & Zuordnungsfilter',
    searchMovementLabel: 'Umsatz suchen:',
    searchPlaceholder: 'Beschreibung, USt-IdNr., IBAN, Referenz, Belegnr., Betrag...',
    confidenceLevelLabel: 'Konfidenzniveau:',
    confAll: 'Alle',
    confHigh: 'Automatisch / Hoch (≥85%)',
    confReview: 'Prüfung empfohlen (50%–84%)',
    confNone: 'Keine direkte Zuordnung',
    resetBtn: 'Zurücksetzen',
    statementLinesTitle: 'Kontoauszugszeilen',
    importFileBtn: 'Datei importieren',
    exportCsvBtn: 'CSV exportieren',
    noMovementsTitle: 'Keine Bankumsätze gefunden',
    noMovementsDesc:
      'Importieren Sie eine Kontoauszugsdatei (SWIFT MT940 oder Norma 43) oder passen Sie die Filter an.',
    colDate: 'Datum',
    colAccount: 'Konto',
    colDescAndPartner: 'Beschreibung & vorgeschlagener Partner',
    colAmount: 'Betrag',
    colStateSuggestion: 'Status / Vorschlag',
    statusReconciled: 'Abgestimmt',
    statusError: 'Fehler',
    statusIgnored: 'Ignoriert',
    tierAuto: 'Auto',
    tierReview: 'Prüfen',
    statusManual: 'Manuell',
    openFooterLabel: 'Offen',
    autoReadyFooterLabel: 'Auto-bereit (≥85%)',
    reconcileAutoBtn: 'Automatische abstimmen',
    movementHeaderPrefix: 'Umsatz',
    glAccountPrefix: 'Sachkonto',
    reconcileSuggestionBtn: 'Vorschlag abstimmen',
    reopenBtn: 'Reaktivieren',
    ignoreBtn: 'Ignorieren',
    bookingDateLabel: 'Buchungsdatum',
    valueDateLabel: 'Valutadatum',
    bankRefCodeLabel: 'Bankref. / Code',
    detectedNifLabel: 'Erkannte USt-IdNr.',
    mbRefLabel: 'Zahlungsref.',
    creditTypeDesc: 'Eingangszahlung (Bankgutschrift)',
    debitTypeDesc: 'Ausgangszahlung (Banklastschrift)',
    inspTabSuggestions: 'Vorschläge',
    inspTabCustomerDocs: 'Kundenbelege',
    inspTabVendorDocs: 'Lieferantenbelege',
    inspTabJournal: 'Journalbuchungen',
    inspTabDirectGl: 'Sachkonto (G/L)',
    noDirectSuggestionTitle: 'Kein direkter automatischer Vorschlag',
    noDirectSuggestionDesc:
      'Wählen Sie offene Rechnungen/Gutschriften, eine Journalbuchung oder ein Sachkonto in den Registern oben.',
    selectInvoicesBtn: 'Rechnungen / Gutschriften wählen',
    searchJournalBtn: 'Journalbuchungen suchen',
    postAndReconcileBtn: 'Buchen & Abstimmen',
    confidencePrefix: 'Konfidenz',
    allSeriesOption: 'Alle Serien',
    openDocsFilterPlaceholder: 'Filtern nach Belegnr., Ref., CardCode, Name, USt-IdNr. oder Betrag...',
    amountBtnPrefix: 'Betrag',
    clearBtn: 'Löschen',
    openDocsCountLabel: 'Offene Belege',
    colSeriesDocNum: 'Serie / Belegnr.',
    colBusinessPartner: 'Geschäftspartner',
    colDueDate: 'Fälligkeit',
    colOpenBalance: 'Offener Saldo',
    colTotalPayment: 'Zahlungsbetrag',
    selectedAmountLabel: 'Ausgewählter Betrag',
    differenceLabel: 'Differenz',
    createPaymentAndReconcileBtn: 'Zahlung erstellen & Abstimmen',
    directGlDesc:
      'Erstellt eine direkte Eingangs- oder Ausgangszahlung auf ein Sachkonto (SAP B1 DocType = rAccount) für Bankgebühren oder Zinsen und stimmt die Zeile ab.',
    presetRuleLabel: 'Vordefinierte Regel / Konto',
    glAccountInputLabel: 'Sachkonto (G/L)',
    hideRawRecord: '▾ Original-Kontoauszugszeile ausblenden',
    showRawRecord: '▸ Original-Kontoauszugszeile anzeigen',
    auditDialogTitle: 'Sicherheits- & Audit-Protokoll (SAP B1 Bankabstimmung)',
    noAuditLogs: 'Noch keine Audit-Protokolleinträge vorhanden.',
    colDateTime: 'Datum / Uhrzeit',
    colB1User: 'B1-Benutzer',
    colAction: 'Aktion',
    colDetails: 'Details',
    closeBtn: 'Schließen',
    cancelBtn: 'Abbrechen',
    uploadDialogTitle: 'Kontoauszug importieren (SWIFT MT940 / Norma 43)',
    importBtnPrefix: 'Importieren',
    dragDropPrompt: 'Datei hierher ziehen oder vom Computer auswählen',
    browseFileBtn: 'Datei durchsuchen (.mt940 / .n43)...',
    supportedFormatsHint:
      'Unterstützt die Standardformate SWIFT MT940 (.mt940, .sta, .940) und Norma 43 / AEB Cuaderno 43 (.n43, .c43, .aeb, .txt)',
    glRulesDialogTitle: 'Automatische Sachkonten-Buchungsregeln (Gebühren, Steuern, Zinsen)',
    addRuleBtn: 'Regel hinzufügen',
    removeBtn: 'Entfernen',
    connDialogTitle: 'Verbindungskonfiguration & Diagnose (SAP HANA + Service Layer)',
    saveAndTestBtn: 'Speichern & Verbindung testen',
    saveAndApplyBtn: 'Speichern & Anwenden',
  },
} as const;

export type ReconTranslationDictionary = (typeof RECON_TRANSLATIONS)[SupportedLocale];

interface I18nContextValue {
  locale: SupportedLocale;
  preference: LocalePreference;
  detectedLocale: SupportedLocale;
  detectedSource: string;
  setPreference: (pref: LocalePreference) => void;
  t: ReconTranslationDictionary;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<LocalePreference>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'auto' || saved === 'pt' || saved === 'en' || saved === 'es' || saved === 'de') {
        return saved;
      }
    } catch {
      // Ignore
    }
    return 'auto';
  });

  const [detected, setDetected] = useState<{ locale: SupportedLocale; source: string }>(() =>
    detectSapB1WebClientLocale()
  );

  useEffect(() => {
    const syncFromSapWebClient = () => {
      const next = detectSapB1WebClientLocale();
      setDetected((prev) =>
        prev.locale === next.locale && prev.source === next.source ? prev : next
      );
    };
    syncFromSapWebClient();
    const interval = window.setInterval(syncFromSapWebClient, 2500);
    return () => window.clearInterval(interval);
  }, []);

  const setPreference = (pref: LocalePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Ignore
    }
  };

  const effectiveLocale: SupportedLocale =
    preference === 'auto' ? detected.locale : preference;

  useEffect(() => {
    document.documentElement.lang = effectiveLocale;
  }, [effectiveLocale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: effectiveLocale,
      preference,
      detectedLocale: detected.locale,
      detectedSource: detected.source,
      setPreference,
      t: RECON_TRANSLATIONS[effectiveLocale],
    }),
    [effectiveLocale, preference, detected]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: 'pt',
      preference: 'auto',
      detectedLocale: 'pt',
      detectedSource: 'Default',
      setPreference: () => {},
      t: RECON_TRANSLATIONS.pt,
    };
  }
  return ctx;
}
