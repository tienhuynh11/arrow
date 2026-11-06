import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupNativeShell } from './native';
import './styles.css';

void setupNativeShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
