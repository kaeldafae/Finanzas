import { expect, test } from '@playwright/test';
import { abrir, DIR, importar, vigilar } from './utiles';

test('nómina en PDF: completa el ingreso del banco con bruto, Seguridad Social y retención', async ({ page: p }) => {
  const v = vigilar(p);
  await importar(p, [`${DIR}/santander.xlsx`]);
  await expect(p.getByText(/Cuadra con los saldos/)).toBeVisible();
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.locator('li.fila', { hasText: 'Bizum enviado' }).getByLabel('Categoría').selectOption({ label: 'Restaurantes y bares' });
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Importación completada' })).toBeVisible();

  await importar(p, [`${DIR}/nomina.pdf`]);
  const tarjeta = p.locator('div.card', { hasText: 'nomina.pdf' });
  await expect(tarjeta).toContainText('Nómina leída y cuadrada');
  await expect(tarjeta).toContainText('2150,00');
  await expect(tarjeta).toContainText('139,33');
  await expect(tarjeta).toContainText('212,47');
  await tarjeta.getByRole('button', { name: 'Aplicar nómina' }).click();
  await expect(tarjeta.getByRole('status')).toContainText('Completado el ingreso del banco');
  await abrir(p, 'renta');
  await expect(p.getByText(/por completar|Completar con la nómina/)).toHaveCount(0);
  v.comprobar();
});

test('texto pegado (Texto en vivo): se lee y se verifica con el saldo', async ({ page: p }) => {
  const v = vigilar(p);
  await abrir(p, 'importar');
  await p.getByText('Pegar texto (de una foto o de la web del banco)').click();
  await p.getByLabel('Texto de los movimientos').fill('01/03/2026 Mercadona -45,30 554,70\n02/03/2026 Nomina Hoteles 1.200,00 1.754,70\n03/03/2026 Bar Can Pep -12,50 1.742,20');
  await p.getByRole('button', { name: 'Leer texto' }).click();
  const tarjeta = p.locator('div.card', { hasText: 'Texto pegado' });
  await expect(tarjeta).toContainText('3 movimientos');
  await expect(tarjeta).toContainText('Cuadra con los saldos del banco');
  v.comprobar();
});
