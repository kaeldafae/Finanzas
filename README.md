# Finanzas mes a mes

App web instalable (PWA) para llevar las finanzas personales **mes a mes** con ingresos irregulares: meses con nómina, meses con prestación del SEPE (paro o ERTE) y meses mezclados. Pensada para un trabajador fijo-discontinuo de hostelería en Illes Balears.

- **Mes**: nóminas y pagos del SEPE por pagador, propinas, gastos fijos/variables/extra, resultado y reparto del sobrante.
- **Año**: tabla y gráfico de los 12 meses, meses previstos diferenciados, saldo acumulado desde el ahorro inicial.
- **Colchón**: objetivo (gasto medio × meses), progreso, lo que falta y fecha estimada.
- **Renta**: estimación del IRPF (solo rendimientos del trabajo) con desglose, obligación de declarar y qué hacer.
- **Ajustes**: pagadores, categorías, parámetros fiscales, copias de seguridad y exportación a Excel.

**Privacidad:** no hay servidor, ni cuentas, ni analítica, ni scripts de terceros. Los datos se guardan solo en el dispositivo (IndexedDB). La app publica una Content Security Policy con `connect-src 'self'`: el navegador bloquea cualquier envío de datos a otro dominio.

---

## Instalar en el iPhone

1. Abre la dirección de la app en **Safari** (en iOS tiene que ser Safari).
2. Pulsa el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elige **Añadir a pantalla de inicio** y confirma.
4. Abre la app desde el icono nuevo. A partir de aquí funciona sin conexión.

> **Importante en iPhone:** Safari puede borrar los datos de las webs **no instaladas** si pasas 7 días sin abrirlas. Instalada en la pantalla de inicio no ocurre, pero aun así haz copias de seguridad. En *Ajustes → Dispositivo* verás si el almacenamiento es persistente.

## Instalar en Android

Abre la dirección en Chrome y pulsa **Instalar app** (o menú ⋮ → *Añadir a pantalla de inicio*).

---

## Copia de seguridad

Los datos viven solo en tu móvil: si borras la app o cambias de teléfono sin copia, se pierden.

- **Exportar:** *Ajustes → Copia de seguridad → Exportar copia (JSON)*. Guarda el archivo fuera del móvil (iCloud Drive, Google Drive, correo a ti mismo u ordenador).
- **Importar:** *Ajustes → Importar copia…* La app valida el archivo entero **antes** de tocar nada. Si está dañado o no es de esta app, te dice por qué y tus datos siguen intactos. Si es válido, te enseña lo que contiene y pide confirmación antes de sustituir. La sustitución es atómica: o se completa entera o no cambia nada.
- **Recordatorio:** si pasan más de 30 días desde la última copia, la app avisa arriba.
- **Excel:** *Ajustes → Exportar a Excel* genera un `.xlsx` del año (resumen, ingresos, gastos y estimación de la renta). Se genera en el móvil; no se sube a ningún sitio.

---

## Actualizar los parámetros fiscales

Ningún importe legal está fijo en el código. Están en *Ajustes → Parámetros fiscales* y se guardan con tus datos.

En cada campaña de la renta (abril):

1. Revisa la normativa vigente para el ejercicio: escala estatal y reducción del art. 20 en la Ley 35/2006 del IRPF (BOE), escala y deducciones autonómicas en la normativa de Illes Balears (BOIB), y límites de la obligación de declarar (art. 96 LIRPF).
2. Cambia los valores que hayan variado. Los importes van en euros con coma decimal (`17.673,52`), los tipos en porcentaje (`9,5`) y los coeficientes como número (`1,75`).
3. Cambia el **ejercicio** y pulsa **Marcar como revisados hoy**. La pantalla Renta avisa si estimas un año distinto del de los parámetros.
4. Si te equivocas, **Restaurar valores por defecto** vuelve a los valores de fábrica.

Valores por defecto: ejercicio 2026, revisados el 1 de octubre de 2026.

### Qué calcula (y qué no)

