import { sumar, type Centimos } from './dinero';
import { importeGasto, type Periodo } from './modelo';
import type { DatosFinancieros } from './resumen';

/** Cómo se ha movido el dinero en el mes, cuenta por cuenta: de dónde entra, adónde va y cuánto queda. */
export interface FlujoCuenta {
  cuenta: string;
  entradas: Centimos;
  gastos: Centimos;
  traspasosRecibidos: Centimos;
  traspasosEnviados: Centimos;
  aHuchas: Centimos;
  /** entradas + recibidos − gastos − enviados − huchas */
  variacion: Centimos;
}

export const SIN_CUENTA = 'Apuntado a mano';

export function flujoMes(d: DatosFinancieros, p: Periodo): FlujoCuenta[] {
  const enMes = (x: { anio: number; mes: number }) => x.anio === p.anio && x.mes === p.mes;
  const cuentas = new Map<string, FlujoCuenta>();
  const de = (c: string | undefined) => {
    const k = c ?? SIN_CUENTA;
    let f = cuentas.get(k);
    if (!f) {
      f = { cuenta: k, entradas: 0, gastos: 0, traspasosRecibidos: 0, traspasosEnviados: 0, aHuchas: 0, variacion: 0 };
      cuentas.set(k, f);
    }
    return f;
  };
  for (const i of d.ingresos.filter(enMes)) de(i.cuenta).entradas += i.neto;
  for (const e of d.extras.filter(enMes)) de(e.cuenta).entradas += e.importe;
  for (const g of d.gastos.filter(enMes)) de(g.cuenta).gastos += importeGasto(g);
  for (const t of d.traspasos.filter(enMes)) {
    const f = de(t.cuenta);
    if (t.tipo === 'hucha') f.aHuchas -= t.importe;
    else if (t.tipo === 'interno') {
      if (t.importe < 0) f.traspasosEnviados -= t.importe;
      else f.traspasosRecibidos += t.importe;
    }
  }
  const lista = [...cuentas.values()];
  for (const f of lista) f.variacion = f.entradas + f.traspasosRecibidos - f.gastos - f.traspasosEnviados - f.aHuchas;
  // Primero las cuentas donde entra el dinero (la de la nómina), al final lo apuntado a mano.
  return lista.sort((a, b) => (a.cuenta === SIN_CUENTA ? 1 : b.cuenta === SIN_CUENTA ? -1 : b.entradas - a.entradas));
}

export function totalFlujo(f: readonly FlujoCuenta[]): { entradas: Centimos; gastos: Centimos; aHuchas: Centimos } {
  return { entradas: sumar(f.map((x) => x.entradas)), gastos: sumar(f.map((x) => x.gastos)), aHuchas: sumar(f.map((x) => x.aHuchas)) };
}
