import { useState } from 'react';
import { clavePeriodo, useAnalisis } from '../calculos';
import { formatearEuros } from '../domain/dinero';
import { flujoMes, SIN_CUENTA } from '../domain/flujo';
import { idMes, importeGasto, nombreMes, sumarMeses, type Gasto, type Ingreso, type IngresoExtra, type Periodo, type TipoGasto } from '../domain/modelo';
import { CLAVES_REPARTO, ETIQUETAS_REPARTO } from '../domain/reparto';
import { resumirMes } from '../domain/resumen';
import { variacionesMes } from '../domain/variaciones';
import { confirmarMes, copiarFijosMesAnterior, marcarIngresoReal } from '../db/operaciones';
import { useEstado } from '../estado';
import { Aviso, Barra, Importe } from '../ui/base';
import { FormExtra, FormGasto, FormIngreso } from '../ui/formularios';
import { IconoAdelante, IconoAtras } from '../ui/iconos';

type Edicion =
  | { tipo: 'ingreso'; fila: Ingreso | null }
  | { tipo: 'extra'; fila: IngresoExtra | null }
  | { tipo: 'gasto'; fila: Gasto | null; tipoGasto: TipoGasto }
  | null;

function SelectorMes({ periodo, onCambio, subtitulo }: { periodo: Periodo; onCambio: (p: Periodo) => void; subtitulo?: string }) {
  return (
    <div className="selector">
      <button type="button" className="btn icono" onClick={() => onCambio(sumarMeses(periodo, -1))} aria-label="Mes anterior">
        <IconoAtras />
      </button>
      <h1 aria-live="polite">
        {nombreMes(periodo.mes)} {periodo.anio}
        {subtitulo && <span className="sub">{subtitulo}</span>}
      </h1>
      <button type="button" className="btn icono" onClick={() => onCambio(sumarMeses(periodo, 1))} aria-label="Mes siguiente">
        <IconoAdelante />
      </button>
    </div>
  );
}

