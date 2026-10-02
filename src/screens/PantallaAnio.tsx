import { useMemo } from 'react';
import { useAnalisis } from '../calculos';
import { compararPeriodos, nombreMes, type Periodo } from '../domain/modelo';
import { serieMeses, totalesAnio } from '../domain/resumen';
import { useEstado } from '../estado';
import { Importe } from '../ui/base';
import { GraficoAnual } from '../ui/GraficoAnual';
import { IconoAdelante, IconoAtras } from '../ui/iconos';

export function SelectorAnio({ anio, onCambio, titulo }: { anio: number; onCambio: (a: number) => void; titulo: string }) {
  return (
    <div className="selector">
      <button type="button" className="btn icono" onClick={() => onCambio(anio - 1)} aria-label="Año anterior"><IconoAtras /></button>
      <h1 aria-live="polite">{titulo} {anio}</h1>
      <button type="button" className="btn icono" onClick={() => onCambio(anio + 1)} aria-label="Año siguiente"><IconoAdelante /></button>
    </div>
  );
}

export function PantallaAnio({ anio, onCambioAnio, onAbrirMes }: { anio: number; onCambioAnio: (a: number) => void; onAbrirMes: (p: Periodo) => void }) {
  const { indice, hoy, ajustes } = useEstado();
  const analisis = useAnalisis();
  const meses = useMemo(() => serieMeses(indice, { anio, mes: 1 }, { anio, mes: 12 }, hoy), [indice, anio, hoy]);
  const totales = totalesAnio(meses);

  // Saldo acumulado desde el ahorro inicial (desde el mes de inicio configurado).
  const saldos = useMemo(() => {
    const mapa = new Map<number, number>();
    let saldo = ajustes.ahorroInicial;
    for (const m of analisis.serie) {
      saldo += m.resultado;
      if (m.anio === anio) mapa.set(m.mes, saldo);
    }
    return mapa;
  }, [analisis.serie, ajustes.ahorroInicial, anio]);
  const saldoFinal = saldos.get(12);

  return (
    <>
      <SelectorAnio anio={anio} onCambio={onCambioAnio} titulo="Año" />

      <section className="card" aria-labelledby="t-tot">
        <h2 id="t-tot">Totales del año</h2>
        <div className="kpis">
          <div className="kpi"><div className="t">Ingresos</div><div className="v"><Importe c={totales.ingresos} /></div></div>
          <div className="kpi"><div className="t">Gastos</div><div className="v"><Importe c={totales.gastos} /></div></div>
          <div className="kpi"><div className="t">Resultado</div><div className="v"><Importe c={totales.resultado} signo /></div></div>
        </div>
        <p className="peq muted" style={{ marginTop: 8 }}>
          {totales.mesesReales} reales · {totales.mesesPrevistos} previstos · {totales.mesesVacios} sin registrar
          {saldoFinal !== undefined && <> · Saldo a diciembre: <Importe c={saldoFinal} /></>}
        </p>
      </section>

      <section className="card" aria-labelledby="t-graf">
        <h2 id="t-graf">Ingresos y gastos</h2>
        <GraficoAnual meses={meses} />
      </section>

      <section className="card" aria-labelledby="t-tabla">
        <h2 id="t-tabla">Mes a mes</h2>
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th scope="col">Mes</th><th scope="col">Ingresos €</th><th scope="col">Gastos €</th><th scope="col">Result. €</th><th scope="col">Saldo €</th></tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const saldo = saldos.get(m.mes);
                const futuro = compararPeriodos(m, hoy) > 0;
                return (
                  <tr key={m.mes} className={m.estado}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>
                      <button type="button" className="btn celda" onClick={() => onAbrirMes({ anio, mes: m.mes })}>
                        {nombreMes(m.mes).slice(0, 3)}
                        {m.estado === 'previsto' && <span className="sr-only"> (previsto)</span>}
                        {m.estado === 'vacio' && !futuro && <span className="sr-only"> (sin registrar)</span>}
                      </button>
                    </th>
                    <td><Importe cifra c={m.ingresos} /></td>
                    <td><Importe cifra c={m.gastos} /></td>
                    <td><Importe cifra c={m.resultado} signo={m.estado !== 'vacio'} /></td>
                    <td>{saldo !== undefined ? <Importe cifra c={saldo} /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td><Importe cifra c={totales.ingresos} /></td>
                <td><Importe cifra c={totales.gastos} /></td>
                <td><Importe cifra c={totales.resultado} signo /></td>
                <td>{saldoFinal !== undefined ? <Importe cifra c={saldoFinal} /> : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="peq muted" style={{ marginTop: 8 }}>
          En cursiva y azul, los meses previstos; en gris, los no registrados. El saldo parte del ahorro inicial de {nombreMes(ajustes.inicioMes)} {ajustes.inicioAnio}.
        </p>
      </section>
    </>
  );
}
