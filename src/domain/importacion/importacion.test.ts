import { describe, expect, it } from 'vitest';
import { euros } from '../dinero';
import { clasificar, limpiarConcepto, UMBRAL_REVISION } from './clasificar';
import { cuadrar } from './cuadre';
import { leerExtracto, type MovimientoBruto } from './formatos';
import { construirFilas, informe, necesitaRevision, prepararImportacion, validarDecision, type Decision, type ExtractoLeido } from './importar';
import { leerCsv, type Celda } from './texto';

// Extracto de Revolut (formato CSV de la app). Datos inventados.
const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
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
`;

// Extracto tipo Santander: título, titular, cabecera en la fila 5, del más reciente al más antiguo, coma decimal.
const SANTANDER: Celda[][] = [
  ['Banco Santander'],
  ['Consulta de movimientos'],
  ['Titular: XXXXX'],
  [null],
  ['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Saldo'],
  ['05/03/2026', '05/03/2026', 'Bizum enviado a JUAN GARCIA LOPEZ cena', '-15,00', '1.135,00'],
  ['02/03/2026', '02/03/2026', 'Recibo Endesa Energia Sau Nº Recibo 0049 1234567', '-48,20', '1.150,00'],
  ['01/03/2026', '01/03/2026', 'Transferencia A Favor De Revolut Ltd Concepto Ahorro', '-600,00', '1.198,20'],
  ['28/02/2026', '28/02/2026', 'Nomina Hoteles Ibiza Sl', '1.798,20', '1.798,20'],
];

function lectura(filas: readonly (readonly Celda[])[]) {
  const l = leerExtracto(filas);
  if (!l) throw new Error('no reconocido');
  return l;
}

describe('lectura de formatos', () => {
  it('Revolut: columnas, estados, divisas y comisiones', () => {
    const l = lectura(leerCsv(REVOLUT));
    expect(l.formato).toBe('revolut');
    expect(l.banco).toBe('Revolut');
    expect(l.mapeo.decimal).toBe('.');
    expect(l.movimientos).toHaveLength(10);
    expect(l.descartados).toEqual([{ fila: 7, motivo: 'Operación no completada (reverted)' }]);
    const atm = l.movimientos.find((m) => m.tipoBanco === 'ATM');
    expect(atm?.importe).toBe(-5000);
    expect(atm?.comision).toBe(100);
  });

  it('Santander: encuentra la cabecera tras las filas de título y lee coma decimal', () => {
    const l = lectura(SANTANDER);
    expect(l.formato).toBe('santander');
    expect(l.mapeo.filaCabecera).toBe(4);
    expect(l.mapeo.decimal).toBe(',');
    expect(l.movimientos.map((m) => m.importe)).toEqual([-1500, -4820, -60000, 179820]);
    expect(l.movimientos[3]?.fecha).toBe('2026-02-28');
  });

  it('formato desconocido → null (se pedirá elegir columnas)', () => {
    expect(leerExtracto([['a', 'b'], ['1', '2']])).toBeNull();
  });
});

describe('cuadre de saldos', () => {
  it('Revolut cuadra, descontando la comisión del cajero', () => {
    const c = cuadrar(lectura(leerCsv(REVOLUT)).movimientos);
    expect(c.estado).toBe('ok');
    expect(c.saldoInicial).toBe(0);
    expect(c.saldoFinal).toBe(31503);
  });

  it('Santander (orden inverso) cuadra y se devuelve en orden cronológico', () => {
    const c = cuadrar(lectura(SANTANDER).movimientos);
    expect(c.estado).toBe('ok');
    expect(c.ordenados[0]?.fecha).toBe('2026-02-28');
    expect(c.saldoInicial).toBe(0);
    expect(c.saldoFinal).toBe(113500);
  });

  it('una fila que falta o un importe mal leído se detecta exactamente', () => {
    const movs = lectura(SANTANDER).movimientos.filter((m) => !m.concepto.startsWith('Recibo'));
    const c = cuadrar(movs);
    expect(c.estado).toBe('descuadre');
    expect(c.descuadres).toHaveLength(1);
  });
});

describe('limpieza y clasificación', () => {
  const sinReglas = new Map();
  const mov = (concepto: string, importe: number, extra: Partial<MovimientoBruto> = {}): MovimientoBruto => ({
    fila: 1, fecha: '2026-03-01', concepto, importe: euros(importe), comision: 0, saldo: null, tipoBanco: null, producto: null, ...extra,
  });

  it('quita tarjetas, referencias, fechas y nombres de personas', () => {
    const l = limpiarConcepto('COMPRA TARJ. 5540XXXXXXXX1234 MERCADONA IBIZA 01/03 FECHA OPERACION', -1000);
    expect(l.comercio).toBe('Mercadona Ibiza');
    expect(l.clave).toBe('mercadona');
    const b = limpiarConcepto('Bizum enviado a JUAN GARCIA LOPEZ cena', -1500);
    expect(b.comercio).toBe('Bizum enviado');
    expect(JSON.stringify(b)).not.toMatch(/JUAN|GARCIA/i);
  });

  it.each([
    ['Mercadona', -45, 'gasto', 'comida'],
    ['Recibo Endesa Energia Sau', -48, 'gasto', 'suministros'],
    ['Netflix.com', -13, 'gasto', 'suscripciones'],
    ['Farmacia Vara de Rey', -9, 'gasto', 'salud'],
    ['Repsol Sant Josep', -50, 'gasto', 'transporte'],
    ['Pacha Ibiza', -60, 'gasto', 'ocio'],
    ['Cajero Santander', -50, 'gasto', 'efectivo'],
    ['Comision mantenimiento', -3, 'gasto', 'comisiones'],
  ] as const)('%s → %s/%s', (c, i, destino, categoria) => {
    const p = clasificar(mov(c, i), sinReglas);
    expect(p.destino).toBe(destino);
    expect(p.categoria).toBe(categoria);
    expect(p.confianza).toBeGreaterThanOrEqual(UMBRAL_REVISION);
  });

  it('ingresos: nómina, SEPE e intereses', () => {
    expect(clasificar(mov('Nomina Hoteles Ibiza Sl', 1800), sinReglas)).toMatchObject({ destino: 'ingreso', pagador: 'Empresa' });
    expect(clasificar(mov('Prestacion Desempleo Sepe', 1050), sinReglas)).toMatchObject({ destino: 'ingreso', pagador: 'SEPE' });
    expect(clasificar(mov('Liquidacion de intereses', 0.12), sinReglas).destino).toBe('extra');
  });

  it('lo dudoso va a revisión: Amazon, Bizum, desconocidos y entradas sin identificar', () => {
    for (const [c, i] of [['AMZN Mktp ES', -20], ['Bizum enviado a ALGUIEN', -15], ['XKCD SOLUTIONS 334', -12], ['Ingreso varios', 50]] as const) {
      expect(clasificar(mov(c, i), sinReglas).confianza).toBeLessThan(UMBRAL_REVISION);
    }
  });

  it('una regla aprendida manda sobre el diccionario', () => {
    const reglas = new Map([['amzn mktp', { categoriaId: 'cat-hogar', tipo: 'Variable' as const }]]);
    expect(clasificar(mov('AMZN Mktp ES', -20), reglas)).toMatchObject({ categoriaId: 'cat-hogar', confianza: 1 });
  });

  it('Revolut: recarga, hucha, cambio de divisa y devolución', () => {
    expect(clasificar(mov('Transfer from X', 600, { tipoBanco: 'TOPUP' }), sinReglas).destino).toBe('interno');
    expect(clasificar(mov('To pocket EUR Viaje', -100, { tipoBanco: 'TRANSFER', producto: 'Savings' }), sinReglas).destino).toBe('hucha');
    expect(clasificar(mov('Exchanged to USD', -10, { tipoBanco: 'EXCHANGE' }), sinReglas).destino).toBe('divisa');
    expect(clasificar(mov('Mercadona', 5.3, { tipoBanco: 'CARD_REFUND' }), sinReglas)).toMatchObject({ destino: 'gasto', categoria: 'comida', devolucion: true });
  });
});

describe('importación completa Santander + Revolut', () => {
  async function preparar(existentes = new Set<string>()) {
    const extractos: ExtractoLeido[] = [
      { cuenta: 'Santander', lectura: lectura(SANTANDER), cuadre: cuadrar(lectura(SANTANDER).movimientos) },
      { cuenta: 'Revolut', lectura: lectura(leerCsv(REVOLUT)), cuadre: cuadrar(lectura(leerCsv(REVOLUT)).movimientos) },
    ];
    return prepararImportacion(extractos, new Map(), existentes);
  }

  it('empareja el traspaso Santander → Revolut y no lo cuenta como gasto ni ingreso', async () => {
    const movs = await preparar();
    const salida = movs.find((m) => m.cuenta === 'Santander' && m.importe === -60000);
    const entrada = movs.find((m) => m.cuenta === 'Revolut' && m.importe === 60000);
    expect(salida?.propuesta.destino).toBe('interno');
    expect(entrada?.propuesta.destino).toBe('interno');
    expect(salida?.pareja).toBe(entrada?.id);
  });

  it('separa la comisión del cajero, detecta Netflix como recurrente y genera huellas estables', async () => {
    const a = await preparar();
    expect(a.find((m) => m.id.endsWith('-comision'))?.importe).toBe(-100);
    expect(a.filter((m) => m.propuesta.limpio.clave === 'netflix' && m.recurrente)).toHaveLength(2);
    const b = await preparar();
    expect(b.map((m) => m.id)).toEqual(a.map((m) => m.id));
  });

  it('reimportar el mismo extracto no duplica nada', async () => {
    const a = await preparar();
    const b = await preparar(new Set(a.map((m) => m.id)));
    expect(b.every((m) => m.duplicado)).toBe(true);
    expect(b.filter(necesitaRevision)).toHaveLength(0);
  });

  it('construye las filas y el informe cuadra al céntimo con los extractos', async () => {
    const movs = await preparar();
    const cat = (c: string | null) => `cat-${c ?? 'otros'}`;
    const decisiones = new Map<string, Decision>(
      movs.map((m) => [m.id, {
        incluir: true,
        destino: m.propuesta.destino,
        categoriaId: m.propuesta.categoriaId ?? cat(m.propuesta.categoria),
        tipoGasto: m.propuesta.tipoGasto,
        pagadorId: m.propuesta.pagador === 'Empresa' ? 'pag-empresa' : m.propuesta.pagador === 'SEPE' ? 'pag-sepe' : null,
        conceptoExtra: 'Otro',
        recordar: true,
      }]),
    );
    for (const m of movs) expect(validarDecision(m, decisiones.get(m.id) as Decision)).toBeNull();
    let n = 0;
    const filas = construirFilas(movs, decisiones, () => `id${n++}`);
    const inf = informe(filas);

    // Lo que sale de las cuentas hacia fuera (sin traspasos, huchas ni divisas) = gastos del informe.
    const externos = movs.filter((m) => !['interno', 'hucha', 'divisa'].includes(m.propuesta.destino));
    const gastosEsperados = -externos.filter((m) => m.propuesta.destino === 'gasto').reduce((s, m) => s + m.importe, 0);
    expect(inf.gastos).toBe(gastosEsperados);
    expect(inf.ingresos).toBe(179820);
    expect(filas.ingresos[0]?.pendienteNomina).toBe(true);
    expect(filas.gastos.find((g) => g.devolucion)?.importe).toBe(530);
    expect(filas.traspasos.map((t) => t.tipo).sort()).toEqual(['divisa', 'hucha', 'interno', 'interno']);
    expect(inf.meses.find((m) => m.mes === 3)?.aHuchas).toBe(10000);
    // Presupuesto: febrero (solo nómina) no cuenta; marzo y abril sí. Comida: mediana de [40, 0] = 20 €.
    const comida = inf.presupuestoSugerido.find((x) => x.categoriaId === 'cat-comida');
    expect(comida?.importe).toBe(2000);
    expect(inf.presupuestoSugerido.find((x) => x.categoriaId === 'cat-suscripciones')?.importe).toBe(1300);
    // Las reglas no guardan nombres de personas (Bizum no genera regla).
    expect(filas.reglas.map((r) => r.id)).not.toContain('');
    expect(JSON.stringify(filas)).not.toMatch(/JUAN|GARCIA|MICHAEL|PEREZ/i);
  });
});
