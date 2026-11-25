import './chain/polyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/lilita-one';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
