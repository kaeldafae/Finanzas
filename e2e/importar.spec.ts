import { expect, test } from '@playwright/test';
import { abrir, DIR, importar, vigilar } from './utiles';

test('Santander (Excel) y Revolut (CSV): cuadre, revisión, informe y sin duplicados al repetir', async ({ page: p }) => {
  const v = vigilar(p);
  await importar(p, [`${DIR}/santander.xlsx`, `${DIR}/revolut.csv`]);
  await expect(p.getByText(/Cuadra con los saldos/)).toHaveCount(2);
  await p.getByRole('button', { name: 'Continuar' }).click();
  await expect(p.getByRole('heading', { name: 'Revisar movimientos' })).toBeVisible();
  await expect(p.locator('section.card').first()).toContainText('15 movimientos nuevos · 1 traspasos entre tus cuentas emparejados');
  await p.locator('li.fila', { hasText: 'Amzn Mktp' }).getByLabel('Categoría').selectOption({ label: 'Hogar' });
  await p.locator('li.fila', { hasText: 'Bizum enviado' }).getByLabel('Categoría').selectOption({ label: 'Restaurantes y bares' });
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Importación completada' })).toBeVisible();
  await expect(p.locator('.kpis').first()).toContainText('1798,20');
  await expect(p.locator('.kpis').first()).toContainText('238,17');

  await importar(p, [`${DIR}/santander.xlsx`, `${DIR}/revolut.csv`]);
  await expect(p.getByText(/Cuadra con los saldos/)).toHaveCount(2);
  await p.getByRole('button', { name: 'Continuar' }).click();
  await expect(p.locator('section.card').first()).toContainText('0 movimientos nuevos · 15 ya importados antes');

  // Deshacer la importación entera y poder repetirla.
  await abrir(p, 'ajustes');
  await p.getByRole('button', { name: 'Deshacer' }).click();
  await expect(p.getByText(/Importación deshecha/)).toBeVisible();
  await importar(p, [`${DIR}/santander.xlsx`, `${DIR}/revolut.csv`]);
  await p.getByRole('button', { name: 'Continuar' }).click();
  await expect(p.locator('section.card').first()).toContainText('15 movimientos nuevos');
  v.comprobar();
});

test('revisión con IA por copiar y pegar: anonimizada, doble y validada', async ({ page: p }) => {
  const v = vigilar(p);
  await importar(p, [`${DIR}/santander.xlsx`, `${DIR}/revolut.csv`]);
  await expect(p.getByText(/Cuadra con los saldos/)).toHaveCount(2);
  await p.getByRole('button', { name: 'Continuar' }).click();
  await expect(p.getByRole('heading', { name: /Revisión con IA/ })).toBeVisible();
  const manual = p.getByText('O revisar con Claude copiando y pegando');
  if (await manual.isVisible().catch(() => false)) await manual.click();
  const peticiones = await p.locator('#t-ia').locator('..').locator('pre').allTextContents();
  expect(peticiones).toHaveLength(2);
  // Nada sensible en lo que se copiaría a un chat.
  expect(peticiones.join('\n')).not.toMatch(/Bizum|JUAN|GARCIA|MICHAEL|19,99|2026|Santander|Revolut/);
  const lista = peticiones[0]?.split('Comercios:')[1]?.split('Responde')[0] ?? '';
  const numeros = [...lista.matchAll(/^(\d+)\. (.+?) ·/gm)].map((m) => Number(m[1]));
  const resp = (cat: string) => `RESPUESTA-FINANZAS\n${JSON.stringify(numeros.map((n) => ({ n, categoria: cat, tipo: 'Variable', seguridad: 'alta', motivo: 'prueba' })))}`;
  await p.getByLabel('Respuesta de la IA').nth(0).fill(resp('Hogar'));
  await p.getByLabel('Respuesta de la IA').nth(1).fill(resp('Ocio'));
  await p.getByRole('button', { name: /Comparar las dos revisiones/ }).click();
  await expect(p.getByText(/0 de \d+ con acuerdo pleno/)).toBeVisible();
  await p.getByLabel('Respuesta de la IA').nth(0).fill('[{"n":1,"categoria":"Hog');
  await expect(p.getByText(/incompleta o mal copiada/)).toBeVisible();
  v.comprobar();
});

test('Santander guardado con todo en una columna: se separa de nuevo y cuadra', async ({ page: p }) => {
  const v = vigilar(p);
  await importar(p, [`${DIR}/santander-una-columna.xlsx`]);
  const tarjeta = p.locator('div.card', { hasText: 'santander-una-columna.xlsx' });
  await expect(tarjeta).toContainText('4 movimientos');
  await expect(tarjeta).toContainText('Cuadra con los saldos del banco');
  await expect(tarjeta.getByLabel('Nombre de la cuenta')).toHaveValue('Santander');
  v.comprobar();
});
