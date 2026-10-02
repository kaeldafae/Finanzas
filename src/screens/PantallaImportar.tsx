import { useId, useMemo, useRef, useState } from 'react';
import { formatearEuros } from '../domain/dinero';
import { ejemplosDeEntrenamiento, entrenar } from '../domain/importacion/aprendizaje';
import { UMBRAL_REVISION } from '../domain/importacion/clasificar';
import { cuadrar } from '../domain/importacion/cuadre';
import { cabecerasCandidatas, diagnosticoAnonimo, extraerMovimientos, leerExtracto, type LecturaExtracto, type Mapeo } from '../domain/importacion/formatos';
import { leerPdfExtracto, type ControlResumen } from '../domain/importacion/pdf';
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
import { analizarCoherencia, comprobarConservacion } from '../domain/importacion/analisis';
import { RevisionIA } from './importar/RevisionIA';
import { CONCEPTOS_EXTRA, idMes, nombreMes, TIPOS_GASTO, type Categoria, type ClaveCategoria, type ConceptoExtra, type Pagador, type TipoGasto } from '../domain/modelo';
import { aplicarImportacion, clavesImportadas, guardarPresupuestos, huellasImportadas, reglasAprendidas } from '../db/operaciones';
import { nuevoId } from '../db/db';
import { useEstado } from '../estado';
import { leerArchivoBanco } from '../lib/leerArchivo';
import { PdfConContrasena } from '../lib/leerPdf';
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
    incluir: !m.duplicado && !m.posibleDuplicado,
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
  /** Mapeo manual (solo en opciones avanzadas) cuando no se reconocen las columnas. */
  candidatas: { fila: number; cabeceras: string[] } | null;
  aceptarSinCuadre: boolean;
  /** PDF: comprobación contra el resumen del propio extracto. */
  control: ControlResumen | null;
  /** Estructura del archivo sin datos, para pedir ayuda si no se reconoce. */
  diagnostico: string | null;
  /** PDF protegido: se guarda el archivo para reintentarlo con la contraseña. */
  pdfProtegido: { datos: ArrayBuffer; incorrecta: boolean } | null;
}

function extractoDe(lectura: LecturaExtracto): ExtractoLeido {
  return { cuenta: lectura.banco, lectura, cuadre: cuadrar(lectura.movimientos) };
}

function esPdf(f: File): boolean {
  return f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
}

const MAX_PDF = 10 * 1024 * 1024;

/** Lee un PDF en el dispositivo. */
async function cargarPdf(nombre: string, datos: ArrayBuffer, contrasena?: string): Promise<ArchivoCargado> {
  const vacio: ArchivoCargado = { nombre, filas: [], extracto: null, error: null, candidatas: null, aceptarSinCuadre: false, control: null, diagnostico: null, pdfProtegido: null };
  try {
    const { leerTextoPdf } = await import('../lib/leerPdf');
    // pdf.js transfiere el buffer al worker: se pasa una copia para poder reintentar con contraseña.
    const { textos, paginas } = await leerTextoPdf(datos.slice(0), contrasena);
    if (textos.length === 0) {
      return { ...vacio, error: 'Este PDF no tiene texto (parece escaneado o una foto). Descarga el extracto desde la app o la web del banco: esos PDF sí llevan texto.' };
    }
    const r = leerPdfExtracto(textos, paginas);
    if (!r.lectura) return { ...vacio, diagnostico: r.diagnostico };
    return { ...vacio, extracto: extractoDe(r.lectura), control: r.control, diagnostico: r.diagnostico };
  } catch (e) {
    if (e instanceof PdfConContrasena) return { ...vacio, pdfProtegido: { datos, incorrecta: e.incorrecta } };
    return { ...vacio, error: e instanceof Error ? e.message : String(e) };
  }
}

function ContrasenaPdf({ a, onAbrir }: { a: ArchivoCargado; onAbrir: (c: string) => void }) {
  const [clave, setClave] = useState('');
  const id = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (clave) onAbrir(clave);
      }}
    >
      <p className="peq">{a.pdfProtegido?.incorrecta ? 'La contraseña no es correcta. Prueba otra vez:' : 'Este PDF tiene contraseña. Escríbela para abrirlo (solo se usa aquí, no se guarda):'}</p>
      <div className="campo">
        <label htmlFor={id}>Contraseña del PDF</label>
        <input id={id} type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} />
      </div>
      <button type="submit" className="btn primario bloque" disabled={!clave}>Abrir PDF</button>
    </form>
  );
}

