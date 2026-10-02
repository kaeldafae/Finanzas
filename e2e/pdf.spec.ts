import { expect, test } from '@playwright/test';
import { DIR, FIJOS, importar, vigilar } from './utiles';

test('PDF de Revolut: cuadra con saldos y resumen; el CSV del mismo periodo no duplica', async ({ page: p }) => {
  const v = vigilar(p);
  await importar(p, [`${DIR}/revolut.pdf`]);
  const tarjeta = p.locator('div.card', { hasText: 'revolut.pdf' });
  await expect(tarjeta).toContainText('10 movimientos');
  await expect(tarjeta).toContainText('2 descartados');
  await expect(tarjeta).toContainText('Coincide con el resumen del extracto: entradas 605,30 €, salidas 290,27 €');
  await expect(tarjeta).toContainText('Cuadra con los saldos del banco');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.locator('li.fila', { hasText: 'Amzn Mktp' }).getByLabel('Categoría').selectOption({ label: 'Hogar' });
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(p.locator('.kpis').first()).toContainText('174,97');

  await importar(p, [`${DIR}/revolut.csv`]);
  await expect(p.getByText(/Cuadra con los saldos/)).toBeVisible();
  await p.getByRole('button', { name: 'Continuar' }).click();
  await expect(p.locator('section.card').first()).toContainText('0 movimientos nuevos · 11 ya importados antes');
  v.comprobar();
});

test('PDF con contraseña: se pide en la app, la incorrecta se rechaza', async ({ page: p }) => {
  const v = vigilar(p);
  await importar(p, [`${FIJOS}/revolut-contrasena.pdf`]);
  const tarjeta = p.locator('div.card', { hasText: 'revolut-contrasena.pdf' });
  await tarjeta.getByLabel('Contraseña del PDF').fill('mala');
  await tarjeta.getByRole('button', { name: 'Abrir PDF' }).click();
  await expect(tarjeta.getByText('La contraseña no es correcta')).toBeVisible();
  await tarjeta.getByLabel('Contraseña del PDF').fill('1234');
  await tarjeta.getByRole('button', { name: 'Abrir PDF' }).click();
  await expect(tarjeta).toContainText('Coincide con el resumen del extracto');
  v.comprobar();
});

for (const archivo of ['extracto-foto.png', 'escaneado.pdf']) {
  test(`OCR en el dispositivo: ${archivo}`, async ({ page: p }) => {
    const v = vigilar(p);
    await importar(p, [`${DIR}/${archivo}`]);
    const tarjeta = p.locator('div.card', { hasText: archivo });
    await tarjeta.getByRole('button', { name: 'Leer con OCR' }).click();
    await expect(tarjeta).toContainText('4 movimientos', { timeout: 120_000 });
    await expect(tarjeta).toContainText('Leído de la imagen con reconocimiento de texto');
    await expect(tarjeta).toContainText('Coincide con el resumen del extracto');
    await expect(tarjeta).toContainText('Cuadra con los saldos del banco');
    v.comprobar();
  });
}
