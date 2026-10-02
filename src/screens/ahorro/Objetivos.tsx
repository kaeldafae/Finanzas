import { useState } from 'react';
import { centimosATexto, euros, formatearEuros, parsearEuros, type Centimos } from '../../domain/dinero';
import { nombreMes, type ObjetivoAhorro, type Periodo } from '../../domain/modelo';
import { escenariosAhorro, estadoObjetivo } from '../../domain/objetivos';
import { aportarObjetivo, borrarObjetivo, guardarObjetivo } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { Barra, CampoTexto, Dialogo, Importe } from '../../ui/base';

const mesTexto = (p: Periodo) => `${nombreMes(p.mes).slice(0, 3)} ${p.anio}`;

function aCentimos(t: string): Centimos | null {
  if (t.trim() === '') return null;
  const r = parsearEuros(t);
  return r.ok ? r.valor : null;
}

function FormObjetivo({ objetivo, onCerrar }: { objetivo: ObjetivoAhorro | null; onCerrar: () => void }) {
  const [nombre, setNombre] = useState(objetivo?.nombre ?? '');
  const [meta, setMeta] = useState(objetivo ? centimosATexto(objetivo.importeObjetivo) : '');
  const [actual, setActual] = useState(objetivo ? centimosATexto(objetivo.importeActual) : '');
  const [mensual, setMensual] = useState(objetivo ? centimosATexto(objetivo.aportacionMensual) : '');
  const [fecha, setFecha] = useState(objetivo?.fechaObjetivo ?? '');
  const importeMeta = aCentimos(meta);
  const errorNombre = nombre.trim() ? undefined : 'Escribe un nombre';
  const errorMeta = importeMeta && importeMeta > 0 ? undefined : 'Escribe la cantidad objetivo';
  const errorFecha = fecha === '' || /^\d{4}-\d{2}$/.test(fecha) ? undefined : 'Formato aaaa-mm';
  const valido = !errorNombre && !errorMeta && !errorFecha;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido || !importeMeta) return;
        void guardarObjetivo({
          ...(objetivo ? { id: objetivo.id } : {}),
          nombre: nombre.trim(),
          importeObjetivo: importeMeta,
          importeActual: aCentimos(actual) ?? 0,
          aportacionMensual: aCentimos(mensual) ?? 0,
          fechaObjetivo: fecha || null,
          archivado: false,
        }).then(onCerrar);
      }}
    >
      <CampoTexto etiqueta="Nombre" valor={nombre} onCambio={setNombre} error={errorNombre} maxLength={40} placeholder="Viaje, moto, máster…" />
      <div className="rejilla-2">
        <CampoTexto etiqueta="Cantidad objetivo (€)" tipo="importe" valor={meta} onCambio={setMeta} error={errorMeta} />
        <CampoTexto etiqueta="Ya apartado (€)" tipo="importe" valor={actual} onCambio={setActual} />
        <CampoTexto etiqueta="Aportación al mes (€)" tipo="importe" valor={mensual} onCambio={setMensual} />
        <CampoTexto etiqueta="Fecha objetivo (aaaa-mm)" valor={fecha} onCambio={setFecha} error={errorFecha} placeholder="2027-06" maxLength={7} />
      </div>
      <div className="botones">
        {objetivo && (
          <button type="button" className="btn peligro" onClick={() => window.confirm(`¿Borrar el objetivo «${objetivo.nombre}»?`) && void borrarObjetivo(objetivo.id).then(onCerrar)}>
            Borrar
          </button>
        )}
        <button type="submit" className="btn primario" disabled={!valido}>Guardar</button>
      </div>
    </form>
  );
}

