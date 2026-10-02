import { expect, type Page } from '@playwright/test';

/** Carpeta de archivos generados (no se suben al repositorio). */
export const DIR = 'e2e/.generados';
/** Archivos fijos de prueba (datos inventados). */
export const FIJOS = 'e2e/fixtures';

/** Abre una pantalla y quita el aviso de "lista para usar sin conexión" si aparece. */
export async function abrir(p: Page, ruta: string): Promise<void> {
  await p.goto('/#/mes');
  await p.goto(`/#/${ruta}`);
  const vale = p.getByRole('button', { name: 'Vale' });
  if (await vale.isVisible().catch(() => false)) await vale.click();
}

/** Errores de consola y peticiones a otros dominios: ninguna prueba debe tener. */
export function vigilar(p: Page): { comprobar: () => void } {
  const errores: string[] = [];
  const externas: string[] = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  p.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:4173')) externas.push(r.url());
  });
  p.on('dialog', (d) => void d.accept());
  return {
    comprobar: () => {
      expect(errores).toEqual([]);
      expect(externas).toEqual([]);
    },
  };
}

export async function importar(p: Page, archivos: string[]): Promise<void> {
  await abrir(p, 'importar');
  await p.locator('input[type=file]').setInputFiles(archivos);
}