function Diagnostico({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <details className="peq">
      <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Diagnóstico (sin tus datos)</summary>
      <p className="muted">Solo describe la estructura del archivo: no incluye importes, conceptos ni fechas. Puedes copiarlo para pedir que se adapte el lector a tu banco.</p>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{texto}</pre>
      <button type="button" className="btn compacto" onClick={() => void navigator.clipboard.writeText(texto).then(() => setCopiado(true), () => setCopiado(false))}>
        {copiado ? 'Copiado ✓' : 'Copiar diagnóstico'}
      </button>
    </details>
  );
}

function textoDeteccion(ex: ExtractoLeido): string | null {
  switch (ex.lectura.deteccion) {
    case 'pdf':
      return 'Leído del PDF: columnas localizadas automáticamente.';
    case 'contenido':
      return ex.cuadre.estado === 'ok'
        ? 'Columnas detectadas automáticamente por su contenido y comprobadas con el saldo.'
        : 'Columnas detectadas automáticamente por su contenido.';
    case 'manual':
      return 'Columnas elegidas a mano.';
    case 'texto':
      return 'Leído del texto pegado.';
    case 'ocr':
      return 'Leído de la imagen con reconocimiento de texto (OCR) en este dispositivo.';
    case 'nomina':
      return null;
    case 'cabeceras':
      return null;
  }
}

/** Un archivo está listo si se ha comprobado al céntimo (saldos o resumen) o si aceptas importarlo sin comprobar. */
function estaListo(a: ArchivoCargado): boolean {
  const ex = a.extracto;
  if (!ex || a.control?.ok === false) return false;
  if (ex.cuadre.estado === 'ok') return true;
  return ex.cuadre.estado === 'sin-saldo' && (a.control?.ok === true || a.aceptarSinCuadre);
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

function ResumenArchivo({ a, onCuenta, onAceptar, onQuitar, onMapeo, onContrasena }: { a: ArchivoCargado; onCuenta: (c: string) => void; onAceptar: (v: boolean) => void; onQuitar: () => void; onMapeo: (m: Mapeo) => void; onContrasena: (c: string) => void }) {
  const ex = a.extracto;
  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ wordBreak: 'break-all' }}>{a.nombre}</strong>
        <button type="button" className="btn compacto" onClick={onQuitar} aria-label={`Quitar ${a.nombre}`}>Quitar</button>
      </div>
      {a.error && <Aviso>{a.error}</Aviso>}
      {a.pdfProtegido && <ContrasenaPdf a={a} onAbrir={onContrasena} />}
      {!a.error && !a.pdfProtegido && !ex && (
        <>
          <Aviso titulo="No he podido leer los movimientos con seguridad">
            No encuentro una tabla de movimientos que pueda comprobar con el saldo. No se importa nada para no meter datos erróneos. Prueba a descargar el extracto otra vez (CSV, Excel o PDF).
          </Aviso>
          {a.diagnostico && <Diagnostico texto={a.diagnostico} />}
          {a.filas.length > 0 && (
            <details className="peq">
              <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Opciones avanzadas</summary>
              <MapeoManual archivo={a} onListo={onMapeo} />
            </details>
          )}
        </>
      )}
      {ex && (
        <>
          <CampoTexto etiqueta="Nombre de la cuenta" valor={ex.cuenta} onCambio={onCuenta} ayuda="Usa siempre el mismo nombre para cada banco: así no se duplica nada al volver a importar." maxLength={30} />
          <p className="peq">
            {ex.lectura.movimientos.length} movimientos · del {ex.cuadre.ordenados[0]?.fecha ?? '—'} al {ex.cuadre.ordenados[ex.cuadre.ordenados.length - 1]?.fecha ?? '—'}
            {ex.lectura.descartados.length > 0 && ` · ${ex.lectura.descartados.length} descartados (pendientes, anulados, huchas u otra divisa)`}
          </p>
          {textoDeteccion(ex) && <p className="peq muted">{textoDeteccion(ex)}</p>}
          {a.control?.ok === true && (
            <p className="peq pos">
              ✓ Coincide con el resumen del extracto: entradas {formatearEuros(a.control.entradas)}, salidas {formatearEuros(a.control.salidas)}.
            </p>
          )}
          {a.control?.ok === false && (
            <Aviso titulo="No coincide con el resumen del propio extracto">
              El banco dice entradas {formatearEuros(a.control.resumen.entradas)} y salidas {formatearEuros(a.control.resumen.salidas)}; lo leído suma {formatearEuros(a.control.entradas)} y {formatearEuros(a.control.salidas)}. No se importa para no dejar movimientos fuera.
              {a.diagnostico && <Diagnostico texto={a.diagnostico} />}
            </Aviso>
          )}
          {ex.cuadre.estado === 'ok' && (
            <p className="peq pos">✓ Cuadra con los saldos del banco: {ex.cuadre.comprobados} comprobaciones. Saldo final {formatearEuros(ex.cuadre.saldoFinal ?? 0)}.</p>
          )}
          {ex.cuadre.estado === 'sin-saldo' && a.control?.ok !== true && (
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
              {a.diagnostico && <Diagnostico texto={a.diagnostico} />}
            </Aviso>
          )}
        </>
      )}
    </div>
  );
}

