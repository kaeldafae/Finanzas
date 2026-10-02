import { expect, test } from '@playwright/test';
import { abrir, vigilar } from './utiles';

test('IA integrada sin WebGPU: lo dice claramente y deja la alternativa', async ({ page: p }) => {
  const v = vigilar(p);
  await abrir(p, 'ajustes');
  const sec = p.locator('section', { has: p.getByRole('heading', { name: 'IA integrada' }) });
  await expect(sec).toContainText(/no puede ejecutar la IA integrada|Modelo/);
  v.comprobar();
});
