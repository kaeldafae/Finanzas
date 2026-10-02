import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas en navegador de la app compilada (npm run build) servida con vite preview.
 * Los archivos de prueba (extractos, nómina, foto) se generan en e2e/preparar.ts con datos inventados.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/preparar.ts',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'es-ES',
    trace: 'retain-on-failure',
    // Sin service worker: su aviso «Lista para usar sin conexión» taparía botones a mitad de prueba.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'movil', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