// --- Paso 2: revisión ------------------------------------------------------------------------

interface PropsFila {
  notaIA?: string | undefined;
  m: MovimientoPropuesto;
  d: Decision;
  onCambio: (d: Decision) => void;
  categorias: readonly Categoria[];
  pagadores: readonly Pagador[];
}

function FilaMovimiento({ m, d, onCambio, categorias, pagadores, notaIA }: PropsFila) {
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
          {m.posibleDuplicado && (
            <span className="peq" style={{ display: 'block', color: 'var(--warning-text)' }}>
              Posible duplicado: ya importaste este importe en {m.cuenta} el día anterior o el siguiente. Se deja fuera; si es otro movimiento, elige qué es.
            </span>
          )}
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
      {notaIA && <span className="peq" style={{ display: 'block', color: 'var(--info-text)' }}>IA: {notaIA}</span>}
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
  const [revisadoIA, setRevisadoIA] = useState<Map<string, string>>(new Map());

  async function anadir(lista: FileList | null) {
    if (!lista) return;
    setError(null);
    const nuevos: ArchivoCargado[] = [];
    for (const f of Array.from(lista)) {
      const base = { nombre: f.name, aceptarSinCuadre: false, control: null, pdfProtegido: null };
      try {
        if (esPdf(f)) {
          setOcupado(`Leyendo ${f.name}…`);
          if (f.size > MAX_PDF) throw new Error('El PDF es demasiado grande para ser un extracto (máximo 10 MB).');
          nuevos.push(await cargarPdf(f.name, await f.arrayBuffer()));
          continue;
        }
        const filas = await leerArchivoBanco(f);
        const lectura = leerExtracto(filas);
        nuevos.push({
          ...base, filas, error: null,
          candidatas: lectura ? null : cabecerasCandidatas(filas),
          diagnostico: lectura ? null : diagnosticoAnonimo(filas),
          extracto: lectura ? extractoDe(lectura) : null,
        });
      } catch (e) {
        nuevos.push({ ...base, filas: [], extracto: null, candidatas: null, diagnostico: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setOcupado(null);
    setArchivos((a) => [...a, ...nuevos]);
    if (entrada.current) entrada.current.value = '';
  }

  const actualizar = (i: number, f: (a: ArchivoCargado) => ArchivoCargado) => setArchivos((l) => l.map((a, j) => (j === i ? f(a) : a)));
  const listos = archivos.filter(estaListo);
  const bloqueados = archivos.filter((a) => !listos.includes(a));

  async function revisar() {
    setOcupado('Clasificando movimientos…');
    try {
      const extractos = listos.flatMap((a) => (a.extracto ? [a.extracto] : []));
      // El aprendizaje local se entrena aquí mismo con tus gastos ya clasificados.
      const modelo = entrenar(ejemplosDeEntrenamiento((clave) => categoriaPorClave(clave as ClaveCategoria, datos.categorias), datos.gastos));
      const movs = await prepararImportacion(extractos, await reglasAprendidas(), await huellasImportadas(), modelo, await clavesImportadas());
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

  const avisos = useMemo(() => {
    if (fase.paso !== 'revision') return [];
    return analizarCoherencia(fase.movs, decisiones, datos.gastos, (id) => datos.categorias.find((c) => c.id === id)?.nombre ?? 'sin categoría');
  }, [fase, decisiones, datos]);

  async function guardar(movs: MovimientoPropuesto[]) {
    setError(null);
    const efectivas = new Map([...decisiones].map(([id, d]) => {
      const m = movs.find((x) => x.id === id);
      return [id, m && omitirMeses.has(idMes(m.anio, m.mes)) ? { ...d, incluir: false } : d];
    }));
    setOcupado('Guardando…');
    try {
      const filas = construirFilas(movs, efectivas, nuevoId);
      // Comprobación final: cada céntimo de lo incluido acaba exactamente en un sitio.
      const conservacion = comprobarConservacion(movs, efectivas, filas);
      if (!conservacion.ok) {
        throw new Error(`No se guarda nada: la suma no cuadra (${formatearEuros(conservacion.totalMovimientos)} en el extracto frente a ${formatearEuros(conservacion.totalFilas)} clasificados). Avísame de este error.`);
      }
      const incluidos = movs.filter((m) => !m.duplicado && efectivas.get(m.id)?.incluir);
      const fechas = incluidos.map((m) => m.fecha).sort();
      await aplicarImportacion({
        ...filas,
        importacion: {
          id: nuevoId(),
          fecha: new Date().toISOString(),
          cuentas: [...new Set(incluidos.map((m) => m.cuenta))],
          movimientos: incluidos.length,
          desde: fechas[0] ?? '',
          hasta: fechas[fechas.length - 1] ?? '',
        },
      });
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
      return d ? <FilaMovimiento key={m.id} m={m} d={d} notaIA={revisadoIA.get(m.id)} onCambio={(x) => cambiar(movs, m, x)} categorias={datos.categorias} pagadores={datos.pagadores} /> : null;
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

        <RevisionIA
          movs={movs}
          decisiones={decisiones}
          categorias={datos.categorias}
          dudoso={necesitaRevision}
          onAplicar={(cambios) => {
            setDecisiones((prev) => {
              const sig = new Map(prev);
              for (const [id, c] of cambios) {
                const d = sig.get(id);
                if (d) sig.set(id, { ...d, categoriaId: c.categoriaId, tipoGasto: c.tipo });
              }
              return sig;
            });
            setRevisadoIA((prev) => new Map([...prev, ...[...cambios].map(([id, c]) => [id, c.nota] as const)]));
          }}
        />

        {avisos.length > 0 && (
          <section className="card" aria-labelledby="t-avisos">
            <h2 id="t-avisos">Comprueba esto antes de guardar</h2>
            <ul className="peq" style={{ paddingLeft: 18, margin: 0 }}>{avisos.map((a) => <li key={a.texto}>{a.texto}</li>)}</ul>
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
          <p><strong>Revolut:</strong> en la app, cuenta en euros → ⋯ → Extracto → formato PDF (o Excel/CSV) → elige el periodo.</p>
          <p><strong>Santander:</strong> banca online → Cuentas → Movimientos → elige las fechas → Descargar → Excel.</p>
          <p>Sirven PDF con texto (los que descargas del banco). Un PDF escaneado o una foto no se puede leer.</p>
        </details>
        <button type="button" className="btn primario bloque" disabled={ocupado !== null} onClick={() => entrada.current?.click()}>{ocupado ?? 'Elegir PDF, Excel o CSV'}</button>
        <input ref={entrada} type="file" multiple accept=".pdf,.csv,.xlsx,.txt,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" tabIndex={-1} aria-label="Archivos de extracto" onChange={(e) => void anadir(e.target.files)} />
      </section>

      {archivos.map((a, i) => (
        <ResumenArchivo
          key={`${a.nombre}-${i}`}
          a={a}
          onCuenta={(c) => actualizar(i, (x) => (x.extracto ? { ...x, extracto: { ...x.extracto, cuenta: c } } : x))}
          onAceptar={(v) => actualizar(i, (x) => ({ ...x, aceptarSinCuadre: v }))}
          onQuitar={() => setArchivos((l) => l.filter((_, j) => j !== i))}
          onMapeo={(m) => actualizar(i, (x) => ({ ...x, extracto: extractoDe(extraerMovimientos(x.filas, m, 'manual')) }))}
          onContrasena={(c) => {
            const protegido = a.pdfProtegido;
            if (!protegido) return;
            setOcupado(`Abriendo ${a.nombre}…`);
            void cargarPdf(a.nombre, protegido.datos, c).then((nuevo) => {
              actualizar(i, () => nuevo);
              setOcupado(null);
            });
          }}
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
