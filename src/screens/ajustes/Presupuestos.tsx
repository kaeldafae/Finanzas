import { borrarRegla, guardarPresupuestos } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { CampoAuto } from '../../ui/CampoAuto';

export function Presupuestos() {
  const { datos } = useEstado();
  const presupuesto = new Map(datos.presupuestos.map((p) => [p.id, p.importe]));
  const nombre = (id: string) => datos.categorias.find((c) => c.id === id)?.nombre ?? 'Categoría eliminada';
  return (
    <>
      <section className="card" aria-labelledby="t-pres">
        <h2 id="t-pres">Presupuesto mensual</h2>
        <p className="peq muted">Lo máximo que quieres gastar al mes en cada categoría. Escribe 0 para no tener límite. En la pantalla Mes verás cuánto llevas.</p>
        <div className="rejilla-2">
          {datos.categorias.filter((c) => !c.archivada).map((c) => (
            <CampoAuto key={c.id} etiqueta={c.nombre} tipo="importe" valor={presupuesto.get(c.id) ?? 0} onGuardar={(v) => guardarPresupuestos([{ categoriaId: c.id, importe: v }])} />
          ))}
        </div>
      </section>
      {datos.reglas.length > 0 && (
        <section className="card" aria-labelledby="t-reglas-imp">
          <h2 id="t-reglas-imp">Reglas aprendidas del importador</h2>
          <p className="peq muted">Cada comercio va siempre a su categoría. Borra una regla si ya no es correcta.</p>
          <ul className="lista">
            {datos.reglas.map((r) => (
              <li key={r.id} className="fila">
                <span className="principal">«{r.id}»<span className="secundario" style={{ display: 'block' }}>{nombre(r.categoriaId)} · {r.tipo}</span></span>
                <button type="button" className="btn compacto" onClick={() => void borrarRegla(r.id)} aria-label={`Borrar regla ${r.id}`}>Borrar</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
