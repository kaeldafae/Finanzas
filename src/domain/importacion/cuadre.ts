import type { Centimos } from '../dinero';
import type { MovimientoBruto } from './formatos';

/**
 * Comprueba que el extracto está completo y bien leído: cada saldo debe ser el anterior más el movimiento.
 * Si falta una fila o un importe se ha leído mal, el saldo deja de cuadrar justo ahí.
 *
 * Los bancos ordenan distinto (Santander suele listar del más reciente al más antiguo) y Revolut puede
 * descontar la comisión en el saldo: se prueban las combinaciones y se elige la que cuadra.
 */

export interface Descuadre {
  fila: number;
  esperado: Centimos;
  real: Centimos;
}

export interface ResultadoCuadre {
  estado: 'ok' | 'sin-saldo' | 'descuadre';
  /** Movimientos en orden cronológico. */
  ordenados: MovimientoBruto[];
  saldoInicial: Centimos | null;
  saldoFinal: Centimos | null;
  descuadres: Descuadre[];
  comprobados: number;
}

function comprobar(movs: readonly MovimientoBruto[], restaComision: boolean): { descuadres: Descuadre[]; comprobados: number } {
  const descuadres: Descuadre[] = [];
  let comprobados = 0;
  let anterior: MovimientoBruto | null = null;
  for (const m of movs) {
    if (m.saldo === null) continue;
    if (anterior?.saldo != null) {
      const esperado = anterior.saldo + m.importe - (restaComision ? m.comision : 0);
      comprobados++;
      if (esperado !== m.saldo) descuadres.push({ fila: m.fila, esperado, real: m.saldo });
    }
    anterior = m;
  }
  return { descuadres, comprobados };
}

export function cuadrar(movimientos: readonly MovimientoBruto[]): ResultadoCuadre {
  const archivo = [...movimientos];
  const inverso = [...movimientos].reverse();
  const conSaldo = movimientos.filter((m) => m.saldo !== null).length;

  // Orden cronológico por defecto: por fecha, respetando el orden del archivo dentro del mismo día.
  const cronologico = (lista: MovimientoBruto[]) => {
    const primera = lista[0]?.fecha ?? '';
    const ultima = lista[lista.length - 1]?.fecha ?? '';
    return primera <= ultima ? lista : [...lista].reverse();
  };

  if (conSaldo < 2) {
    const ordenados = cronologico(archivo);
    return { estado: 'sin-saldo', ordenados, saldoInicial: null, saldoFinal: null, descuadres: [], comprobados: 0 };
  }

  const opciones = [
    { lista: archivo, resta: false },
    { lista: archivo, resta: true },
    { lista: inverso, resta: false },
    { lista: inverso, resta: true },
  ].map((o) => ({ ...o, ...comprobar(o.lista, o.resta) }));
  opciones.sort((a, b) => a.descuadres.length - b.descuadres.length);
  const mejor = opciones[0];
  if (!mejor) throw new Error('inalcanzable');

  const ordenados = mejor.descuadres.length === 0 ? mejor.lista : cronologico(mejor.lista);
  const primero = ordenados.find((m) => m.saldo !== null);
  const ultimo = [...ordenados].reverse().find((m) => m.saldo !== null);
  const saldoInicial = primero?.saldo != null ? primero.saldo - primero.importe + (mejor.resta ? primero.comision : 0) : null;
  return {
    estado: mejor.descuadres.length === 0 ? 'ok' : 'descuadre',
    ordenados,
    saldoInicial,
    saldoFinal: ultimo?.saldo ?? null,
    descuadres: mejor.descuadres,
    comprobados: mejor.comprobados,
  };
}
