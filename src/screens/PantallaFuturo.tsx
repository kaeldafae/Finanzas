import { useMemo, useState } from 'react';
import { useAnalisis } from '../calculos';
import { parsearEuros, sumar } from '../domain/dinero';
import { compararPeriodos, nombreMes } from '../domain/modelo';
import { HORIZONTES, prever, type Confianza, type OrigenPrevision } from '../domain/prevision';
import { useEstado } from '../estado';
import { Aviso, CampoTexto, Importe, Segmentado } from '../ui/base';

const ORIGEN: Record<OrigenPrevision, string> = { planificado: 'Planificado', estimado: 'Estimado', simulado: 'Simulado' };
const CONFIANZA: Record<Confianza, string> = { alta: 'confianza alta', media: 'confianza media', baja: 'confianza baja' };

function euros(texto: string): number {
  if (texto.trim() === '') return 0;
  const r = parsearEuros(texto);
  return r.ok ? r.valor : 0;
}

/** Previsión de caja: lo planificado, lo estimado con tu historia y tus simulaciones, siempre por separado. */
export function PantallaFuturo() {
  const { datos, indice, hoy, ajustes } = useEstado();
  const analisis = useAnalisis();
  const [dias, setDias] = useState<(typeof HORIZONTES)[number]>(90);
  const [menosGasto, setMenosGasto] = useState('');
  const [masIngreso, setMasIngreso] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const saldoActual = useMemo(
    () => ajustes.ahorroInicial + sumar(analisis.serie.filter((m) => compararPeriodos(m, hoy) <= 0 && m.estado !== 'vacio').map((m) => m.resultado)),
    [analisis.serie, ajustes.ahorroInicial, hoy],
  );
  const base = useMemo(() => prever({ datos, indice, serie: analisis.serie, saldoActual, hoy, dias }), [datos, indice, analisis.serie, saldoActual, hoy, dias]);
  const simulacion = { menosGastoMensual: euros(menosGasto), masIngresoMensual: euros(masIngreso) };
  const haySimulacion = simulacion.menosGastoMensual !== 0 || simulacion.masIngresoMensual !== 0;
  // Barato de calcular: unos pocos meses.
  const simulada = haySimulacion ? prever({ datos, indice, serie: analisis.serie, saldoActual, hoy, dias, simulacion }) : null;
  const etiqueta = (p: { anio: number; mes: number }) => `${nombreMes(p.mes).slice(0, 3)} ${p.anio}`;

  return (
    <>
      <h1>Futuro</h1>
      <section className="card" aria-labelledby="t-prev">
        <h2 id="t-prev">Previsión de tu dinero</h2>
        <Segmentado
          etiqueta="Horizonte"
          valor={String(dias)}
          onCambio={(v) => setDias(Number(v) as (typeof HORIZONTES)[number])}
          opciones={HORIZONTES.map((h) => ({ valor: String(h), texto: `${h} días` }))}
        />
        <div className="kpis" style={{ marginTop: 12 }}>
          <div className="kpi"><div className="t">Hoy</div><div className="v"><Importe c={base.saldoInicial} /></div></div>
          <div className="kpi"><div className="t">Al final</div><div className="v"><Importe c={base.saldoFinal} /></div></div>
          <div className="kpi"><div className="t">Mínimo</div><div className="v"><Importe c={base.minimo.saldo} /></div></div>
        </div>
        {base.minimo.saldo < 0 && (
          <Aviso titulo={`En ${etiqueta(base.minimo.periodo)} el saldo previsto queda en negativo`}>
            Revisa los gastos de esos meses o prevé ingresos. Es una estimación, no un hecho.
          </Aviso>
        )}
        <p className="peq muted" style={{ marginTop: 8 }}>
          Saldo de hoy: ahorro inicial más el resultado de los meses registrados hasta {etiqueta(hoy)}. Datos usados: {base.datosUsados}.
        </p>
      </section>

      <section className="card" aria-labelledby="t-meses">
        <h2 id="t-meses">Mes a mes</h2>
        <ul className="lista">
          {base.meses.map((m) => {
            const k = `${m.anio}-${m.mes}`;
            return (
              <li key={k} className="fila" style={{ display: 'block' }}>
                <button type="button" className="btn fila-boton" aria-expanded={abierto === k} onClick={() => setAbierto(abierto === k ? null : k)} style={{ width: '100%' }}>
                  <span className="principal">
                    <strong>{nombreMes(m.mes)} {m.anio}</strong>
                    <span className="secundario" style={{ display: 'block' }}>
                      Entra <Importe c={m.ingresos} /> · sale <Importe c={m.gastos} /> · {CONFIANZA[m.confianza]}
                    </span>
                  </span>
                  <Importe c={m.saldoFinal} />
                </button>
                {abierto === k && (
                  <ul className="peq" style={{ paddingLeft: 18, margin: '4px 0 8px' }}>
                    {m.lineas.map((l, i) => (
                      <li key={i}>
                        <span className="etiqueta">{ORIGEN[l.origen]}</span> {l.concepto}: <Importe c={l.importe} signo /> <span className="muted">({l.detalle})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {base.supuestos.length > 0 && (
          <>
            <h3 className="peq" style={{ marginBottom: 4 }}>Supuestos</h3>
            <ul className="peq muted" style={{ paddingLeft: 18, margin: 0 }}>{base.supuestos.map((s) => <li key={s}>{s}</li>)}</ul>
          </>
        )}
        <p className="peq muted" style={{ marginTop: 8 }}>
          <strong>Planificado</strong>: lo que tienes apuntado como previsto y tus pagos recurrentes (Ajustes → Pagos recurrentes). <strong>Estimado</strong>: calculado con tu historia; con trabajo de temporada se usa el mismo mes del año anterior.
        </p>
      </section>

      <section className="card" aria-labelledby="t-sim">
        <h2 id="t-sim">¿Y si…?</h2>
        <p className="peq muted">Simulación: no cambia tus datos ni la previsión de arriba.</p>
        <div className="rejilla-2">
          <CampoTexto etiqueta="Gastar menos al mes (€)" tipo="importe" valor={menosGasto} onCambio={setMenosGasto} />
          <CampoTexto etiqueta="Ingresar más al mes (€)" tipo="importe" valor={masIngreso} onCambio={setMasIngreso} />
        </div>
        {simulada && (
          <div className="kpis">
            <div className="kpi"><div className="t">Sin cambios</div><div className="v"><Importe c={base.saldoFinal} /></div></div>
            <div className="kpi"><div className="t">Con la simulación</div><div className="v"><Importe c={simulada.saldoFinal} /></div></div>
            <div className="kpi"><div className="t">Diferencia</div><div className="v"><Importe c={simulada.saldoFinal - base.saldoFinal} signo /></div></div>
          </div>
        )}
      </section>
    </>
  );
}
