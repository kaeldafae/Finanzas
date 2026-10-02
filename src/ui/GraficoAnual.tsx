import type { CSSProperties } from 'react';
import { formatearEuros } from '../domain/dinero';
import { nombreMes } from '../domain/modelo';
import type { ResumenMes } from '../domain/resumen';

/** Barras de ingresos y gastos por mes en SVG, sin librerías. Los meses previstos van rayados. */
export function GraficoAnual({ meses }: { meses: readonly ResumenMes[] }) {
  const ancho = 360;
  const alto = 180;
  const margenInf = 20;
  const margenSup = 8;
  const maximo = Math.max(1, ...meses.map((m) => Math.max(m.ingresos, m.gastos)));
  const grupo = ancho / 12;
  const barra = (grupo - 6) / 2;
  const escala = (v: number) => ((alto - margenInf - margenSup) * v) / maximo;
  const descripcion = meses
    .filter((m) => m.estado !== 'vacio')
    .map((m) => `${nombreMes(m.mes)}: ingresos ${formatearEuros(m.ingresos)}, gastos ${formatearEuros(m.gastos)}${m.estado === 'previsto' ? ' (previsto)' : ''}`)
    .join('. ');

  return (
    <figure style={{ margin: 0 }}>
      <svg className="grafico" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`Ingresos y gastos por mes. ${descripcion || 'Sin datos.'}`}>
        <defs>
          <pattern id="rayado-in" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--bar-in)" opacity=".25" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bar-in)" strokeWidth="3" />
          </pattern>
          <pattern id="rayado-out" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--bar-out)" opacity=".25" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bar-out)" strokeWidth="3" />
          </pattern>
        </defs>
        <line x1="0" x2={ancho} y1={alto - margenInf} y2={alto - margenInf} stroke="var(--border)" />
        {meses.map((m, i) => {
          const x = i * grupo + 3;
          const previsto = m.estado === 'previsto';
          const hIn = escala(m.ingresos);
          const hOut = escala(m.gastos);
          return (
            <g key={m.mes}>
              <rect x={x} y={alto - margenInf - hIn} width={barra} height={hIn} rx="2" fill={previsto ? 'url(#rayado-in)' : 'var(--bar-in)'} />
              <rect x={x + barra} y={alto - margenInf - hOut} width={barra} height={hOut} rx="2" fill={previsto ? 'url(#rayado-out)' : 'var(--bar-out)'} />
              <text x={x + barra} y={alto - 6} textAnchor="middle">{nombreMes(m.mes).slice(0, 1)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="leyenda">
        <span style={{ '--c': 'var(--bar-in)' } as CSSProperties}>Ingresos</span>
        <span style={{ '--c': 'var(--bar-out)' } as CSSProperties}>Gastos</span>
        <span>Rayado = previsto</span>
      </figcaption>
    </figure>
  );
}
