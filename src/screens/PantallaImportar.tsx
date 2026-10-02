import { useMemo, useRef, useState } from 'react';
import { formatearEuros } from '../domain/dinero';
import { ejemplosDeEntrenamiento, entrenar } from '../domain/importacion/aprendizaje';
import { UMBRAL_REVISION } from '../domain/importacion/clasificar';
import { cuadrar } from '../domain/importacion/cuadre';
import { cabecerasCandidatas, extraerMovimientos, leerExtracto, type Mapeo } from '../domain/importacion/formatos';
import {
  construirFilas,
  informe,
  necesitaRevision,
  prepararImportacion,
  validarDecision,
  type Decision,
  type ExtractoLeido,
  type InformeImportacion,
  type MovimientoPropuesto,
} from '../domain/importacion/importar';
import { deducirDecimal, type Celda } from '../domain/importacion/texto';
import { CONCEPTOS_EXTRA, idMes, nombreMes, TIPOS_GASTO, type Categoria, type ClaveCategoria, type ConceptoExtra, type Pagador, type TipoGasto } from '../domain/modelo';
import { aplicarImportacion, guardarPresupuestos, huellasImportadas, reglasAprendidas } from '../db/operaciones';
import { nuevoId } from '../db/db';
import { useEstado } from '../estado';
import { leerArchivoBanco } from '../lib/leerArchivo';
import { Aviso, CampoTexto, Importe, Selector } from '../ui/base';

// --- Utilidades ------------------------------------------------------------------------------

function categoriaPorClave(clave: ClaveCategoria | null, categorias: readonly Categoria[]): string | null {
  if (!clave) return null;
  const activas = categorias.filter((c) => !c.archivada);
  return activas.find((c) => c.clave === clave)?.id ?? activas.find((c) => c.clave === 'otros')?.id ?? null;
}

function pagadorPorTipo(tipo: Pagador['tipo'] | null, pagadores: readonly Pagador[]): string | null {
  if (!tipo) return null;
  const candidatos = pagadores.filter((p) => !p.archivado && p.tipo === tipo);
  return candidatos.length === 1 ? (candidatos[0]?.id ?? null) : null;
}

function decisionInicial(m: MovimientoPropuesto, categorias: readonly Categoria[], pagadores: readonly Pagador[]): Decision {
  return {
    incluir: !m.duplicado,
    destino: m.propuesta.destino,
    categoriaId: m.propuesta.categoriaId ?? categoriaPorClave(m.propuesta.categoria ?? 'otros', categorias),
    tipoGasto: m.propuesta.tipoGasto,
    pagadorId: pagadorPorTipo(m.propuesta.pagador, pagadores),
    conceptoExtra: 'Otro',
    recordar: false,
  };
}

const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const DESTINOS_SALIDA = [
  { valor: 'gasto', texto: 'Gasto' },
  { valor: 'interno', texto: 'Traspaso entre mis cuentas' },
  { valor: 'hucha', texto: 'A hucha / ahorro' },
  { valor: 'divisa', texto: 'Cambio de divisa (ignorar)' },
] as const;
const DESTINOS_ENTRADA = [
  { valor: 'ingreso', texto: 'Nómina o pago del SEPE' },
  { valor: 'extra', texto: 'Otro ingreso' },
  { valor: 'gasto', texto: 'Devolución de una compra' },
  { valor: 'interno', texto: 'Traspaso entre mis cuentas' },
  { valor: 'hucha', texto: 'Desde hucha / ahorro' },
] as const;

// --- Paso 1: archivos ----------------------------------------------------------------------

interface ArchivoCargado {
  nombre: string;
  filas: Celda[][];
  extracto: ExtractoLeido | null;
  error: string | null;
  /** Mapeo manual cuando no se reconocen las columnas. */
  candidatas: { fila: number; cabeceras: string[] } | null;
  aceptarSinCuadre: boolean;
}

