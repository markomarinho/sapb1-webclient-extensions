import React from 'react';
import ReactDOM from 'react-dom/client';
import { setDefaultFontLoading } from '@ui5/webcomponents-base/dist/config/Fonts.js';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import { ThemeProvider } from '@ui5/webcomponents-react';
import { App } from './App';
import { I18nProvider } from './i18n';

// Disable external CDN font loading (cdn.jsdelivr.net) to comply with SAP B1 Web Client CSP (font-src 'self')
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
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);
