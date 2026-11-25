import './chain/polyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/alfa-slab-one/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/signika/400.css';
import '@fontsource/signika/500.css';
import '@fontsource/signika/600.css';
import '@fontsource/signika/700.css';
import './styles.css';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