function MapeoManual({ archivo, onListo }: { archivo: ArchivoCargado; onListo: (m: Mapeo) => void }) {
  const cand = archivo.candidatas;
  const [fecha, setFecha] = useState('');
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [saldo, setSaldo] = useState('');
  if (!cand) return <Aviso>No encuentro una fila de cabeceras en {archivo.nombre}. ¿Es un extracto de movimientos?</Aviso>;
  const opciones = cand.cabeceras.map((c, i) => ({ c: c || `Columna ${i + 1}`, i }));
  const sel = (etiqueta: string, v: string, set: (x: string) => void, opcional = false) => (
    <Selector etiqueta={etiqueta} valor={v} onCambio={set}>
      <option value="">{opcional ? 'No hay' : 'Elige columna…'}</option>
      {opciones.map((o) => <option key={o.i} value={o.i}>{o.c}</option>)}
    </Selector>
  );
  const listo = fecha !== '' && concepto !== '' && importe !== '';
  return (
    <div>
      <p className="peq">No reconozco las columnas de <strong>{archivo.nombre}</strong>. Indícalas una vez:</p>
      <div className="rejilla-2">
        {sel('Fecha', fecha, setFecha)}
        {sel('Concepto', concepto, setConcepto)}
        {sel('Importe (con signo)', importe, setImporte)}
        {sel('Saldo', saldo, setSaldo, true)}
      </div>
      <button
        type="button"
        className="btn primario bloque"
        disabled={!listo}
        onClick={() => {
          const col = Number(importe);
          onListo({
            formato: 'generico', filaCabecera: cand.fila, fecha: Number(fecha), concepto: Number(concepto), importe: col, cargo: null, abono: null,
            saldo: saldo === '' ? null : Number(saldo), divisa: null, tipo: null, producto: null, estado: null, comision: null,
            decimal: deducirDecimal(archivo.filas.slice(cand.fila + 1, cand.fila + 60).map((r) => r[col] ?? null)),
          });
        }}
      >
        Usar estas columnas
      </button>
    </div>
  );
}

function ResumenArchivo({ a, onCuenta, onAceptar, onQuitar, onMapeo }: { a: ArchivoCargado; onCuenta: (c: string) => void; onAceptar: (v: boolean) => void; onQuitar: () => void; onMapeo: (m: Mapeo) => void }) {
  const ex = a.extracto;
  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ wordBreak: 'break-all' }}>{a.nombre}</strong>
        <button type="button" className="btn compacto" onClick={onQuitar} aria-label={`Quitar ${a.nombre}`}>Quitar</button>
      </div>
      {a.error && <Aviso>{a.error}</Aviso>}
      {!a.error && !ex && <MapeoManual archivo={a} onListo={onMapeo} />}
      {ex && (
        <>
          <CampoTexto etiqueta="Nombre de la cuenta" valor={ex.cuenta} onCambio={onCuenta} ayuda="Usa siempre el mismo nombre para cada banco: así no se duplica nada al volver a importar." maxLength={30} />
          <p className="peq">
            {ex.lectura.movimientos.length} movimientos · del {ex.cuadre.ordenados[0]?.fecha ?? '—'} al {ex.cuadre.ordenados[ex.cuadre.ordenados.length - 1]?.fecha ?? '—'}
            {ex.lectura.descartados.length > 0 && ` · ${ex.lectura.descartados.length} descartados (pendientes, anulados u otra divisa)`}
          </p>
          {ex.cuadre.estado === 'ok' && (
            <p className="peq pos">✓ Cuadra con los saldos del banco: {ex.cuadre.comprobados} comprobaciones. Saldo final {formatearEuros(ex.cuadre.saldoFinal ?? 0)}.</p>
          )}
          {ex.cuadre.estado === 'sin-saldo' && (
            <Aviso titulo="Sin columna de saldo: no se puede comprobar que esté completo">
              <label className="check"><input type="checkbox" checked={a.aceptarSinCuadre} onChange={(e) => onAceptar(e.target.checked)} />Importar igualmente</label>
            </Aviso>
          )}
          {ex.cuadre.estado === 'descuadre' && (
            <Aviso titulo="No cuadra con los saldos del banco">
              <p className="peq">Falta alguna fila o un importe se ha leído mal. Revisa el archivo (o descárgalo de nuevo) antes de importar:</p>
              <ul className="peq" style={{ paddingLeft: 18, margin: 0 }}>
                {ex.cuadre.descuadres.slice(0, 5).map((d) => (
                  <li key={d.fila}>Fila {d.fila}: el saldo debería ser {formatearEuros(d.esperado)} y el banco dice {formatearEuros(d.real)}.</li>
                ))}
              </ul>
            </Aviso>
          )}
        </>
      )}
    </div>
  );
}

// --- Paso 2: revisión ------------------------------------------------------------------------

interface PropsFila {
  m: MovimientoPropuesto;
  d: Decision;
  onCambio: (d: Decision) => void;
  categorias: readonly Categoria[];
  pagadores: readonly Pagador[];
}

