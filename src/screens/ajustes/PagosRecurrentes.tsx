import { useMemo, useState } from 'react';
import { centimosATexto, formatearEuros, parsearEuros } from '../../domain/dinero';
import { costeMensual, detectarCompromisos } from '../../domain/compromisos';
import { nombreMes, PERIODICIDADES, sumarMeses, type Compromiso, type Periodicidad } from '../../domain/modelo';
import { borrarCompromiso, guardarCompromiso } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { CampoTexto, Dialogo, Importe, Selector } from '../../ui/base';

function FormCompromiso({ c, onCerrar }: { c: Compromiso | null; onCerrar: () => void }) {
  const { datos, hoy } = useEstado();
  const [nombre, setNombre] = useState(c?.nombre ?? '');
  const [categoriaId, setCategoriaId] = useState(c?.categoriaId ?? '');
  const [importe, setImporte] = useState(c ? centimosATexto(c.importe) : '');
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>(c?.periodicidad ?? 'mensual');
  const anterior = sumarMeses(hoy, -1);
  const [ultimo, setUltimo] = useState(c ? `${c.ultimoAnio}-${String(c.ultimoMes).padStart(2, '0')}` : `${anterior.anio}-${String(anterior.mes).padStart(2, '0')}`);
  const r = importe.trim() ? parsearEuros(importe) : null;
  const valor = r?.ok ? r.valor : 0;
  const m = /^(\d{4})-(\d{2})$/.exec(ultimo);
  const valido = nombre.trim() !== '' && categoriaId !== '' && valor > 0 && m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido) return;
        void guardarCompromiso({
          ...(c ? { id: c.id } : {}),
          nombre: nombre.trim(), categoriaId, importe: valor, periodicidad,
          ultimoAnio: Number(m[1]), ultimoMes: Number(m[2]), activo: c?.activo ?? true, origen: c?.origen ?? 'manual',
        }).then(onCerrar);
      }}
    >
      <CampoTexto etiqueta="Nombre" valor={nombre} onCambio={setNombre} maxLength={40} placeholder="Alquiler, Netflix, seguro del coche…" />
      <Selector etiqueta="Categoría" valor={categoriaId} onCambio={setCategoriaId}>
        <option value="">Elige…</option>
        {datos.categorias.filter((x) => !x.archivada).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
      </Selector>
      <div className="rejilla-2">
        <CampoTexto etiqueta="Importe (€)" tipo="importe" valor={importe} onCambio={setImporte} error={r && !r.ok ? r.error : undefined} />
        <Selector etiqueta="Cada" valor={periodicidad} onCambio={(v) => setPeriodicidad(v as Periodicidad)}>
          {PERIODICIDADES.map((p) => <option key={p} value={p}>{p === 'mensual' ? 'mes' : p === 'trimestral' ? 'trimestre' : 'año'}</option>)}
        </Selector>
      </div>
      <CampoTexto etiqueta="Último cargo (aaaa-mm)" valor={ultimo} onCambio={setUltimo} maxLength={7} ayuda="Con la periodicidad, la previsión sabe en qué meses toca pagarlo." />
      <div className="botones">
        {c && (
          <button type="button" className="btn peligro" onClick={() => window.confirm(`¿Borrar «${c.nombre}»?`) && void borrarCompromiso(c.id).then(onCerrar)}>
            Borrar
          </button>
        )}
        <button type="submit" className="btn primario" disabled={!valido}>Guardar</button>
      </div>
    </form>
  );
}

/** Pagos que se repiten: los detectados en tus gastos se proponen; solo cuentan en la previsión si los aceptas. */
export function PagosRecurrentes() {
  const { datos, hoy } = useEstado();
  const [editando, setEditando] = useState<Compromiso | 'nuevo' | null>(null);
  const sugerencias = useMemo(() => detectarCompromisos(datos.gastos, datos.compromisos, hoy), [datos.gastos, datos.compromisos, hoy]);
  const activos = datos.compromisos.filter((c) => c.activo);
  const nombreCat = (id: string) => datos.categorias.find((c) => c.id === id)?.nombre ?? 'Sin categoría';
  const cada = (p: Periodicidad) => (p === 'mensual' ? 'al mes' : p === 'trimestral' ? 'al trimestre' : 'al año');
  return (
    <section className="card" aria-labelledby="t-rec">
      <h2 id="t-rec">Pagos recurrentes</h2>
      <p className="peq muted">Alquiler, recibos, suscripciones y cuotas. Alimentan la previsión de la pantalla Futuro.</p>
      {activos.length > 0 && (
        <>
          <ul className="lista">
            {datos.compromisos.map((c) => (
              <li key={c.id} className="fila">
                <button type="button" className="btn fila-boton" onClick={() => setEditando(c)} style={{ width: '100%', opacity: c.activo ? 1 : 0.55 }}>
                  <span className="principal">
                    {c.nombre}
                    <span className="secundario" style={{ display: 'block' }}>
                      {nombreCat(c.categoriaId)} · último {nombreMes(c.ultimoMes).slice(0, 3)} {c.ultimoAnio}{c.activo ? '' : ' · pausado'}
                    </span>
                  </span>
                  <span><Importe c={c.importe} /> {cada(c.periodicidad)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="peq">Total equivalente: <strong>{formatearEuros(activos.reduce((s, c) => s + costeMensual(c), 0))} al mes</strong>.</p>
        </>
      )}
      {sugerencias.length > 0 && (
        <>
          <h3 className="peq" style={{ marginBottom: 4 }}>Detectados en tus gastos</h3>
          <ul className="lista">
            {sugerencias.map((s) => (
              <li key={s.clave} className="fila">
                <span className="principal">
                  {s.nombre}
                  <span className="secundario" style={{ display: 'block' }}>{nombreCat(s.categoriaId)} · {s.veces} veces · {formatearEuros(s.importe)} {cada(s.periodicidad)}</span>
                </span>
                <button
                  type="button"
                  className="btn compacto"
                  onClick={() => void guardarCompromiso({ nombre: s.nombre, categoriaId: s.categoriaId, importe: s.importe, periodicidad: s.periodicidad, ultimoAnio: s.ultimoAnio, ultimoMes: s.ultimoMes, activo: true, origen: 'detectado' })}
                >
                  Añadir
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {activos.length === 0 && sugerencias.length === 0 && <p className="muted">No hay pagos recurrentes. Se detectan solos cuando un gasto se repite cada mes, trimestre o año con un importe parecido.</p>}
      <button type="button" className="btn bloque" onClick={() => setEditando('nuevo')}>+ Añadir a mano</button>
      <Dialogo abierto={editando !== null} titulo={editando === 'nuevo' ? 'Nuevo pago recurrente' : 'Pago recurrente'} onCerrar={() => setEditando(null)}>
        {editando !== null && <FormCompromiso c={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
      </Dialogo>
    </section>
  );
}