- Rendimiento íntegro = suma de brutos de todos los pagadores, **SEPE incluido**.
- Neto previo = íntegro − Seguridad Social; otros gastos (art. 19.2.f) con tope en el neto previo; reducción del art. 20.
- Mínimo personal aplicado como `escala(base) − escala(min(base, mínimo))` en cada escala, nunca negativo.
- Deducción autonómica por alquiler (si el contrato está a tu nombre) y deducción por rendimientos bajos (desactivada por defecto).
- Obligación de declarar con el límite general y el reducido con varios pagadores (el 2.º y siguientes se ordenan de mayor a menor).
- **Propinas:** son rendimiento del trabajo (art. 17.1 LIRPF). Por defecto no entran en la estimación, pero la app recuerda que deben declararse; puedes incluirlas con un interruptor.
- **No incluye:** rendimientos del capital, ganancias patrimoniales, actividades económicas, tributación conjunta, mínimos por descendientes o discapacidad, ni otras deducciones. Es una **estimación orientativa**; la cifra oficial es la del borrador de la AEAT.

Si sale a pagar, la app puede crear el gasto «Renta» en junio del año siguiente, o fraccionado 60 % junio / 40 % noviembre. Si aún te quedan nóminas previstas, sugiere qué retención adicional pedir a la empresa para llegar a cero (el reglamento del IRPF permite solicitar un tipo de retención superior).

---

## Desarrollo

Requisitos: Node 22.

```bash
npm ci
npm run dev        # servidor de desarrollo
npm test           # Vitest: lógica de cálculo, copias e importación
npm run lint       # ESLint (typescript-eslint strict, type-checked)
npm run build      # tsc estricto + build de producción con service worker
npm run preview    # sirve dist/ para probar la PWA
```

### Arquitectura

```
src/
  domain/     Lógica pura, sin React ni navegador. Totalmente testeada.
    dinero.ts      céntimos enteros, tasas en diezmilésimas, parseo "1.234,56"
    irpf.ts        cálculo del IRPF, obligación de declarar, mensajes
    reparto.ts     reparto del resultado (mayor resto, nunca pierde céntimos)
    resumen.ts     resumen mensual, serie anual, simulación del colchón
    renta.ts       agrega los datos de un año para el IRPF
    copia.ts       esquema y validación de las copias JSON
    parametros.ts  valores por defecto (editables desde Ajustes)
  db/         Dexie (IndexedDB): esquema versionado y operaciones atómicas
  screens/    Pantallas
  ui/         Componentes y formularios
```

Reglas de diseño:

- **Dinero en céntimos enteros.** Ninguna operación en euros con decimales; los porcentajes se aplican con un único redondeo comercial al céntimo.
- **Esquema versionado.** Para añadir la pestaña de inversiones se crea `version(2)` en `src/db/db.ts` con las tablas nuevas (aportaciones y operaciones); Dexie migra los datos existentes. Las copias JSON llevan `schemaVersion`.
- **Navegación por hash** (`#/renta`): GitHub Pages no reescribe rutas, así que recargar nunca da 404.

### Despliegue en GitHub Pages

El workflow `.github/workflows/pages.yml` ejecuta lint, tests y build en cada push y PR, y despliega en Pages al hacer push a `main`. La base de Vite se toma del nombre del repositorio (`BASE_PATH=/<repo>/`), así que funciona aunque renombres el repositorio.

Configuración única en GitHub: *Settings → Pages → Build and deployment → Source: **GitHub Actions***. En una cuenta gratuita, Pages requiere que el repositorio sea público. El código no contiene datos personales: los tuyos están solo en tu móvil.

### Dependencias

| Paquete | Uso |
|---|---|
| `react`, `react-dom` | interfaz |
| `dexie`, `dexie-react-hooks` | IndexedDB con transacciones y consultas reactivas |
| `write-excel-file` | genera `.xlsx` en el navegador |
| `vite`, `vite-plugin-pwa` | build, manifest y service worker (Workbox) |
| `vitest`, `fake-indexeddb` | tests |

**Por qué no SheetJS:** el paquete `xlsx` publicado en npm está congelado en la 0.18.5, con vulnerabilidades conocidas (CVE-2023-30533 y CVE-2024-22363). La versión mantenida solo se distribuye desde el CDN propio de SheetJS. `write-excel-file` está mantenido, solo escribe (no parsea archivos ajenos) y tiene una única dependencia (`fflate`).
