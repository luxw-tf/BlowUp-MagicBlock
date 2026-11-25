import './chain/polyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/lilita-one';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './styles.css';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