function FilaMovimiento({ m, d, onCambio, categorias, pagadores }: PropsFila) {
  const error = validarDecision(m, d);
  const opciones = m.importe < 0 ? DESTINOS_SALIDA : DESTINOS_ENTRADA;
  const dudoso = m.propuesta.confianza < UMBRAL_REVISION;
  return (
    <li className="fila" style={{ display: 'block', opacity: d.incluir ? 1 : 0.55 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span className="principal">
          <strong>{m.propuesta.limpio.comercio}</strong>
          <span className="secundario" style={{ display: 'block' }}>
            {fechaCorta(m.fecha)} · {m.cuenta} · {m.propuesta.motivo}
            {m.recurrente && ' · se repite cada mes'}
          </span>
        </span>
        <Importe c={m.importe} signo />
      </div>
      <div className="rejilla-2" style={{ marginTop: 6 }}>
        <Selector etiqueta="Qué es" valor={d.incluir ? d.destino : 'no'} onCambio={(v) => onCambio(v === 'no' ? { ...d, incluir: false } : { ...d, incluir: true, destino: v as Decision['destino'] })}>
          {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
          <option value="no">No importar</option>
        </Selector>
        {d.incluir && d.destino === 'gasto' && (
          <Selector etiqueta="Categoría" valor={d.categoriaId ?? ''} onCambio={(v) => onCambio({ ...d, categoriaId: v || null })} error={!d.categoriaId ? 'Elige' : undefined}>
            <option value="">Elige…</option>
            {categorias.filter((c) => !c.archivada).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Selector>
        )}
        {d.incluir && d.destino === 'ingreso' && (
          <Selector etiqueta="Pagador" valor={d.pagadorId ?? ''} onCambio={(v) => onCambio({ ...d, pagadorId: v || null })} error={!d.pagadorId ? 'Elige' : undefined}>
            <option value="">Elige…</option>
            {pagadores.filter((p) => !p.archivado).map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.tipo})</option>)}
          </Selector>
        )}
        {d.incluir && d.destino === 'extra' && (
          <Selector etiqueta="Concepto" valor={d.conceptoExtra} onCambio={(v) => onCambio({ ...d, conceptoExtra: v as ConceptoExtra })}>
            {CONCEPTOS_EXTRA.map((c) => <option key={c} value={c}>{c}</option>)}
          </Selector>
        )}
      </div>
      {d.incluir && d.destino === 'gasto' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Selector etiqueta="Tipo" valor={d.tipoGasto} onCambio={(v) => onCambio({ ...d, tipoGasto: v as TipoGasto })}>
            {TIPOS_GASTO.map((t) => <option key={t} value={t}>{t}</option>)}
          </Selector>
          {m.propuesta.limpio.clave && (
            <label className="check peq">
              <input type="checkbox" checked={d.recordar} onChange={(e) => onCambio({ ...d, recordar: e.target.checked })} />
              Recordar para «{m.propuesta.limpio.clave}»
            </label>
          )}
        </div>
      )}
      {d.incluir && error && <span className="error">{error}</span>}
      {dudoso && d.incluir && !error && <span className="peq muted">Revisado por ti al guardar.</span>}
    </li>
  );
}

// --- Paso 3: informe -------------------------------------------------------------------------

