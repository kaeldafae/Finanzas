import { nombreMes, NOMBRES_MES } from '../../domain/modelo';
import { guardarAjustes } from '../../db/operaciones';
import { useEstado } from '../../estado';
import { Interruptor, Selector } from '../../ui/base';
import { CampoAuto } from '../../ui/CampoAuto';

export function Personales() {
  const { ajustes, hoy } = useEstado();
  const anios = Array.from({ length: 12 }, (_, i) => hoy.anio - 8 + i);
  if (!anios.includes(ajustes.inicioAnio)) anios.unshift(ajustes.inicioAnio);

  return (
    <>
      <section className="card" aria-labelledby="t-ahorro">
        <h2 id="t-ahorro">Ahorro y colchón</h2>
        <CampoAuto
          etiqueta="Ahorro inicial"
          tipo="importe"
          valor={Math.max(0, ajustes.ahorroInicial)}
          onGuardar={(v) => guardarAjustes({ ahorroInicial: v })}
          ayuda="Lo que tenías ahorrado al empezar a usar la app. Cuenta como colchón."
        />
        <div className="rejilla-2">
          <Selector etiqueta="Desde el mes" valor={String(ajustes.inicioMes)} onCambio={(v) => void guardarAjustes({ inicioMes: Number(v) })}>
            {NOMBRES_MES.map((n, i) => (
              <option key={n} value={i + 1}>{n}</option>
            ))}
          </Selector>
          <Selector etiqueta="Del año" valor={String(ajustes.inicioAnio)} onCambio={(v) => void guardarAjustes({ inicioAnio: Number(v) })}>
            {anios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Selector>
        </div>
        <CampoAuto
          etiqueta="Meses de colchón"
          tipo="entero"
          valor={ajustes.mesesColchon}
          min={1}
          max={36}
          onGuardar={(v) => guardarAjustes({ mesesColchon: v })}
          ayuda={`Objetivo = gasto medio mensual × meses. Se cuenta desde ${nombreMes(ajustes.inicioMes)} ${ajustes.inicioAnio}.`}
        />
      </section>

      <section className="card" aria-labelledby="t-pers">
        <h2 id="t-pers">Datos para la renta</h2>
        <CampoAuto
          etiqueta="Año de nacimiento"
          tipo="entero"
          valor={ajustes.anioNacimiento ?? 0}
          min={0}
          max={hoy.anio}
          onGuardar={(v) => guardarAjustes({ anioNacimiento: v === 0 ? null : v })}
          ayuda="La edad se calcula a 31 de diciembre de cada ejercicio, que es la que cuenta para la deducción. Escribe 0 para dejarlo vacío."
        />
        <Interruptor
          etiqueta="Alquiler de vivienda habitual a mi nombre"
          valor={ajustes.alquilerANombre}
          onCambio={(v) => void guardarAjustes({ alquilerANombre: v })}
        />
        {ajustes.alquilerANombre && (
          <>
            <Interruptor
              etiqueta="Escribir el alquiler anual a mano"
              valor={ajustes.alquilerAnualManual !== null}
              onCambio={(v) => void guardarAjustes({ alquilerAnualManual: v ? 0 : null })}
              ayuda="Si no, se suman los gastos de la categoría Alquiler del año."
            />
            {ajustes.alquilerAnualManual !== null && (
              <CampoAuto
                etiqueta="Alquiler pagado en el año"
                tipo="importe"
                valor={ajustes.alquilerAnualManual}
                onGuardar={(v) => guardarAjustes({ alquilerAnualManual: v })}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
