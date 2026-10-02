import { useState, type SubmitEvent } from 'react';
import { centimosATexto, formatearEuros, parsearEuros, type Centimos } from '../domain/dinero';
import {
  CONCEPTOS_EXTRA,
  nombreMes,
  sumarMeses,
  TIPOS_GASTO,
  type ConceptoExtra,
  type EstadoIngreso,
  type Gasto,
  type Ingreso,
  type IngresoExtra,
  type Periodo,
  type TipoGasto,
} from '../domain/modelo';
import { descuadreNeto, netoCalculado, validarImporte, validarIngreso } from '../domain/validacion';
import {
  borrarExtra,
  borrarGasto,
  borrarIngreso,
  guardarExtra,
  guardarGasto,
  guardarIngreso,
  repetirIngreso,
} from '../db/operaciones';
import { useEstado } from '../estado';
import { Aviso, CampoTexto, Dialogo, Segmentado, Selector } from './base';

function aCentimos(texto: string): { valor: Centimos | null; error?: string } {
  if (texto.trim() === '') return { valor: null };
  const r = parsearEuros(texto);
  return r.ok ? { valor: r.valor } : { valor: null, error: r.error };
}

function errorImporte(texto: string, obligatorio = true): string | undefined {
  const r = aCentimos(texto);
  return r.error ?? validarImporte(r.valor, obligatorio);
}

function BotonesForm({ editando, onBorrar, guardando }: { editando: boolean; onBorrar: () => void; guardando: boolean }) {
  return (
    <div className="botones">
      {editando && (
        <button type="button" className="btn peligro" onClick={onBorrar}>
          Borrar
        </button>
      )}
      <button type="submit" className="btn primario" disabled={guardando}>
        Guardar
      </button>
    </div>
  );
}

function confirmarBorrado(que: string): boolean {
  return window.confirm(`¿Borrar ${que}? No se puede deshacer.`);
}

// --- Ingreso (nómina o pago del SEPE) -----------------------------------------------------

interface PropsIngreso {
  periodo: Periodo;
  ingreso: Ingreso | null;
  onCerrar: () => void;
}

