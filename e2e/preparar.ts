import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import writeXlsxFile from 'write-excel-file/node';
import { DIR } from './utiles';

/** Genera los archivos de prueba (datos inventados) antes de las pruebas. */
export default async function preparar(): Promise<void> {
  mkdirSync(DIR, { recursive: true });

  const santander = [
    ['Banco Santander'], ['Consulta de movimientos'], ['Titular: XXXXX'], [null],
    ['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Saldo'],
    ['05/03/2026', '05/03/2026', 'Bizum enviado a JUAN GARCIA LOPEZ cena', -15, 1135],
    ['02/03/2026', '02/03/2026', 'Recibo Endesa Energia Sau Nº Recibo 0049 1234567', -48.2, 1150],
    ['01/03/2026', '01/03/2026', 'Transferencia A Favor De Revolut Ltd Concepto Ahorro', -600, 1198.2],
    ['28/02/2026', '28/02/2026', 'Nomina Hoteles Ibiza Sl', 1798.2, 1798.2],
  ].map((r) => r.map((v) => (v === null ? null : { value: v })));
  await writeXlsxFile(santander).toFile(`${DIR}/santander.xlsx`);

  // El mismo extracto abierto como CSV en Excel/Numbers y guardado con todo en una sola columna.
  const unaColumna = [
    'Consulta de movimientos Santander,,,,,,', ',,,,,,', 'Fecha Operación,Fecha Valor,Concepto,Importe,Divisa,Saldo,Divisa',
    '05/03/2026,05/03/2026,Bizum enviado a JUAN GARCIA LOPEZ cena,"-15,00",EUR,"1.135,00",EUR',
    '02/03/2026,02/03/2026,Recibo Endesa Energia Sau,"-48,20",EUR,"1.150,00",EUR',
    '01/03/2026,01/03/2026,Transferencia A Favor De Revolut Ltd,"-600,00",EUR,"1.198,20",EUR',
    '28/02/2026,28/02/2026,Nomina Hoteles Ibiza Sl,"1.798,20",EUR,"1.798,20",EUR',
  ].map((l) => [{ value: l }]);
  await writeXlsxFile(unaColumna).toFile(`${DIR}/santander-una-columna.xlsx`);

  writeFileSync(`${DIR}/revolut.csv`, `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TOPUP,Current,2026-03-01 09:00:00,2026-03-01 09:00:05,Transfer from MICHAEL PEREZ,600.00,0.00,EUR,COMPLETED,600.00
CARD_PAYMENT,Current,2026-03-02 13:10:00,2026-03-03 08:00:00,Mercadona,-45.30,0.00,EUR,COMPLETED,554.70
CARD_PAYMENT,Current,2026-03-04 22:00:00,2026-03-05 08:00:00,Taberna Sa Punta,-38.00,0.00,EUR,COMPLETED,516.70
CARD_PAYMENT,Current,2026-03-05 10:00:00,2026-03-05 10:00:00,Netflix.com,-12.99,0.00,EUR,COMPLETED,503.71
TRANSFER,Savings,2026-03-06 10:00:00,2026-03-06 10:00:00,To pocket EUR Viaje,-100.00,0.00,EUR,COMPLETED,403.71
CARD_PAYMENT,Current,2026-03-07 10:00:00,,Amazon,-20.00,0.00,EUR,REVERTED,
ATM,Current,2026-03-08 11:00:00,2026-03-08 11:00:00,Cash at Banco Santander,-50.00,1.00,EUR,COMPLETED,352.71
CARD_PAYMENT,Current,2026-03-09 12:00:00,2026-03-09 12:00:00,AMZN Mktp ES,-19.99,0.00,EUR,COMPLETED,332.72
CARD_REFUND,Current,2026-03-10 12:00:00,2026-03-10 12:00:00,Mercadona,5.30,0.00,EUR,COMPLETED,338.02
EXCHANGE,Current,2026-03-11 12:00:00,2026-03-11 12:00:00,Exchanged to USD,-10.00,0.00,EUR,COMPLETED,328.02
CARD_PAYMENT,Current,2026-04-05 10:00:00,2026-04-05 10:00:00,Netflix.com,-12.99,0.00,EUR,COMPLETED,315.03
`);

  const navegador = await chromium.launch();
  const p = await navegador.newPage({ deviceScaleFactor: 2, viewport: { width: 960, height: 700 } });

  // Extracto de Revolut en PDF (los mismos movimientos que el CSV; el cajero con la comisión sumada).
  const movs = [
    ['1 mar 2026', 'Recarga de *1234', '', '600,00 €', '600,00 €'],
    ['3 mar 2026', 'Mercadona<br><small>Tarjeta: 537410******1234</small>', '45,30 €', '', '554,70 €'],
    ['5 mar 2026', 'Taberna Sa Punta', '38,00 €', '', '516,70 €'],
    ['5 mar 2026', 'Netflix.com', '12,99 €', '', '503,71 €'],
    ['6 mar 2026', 'Al pocket EUR Viaje', '100,00 €', '', '403,71 €'],
    ['8 mar 2026', 'Retirada de efectivo en Banco Santander<br><small>Comisión: 1,00 €</small>', '51,00 €', '', '352,71 €'],
    ['9 mar 2026', 'AMZN Mktp ES', '19,99 €', '', '332,72 €'],
    ['10 mar 2026', 'Reembolso de Mercadona', '', '5,30 €', '338,02 €'],
    ['11 mar 2026', 'Cambiado a USD', '10,00 €', '', '328,02 €'],
    ['5 abr 2026', 'Netflix.com', '12,99 €', '', '315,03 €'],
  ];
  const fila = (m: readonly string[]) => `<tr><td>${m[0] ?? ''}</td><td>${m[1] ?? ''}</td><td class=n>${m[2] ?? ''}</td><td class=n>${m[3] ?? ''}</td><td class=n>${m[4] ?? ''}</td></tr>`;
  const cab = '<tr><th>Fecha</th><th>Descripción</th><th class=n>Dinero saliente</th><th class=n>Dinero entrante</th><th class=n>Saldo</th></tr>';
  const estilo = '<style>body{font:10px Helvetica,Arial,sans-serif;margin:0}table{width:100%;border-collapse:collapse;margin:8px 0}td,th{padding:5px 6px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}small{color:#666}h2{font-size:13px;margin:16px 0 4px}.pie{font-size:7px;color:#888;margin-top:40px}.salto{page-break-before:always}</style>';
  await p.setContent(`<!doctype html><meta charset=utf-8>${estilo}
<p><b>Revolut Bank UAB</b> &nbsp; Extracto en EUR</p>
<h2>Resumen del saldo</h2>
<table><tr><th>Producto</th><th class=n>Saldo inicial</th><th class=n>Dinero saliente</th><th class=n>Dinero entrante</th><th class=n>Saldo final</th></tr>
<tr><td>Cuenta (Corriente)</td><td class=n>0,00 €</td><td class=n>290,27 €</td><td class=n>605,30 €</td><td class=n>315,03 €</td></tr></table>
<h2>Transacciones de la cuenta del 1 de marzo de 2026 al 30 de abril de 2026</h2>
<table>${cab}${movs.slice(0, 6).map(fila).join('')}</table>
<p class=pie>Revolut Bank UAB está autorizado y regulado por el Banco de Lituania. Los depósitos están protegidos por el sistema de garantía de depósitos de Lituania hasta 100.000 €. Página 1 de 2</p>
<div class=salto></div>
<table>${cab}${movs.slice(6).map(fila).join('')}</table>
<h2>Transacciones pendientes desde 30 abr 2026</h2>
<table>${cab}${fila(['30 abr 2026', 'Amazon', '20,00 €', '', ''])}</table>
<h2>Hucha Viaje</h2>
<table>${cab}${fila(['6 mar 2026', 'Desde la cuenta corriente', '', '100,00 €', '100,00 €'])}</table>`);
  await p.pdf({ path: `${DIR}/revolut.pdf`, format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });

  // Nómina (modelo oficial de recibo de salarios), con el mismo neto que la nómina del banco.
  const f4 = (a: string, b = '', c = '', d = '') => `<tr><td>${a}</td><td class=n>${b}</td><td class=n>${c}</td><td class=n>${d}</td></tr>`;
  await p.setContent(`<!doctype html><meta charset=utf-8>${estilo}
<p><b>RECIBO INDIVIDUAL JUSTIFICATIVO DEL PAGO DE SALARIOS</b></p>
<p>Empresa: HOTELES IBIZA SL &nbsp;&nbsp;&nbsp; Periodo de liquidación: del 01/02/2026 al 28/02/2026</p>
<table>${f4('I. DEVENGOS', '', '', 'TOTALES')}${f4('Salario base', '', '', '1.700,00')}${f4('Plus transporte', '', '', '450,00')}${f4('A. TOTAL DEVENGADO', '', '', '2.150,00')}
${f4('II. DEDUCCIONES')}${f4('Contingencias comunes', '2.150,00', '4,70', '101,05')}${f4('Desempleo', '2.150,00', '1,55', '33,33')}${f4('Formación profesional', '2.150,00', '0,10', '2,15')}${f4('MEI', '2.150,00', '0,13', '2,80')}
${f4('Impuesto sobre la renta de las personas físicas', '2.150,00', '9,88', '212,47')}${f4('B. TOTAL A DEDUCIR', '', '', '351,80')}${f4('LÍQUIDO TOTAL A PERCIBIR (A - B)', '', '', '1.798,20')}</table>`);
  await p.pdf({ path: `${DIR}/nomina.pdf`, format: 'A4' });

  // Foto de un extracto y el mismo extracto escaneado dentro de un PDF (sin texto).
  const cortos = movs.slice(0, 4).map((m) => [m[0] ?? '', (m[1] ?? '').replace(/<br>.*$/, ''), m[2] ?? '', m[3] ?? '', m[4] ?? '']);
  await p.setContent(`<!doctype html><meta charset=utf-8><style>body{font:16px Arial;margin:30px;width:900px;background:#fff}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{padding:8px;text-align:left}.n{text-align:right}</style>
<p><b>Revolut Bank UAB</b> Extracto en EUR</p><p><b>Resumen del saldo</b></p>
<table><tr><th>Producto</th><th class=n>Saldo inicial</th><th class=n>Dinero saliente</th><th class=n>Dinero entrante</th><th class=n>Saldo final</th></tr>
<tr><td>Cuenta</td><td class=n>0,00 €</td><td class=n>96,29 €</td><td class=n>600,00 €</td><td class=n>503,71 €</td></tr></table>
<p><b>Transacciones de la cuenta</b></p><table>${cab}${cortos.map(fila).join('')}</table>`);
  await p.screenshot({ path: `${DIR}/extracto-foto.png`, fullPage: true });
  const png = readFileSync(`${DIR}/extracto-foto.png`).toString('base64');
  await p.setContent(`<img src="data:image/png;base64,${png}" style="width:100%">`);
  await p.pdf({ path: `${DIR}/escaneado.pdf`, format: 'A4' });
  await navegador.close();
}