export function PantallaMes({ periodo, onCambio }: { periodo: Periodo; onCambio: (p: Periodo) => void }) {
  const { datos, indice, hoy } = useEstado();
  const analisis = useAnalisis();
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const k = idMes(periodo.anio, periodo.mes);
  const ingresos = indice.ingresos.get(k) ?? [];
  const extras = indice.extras.get(k) ?? [];
  const gastos = indice.gastos.get(k) ?? [];
  const resumen = resumirMes(indice, periodo, hoy);
  const paso = analisis.pasoPorMes.get(clavePeriodo(periodo));
  const confirmado = indice.confirmados.has(k);
  const vacio = ingresos.length + extras.length + gastos.length === 0;
  const anterior = sumarMeses(periodo, -1);
  const fijosAnterior = (indice.gastos.get(idMes(anterior.anio, anterior.mes)) ?? []).filter((g) => g.tipo === 'Fijo').length;
  const hayFijos = gastos.some((g) => g.tipo === 'Fijo');
  const flujo = flujoMes(datos, periodo);
  const presupuestoMes = datos.presupuestos
    .filter((p) => p.importe > 0)
    .map((p) => ({ categoriaId: p.id, limite: p.importe, gastado: gastos.filter((g) => g.categoriaId === p.id).reduce((s, g) => s + importeGasto(g), 0) }))
    .sort((a, b) => b.gastado / b.limite - a.gastado / a.limite);

  const nombrePagador = (id: string) => datos.pagadores.find((p) => p.id === id)?.nombre ?? 'Pagador eliminado';
  const nombreCategoria = (id: string) => datos.categorias.find((c) => c.id === id)?.nombre ?? 'Sin categoría';

  async function copiarFijos() {
    const n = await copiarFijosMesAnterior(periodo);
    setMensaje(n > 0 ? `Copiados ${n} gastos fijos de ${nombreMes(anterior.mes)}.` : 'No había gastos fijos que copiar.');
  }

  const variaciones = variacionesMes(indice, datos.categorias, periodo);

  const subtitulo = resumen.estado === 'vacio' ? 'Sin registrar' : resumen.estado === 'previsto' ? 'Previsto' : 'Real';

  return (
    <>
      <SelectorMes periodo={periodo} onCambio={(p) => { setMensaje(null); onCambio(p); }} subtitulo={subtitulo} />

      {mensaje && <Aviso tipo="info">{mensaje}</Aviso>}
      <a className="btn bloque" href="#/preguntar" style={{ marginBottom: 12 }}>Preguntar sobre mis finanzas</a>

      <section className="card" aria-labelledby="t-resultado">
        <h2 id="t-resultado">Resultado del mes</h2>
        <div className="grande"><Importe c={resumen.resultado} signo /></div>
        <div className="kpis" style={{ marginTop: 10 }}>
          <div className="kpi"><div className="t">Ingresos</div><div className="v"><Importe c={resumen.ingresos} /></div></div>
          <div className="kpi"><div className="t">Gastos</div><div className="v"><Importe c={resumen.gastos} /></div></div>
          <div className="kpi"><div className="t">Fijos</div><div className="v"><Importe c={resumen.gastosFijos} /></div></div>
        </div>
      </section>

      {vacio && (
        <section className="card">
          <h2>Mes vacío</h2>
          {fijosAnterior > 0 && (
            <button type="button" className="btn primario bloque" onClick={() => void copiarFijos()}>
              Copiar {fijosAnterior} gastos fijos de {nombreMes(anterior.mes)}
            </button>
          )}
          <a className="btn bloque" href="#/importar" style={{ marginTop: 8 }}>Importar extractos del banco</a>
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={confirmado} onChange={(e) => void confirmarMes(periodo, e.target.checked)} />
            Mes sin ingresos ni gastos (cuenta como 0, no como hueco)
          </label>
        </section>
      )}

      <section className="card" aria-labelledby="t-ingresos">
        <h2 id="t-ingresos">Ingresos <Importe c={resumen.ingresos} className="peq" /></h2>
        <ul className="lista">
          {ingresos.map((i) => (
            <li key={i.id} className="fila">
              <button type="button" className="fila-boton" onClick={() => setEdicion({ tipo: 'ingreso', fila: i })}>
                <span className="principal">
                  {nombrePagador(i.pagadorId)}{' '}
                  {i.estado === 'Previsto' && <span className="etiqueta previsto">Previsto</span>}
                  {i.pendienteNomina && <span className="etiqueta previsto">Completar con la nómina</span>}
                  <span className="secundario" style={{ display: 'block' }}>
                    Bruto <Importe c={i.bruto} /> · SS <Importe c={i.seguridadSocial} /> · IRPF <Importe c={i.retencionIRPF} />
                    {i.netoManual && i.neto !== i.bruto - i.seguridadSocial - i.retencionIRPF && ' · neto ajustado'}
                  </span>
                </span>
                <Importe c={i.neto} />
              </button>
              {i.estado === 'Previsto' && (
                <button type="button" className="btn compacto" onClick={() => void marcarIngresoReal(i.id)} aria-label={`Marcar como cobrado: ${nombrePagador(i.pagadorId)}`}>
                  ✓ Cobrado
                </button>
              )}
            </li>
          ))}
          {extras.map((x) => (
            <li key={x.id} className="fila">
              <button type="button" className="fila-boton" onClick={() => setEdicion({ tipo: 'extra', fila: x })}>
                <span className="principal">
                  {x.concepto}
                  {x.nota && <span className="secundario" style={{ display: 'block' }}>{x.nota}</span>}
                </span>
                <Importe c={x.importe} />
              </button>
            </li>
          ))}
          {ingresos.length + extras.length === 0 && <li className="fila muted">Sin ingresos este mes.</li>}
        </ul>
        <div className="botones">
          <button type="button" className="btn primario" onClick={() => setEdicion({ tipo: 'ingreso', fila: null })}>+ Nómina / pago SEPE</button>
          <button type="button" className="btn" onClick={() => setEdicion({ tipo: 'extra', fila: null })}>+ Propinas / otros</button>
        </div>
        {resumen.propinas > 0 && (
          <p className="peq muted" style={{ marginTop: 10 }}>
            Las propinas no entran en la estimación de la renta, pero son rendimiento del trabajo y deberían declararse.
          </p>
        )}
      </section>

      {(['Fijo', 'Variable', 'Extra'] as const).map((tipo) => {
        const lista = gastos.filter((g) => g.tipo === tipo);
        const total = lista.reduce((s, g) => s + importeGasto(g), 0);
        const titulo = tipo === 'Fijo' ? 'Gastos fijos' : tipo === 'Variable' ? 'Gastos variables' : 'Gastos extra';
        // Agrupados por categoría: con extractos importados puede haber decenas de movimientos.
        const grupos = new Map<string, Gasto[]>();
        for (const g of lista) grupos.set(g.categoriaId, [...(grupos.get(g.categoriaId) ?? []), g]);
        const filaGasto = (g: Gasto) => (
          <li key={g.id} className="fila">
            <button type="button" className="fila-boton" onClick={() => setEdicion({ tipo: 'gasto', fila: g, tipoGasto: g.tipo })}>
              <span className="principal">
                {g.comercio ?? nombreCategoria(g.categoriaId)}
                <span className="secundario" style={{ display: 'block' }}>
                  {[g.comercio ? nombreCategoria(g.categoriaId) : null, g.fecha ? `${g.fecha.slice(8, 10)}/${g.fecha.slice(5, 7)}` : null, g.cuenta, g.devolucion ? 'devolución' : null, g.comercio ? null : g.nota || null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Importe c={importeGasto(g)} />
            </button>
          </li>
        );
        return (
          <section className="card" key={tipo} aria-label={titulo}>
            <h2>{titulo} <Importe c={total} className="peq" /></h2>
            <ul className="lista">
              {[...grupos.entries()].map(([categoriaId, items]) => {
                if (items.length === 1 && items[0]) return filaGasto(items[0]);
                const suma = items.reduce((s, g) => s + importeGasto(g), 0);
                return (
                  <li key={categoriaId} className="fila" style={{ display: 'block' }}>
                    <details>
                      <summary className="fila-boton" style={{ listStyle: 'none' }}>
                        <span className="principal">{nombreCategoria(categoriaId)}<span className="secundario" style={{ display: 'block' }}>{items.length} movimientos · toca para ver</span></span>
                        <Importe c={suma} />
                      </summary>
                      <ul className="lista" style={{ paddingLeft: 12 }}>{items.map(filaGasto)}</ul>
                    </details>
                  </li>
                );
              })}
              {lista.length === 0 && <li className="fila muted">Nada registrado.</li>}
            </ul>
            <div className="botones">
              <button type="button" className="btn" onClick={() => setEdicion({ tipo: 'gasto', fila: null, tipoGasto: tipo })}>+ {tipo === 'Fijo' ? 'Gasto fijo' : tipo === 'Variable' ? 'Gasto variable' : 'Gasto extra'}</button>
              {tipo === 'Fijo' && !vacio && !hayFijos && fijosAnterior > 0 && (
                <button type="button" className="btn" onClick={() => void copiarFijos()}>Copiar fijos de {nombreMes(anterior.mes)}</button>
              )}
            </div>
          </section>
        );
      })}

      {presupuestoMes.length > 0 && (
        <section className="card" aria-labelledby="t-pres-mes">
          <h2 id="t-pres-mes">Presupuesto</h2>
          <ul className="lista">
            {presupuestoMes.map((p) => (
              <li key={p.categoriaId} className="fila" style={{ display: 'block' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{nombreCategoria(p.categoriaId)}</span>
                  <span className={p.gastado > p.limite ? 'neg importe' : 'importe'}>{formatearEuros(p.gastado)} de {formatearEuros(p.limite)}</span>
                </div>
                <Barra valor={Math.min(10_000, Math.round((Math.max(0, p.gastado) * 10_000) / p.limite))} etiqueta={`Presupuesto de ${nombreCategoria(p.categoriaId)}`} />
                {p.gastado > p.limite && <span className="peq neg">Te has pasado {formatearEuros(p.gastado - p.limite)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {variaciones.length > 0 && (
        <section className="card" aria-labelledby="t-var">
          <h2 id="t-var">Cambios este mes</h2>
          <ul className="peq" style={{ paddingLeft: 18, margin: 0 }}>
            {variaciones.map((v) => <li key={`${v.tipo}-${v.texto}`}>{v.texto}</li>)}
          </ul>
          <p className="peq muted" style={{ marginTop: 8 }}>Comparado con la mediana de tus meses anteriores. Es información, no un juicio: tú decides si es un problema.</p>
        </section>
      )}

      {flujo.some((f) => f.cuenta !== SIN_CUENTA) && (
        <section className="card" aria-labelledby="t-flujo">
          <h2 id="t-flujo">De dónde viene y adónde va el dinero</h2>
          <ul className="lista">
            {flujo.map((f) => (
              <li key={f.cuenta} className="fila" style={{ display: 'block' }}>
                <strong>{f.cuenta}</strong>
                <span className="secundario peq" style={{ display: 'block' }}>
                  {[
                    f.entradas > 0 ? `entra ${formatearEuros(f.entradas)}` : null,
                    f.traspasosRecibidos > 0 ? `recibe ${formatearEuros(f.traspasosRecibidos)} de tus cuentas` : null,
                    f.gastos !== 0 ? `gasta ${formatearEuros(f.gastos)}` : null,
                    f.traspasosEnviados > 0 ? `pasa ${formatearEuros(f.traspasosEnviados)} a tus cuentas` : null,
                    f.aHuchas !== 0 ? `${f.aHuchas > 0 ? 'aparta' : 'saca de huchas'} ${formatearEuros(Math.abs(f.aHuchas))}` : null,
                  ].filter(Boolean).join(' → ')}
                </span>
                <span className="peq">Variación del mes: <Importe c={f.variacion} signo /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="t-reparto">
        <h2 id="t-reparto">Reparto del resultado</h2>
        {analisis.errorReparto && <Aviso titulo="Revisa los porcentajes en Ajustes">{analisis.errorReparto}</Aviso>}
        {!paso && !analisis.errorReparto && (
          <p className="muted">
            {resumen.estado === 'vacio'
              ? 'Registra el mes para ver el reparto.'
              : `Este mes es anterior al inicio configurado (${nombreMes(analisis.inicio.mes)} ${analisis.inicio.anio}).`}
          </p>
        )}
        {paso && (
          <>
            {paso.aviso && <Aviso>{paso.aviso}</Aviso>}
            {paso.estado === 'previsto' && <p className="peq muted">Reparto previsto: se confirmará cuando el mes sea real.</p>}
            <div className="reparto">
              {CLAVES_REPARTO.map((c) => (
                <div className="kpi" key={c}>
                  <div className="t">{ETIQUETAS_REPARTO[c]}</div>
                  <div className="v"><Importe c={paso.reparto[c]} signo={c === 'colchon'} /></div>
                </div>
              ))}
            </div>
            <p className="peq muted" style={{ marginTop: 8 }}>
              Colchón tras este mes: <Importe c={paso.colchonFin} />
            </p>
          </>
        )}
      </section>

      {edicion?.tipo === 'ingreso' && <FormIngreso periodo={periodo} ingreso={edicion.fila} onCerrar={() => setEdicion(null)} />}
      {edicion?.tipo === 'extra' && <FormExtra periodo={periodo} extra={edicion.fila} onCerrar={() => setEdicion(null)} />}
      {edicion?.tipo === 'gasto' && <FormGasto periodo={periodo} gasto={edicion.fila} tipoInicial={edicion.tipoGasto} onCerrar={() => setEdicion(null)} />}
    </>
  );
}
