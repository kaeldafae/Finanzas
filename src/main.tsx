import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProveedorDatos } from './estado';
import './estilos.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Falta el elemento #root');

createRoot(raiz).render(
  <StrictMode>
    <ProveedorDatos cargando={<p className="app" role="status">Cargando…</p>}>
      <App />
    </ProveedorDatos>
  </StrictMode>,
);
