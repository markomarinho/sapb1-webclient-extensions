import React from 'react';
import ReactDOM from 'react-dom/client';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import { ThemeProvider } from '@ui5/webcomponents-react';
import { App } from './App';

setTheme('sap_horizon');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
