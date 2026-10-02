import { sumar, type Centimos } from './dinero';
import type { DatosPagadorRenta, EntradaIRPF } from './irpf';
import { compararPeriodos, idMes, importeGasto, type Ajustes, type Periodo } from './modelo';
import type { DatosFinancieros } from './resumen';

export interface EntradaRentaAnio {
  entrada: EntradaIRPF;
  /** Meses del año ya pasados (o en curso) sin ningún dato ni confirmación. */
  mesesSinRegistrar: number[];
  /** Bruto previsto de pagadores tipo Empresa aún no cobrado (para sugerir retención). */
  brutoPendienteEmpresa: Centimos;
  hayPrevistos: boolean;
  /** De dónde sale el alquiler usado. */
  origenAlquiler: 'manual' | 'gastos';
  /** Ingresos importados del banco a los que aún les faltan bruto, SS y retención. */
  pendientesNomina: number;
}

export function edadA31Diciembre(anioNacimiento: number | null, ejercicio: number): number | null {
  if (anioNacimiento === null) return null;
  const edad = ejercicio - anioNacimiento;
  return edad >= 0 && edad < 130 ? edad : null;
}

export function prepararRenta(
  d: DatosFinancieros,
  anio: number,
  ajustes: Ajustes,
  incluirPrevistos: boolean,
  hoy: Periodo,
): EntradaRentaAnio {
  const ingresosAnio = d.ingresos.filter((i) => i.anio === anio && (incluirPrevistos || i.estado === 'Real'));
  const porPagador = new Map<string, DatosPagadorRenta>();
  for (const i of ingresosAnio) {
    const pagador = d.pagadores.find((p) => p.id === i.pagadorId);
    const actual = porPagador.get(i.pagadorId) ?? {
      pagadorId: i.pagadorId,
      nombre: pagador?.nombre ?? 'Pagador eliminado',
      tipo: pagador?.tipo ?? 'Otro',
      bruto: 0,
      seguridadSocial: 0,
      retencion: 0,
    };
    actual.bruto += i.bruto;
    actual.seguridadSocial += i.seguridadSocial;
    actual.retencion += i.retencionIRPF;
    porPagador.set(i.pagadorId, actual);
  }

  const propinas = sumar(d.extras.filter((e) => e.anio === anio && e.concepto === 'Propinas').map((e) => e.importe));

  const idsAlquiler = new Set(d.categorias.filter((c) => c.clave === 'alquiler').map((c) => c.id));
  const alquilerGastos = sumar(d.gastos.filter((g) => g.anio === anio && idsAlquiler.has(g.categoriaId)).map(importeGasto));
  const origenAlquiler = ajustes.alquilerAnualManual !== null ? 'manual' : 'gastos';
  const alquilerAnual = ajustes.alquilerAnualManual ?? alquilerGastos;

  const conDatos = new Set<string>([
    ...d.ingresos.filter((x) => x.anio === anio).map((x) => idMes(x.anio, x.mes)),
    ...d.extras.filter((x) => x.anio === anio).map((x) => idMes(x.anio, x.mes)),
    ...d.gastos.filter((x) => x.anio === anio).map((x) => idMes(x.anio, x.mes)),
    ...d.meses.filter((x) => x.anio === anio && x.confirmado).map((x) => x.id),
  ]);
  const mesesSinRegistrar: number[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    if (compararPeriodos({ anio, mes }, hoy) > 0) break;
    if (!conDatos.has(idMes(anio, mes))) mesesSinRegistrar.push(mes);
  }

  const idsEmpresa = new Set(d.pagadores.filter((p) => p.tipo === 'Empresa').map((p) => p.id));
  const brutoPendienteEmpresa = sumar(
    d.ingresos
      .filter((i) => i.anio === anio && i.estado === 'Previsto' && idsEmpresa.has(i.pagadorId))
      .map((i) => i.bruto),
  );

  return {
    entrada: {
      pagadores: [...porPagador.values()].sort((a, b) => b.bruto - a.bruto),
      propinas,
      edad: edadA31Diciembre(ajustes.anioNacimiento, anio),
      alquilerANombre: ajustes.alquilerANombre,
      alquilerAnual,
    },
    mesesSinRegistrar,
    brutoPendienteEmpresa,
    hayPrevistos: d.ingresos.some((i) => i.anio === anio && i.estado === 'Previsto'),
    origenAlquiler,
    pendientesNomina: d.ingresos.filter((i) => i.anio === anio && i.pendienteNomina).length,
  };
}
