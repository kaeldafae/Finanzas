# Finanzas mes a mes

App web instalable (PWA), **de uso doméstico**, para llevar las finanzas personales **mes a mes** con ingresos irregulares: meses con nómina, meses con prestación del SEPE (paro o ERTE) y meses mezclados. Pensada para un trabajador fijo-discontinuo de hostelería en Illes Balears.

- **Mes**: nóminas y pagos del SEPE por pagador, propinas, gastos fijos/variables/extra, resultado y reparto del sobrante.
- **Año**: tabla y gráfico de los 12 meses, meses previstos diferenciados, saldo acumulado desde el ahorro inicial.
- **Futuro**: previsión de tu dinero a 30, 90, 180 o 365 días, mes a mes. Cada cifra dice si es *planificada* (lo que tienes apuntado como previsto y tus pagos recurrentes), *estimada* (con tu historia; con trabajo de temporada se usa el mismo mes del año anterior) o *simulada* («¿y si gasto 100 € menos al mes?», que nunca se guarda). Con supuestos, confianza y datos usados.
- **Ahorro**: colchón de seguridad (gasto medio × meses), objetivos de ahorro (viaje, compra…) con progreso, fecha estimada, aportación necesaria y escenarios de 100/200/300 € al mes.
- **Renta**: estimación del IRPF (solo rendimientos del trabajo) con desglose, obligación de declarar y qué hacer.
- **Preguntar** (desde Mes): «¿cuánto gasté en restaurantes este año?», «compara marzo y abril», «¿en qué gasto más?». Las cifras las calcula el motor y cada respuesta dice de dónde sale (cuántos movimientos, importados o a mano). Si una pregunta no se entiende, puede interpretarla la IA integrada, que solo traduce la pregunta: nunca escribe cifras.
- **Ajustes**: pagadores, categorías, **pagos recurrentes** (detectados en tus gastos o a mano), presupuestos, parámetros fiscales, copias de seguridad, exportación a Excel e IA integrada.
- **Cambios del mes** (en Mes): categorías por encima o por debajo de tu mediana, gastos sueltos fuera de lo normal y comisiones. Describe, no juzga.

**Privacidad:** no hay servidor propio, ni cuentas, ni analítica, ni scripts de terceros. El lector de PDF, el OCR y la IA se ejecutan en el dispositivo; sus archivos los sirve la propia app (salvo el modelo de IA, que se descarga una vez). Los datos se guardan en el dispositivo (IndexedDB). Si activas la sincronización, viajan **cifrados de extremo a extremo** a un repositorio privado de tu GitHub. La Content Security Policy solo permite conectar con la propia app, con `api.github.com` (sincronización) y con los servidores desde los que se descarga el modelo de la IA integrada (`huggingface.co` y `raw.githubusercontent.com`): el navegador bloquea cualquier otro destino.

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

## Sincronizar móvil y ordenador (gratis y cifrado)

Los datos se guardan en un archivo cifrado dentro de un repositorio **privado** de tu GitHub. GitHub solo ve datos ilegibles: se cifran en tu dispositivo (AES-256-GCM, con una clave derivada de tu contraseña mediante PBKDF2-SHA256 con 600.000 iteraciones) y la contraseña nunca sale de él.

### Preparación (una sola vez)

1. En GitHub crea un repositorio **privado** llamado, por ejemplo, `finanzas-datos` (marca *Add a README file*).
2. Crea un token en *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*:
   - *Repository access*: **Only select repositories** → `finanzas-datos`.
   - *Permissions → Repository permissions → Contents*: **Read and write**. Nada más.
3. Elige una contraseña de cifrado (mínimo 10 caracteres; mejor una frase). Guárdala junto al token en el llavero o en un gestor de contraseñas.

### En cada dispositivo

*Ajustes → Sincronización*: escribe `usuario/finanzas-datos`, pega el token y pulsa **Comprobar**. Después escribe la contraseña de cifrado y pulsa **Conectar**. En el segundo dispositivo, la contraseña tiene que ser la misma; si no coincide, la app la rechaza sin tocar nada.

### Cómo funciona

