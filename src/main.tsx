import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import { App } from './app/App';
import './app/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
