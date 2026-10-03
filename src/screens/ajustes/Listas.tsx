import { useState, type SubmitEvent } from 'react';
import { TIPOS_PAGADOR, type Categoria, type Pagador, type TipoPagador } from '../../domain/modelo';
import { eliminarCategoria, eliminarPagador, guardarCategoria, guardarPagador, moverCategoria } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { Aviso, CampoTexto, Dialogo, Segmentado } from '../../ui/base';

function FormPagador({ pagador, onCerrar }: { pagador: Pagador | null; onCerrar: () => void }) {
  const [nombre, setNombre] = useState(pagador?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoPagador>(pagador?.tipo ?? 'Empresa');
  const [nif, setNif] = useState(pagador?.nif ?? '');
  const [error, setError] = useState<string | undefined>();
  const [aviso, setAviso] = useState<string | null>(null);

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('Escribe un nombre');
      return;
    }
    const nifLimpio = nif.trim().toUpperCase();
    await guardarPagador({
      ...(pagador ? { id: pagador.id } : {}),
      nombre: nombre.trim(),
      tipo,
      archivado: false,
      ...(nifLimpio ? { nif: nifLimpio } : {}),
    });
    onCerrar();
  }

  async function eliminar() {
    if (!pagador || !window.confirm(`¿Eliminar ${pagador.nombre}?`)) return;
    const r = await eliminarPagador(pagador.id);
    if (r === 'archivado') {
      setAviso('Tiene ingresos registrados, así que se ha archivado: no aparecerá al añadir nóminas, pero el histórico se conserva.');
    } else onCerrar();
  }

  return (
    <Dialogo abierto titulo={pagador ? 'Editar empresa o pagador' : 'Nueva empresa o pagador'} onCerrar={onCerrar}>
      <form onSubmit={(e) => void guardar(e)} noValidate>
        <CampoTexto etiqueta="Nombre" valor={nombre} onCambio={(v) => { setNombre(v); setError(undefined); }} error={error} autoFocus maxLength={80} />
        <Segmentado<TipoPagador> etiqueta="Tipo" valor={tipo} onCambio={setTipo} opciones={TIPOS_PAGADOR.map((t) => ({ valor: t, texto: t }))} />
        <CampoTexto etiqueta="NIF (opcional)" valor={nif} onCambio={setNif} maxLength={12} ayuda="Ayuda a cotejarlo con los datos fiscales de la AEAT." />
        {pagador?.archivado && <p className="peq muted">Archivado: al guardar se reactiva.</p>}
        {aviso && <Aviso tipo="info">{aviso}</Aviso>}
        <div className="botones">
          {pagador && !aviso && (
            <button type="button" className="btn peligro" onClick={() => void eliminar()}>Eliminar</button>
          )}
          <button type="submit" className="btn primario">Guardar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function FormCategoria({ categoria, onCerrar }: { categoria: Categoria | null; onCerrar: () => void }) {
  const [nombre, setNombre] = useState(categoria?.nombre ?? '');
  const [error, setError] = useState<string | undefined>();
  const [aviso, setAviso] = useState<string | null>(null);

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('Escribe un nombre');
      return;
    }
    await guardarCategoria({
      ...(categoria ? { id: categoria.id, orden: categoria.orden } : {}),
      nombre: nombre.trim(),
      archivada: false,
      ...(categoria?.clave ? { clave: categoria.clave } : {}),
    });
    onCerrar();
  }

  async function eliminar() {
    if (!categoria || !window.confirm(`¿Eliminar ${categoria.nombre}?`)) return;
    const r = await eliminarCategoria(categoria.id);
    if (r === 'archivado') {
      setAviso('Está en uso o la usa el cálculo de la renta, así que se ha archivado y el histórico se conserva.');
    } else onCerrar();
  }

  return (
    <Dialogo abierto titulo={categoria ? 'Editar categoría' : 'Nueva categoría'} onCerrar={onCerrar}>
      <form onSubmit={(e) => void guardar(e)} noValidate>
        <CampoTexto etiqueta="Nombre" valor={nombre} onCambio={(v) => { setNombre(v); setError(undefined); }} error={error} autoFocus maxLength={40} />
        {categoria?.clave === 'alquiler' && <p className="peq muted">Esta categoría se usa para la deducción por alquiler.</p>}
        {categoria?.archivada && <p className="peq muted">Archivada: al guardar se reactiva.</p>}
        {aviso && <Aviso tipo="info">{aviso}</Aviso>}
        <div className="botones">
          {categoria && !aviso && (
            <button type="button" className="btn peligro" onClick={() => void eliminar()}>Eliminar</button>
          )}
          <button type="submit" className="btn primario">Guardar</button>
        </div>
      </form>
    </Dialogo>
  );
}

export function Listas() {
  const { datos } = useEstado();
  const [pagador, setPagador] = useState<Pagador | 'nuevo' | null>(null);
  const [categoria, setCategoria] = useState<Categoria | 'nueva' | null>(null);

  return (
    <>
      <section className="card" aria-labelledby="t-pagadores">
        <h2 id="t-pagadores">Empresas y pagadores</h2>
        <p className="peq muted">Si has trabajado en varias empresas, añade una por empresa. Al apuntar o importar un ingreso eliges de cuál viene, y la Renta las cuenta por separado.</p>
        <ul className="lista">
          {datos.pagadores.map((p) => (
            <li key={p.id} className="fila">
              <button type="button" className="fila-boton" onClick={() => setPagador(p)}>
                <span className="principal">
                  {p.nombre} {p.archivado && <span className="etiqueta">Archivado</span>}
                </span>
                <span className="muted peq">{p.tipo}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="botones">
          <button type="button" className="btn" onClick={() => setPagador('nuevo')}>+ Empresa o pagador</button>
        </div>
      </section>

      <section className="card" aria-labelledby="t-categorias">
        <h2 id="t-categorias">Categorías de gasto</h2>
        <ul className="lista">
          {datos.categorias.map((c, i) => (
            <li key={c.id} className="fila">
              <button type="button" className="fila-boton" onClick={() => setCategoria(c)}>
                <span className="principal">
                  {c.nombre} {c.archivada && <span className="etiqueta">Archivada</span>}
                </span>
              </button>
              <button type="button" className="btn icono fantasma" disabled={i === 0} onClick={() => void moverCategoria(c.id, -1)} aria-label={`Subir ${c.nombre}`}>↑</button>
              <button type="button" className="btn icono fantasma" disabled={i === datos.categorias.length - 1} onClick={() => void moverCategoria(c.id, 1)} aria-label={`Bajar ${c.nombre}`}>↓</button>
            </li>
          ))}
        </ul>
        <div className="botones">
          <button type="button" className="btn" onClick={() => setCategoria('nueva')}>+ Categoría</button>
        </div>
      </section>

      {pagador && <FormPagador pagador={pagador === 'nuevo' ? null : pagador} onCerrar={() => setPagador(null)} />}
      {categoria && <FormCategoria categoria={categoria === 'nueva' ? null : categoria} onCerrar={() => setCategoria(null)} />}
    </>
  );
}
