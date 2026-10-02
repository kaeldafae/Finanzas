import { useAnalisis } from '../calculos';
import { formatearPorcentaje } from '../domain/dinero';
import { nombreMes } from '../domain/modelo';
import { CLAVES_REPARTO, ETIQUETAS_REPARTO } from '../domain/reparto';
import { useEstado } from '../estado';
import { Aviso, Barra, Importe } from '../ui/base';
import { EditorReparto } from '../ui/EditorReparto';
import { escenariosAhorro } from '../domain/objetivos';
import { euros, formatearEuros } from '../domain/dinero';
import { Objetivos } from './ahorro/Objetivos';

export function PantallaColchon() {
  const { ajustes, hoy } = useEstado();
  const a = useAnalisis();
  const est = a.estimacion;
  const reglas = est?.completo ? ajustes.repartoCompleto : ajustes.repartoIncompleto;
  const ultimos = (a.real?.pasos ?? []).slice(-12).reverse();

  return (
    <>
      <h1>Ahorro</h1>

      {a.errorReparto && <Aviso titulo="Reglas de reparto no válidas">{a.errorReparto}</Aviso>}

      {a.objetivo === 0 && (
        <Aviso tipo="info" titulo="Aún no hay objetivo">
          El objetivo se calcula con tu gasto medio mensual. Registra los gastos de al menos un mes real.
        </Aviso>
      )}

      {est && (
        <section className="card" aria-labelledby="t-col">
          <h2 id="t-col">{est.completo ? 'Colchón de seguridad completo ✓' : 'Colchón de seguridad'}</h2>
          <div className="grande"><Importe c={est.acumulado} /></div>
          <p className="muted">de <Importe c={est.objetivo} /> ({ajustes.mesesColchon} meses × <Importe c={a.gastoMedio} /> de gasto medio)</p>
          <Barra valor={est.progreso} etiqueta="Progreso del colchón" />
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="t">Falta</div><div className="v"><Importe c={est.falta} /></div></div>
            <div className="kpi"><div className="t">Aporte medio</div><div className="v"><Importe c={est.aportacionMedia} signo /></div></div>
            <div className="kpi">
              <div className="t">Completo en</div>
              <div className="v">
                {est.completo ? 'Ya está' : est.fechaEstimada ? `${nombreMes(est.fechaEstimada.mes).slice(0, 3)} ${est.fechaEstimada.anio}` : '—'}
              </div>
            </div>
          </div>
          {!est.completo && est.fechaEstimada === null && a.objetivo > 0 && (
            <p className="peq muted" style={{ marginTop: 8 }}>Sin aportaciones positivas recientes no se puede estimar la fecha.</p>
          )}
          {est.acumulado < 0 && <Aviso titulo="Colchón en negativo">Los meses en negativo han consumido el ahorro inicial.</Aviso>}
          {!est.completo && est.falta > 0 && (
            <p className="peq" style={{ marginTop: 8 }}>
              ¿Y si apartas…?{' '}
              {escenariosAhorro(est.falta, [euros(100), euros(200), euros(300)], hoy).map((s) => (
                <span key={s.aportacion} className="etiqueta" style={{ marginRight: 6 }}>
                  {formatearEuros(s.aportacion)}/mes → {s.fecha ? `${nombreMes(s.fecha.mes).slice(0, 3)} ${s.fecha.anio}` : '—'}
                </span>
              ))}
            </p>
          )}
          <p className="peq muted" style={{ marginTop: 8 }}>
            Cuenta el ahorro inicial y solo los meses reales. Aporte medio de los últimos 6 meses reales.
          </p>
        </section>
      )}

      <Objetivos />

      {a.real && (
        <section className="card" aria-labelledby="t-acum">
          <h2 id="t-acum">Repartido hasta hoy</h2>
          <div className="reparto">
            {CLAVES_REPARTO.map((k) => (
              <div className="kpi" key={k}><div className="t">{ETIQUETAS_REPARTO[k]}</div><div className="v"><Importe c={a.real?.acumulado[k] ?? 0} /></div></div>
            ))}
          </div>
          <p className="peq muted" style={{ marginTop: 8 }}>
            Regla actual: {CLAVES_REPARTO.filter((k) => reglas[k] > 0).map((k) => `${formatearPorcentaje(reglas[k])} ${ETIQUETAS_REPARTO[k].toLowerCase()}`).join(' · ')}
          </p>
        </section>
      )}

      {ultimos.length > 0 && (
        <section className="card" aria-labelledby="t-hist">
          <h2 id="t-hist">Últimos meses</h2>
          <ul className="lista">
            {ultimos.map((p) => (
              <li className="fila" key={`${p.anio}-${p.mes}`}>
                <span className="principal">
                  {nombreMes(p.mes)} {p.anio}
                  <span className="secundario" style={{ display: 'block' }}>
                    Resultado <Importe c={p.resultado} signo />{p.completaColchon ? ' · completa el colchón' : ''}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <Importe c={p.reparto.colchon} signo />
                  <span className="secundario" style={{ display: 'block' }}><Importe c={p.colchonFin} /></span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="t-reglas">
        <h2 id="t-reglas">Reglas de reparto</h2>
        <p className="peq muted">Si un mes sale negativo no se reparte nada: se resta del colchón.</p>
        <EditorReparto />
      </section>
    </>
  );
}