function Informe({ inf, pendientesNomina, categorias, onTerminar }: { inf: InformeImportacion; pendientesNomina: number; categorias: readonly Categoria[]; onTerminar: () => void }) {
  const [guardado, setGuardado] = useState(false);
  const nombre = (id: string) => categorias.find((c) => c.id === id)?.nombre ?? 'Sin categoría';
  return (
    <>
      <section className="card">
        <h2>Resumen de lo importado</h2>
        <div className="kpis">
          <div className="kpi"><div className="t">Ingresos</div><div className="v"><Importe c={inf.ingresos} /></div></div>
          <div className="kpi"><div className="t">Gastos</div><div className="v"><Importe c={inf.gastos} /></div></div>
          <div className="kpi"><div className="t">Ahorro</div><div className="v"><Importe c={inf.ahorro} signo /></div></div>
        </div>
        <div className="tabla-scroll" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th scope="col">Mes</th><th scope="col">Ingresos €</th><th scope="col">Gastos €</th><th scope="col">Ahorro €</th><th scope="col">Huchas €</th></tr></thead>
            <tbody>
              {inf.meses.map((m) => (
                <tr key={idMes(m.anio, m.mes)}>
                  <td>{nombreMes(m.mes).slice(0, 3)} {m.anio}</td>
                  <td><Importe cifra c={m.ingresos} /></td>
                  <td><Importe cifra c={m.gastos} /></td>
                  <td><Importe cifra c={m.ahorro} signo /></td>
                  <td><Importe cifra c={m.aHuchas} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pendientesNomina > 0 && (
          <Aviso titulo={`${pendientesNomina} nóminas o pagos del SEPE por completar`}>
            Del banco solo se conoce el neto. Para que la renta salga bien, abre cada uno en su mes y escribe el bruto, la Seguridad Social y la retención de la nómina.
          </Aviso>
        )}
      </section>

      <section className="card">
        <h2>En qué se va el dinero</h2>
        <ul className="lista">
          {inf.porCategoria.map((c) => (
            <li key={c.categoriaId} className="fila">
              <span className="principal">{nombre(c.categoriaId)}<span className="secundario" style={{ display: 'block' }}>{c.movimientos} movimientos</span></span>
              <Importe c={c.total} />
            </li>
          ))}
        </ul>
      </section>

      {inf.recurrentes.length > 0 && (
        <section className="card">
          <h2>Pagos que se repiten cada mes</h2>
          <p className="peq muted">Suscripciones, recibos y cuotas. Revisa si los sigues usando.</p>
          <ul className="lista">
            {inf.recurrentes.map((r) => (
              <li key={r.comercio} className="fila"><span className="principal">{r.comercio}<span className="secundario" style={{ display: 'block' }}>{nombre(r.categoriaId)}</span></span><Importe c={r.importeMensual} /></li>
            ))}
          </ul>
        </section>
      )}

      {inf.inusuales.length > 0 && (
        <section className="card">
          <h2>Gastos fuera de lo normal</h2>
          <ul className="lista">
            {inf.inusuales.map((g, i) => (
              <li key={`${g.fecha}-${i}`} className="fila">
                <span className="principal">{g.comercio}<span className="secundario" style={{ display: 'block' }}>{g.fecha} · lo habitual en {nombre(g.categoriaId)} es {formatearEuros(g.mediana)}</span></span>
                <Importe c={g.importe} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {inf.presupuestoSugerido.length > 0 && (
        <section className="card">
          <h2>Presupuesto mensual sugerido</h2>
          <p className="peq muted">Lo que gastas en un mes normal en cada categoría (mediana de los meses importados). Puedes cambiarlo en Ajustes.</p>
          <ul className="lista">
            {inf.presupuestoSugerido.map((p) => (
              <li key={p.categoriaId} className="fila"><span className="principal">{nombre(p.categoriaId)}</span><Importe c={p.importe} /></li>
            ))}
          </ul>
          <button type="button" className="btn primario bloque" disabled={guardado} onClick={() => void guardarPresupuestos(inf.presupuestoSugerido).then(() => setGuardado(true))}>
            {guardado ? 'Presupuesto guardado ✓' : 'Usar como presupuesto'}
          </button>
        </section>
      )}

      <button type="button" className="btn bloque" onClick={onTerminar}>Ir a los meses</button>
    </>
  );
}

// --- Pantalla ----------------------------------------------------------------------------------

type Fase = { paso: 'archivos' } | { paso: 'revision'; movs: MovimientoPropuesto[] } | { paso: 'informe'; inf: InformeImportacion; pendientesNomina: number };

export function PantallaImportar({ onTerminar }: { onTerminar: () => void }) {
  const { datos } = useEstado();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivos, setArchivos] = useState<ArchivoCargado[]>([]);
  const [fase, setFase] = useState<Fase>({ paso: 'archivos' });
  const [decisiones, setDecisiones] = useState<Map<string, Decision>>(new Map());
  const [omitirMeses, setOmitirMeses] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verTodo, setVerTodo] = useState(false);

  async function anadir(lista: FileList | null) {
    if (!lista) return;
    setError(null);
    const nuevos: ArchivoCargado[] = [];
    for (const f of Array.from(lista)) {
      try {
        const filas = await leerArchivoBanco(f);
        const lectura = leerExtracto(filas);
        nuevos.push({
          nombre: f.name, filas, error: null, aceptarSinCuadre: false,
          candidatas: lectura ? null : cabecerasCandidatas(filas),
          extracto: lectura ? { cuenta: lectura.banco, lectura, cuadre: cuadrar(lectura.movimientos) } : null,
        });
      } catch (e) {
        nuevos.push({ nombre: f.name, filas: [], extracto: null, candidatas: null, aceptarSinCuadre: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setArchivos((a) => [...a, ...nuevos]);
    if (entrada.current) entrada.current.value = '';
  }

  const actualizar = (i: number, f: (a: ArchivoCargado) => ArchivoCargado) => setArchivos((l) => l.map((a, j) => (j === i ? f(a) : a)));
  const listos = archivos.filter((a) => a.extracto && (a.extracto.cuadre.estado === 'ok' || (a.extracto.cuadre.estado === 'sin-saldo' && a.aceptarSinCuadre)));
  const bloqueados = archivos.filter((a) => !listos.includes(a));

  async function revisar() {
    setOcupado('Clasificando movimientos…');
    try {
      const extractos = listos.flatMap((a) => (a.extracto ? [a.extracto] : []));
      // El aprendizaje local se entrena aquí mismo con tus gastos ya clasificados.
      const modelo = entrenar(ejemplosDeEntrenamiento((clave) => categoriaPorClave(clave as ClaveCategoria, datos.categorias), datos.gastos));
      const movs = await prepararImportacion(extractos, await reglasAprendidas(), await huellasImportadas(), modelo);
      setDecisiones(new Map(movs.map((m) => [m.id, decisionInicial(m, datos.categorias, datos.pagadores)])));
      setFase({ paso: 'revision', movs });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  // Cambiar la categoría de un comercio la propaga a sus otros movimientos de esta importación.
  function cambiar(movs: readonly MovimientoPropuesto[], m: MovimientoPropuesto, d: Decision) {
    setDecisiones((prev) => {
      const sig = new Map(prev);
      const anterior = prev.get(m.id);
      sig.set(m.id, d);
      const clave = m.propuesta.limpio.clave;
      if (clave && anterior && (anterior.categoriaId !== d.categoriaId || anterior.tipoGasto !== d.tipoGasto) && d.destino === 'gasto') {
        for (const o of movs) {
          const od = sig.get(o.id);
          if (o.id !== m.id && o.propuesta.limpio.clave === clave && od?.destino === 'gasto') sig.set(o.id, { ...od, categoriaId: d.categoriaId, tipoGasto: d.tipoGasto });
        }
      }
      return sig;
    });
  }

  // Meses que ya tienen datos apuntados a mano.
  const conflictos = useMemo(() => {
    if (fase.paso !== 'revision') return [];
    const manual = new Set([...datos.gastos, ...datos.ingresos, ...datos.extras].filter((x) => !x.huella).map((x) => idMes(x.anio, x.mes)));
    return [...new Set(fase.movs.filter((m) => !m.duplicado).map((m) => idMes(m.anio, m.mes)))].filter((k) => manual.has(k)).sort();
  }, [fase, datos]);

  async function guardar(movs: MovimientoPropuesto[]) {
    setError(null);
    const efectivas = new Map([...decisiones].map(([id, d]) => {
      const m = movs.find((x) => x.id === id);
      return [id, m && omitirMeses.has(idMes(m.anio, m.mes)) ? { ...d, incluir: false } : d];
    }));
    setOcupado('Guardando…');
    try {
      const filas = construirFilas(movs, efectivas, nuevoId);
      await aplicarImportacion(filas);
      setFase({ paso: 'informe', inf: informe(filas), pendientesNomina: filas.ingresos.length });
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  if (fase.paso === 'informe') {
    return (
      <>
        <h1>Importación completada</h1>
        <Informe inf={fase.inf} pendientesNomina={fase.pendientesNomina} categorias={datos.categorias} onTerminar={onTerminar} />
      </>
    );
  }

  if (fase.paso === 'revision') {
    const movs = fase.movs;
    const nuevos = movs.filter((m) => !m.duplicado);
    const pendientes = nuevos.filter(necesitaRevision);
    const resto = nuevos.filter((m) => !necesitaRevision(m));
    const errores = nuevos.filter((m) => {
      const d = decisiones.get(m.id);
      return d && !omitirMeses.has(idMes(m.anio, m.mes)) && validarDecision(m, d) !== null;
    }).length;
    const traspasos = nuevos.filter((m) => m.pareja).length / 2;
    const fila = (m: MovimientoPropuesto) => {
      const d = decisiones.get(m.id);
      return d ? <FilaMovimiento key={m.id} m={m} d={d} onCambio={(x) => cambiar(movs, m, x)} categorias={datos.categorias} pagadores={datos.pagadores} /> : null;
    };
    return (
      <>
        <h1>Revisar movimientos</h1>
        <section className="card">
          <p>
            <strong>{nuevos.length}</strong> movimientos nuevos{movs.length > nuevos.length && <> · {movs.length - nuevos.length} ya importados antes (se omiten)</>}
            {traspasos > 0 && <> · {traspasos} traspasos entre tus cuentas emparejados</>}.
          </p>
          <p className="peq muted">Nada se guarda hasta que pulses «Guardar». El concepto del banco no se guarda: solo el comercio limpio, la categoría y el importe.</p>
        </section>

        {conflictos.length > 0 && (
          <section className="card">
            <h2>Meses que ya tienen datos apuntados a mano</h2>
            <p className="peq">Si ya apuntaste esos gastos a mano, omite el mes para no contarlos dos veces.</p>
            {conflictos.map((k) => {
              const [a, m] = k.split('-').map(Number);
              return (
                <label key={k} className="check">
                  <input type="checkbox" checked={omitirMeses.has(k)} onChange={(e) => setOmitirMeses((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                  Omitir {nombreMes(m ?? 1)} {a}
                </label>
              );
            })}
          </section>
        )}

        <section className="card">
          <h2>Necesitan tu revisión ({pendientes.length})</h2>
          {pendientes.length === 0 ? <p className="muted">Nada dudoso.</p> : <ul className="lista">{pendientes.map(fila)}</ul>}
        </section>

        <section className="card">
          <h2>Clasificados automáticamente ({resto.length})</h2>
          {!verTodo ? (
            <button type="button" className="btn bloque" onClick={() => setVerTodo(true)}>Ver y corregir</button>
          ) : (
            <ul className="lista">{resto.map(fila)}</ul>
          )}
        </section>

        {error && <Aviso>{error}</Aviso>}
        <div className="botones">
          <button type="button" className="btn" onClick={() => setFase({ paso: 'archivos' })}>Atrás</button>
          <button type="button" className="btn primario" disabled={errores > 0 || ocupado !== null} onClick={() => void guardar(movs)}>
            {ocupado ?? (errores > 0 ? `Faltan ${errores} por completar` : 'Guardar')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Importar extractos</h1>
      <section className="card">
        <p className="peq">
          Los archivos se leen <strong>en este dispositivo</strong> y no se envían a ningún sitio. Puedes elegir varios a la vez (por ejemplo, Santander y Revolut del mismo periodo) para que se emparejen los traspasos entre ellos.
        </p>
        <details className="peq">
          <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Cómo descargar los extractos</summary>
          <p><strong>Revolut:</strong> en la app, cuenta en euros → ⋯ → Extracto → formato Excel/CSV → elige el periodo.</p>
          <p><strong>Santander:</strong> banca online → Cuentas → Movimientos → elige las fechas → Descargar → Excel.</p>
          <p>Si tu banco solo da PDF, busca la opción «Exportar movimientos» o «Descargar en Excel».</p>
        </details>
        <button type="button" className="btn primario bloque" onClick={() => entrada.current?.click()}>Elegir archivos (CSV o Excel)</button>
        <input ref={entrada} type="file" multiple accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" tabIndex={-1} aria-label="Archivos de extracto" onChange={(e) => void anadir(e.target.files)} />
      </section>

      {archivos.map((a, i) => (
        <ResumenArchivo
          key={`${a.nombre}-${i}`}
          a={a}
          onCuenta={(c) => actualizar(i, (x) => (x.extracto ? { ...x, extracto: { ...x.extracto, cuenta: c } } : x))}
          onAceptar={(v) => actualizar(i, (x) => ({ ...x, aceptarSinCuadre: v }))}
          onQuitar={() => setArchivos((l) => l.filter((_, j) => j !== i))}
          onMapeo={(m) => actualizar(i, (x) => {
            const lectura = extraerMovimientos(x.filas, m);
            return { ...x, extracto: { cuenta: lectura.banco, lectura, cuadre: cuadrar(lectura.movimientos) } };
          })}
        />
      ))}

      {error && <Aviso>{error}</Aviso>}
      {archivos.length > 0 && (
        <button type="button" className="btn primario bloque" disabled={listos.length === 0 || ocupado !== null} onClick={() => void revisar()}>
          {ocupado ?? (bloqueados.length > 0 && listos.length > 0 ? `Continuar con ${listos.length} de ${archivos.length} archivos` : 'Continuar')}
        </button>
      )}
    </>
  );
}
