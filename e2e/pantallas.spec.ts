import { expect, test } from '@playwright/test';
import { abrir, DIR, importar, vigilar } from './utiles';

test.beforeEach(async ({ page: p }) => {
  await importar(p, [`${DIR}/santander.xlsx`, `${DIR}/revolut.csv`]);
  await expect(p.getByText(/Cuadra con los saldos/)).toHaveCount(2);
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.locator('li.fila', { hasText: 'Amzn Mktp' }).getByLabel('Categoría').selectOption({ label: 'Hogar' });
  await p.locator('li.fila', { hasText: 'Bizum enviado' }).getByLabel('Categoría').selectOption({ label: 'Restaurantes y bares' });
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Importación completada' })).toBeVisible();
});

test('Futuro: previsión por horizontes, origen de cada cifra y simulación aparte', async ({ page: p }) => {
  const v = vigilar(p);
  await abrir(p, 'ajustes');
  const rec = p.locator('section', { has: p.getByRole('heading', { name: 'Pagos recurrentes' }) });
  await rec.getByRole('button', { name: '+ Añadir a mano' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('Alquiler piso');
  await dlg.getByLabel('Categoría').selectOption({ label: 'Alquiler' });
  await dlg.getByLabel('Importe (€)').fill('650');
  await dlg.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(rec).toContainText('Alquiler piso');

  await abrir(p, 'futuro');
  await p.getByText('365 días').click();
  await expect(p.locator('li.fila')).toHaveCount(12);
  await p.locator('li.fila button').first().click();
  await expect(p.locator('li.fila').first()).toContainText('Planificado');
  await expect(p.locator('li.fila').first()).toContainText('Alquiler piso');
  await p.getByLabel('Gastar menos al mes (€)').fill('100');
  await expect(p.locator('section', { has: p.getByRole('heading', { name: '¿Y si…?' }) })).toContainText('+1200,00');
  v.comprobar();
});

test('Ahorro: objetivo con progreso, escenarios y aportaciones', async ({ page: p }) => {
  const v = vigilar(p);
  await abrir(p, 'ahorro');
  await p.getByRole('button', { name: '+ Nuevo objetivo' }).click();
  await p.getByLabel('Nombre').fill('Viaje a Japón');
  await p.getByLabel('Cantidad objetivo (€)').fill('2.000');
  await p.getByLabel('Ya apartado (€)').fill('300');
  await p.getByLabel('Aportación al mes (€)').fill('150');
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  const obj = p.locator('section', { has: p.getByRole('heading', { name: 'Objetivos de ahorro' }) });
  await expect(obj).toContainText('Falta 1700,00');
  await expect(obj).toContainText('/mes →');
  await obj.getByRole('button', { name: 'Aportar' }).click();
  await p.getByLabel('Importe (€)').fill('50');
  await p.getByRole('dialog').getByRole('button', { name: 'Aportar' }).click();
  await expect(obj).toContainText('350,00 € de 2000,00 €');
  v.comprobar();
});

test('Preguntar: respuestas exactas con evidencia y sin inventar', async ({ page: p }) => {
  const v = vigilar(p);
  await abrir(p, 'preguntar');
  await p.getByLabel('Tu pregunta').fill('¿Cuánto gasté en restaurantes en marzo de 2026?');
  await p.getByRole('button', { name: 'Preguntar', exact: true }).click();
  const r = p.locator('section[aria-labelledby="t-resp"]');
  await expect(r).toContainText('Has gastado 53,00 € en Restaurantes y bares (marzo 2026)');
  await expect(r).toContainText('2 movimientos en 1 mes: 2 importados del banco');
  await p.getByLabel('Tu pregunta').fill('hola');
  await p.getByRole('button', { name: 'Preguntar', exact: true }).click();
  await expect(p.getByText('No he entendido la pregunta')).toBeVisible();
  v.comprobar();
});
