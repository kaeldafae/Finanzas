import { useState } from 'react';
import { TIPOS_PAGADOR, type Pagador, type TipoPagador } from '../domain/modelo';
import { guardarPagador } from '../db/operaciones';
import { CampoTexto, Segmentado, Selector } from './base';

const NUEVO = '__nuevo__';

interface Props {
  etiqueta?: string;
  valor: string;
  onCambio: (id: string) => void;
  pagadores: readonly Pagador[];
  error?: string | undefined;
  /** Datos para rellenar la empresa nueva (p. ej. leídos de la nómina). */
  sugerencia?: { nombre: string; nif?: string | undefined } | undefined;
}

/** Selector de pagador con opción de crear una empresa nueva sin salir del formulario. */
export function SelectorPagador({ etiqueta = 'Empresa o pagador', valor, onCambio, pagadores, error, sugerencia }: Props) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState(sugerencia?.nombre ?? '');
  const [nif, setNif] = useState(sugerencia?.nif ?? '');
  const [tipo, setTipo] = useState<TipoPagador>('Empresa');

  async function crear() {
    const limpio = nombre.trim();
    if (!limpio) return;
    const id = await guardarPagador({ nombre: limpio, tipo, archivado: false, ...(nif.trim() ? { nif: nif.trim().toUpperCase() } : {}) });
    setCreando(false);
    onCambio(id);
  }

  return (
    <div>
      <Selector etiqueta={etiqueta} valor={creando ? NUEVO : valor} onCambio={(v) => (v === NUEVO ? setCreando(true) : (setCreando(false), onCambio(v)))} error={creando ? undefined : error}>
        <option value="">Elige…</option>
        {pagadores.filter((p) => !p.archivado || p.id === valor).map((p) => (
          <option key={p.id} value={p.id}>{p.nombre} ({p.tipo})</option>
        ))}
        <option value={NUEVO}>+ Nueva empresa o pagador…</option>
      </Selector>
      {creando && (
        <div
          className="card"
          style={{ background: 'var(--surface-2)' }}
          onKeyDown={(e) => {
            // Enter crea la empresa; no debe enviar el formulario del ingreso que la contiene.
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              void crear();
            }
          }}
        >
          <CampoTexto etiqueta="Nombre de la empresa" valor={nombre} onCambio={setNombre} maxLength={60} placeholder="Hoteles Ibiza SL" autoFocus />
          <CampoTexto etiqueta="NIF/CIF (opcional)" valor={nif} onCambio={setNif} maxLength={12} ayuda="Ayuda a cotejar con el borrador de la renta." />
          <Segmentado<TipoPagador> etiqueta="Tipo" valor={tipo} onCambio={setTipo} opciones={TIPOS_PAGADOR.map((t) => ({ valor: t, texto: t }))} />
          <div className="botones">
            <button type="button" className="btn" onClick={() => setCreando(false)}>Cancelar</button>
            <button type="button" className="btn primario" disabled={!nombre.trim()} onClick={() => void crear()}>Crear</button>
          </div>
        </div>
      )}
    </div>
  );
}