export function FormIngreso({ periodo, ingreso, onCerrar }: PropsIngreso) {
  const { datos } = useEstado();
  const pagadores = datos.pagadores.filter((p) => !p.archivado || p.id === ingreso?.pagadorId);

  const [pagadorId, setPagadorId] = useState(ingreso?.pagadorId ?? '');
  const [estado, setEstado] = useState<EstadoIngreso>(ingreso?.estado ?? 'Real');
  const [bruto, setBruto] = useState(ingreso ? centimosATexto(ingreso.bruto) : '');
  const [ss, setSs] = useState(ingreso ? centimosATexto(ingreso.seguridadSocial) : '');
  const [ret, setRet] = useState(ingreso ? centimosATexto(ingreso.retencionIRPF) : '');
  const [netoManual, setNetoManual] = useState(ingreso?.netoManual ?? false);
  const [neto, setNeto] = useState(ingreso ? centimosATexto(ingreso.neto) : '');
  const [nota, setNota] = useState(ingreso?.nota ?? '');
  const [repetirHasta, setRepetirHasta] = useState(0);
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const b = aCentimos(bruto).valor;
  const s = aCentimos(ss).valor ?? 0;
  const r = aCentimos(ret).valor ?? 0;
  const netoAuto = b !== null ? netoCalculado(b, s, r) : null;
  const netoFinal = netoManual ? aCentimos(neto).valor : netoAuto;

  const form = { anio: periodo.anio, mes: periodo.mes, pagadorId, bruto: b, seguridadSocial: s, retencionIRPF: r, neto: netoFinal };
  const errores = validarIngreso(form);
  const erroresTexto = {
    bruto: errorImporte(bruto) ?? errores.bruto,
    ss: errorImporte(ss, false),
    ret: errorImporte(ret, false) ?? errores.retencionIRPF,
    neto: netoManual ? (errorImporte(neto) ?? errores.neto) : undefined,
  };
  const hayErrores = Boolean(errores.pagadorId ?? errores.periodo ?? erroresTexto.bruto ?? erroresTexto.ss ?? erroresTexto.ret ?? erroresTexto.neto);
  const descuadre = netoManual ? descuadreNeto(form) : null;

  function elegirPagador(id: string) {
    setPagadorId(id);
    if (ingreso || bruto !== '') return;
    // Rellena con el último pago de ese pagador: lo habitual es que se repita.
    const ultimo = datos.ingresos
      .filter((i) => i.pagadorId === id)
      .sort((x, y) => y.anio * 12 + y.mes - (x.anio * 12 + x.mes))[0];
    if (ultimo) {
      setBruto(centimosATexto(ultimo.bruto));
      setSs(centimosATexto(ultimo.seguridadSocial));
      setRet(centimosATexto(ultimo.retencionIRPF));
    }
  }

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setIntentado(true);
    if (hayErrores || b === null || netoFinal === null) return;
    setGuardando(true);
    const fila = {
      anio: periodo.anio,
      mes: periodo.mes,
      pagadorId,
      bruto: b,
      seguridadSocial: s,
      retencionIRPF: r,
      neto: netoFinal,
      netoManual,
      estado,
      nota: nota.trim(),
    };
    // Al editar se conservan los datos del importador (fecha, cuenta, huella). Si se han escrito
    // retención o Seguridad Social, la nómina importada deja de estar pendiente de completar.
    const completada = ingreso?.pendienteNomina && (s > 0 || r > 0 || b !== ingreso.bruto);
    await guardarIngreso(
      ingreso
        ? { ...ingreso, ...fila, id: ingreso.id, ...(ingreso.pendienteNomina ? { pendienteNomina: !completada } : {}) }
        : fila,
    );
    if (!ingreso && repetirHasta > 0) await repetirIngreso(fila, sumarMeses(periodo, repetirHasta));
    onCerrar();
  }

  async function borrar() {
    if (ingreso && confirmarBorrado('este ingreso')) {
      await borrarIngreso(ingreso.id);
      onCerrar();
    }
  }

  const mostrar = (msg: string | undefined) => (intentado ? msg : undefined);

  return (
    <Dialogo abierto titulo={ingreso ? 'Editar ingreso' : `Nómina / pago SEPE · ${nombreMes(periodo.mes)}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} noValidate>
        <Selector etiqueta="Pagador" valor={pagadorId} onCambio={elegirPagador} error={mostrar(errores.pagadorId)}>
          <option value="">Elige pagador…</option>
          {pagadores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} ({p.tipo})
            </option>
          ))}
        </Selector>
        {pagadores.length === 0 && <Aviso>No hay pagadores. Créalos en Ajustes.</Aviso>}
        <Segmentado<EstadoIngreso>
          etiqueta="Estado"
          valor={estado}
          onCambio={setEstado}
          opciones={[
            { valor: 'Real', texto: 'Cobrado' },
            { valor: 'Previsto', texto: 'Previsto' },
          ]}
        />
        <CampoTexto etiqueta="Bruto (€)" tipo="importe" valor={bruto} onCambio={setBruto} error={mostrar(erroresTexto.bruto)} />
        <div className="rejilla-2">
          <CampoTexto etiqueta="Seg. Social (€)" tipo="importe" valor={ss} onCambio={setSs} error={mostrar(erroresTexto.ss)} />
          <CampoTexto etiqueta="Retención IRPF (€)" tipo="importe" valor={ret} onCambio={setRet} error={mostrar(erroresTexto.ret)} />
        </div>
        <div className="campo">
          <label className="check">
            <input type="checkbox" checked={netoManual} onChange={(e) => {
              setNetoManual(e.target.checked);
              if (e.target.checked && neto === '' && netoAuto !== null) setNeto(centimosATexto(netoAuto));
            }} />
            La nómina dice otro neto
          </label>
          {!netoManual && (
            <span className="ayuda">
              Neto calculado: <strong>{netoAuto !== null ? formatearEuros(netoAuto) : '—'}</strong> (bruto − SS − retención)
            </span>
          )}
        </div>
        {netoManual && <CampoTexto etiqueta="Neto según la nómina (€)" tipo="importe" valor={neto} onCambio={setNeto} error={mostrar(erroresTexto.neto)} />}
        {descuadre !== null && netoAuto !== null && (
          <Aviso titulo="El neto no cuadra">
            Bruto − SS − retención da {formatearEuros(netoAuto)} y has escrito {formatearEuros(netoAuto + descuadre)} (diferencia {formatearEuros(descuadre)}).
            Puede deberse a embargos, anticipos o especie. Revísalo con la nómina.
          </Aviso>
        )}
        <CampoTexto etiqueta="Nota" valor={nota} onCambio={setNota} placeholder="Opcional" />
        {!ingreso && (
          <Selector etiqueta="Repetir como previsto" valor={String(repetirHasta)} onCambio={(v) => setRepetirHasta(Number(v))}>
            <option value="0">No repetir</option>
            {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => {
              const p = sumarMeses(periodo, n);
              return (
                <option key={n} value={n}>
                  Hasta {nombreMes(p.mes)} {p.anio} ({n} {n === 1 ? 'mes' : 'meses'})
                </option>
              );
            })}
          </Selector>
        )}
        <BotonesForm editando={Boolean(ingreso)} onBorrar={() => void borrar()} guardando={guardando} />
      </form>
    </Dialogo>
  );
}

// --- Gasto ---------------------------------------------------------------------------------

interface PropsGasto {
  periodo: Periodo;
  gasto: Gasto | null;
  tipoInicial: TipoGasto;
  onCerrar: () => void;
}

export function FormGasto({ periodo, gasto, tipoInicial, onCerrar }: PropsGasto) {
  const { datos } = useEstado();
  const categorias = datos.categorias.filter((c) => !c.archivada || c.id === gasto?.categoriaId);
  const [categoriaId, setCategoriaId] = useState(gasto?.categoriaId ?? '');
  const [importe, setImporte] = useState(gasto ? centimosATexto(gasto.importe) : '');
  const [tipo, setTipo] = useState<TipoGasto>(gasto?.tipo ?? tipoInicial);
  const [nota, setNota] = useState(gasto?.nota ?? '');
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const errImporte = errorImporte(importe);
  const errCategoria = categoriaId ? undefined : 'Elige una categoría';

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setIntentado(true);
    const valor = aCentimos(importe).valor;
    if (errImporte || errCategoria || valor === null) return;
    setGuardando(true);
    const fila = { anio: periodo.anio, mes: periodo.mes, categoriaId, importe: valor, tipo, nota: nota.trim() };
    // Al editar se conservan origen, huella, fecha, cuenta, comercio y si es devolución.
    await guardarGasto(gasto ? { ...gasto, ...fila, id: gasto.id } : fila);
    onCerrar();
  }

  async function borrar() {
    if (gasto && confirmarBorrado('este gasto')) {
      await borrarGasto(gasto.id);
      onCerrar();
    }
  }

  return (
    <Dialogo abierto titulo={gasto ? 'Editar gasto' : `Nuevo gasto · ${nombreMes(periodo.mes)}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} noValidate>
        <Segmentado<TipoGasto> etiqueta="Tipo" valor={tipo} onCambio={setTipo} opciones={TIPOS_GASTO.map((t) => ({ valor: t, texto: t }))} />
        <Selector etiqueta="Categoría" valor={categoriaId} onCambio={setCategoriaId} error={intentado ? errCategoria : undefined}>
          <option value="">Elige categoría…</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Selector>
        <CampoTexto etiqueta="Importe (€)" tipo="importe" valor={importe} onCambio={setImporte} error={intentado ? errImporte : undefined} autoFocus={!gasto} />
        <CampoTexto etiqueta="Nota" valor={nota} onCambio={setNota} placeholder="Opcional" />
        <BotonesForm editando={Boolean(gasto)} onBorrar={() => void borrar()} guardando={guardando} />
      </form>
    </Dialogo>
  );
}

