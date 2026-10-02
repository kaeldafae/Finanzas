import { useState } from 'react';
import { parsearPorcentaje, tasaATexto, TASA_UNIDAD } from '../domain/dinero';
import type { Porcentajes } from '../domain/modelo';
import { CLAVES_REPARTO, ETIQUETAS_REPARTO, validarPorcentajes, type ClaveReparto } from '../domain/reparto';
import { guardarAjustes } from '../db/operaciones';
import { useEstado } from '../estado';
import { Aviso, CampoTexto } from './base';

type Textos = Record<ClaveReparto, string>;

const aTextos = (p: Porcentajes): Textos => ({
  colchon: tasaATexto(p.colchon),
  inversion: tasaATexto(p.inversion),
  objetivos: tasaATexto(p.objetivos),
  libre: tasaATexto(p.libre),
});

function GrupoPorcentajes({ titulo, textos, onCambio }: { titulo: string; textos: Textos; onCambio: (t: Textos) => void }) {
  const parseados = CLAVES_REPARTO.map((k) => parsearPorcentaje(textos[k]));
  const suma = parseados.reduce((s, r) => s + (r.ok ? r.valor : 0), 0);
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
      <legend style={{ fontWeight: 700, marginBottom: 6 }}>{titulo}</legend>
      <div className="rejilla-2">
        {CLAVES_REPARTO.map((k, i) => {
          const r = parseados[i];
          return (
            <CampoTexto
              key={k}
              etiqueta={`${ETIQUETAS_REPARTO[k]} (%)`}
              tipo="porcentaje"
              valor={textos[k]}
              onCambio={(v) => onCambio({ ...textos, [k]: v })}
              error={r && !r.ok ? r.error : undefined}
            />
          );
        })}
      </div>
      <p className={`peq ${suma === TASA_UNIDAD ? 'muted' : 'neg'}`} aria-live="polite">
        Suma: {tasaATexto(suma)} % {suma === TASA_UNIDAD ? '✓' : '(debe ser 100 %)'}
      </p>
    </fieldset>
  );
}

function aPorcentajes(t: Textos): Porcentajes | null {
  const out: Partial<Porcentajes> = {};
  for (const k of CLAVES_REPARTO) {
    const r = parsearPorcentaje(t[k] === '' ? '0' : t[k]);
    if (!r.ok) return null;
    out[k] = r.valor;
  }
  return out as Porcentajes;
}

export function EditorReparto() {
  const { ajustes } = useEstado();
  const [incompleto, setIncompleto] = useState(() => aTextos(ajustes.repartoIncompleto));
  const [completo, setCompleto] = useState(() => aTextos(ajustes.repartoCompleto));
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  async function guardar() {
    const a = aPorcentajes(incompleto);
    const b = aPorcentajes(completo);
    if (!a || !b) {
      setEstado({ tipo: 'error', texto: 'Hay porcentajes con formato no válido.' });
      return;
    }
    const error = validarPorcentajes(a) ?? validarPorcentajes(b);
    if (error) {
      setEstado({ tipo: 'error', texto: error });
      return;
    }
    await guardarAjustes({ repartoIncompleto: a, repartoCompleto: b });
    setEstado({ tipo: 'ok', texto: 'Reglas guardadas.' });
  }

  return (
    <>
      <GrupoPorcentajes titulo="Mientras el colchón no está completo" textos={incompleto} onCambio={(t) => { setIncompleto(t); setEstado(null); }} />
      <GrupoPorcentajes titulo="Con el colchón completo" textos={completo} onCambio={(t) => { setCompleto(t); setEstado(null); }} />
      {estado && (estado.tipo === 'error' ? <Aviso>{estado.texto}</Aviso> : <Aviso tipo="info">{estado.texto}</Aviso>)}
      <button type="button" className="btn primario bloque" onClick={() => void guardar()}>Guardar reglas</button>
    </>
  );
}
