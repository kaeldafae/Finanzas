import { useId, useMemo, useState } from 'react';
import { consenso, crearPeticion, itemsDudosos, leerRespuesta, type Consenso, type ItemIA, type PropuestaIA } from '../../domain/importacion/ia';
import type { Decision, MovimientoPropuesto } from '../../domain/importacion/importar';
import type { Categoria } from '../../domain/modelo';
import { Aviso } from '../../ui/base';

interface Props {
  movs: readonly MovimientoPropuesto[];
  decisiones: ReadonlyMap<string, Decision>;
  categorias: readonly Categoria[];
  dudoso: (m: MovimientoPropuesto) => boolean;
  /** Aplica las propuestas aceptadas: id de movimiento → categoría y tipo. */
  onAplicar: (cambios: Map<string, { categoriaId: string; tipo: Decision['tipoGasto']; nota: string }>, resultado: Consenso[]) => void;
}

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

function Paso({ numero, peticion, respuesta, onRespuesta, errores, leidas }: { numero: 1 | 2; peticion: string; respuesta: string; onRespuesta: (t: string) => void; errores: string[]; leidas: number }) {
  const id = useId();
  const [copiado, setCopiado] = useState<boolean | null>(null);
  const compartir = typeof navigator.share === 'function';
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
      <h3>{numero === 1 ? '1.ª revisión' : '2.ª revisión (independiente)'}</h3>
      <p className="peq muted">
        {numero === 1 ? 'Copia la petición, pégala en un chat nuevo de Claude y pega aquí debajo la respuesta completa.' : 'Pégala en OTRO chat nuevo (no en el mismo) para que la segunda opinión sea independiente.'}
      </p>
      <details className="peq">
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Ver exactamente lo que vas a compartir</summary>
        <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8, fontSize: '.8rem' }}>{peticion}</pre>
      </details>
      <div className="botones">
        <button type="button" className="btn" onClick={() => void copiar(peticion).then(setCopiado)}>{copiado ? 'Copiado ✓' : 'Copiar petición'}</button>
        {compartir && <button type="button" className="btn" onClick={() => void navigator.share({ text: peticion }).catch(() => undefined)}>Compartir…</button>}
      </div>
      {copiado === false && <Aviso>No se ha podido copiar automáticamente. Abre «Ver exactamente…» y cópialo a mano.</Aviso>}
      <div className="campo" style={{ marginTop: 10 }}>
        <label htmlFor={id}>Respuesta de la IA</label>
        <textarea id={id} rows={4} value={respuesta} onChange={(e) => onRespuesta(e.target.value)} placeholder="Pega aquí la respuesta completa" spellCheck={false} />
        {respuesta && <span className="ayuda">{leidas} {leidas === 1 ? 'respuesta válida' : 'respuestas válidas'}.</span>}
      </div>
      {errores.length > 0 && (
        <Aviso titulo="Avisos al leer la respuesta">
          <ul className="peq" style={{ margin: 0, paddingLeft: 18 }}>{errores.map((e) => <li key={e}>{e}</li>)}</ul>
        </Aviso>
      )}
    </div>
  );
}

const TEXTO_ESTADO: Record<Consenso['estado'], string> = {
  coinciden: '✓ Coinciden',
  'una-revision': 'Una revisión',
  discrepan: '✗ No coinciden',
  'baja-seguridad': '? Poco segura',
  'contradice-diccionario': '✗ Contradice a la app',
};

export function RevisionIA({ movs, decisiones, categorias, dudoso, onAplicar }: Props) {
  // La lista se fija al abrir: si cambias decisiones a mano, los números no se mueven bajo tus pies.
  const [items] = useState<ItemIA[]>(() => itemsDudosos(movs, decisiones, dudoso));
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [aplicado, setAplicado] = useState<Consenso[] | null>(null);
  const p1 = useMemo(() => crearPeticion(items, categorias, 1), [items, categorias]);
  const p2 = useMemo(() => crearPeticion(items, categorias, 2), [items, categorias]);
  const l1 = useMemo(() => (r1.trim() ? leerRespuesta(r1, items, categorias) : null), [r1, items, categorias]);
  const l2 = useMemo(() => (r2.trim() ? leerRespuesta(r2, items, categorias) : null), [r2, items, categorias]);
  const nombre = (id: string) => categorias.find((c) => c.id === id)?.nombre ?? 'Otros';

  if (items.length === 0) return null;

  function aplicar() {
    if (!l1) return;
    const vacio = new Map<number, PropuestaIA>();
    // La opinión de la app: la propuesta del diccionario/reglas, si era segura.
    const opinion = (it: ItemIA) => {
      const m = movs.find((x) => x.id === it.ids[0]);
      const segura = Boolean(m && m.propuesta.confianza >= 0.8 && m.propuesta.motivo !== 'Comercio desconocido');
      return { categoriaId: segura ? (decisiones.get(it.ids[0] ?? '')?.categoriaId ?? null) : null, segura };
    };
    const res = consenso(items, l1.propuestas, l2 ? l2.propuestas : r2.trim() ? vacio : null, opinion, nombre);
    const cambios = new Map<string, { categoriaId: string; tipo: Decision['tipoGasto']; nota: string }>();
    for (const c of res) {
      if (!c.categoriaId) continue;
      const it = items.find((i) => i.n === c.n);
      for (const id of it?.ids ?? []) cambios.set(id, { categoriaId: c.categoriaId, tipo: c.tipo, nota: c.explicacion });
    }
    setAplicado(res);
    onAplicar(cambios, res);
  }

  const coinciden = aplicado?.filter((c) => c.estado === 'coinciden').length ?? 0;
  return (
    <section className="card" aria-labelledby="t-ia">
      <h2 id="t-ia">Revisión con IA (opcional)</h2>
      <p className="peq">
        {items.length} {items.length === 1 ? 'comercio dudoso' : 'comercios dudosos'}. Se comparte solo el nombre del comercio, cuántas veces aparece y un rango de importe: sin importes exactos, fechas, cuentas ni nombres de personas. Los Bizum y transferencias a personas no se incluyen.
      </p>
      <p className="peq muted">Para más seguridad, haz las dos revisiones: solo se acepta lo que coincide en ambas y no contradice a la app. Al final siempre confirmas tú.</p>
      <Paso numero={1} peticion={p1} respuesta={r1} onRespuesta={(t) => { setR1(t); setAplicado(null); }} errores={l1?.errores ?? []} leidas={l1?.propuestas.size ?? 0} />
      <Paso numero={2} peticion={p2} respuesta={r2} onRespuesta={(t) => { setR2(t); setAplicado(null); }} errores={l2?.errores ?? []} leidas={l2?.propuestas.size ?? 0} />
      <button type="button" className="btn primario bloque" style={{ marginTop: 12 }} disabled={!l1 || l1.propuestas.size === 0} onClick={aplicar}>
        {r2.trim() ? 'Comparar las dos revisiones y aplicar' : 'Aplicar (solo una revisión)'}
      </button>
      {aplicado && (
        <>
          <p className="peq" style={{ marginTop: 10 }} aria-live="polite">
            {coinciden} de {aplicado.length} con acuerdo pleno. Lo demás queda para que lo decidas tú.
          </p>
          <ul className="lista">
            {aplicado.map((c) => (
              <li key={c.n} className="fila">
                <span className="principal">{items.find((i) => i.n === c.n)?.comercio}<span className="secundario" style={{ display: 'block' }}>{c.explicacion}</span></span>
                <span className={`etiqueta ${c.estado === 'coinciden' ? 'real' : ''}`}>{TEXTO_ESTADO[c.estado]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