// --- Propinas y otros ingresos ---------------------------------------------------------------

interface PropsExtra {
  periodo: Periodo;
  extra: IngresoExtra | null;
  onCerrar: () => void;
}

export function FormExtra({ periodo, extra, onCerrar }: PropsExtra) {
  const [concepto, setConcepto] = useState<ConceptoExtra>(extra?.concepto ?? 'Propinas');
  const [importe, setImporte] = useState(extra ? centimosATexto(extra.importe) : '');
  const [nota, setNota] = useState(extra?.nota ?? '');
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const errImporte = errorImporte(importe);

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setIntentado(true);
    const valor = aCentimos(importe).valor;
    if (errImporte || valor === null) return;
    setGuardando(true);
    const fila = { anio: periodo.anio, mes: periodo.mes, concepto, importe: valor, nota: nota.trim() };
    await guardarExtra(extra ? { ...extra, ...fila, id: extra.id } : fila);
    onCerrar();
  }

  async function borrar() {
    if (extra && confirmarBorrado('este ingreso')) {
      await borrarExtra(extra.id);
      onCerrar();
    }
  }

  return (
    <Dialogo abierto titulo={extra ? 'Editar ingreso extra' : `Propinas u otros · ${nombreMes(periodo.mes)}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} noValidate>
        <Segmentado<ConceptoExtra> etiqueta="Concepto" valor={concepto} onCambio={setConcepto} opciones={CONCEPTOS_EXTRA.map((c) => ({ valor: c, texto: c }))} />
        <CampoTexto etiqueta="Importe (€)" tipo="importe" valor={importe} onCambio={setImporte} error={intentado ? errImporte : undefined} autoFocus={!extra} />
        <CampoTexto etiqueta="Nota" valor={nota} onCambio={setNota} placeholder="Opcional" />
        {concepto === 'Propinas' && (
          <Aviso tipo="info">
            Las propinas son rendimiento del trabajo y deberían declararse. Por defecto no entran en la estimación de la renta; puedes incluirlas en Ajustes.
          </Aviso>
        )}
        <BotonesForm editando={Boolean(extra)} onBorrar={() => void borrar()} guardando={guardando} />
      </form>
    </Dialogo>
  );
}