- Se sincroniza al abrir la app, unos 3 segundos después de cada cambio, al recuperar la conexión y cada 2 minutos con la app abierta.
- Sin conexión sigue funcionando todo: los cambios se envían al volver la red.
- Si editas lo mismo en los dos dispositivos, gana la última edición de ese registro. Los borrados se propagan y no "resucitan".
- El tema claro u oscuro y la fecha de la última copia son de cada dispositivo.
- Al conectar un dispositivo que ya tenía datos, primero se descarga una copia JSON de seguridad. Después se combinan los datos y se unifican las categorías y pagadores que tienen el mismo nombre.
- Si el token caduca o GitHub lo rechaza, la app avisa arriba y en *Ajustes → Sincronización* puedes pegar uno nuevo.
- **Si pierdes la contraseña**, los datos de GitHub no se pueden recuperar. Los de cada dispositivo y tus copias JSON siguen siendo tuyos.
- *Desconectar* deja de sincronizar ese dispositivo sin borrar nada.

---

## Importar extractos del banco

*Ajustes → Importar extractos* (o el botón del mes vacío). Admite **PDF**, **CSV** y **Excel .xlsx**. No tienes que elegir columnas: la app las localiza sola y lo comprueba con el saldo. Los archivos se leen **en el dispositivo** y no se envían a ningún sitio.