function Aportar({ objetivo, onCerrar }: { objetivo: ObjetivoAhorro; onCerrar: () => void }) {
  const [importe, setImporte] = useState('');
  const c = aCentimos(importe);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (c) void aportarObjetivo(objetivo.id, c).then(onCerrar);
      }}
    >
      <CampoTexto etiqueta="Importe (€)" tipo="importe" valor={importe} onCambio={setImporte} autoFocus ayuda="Para retirar dinero del objetivo, usa «Retirar»." />
      <div className="botones">
        <button type="button" className="btn" disabled={!c} onClick={() => c && void aportarObjetivo(objetivo.id, -c).then(onCerrar)}>Retirar</button>
        <button type="submit" className="btn primario" disabled={!c}>Aportar</button>
      </div>
    </form>
  );
}

/** Objetivos de ahorro y simulación de aportaciones. */
export function Objetivos() {
  const { datos, hoy } = useEstado();
  const [editando, setEditando] = useState<ObjetivoAhorro | 'nuevo' | null>(null);
  const [aportando, setAportando] = useState<ObjetivoAhorro | null>(null);
  const objetivos = datos.objetivos.filter((o) => !o.archivado);
  return (
    <section className="card" aria-labelledby="t-obj">
      <h2 id="t-obj">Objetivos de ahorro</h2>
      {objetivos.length === 0 && <p className="muted">Aún no tienes objetivos. Crea uno para ver cuándo lo alcanzarás y cuánto apartar al mes.</p>}
      <ul className="lista">
        {objetivos.map((o) => {
          const e = estadoObjetivo(o, hoy);
          return (
            <li key={o.id} className="fila" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{o.nombre}</strong>
                <span><Importe c={o.importeActual} /> de <Importe c={o.importeObjetivo} /></span>
              </div>
              <Barra valor={e.progreso} etiqueta={`Progreso de ${o.nombre}`} />
              <p className="peq muted" style={{ margin: '4px 0' }}>
                {e.completo
                  ? 'Completado ✓'
                  : `Falta ${formatearEuros(e.falta)}. ${e.fechaEstimada ? `Con ${formatearEuros(o.aportacionMensual)} al mes, en ${mesTexto(e.fechaEstimada)}.` : 'Sin aportación mensual no hay fecha estimada.'}`}
                {e.aportacionNecesaria !== null && !e.completo && ` Para llegar en ${o.fechaObjetivo ?? ''}: ${formatearEuros(e.aportacionNecesaria)} al mes durante ${e.mesesRestantes ?? 0} meses.`}
              </p>
              {!e.completo && (
                <p className="peq" style={{ margin: '4px 0' }}>
                  ¿Y si apartas…?{' '}
                  {escenariosAhorro(e.falta, [euros(100), euros(200), euros(300)], hoy).map((s) => (
                    <span key={s.aportacion} className="etiqueta" style={{ marginRight: 6 }}>
                      {formatearEuros(s.aportacion)}/mes → {s.fecha ? mesTexto(s.fecha) : '—'}
                    </span>
                  ))}
                </p>
              )}
              <div className="botones">
                <button type="button" className="btn compacto" onClick={() => setEditando(o)}>Editar</button>
                <button type="button" className="btn compacto primario" onClick={() => setAportando(o)}>Aportar</button>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn bloque" onClick={() => setEditando('nuevo')}>+ Nuevo objetivo</button>
      <p className="peq muted" style={{ marginTop: 8 }}>Los objetivos no mueven dinero: anotan lo que apartas. Las simulaciones no se guardan.</p>
      <Dialogo abierto={editando !== null} titulo={editando === 'nuevo' ? 'Nuevo objetivo' : 'Editar objetivo'} onCerrar={() => setEditando(null)}>
        {editando !== null && <FormObjetivo objetivo={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
      </Dialogo>
      <Dialogo abierto={aportando !== null} titulo={`Aportar a ${aportando?.nombre ?? ''}`} onCerrar={() => setAportando(null)}>
        {aportando && <Aportar objetivo={aportando} onCerrar={() => setAportando(null)} />}
      </Dialogo>
    </section>
  );
}
