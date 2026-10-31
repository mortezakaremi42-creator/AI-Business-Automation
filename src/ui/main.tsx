import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/vazirmatn';
import './styles.css';
import { App } from './App.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Service worker registration optional in dev preview
    });
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
