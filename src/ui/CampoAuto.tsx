import { useState } from 'react';
import {
  centimosATexto,
  coeficienteATexto,
  parsearCoeficiente,
  parsearDecimal,
  parsearEuros,
  parsearPorcentaje,
  tasaATexto,
  MAX_CENTIMOS,
  type ResultadoParseo,
} from '../domain/dinero';
import { CampoTexto } from './base';

export type TipoCampoAuto = 'importe' | 'porcentaje' | 'coeficiente' | 'entero';

const parsear: Record<TipoCampoAuto, (t: string) => ResultadoParseo> = {
  importe: parsearEuros,
  porcentaje: parsearPorcentaje,
  coeficiente: parsearCoeficiente,
  entero: (t) => parsearDecimal(t, 0, MAX_CENTIMOS),
};

const formatear: Record<TipoCampoAuto, (v: number) => string> = {
  importe: centimosATexto,
  porcentaje: tasaATexto,
  coeficiente: coeficienteATexto,
  entero: String,
};

interface Props {
  etiqueta: string;
  valor: number;
  tipo: TipoCampoAuto;
  onGuardar: (v: number) => void | Promise<void>;
  ayuda?: string;
  min?: number;
  max?: number;
}

function CampoAutoInterno({ etiqueta, valor, tipo, onGuardar, ayuda, min, max }: Props) {
  const [texto, setTexto] = useState(formatear[tipo](valor));
  const [error, setError] = useState<string | undefined>();

  function confirmar() {
    const r = parsear[tipo](texto);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (min !== undefined && r.valor < min) return setError(`Mínimo ${formatear[tipo](min)}`);
    if (max !== undefined && r.valor > max) return setError(`Máximo ${formatear[tipo](max)}`);
    setError(undefined);
    if (r.valor !== valor) void onGuardar(r.valor);
  }

  const sufijo = tipo === 'importe' ? ' (€)' : tipo === 'porcentaje' ? ' (%)' : '';
  return (
    <div onBlur={confirmar}>
      <CampoTexto
        etiqueta={`${etiqueta}${sufijo}`}
        tipo={tipo === 'entero' ? 'entero' : tipo === 'importe' ? 'importe' : 'porcentaje'}
        valor={texto}
        onCambio={(v) => {
          setTexto(v);
          setError(undefined);
        }}
        error={error}
        ayuda={ayuda}
      />
    </div>
  );
}

/** Campo numérico que se guarda al salir del input. Se reinicia si el valor guardado cambia desde fuera. */
export function CampoAuto(props: Props) {
  return <CampoAutoInterno key={`${props.tipo}-${props.valor}`} {...props} />;
}
