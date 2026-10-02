import { useEffect, useId, useRef, type ReactNode } from 'react';
import { formatearCifra, formatearEuros, type Centimos } from '../domain/dinero';

export function Importe({ c, signo = false, className = '', cifra = false }: { c: Centimos; signo?: boolean; className?: string; cifra?: boolean }) {
  const color = signo ? (c > 0 ? 'pos' : c < 0 ? 'neg' : '') : '';
  const base = cifra ? formatearCifra(c) : formatearEuros(c);
  const texto = signo && c > 0 ? `+${base}` : base;
  return <span className={`importe ${color} ${className}`.trim()}>{texto}</span>;
}

export function Aviso({ titulo, children, tipo = 'aviso' }: { titulo?: string; children?: ReactNode; tipo?: 'aviso' | 'info' }) {
  return (
    <div className={tipo === 'info' ? 'aviso info' : 'aviso'} role={tipo === 'aviso' ? 'alert' : 'status'}>
      {titulo && <strong>{titulo}</strong>}
      {children}
    </div>
  );
}

export function Barra({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  const pct = Math.max(0, Math.min(100, valor / 100));
  return (
    <div className="progreso" role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

interface PropsDialogo {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
}

/** Hoja modal con <dialog> nativo: foco atrapado, Escape y lectura accesible sin librerías. */
export function Dialogo({ abierto, titulo, onCerrar, children }: PropsDialogo) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      className="hoja"
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
    >
      {abierto && (
        <>
          <div className="hoja-cab">
            <h2 id={idTitulo}>{titulo}</h2>
            <button type="button" className="btn icono fantasma" onClick={onCerrar} aria-label="Cerrar">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="hoja-cuerpo">{children}</div>
        </>
      )}
    </dialog>
  );
}

interface PropsCampoTexto {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  error?: string | undefined;
  ayuda?: ReactNode;
  tipo?: 'importe' | 'porcentaje' | 'entero' | 'texto';
  placeholder?: string;
  autoFocus?: boolean;
  maxLength?: number;
}

export function CampoTexto({ etiqueta, valor, onCambio, error, ayuda, tipo = 'texto', placeholder, autoFocus, maxLength }: PropsCampoTexto) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const numerico = tipo !== 'texto';
  const describedBy = [ayuda ? idAyuda : '', error ? idError : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type="text"
        inputMode={tipo === 'entero' ? 'numeric' : numerico ? 'decimal' : 'text'}
        autoComplete="off"
        enterKeyHint="next"
        value={valor}
        placeholder={placeholder ?? (tipo === 'importe' ? '0,00' : undefined)}
        onChange={(e) => onCambio(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        maxLength={maxLength ?? (numerico ? 16 : 200)}
      />
      {ayuda && <span id={idAyuda} className="ayuda">{ayuda}</span>}
      {error && <span id={idError} className="error">{error}</span>}
    </div>
  );
}

interface Opcion<T extends string> {
  valor: T;
  texto: string;
}

export function Segmentado<T extends string>({ etiqueta, opciones, valor, onCambio }: { etiqueta: string; opciones: readonly Opcion<T>[]; valor: T; onCambio: (v: T) => void }) {
  const nombre = useId();
  return (
    <fieldset className="campo" style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
      <legend className="label" style={{ fontWeight: 600, fontSize: '.92rem', marginBottom: 4 }}>{etiqueta}</legend>
      <div className="segmentado">
        {opciones.map((o) => (
          <label key={o.valor}>
            <input type="radio" name={nombre} value={o.valor} checked={valor === o.valor} onChange={() => onCambio(o.valor)} />
            <span>{o.texto}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Selector({ etiqueta, valor, onCambio, children, error }: { etiqueta: string; valor: string; onCambio: (v: string) => void; children: ReactNode; error?: string | undefined }) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : undefined}>
        {children}
      </select>
      {error && <span id={`${id}-e`} className="error">{error}</span>}
    </div>
  );
}

export function Interruptor({ etiqueta, valor, onCambio, ayuda }: { etiqueta: string; valor: boolean; onCambio: (v: boolean) => void; ayuda?: ReactNode }) {
  const id = useId();
  return (
    <div className="campo">
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={valor} onChange={(e) => onCambio(e.target.checked)} />
        {etiqueta}
      </label>
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </div>
  );
}
