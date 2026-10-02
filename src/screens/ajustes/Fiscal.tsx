import { useId } from 'react';
import { euros } from '../../domain/dinero';
import type { ParametrosFiscales, Tramo } from '../../domain/modelo';
import { parametrosFiscalesPorDefecto } from '../../domain/parametros';
import { guardarAjustes } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { formatearFecha } from '../../lib/fecha';
import { CampoTexto, Interruptor } from '../../ui/base';
import { CampoAuto } from '../../ui/CampoAuto';

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function EditorEscala({ titulo, tramos, onGuardar }: { titulo: string; tramos: Tramo[]; onGuardar: (t: Tramo[]) => Promise<void> }) {
  const ordenados = [...tramos].sort((a, b) => a.desde - b.desde);
  const cambiar = (i: number, t: Tramo) => onGuardar(ordenados.map((x, j) => (j === i ? t : x)).sort((a, b) => a.desde - b.desde));
  const ultimo = ordenados[ordenados.length - 1];
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
      <legend style={{ fontWeight: 700, marginBottom: 6 }}>{titulo}</legend>
      {ordenados.map((t, i) => (
        <div key={`${i}-${t.desde}-${t.tipo}`} className="rejilla-2" style={{ alignItems: 'end' }}>
          <CampoAuto etiqueta={`Tramo ${i + 1} desde`} tipo="importe" valor={t.desde} onGuardar={(v) => cambiar(i, { ...t, desde: v })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', gap: 6, alignItems: 'end' }}>
            <CampoAuto etiqueta="Tipo" tipo="porcentaje" valor={t.tipo} onGuardar={(v) => cambiar(i, { ...t, tipo: v })} />
            <div className="campo">
              <button
                type="button"
                className="btn icono"
                disabled={ordenados.length <= 1}
                onClick={() => void onGuardar(ordenados.filter((_, j) => j !== i))}
                aria-label={`Quitar tramo ${i + 1}`}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => void onGuardar([...ordenados, { desde: (ultimo?.desde ?? 0) + euros(10000), tipo: ultimo?.tipo ?? 0 }])}
      >
        + Tramo
      </button>
    </fieldset>
  );
}

export function Fiscal() {
  const { ajustes } = useEstado();
  const f = ajustes.fiscal;
  const idFecha = useId();
  const guardar = (cambios: Partial<ParametrosFiscales>) => guardarAjustes({ fiscal: { ...f, ...cambios } });

  return (
    <section className="card" aria-labelledby="t-fiscal">
      <h2 id="t-fiscal">Parámetros fiscales</h2>
      <p className="peq muted">
        Ejercicio {f.ejercicio} · revisados el {formatearFecha(f.revisadoEl)}. Compruébalos en cada campaña con la normativa estatal (LIRPF) y la de tu comunidad autónoma.
      </p>

      <div className="rejilla-2">
        <CampoAuto etiqueta="Ejercicio" tipo="entero" valor={f.ejercicio} min={2000} max={2100} onGuardar={(v) => guardar({ ejercicio: v })} />
        <div className="campo">
          <label htmlFor={idFecha}>Fecha de revisión</label>
          <input id={idFecha} type="date" value={f.revisadoEl} onChange={(e) => e.target.value && void guardar({ revisadoEl: e.target.value })} />
        </div>
      </div>
      <button type="button" className="btn bloque" onClick={() => void guardar({ revisadoEl: hoyIso() })}>Marcar como revisados hoy</button>

      <h3 style={{ marginTop: 16 }}>Rendimientos del trabajo</h3>
      <CampoAuto etiqueta="Otros gastos deducibles (art. 19.2.f)" tipo="importe" valor={f.otrosGastos} onGuardar={(v) => guardar({ otrosGastos: v })} />
      <CampoAuto etiqueta="Mínimo personal" tipo="importe" valor={f.minimoPersonal} onGuardar={(v) => guardar({ minimoPersonal: v })} />

      <h3>Reducción art. 20</h3>
      <div className="rejilla-2">
        <CampoAuto etiqueta="Hasta RN" tipo="importe" valor={f.reduccion.limite1} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, limite1: v } })} />
        <CampoAuto etiqueta="Reducción máxima" tipo="importe" valor={f.reduccion.importeMaximo} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, importeMaximo: v } })} />
        <CampoAuto etiqueta="Hasta RN (tramo 2)" tipo="importe" valor={f.reduccion.limite2} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, limite2: v } })} />
        <CampoAuto etiqueta="Coeficiente tramo 2" tipo="coeficiente" valor={f.reduccion.coeficiente1} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, coeficiente1: v } })} />
        <CampoAuto etiqueta="Importe base tramo 3" tipo="importe" valor={f.reduccion.importeTramo2} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, importeTramo2: v } })} />
        <CampoAuto etiqueta="Coeficiente tramo 3" tipo="coeficiente" valor={f.reduccion.coeficiente2} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, coeficiente2: v } })} />
        <CampoAuto etiqueta="Sin reducción desde RN" tipo="importe" valor={f.reduccion.limite3} onGuardar={(v) => guardar({ reduccion: { ...f.reduccion, limite3: v } })} />
      </div>

      <h3>Escalas</h3>
      <EditorEscala titulo="Escala estatal" tramos={f.escalaEstatal} onGuardar={(t) => guardar({ escalaEstatal: t })} />
      <CampoTexto etiqueta="Comunidad autónoma" valor={f.nombreAutonomia} onCambio={(v) => void guardar({ nombreAutonomia: v.slice(0, 40) })} />
      <EditorEscala titulo={`Escala autonómica (${f.nombreAutonomia})`} tramos={f.escalaAutonomica} onGuardar={(t) => guardar({ escalaAutonomica: t })} />

      <h3>Deducción autonómica por alquiler</h3>
      <CampoAuto etiqueta="Base liquidable máxima" tipo="importe" valor={f.alquiler.baseMaxima} onGuardar={(v) => guardar({ alquiler: { ...f.alquiler, baseMaxima: v } })} />
      {f.alquiler.tramos.map((t, i) => {
        const cambiar = (c: Partial<typeof t>) => guardar({ alquiler: { ...f.alquiler, tramos: f.alquiler.tramos.map((x, j) => (j === i ? { ...x, ...c } : x)) } });
        return (
          <div key={i} className="rejilla-2">
            <CampoAuto etiqueta="Edad menor que" tipo="entero" valor={t.edadMenorQue} min={0} max={130} onGuardar={(v) => cambiar({ edadMenorQue: v })} />
            <CampoAuto etiqueta="Porcentaje" tipo="porcentaje" valor={t.porcentaje} onGuardar={(v) => cambiar({ porcentaje: v })} />
            <CampoAuto etiqueta="Máximo" tipo="importe" valor={t.maximo} onGuardar={(v) => cambiar({ maximo: v })} />
          </div>
        );
      })}

      <h3>Deducción por rendimientos del trabajo bajos</h3>
      <Interruptor
        etiqueta="Aplicar esta deducción"
        valor={f.sueldosBajos.activa}
        onCambio={(v) => void guardar({ sueldosBajos: { ...f.sueldosBajos, activa: v } })}
        ayuda="Desactivada por defecto. Actívala solo si está vigente para el ejercicio."
      />
      {f.sueldosBajos.activa && (
        <div className="rejilla-2">
          <CampoAuto etiqueta="Íntegro hasta" tipo="importe" valor={f.sueldosBajos.limite1} onGuardar={(v) => guardar({ sueldosBajos: { ...f.sueldosBajos, limite1: v } })} />
          <CampoAuto etiqueta="Importe" tipo="importe" valor={f.sueldosBajos.importe} onGuardar={(v) => guardar({ sueldosBajos: { ...f.sueldosBajos, importe: v } })} />
          <CampoAuto etiqueta="Íntegro menor que" tipo="importe" valor={f.sueldosBajos.limite2} onGuardar={(v) => guardar({ sueldosBajos: { ...f.sueldosBajos, limite2: v } })} />
          <CampoAuto etiqueta="Coeficiente" tipo="coeficiente" valor={f.sueldosBajos.coeficiente} onGuardar={(v) => guardar({ sueldosBajos: { ...f.sueldosBajos, coeficiente: v } })} />
        </div>
      )}

      <h3>Obligación de declarar</h3>
      <div className="rejilla-2">
        <CampoAuto etiqueta="Límite general" tipo="importe" valor={f.obligacion.limiteGeneral} onGuardar={(v) => guardar({ obligacion: { ...f.obligacion, limiteGeneral: v } })} />
        <CampoAuto etiqueta="Límite con varios pagadores" tipo="importe" valor={f.obligacion.limiteVariosPagadores} onGuardar={(v) => guardar({ obligacion: { ...f.obligacion, limiteVariosPagadores: v } })} />
        <CampoAuto etiqueta="Umbral 2.º pagador" tipo="importe" valor={f.obligacion.umbralSegundoPagador} onGuardar={(v) => guardar({ obligacion: { ...f.obligacion, umbralSegundoPagador: v } })} />
      </div>

      <h3>Propinas</h3>
      <Interruptor
        etiqueta="Incluir las propinas en la estimación"
        valor={f.incluirPropinas}
        onCambio={(v) => void guardar({ incluirPropinas: v })}
        ayuda="Las propinas son rendimiento del trabajo. Incluirlas da una estimación más fiel y puede cambiar si estás obligado a declarar."
      />

      <button
        type="button"
        className="btn peligro bloque"
        style={{ marginTop: 12 }}
        onClick={() => {
          if (window.confirm('¿Restaurar todos los parámetros fiscales por defecto?')) void guardarAjustes({ fiscal: parametrosFiscalesPorDefecto() });
        }}
      >
        Restaurar valores por defecto
      </button>
    </section>
  );
}