**Cómo encuentra las columnas**
- **PDF** (recomendado para Revolut): lee el texto del PDF con su posición en la página ([pdf.js](https://mozilla.github.io/pdf.js/), de Mozilla, ejecutado en la app) y reconstruye Fecha, Descripción, Dinero saliente, Dinero entrante y Saldo. Une los conceptos de dos líneas, salta cabeceras repetidas y pies de página, descarta las transacciones pendientes y las de las huchas (ya aparecen en la cuenta principal) y deduce el tipo de operación (recarga, cajero, cambio de divisa, transferencia…) del concepto. Además del saldo fila a fila, **comprueba que lo leído suma lo mismo que el resumen del propio extracto**; si no, no se importa.
- **CSV y Excel:** por los títulos de las columnas (Santander, Revolut y la mayoría de bancos). Si no los reconoce, por el contenido: la columna de fechas, las de importes y la de texto; prueba las combinaciones posibles (importe con o sin signo, cargo y abono separados, cuál es el saldo) y se queda con la única que cuadra al céntimo con el saldo.
- Si no hay una lectura segura, no importa nada y ofrece un **diagnóstico sin datos** (solo la estructura del archivo) que puedes copiar para pedir que se adapte el lector. La elección manual de columnas queda en *Opciones avanzadas* solo para emergencias.
- **PDF escaneado o foto:** se puede leer con **OCR en el dispositivo** ([Tesseract.js](https://tesseract.projectnaptha.com/), español). El motor y el idioma (~6 MB) se descargan de la propia app la primera vez que se usan. Lo reconocido pasa por el mismo lector y las mismas comprobaciones: si un número se lee mal, no cuadra y no se importa.
- **Texto pegado:** en el iPhone, mantén pulsado el texto de una captura del extracto («Texto en vivo»), cópialo y pégalo en *Pegar texto*. Admite listas agrupadas por día y fechas sin año.
- Si el PDF tiene contraseña, la app la pide y no la guarda.
- **Cómo se ha leído:** cada archivo muestra las lecturas que se probaron (títulos, alineación, cadenas de saldo) y por qué se aceptó o rechazó cada una.

**Nóminas en PDF.** Si el PDF es una nómina (se reconoce por sus rótulos), se leen total devengado, cotizaciones del trabajador, IRPF y líquido, y solo se acepta si *devengado − deducciones = líquido* al céntimo. *Aplicar nómina* completa el ingreso que llegó del banco con el mismo neto (ese mes o el siguiente) o lo crea si no existe. Así la Renta usa el bruto, la Seguridad Social y la retención reales.

**Evidencia.** Cada movimiento importado guarda de qué archivo (huella SHA-256 abreviada, no el archivo), página y fila sale, y qué comprobaciones superó. Se ve al editar el gasto.

**Cómo descargarlos**
- **Revolut:** en la app, cuenta en euros → ⋯ → *Extracto* → PDF (o Excel/CSV) → periodo.
- **Santander:** banca online → *Cuentas* → *Movimientos* → fechas → *Descargar* → Excel.

Elige los de los dos bancos a la vez para que se emparejen los traspasos entre ellos.

**Qué hace**
1. **Comprueba que el extracto está completo:** saldo anterior + movimiento = saldo, fila a fila. Si algo no cuadra (falta una fila o un importe se ha leído mal), no se importa y te dice la fila.
2. **Clasifica cada movimiento:**
   - El tipo de operación de Revolut.
   - Conceptos claros: SEPE, nómina, cajero, comisiones.
   - Tus reglas.
   - Un diccionario de comercios de España e Ibiza.
   - Un **aprendizaje local** que reconoce variantes de comercios que ya has clasificado.
3. **Traspasos:** el de Santander a Revolut no cuenta como gasto ni como ingreso. Las huchas van aparte y las devoluciones restan.
4. **Lo dudoso pasa por tu revisión:** Amazon, Bizum, transferencias a personas, comercios desconocidos y entradas sin identificar. Si corriges un comercio, el cambio se aplica a todos sus movimientos y puedes guardarlo como regla.
5. **Al guardar** verás un informe: ingresos, gastos y ahorro por mes, en qué se va el dinero, pagos que se repiten, gastos fuera de lo normal y un presupuesto sugerido.
6. **Volver a importar un extracto, o uno que se solape, no duplica nada**, aunque llegue en otro formato: el mismo mes en PDF y en CSV se reconoce por cuenta, día e importe (también cuando el CSV separa la comisión y el PDF la suma). Si hay un importe igual ya importado el día anterior o el siguiente, se marca como *posible duplicado* y se deja fuera salvo que digas lo contrario.

**IA integrada (en el dispositivo).** El modelo se ejecuta en un *worker*: la interfaz no se congela y la librería (~6 MB) solo se descarga si usas la IA. Modelos disponibles: Qwen2.5 0,5B (por defecto en móvil), Llama 3.2 1B y Qwen3 0,6B (a probar) y Qwen2.5 1,5B (ordenador). *Evaluar este modelo* mide el acierto real con los comercios que ya has clasificado tú, en tu dispositivo, para elegir con datos.

**Detalles de la IA integrada.** La app lleva un modelo de lenguaje que se ejecuta dentro del navegador con WebGPU ([WebLLM](https://github.com/mlc-ai/web-llm), modelos Qwen2.5 con licencia Apache-2.0). Se prepara en *Ajustes → IA integrada → Descargar y probar*:

- Se descarga **una vez** (≈ 300 MB el ligero, recomendado para móvil; ≈ 900 MB el preciso, para ordenador) y queda guardado para usarla **sin conexión**. Hazlo con wifi.
- La descarga es solo del modelo; **tus movimientos nunca salen del dispositivo**. No hay clave de API ni cuenta de ningún proveedor.
- Al importar, *Revisar con la IA integrada* hace **dos pasadas independientes** (otra redacción y otro orden) y aplica las mismas reglas que la revisión por copiar y pegar: solo propone lo que coincide en las dos, con seguridad suficiente y sin contradecir al diccionario. Las respuestas se validan contra un esquema JSON con las categorías existentes; un lote mal formado no se aplica.
- *Descargar y probar* ejecuta además un diagnóstico (clasifica un comercio conocido) para confirmar que funciona en tu dispositivo.
- Requisitos: Chrome o Edge actualizados en ordenador o Android; en iPhone, iOS 26 o posterior. Si el dispositivo no es compatible, la app lo dice y queda disponible la revisión por copiar y pegar.
- El motor (≈ 6 MB) no se descarga al instalar la app: solo cuando la usas por primera vez. *Borrar modelo* libera el espacio.

**Revisión con IA, doble y por copiar y pegar.** Alternativa sin descargas: la app no se conecta a ninguna IA. En la revisión genera una petición con los comercios dudosos anonimizados: solo el nombre del comercio, cuántas veces aparece y un rango de importe. No incluye importes exactos, fechas, cuentas, Bizum ni transferencias a personas. Tú la copias en un chat nuevo de Claude y pegas la respuesta.

- Hay una **segunda petición independiente**, con otra redacción y otro orden, para pegar en otro chat nuevo. Solo se acepta lo que **coincide en las dos**, con seguridad suficiente y sin contradecir al diccionario de la app.
- Lo que no coincide queda para que lo decidas tú.
- La respuesta se valida antes de usarla: formato, categorías existentes y números de la lista. Si está cortada o mal copiada, no se aplica nada.

**Comprobaciones antes de guardar.** Si la suma de lo clasificado no coincide al céntimo con la de los movimientos, no se guarda nada. Además avisa si un mismo comercio queda en dos categorías, si un importe es raro para su categoría o si hay un "fijo" que no se repite.

**Deshacer.** *Ajustes → Importar extractos → Importaciones anteriores → Deshacer* quita todo lo que creó esa importación, también en tus otros dispositivos, y permite volver a importar el extracto.

**Privacidad.** No se guarda el concepto del banco, ni IBAN, ni números de tarjeta, ni nombres de personas: solo el comercio limpio, la categoría, el importe, la fecha y la cuenta. El aprendizaje funciona en el dispositivo, sin conexión y sin ningún servicio externo.

**Nóminas importadas.** El banco solo muestra el neto. Esos ingresos se marcan *Completar con la nómina* y la pantalla Renta avisa hasta que escribas bruto, Seguridad Social y retención.

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
npm test           # Vitest: lógica de cálculo, copias, importación, previsión, asistente
npm run e2e        # Playwright: pruebas en navegador de la app compilada (antes: npm run build)
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
    sync.ts        fusión entre dispositivos (última edición gana, borrados)
    cifrado.ts     AES-256-GCM + PBKDF2 con Web Crypto
    flujo.ts       de dónde viene y adónde va el dinero, por cuenta
    importacion/   lectura de extractos (CSV, Excel, PDF, texto, OCR), cuadre de saldos,
                   nóminas, clasificación, aprendizaje local, traspasos, informe e IA
    compromisos.ts pagos recurrentes: detección y próximos cargos
    prevision.ts   previsión de caja (planificado / estimado / simulado, estacional)
    objetivos.ts   objetivos de ahorro y escenarios
    variaciones.ts cambios de gasto frente a tu mediana
    asistente.ts   preguntas → consulta → motor exacto → respuesta con evidencia
  ia/         worker y protocolo de la IA integrada (WebLLM)
  lib/        lectura de archivos, PDF (pdf.js) y OCR (Tesseract.js)
  sync/       cliente de GitHub, motor de sincronización y orquestación
    parametros.ts  valores por defecto (editables desde Ajustes)
  db/         Dexie (IndexedDB): esquema versionado y operaciones atómicas
  screens/    Pantallas
  ui/         Componentes y formularios
```

Reglas de diseño:

- **Dinero en céntimos enteros.** Ninguna operación en euros con decimales; los porcentajes se aplican con un único redondeo comercial al céntimo.
- **Sincronización.** Toda escritura fecha la fila (`actualizadoEl`) y los borrados se marcan (`borrado: true`). Las marcas de borrado se eliminan a los 90 días.
- **Esquema versionado.** v2 sincronización, v3 importador, v4 importaciones, v5 pagos recurrentes y objetivos. Dexie migra los datos existentes; las copias JSON llevan `schemaVersion` y aceptan copias antiguas sin las tablas nuevas.
- **Nada se inventa.** Lo que no se puede verificar (saldo, resumen, totales de la nómina) no se importa. La IA solo propone categorías o interpreta preguntas, siempre con salida JSON validada; nunca toca importes.
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
| `read-excel-file` | lee los extractos `.xlsx` en el navegador |
| `@mlc-ai/web-llm` | IA integrada: ejecuta el modelo en el dispositivo con WebGPU |
| `pdfjs-dist` | lee el texto de los extractos en PDF en el dispositivo (compilación *legacy* para Safari; pdf.js 6 no ejecuta código del PDF) |
| `tesseract.js`, `@tesseract.js-data/spa` | OCR en el dispositivo para fotos y PDF escaneados (archivos servidos por la app, sin CDN) |
| `@playwright/test` | pruebas en navegador (solo desarrollo) |
| `vite`, `vite-plugin-pwa` | build, manifest y service worker (Workbox) |
| `vitest`, `fake-indexeddb` | tests |

**Por qué no SheetJS:** el paquete `xlsx` publicado en npm está congelado en la 0.18.5, con vulnerabilidades conocidas (CVE-2023-30533 y CVE-2024-22363). La versión mantenida solo se distribuye desde el CDN propio de SheetJS. `write-excel-file` está mantenido, solo escribe (no parsea archivos ajenos) y tiene una única dependencia (`fflate`).
