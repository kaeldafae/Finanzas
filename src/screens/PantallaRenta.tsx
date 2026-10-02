import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { formatearEuros, formatearPorcentaje, type Centimos } from '../domain/dinero';
import { calcularIRPF, fraccionar6040, mensajeResultado, retencionAdicionalSugerida } from '../domain/irpf';
import { nombreMes } from '../domain/modelo';
import { prepararRenta } from '../domain/renta';
import { crearGastoRenta, gastosRentaExistentes } from '../db/operaciones';
import { useEstado } from '../estado';
import { formatearFecha } from '../lib/fecha';
import { Aviso, Importe, Segmentado } from '../ui/base';
import { SelectorAnio } from './PantallaAnio';

function Linea({ texto, c, signo, total, ayuda }: { texto: string; c: Centimos; signo?: '−' | '+'; total?: boolean; ayuda?: string }) {
  return (
    <tr className={total ? 'total' : undefined}>
      <td>
        {signo && <span aria-hidden="true">{signo} </span>}
        {texto}
        {ayuda && <span className="secundario" style={{ display: 'block', fontSize: '.78rem', color: 'var(--text-2)' }}>{ayuda}</span>}
      </td>
      <td><Importe c={c} /></td>
    </tr>
  );
}

export function PantallaRenta({ anio, onCambioAnio }: { anio: number; onCambioAnio: (a: number) => void }) {
  const { datos, ajustes, hoy } = useEstado();
  const [modo, setModo] = useState<'reales' | 'previstos'>('previstos');
  const [hecho, setHecho] = useState<string | null>(null);
  const existentes = useLiveQuery(() => gastosRentaExistentes(anio), [anio, datos.gastos]) ?? 0;

  const prep = useMemo(() => prepararRenta(datos, anio, ajustes, modo === 'previstos', hoy), [datos, anio, ajustes, modo, hoy]);
  const r = useMemo(() => calcularIRPF(prep.entrada, ajustes.fiscal), [prep, ajustes.fiscal]);
  const mensaje = mensajeResultado(r, formatearEuros);
  const fiscal = ajustes.fiscal;
  const sugerida = retencionAdicionalSugerida(r.resultado, prep.brutoPendienteEmpresa);
  const fracc = fraccionar6040(Math.max(0, r.resultado));
  const sinDatos = prep.entrada.pagadores.length === 0;

  async function crearGasto(fraccionado: boolean) {
    if (existentes > 0 && !window.confirm('Ya hay un gasto de esta renta. ¿Sustituirlo?')) return;
    await crearGastoRenta(anio, r.resultado, fraccionado);
    setHecho(fraccionado
      ? `Creados: ${formatearEuros(fracc.junio)} en junio y ${formatearEuros(fracc.noviembre)} en noviembre de ${anio + 1}.`
      : `Creado el gasto de ${formatearEuros(r.resultado)} en junio de ${anio + 1}.`);
  }

  return (
    <>
      <SelectorAnio anio={anio} onCambio={(a) => { setHecho(null); onCambioAnio(a); }} titulo="Renta" />

      <Aviso tipo="info">
        Estimación orientativa. La cifra oficial es la del borrador de la AEAT. Parámetros revisados el {formatearFecha(fiscal.revisadoEl)}; revísalos en cada campaña.
      </Aviso>

      <Segmentado
        etiqueta="Qué ingresos cuentan"
        valor={modo}
        onCambio={setModo}
        opciones={[
          { valor: 'previstos', texto: 'Con previstos' },
          { valor: 'reales', texto: 'Solo cobrados' },
        ]}
      />

      {prep.mesesSinRegistrar.length > 0 && (
        <Aviso titulo={`${prep.mesesSinRegistrar.length} ${prep.mesesSinRegistrar.length === 1 ? 'mes' : 'meses'} sin registrar`}>
          {prep.mesesSinRegistrar.map(nombreMes).join(', ')}. La estimación puede cambiar mucho cuando los completes.
        </Aviso>
      )}
      {fiscal.ejercicio !== anio && (
        <Aviso titulo="Parámetros de otro ejercicio">
          Los parámetros fiscales son de {fiscal.ejercicio}. Si la normativa de {anio} es distinta, actualízalos en Ajustes.
        </Aviso>
      )}

      {sinDatos ? (
        <section className="card"><p className="muted">No hay ingresos de {anio} para estimar la renta.</p></section>
      ) : (
        <>
          <section className="card" aria-labelledby="t-res">
            <h2 id="t-res" className={r.tipoResultado === 'pagar' ? 'neg' : r.tipoResultado === 'devolver' ? 'pos' : ''}>{mensaje.titulo}</h2>
            <p>{mensaje.texto}</p>
            <p className="peq muted">
              ¿Obligado a declarar? <strong>{r.obligacion.obligado ? 'SÍ' : 'NO'}</strong> · {r.obligacion.numPagadores} {r.obligacion.numPagadores === 1 ? 'pagador' : 'pagadores'}. {r.obligacion.motivo}
            </p>
            {r.tipoResultado === 'pagar' && r.obligacion.obligado && (
              <>
                <div className="botones">
                  <button type="button" className="btn primario" onClick={() => void crearGasto(false)}>Crear gasto en junio {anio + 1}</button>
                  <button type="button" className="btn" onClick={() => void crearGasto(true)}>60 % junio / 40 % noviembre</button>
                </div>
                {existentes > 0 && !hecho && <p className="peq muted" style={{ marginTop: 6 }}>Ya existe un gasto de esta renta; si creas otro, se sustituye.</p>}
              </>
            )}
            {hecho && <Aviso tipo="info">{hecho}</Aviso>}
            {sugerida !== null && (
              <Aviso tipo="info" titulo="Evita pagar en junio">
                Te quedan {formatearEuros(prep.brutoPendienteEmpresa)} brutos previstos de la empresa. Si pides por escrito que te retengan un {formatearPorcentaje(sugerida)} adicional sobre lo que ya te retienen, llegarías a junio en torno a cero. La normativa del IRPF permite pedir un tipo de retención mayor que el que te toca.
              </Aviso>
            )}
          </section>

          <section className="card" aria-labelledby="t-pag">
            <h2 id="t-pag">Pagadores</h2>
            <div className="tabla-scroll">
              <table>
                <thead><tr><th scope="col">Pagador</th><th scope="col">Bruto</th><th scope="col">SS</th><th scope="col">Retención</th></tr></thead>
                <tbody>
                  {prep.entrada.pagadores.map((p) => (
                    <tr key={p.pagadorId}>
                      <td>{p.nombre}<span className="sr-only"> ({p.tipo})</span></td>
                      <td><Importe c={p.bruto} /></td>
                      <td><Importe c={p.seguridadSocial} /></td>
                      <td><Importe c={p.retencion} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="peq muted" style={{ marginTop: 8 }}>
              El SEPE cuenta como un pagador más. Suma del 2.º y siguientes pagadores: {formatearEuros(r.obligacion.segundoYSiguientes)}.
            </p>
          </section>

          <section className="card" aria-labelledby="t-des">
            <h2 id="t-des">Cálculo paso a paso</h2>
            <table className="desglose">
              <tbody>
                <Linea texto="Rendimiento íntegro del trabajo" c={r.integro} ayuda={r.propinasIncluidas > 0 ? `Incluye ${formatearEuros(r.propinasIncluidas)} de propinas` : undefined} />
                <Linea texto="Seguridad Social" c={r.seguridadSocial} signo="−" />
                <Linea texto="Rendimiento neto previo" c={r.rendimientoNetoPrevio} total />
                <Linea texto="Otros gastos deducibles (art. 19.2.f)" c={r.otrosGastos} signo="−" />
                <Linea texto="Reducción por rendimientos del trabajo (art. 20)" c={r.reduccion} signo="−" />
                <Linea texto="Base liquidable" c={r.baseLiquidable} total />
                <Linea texto="Mínimo personal" c={r.minimoPersonal} ayuda="Tributa al 0 %: se resta la cuota del mínimo" />
                <Linea texto="Cuota estatal" c={r.cuotaEstatal} />
                <Linea texto={`Cuota autonómica (${fiscal.nombreAutonomia})`} c={r.cuotaAutonomica} signo="+" />
                <Linea texto="Deducción autonómica por alquiler" c={r.deduccionAlquiler} signo="−" ayuda={`${r.motivoAlquiler} Alquiler usado: ${formatearEuros(prep.entrada.alquilerAnual)} (${prep.origenAlquiler === 'manual' ? 'importe manual' : 'gastos de Alquiler'}).`} />
                {fiscal.sueldosBajos.activa && <Linea texto="Deducción por rendimientos del trabajo bajos" c={r.deduccionSueldosBajos} signo="−" />}
                <Linea texto="Cuota líquida" c={r.cuotaLiquida} total />
                <Linea texto="Retenciones ya pagadas" c={r.retenciones} signo="−" />
                <tr className="total">
                  <td>{r.tipoResultado === 'devolver' ? 'A devolver' : r.tipoResultado === 'pagar' ? 'A pagar' : 'Resultado'}</td>
                  <td><Importe c={Math.abs(r.resultado)} className={r.tipoResultado === 'pagar' ? 'neg' : r.tipoResultado === 'devolver' ? 'pos' : ''} /></td>
                </tr>
              </tbody>
            </table>
            <p className="peq muted" style={{ marginTop: 8 }}>Tipo efectivo sobre el íntegro: {formatearPorcentaje(r.tipoEfectivo)}.</p>
          </section>

          <section className="card" aria-labelledby="t-not">
            <h2 id="t-not">Antes de presentarla</h2>
            <ul className="peq" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Coteja cada pagador con los datos fiscales de la AEAT (bruto, retenciones y Seguridad Social).</li>
              <li>Solo cuenta rendimientos del trabajo: si tienes intereses, inversiones o alquileres cobrados, el resultado cambia.</li>
              {prep.entrada.propinas > 0 && !fiscal.incluirPropinas && (
                <li>Tienes {formatearEuros(prep.entrada.propinas)} en propinas registradas. Son rendimiento del trabajo y deberían declararse; no están en esta estimación.</li>
              )}
              {ajustes.alquilerANombre && <li>Para la deducción por alquiler, ten a mano el contrato a tu nombre, el depósito de la fianza y los justificantes de pago por banco.</li>}
              {r.tipoResultado === 'pagar' && r.obligacion.obligado && <li>Para fraccionar 60/40 sin intereses, domicilia el primer plazo dentro del plazo de domiciliación de la campaña.</li>}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
