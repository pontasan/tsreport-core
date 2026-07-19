# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | Español | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**Del japonés, el chino y el coreano a la escritura árabe: un motor de informes que convierte los sistemas de escritura del mundo en hermosos PDF, en TypeScript puro.**

`tsreport-core` se encarga del análisis de fuentes OpenType, la composición tipográfica de texto (disponer los caracteres en la página con las formas de glifo, anchuras y posiciones correctas), la maquetación de informes basada en bandas, la previsualización en Canvas/SVG y la generación de PDF, todo a través de un único modelo de renderizado coherente. No tiene dependencias en tiempo de ejecución. Sin módulos nativos y sin WASM, este único paquete funciona tanto en Node.js como en los navegadores modernos.

Los ejemplos de código de este documento utilizan intencionadamente datos de negocio japoneses (cotizaciones, facturas): sirven a la vez como demostración en vivo de la composición tipográfica CJK de este motor.

```bash
npm install tsreport-core
```

Este README está lleno de ejemplos que puede copiar y ejecutar tal cual, y cubre desde la generación de su primer PDF hasta los 16 elementos de informe, la escritura vertical, la composición tipográfica multilingüe, la incrustación de fuentes y la conversión de texto a contornos, y la previsualización en el navegador. Si las herramientas de informes son nuevas para usted, empiece por **Fundamentos de la maquetación de informes** para familiarizarse con los conceptos y construya después su primer PDF con el tutorial.

## Componer correctamente los sistemas de escritura del mundo con un solo motor

Un informe multilingüe no puede mostrarse correctamente escribiendo las cadenas tal cual dentro de un PDF. La selección de glifos, la medición de la anchura de los caracteres, el posicionamiento, el corte de líneas, la escritura vertical y la incrustación de fuentes en el PDF: solo cuando toda esta cadena de procesamiento engrana obtiene usted la página que espera.

`tsreport-core` asume este flujo completo, desde el análisis de fuentes hasta la generación del PDF.

- **Japonés, chino y coreano** — el chino simplificado y tradicional, el hangul, el tratamiento de la puntuación y los glifos de escritura vertical se componen correctamente a partir de datos Unicode y OpenType
- **Escritura árabe y composición de derecha a izquierda (RTL)** — el modelado contextual de glifos, las uniones y ligaduras (varios caracteres que se funden en una sola forma de glifo) y el procesamiento bidireccional de Unicode (control del orden cuando el texto de derecha a izquierda se mezcla con dígitos y letras latinas) se gestionan con el mismo pipeline de maquetación que cualquier otra escritura
- **Sistemas de escritura complejos** — se admiten la sustitución y el posicionamiento de glifos dirigidos por las reglas tipográficas integradas en la fuente (OpenType Layout), los caracteres combinantes, las variantes de glifo (diseños alternativos de un mismo carácter) y las características tipográficas por idioma
- **Escritura vertical** — gestiona `vertical-rl` / `vertical-lr`, los glifos de escritura vertical, las métricas verticales (datos dimensionales, como los avances, específicos del texto vertical) y la rotación de caracteres
- **Incrustación automática de subconjuntos de fuentes** — solo se incrustan en el PDF los glifos realmente utilizados (los datos de forma por carácter almacenados en la fuente), de modo que el documento se ve igual incluso en equipos que no tienen la fuente instalada
- **Conversión de texto a contornos** — por elemento, el texto puede emitirse como trazados vectoriales independientes de la fuente
- **Referencias a fuentes del sistema** — para los flujos de trabajo que dependen de las fuentes del visor, también puede producir PDF ligeros sin fuentes incrustadas
- **Detección de caracteres ilegibles antes de que aparezcan** — `checkGlyphCoverage()` señala los caracteres ausentes de la fuente, por página y por carácter, antes de la salida

Y esta composición tipográfica funciona como una sola unidad con un motor de maquetación construido específicamente para informes, porque la capacidad de componer los caracteres correctamente y la capacidad de paginar correctamente no pueden separarse.

- **Maquetación que responde al volumen de texto** — las filas se estiran según la cantidad de texto (`stretchWithOverflow`) y las alturas de las bandas se ajustan automáticamente. Los nombres de producto largos nunca quedan cortados
- **Saltos de página automáticos según el volumen de datos** — cuando las filas de detalle desbordan, el motor inicia una página nueva y vuelve a emitir automáticamente el encabezado y la fila de títulos. Los subtotales por grupo y los saltos de página no requieren más que una declaración
- **Maquetación anidada** — incluso los informes complejos que combinan tablas, tablas cruzadas y subinformes se colocan de forma coherente con el mismo motor de maquetación
- **WYSIWYG (previsualización = impresión)** — los elementos se fijan exactamente en las coordenadas en pt que usted especifica, y la previsualización Canvas/SVG comparte un resultado de maquetación idéntico con la salida PDF. Lo que ve en pantalla es lo que obtiene en papel

## Por qué tsreport-core

tsreport-core nació de tres inquietudes.

**TypeScript no tiene una solución seria de informes.** Producir cotizaciones y facturas es una necesidad básica de cualquier negocio y, sin embargo, el ecosistema TypeScript/Node.js —aunque cuenta con bibliotecas de dibujo PDF de bajo nivel— no tenía nada que mereciera llamarse «motor de informes»: maquetación en bandas, saltos de página automáticos, agregación y fidelidad entre previsualización e impresión en un solo paquete. Queríamos acabar con la práctica de arrastrar otro runtime de lenguaje o un producto de servidor externo solo para los informes.

**La generación de informes es una capacidad fundamental y todo el mundo debería poder usarla gratis.** La salida de informes no es una función prémium reservada a unos pocos productos caros; forma parte de los cimientos de cualquier sistema de negocio. Sin licencias comerciales que comprar y sin tarifas por uso, todos —desde las herramientas personales hasta los productos comerciales— deberían poder usar el mismo motor tal cual. tsreport-core publica todas sus funciones bajo una licencia dual MIT OR Apache-2.0 como materialización de esta convicción.

**Pocas soluciones abordan de frente el soporte multilingüe: escrituras asiáticas, escritura árabe y más.** La mayoría de las herramientas de informes y PDF están diseñadas en torno al texto latino y tratan la composición del japonés, el chino y el coreano, o la escritura árabe de derecha a izquierda, como algo secundario. tsreport-core convirtió «componer correctamente los sistemas de escritura del mundo con un solo motor» en un objetivo de diseño desde el primer día, implementando internamente todo, desde el análisis de fuentes hasta la composición tipográfica y la incrustación en PDF.

Estas motivaciones se concretan en tres fortalezas.

### Del motor de maquetación a la generación de PDF, completo en un solo paquete

Cuando las páginas se ensamblan a partir de una plantilla y datos, el resultado se captura en un único modelo de renderizado llamado `RenderDocument`. Ese mismo modelo puede renderizarse a PDF, Canvas o SVG, de modo que no hace falta mantener una lógica de maquetación duplicada para la previsualización en pantalla y la impresión: el PDF se ve exactamente igual que lo que vio en pantalla. No es necesario conectar un motor de informes de maquetación en bandas con una biblioteca PDF.

### TypeScript puro con cero dependencias en tiempo de ejecución

El análisis de fuentes, la composición tipográfica de texto, la generación de PDF, la compresión DEFLATE, el cifrado, la decodificación PNG y la generación de códigos de barras están implementados íntegramente en TypeScript puro. Sin módulos nativos ni procesos externos, se comporta de forma idéntica en todos los entornos, y auditar el código que se ejecuta durante la generación de un informe significa leer solo este paquete.

### Todo lo que un informe necesita, incorporado

- Maquetación en bandas con título, encabezado de página, detalle, grupo, resumen y más
- Tablas, tablas cruzadas, subinformes, variables, expresiones, saltos de página, tabla de contenido, fusión de varios informes
- Importación de PDF existentes: conversión de páginas PDF en elementos de informe (`ElementDef`), estilos, imágenes e información de fuentes
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, degradados, recorte, transparencia, composición matemática, imágenes
- Cifrado de PDF; PDF/A-1b, 2b y 3b (normas internacionales de archivado a largo plazo); PDF/X-1a (norma internacional para la entrega a imprenta); marcadores, enlaces, formularios, anotaciones
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, fuentes variables (fuentes cuyo peso, anchura y otros ejes varían de forma continua) y fuentes de color

## Fundamentos de la maquetación de informes

Para los lectores nuevos en los motores de informes, esta sección recorre en orden los conceptos fundamentales.

### Premisa: un informe se construye a partir de una «plantilla» más «datos»

En tsreport-core, un informe se construye a partir de dos partes: una **plantilla** (la definición de la maquetación) y **datos** (JSON).

La plantilla no contiene valores reales. Define solo los marcos —«el nombre del artículo va aquí; el importe va allá, con esta anchura y este formato»— y referencias a **qué campo de los datos mostrar** en cada uno (escritas como `field.item`, es decir, el campo `item` de los datos).

Los valores reales se pasan como datos JSON. Cada elemento del array `rows` es una fila de detalle.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

Cuando se genera el informe, el motor recorre `rows` de arriba abajo y emite la maquetación de detalle una vez por fila. En el ejemplo anterior se imprimen tres filas de detalle, y `field.item` se resuelve sucesivamente en りんご, みかん y ぶどう. Si los datos crecen hasta 10 000 filas, el informe pasa a tener 10 000 filas sin cambiar un solo carácter de la plantilla. Esta división del trabajo —la maquetación es fija, el número de filas sigue a los datos— es el punto de partida de todo motor de informes.

### Una página es una pila de «bandas»

En el lado de la plantilla, la página se diseña entonces como una pila de franjas horizontales llamadas **bandas**. En lugar de calcular usted mismo las coordenadas Y y colocar los elementos en la página, declara únicamente «qué banda contiene qué», y el motor ensambla las páginas automáticamente según el número de filas de datos. Una página tiene la siguiente estructura.

```text
┌──────────────────────────┐
│ title                    │ ← una vez al inicio del informe (título, destinatario, …)
├──────────────────────────┤
│ pageHeader               │ ← parte superior de cada página (nombre de la empresa, fecha de emisión, …)
├──────────────────────────┤
│ columnHeader             │ ← fila de encabezado de las filas de detalle (artículo, cantidad, importe, …)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ una vez por cada fila de rows,
│ details                  │ │ repetida tantas veces como filas haya
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← cierra las filas de detalle (por página/columna)
├──────────────────────────┤
│ pageFooter               │ ← parte inferior de cada página (números de página, …)
└──────────────────────────┘
```

En la última página, después del último `details`, se emite exactamente una vez `summary` (los totales generales de todo el informe y similares). Además existen `background`, que se coloca bajo todas las páginas; `lastPageFooter`, usado solo en la última página; y `noData`, que aparece solo cuando los datos tienen cero filas: en total pueden definirse diez tipos de bandas en `bands`.

| Banda | Cuándo se emite | Uso típico |
| --- | --- | --- |
| `background` | Fondo de todas las páginas | Marcas de agua, bordes decorativos |
| `title` | Una vez al inicio del informe | Título, destinatario |
| `pageHeader` | Parte superior de cada página | Nombre de la empresa, fecha de emisión |
| `columnHeader` | Antes de las filas de detalle (por página/columna) | Fila de encabezado del detalle |
| `details` | Una vez por cada fila de datos (`rows`) | Filas de detalle |
| `columnFooter` | Después de las filas de detalle (por página/columna) | Zona de subtotales |
| `pageFooter` | Parte inferior de cada página | Números de página |
| `lastPageFooter` | Parte inferior de la última página (sustituye a `pageFooter` cuando se especifica) | Comentarios de cierre |
| `summary` | Una vez después de todas las filas de detalle | Total general, notas |
| `noData` | Cuando los datos tienen cero filas | «No hay datos coincidentes» |

Si además define `groups`, se insertan automáticamente encabezados y pies de grupo allí donde cambia la clave de grupo, lo que permite maquetaciones como «subtotal por departamento y, a continuación, página nueva».

También puede especificar `columns` en la plantilla (`count` = número de columnas, `spacing` = separación entre columnas en pt) para que la zona de detalle fluya en varias **columnas** verticales, al estilo de un periódico. El valor predeterminado es una columna, en cuyo caso todo lo descrito como «por columna» en este documento equivale a «por página». Pasar a la columna siguiente se denomina «salto de columna».

### Los saltos de página se producen automáticamente

Cuando las filas de detalle ya no caben en la página, el motor cierra automáticamente esa página (emitiendo `pageFooter`), inicia la siguiente, vuelve a emitir `pageHeader` y `columnHeader`, y continúa colocando las filas de detalle restantes. Nunca necesita contar filas ni calcular la altura restante de una página.

Solo cuando quiere tener el control recurre a lo siguiente.

- El elemento `break`: fuerza un salto de página o de columna en cualquier posición
- `startNewPage` de una banda: inicia siempre esa banda en una página nueva
- `splitType` de una banda: cuando no hay altura suficiente, decide si la banda puede repartirse entre páginas a mitad de camino (`stretch`) o debe pasar entera a la página siguiente (`prevent`)

### Subinforme = otro informe incrustado dentro de un informe

El elemento `subreport` incrusta un `.report` independiente completo dentro de la maquetación del informe padre. «Imprimir una lista de pedidos y, dentro de cada pedido, imprimir sus líneas como una tabla»: este es el mecanismo para maquetar **datos anidados** de ese estilo.

Supongamos que cada fila de `rows` del padre (un pedido) lleva un array `items` con sus líneas.

```json
{
  "rows": [
    {
      "orderNo": "A-001",
      "customer": "サンプル商事",
      "items": [
        { "name": "りんご", "qty": 10 },
        { "name": "みかん", "qty": 5 }
      ]
    },
    {
      "orderNo": "A-002",
      "customer": "テスト物産",
      "items": [
        { "name": "ぶどう", "qty": 2 }
      ]
    }
  ]
}
```

Coloque un elemento `subreport` en la banda `details` del padre y pase «los `items` de este pedido» mediante `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` es, como su nombre indica, una expresión. Para pasar un nombre de archivo fijo, envuélvalo en `'...'` como literal de cadena dentro de la expresión (también puede cambiarlo dinámicamente con una expresión como `"field.templatePath"`).

El subinforme se **ejecuta entonces una vez por cada fila de detalle del padre**, y los `items` que recibe se tratan como los `rows` propios del subinforme. El subinforme (`order-items.report`) es una plantilla independiente por derecho propio: tiene sus propias definiciones de bandas y se refiere a cada línea mediante `field.name` y `field.qty`. En la página se despliega así.

```text
┌──────────────────────────────┐
│ details                      │ ← rows del padre, fila 1 (pedido A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← recibe los items de este pedido (2 filas)
│   │   details              │ │ ← fila 1 de items (りんご 10)
│   │   details              │ │ ← fila 2 de items (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← rows del padre, fila 2 (pedido A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← recibe los items de este pedido (1 fila)
│   │   details              │ │ ← fila 1 de items (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

La tabla de líneas dentro de una factura, un bloque de detalle repetido por cliente: los «pequeños informes dentro de un informe» pueden extraerse como componentes y reutilizarse. También pueden pasarse parámetros desde el padre (cadenas de encabezado y similares). La sección posterior **Ejemplos funcionales de todos los elementos** contiene un ejemplo completo y listo para ejecutar exactamente de esta configuración (el elemento del padre más la plantilla del lado del subinforme).

## Generar un PDF a partir de un archivo `.report` y datos JSON

Un archivo `.report` es una plantilla de informe: un `ReportTemplate` escrito como JSON. Al ser JSON plano, puede seguir sus diferencias en Git y generarlo desde cualquier lenguaje o herramienta.

La configuración mínima consta de estos tres archivos.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

Los dos nombres de archivo de fuente suponen los pesos Regular / Bold de una fuente japonesa (p. ej., Noto Sans JP). Sustitúyalos por las fuentes que tenga a mano. El manejo de varios idiomas en un mismo informe se trata más adelante en **Construir informes multilingües**.

### 1. Escribir la plantilla, `quotation.report`

Las coordenadas, dimensiones, márgenes y tamaños de fuente están todos en **pt (puntos, 1pt = 1/72 de pulgada ≈ 0,353 mm)**, la unidad estándar del PDF. `"size": "A4"` se trata como 595 × 842pt (las dimensiones ISO de 210×297 mm convertidas a pt y redondeadas a enteros), y los márgenes de 36pt de este ejemplo son unos 12,7 mm.

Una premisa más: `fontFamily` en `styles` no es un nombre de archivo de fuente, sino una **clave (nombre lógico)** que registrará después en el `fontMap` y `fonts` del código de ejecución. Usar los mismos nombres en la plantilla y en el código (`jp` y `jpBold` en este ejemplo) es lo que los vincula.

```json
{
  "name": "quotation",
  "page": {
    "size": "A4",
    "margins": { "top": 36, "right": 36, "bottom": 36, "left": 36 }
  },
  "parameters": [
    { "name": "title", "type": "string", "defaultValue": "御見積書" }
  ],
  "fields": [
    { "name": "item", "type": "string" },
    { "name": "quantity", "type": "number" },
    { "name": "amount", "type": "number" }
  ],
  "variables": [
    {
      "name": "grandTotal",
      "expression": "field.amount",
      "calculation": "sum",
      "resetType": "report"
    }
  ],
  "styles": [
    { "name": "title", "fontFamily": "jpBold", "fontSize": 20 },
    { "name": "body", "fontFamily": "jp", "fontSize": 10 },
    { "name": "header", "fontFamily": "jpBold", "fontSize": 10 },
    { "name": "amount", "fontFamily": "jp", "fontSize": 10, "hAlign": "right" }
  ],
  "bands": {
    "title": {
      "height": 52,
      "elements": [
        {
          "type": "textField",
          "x": 0, "y": 0, "width": 523, "height": 30,
          "expression": "param.title",
          "style": "title"
        }
      ]
    },
    "columnHeader": {
      "height": 24,
      "elements": [
        {
          "type": "staticText",
          "x": 0, "y": 0, "width": 300, "height": 20,
          "text": "品名",
          "style": "header"
        },
        {
          "type": "staticText",
          "x": 300, "y": 0, "width": 80, "height": 20,
          "text": "数量",
          "style": "header",
          "hAlign": "right"
        },
        {
          "type": "staticText",
          "x": 380, "y": 0, "width": 143, "height": 20,
          "text": "金額",
          "style": "header",
          "hAlign": "right"
        }
      ]
    },
    "details": [
      {
        "height": 24,
        "elements": [
          {
            "type": "textField",
            "x": 0, "y": 0, "width": 300, "height": 20,
            "expression": "field.item",
            "style": "body"
          },
          {
            "type": "textField",
            "x": 300, "y": 0, "width": 80, "height": 20,
            "expression": "field.quantity",
            "pattern": "#,##0",
            "style": "amount"
          },
          {
            "type": "textField",
            "x": 380, "y": 0, "width": 143, "height": 20,
            "expression": "field.amount",
            "pattern": "¥#,##0",
            "style": "amount"
          }
        ]
      }
    ],
    "summary": {
      "height": 36,
      "elements": [
        {
          "type": "line",
          "x": 300, "y": 0, "width": 223, "height": 0,
          "lineWidth": 0.5,
          "lineColor": "#333333"
        },
        {
          "type": "staticText",
          "x": 300, "y": 8, "width": 80, "height": 20,
          "text": "合計",
          "style": "header"
        },
        {
          "type": "textField",
          "x": 380, "y": 8, "width": 143, "height": 20,
          "expression": "vars.grandTotal",
          "pattern": "¥#,##0",
          "style": "amount"
        }
      ]
    }
  }
}
```

El `pattern` usado en las filas de detalle es un especificador de formato de números/fechas (`#,##0` = separadores de miles, `¥#,##0` = separadores de miles con el símbolo del yen; véanse los detalles en «Dar formato a números y fechas», más adelante en este documento).

### 2. Preparar los datos, `quotation.test-data.json`

Cada fila de `rows` se vincula a `field.*` en la banda de detalle, y `parameters` se vincula a `param.*` para todo el informe.

```json
{
  "parameters": {
    "title": "御見積書"
  },
  "rows": [
    {
      "item": "高耐久ボールベアリング",
      "quantity": 12,
      "amount": 48000
    },
    {
      "item": "産業用制御モジュール",
      "quantity": 3,
      "amount": 126000
    }
  ]
}
```

Las vinculaciones se corresponden así.

| JSON | Expresión en el `.report` | Propósito |
| --- | --- | --- |
| `rows[n].item` | `field.item` | Fila de detalle actual |
| `parameters.title` | `param.title` | Argumento para todo el informe |
| Variable `grandTotal` | `vars.grandTotal` | Variables del informe para sumas, recuentos, etc. |
| Contexto de página | `PAGE_NUMBER` / `TOTAL_PAGES` | Número de página, total de páginas |

### 3. Cargar el `.report` y generar el PDF

```js
// print-report.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import {
  Font,
  TextMeasurer,
  checkGlyphCoverage,
  createReportFromFile,
  renderToPdf,
} from 'tsreport-core'

function loadFont(path) {
  const bytes = readFileSync(path)
  // Los Buffer de Node.js pueden compartir un pool de memoria mayor; pase a Font.load
  // un ArrayBuffer recortado exactamente a los bytes de este archivo
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return Font.load(buffer)
}

const regular = loadFont('./reports/fonts/NotoSansJP-Regular.otf')
const bold = loadFont('./reports/fonts/NotoSansJP-Bold.otf')
const fontMap = new Map([
  ['default', new TextMeasurer(regular)],
  ['jp', new TextMeasurer(regular)],
  ['jpBold', new TextMeasurer(bold)],
])
const fonts = { default: regular, jp: regular, jpBold: bold }
const dataSource = JSON.parse(
  readFileSync('./reports/quotation.test-data.json', 'utf8'),
)

const report = createReportFromFile(
  './reports/quotation.report',
  dataSource,
  { fontMap },
)
const coverageIssues = checkGlyphCoverage(report, fonts)
if (coverageIssues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(coverageIssues)}`)
}

const pdf = renderToPdf(report, {
  fonts,
  metadata: { title: dataSource.parameters.title },
})
writeFileSync('./quotation.pdf', pdf)
```

```bash
node print-report.mjs
```

Las mismas fuentes se registran dos veces, en `fontMap` y en `fonts`, porque cumplen funciones distintas: `fontMap` se usa para medir la anchura de los caracteres durante la maquetación (`TextMeasurer`), mientras que `fonts` se usa para incrustar las fuentes al generar el PDF. Registre la misma fuente en ambos, bajo los mismos nombres de clave que el `fontFamily` de la plantilla.

`createReportFromFile()` resuelve las rutas relativas de imágenes y subinformes respecto al directorio del `.report` principal. Si especifica `workingDirectory`, ese directorio pasa a ser la base. Para restringir lo que puede leerse, declare explícitamente la raíz permitida en `resources.fileRoot`; las referencias relativas que escapan de la raíz y los enlaces simbólicos que apuntan fuera de ella se rechazan.

## Definir plantillas directamente en TypeScript

En lugar de usar un archivo `.report`, puede escribir la plantilla como un objeto TypeScript. Con la comprobación de tipos y el autocompletado a su alcance, esto resulta idóneo para generar plantillas desde código. El contenido es la misma cotización del tutorial. Las coordenadas y dimensiones están en pt.

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import {
  Font,
  TextMeasurer,
  checkGlyphCoverage,
  createReport,
  renderToPdf,
  type ReportTemplate,
} from 'tsreport-core'

function loadFont(path: string): Font {
  const bytes = readFileSync(path)
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return Font.load(buffer)
}

const jpFont = loadFont('./fonts/NotoSansJP-Regular.otf')
const jpBoldFont = loadFont('./fonts/NotoSansJP-Bold.otf')

const template: ReportTemplate = {
  name: 'quotation',
  page: {
    size: 'A4',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
  },
  styles: [
    { name: 'title', fontFamily: 'jpBold', fontSize: 20 },
    { name: 'body', fontFamily: 'jp', fontSize: 10 },
    { name: 'amount', fontFamily: 'jp', fontSize: 10, hAlign: 'right' },
    { name: 'header', fontFamily: 'jpBold', fontSize: 10 },
    { name: 'amountHeader', fontFamily: 'jpBold', fontSize: 10, hAlign: 'right' },
  ],
  fields: [
    { name: 'item', type: 'string' },
    { name: 'quantity', type: 'number' },
    { name: 'amount', type: 'number' },
  ],
  bands: {
    title: {
      height: 52,
      elements: [{
        type: 'staticText',
        x: 0, y: 0, width: 523, height: 32,
        text: '御見積書',
        style: 'title',
      }],
    },
    columnHeader: {
      height: 24,
      elements: [
        { type: 'staticText', x: 0, y: 0, width: 300, height: 20, text: '品名', style: 'header' },
        { type: 'staticText', x: 300, y: 0, width: 80, height: 20, text: '数量', style: 'amountHeader' },
        { type: 'staticText', x: 380, y: 0, width: 143, height: 20, text: '金額', style: 'amountHeader' },
      ],
    },
    details: [{
      height: 24,
      elements: [
        { type: 'textField', x: 0, y: 0, width: 300, height: 20, expression: 'field.item', style: 'body' },
        { type: 'textField', x: 300, y: 0, width: 80, height: 20, expression: 'field.quantity', pattern: '#,##0', style: 'amount' },
        { type: 'textField', x: 380, y: 0, width: 143, height: 20, expression: 'field.amount', pattern: '¥#,##0', style: 'amount' },
      ],
    }],
  },
}

const dataSource = {
  rows: [
    { item: '高耐久ボールベアリング', quantity: 12, amount: 48000 },
    { item: '産業用制御モジュール', quantity: 3, amount: 126000 },
  ],
}

const fontMap = new Map([
  ['default', new TextMeasurer(jpFont)],
  ['jp', new TextMeasurer(jpFont)],
  ['jpBold', new TextMeasurer(jpBoldFont)],
])
const document = createReport(template, dataSource, { fontMap })
const fonts = { default: jpFont, jp: jpFont, jpBold: jpBoldFont }

const coverageIssues = checkGlyphCoverage(document, fonts)
if (coverageIssues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(coverageIssues)}`)
}

const pdf = renderToPdf(document, {
  fonts,
  metadata: { title: '御見積書' },
})
writeFileSync('./quotation.pdf', pdf)
```

### Buscar elementos por ID y modificarlos antes del renderizado

Asigne a un elemento un `id` arbitrario y podrá recuperarlo con `findElementById()`, sin importar a qué profundidad se encuentre dentro de bandas o marcos. El valor devuelto no es una copia, sino el propio elemento dentro de `template`, por lo que cualquier cambio realizado antes de `createReport()` se refleja en la maquetación y el renderizado.

```ts
import { findElementById, getElementChildren } from 'tsreport-core'

const template: ReportTemplate = {
  page: { size: 'A4' },
  bands: {
    details: [{
      height: 40,
      elements: [{
        id: 'customer-block',
        type: 'frame',
        x: 0, y: 0, width: 300, height: 40,
        elements: [{
          id: 'customer-name',
          type: 'staticText',
          x: 0, y: 0, width: 300, height: 20,
          text: '変更前',
        }],
      }],
    }],
  },
}

const customerName = findElementById(template, 'customer-name')
if (customerName?.type === 'staticText') {
  customerName.text = '株式会社サンプル'
}

const customerBlock = findElementById(template, 'customer-block')
if (customerBlock !== undefined) {
  const directChildren = getElementChildren(customerBlock)
  console.log(directChildren.map((element) => element.id)) // ['customer-name']
}

const document = createReport(template, dataSource, { fontMap })
```

`findElementById()` busca en profundidad en las bandas normales, las bandas de detalle, los encabezados/pies de grupo, los marcos, las máscaras suaves y las celdas de tabla. Cuando el mismo ID aparece más de una vez, devuelve el primer elemento en el orden de búsqueda, así que mantenga único dentro de la plantilla cualquier ID que piense modificar. Los elementos del array devuelto por `getElementChildren()` son igualmente referencias a la plantilla original.

> Los archivos de fuentes no se incluyen con el paquete. Elija fuentes cuyas licencias se ajusten a su caso de uso, método de distribución y permisos de incrustación. Un estilo solo puede nombrar una fuente. Para mezclar caracteres de varios idiomas dentro de un mismo elemento, necesita una fuente Pan-CJK que los cubra todos en un solo archivo (una fuente que reúna caracteres japoneses, chinos y coreanos; p. ej., Source Han Sans, Noto Sans CJK). Para usar una fuente distinta por idioma, divida los elementos por idioma y cambie de estilo, como en la sección siguiente, «Construir informes multilingües».

## Construir informes multilingües

Cada estilo puede nombrar exactamente una fuente y no existe un mecanismo de reserva automática entre fuentes. El patrón básico de un informe multilingüe consiste, por tanto, en **cargar una fuente por idioma y aplicar el estilo de cada idioma a los elementos de ese idioma**.

El siguiente extracto proviene de una cotización que presenta el japonés y el chino simplificado en paralelo. Primero, cargue una fuente por idioma.

```js
const jaFont = loadFont('./fonts/NotoSansJP-Regular.otf')
const zhFont = loadFont('./fonts/NotoSansSC-Regular.otf')
const fontMap = new Map([
  ['default', new TextMeasurer(jaFont)],
  ['ja', new TextMeasurer(jaFont)],
  ['zh', new TextMeasurer(zhFont)],
])
const fonts = { default: jaFont, ja: jaFont, zh: zhFont }
```

En la plantilla, aplique el estilo `ja` al texto japonés y el estilo `zh` al texto chino, dividiendo los elementos por idioma.

```json
{
  "styles": [
    { "name": "ja", "fontFamily": "ja", "fontSize": 12 },
    { "name": "zh", "fontFamily": "zh", "fontSize": 12 }
  ],
  "bands": {
    "title": {
      "height": 40,
      "elements": [
        { "type": "staticText", "x": 0, "y": 0, "width": 160, "height": 28, "text": "御見積書", "style": "ja" },
        { "type": "staticText", "x": 170, "y": 0, "width": 160, "height": 28, "text": "报价单", "style": "zh" }
      ]
    },
    "columnHeader": {
      "height": 22,
      "elements": [
        { "type": "staticText", "x": 0, "y": 0, "width": 150, "height": 18, "text": "品名", "style": "ja" },
        { "type": "staticText", "x": 160, "y": 0, "width": 150, "height": 18, "text": "商品名称", "style": "zh" }
      ]
    },
    "details": [
      {
        "height": 22,
        "elements": [
          { "type": "textField", "x": 0, "y": 0, "width": 150, "height": 18, "expression": "field.nameJa", "style": "ja" },
          { "type": "textField", "x": 160, "y": 0, "width": 150, "height": 18, "expression": "field.nameZh", "style": "zh" }
        ]
      }
    ]
  }
}
```

Los datos llevan igualmente un campo por idioma.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

La excepción es **un campo único cuyo idioma no se conoce hasta el momento de la ejecución**, como un cuadro de observaciones de texto libre. Como ese campo no puede dividirse en elementos por idioma, la respuesta práctica es asignar —solo a ese estilo— una fuente Pan-CJK que cubra muchos sistemas de escritura en un solo archivo (Source Han Sans, Noto Sans CJK y similares). En cualquier caso, `checkGlyphCoverage()` detecta cualquier laguna en la cobertura de la fuente antes de la salida.

## Elegir un modo de salida de fuente por elemento de texto

Incluso dentro de un mismo informe, puede especificar el modo de salida por cada `staticText` o `textField`: texto incrustado y localizable en búsquedas para el cuerpo, contornos para el logotipo, referencias a fuentes del sistema para el texto estándar.

| Modo | Cómo se especifica | Estado en el PDF | Indicado para |
| --- | --- | --- | --- |
| Incrustación de subconjunto | `pdfFontMode: 'embedded'` (predeterminado) | Incrusta los glifos usados más el programa de la fuente. El texto puede seleccionarse y buscarse | Distribución, archivado a largo plazo, impresión, informes multilingües |
| Conversión a contornos | `outlineText: true` | Convierte las formas de los glifos en trazados vectoriales. No lleva información de fuente | Logotipos, arte final: texto cuyas formas deben quedar congeladas con exactitud |
| Referencia a fuente del sistema | `pdfFontMode: 'reference'` | No incrusta ninguna fuente; registra solo el nombre de la fuente y los caracteres | PDF ligeros para distribución interna donde el entorno de fuentes está controlado |

```ts
const textElements = [
  {
    type: 'staticText' as const,
    x: 0, y: 0, width: 220, height: 24,
    text: '検索できる日本語',
    style: 'body',
    pdfFontMode: 'embedded' as const,
  },
  {
    type: 'staticText' as const,
    x: 0, y: 28, width: 220, height: 24,
    text: '形状を固定する標章',
    style: 'body',
    outlineText: true,
  },
  {
    type: 'staticText' as const,
    x: 0, y: 56, width: 220, height: 24,
    text: '端末のフォントを参照',
    style: 'body',
    pdfFontMode: 'reference' as const,
  },
]
```

La incrustación de subconjuntos es el modo recomendado para preservar las formas de los glifos con independencia del entorno de destino. Las referencias a fuentes del sistema exigen una fuente compatible allí donde se abra el PDF, y la apariencia puede variar de un entorno a otro. El texto convertido a contornos no puede seleccionarse ni buscarse como texto normal.

## Escritura vertical

Basta con especificar `writingMode` en un estilo para que el texto se componga en vertical usando los glifos de escritura vertical y los datos dimensionales específicos del texto vertical (métricas verticales: avances y similares). `vertical-rl` avanza las líneas de derecha a izquierda; `vertical-lr` las avanza de izquierda a derecha.

```ts
const verticalStyle = {
  name: 'vertical',
  fontFamily: 'jp',
  fontSize: 14,
  writingMode: 'vertical-rl' as const,
}

const verticalText = {
  type: 'staticText' as const,
  x: 440, y: 0, width: 70, height: 260,
  text: '四季を通じて美しく読みやすい縦書き帳票',
  style: 'vertical',
}
```

## Previsualizar exactamente el mismo informe en el navegador

El `RenderDocument` que construyó para el PDF puede renderizarse igualmente directo a un Canvas. La previsualización y la impresión comparten el mismo resultado de maquetación, de modo que «la pantalla y el papel se ven distintos» sencillamente no puede ocurrir. Combinado con la maquetación fija basada en pt, este es el fundamento de una experiencia WYSIWYG de previsualización y edición (la incrustación de fuentes es el comportamiento predeterminado; solo el modo de referencia a fuentes del sistema depende del entorno de visualización para su apariencia). Una sola llamada a `renderPage()` dibuja la página, incluida la preparación y el cierre de la misma.

```ts
import { CanvasBackend, Font, TextMeasurer, createReport, renderPage } from 'tsreport-core'

const [regularBuffer, boldBuffer] = await Promise.all([
  fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer()),
  fetch('/fonts/NotoSansJP-Bold.otf').then(response => response.arrayBuffer()),
])
const jpFont = Font.load(regularBuffer)
const jpBoldFont = Font.load(boldBuffer)
const fontMap = new Map([
  ['default', new TextMeasurer(jpFont)],
  ['jp', new TextMeasurer(jpFont)],
  ['jpBold', new TextMeasurer(jpBoldFont)],
])
const reportDocument = createReport(template, dataSource, { fontMap })
const page = reportDocument.pages[0]
const canvas = document.querySelector<HTMLCanvasElement>('#preview')!
const context = canvas.getContext('2d')!

renderPage(page, new CanvasBackend(context, {
  scale: 1.5, // escala de visualización: 1.0 dibuja 1pt como 1px
  devicePixelRatio: window.devicePixelRatio, // mantiene el texto y las líneas nítidos en pantallas de alta densidad
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

Si está construyendo una interfaz de previsualización en React, también está disponible el paquete `tsreport-react`.

## Usar el motor de fuentes por separado

Incluso sin construir un informe, puede usar cada capacidad por sí sola: análisis de fuentes, shaping (convertir una cadena en la secuencia y las posiciones de los glifos que realmente se dibujan), medición de texto y generación de subconjuntos.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: anchura de la cadena en pt a 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // IDs de glifo y posiciones tras el shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: datos de trazado Bézier

console.log(measurement.width, shaped, glyph.outline)
```

## Convertir un PDF existente en elementos de informe (importación de PDF)

`importPdfPage()` analiza una página de un PDF existente y la convierte en un array de elementos de informe de tsreport-core (`ElementDef`). No es un simple visor: el texto entra como `staticText`, las imágenes como `image`, las formas como `path` — componentes que puede editar y reorganizar directamente en este motor de informes.

Tome el PDF de un formulario que venía usando en papel, o un PDF producido por otro sistema, y úselo como base, añadiendo campos de combinación de datos o reorganizando la maquetación. Es la puerta de entrada para **convertir en plantillas los activos de informes existentes**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: array de elementos de informe (staticText / image / path, …)
// page.styles:   definiciones de estilo de texto referenciadas por los elementos
// page.images:   datos de imagen referenciados por los elementos
// page.fonts:    información sobre las fuentes referenciadas
console.log(pageCount, page.width, page.height, page.elements.length)
```

Los `elements` y `styles` importados pueden colocarse directamente en las bandas de una plantilla. Las contraseñas de los PDF cifrados, la importación de anotaciones, la conversión a contornos del texto importado y más se controlan mediante `PdfImportOptions`.
## Dominar las expresiones

Todo lo «dinámico» de un informe se escribe como una expresión: el contenido que imprime un `textField`, la condición de impresión en `printWhenExpression`, los datos de un código de barras, las rutas de imágenes, los datos pasados a un subinforme; toda propiedad cuyo tipo es `Expression` acepta el mismo lenguaje de expresiones.

Las expresiones tienen dos formas.

- **Expresiones de cadena** — cadenas como `"field.price * field.quantity"`. Son un subconjunto seguro de JavaScript interpretado por un parser dedicado; nunca se usan `eval` ni `new Function`. Las plantillas siguen pudiendo guardarse como JSON (archivos `.report`)
- **Expresiones de callback** — funciones TypeScript de la forma `(field, vars, param, report) => …`. Obtiene toda la potencia del lenguaje, pero la plantilla ya no puede guardarse como JSON (esto supone que mantiene las plantillas en TypeScript)

Recomendamos ver primero hasta dónde llegan las expresiones de cadena y pasar a los callbacks solo cuando se queden cortas.

### Valores que puede referenciar en las expresiones

| Nombre | Descripción |
| --- | --- |
| `field.*` | La fila de datos actual. Se admite el acceso anidado, como `field.customer.name` |
| `vars.*` | Variables (valores agregados definidos en `variables`, descritos más abajo). `var.*` funciona igual |
| `param.*` | Valores de todo el informe: los valores pasados mediante `parameters` de la fuente de datos y los `defaultValue` de los `parameters` de la plantilla. En un subinforme, los parámetros pasados desde el padre también aparecen aquí |
| `PAGE_NUMBER` | El número de página actual (base 1) |
| `COLUMN_NUMBER` | El número de columna actual (base 1) |
| `REPORT_COUNT` | El número de filas de datos procesadas |
| `TOTAL_PAGES` | El total de páginas. **Referenciado tal cual produce «el número de páginas hasta el momento»**, así que para imprimir el total definitivo de páginas combínelo con `evaluationTime: 'report'` o `'auto'` (descritos más abajo) |

Referenciar un campo inexistente no lanza una excepción; se evalúa a `undefined` (incluso cuando una parte intermedia de `field.a.b` es `null`, devuelve `null` de forma segura).

### Sintaxis disponible en las expresiones de cadena

| Categoría | Disponible |
| --- | --- |
| Literales | números (`1200`, `0.5`), cadenas (`'見積'` o `"見積"`, con escapes como `\n`), `true` / `false` / `null` / `undefined` |
| Literales de plantilla | `` `合計 ${vars.total} 円` `` — dentro de `${}` puede aparecer una expresión completa |
| Aritmética | `+` (suma numérica y concatenación de cadenas), `-`, `*`, `/` |
| Comparación | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| Lógicos | `&&`, `\|\|`, `!` (evaluación en cortocircuito, como en JavaScript) |
| Fusión de nulos | `??` — devuelve el lado derecho cuando el izquierdo es null/undefined |
| Condicional (ternario) | `condición ? valorSiVerdadero : valorSiFalso` |
| Otros | `-` / `+` unarios, paréntesis `( )`, acceso a miembros con notación de punto (los nombres de propiedad pueden estar en japonés: `field.顧客名`) |
| Funciones incorporadas | `format(value, pattern)` = formato (descrito más abajo) / `round(value, digits?)` = redondeo al alza desde .5 / `roundUp`, `roundDown`, `roundHalfEven` (redondeo bancario), `ceil`, `floor`, `trunc` (en todos, el segundo argumento es el número de decimales, 0 si se omite) / `now()` = hora actual |

**No disponible**: `==` / `!=` (use `===` / `!==`), `%` y `**`, la notación con corchetes (`field['a-b']`) y el indexado de arrays, las llamadas a métodos (`field.name.toUpperCase()` falla en tiempo de evaluación; las únicas funciones invocables son las incorporadas de arriba), la asignación, la definición de funciones, `new`, el encadenamiento opcional (`?.` — innecesario de todos modos, porque los nulos intermedios nunca lanzan excepción). Cuando necesite algo de esto, use una expresión de callback.

Estas restricciones existen por seguridad. Las expresiones de cadena las interpreta un parser dedicado y nunca se ejecutan como código, por lo que una plantilla recibida del exterior no puede colar código arbitrario.

### Imprimir un resultado calculado

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

Datos de ejemplo:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

Esto imprime `¥3,960`.

### Construir cadenas

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

Los valores incrustados en el `${}` de un literal de plantilla se convierten a cadena y se concatenan. **null se convierte en la cadena `"null"`**, así que añada `?? ''` a los valores que puedan faltar, como en el ejemplo.

### Cambiar el contenido según una condición

Use el operador ternario para cambiar lo que se imprime.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

Cuando quiera cambiar *si* algo se muestra en lugar de *qué* se muestra, use la propiedad común a todos los elementos `printWhenExpression` (véase «Imprimir un elemento solo cuando se cumple una condición»). Para cambiar el estilo (color, negrita) según una condición, especifique una expresión de condición de la misma forma en los `conditionalStyles` de la definición de estilo.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### Dar formato a números y fechas — `format` y `pattern`

`textField` puede dar formato al resultado de la expresión en el momento de imprimir mediante la propiedad `pattern`. Para dar formato a parte de un valor dentro de una expresión, use la función incorporada `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

Los patrones numéricos combinan `#` (mostrar el dígito si existe), `0` (relleno con ceros) y `,` (separador de miles), y pueden llevar un prefijo y un sufijo. El redondeo es al alza desde .5.

| Patrón | Entrada | Salida |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

Los tokens del patrón de fecha son `yyyy` (año de 4 dígitos), `MM` / `M` (mes con/sin relleno de ceros), `dd` / `d` (día con/sin relleno de ceros), `HH` (hora con relleno de ceros, reloj de 24 horas), `mm` (minutos) y `ss` (segundos). Un valor null/undefined produce una cadena vacía.

Para formatos más allá de estos (fechas en eras japonesas, nombres de días de la semana, manejo de dígitos de moneda, etc.), registre funciones TypeScript con nombre en los `formatters` de la plantilla y escriba el nombre en `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// En el lado del elemento: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` busca primero un formateador registrado con ese nombre y, si no encuentra ninguno, se interpreta como formato incorporado. Los formateadores son funciones, así que las plantillas que usan esta característica se mantienen en TypeScript en lugar de JSON.

### Imprimir totales, promedios y recuentos — variables (`variables`)

La agregación que abarca varias filas de detalle se define en los `variables` de la plantilla. Cada vez que se procesa una fila de datos, la variable incorpora a su agregado el resultado de su `expression`, y las expresiones pueden referenciar el valor actual como `vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

Coloque un `textField` con `"expression": "vars.pageTotal"` en la banda `pageFooter` para un subtotal de página, y uno con `"expression": "vars.grandTotal"` en la banda `summary` para el total general.

**Lista de propiedades (cada entrada de `variables`)**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nombre de la variable, referenciada desde las expresiones como `vars.name` |
| `expression` | Expression | ✓ | Se evalúa para cada fila; el resultado se incorpora al agregado |
| `calculation` | `'sum'` = total / `'average'` = promedio / `'count'` = recuento / `'distinctCount'` = recuento de valores distintos / `'min'` = mínimo / `'max'` = máximo / `'first'` = primer valor / `'nothing'` = se sobrescribe en cada fila (último valor) | ✓ | Método de agregación |
| `resetType` | `'report'` = sigue agregando durante todo el informe (sin reinicio; predeterminado) / `'page'` = se reinicia por página / `'column'` = se reinicia por columna / `'group'` = se reinicia por el grupo nombrado en `resetGroup` / `'none'` = nunca se reinicia, como `'report'`, pero con evaluación diferida (`evaluationTime`) el valor queda fijado en el momento en que se colocó el elemento (no se sustituye después por el agregado final) |  | Ámbito de reinicio de la agregación |
| `resetGroup` | string |  | Nombre del grupo de destino cuando `resetType: 'group'` |
| `incrementCondition` | Expression |  | Cuando se establece, las filas cuyo resultado de evaluación es falsy no se incorporan al agregado (agregación condicional) |
| `initialValue` | Expression |  | Valor inicial en la inicialización y en cada reinicio |

Con `incrementCondition`, una agregación condicional como «sumar solo una categoría concreta» cabe en una sola variable:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

Para agregar en el padre los resultados de la ejecución de un subinforme, use los `returnValues` del elemento `subreport`, que escriben las variables del hijo de vuelta en los `vars.*` del padre (véase la lista de propiedades de `subreport`).

### Imprimir números de página y el total de páginas

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 100, "height": 16,
  "expression": "`${PAGE_NUMBER} / ${TOTAL_PAGES}`",
  "evaluationTime": "auto",
  "hAlign": "center",
  "style": "body"
}
```

La clave es `evaluationTime: 'auto'`. Las expresiones se evalúan normalmente en el momento en que se coloca el elemento, pero en ese instante el total definitivo de páginas aún no se conoce. Con `'auto'`, la expresión se analiza estáticamente y **cada referencia se evalúa en su propio momento correcto**: `PAGE_NUMBER` cuando la página se finaliza, `TOTAL_PAGES` cuando el informe se completa. Como `'auto'` necesita analizar la expresión, solo está disponible para expresiones de cadena (especificarlo en una expresión de callback lanza una excepción).

### Más allá de las expresiones de cadena — expresiones de callback

Si su plantilla está definida en TypeScript, puede escribir una función directamente allí donde se acepte una `Expression`. Recibe cuatro argumentos, `(field, vars, param, report)`; a través de `report` puede acceder a valores incorporados como `PAGE_NUMBER`, a la función `format` y a los `formatters` registrados.

```ts
{
  type: 'textField',
  x: 0, y: 0, width: 300, height: 20,
  expression: (field, vars, param, report) => {
    const code = String(field.productCode)
    return code.match(/^[A-Z]{2}-\d{4}$/) ? code.toUpperCase() : `不正なコード: ${code}`
  },
  style: 'body',
}
```

Llamadas a métodos, expresiones regulares, funciones externas: todo lo que pueda escribir en TypeScript está disponible. Hay dos contrapartidas: la plantilla ya no puede guardarse ni transferirse como JSON, y `evaluationTime: 'auto'` no está disponible (los valores explícitos como `'report'` sí funcionan).

### Qué ocurre cuando una expresión falla

- **Los errores de sintaxis y las construcciones prohibidas** (llamadas a métodos, etc.) lanzan un `ExpressionLanguageError` con información de posición, que se propaga tal cual hasta el llamador de `createReport()`. Nunca se traga silenciosamente dejando una celda en blanco
- **Las referencias a campos o variables inexistentes** no son errores; se evalúan a `undefined`. En un `textField`, se imprime una cadena vacía cuando `blankWhenNull: true` está establecido; sin él, se imprime la cadena `null`
- Para validar expresiones proporcionadas por el usuario antes de ejecutarlas, `validateExpressionSource(source)` devuelve el resultado de la comprobación sintáctica (un error, o `null`)

## Ejemplos funcionales de todos los elementos

Aquí están los 16 elementos que ofrece `ElementDef`. Todos los elementos reciben `x`, `y`, `width` y `height` (en pt, 1pt = 1/72 de pulgada) y se colocan en los `elements` de una banda o de un `frame`.

| Qué quiere hacer | Elemento |
| --- | --- |
| Imprimir texto fijo | `staticText` |
| Imprimir datos, variables o resultados de expresiones | `textField` |
| Dibujar una línea | `line` |
| Dibujar un rectángulo o una caja redondeada | `rectangle` |
| Dibujar un círculo o una elipse | `ellipse` |
| Dibujar una forma vectorial arbitraria | `path` |
| Colocar una imagen | `image` |
| Agrupar varios elementos dentro de un borde | `frame` |
| Imprimir una tabla | `table` |
| Imprimir una tabla cruzada | `crosstab` |
| Incrustar un informe dentro de otro | `subreport` |
| Imprimir un código de barras o un código QR | `barcode` |
| Imprimir una fórmula matemática | `math` |
| Imprimir SVG | `svg` |
| Crear un formulario PDF rellenable | `formField` |
| Forzar un salto de página o de columna en cualquier punto | `break` |
| Imprimir un elemento solo cuando se cumple una condición | `printWhenExpression` (un atributo común a todos los elementos) |

A continuación, cada elemento recibe una definición que puede colocar directamente en el array `elements` de una banda, más datos de ejemplo para los elementos que usan expresiones. Al final de la sección de cada elemento está la lista de propiedades específica de ese elemento. Para las propiedades comunes a todos los elementos (posición, colores, condiciones de impresión, etc.) y las propiedades de estilo, véase más abajo «Referencia de propiedades de los elementos».

### Imprimir texto fijo — `staticText`

Imprime una cadena escrita en la plantilla, exactamente tal cual. Úselo para encabezados y etiquetas.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | Tipo de elemento |
| `text` | string | ✓ | La cadena fija que se imprime |
| `actualText` | string |  | Texto de sustitución para cuando los caracteres visibles difieren del texto obtenido al copiar y buscar (PDF /ActualText). Lo usa principalmente la importación de PDF para preservar la configuración del PDF de origen |
| `hyperlink` | HyperlinkDef |  | Hipervínculo (véase **`HyperlinkDef`** en la sección de propiedades comunes) |
| `anchorName` | string |  | Nombre de ancla. Se registra como destino para los marcadores y los enlaces dentro del documento (`hyperlink` de tipo `'localAnchor'`) |
| `bookmarkLevel` | number |  | Nivel jerárquico (1 = nivel superior, 1–6) para listar el texto de este elemento en la tabla de contenido (marcadores) mostrada en la barra lateral del visor de PDF |

Nota: además, pueden especificarse todas las propiedades comunes a los elementos y todas las propiedades de `TextProperties`.

### Imprimir datos y resultados de expresiones — `textField`

Imprime el resultado de evaluar `expression`. Puede referenciar `field.*` (datos), `vars.*` (variables), `param.*` (parámetros), `PAGE_NUMBER` y más, y los literales de plantilla permiten construir cadenas. Para el lenguaje de expresiones completo, véase «Dominar las expresiones». Use `pattern` para el formato de números/fechas y `stretchWithOverflow` para dejar que la altura crezca con la cantidad de texto.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

Datos de ejemplo:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | Tipo de elemento |
| `expression` | Expression | ✓ | Expresión que devuelve el valor a imprimir |
| `pattern` | string |  | Patrón de formato. Un formateador personalizado registrado en la plantilla (un nombre de `formatters`) tiene prioridad; en caso contrario, el valor se formatea con el formateador incorporado |
| `blankWhenNull` | boolean |  | Imprimir una cadena vacía cuando el resultado de la expresión es null/undefined (sin esto, se imprime la cadena `'null'`) |
| `stretchWithOverflow` | boolean |  | Cuando el contenido no cabe en height, estira la altura del elemento para ajustarla al contenido |
| `evaluationTime` | `'now'` = evaluar inmediatamente en el sitio (predeterminado) / `'band'` = evaluar cuando la banda se finaliza / `'column'` = evaluar al final de la columna / `'page'` = evaluar al final de la página / `'group'` = evaluar cuando se cierra el grupo nombrado en `evaluationGroup` / `'report'` = evaluar al final del informe (TOTAL_PAGES, etc., son definitivos) / `'auto'` = evaluar individualmente cada variable y valor incorporado que la expresión referencia, en su propio momento de reinicio (solo expresiones de cadena; las expresiones de callback lanzan una excepción) |  | Cuándo se evalúa la expresión. Con cualquier valor distinto del predeterminado, el área se reserva primero vacía en el momento de la colocación y se rellena una vez que el valor queda finalizado en el momento correspondiente. Usos típicos: mostrar el total de un grupo por delante del grupo (`'group'`), imprimir el total definitivo de páginas (`'report'`) |
| `evaluationGroup` | string |  | Nombre del grupo de destino cuando `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = las líneas que no caben no se dibujan (predeterminado; idéntico a `'truncate'` en la implementación actual) / `'truncate'` = cortar línea por línea el texto que no cabe / `'ellipsisChar'` = recortar la última línea en un límite de carácter y añadir `...` / `'ellipsisWord'` = recortar la última línea en un límite de palabra y añadir `...` |  | Tratamiento del texto que no cabe en la altura cuando `stretchWithOverflow` está desactivado. Predeterminado: `none` |
| `hyperlink` | HyperlinkDef |  | Hipervínculo (véase **`HyperlinkDef`** en la sección de propiedades comunes) |
| `anchorName` | string |  | Nombre de ancla. Se registra como destino para los marcadores y los enlaces dentro del documento (`hyperlink` de tipo `'localAnchor'`) |
| `bookmarkLevel` | number |  | Nivel jerárquico (1 = nivel superior, 1–6) para listar el texto de este elemento en la tabla de contenido (marcadores) mostrada en la barra lateral del visor de PDF |

Nota: además, pueden especificarse todas las propiedades comunes a los elementos y todas las propiedades de `TextProperties`. Este elemento respeta `isPrintRepeatedValues: false` (suprime la impresión de valores idénticos consecutivos).

### Dibujar una línea — `line`

Este ejemplo es una línea horizontal de altura 0. `lineStyle` acepta `dashed` y otros además de `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | Tipo de elemento. El segmento se dibuja desde la esquina superior izquierda del elemento `(x, y)` hasta su esquina inferior derecha `(x+width, y+height)` (`height: 0` da una línea horizontal, `width: 0` una vertical y ambos distintos de cero una diagonal) |
| `lineWidth` | number |  | Grosor de la línea (pt). Predeterminado: 1 |
| `lineStyle` | `'solid'` = continua / `'dashed'` = discontinua / `'dotted'` = punteada |  | Estilo de línea. Predeterminado: continua |
| `lineColor` | string |  | Color de la línea. Predeterminado: el `forecolor` del elemento o `#000000` si este también falta |

### Dibujar un rectángulo o una caja redondeada — `rectangle`

`cornerRadii` permite redondear cada esquina individualmente.

```json
{
  "type": "rectangle",
  "x": 0, "y": 0, "width": 100, "height": 60,
  "cornerRadii": {
    "topLeft": 12,
    "topRight": 12,
    "bottomRight": 4,
    "bottomLeft": 4
  },
  "fill": "#E0F2FE",
  "stroke": "#0369A1",
  "strokeWidth": 1
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | Tipo de elemento |
| `radius` | number |  | Radio de las esquinas (pt, compartido por todas las esquinas) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | Radio por esquina (pt) |
| `fill` | FillDef |  | Relleno (véase **`FillDef`** en la sección de propiedades comunes). Predeterminado: el `backcolor` del estilo (cuando no es `transparent`) |
| `stroke` | string |  | Color del borde. Predeterminado: el `forecolor` del estilo |
| `strokeWidth` | number |  | Grosor del borde (pt). Predeterminado: 1 |

### Dibujar un círculo o una elipse — `ellipse`

Dibuja una elipse inscrita en la anchura y la altura del elemento.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | Tipo de elemento. Dibuja la elipse inscrita en el cuadro delimitador del elemento (centro `(x+width/2, y+height/2)`, radios `width/2` × `height/2`) |
| `fill` | FillDef |  | Relleno (véase **`FillDef`** en la sección de propiedades comunes). Sin relleno cuando se omite |
| `stroke` | string |  | Color del borde. Sin borde cuando se omite |
| `strokeWidth` | number |  | Grosor del borde (pt). Predeterminado: 1 (cuando `stroke` está establecido) |

### Dibujar una forma vectorial arbitraria — `path`

Ponga la sintaxis de trazado SVG en `d` y su sistema de coordenadas en `viewBox`. La forma se escala para ajustarse al marco del elemento.

```json
{
  "type": "path",
  "x": 0, "y": 0, "width": 100, "height": 60,
  "viewBox": [0, 0, 100, 60],
  "d": "M 5 55 L 50 5 L 95 55 Z",
  "fill": "#FEF3C7",
  "stroke": "#B45309",
  "strokeWidth": 2
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | Tipo de elemento |
| `d` | string | ✓ | Datos de trazado SVG (M/L/C/Z, etc.). Las coordenadas son pt locales del elemento |
| `pdfSourceVector` | PdfSourceVectorDef |  | Producido por la importación de PDF para preservar una forma que aparece repetidamente (símbolos de mapas, etc.) como «una definición + N colocaciones» (véase **`PdfSourceVectorDef`** más adelante). Cuando está establecido, `d` no se analiza. No es necesario en plantillas escritas a mano |
| `affineTransform` | [number, number, number, number, number, number] |  | Matriz de transformación afín que lleva las coordenadas del trazado a las coordenadas locales del elemento antes de dibujar. `[a, b, c, d, e, f]` da `x' = a·x + c·y + e`, `y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. Las coordenadas del trazado se escalan desde esta región hasta la anchura y la altura del elemento |
| `fill` | FillDef |  | Relleno (véase **`FillDef`** en la sección de propiedades comunes). Sin relleno cuando se omite |
| `fillRule` | `'nonzero'` (predeterminado) / `'evenodd'` |  | Regla que decide qué regiones cuentan como «interior» en trazados autointersecantes o anidados. Para perforar un agujero tipo dónut, `'evenodd'` es la opción fiable |
| `fillOpacity` | number |  | Opacidad del relleno (0.0–1.0) |
| `stroke` | FillDef |  | Trazo (colores sólidos, y también degradados y más). Sin trazo cuando se omite |
| `strokeWidth` | number |  | Grosor del trazo (pt). Predeterminado: 1 (cuando `stroke` está establecido) |
| `strokeOpacity` | number |  | Opacidad del trazo (0.0–1.0) |
| `strokeLinecap` | `'butt'` = corte en el extremo / `'round'` = remate redondeado / `'square'` = remate cuadrado (prolongado media anchura de línea) |  | Forma del extremo de línea |
| `strokeLinejoin` | `'miter'` = inglete (en punta) / `'round'` = redondeado / `'bevel'` = biselado |  | Forma de la unión de líneas |
| `strokeMiterLimit` | number |  | Límite de inglete. Predeterminado: 10 |
| `strokeDasharray` | number[] |  | Patrón de guiones (array de longitudes de guion y hueco, pt) |
| `strokeDashoffset` | number |  | Desplazamiento inicial dentro del patrón de guiones (pt) |

### Colocar una imagen — `image`

Especifique la imagen con `sourceExpression` (una expresión) o `source` (un valor fijo). `scaleMode` controla cómo se ajusta la imagen al marco, y `onError` elige el comportamiento cuando la imagen no puede encontrarse (`error` = lanzar un error / `blank` = dejar en blanco / `icon` = mostrar un icono).

```json
{
  "type": "image",
  "x": 0, "y": 0, "width": 100, "height": 72,
  "sourceExpression": "field.logoPath",
  "scaleMode": "retainShape",
  "hAlign": "center",
  "vAlign": "middle",
  "onError": "error"
}
```

Datos de ejemplo:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | Tipo de elemento |
| `source` | string | | Referencia fija a la imagen (ID de imagen). Escriba tal cual una ruta relativa al archivo `.report`, una ruta absoluta, una URL, un data URI, etc. (para las reglas de los ID, véase más adelante «Restricciones de carga de recursos y reglas de los ID de imagen»). Se usa cuando `sourceExpression` falta o su resultado no se resuelve |
| `sourceExpression` | Expression | | Expresión dinámica de la fuente de imagen. Un resultado de tipo cadena se resuelve como ID de imagen; un resultado `Uint8Array` se trata como los propios datos de la imagen |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | Cómo se escala la imagen. `'clip'` = colocar la imagen a tamaño natural y recortarla al marco del elemento / `'fillFrame'` = estirarla para llenar el marco, ignorando la relación de aspecto / `'retainShape'` = conservar la relación de aspecto y escalarla al mayor tamaño que quepa en el marco / `'realSize'` = tamaño natural más recorte al marco (implementado de forma idéntica a `'clip'`). Predeterminado: `'retainShape'`. Cuando el tamaño de la imagen no puede determinarse, se comporta como `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | Colocación horizontal de la imagen dentro del marco (afecta a la colocación de los márgenes con `retainShape` y a la posición del recorte con `clip`/`realSize`). Predeterminado: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | Colocación vertical de la imagen dentro del marco. Predeterminado: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | Comportamiento cuando la fuente de imagen no está definida o no se resuelve. `'error'` = lanzar una excepción / `'blank'` = no dibujar nada / `'icon'` = dibujar una caja gris de marcador de posición con una marca ×. Predeterminado: `'icon'` |
| `lazy` | boolean | | Existe solo en la definición de tipos; las implementaciones actuales del motor de maquetación y los renderizadores no la referencian (no cubierta por la especificación) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | Ángulo de rotación de la imagen (grados) |
| `affineTransform` | [number, number, number, number, number, number] | | Forma alternativa de especificar la colocación directamente como matriz. `[a, b, c, d, e, f]` es una transformación que lleva la imagen del cuadrado unitario (0–1) mediante `x' = a·x + c·y + e`, `y' = b·x + d·y + f`; cuando está establecida, se omite el cálculo de colocación de `scaleMode`/`hAlign`/`vAlign`/`rotation`. La usa principalmente la importación de PDF para preservar la colocación original |
| `opacity` | number | | Opacidad (0.0–1.0) |
| `interpolate` | boolean | | Hace que el visor suavice los límites de los píxeles cuando se amplía una imagen de baja resolución (PDF /Interpolate). Actívelo para fotografías; desactívelo para imágenes que deben mantenerse nítidas, como los códigos de barras |
| `alternates` | PdfImageAlternateDef[] |  | Imágenes alternativas de PDF (/Alternates) para usar imágenes distintas en pantalla y en impresión. Cada entrada tiene dos propiedades: `source` = referencia a la imagen alternativa (obligatoria) y `defaultForPrinting` = si esta es la que se usa al imprimir |
| `opi` | PdfOpiMetadataDef |  | Información OPI para la imprenta comercial, donde una imagen de baja resolución de marcador de posición se sustituye por la de alta resolución en el momento de la salida. Principalmente para preservación en la importación de PDF (véase **`PdfOpiMetadataDef`** más adelante) |
| `measure` | PdfMeasurement |  | Información de escala y sistema de coordenadas usada por las herramientas de medición del visor en PDF de planos y mapas. Principalmente para preservación en la importación de PDF (véase **`PdfMeasurement`** más adelante) |
| `pointData` | PdfPointData[] |  | Datos de puntos (latitud/longitud, etc.) en PDF de mapas. Principalmente para preservación en la importación de PDF (véase **`PdfPointData`** más adelante) |
| `hyperlink` | HyperlinkDef | | Hipervínculo (`type`: `'reference'` = URL / `'localAnchor'` = ancla dentro del documento / `'localPage'` = página dentro del documento / `'remoteAnchor'`, `'remotePage'` = ancla/página dentro de un PDF externo; `target`: expresión del destino del enlace; `remoteDocument?`: expresión de la ruta del PDF externo) |

### Agrupar varios elementos dentro de un borde — `frame`

Agrupa elementos hijos; `border` dibuja un borde y `clip` recorta cualquier desbordamiento. Las coordenadas de los elementos hijos usan como origen la esquina superior izquierda del marco.

```json
{
  "type": "frame",
  "x": 0, "y": 0, "width": 200, "height": 72,
  "clip": true,
  "border": {
    "top": { "width": 1, "color": "#6B7280", "style": "solid" },
    "right": { "width": 1, "color": "#6B7280", "style": "solid" },
    "bottom": { "width": 1, "color": "#6B7280", "style": "solid" },
    "left": { "width": 1, "color": "#6B7280", "style": "solid" }
  },
  "elements": [
    {
      "type": "staticText",
      "x": 8, "y": 8, "width": 184, "height": 20,
      "text": "frame内の子要素",
      "style": "body"
    },
    {
      "type": "textField",
      "x": 8, "y": 36, "width": 184, "height": 20,
      "expression": "field.note",
      "style": "body"
    }
  ]
}
```

Datos de ejemplo:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | Tipo de elemento |
| `clip` | boolean | | Si se recortan los hijos en el límite del marco. Predeterminado: true |
| `border` | BorderDef | | Borde (véase **`BorderDef`** en la sección de propiedades comunes) |
| `padding` | Padding | | Relleno interior (`top?`/`bottom?`/`left?`/`right?`, cada uno en pt) |
| `rotation` | number | | Ángulo de rotación del marco (grados, en sentido antihorario en coordenadas de página) |
| `rotationOriginX` | number | | X del origen de rotación (relativa al marco, pt). Predeterminado: 0 |
| `rotationOriginY` | number | | Y del origen de rotación (relativa al marco, pt). Predeterminado: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Matriz afín que lleva las coordenadas locales del marco (con Y hacia arriba) al espacio de coordenadas del padre (disposición y significado de la matriz como en el `affineTransform` de `image`). La usa principalmente la importación de PDF para preservar la colocación original |
| `pdfForm` | PdfFormXObjectDef |  | En la importación de PDF, retiene y vuelve a emitir el sistema de coordenadas y los metadatos que llevaba un componente (Form XObject) del PDF de origen (véase **`PdfFormXObjectDef`** más adelante). No es necesario en plantillas escritas a mano |
| `hyperlink` | HyperlinkDef | | Hipervínculo (misma estructura que la propiedad homónima de `image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | Trazado de recorte en sintaxis de trazado SVG. `d` = datos del trazado, `fillRule` = regla de relleno |
| `transparencyGroup` | boolean | | Mantiene el límite del grupo de transparencia del PDF incluso cuando ni `isolated` ni `knockout` están activados. Mantenerlo garantiza que el resultado compuesto de opacidad y fusión sea el mismo que si el marco se compusiera como una única imagen aplanada (principalmente para la fidelidad de la importación de PDF) |
| `isolated` | boolean | | Grupo de transparencia aislado (PDF /Group /I). Cuando esto (o `knockout` / `softMask`) está establecido, el marco se compone como una unidad antes de aplicar la opacidad, la fusión y las máscaras |
| `knockout` | boolean | | Grupo de transparencia knockout (PDF /Group /K). Los hijos superpuestos dentro del grupo no se transparentan entre sí; en cada posición solo el hijo superior se compone con el fondo |
| `softMask` | FrameSoftMaskDef | | Máscara suave que hace el marco parcialmente transparente (véase **`FrameSoftMaskDef`** en la tabla siguiente). Usa el renderizado de sus `elements` como «mapa de transparencia», lo que permite efectos como desvanecerse gradualmente a lo largo de un degradado |
| `deviceParams` | DeviceParamsDef | | Parámetros para la fase de preimpresión de la imprenta comercial (véase **`DeviceParamsDef`** en la tabla siguiente). No son necesarios en informes normales; los usa principalmente la importación de PDF para preservar la configuración del PDF de origen |
| `elements` | ElementDef[] | | Elementos hijos dentro del marco |

**`FrameSoftMaskDef`** (estructura de `softMask`)
| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | Tipo de máscara. `'luminosity'` = cuanto más clara es una zona de la máscara, más opaco es el marco / `'alpha'` = cuanto más opaca es una zona de la máscara, más opaco es el marco |
| `colorSpace` | PdfProcessColorSpaceDef | | Espacio de color de fusión del grupo de transparencia de la máscara suave |
| `isolated` | boolean | | Bandera de aislamiento del grupo de transparencia de la máscara suave |
| `knockout` | boolean | | Bandera knockout del grupo de transparencia de la máscara suave |
| `backdrop` | [number, number, number] | | Color de fondo /BC para máscaras de luminosidad (DeviceRGB 0–1). Predeterminado: negro |
| `elements` | ElementDef[] | ✓ | Elementos compuestos como grupo de transparencia para definir la máscara |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | Función de transferencia /SMask /TR que reasigna los valores de la máscara (0..1) |

**`DeviceParamsDef`** (estructura de `deviceParams`. Para la preimpresión de imprenta comercial y normalmente innecesaria — principalmente para preservación en la importación de PDF)
| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | Función de transferencia /TR: `'Identity'` / `'Default'` / una única función compartida por todas las planchas de color / un array de funciones, una por plancha de los cuatro colores |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | Función de generación de negro /BG (`'Default'` = valor predeterminado del dispositivo vía /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | Función de eliminación de color subyacente /UCR (`'Default'` = valor predeterminado del dispositivo vía /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | Semitono /HT (trama de tipo 1 / arrays de umbral de tipos 6, 10, 16 / colección por colorante de tipo 5) |
| `halftoneOrigin` | [number, number] | | Origen del semitono de PDF 2.0 (/HTO, píxeles del espacio del dispositivo) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | Control de compensación de punto negro de PDF 2.0 (/UseBlackPtComp) |
| `flatness` | number | | Tolerancia de planitud (/FL) |
| `smoothness` | number | | Tolerancia de suavidad del sombreado (/SM) |
| `strokeAdjustment` | boolean | | Ajuste automático del trazo (/SA) |

### Imprimir una tabla — `table`

Una tabla con filas de encabezado, filas de detalle y filas de pie. Pase un array de datos de fila mediante `dataSourceExpression`, y las filas de detalle se repiten una vez por cada elemento del array.

```json
{
  "type": "table",
  "x": 0, "y": 0, "width": 440, "height": 100,
  "dataSourceExpression": "field.items",
  "columns": [
    { "width": 280, "style": { "fontId": "jp", "fontSize": 9 } },
    { "width": 80, "style": { "fontId": "jp", "fontSize": 9, "hAlign": "right" } },
    { "width": 80, "style": { "fontId": "jp", "fontSize": 9, "hAlign": "right" } }
  ],
  "headerRows": [
    {
      "height": 20,
      "cells": [
        { "text": "品名", "backcolor": "#E5E7EB" },
        { "text": "数量", "backcolor": "#E5E7EB" },
        { "text": "金額", "backcolor": "#E5E7EB" }
      ]
    }
  ],
  "detailRows": [
    {
      "height": 18,
      "cells": [
        { "expression": "field.name" },
        { "expression": "field.quantity" },
        { "expression": "field.amount" }
      ]
    }
  ],
  "footerRows": [
    {
      "height": 20,
      "cells": [
        { "text": "以上", "colSpan": 3, "hAlign": "right" }
      ]
    }
  ]
}
```

Datos de ejemplo (cada elemento de `items` se convierte en una fila de detalle de la tabla):

```json
{
  "rows": [
    {
      "items": [
        { "name": "部品A", "quantity": 2, "amount": 12000 },
        { "name": "部品B", "quantity": 4, "amount": 36000 }
      ]
    }
  ]
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | Tipo de elemento |
| `columns` | TableColumnElementDef[] | ✓ | Array de definiciones de columna. Si la suma de los `width` de todas las columnas difiere de la anchura del elemento, todas las columnas se escalan proporcionalmente para ajustarse exactamente a la anchura del elemento |
| `headerRows` | TableRowElementDef[] |  | Array de filas de encabezado. Cuando la tabla se reparte entre varias páginas, se vuelven a dibujar en la parte superior de cada página |
| `detailRows` | TableRowElementDef[] |  | Array de filas de detalle. Se dibujan repetidamente, una vez por fila de datos (filas de datos × todas las filas de detailRows) |
| `footerRows` | TableRowElementDef[] |  | Array de filas de pie. Cuando la tabla se reparte entre páginas, se dibujan solo en la última |
| `dataSourceExpression` | Expression |  | Usa el array al que se evalúa la expresión como filas de datos de esta tabla. Cuando se omite, se usan las filas de la fuente de datos principal. Lanza una excepción cuando el resultado no es un array |

**`TableColumnElementDef`** (cada entrada de `columns` = una definición de columna)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `width` | number | ✓ | Anchura de la columna (pt). Si el total de todas las columnas no coincide con la anchura del elemento, las anchuras se distribuyen proporcionalmente |
| `style` | TableCellStyleDef |  | Estilo de celda predeterminado para esta columna. Cuando una celda especifica una propiedad homónima, gana el ajuste de la celda (los bordes se fusionan lado por lado) |

**`TableRowElementDef`** (cada entrada de `headerRows`/`detailRows`/`footerRows` = una definición de fila)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `height` | number | ✓ | Altura de la fila (pt). Se trata como un mínimo: la fila se expande automáticamente cuando el texto con saltos de línea o los elementos hijos de la celda no caben (en celdas con rowSpan, el desbordamiento de contenido expande la última fila del rango fusionado) |
| `cells` | TableCellElementDef[] | ✓ | Array de definiciones de celda de esta fila. Las columnas ocupadas por un `rowSpan` de una fila superior se omiten automáticamente durante la colocación |

**`TableCellElementDef`** (cada entrada de `cells` = una definición de celda. Además de lo siguiente, puede especificarse directamente cualquier propiedad de `TableCellStyleDef`)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `text` | string |  | Texto fijo de la celda |
| `expression` | Expression |  | Expresión de vinculación de datos. La forma simple `field.name` lee el valor directamente de la fila de datos; cualquier otra cosa se resuelve mediante la evaluación de expresiones del motor. Tiene prioridad sobre `text` cuando se especifica |
| `colSpan` | number |  | Número de columnas a fusionar horizontalmente. Predeterminado: 1 |
| `rowSpan` | number |  | Número de filas a fusionar verticalmente. Predeterminado: 1. La altura de la celda es la suma de las alturas de las filas del rango fusionado |
| `elements` | ElementDef[] |  | Array de elementos hijos colocados dentro de la celda. Cuando se especifica, tiene prioridad sobre el renderizado de `text`/`expression` y se dibuja recortado al área menos el padding. La altura de la fila se expande automáticamente hasta la altura que necesitan los hijos |

**`TableCellStyleDef`** (estilo de celda usado en las definiciones de celda y en el `style` de una columna)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = alineado a la izquierda / `'center'` = centrado / `'right'` = alineado a la derecha |  | Alineación horizontal del texto |
| `vAlign` | `'top'` = alineado arriba / `'middle'` = centrado / `'bottom'` = alineado abajo |  | Alineación vertical del texto |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotación del texto (grados). Predeterminado: 0 |
| `backcolor` | string |  | Color de fondo de la celda |
| `forecolor` | string |  | Color del texto. Predeterminado: `#000000` |
| `fontId` | string |  | ID de fuente. Predeterminado: `'default'` |
| `fontSize` | number |  | Tamaño de fuente (pt). Predeterminado: 10 |
| `bold` | boolean |  | Negrita |
| `italic` | boolean |  | Cursiva |
| `underline` | boolean |  | Subrayado |
| `strikethrough` | boolean |  | Tachado |
| `lineSpacing` | LineSpacingDef |  | Configuración del interlineado (véase **`LineSpacingDef`** en la sección de propiedades comunes) |
| `letterSpacing` | number |  | Espaciado entre caracteres (pt). Añade una cantidad fija entre todos los caracteres (los valores negativos los aprietan) |
| `wordSpacing` | number |  | Espaciado entre palabras (pt; anchura extra añadida a los caracteres de espacio) |
| `firstLineIndent` | number |  | Sangría de primera línea (pt) |
| `leftIndent` | number |  | Sangría izquierda (pt) |
| `rightIndent` | number |  | Sangría derecha (pt) |
| `wrap` | boolean |  | Ajuste de línea del texto. Predeterminado: true |
| `shrinkToFit` | boolean |  | Reducir automáticamente el tamaño de fuente para que el texto quepa en la celda |
| `minFontSize` | number |  | Tamaño de fuente mínimo (pt) con `shrinkToFit`. Predeterminado: 4 |
| `fitWidth` | boolean |  | Ajustar automáticamente el tamaño de fuente (en ambos sentidos, reduciendo y ampliando) para que la línea más larga quepa exactamente en la anchura de la celda. Una celda así no contribuye a la expansión automática de la altura de la fila |
| `outlineText` | boolean |  | Dibujar el texto convertido a contornos (trazados) |
| `padding` | number |  | Relleno interior de la celda (pt). Predeterminado: 2 |
| `border` | BorderDef |  | Borde por celda (véase **`BorderDef`** en la sección de propiedades comunes). Se fusiona con el borde del `style` de la columna; gana el ajuste de la celda |
| `opacity` | number |  | Opacidad (0.0–1.0). Por debajo de 1, la celda entera se dibuja como un grupo de opacidad |

### Imprimir una tabla cruzada — `crosstab`

Agrega los datos por grupos de fila × grupos de columna. Este ejemplo suma `amount` por región × categoría y también emite subtotales y un total general.

```json
{
  "type": "crosstab",
  "x": 0, "y": 0, "width": 440, "height": 140,
  "dataSourceExpression": "field.sales",
  "rowGroups": [{ "field": "region" }],
  "columnGroups": [{ "field": "category" }],
  "measures": [
    { "field": "amount", "calculation": "sum", "format": "#,##0" }
  ],
  "rowHeaderWidth": 90,
  "cellWidth": 80,
  "cellHeight": 20,
  "showSubtotals": true,
  "showGrandTotal": true,
  "border": { "color": "#9CA3AF", "width": 0.5 }
}
```

Datos de ejemplo:

```json
{
  "rows": [
    {
      "sales": [
        { "region": "東日本", "category": "製品", "amount": 48000 },
        { "region": "東日本", "category": "保守", "amount": 8000 },
        { "region": "西日本", "category": "製品", "amount": 36000 }
      ]
    }
  ]
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | Tipo de elemento |
| `rowGroups` | { field, headerFormat? }[] | ✓ | Array de definiciones de grupos de fila. Varias entradas forman niveles de grupo anidados, y cada nivel ocupa una columna de encabezado de fila desde la izquierda. Las celdas de encabezado de los grupos exteriores se fusionan verticalmente a lo largo de su rango |
| `columnGroups` | { field, headerFormat? }[] | ✓ | Array de definiciones de grupos de columna. Los grupos exteriores se apilan arriba y los interiores debajo; los encabezados exteriores se fusionan horizontalmente a lo ancho de sus columnas |
| `measures` | { field, calculation, format? }[] | ✓ | Array de definiciones de medidas (celdas agregadas). Con varias entradas, se apilan verticalmente dentro de cada celda de datos, cada una ocupando una ranura (como mínimo `cellHeight`) y aplicando su propio `calculation`/`format`. Un array vacío se trata como una única medida implícita con `field: ''` y `calculation: 'sum'` |
| `rowHeaderWidth` | number |  | Anchura del encabezado de fila (pt), aplicada a cada nivel de los grupos de fila. Predeterminado: 80 |
| `columnHeaderHeight` | number |  | Altura del encabezado de columna (pt), aplicada a cada nivel de los grupos de columna. Predeterminado: 20 |
| `cellWidth` | number |  | Anchura de la celda de datos (pt). Predeterminado: 60 |
| `cellHeight` | number |  | Altura de la celda de datos (pt; la altura de la ranura de una medida). Se expande automáticamente con el ajuste de línea del texto. Predeterminado: 20 |
| `border` | { color?, width? } |  | Configuración de bordes (véase la tabla siguiente). Solo cuando se especifica se dibujan el marco exterior, los separadores de filas/columnas y los separadores de niveles de encabezado (nunca atraviesan una celda de encabezado exterior fusionada) |
| `showSubtotals` | boolean |  | Mostrar subtotales. Predeterminado: false. Con true, se inserta una fila/columna de subtotal etiquetada «Total» al final del bloque de cada grupo, excepto en el nivel más interno. Los valores de subtotal se reagregan a partir de los valores brutos usando el `calculation` de cada medida |
| `showGrandTotal` | boolean |  | Mostrar el total general. Predeterminado: false. Con true, se añade al final una fila/columna de total general etiquetada «Total» (no se emite cuando hay cero filas de datos). Los valores del total general también se reagregan a partir de los valores brutos |
| `dataSourceExpression` | Expression |  | Usa el array al que se evalúa la expresión como filas de datos de esta tabla cruzada. Cuando se omite (o cuando el resultado no es un array), se usan las filas de la fuente de datos principal |

**Definición de grupo de fila/columna (cada entrada de `rowGroups`/`columnGroups`)**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nombre del campo por el que agrupar. Los grupos aparecen en el orden de primera aparición en los datos |
| `headerFormat` | string |  | Formato de visualización de los valores del encabezado. Un formato simple aplicado solo cuando el valor es numérico (`'#,##0'` o cualquier cosa que contenga `,` → separadores de miles; una especificación decimal como `'.00'` → decimales fijos con esa precisión; cualquier otra cosa → conversión simple a cadena) |

**Definición de medida (cada entrada de `measures`)**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nombre del campo a agregar. Los valores no numéricos se convierten a números; los que no pueden convertirse cuentan como 0 |
| `calculation` | `'sum'` = total / `'count'` = recuento / `'average'` = promedio / `'min'` = mínimo / `'max'` = máximo | ✓ | Método de agregación. Los subtotales y totales generales también se reagregan a partir del conjunto de valores brutos con el mismo método, de modo que incluso `average` y similares salen correctos |
| `format` | string |  | Formato de visualización de los valores agregados (el mismo formato simple que `headerFormat`: `'#,##0'` o `,` → separadores de miles, `'.NN'` → NN decimales fijos, sin nada → conversión simple a cadena) |

**Configuración de bordes (`border`)**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `color` | string |  | Color de la línea. Predeterminado: `#000000` |
| `width` | number |  | Grosor de línea (pt) del marco exterior y de los límites entre encabezados y datos. Predeterminado: 0.5. Los separadores interiores de filas/columnas se dibujan a la mitad de este grosor |

### Incrustar un informe dentro de otro — `subreport`

La idea se explicó en **Fundamentos de la maquetación de informes**. Aquí hay una definición completa que funciona tal cual. El subinforme se ejecuta una vez por cada fila de detalle del padre, y el array pasado mediante `dataSourceExpression` se convierte en los `rows` del subinforme.

```json
{
  "type": "subreport",
  "x": 0, "y": 0, "width": 240, "height": 64,
  "templateExpression": "'subreport.report'",
  "dataSourceExpression": "field.items",
  "parameters": [
    { "name": "heading", "expression": "'内訳'" }
  ],
  "usingCache": true
}
```

Datos de ejemplo:

```json
{
  "rows": [
    {
      "items": [
        { "name": "部品A", "amount": 12000 },
        { "name": "部品B", "amount": 36000 }
      ]
    }
  ]
}
```

El `subreport.report` incrustado es una plantilla independiente por derecho propio. Referencia cada elemento de los `items` recibidos como valores `field.*` normales y recibe los parámetros pasados desde el padre a través de `param.*`. Tenga en cuenta que las plantillas ejecutadas como subinformes no emiten sus bandas `pageHeader`, `pageFooter` ni `background` (la gestión de páginas es tarea del informe padre). Los encabezados van en la banda `title`, así:

```json
{
  "name": "subreport",
  "page": {
    "width": 240,
    "height": 100,
    "margins": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
  },
  "parameters": [
    { "name": "heading", "type": "string" }
  ],
  "styles": [
    { "name": "body", "fontFamily": "jp", "fontSize": 9 }
  ],
  "bands": {
    "title": {
      "height": 18,
      "elements": [
        {
          "type": "textField",
          "x": 0, "y": 0, "width": 240, "height": 16,
          "expression": "param.heading",
          "style": "body"
        }
      ]
    },
    "details": [
      {
        "height": 16,
        "elements": [
          {
            "type": "textField",
            "x": 0, "y": 0, "width": 160, "height": 14,
            "expression": "field.name",
            "style": "body"
          },
          {
            "type": "textField",
            "x": 160, "y": 0, "width": 80, "height": 14,
            "expression": "field.amount",
            "pattern": "#,##0",
            "hAlign": "right",
            "style": "body"
          }
        ]
      }
    ]
  }
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | Tipo de elemento |
| `templateExpression` | Expression | ✓ | Expresión que devuelve el nombre de la plantilla hija. Al usar `createReportFromFile()` se resuelve automáticamente como ruta de archivo; al llamar directamente a `createReport()`, resuélvala con la opción `resolveSubreportTemplate` (una función que recibe el nombre y el directorio de trabajo y devuelve `{ template, workingDirectory? }`, o `null` cuando no puede resolverla) |
| `dataSourceExpression` | Expression | | Expresión que devuelve la fuente de datos del informe hijo (un array de objetos de fila). Cuando se omite, se usan tal cual las filas de la fuente de datos del padre. Un resultado que no sea un array se trata como datos vacíos |
| `parameters` | SubreportParamDef[] |  | Parámetros pasados al informe hijo (véase **`SubreportParamDef`** en la tabla siguiente). Tienen prioridad sobre las entradas homónimas de `parametersMapExpression` |
| `parametersMapExpression` | Expression | | Expresión que devuelve un objeto fusionado en los parámetros del hijo (ganan los `parameters` individuales) |
| `returnValues` | ReturnValueDef[] |  | Definiciones que devuelven valores de variables del informe hijo al padre (véase **`ReturnValueDef`** en la tabla siguiente) |
| `usingCache` | boolean | | Dentro de una ejecución del informe padre, almacenar en caché y reutilizar las plantillas hijas resueltas por nombre de plantilla |
| `runToBottom` | boolean | | Tras el contenido del subinforme, consumir el espacio restante de la página/columna (empujando los elementos posteriores por debajo del espacio restante) |

**`SubreportParamDef`** (cada entrada de `parameters` = un parámetro pasado al informe hijo)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nombre del parámetro pasado al informe hijo (referenciado en el lado hijo como `param.name`) |
| `expression` | Expression | ✓ | Expresión que calcula el valor del parámetro. Se evalúa en el contexto del informe padre |

**`ReturnValueDef`** (cada entrada de `returnValues` = una definición que devuelve un valor del hijo al padre)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nombre de la variable que recibe el valor en el lado del padre. Esta variable queda excluida de ser sobrescrita por el cálculo normal de variables del padre |
| `subreportVariable` | string | ✓ | Nombre de la variable de origen en el lado hijo. Cuando el informe hijo termina de ejecutarse, su valor se propaga al padre |
| `calculation` | `'nothing'` = asignar el valor del hijo tal cual (sobrescrito en cada ejecución) / `'count'` = recuento / `'sum'` = total / `'average'` = promedio / `'min'` = mínimo / `'max'` = máximo / `'first'` = conservar el primer valor obtenido | ✓ | Cómo se incorpora el valor a la variable del padre. Todo lo que no sea `'nothing'` agrega entre ejecuciones cuando el subinforme se ejecuta varias veces |

### Imprimir códigos de barras y códigos QR — `barcode`

`barcodeType` acepta Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code (`qrcode`), Data Matrix, PDF417 y más. `showText` añade el texto legible por humanos como referencia de escaneo.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

Datos de ejemplo:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | Tipo de elemento |
| `barcodeType` | string | ✓ | Simbología del código de barras (sin distinguir mayúsculas). Valores permitidos: `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. Cualquier otro valor no está admitido y dibuja un marcador de posición |
| `expression` | Expression | ✓ | Expresión que devuelve los datos del código de barras (el resultado de la evaluación se convierte a cadena y se codifica) |
| `showText` | boolean | | Mostrar el texto legible por humanos bajo los códigos de barras unidimensionales (altura del área de texto 10pt, tamaño de fuente 8pt; la altura de las barras se reduce en esa cantidad). No se usa en códigos bidimensionales (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | Nivel de corrección de errores del código QR: la capacidad de seguir siendo legible incluso cuando parte del código está manchada o falta. La resistencia aumenta de `'L'` a `'H'`, a costa de un patrón más fino. Se recomienda `'Q'` o `'H'` para soportes de impresión de baja calidad. Predeterminado: `'M'`. Efectivo solo para códigos QR (el nivel de corrección de errores de PDF417 se selecciona automáticamente según la longitud de los datos) |

### Imprimir fórmulas matemáticas — `math`

Compone fórmulas de estilo LaTeX. La composición matemática requiere una fuente dedicada que lleve métricas específicas para matemáticas (la tabla MATH de OpenType); ejemplos disponibles libremente son STIX Two Math y Latin Modern Math. Una fuente de texto normal no puede sustituirla. `formula` se evalúa como una expresión (este ejemplo referencia el campo `formula` de los datos).

```json
{
  "type": "math",
  "x": 0, "y": 0, "width": 220, "height": 60,
  "formula": "field.formula",
  "mathFontFamily": "math",
  "fontSize": 18,
  "color": "#111827"
}
```

Datos de ejemplo:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

Al usar el elemento `math`, registre una fuente que tenga una tabla MATH de OpenType tanto en `fontMap` como en los `fonts` de la salida PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | Tipo de elemento |
| `formula` | Expression | ✓ | Expresión que devuelve una cadena de fórmula LaTeX (envuelva una fórmula fija en `'...'` como literal de cadena dentro de la expresión). No se dibuja nada cuando el resultado es una cadena vacía |
| `mathFontFamily` | string | | Fuente usada para el renderizado matemático (un ID de fuente registrado en fontMap). Predeterminado: el fontFamily del estilo del elemento, o `'default'` si también falta |
| `fontSize` | number | | Tamaño de fuente (pt). Predeterminado: el fontSize del estilo del elemento, o 12 si también falta |
| `color` | string | | Color del texto. Predeterminado: se resuelve en orden — el forecolor del elemento → el forecolor del estilo → `#000000` |

### Imprimir SVG — `svg`

Renderiza un documento SVG directamente en el informe. `svgContent` se evalúa como una expresión (una cadena SVG fija puede suministrarse mediante datos o parámetros).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

Datos de ejemplo:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | Tipo de elemento |
| `svgContent` | Expression | ✓ | Expresión que devuelve una cadena de marcado SVG. El resultado se convierte a cadena y se renderiza como SVG en la posición y con el tamaño del elemento |

### Crear formularios PDF rellenables — `formField`

Coloca campos de formulario que quien abra el PDF puede rellenar. `fieldType` acepta `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox` y `signature`.

```json
{
  "type": "formField",
  "fieldType": "text",
  "fieldName": "contactName",
  "x": 0, "y": 0, "width": 180, "height": 24,
  "value": "field.contact",
  "style": "body",
  "borderColor": "#777777",
  "backgroundColor": "#FFFFFF"
}
```

Datos de ejemplo (se convierten en el valor inicial del formulario):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | Tipo de elemento. Un campo de formulario interactivo. Los backends de previsualización dibujan su apariencia inicial, y la salida PDF lo emite como un campo genuinamente rellenable |
| `fieldType` | `'text'` = campo de entrada de texto (PDF /Tx) / `'checkbox'` = casilla de verificación (/Btn) / `'radio'` = botón de opción (/Btn; los widgets que comparten el mismo `fieldName` forman un grupo mutuamente excluyente) / `'pushbutton'` = botón (/Btn; leyenda más acción URI opcional) / `'dropdown'` = desplegable (combo box, /Ch) / `'listbox'` = cuadro de lista (/Ch) / `'signature'` = campo de firma (/Sig) | ✓ | Tipo de campo |
| `fieldName` | string | ✓ | Nombre de campo completamente cualificado. Debe ser único dentro del documento (los duplicados lanzan una excepción). La excepción es `radio`, donde compartir el mismo nombre forma un grupo mutuamente excluyente |
| `value` | Expression |  | Valor inicial (text: el valor introducido; dropdown/listbox: el valor seleccionado; para un listbox con `multiSelect`, especifique varios valores separados por saltos de línea). Se evalúa como una expresión. Combinarlo con `valueStream` lanza una excepción |
| `checked` | Expression |  | Estado inicial de marcado (checkbox/radio). Se evalúa como una expresión. En los radios, el `exportValue` del botón marcado se convierte en el valor seleccionado del grupo |
| `exportValue` | string |  | La cadena registrada como el valor que significa que esta casilla/radio está «activada» cuando la entrada del formulario se envía o se extrae (checkbox/radio). Predeterminado: `'Yes'`. En un grupo de radios, este valor distingue las opciones individuales |
| `options` | FormFieldOption[] |  | Array de opciones (dropdown/listbox). Véase la tabla siguiente |
| `editable` | boolean |  | Permitir entrada libre además de las opciones (hace que un desplegable acepte escritura al estilo combo) |
| `multiSelect` | boolean |  | Permitir selección múltiple (listbox) |
| `caption` | string |  | Leyenda del botón (pushbutton) |
| `action` | string |  | URI abierta cuando se pulsa el pushbutton |
| `multiline` | boolean |  | Entrada multilínea (text) |
| `readOnly` | boolean |  | Hacer el campo de solo lectura |
| `required` | boolean |  | Hacer el campo obligatorio |
| `noExport` | boolean |  | No exportar el valor de este campo al enviar el formulario |
| `password` | boolean |  | Entrada de contraseña (text; los caracteres escritos se enmascaran) |
| `fileSelect` | boolean |  | Convertirlo en un campo de selección de archivo (text). Combinarlo con `multiline`/`password` lanza una excepción |
| `doNotSpellCheck` | boolean |  | Desactivar la corrección ortográfica (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | No permitir el desplazamiento cuando la entrada supera el área visible (text) |
| `comb` | boolean |  | Mostrar como casillas de caracteres espaciadas uniformemente (comb) (text). Debe especificarse `maxLength`; combinarlo con `multiline`/`password`/`fileSelect` lanza una excepción |
| `richText` | string |  | Valor de texto enriquecido (PDF /RV) mostrado con formato (negritas, colores, etc.) en los visores compatibles. Establecerlo activa la bandera de texto enriquecido del campo. Combinarlo con `richTextStream` lanza una excepción |
| `richTextStream` | Uint8Array |  | Forma de stream de `richText`. Para la preservación a nivel de bytes cuando el /RV del PDF de origen era un stream durante la importación de PDF; las plantillas escritas a mano usan normalmente `richText`. Combinarlo con `richText` lanza una excepción |
| `defaultStyle` | string |  | Estilo predeterminado para el texto enriquecido (PDF /DS). Una cadena de formato similar a CSS (p. ej., `font: Helvetica 12pt`) que proporciona los valores predeterminados para lo que `richText` no especifique |
| `valueStream` | Uint8Array |  | Para preservación en la importación de PDF. Cuando el valor del campo del PDF de origen (/V) era un objeto stream en lugar de una cadena, vuelve a emitir esos bytes sin pérdida. Las plantillas escritas a mano usan normalmente `value`. Combinarlo con `value` lanza una excepción |
| `defaultValue` | string |  | Valor predeterminado al que vuelve el campo al restablecer el formulario (/DV) |
| `sort` | boolean |  | Mostrar las opciones ordenadas (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | Confirmar el valor inmediatamente cuando cambia la selección (dropdown/listbox) |
| `radiosInUnison` | boolean |  | Activar y desactivar al unísono los botones de opción de un grupo que comparten el mismo `exportValue` |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | Adjunta al campo scripts de entrada que se ejecutan en los visores de PDF. K = en cada pulsación de tecla (p. ej., eliminar los no dígitos), F = formato de visualización (p. ej., mostrar dos decimales), V = validación del valor (p. ej., rechazar números negativos), C = recálculo (p. ej., calcular automáticamente a partir de los valores de otros campos). El contenido es normalmente un `PdfActionDef` (descrito más adelante) con `subtype: 'JavaScript'`. El motor central solo incrusta los scripts en el PDF y nunca los ejecuta. En un grupo de radios, todos los widgets deben llevar definiciones idénticas o se lanza una excepción |
| `calculationOrder` | number |  | Cuando varios campos tienen una acción `'C'` (recálculo), el orden en que el visor los recalcula (PDF /CO). Orden ascendente de enteros ≥ 0. Los duplicados, los valores negativos y los no enteros lanzan una excepción |
| `maxLength` | number |  | Longitud máxima de entrada (text) |
| `borderColor` | string |  | Color del borde (`#RRGGBB`). Sin borde cuando se omite. Se dibuja como un contorno de 1pt: circular para los radios, rectangular en los demás casos |
| `backgroundColor` | string |  | Color de fondo (`#RRGGBB`). Transparente cuando se omite. Se rellena como un círculo para los radios y un rectángulo en los demás casos |

**`FormFieldOption`** (cada entrada de `options` = una definición de opción)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `value` | string | ✓ | Valor de exportación almacenado en el valor del campo (/V) |
| `label` | string |  | Etiqueta mostrada. Predeterminado: igual que `value` |

Nota: además, pueden especificarse todas las propiedades comunes a los elementos y todas las propiedades de `TextProperties` (aplicadas a la fuente, la alineación, etc. del texto introducido).

### Forzar un salto de página o de columna en cualquier punto — `break`

Fuerza el paso a la página siguiente (`"breakType": "page"`) o a la columna siguiente (`"column"`) en medio del flujo de detalle. Colóquelo directamente en una banda; no puede ir dentro de un `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**Lista de propiedades**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | Tipo de elemento |
| `breakType` | `'page'` \| `'column'` | ✓ | Tipo de salto. Divide la banda en la posición y del elemento; `'page'` = continuar en la página siguiente / `'column'` = continuar en la columna siguiente cuando la maquetación es multicolumna (`columns.count` de la plantilla de 2 o más; véase **Fundamentos de la maquetación de informes**) y esta no es la última columna (en caso contrario actúa como salto de página) |

### Imprimir un elemento solo cuando se cumple una condición — `printWhenExpression`

`printWhenExpression` no es un tipo de elemento distinto, sino **un atributo común a todos los elementos**. El elemento se imprime solo en las filas donde la expresión se evalúa como verdadera. El siguiente ejemplo imprime «※ 至急» (urgente) solo en las filas de detalle donde `urgent` es `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

Datos de ejemplo (se imprime solo para la primera fila):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

Las bandas también aceptan un `printWhenExpression` homónimo, que suprime la salida de la banda entera (p. ej., emitir una banda de observaciones solo cuando `param.showNotes` está establecido). Cuando la plantilla está definida en TypeScript, el callback `onBeforeRender` del elemento ofrece un control aún más fino: devuelva `null` para omitir la impresión del elemento, o devuelva un `ElementDef` para imprimir con atributos como el texto, las dimensiones y los colores sobrescritos en el momento.
## Referencia de propiedades de los elementos

La «Lista de propiedades» adjunta al ejemplo de cada elemento cubre solo las propiedades específicas de ese elemento. Además, todos los elementos aceptan propiedades comunes de posición, tamaño, condiciones de impresión, colores y más. Esta sección resume las propiedades comunes a todos los elementos y las propiedades de los estilos definidos en los `styles` de la plantilla.

### Propiedades comunes a todos los elementos

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `id` | string |  | Identificador para buscar y modificar un elemento antes del renderizado con `findElementById()`. No afecta al contenido impreso en sí. Mantenga únicos dentro de la plantilla los ID usados como objetivos de modificación (si hay duplicados, se devuelve el primer elemento en el orden de búsqueda) |
| `x` | number | ✓ | Coordenada X dentro de la banda/contenedor padre (pt) |
| `y` | number | ✓ | Coordenada Y dentro de la banda/contenedor padre (pt) |
| `width` | number | ✓ | Anchura (pt) |
| `height` | number | ✓ | Altura (pt) |
| `style` | string |  | Nombre del estilo a aplicar (referencia el `name` de un `StyleDef` definido en `styles`; si no se especifica, se aplica el estilo `isDefault`) |
| `positionType` | `'float'` = se desplaza hacia abajo la cantidad que se hayan estirado los elementos superiores / `'fixRelativeToTop'` = fija la posición desde el borde superior de la banda (predeterminado) / `'fixRelativeToBottom'` = mantiene la distancia al borde inferior de la banda (se desplaza hacia abajo la cantidad de estiramiento de la banda) |  | Regla de posicionamiento cuando la banda se estira. Predeterminado: `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = no se estira (predeterminado) / `'containerHeight'` = hace que la altura del elemento coincida con la altura efectiva de la banda / `'containerBottom'` = estira el borde inferior del elemento hasta el fondo efectivo de la banda (cambia solo la altura) |  | Regla de estiramiento del elemento cuando la banda se estira. Predeterminado: `noStretch` |
| `printWhenExpression` | Expression \| null |  | Cuando el resultado de la evaluación es falsy, este elemento no se imprime |
| `onBeforeRender` | OnBeforeRenderCallback |  | Callback invocado inmediatamente antes del renderizado: `(elem, field, vars, param, report) => ElementDef \| null`. Devolver `null` omite la impresión (un superconjunto de `printWhenExpression`); devolver un `ElementDef` renderiza con esa definición (sobrescribiendo dinámicamente cualquier atributo). Orden de evaluación: `onBeforeRender` → `printWhenExpression` (evaluado contra la definición sobrescrita) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | Cuando el elemento no se imprime, si ningún otro elemento impreso se superpone a la franja vertical que ocupa el elemento, elimina esa franja y sube los elementos inferiores, encogiendo la banda |
| `isPrintRepeatedValues` | boolean |  | Cuando se establece en `false`, se suprime la impresión cuando el valor (textField) es igual al anterior (mientras está suprimido, el elemento se trata como de altura 0 si `isRemoveLineWhenBlank` es verdadero) |
| `isPrintWhenDetailOverflows` | boolean |  | Vuelve a imprimir este elemento en cada segmento de página/columna al que desborde la banda |
| `mode` | `'opaque'` = rellena el fondo con `backcolor` / `'transparent'` = no rellena el fondo |  | Modo de visualización. Predeterminado: `transparent` (se resuelve primero en el elemento y luego en el estilo) |
| `forecolor` | string |  | Color de primer plano (`#RRGGBB` o `#RRGGBBAA`) |
| `backcolor` | string |  | Color de fondo (se dibuja cuando `mode` es `opaque`) |
| `border` | BorderDef |  | Borde (véase **`BorderDef`** más abajo). En los elementos line/rectangle/ellipse/path el borde no se dibuja (tanto si proviene de un estilo como si se especifica directamente en el elemento; estos elementos especifican las líneas mediante su propio `stroke` y propiedades similares) |
| `padding` | Padding |  | Relleno interior (véase **`Padding`** más abajo) |
| `blendMode` | BlendModeDef |  | Cómo se componen los colores de este elemento con el contenido ya dibujado debajo (véase **`BlendModeDef`** más abajo). Ejemplo típico: especificar `'multiply'` en una imagen de sello o timbre la superpone de forma translúcida sin ocultar el texto de debajo |
| `overprintFill` | boolean |  | Para la preimpresión de imprenta comercial. Especifica la sobreimpresión para los rellenos (las caras del texto y las formas): se imprimen encima de las planchas de color subyacentes sin calarlas |
| `overprintStroke` | boolean |  | Para la preimpresión de imprenta comercial. Ajuste de sobreimpresión para las líneas (trazos) |
| `overprintMode` | 0 \| 1 |  | Selecciona el comportamiento cuando `overprintFill`/`overprintStroke` están activados (PDF /OPM). `0` = cada componente de color sobrescribe el color subyacente (predeterminado) / `1` = los componentes de color con valor 0 dejan intacto el color subyacente |
| `renderingIntent` | `'AbsoluteColorimetric'` = colorimétricamente fiel / `'RelativeColorimetric'` = fiel tras igualar los puntos blancos / `'Saturation'` = prioriza la viveza / `'Perceptual'` = prioriza una apariencia natural |  | Política de prioridad para convertir los colores que no caben en la gama del dispositivo de salida (intención de renderizado del PDF). Pensada para la imprenta comercial y la gestión del color; normalmente no hace falta especificarla |
| `alphaIsShape` | boolean |  | Control fino de la composición de transparencia del PDF (interpreta la opacidad y las máscaras como «forma»; /AIS). Normalmente no hace falta especificarlo; se usa principalmente para la reemisión fiel de PDF importados |
| `textKnockout` | boolean |  | Cuando se superponen caracteres translúcidos, evita componer dos veces los solapamientos dentro del mismo texto (PDF /TK). Predeterminado: `true`. Normalmente no hace falta especificarlo |
| `optionalContent` | OptionalContentDef |  | Coloca este elemento en una «capa» del PDF. La visibilidad y la impresión pueden alternarse desde el panel de capas del visor (p. ej., mostrar una marca de agua en pantalla pero quitarla al imprimir). Véase **`OptionalContentDef`** más abajo |
| `opacity` | number |  | Opacidad del elemento (0.0–1.0). En los elementos con hijos, se aplica tras componerlos como grupo |

**`BlendModeDef`** (modos de fusión que pueden especificarse en `blendMode`)

Los elementos pintan normalmente sobre lo que ya está dibujado debajo (`'normal'`). Especificar un modo de fusión combina computacionalmente los colores superior e inferior. En los documentos de negocio, los usos típicos son superponer un sello personal o de empresa sobre el texto (`'multiply'`) y producir un efecto tipo calado en blanco sobre un fondo oscuro (`'screen'`).

| Constante | Efecto |
| --- | --- |
| `'normal'` | Pinta con el color superior sin fusionar (equivalente al predeterminado) |
| `'multiply'` | Multiplicar. Los solapamientos siempre se oscurecen. Para sellos, timbres y superposiciones tipo marcador fluorescente |
| `'screen'` | Multiplicación inversa. Los solapamientos siempre se aclaran |
| `'overlay'` | Multiplica donde la base es oscura y aplica screen donde es clara. Acentúa el contraste |
| `'darken'` | Toma el más oscuro de los dos colores |
| `'lighten'` | Toma el más claro de los dos colores |
| `'color-dodge'` | Aclara (quema en claro) la base según el color superior |
| `'color-burn'` | Oscurece la base según el color superior |
| `'hard-light'` | Alterna entre multiplicar y multiplicación inversa según la luminosidad del color superior (efecto de iluminación fuerte) |
| `'soft-light'` | Una versión más suave de `'hard-light'` (efecto de iluminación suave) |
| `'difference'` | Valor absoluto de la diferencia entre los dos colores |
| `'exclusion'` | Una versión de menor contraste de `'difference'` |
| `'hue'` | Tono superior + saturación y luminosidad inferiores |
| `'saturation'` | Saturación superior + tono y luminosidad inferiores |
| `'color'` | Tono y saturación superiores + luminosidad inferior (para teñir una base monocroma) |
| `'luminosity'` | Luminosidad superior + tono y saturación inferiores |

**`Expression`** (véanse los detalles en «Dominar las expresiones»)
| Forma | Descripción |
| --- | --- |
| string | Minilenguaje de expresiones. Ejemplos: `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | Una función TypeScript `(field, vars, param, report) => unknown`. `report` (ReportContext) proporciona `PAGE_NUMBER` (número de página actual, base 1), `COLUMN_NUMBER` (número de columna actual, base 1), `REPORT_COUNT` (número de registros procesados), `TOTAL_PAGES` (total de páginas; definitivo con evaluationTime=report), `RETURN_VALUE` (presente en la definición de tipos pero siempre undefined en la implementación actual — los valores de retorno de los subinformes se reciben mediante `vars.*`), `format` (funciones de formato incorporadas) y `formatters` (formateadores personalizados registrados en la plantilla) |

**`BorderDef`**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `width` | number |  | Grosor de línea (pt). Valor predeterminado compartido por todos los lados |
| `color` | string |  | Color de línea. Valor predeterminado compartido por todos los lados |
| `style` | `'solid'` = línea continua / `'dashed'` = línea discontinua / `'dotted'` = línea punteada |  | Estilo de línea. Valor predeterminado compartido por todos los lados |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | Ajustes por lado (véase **`BorderSideDef`** más abajo). Tienen prioridad sobre los ajustes de todos los lados; `null` oculta ese lado |

**`BorderSideDef`** (usado en `top`/`bottom`/`left`/`right` de `BorderDef`)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `width` | number | ✓ | Grosor de línea (pt) |
| `color` | string | ✓ | Color de línea |
| `style` | `'solid'` = línea continua / `'dashed'` = línea discontinua / `'dotted'` = línea punteada | ✓ | Estilo de línea |

**`Padding`**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | Relleno interior de cada lado (pt) |

**`HyperlinkDef`**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'reference'` = URL externa / `'localAnchor'` = a un ancla dentro del mismo documento / `'localPage'` = a un número de página dentro del mismo documento / `'remoteAnchor'` = a un ancla de otro documento PDF / `'remotePage'` = a una página de otro documento PDF | ✓ | Tipo de enlace |
| `target` | Expression | ✓ | Destino del enlace (una URL, un nombre de ancla o una expresión de número de página) |
| `remoteDocument` | Expression |  | Ruta del archivo PDF remoto (para remotePage / remoteAnchor) |

**`TextProperties`** (propiedades de texto y párrafo de staticText / textField / formField)
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `markup` | `'none'` = texto plano / `'styled'` = marcado con estilos (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>`, etc.) / `'html'` = subconjunto de HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | Tipo de marcado |
| `hAlign` | `'left'` = alineado a la izquierda / `'center'` = centrado / `'right'` = alineado a la derecha / `'justify'` = justificado |  | Alineación horizontal |
| `vAlign` | `'top'` = alineado arriba / `'middle'` = alineado al centro / `'bottom'` = alineado abajo |  | Alineación vertical |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotación del texto (grados) |
| `lineSpacing` | LineSpacingDef |  | Configuración del interlineado (véase **`LineSpacingDef`** más abajo) |
| `letterSpacing` | number |  | Espaciado entre caracteres (pt). Añade una cantidad fija entre todos los caracteres (los valores negativos los aprietan) |
| `tracking` | number |  | Otro tipo de ajuste del espaciado entre caracteres. Mientras que `letterSpacing` añade una cantidad fija uniforme, este usa la tabla de ajuste de espaciado integrada en la propia fuente (la tabla AAT `trak`) para apretar o ensanchar el espaciado con valores de diseño que dependen del tamaño de fuente. El número es el «valor de track» de la tabla: 0 = normal, negativo = más apretado, positivo = más ancho (los valores intermedios se interpolan). Sin efecto en fuentes sin tabla `trak` |
| `wordSpacing` | number |  | Espaciado entre palabras (pt; anchura extra añadida a los caracteres de espacio) |
| `horizontalScale` | number |  | Factor de escala que estira las formas de los glifos horizontalmente (menos de 1 = condensado, estrechando la anchura; más de 1 = expandido, ensanchándola). El ajuste de línea y el avance de línea se calculan a partir de las anchuras escaladas. Predeterminado: 1 |
| `baselineOffset` | number |  | Establece explícitamente la posición de la línea base (la línea de referencia sobre la que se asientan los caracteres) en pt desde el borde superior del elemento. Normalmente se calcula automáticamente, así que no hace falta especificarla (la establece principalmente la importación de PDF para reproducir las posiciones originales del texto) |
| `firstLineIndent` | number |  | Sangría de primera línea (pt) |
| `leftIndent` | number |  | Sangría izquierda (pt) |
| `rightIndent` | number |  | Sangría derecha (pt) |
| `padding` | Padding |  | Relleno interior |
| `direction` | `'ltr'` = de izquierda a derecha / `'rtl'` = de derecha a izquierda / `'auto'` = detectada automáticamente a partir del contenido (análisis de texto bidireccional) |  | Dirección del texto |
| `openTypeScript` | string |  | Etiqueta OpenType que especifica las reglas de qué sistema de escritura de la fuente se usan al convertir el texto en formas de glifo (shaping) (p. ej., `'latn'` = escritura latina, `'arab'` = escritura árabe). Normalmente no hace falta especificarla (se gestiona automáticamente a partir del contenido del texto) |
| `openTypeLanguage` | string |  | Etiqueta OpenType que hace explícito el idioma para las fuentes que varían las formas de los glifos según el idioma dentro de un mismo sistema de escritura. Normalmente no hace falta especificarla |
| `openTypeFeatures` | Record<string, number> |  | Activa o desactiva las características de conmutación de glifos integradas en la fuente. Ejemplos: `{ "palt": 1 }` = apretar el espaciado japonés, `{ "liga": 0 }` = desactivar las ligaduras, `{ "zero": 1 }` = cero barrado. Valores: 0 = desactivado / 1 = activado; para las características de selección de glifos, un número de glifo alternativo de base 1 |
| `shrinkToFit` | boolean |  | Reducción automática: disminuye el tamaño de fuente para que el texto quepa en la anchura y la altura del elemento |
| `minFontSize` | number |  | Tamaño de fuente mínimo (pt) para `shrinkToFit`. Predeterminado: 4 |
| `fitWidth` | boolean |  | Ajusta automáticamente el tamaño de fuente para que la línea más larga quepa exactamente en la anchura de contenido del elemento (en ambos sentidos, reduciendo y ampliando) |
| `outlineText` | boolean |  | Convierte el texto a contornos (trazados). Predeterminado: `false` |
| `pdfFontMode` | `'embedded'` = incrusta el programa de la fuente / `'reference'` = emite una referencia a una fuente del sistema sin incrustar |  | Cómo se gestiona el programa de la fuente en el PDF |
| `textPaintMode` | `'fill'` = relleno / `'stroke'` = solo contorno / `'fillStroke'` = relleno + contorno |  | Semántica de pintado del texto preservada en la importación de PDF. Predeterminado: `fill` |
| `textStrokeColor` | string |  | Color del trazo para stroke / fillStroke |
| `textStrokeWidth` | number |  | Grosor del trazo del contorno del texto (pt) |
| `tabStops` | TabStopDef[] |  | Definiciones de tabulaciones (véase **`TabStopDef`** más abajo) |
| `tabStopWidth` | number |  | Intervalo de tabulación predeterminado (pt). 40pt si no se especifica |
| `wrap` | boolean |  | Ajuste de línea del texto. Predeterminado: `true` (undefined significa que el ajuste está activado) |

**`LineSpacingDef`**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'single'` = línea sencilla / `'1.5'` = 1,5 líneas / `'double'` = doble / `'proportional'` = proporción / `'fixed'` = valor fijo / `'minimum'` = valor mínimo | ✓ | Tipo de interlineado |
| `value` | number |  | Valor para fixed / minimum / proportional |

**`TabStopDef`**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `position` | number | ✓ | Posición de la tabulación (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | Alineación de la tabulación. Predeterminado: `left` |

**`FillDef`** (la unión de tipos aceptados por el relleno (`fill`) y el trazo (`stroke`) de `path` y por el relleno (`fill`) de `rectangle`/`ellipse`. El `stroke` de `rectangle`/`ellipse` solo acepta una cadena de color sólido)
| Forma | Descripción |
| --- | --- |
| string | Color sólido (`#RRGGBB` o `#RRGGBBAA`) |
| PdfSpecialColorDef | Color especial (Separation/DeviceN). Especificación de color para tintas particulares como el oro, la plata o los colores corporativos (véase la tabla más abajo) |
| LinearGradientDef | Degradado lineal: los colores cambian a lo largo de un eje que une dos puntos (véase la tabla más abajo) |
| RadialGradientDef | Degradado radial: los colores cambian hacia fuera desde un centro (véase la tabla más abajo) |
| MeshGradientDef | Degradado de malla: los colores cambian siguiendo formas libres (véase la tabla más abajo) |
| TilingPatternDef | Patrón de mosaico: rellena repitiendo en mosaico un pequeño motivo (véase la tabla más abajo) |
| FunctionShadingDef | Sombreado por función: los colores se calculan a partir de las coordenadas mediante una fórmula (véase la tabla más abajo) |

**`GradientStopDef`** (paradas de color de un degradado; se usa en los `stops` de cada degradado)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `offset` | number | ✓ | Posición a lo largo del eje del degradado, como proporción de 0 a 1 (0 = punto inicial, 1 = punto final) |
| `color` | string | ✓ | Color en esta posición (`#RRGGBB`) |
| `opacity` | number |  | Opacidad en esta posición (0–1). Predeterminado: 1 |

**`LinearGradientDef`** (degradado lineal: un relleno cuyos colores cambian a lo largo de un eje que une dos puntos)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | Discriminador que indica un degradado lineal |
| `x1` | number |  | Coordenada X del punto inicial, **como proporción de la anchura del cuadro delimitador del elemento** (0 = borde izquierdo, 1 = borde derecho). Predeterminado: 0 |
| `y1` | number |  | Coordenada Y del punto inicial, **como proporción de la altura del cuadro delimitador del elemento** (0 = borde superior, 1 = borde inferior). Predeterminado: 0 |
| `x2` | number |  | Coordenada X del punto final (proporción de la anchura). Predeterminado: 1 (con los valores predeterminados sin cambios, un degradado horizontal de izquierda a derecha) |
| `y2` | number |  | Coordenada Y del punto final (proporción de la altura). Predeterminado: 0 |
| `stops` | GradientStopDef[] | ✓ | Matriz de paradas de color (véase la tabla anterior) |
| `spreadMethod` | `'pad'` = rellena con los colores de los extremos / `'reflect'` = repite reflejando en espejo / `'repeat'` = repite tal cual |  | Cómo pintar fuera del rango del degradado. Predeterminado: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadatos de preservación para volver a emitir sin pérdidas un degradado de un PDF importado. No hace falta especificarlo en plantillas escritas a mano |

**`RadialGradientDef`** (degradado radial: un relleno cuyos colores cambian hacia fuera desde un centro)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | Discriminador que indica un degradado radial |
| `cx` | number |  | Coordenada X del centro del círculo exterior (proporción de la anchura del cuadro delimitador del elemento). Predeterminado: 0.5 |
| `cy` | number |  | Coordenada Y del centro del círculo exterior (proporción de la altura). Predeterminado: 0.5 |
| `r` | number |  | Radio del círculo exterior, **como proporción del mayor entre la anchura y la altura**. Predeterminado: 0.5 |
| `fx` | number |  | Coordenada X del punto focal (donde empieza el degradado) (proporción de la anchura). Predeterminado: `cx` |
| `fy` | number |  | Coordenada Y del punto focal (proporción de la altura). Predeterminado: `cy` |
| `fr` | number |  | Radio del círculo focal (proporción del mayor entre la anchura y la altura). Predeterminado: 0 |
| `stops` | GradientStopDef[] | ✓ | Matriz de paradas de color |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | Cómo pintar fuera del rango (igual que en `LinearGradientDef`). Predeterminado: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadatos para la reemisión sin pérdidas de una importación de PDF. No hace falta especificarlo en plantillas escritas a mano |

**`MeshGradientDef`** (degradado de malla: un relleno que asigna colores a los vértices de retículas o triángulos y varía los colores siguiendo formas libres)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | Discriminador que indica un degradado de malla |
| `patches` | MeshPatchDef[] |  | Matriz de parches de superficie. Cada parche tiene `points` (una malla de puntos de control de 4×4 expresada como 32 números en orden x,y; **las coordenadas son pt locales del elemento**) y `colors` (los colores de las 4 esquinas) |
| `triangles` | MeshTriangleDef[] |  | Matriz de triángulos de degradado. Cada triángulo tiene `points` (x0,y0,x1,y1,x2,y2; pt locales del elemento) y `colors` (los colores de los 3 vértices); los colores se interpolan entre los vértices |
| `lattice` | MeshLatticeDef |  | Malla en forma de retícula. Tiene `columns` (número de vértices por fila, 2 o más), `points` (secuencia de coordenadas de los vértices; pt locales del elemento) y `colors` (un color por vértice, en el mismo orden que `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | Representación compacta de datos de malla nativos importados de un PDF. No hace falta especificarlo en plantillas escritas a mano |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | Igual que lo anterior, para los triángulos de degradado |
| `pdfShading` | PdfMeshShadingDef |  | Metadatos para la reemisión sin pérdidas de una importación de PDF. No hace falta especificarlo en plantillas escritas a mano |

**`TilingPatternDef`** (patrón de mosaico: rellena repitiendo en mosaico un pequeño motivo; para tramados, tableros de ajedrez, logotipos repetidos y similares)

El «espacio del patrón» en la tabla es el sistema de coordenadas propio del patrón. Si no se especifica `matrix`, coincide con las coordenadas en pt locales del elemento.

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | Discriminador que indica un patrón de mosaico |
| `bbox` | [number, number, number, number] | ✓ | Cuadro delimitador de un motivo (la celda del patrón), en coordenadas del espacio del patrón |
| `xStep` | number | ✓ | Intervalo de repetición horizontal de la celda (espacio del patrón) |
| `yStep` | number | ✓ | Intervalo de repetición vertical de la celda (espacio del patrón) |
| `graphics` | TileGraphicDef[] | ✓ | Matriz de gráficos dibujados dentro de la celda, discriminados por `kind`: `'path'` (datos de trazado SVG + relleno/trazo) / `'image'` (referencia el ID de un recurso de imagen mediante `source`) / `'text'` (texto con fuente, tamaño y color) / `'group'` (grupo anidado con transformación, recorte, opacidad, etc.). Todas las coordenadas están en el espacio del patrón |
| `tilingType` | 1 = espaciado constante (las celdas pueden distorsionarse ligeramente para adaptarse al dispositivo de salida) \| 2 = sin distorsión (el espaciado puede variar ligeramente) \| 3 = espaciado constante con mosaico rápido |  | Modo de precisión del mosaico. Predeterminado: 1 |
| `paintType` | `'colored'` = el patrón lleva sus propios colores / `'uncolored'` = se tiñe de un solo color con el `color` del consumidor |  | Cómo se transporta el color. Predeterminado: `'colored'` |
| `color` | string |  | Color de tinte al usar un patrón `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | Matriz de transformación afín del espacio del patrón al espacio local del elemento. Predeterminado: matriz identidad |

**`FunctionShadingDef`** (sombreado por función: un relleno cuyo color se calcula mediante una fórmula a partir de las coordenadas (x, y); aparece principalmente en la importación de PDF)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | Discriminador que indica un sombreado por función. Hay dos variantes: una forma de fórmula con `expression` y una forma muestreada con `sampled` |
| `domain` | [number, number, number, number] | ✓ | Dominio de entrada `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (solo en la forma de fórmula) | Expresión de calculadora PostScript (PDF FunctionType 4). Toma x, y y devuelve r, g, b. Ejemplo: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (solo en la forma muestreada) | Datos de función muestreada (PDF FunctionType 0). Tiene `size` (dimensiones de la retícula de muestras), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (rango de salida), `samples` (valores de muestra por punto de la retícula) y opcionalmente `encode`/`decode` |
| `matrix` | [number, number, number, number, number, number] |  | Matriz de correspondencia del dominio de entrada a **pt locales del elemento**. Predeterminado: matriz identidad |
| `background` | [number, number, number] |  | Color de fondo fuera del dominio (componentes DeviceRGB, 0–1) |
| `bbox` | [number, number, number, number] |  | Cuadro delimitador que limita el pintado |
| `antiAlias` | boolean |  | Sugerencia de suavizado de bordes |
| `paintOperator` | `'pattern'` = pintado como patrón (predeterminado) / `'sh'` = dibujado directamente bajo el recorte actual |  | Método de pintado para la salida PDF |

**`PdfSpecialColorDef`** (relleno de color especial: especificación de color para imprimir con tintas particulares, como el oro, la plata o los colores corporativos, que la mezcla CMYK ordinaria no puede reproducir)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | Discriminador que indica un relleno de color especial |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | El espacio de color del color especial. Una sola tinta usa `kind: 'separation'` con `name` (nombre de la tinta), `alternate` (el espacio de color de proceso que se usa en su lugar en entornos sin la tinta especial; véase la tabla más abajo) y `tintTransform` (especifica la conversión del tinte al color alternativo como una función PDF, p. ej. `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = blanco con tinte 0 y azul con 1). Varias tintas usan `kind: 'deviceN'` con `names` (matriz de nombres de tinta), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = estándar / `'NChannel'` = forma extendida que puede llevar información de atributos por tinta), `colorants` (una correspondencia de cada nombre de tinta con una definición de tinta única), `process` y `mixingHints` |
| `components` | number[] | ✓ | Valor de tinte de cada tinta (0–1) |
| `displayColor` | string | ✓ | Color que se usa en su lugar para la visualización en pantalla y las vistas previas, que no disponen de la tinta especial |

**`PdfProcessColorSpaceDef`** (espacio de color de proceso: el espacio de color de los «colores ordinarios» expresados mediante la mezcla de tintas estándar como CMYK. Se usa en el `alternate` de un color especial y en el `colorSpace` de una máscara suave, discriminado por `kind`)

| Variante (`kind`) | Propiedades adicionales | Descripción |
| --- | --- | --- |
| `'gray'` | Ninguna | Escala de grises (DeviceGray) |
| `'rgb'` | Ninguna | RGB (DeviceRGB) |
| `'cmyk'` | Ninguna | CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (todas obligatorias) | Gris calibrado colorimétricamente (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (por componente), `matrix` (3×3) (todas obligatorias) | RGB calibrado colorimétricamente (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (todas obligatorias) | Espacio de color L\*a\*b\* |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (bytes del perfil ICC) (todas obligatorias) | Espacio de color basado en un perfil ICC |

`whitePoint`/`blackPoint` se especifican como matrices `[x, y, z]` en el espacio de color CIE XYZ.

### Propiedades de las bandas (`bands`) y los grupos (`groups`)

Los diez tipos de bandas especificados en el `bands` de la plantilla (véase «Una página es una pila de "bandas"») se definen todos con el siguiente `BandDef` (solo `details` es una matriz de `BandDef`).

**`BandDef`**

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `height` | number | ✓ | Altura mínima de la banda (pt). Crece a medida que los elementos se estiran |
| `elements` | ElementDef[] |  | Elementos colocados en la banda |
| `startNewPage` | boolean |  | Inicia siempre esta banda en una página nueva |
| `spacingBefore` | number |  | Espacio antes de la banda (pt) |
| `spacingAfter` | number |  | Espacio después de la banda (pt) |
| `splitType` | `'stretch'` = imprime todo lo que cabe en la página y continúa el resto en la siguiente (predeterminado) / `'prevent'` = no divide; envía la banda entera a la página siguiente (se divide si tampoco cabe en la nueva página) / `'immediate'` = divide inmediatamente en la posición actual, incluso en mitad de un elemento |  | Cómo se divide la banda cuando no cabe en un límite de página |
| `printWhenExpression` | Expression \| null |  | Cuando el resultado de la evaluación es falsy, esta banda no se emite |

**`GroupDef`** (cada entrada de `groups`)

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nombre del grupo. Referenciado desde el `resetGroup` de una variable y el `evaluationGroup` de un textField |
| `expression` | Expression | ✓ | Clave del grupo. Se evalúa para cada fila; allí donde el valor cambia, el grupo anterior se cierra y comienza uno nuevo |
| `header` | BandDef |  | Banda emitida al inicio del grupo |
| `footer` | BandDef |  | Banda emitida al final del grupo |
| `keepTogether` | boolean |  | Cuando el grupo entero no cabe en el espacio restante pero sí cabría en una página nueva, lo inicia tras un salto de página |
| `minHeightToStartNewPage` | number |  | Inicia el grupo en una página nueva cuando la altura restante de la página es menor que este valor (pt) |
| `reprintHeaderOnEachPage` | boolean |  | Cuando el grupo abarca varias páginas, reimprime el encabezado en cada página de continuación |
| `resetPageNumber` | boolean |  | Restablece `PAGE_NUMBER` a 1 cuando comienza el grupo |
| `startNewPage` | boolean |  | Inicia cada grupo en una página nueva |
| `startNewColumn` | boolean |  | Inicia cada grupo en una columna nueva |
| `footerPosition` | `'normal'` = emitido inmediatamente después de las filas de detalle (predeterminado) / `'stackAtBottom'` = apilado hacia la parte inferior de la página / `'forceAtBottom'` = colocado siempre en el extremo inferior de la página, consumiendo el espacio restante intermedio / `'collateAtBottom'` = se alinea abajo solo cuando el pie de otro grupo está alineado abajo (por sí solo, igual que `'normal'`) |  | Posición vertical del pie de grupo |

### Propiedades disponibles en los estilos (`styles`)

Los estilos se definen en la matriz `styles` de la plantilla y se referencian por `name` desde la propiedad `style` de un elemento. Las fuentes, la alineación del texto, los colores y demás ajustes relacionados con el texto se establecen principalmente mediante estilos.

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nombre del estilo (referenciado desde el `style` de los elementos) |
| `parentStyle` | string |  | Nombre del estilo padre. Hereda las propiedades del padre y las sobrescribe con sus propios ajustes (las referencias circulares se ignoran) |
| `isDefault` | boolean |  | Un estilo con `true` se aplica como predeterminado a los elementos sin `style` |
| `fontFamily` | string |  | Familia tipográfica. Predeterminado: `'default'` |
| `fontSize` | number |  | Tamaño de fuente (pt). Predeterminado: 10 |
| `bold` | boolean |  | Negrita. Predeterminado: `false` |
| `italic` | boolean |  | Cursiva. Predeterminado: `false` |
| `underline` | boolean |  | Subrayado. Predeterminado: `false` |
| `strikethrough` | boolean |  | Tachado. Predeterminado: `false` |
| `forecolor` | string |  | Color de primer plano (`#RRGGBB` o `#RRGGBBAA`). Predeterminado: `#000000` |
| `backcolor` | string |  | Color de fondo. Predeterminado: `transparent` |
| `hAlign` | `'left'` = alineado a la izquierda / `'center'` = centrado / `'right'` = alineado a la derecha / `'justify'` = justificado |  | Alineación horizontal. Predeterminado: `left` |
| `vAlign` | `'top'` = alineado arriba / `'middle'` = alineado al medio / `'bottom'` = alineado abajo |  | Alineación vertical. Predeterminado: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotación del texto (grados) |
| `padding` | Padding |  | Relleno interior |
| `border` | BorderDef |  | Borde |
| `mode` | `'opaque'` = rellena el fondo con `backcolor` / `'transparent'` = no rellena el fondo |  | Modo de visualización |
| `opacity` | number |  | Opacidad (0.0–1.0) |
| `variation` | Record<string, number> |  | Valores de los ejes de una fuente variable (p. ej. `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = escritura horizontal / `'vertical-rl'` = escritura vertical con las líneas avanzando de derecha a izquierda / `'vertical-lr'` = escritura vertical con las líneas avanzando de izquierda a derecha |  | Dirección de escritura |
| `conditionalStyles` | ConditionalStyleDef[] |  | Estilos condicionales (véase la tabla más abajo). Cuando se cumple una condición, se sobrescriben las propiedades correspondientes |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | Dirección del texto (ltr = de izquierda a derecha / rtl = de derecha a izquierda / auto = detectada automáticamente a partir del contenido) |
| `openTypeScript` | string |  | Etiqueta OpenType que especifica las reglas de qué sistema de escritura de la fuente se usan al convertir el texto en formas de glifo (shaping) (p. ej., `'latn'` = escritura latina, `'arab'` = escritura árabe). Normalmente no hace falta especificarla (se gestiona automáticamente a partir del contenido del texto) |
| `openTypeLanguage` | string |  | Etiqueta OpenType que hace explícito el idioma para las fuentes que varían las formas de los glifos según el idioma dentro de un mismo sistema de escritura. Normalmente no hace falta especificarla |
| `openTypeFeatures` | Record<string, number> |  | Activa o desactiva las características de conmutación de glifos integradas en la fuente. Ejemplos: `{ "palt": 1 }` = apretar el espaciado japonés, `{ "liga": 0 }` = desactivar las ligaduras, `{ "zero": 1 }` = cero barrado. Valores: 0 = desactivado / 1 = activado; para las características de selección de glifos, un número de glifo alternativo de base 1 |

**`ConditionalStyleDef`**
| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | Condición de aplicación. Cuando es truthy, las propiedades siguientes sobrescriben el estilo |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | Los mismos tipos que las propiedades homónimas de StyleDef |  | Valores sobrescritos cuando se cumple la condición (los significados son los mismos que los de las propiedades correspondientes de StyleDef) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | Los mismos tipos que las propiedades homónimas de StyleDef |  | Declaradas en la definición de tipos, pero la implementación actual no aplica sus sobrescrituras cuando se cumple la condición |

### Tipos para la importación de PDF y las funciones PDF avanzadas

Los tipos enumerados aquí sirven a dos propósitos: (1) tipos de «preservación» para reemitir un PDF importado sin perder un solo byte y (2) tipos para usar funciones avanzadas como las capas PDF, los scripts de formularios y los ajustes de preimpresión para impresión comercial. Casi nunca los especificará al escribir un informe corriente a mano. Los tipos descritos como «establecidos por la importación de PDF» aparecen dentro de los elementos generados por `importPdfPage()`.

**`OptionalContentDef`** (función de capas PDF)

PDF puede colocar contenido en «capas» (grupos de contenido opcional, OCG), cuya visibilidad e impresión pueden alternarse desde el panel de capas del visor. Especificar esto en el `optionalContent` de un elemento coloca ese elemento en una capa. Ejemplo: poner una marca de agua «Confidencial» en una capa que solo aparece al imprimir.

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nombre de la capa mostrado en el panel de capas del visor |
| `visible` | boolean |  | Visibilidad inicial en pantalla. Predeterminado: true |
| `print` | boolean |  | Estado de impresión inicial. Predeterminado: sigue a `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | Establecido por la importación de PDF. Preserva la definición de capa (OCG) del PDF de origen o una definición de pertenencia (OCMD) que decide la visibilidad a partir de una combinación de varias capas. Una pertenencia tiene `groups` (las capas afectadas), `policy` (`'AllOn'` = visible cuando todas están activadas / `'AnyOn'` = cuando alguna está activada / `'AnyOff'` = cuando alguna está desactivada / `'AllOff'` = cuando todas están desactivadas) y una expresión de lógica de visibilidad opcional `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | Establecido por la importación de PDF. Preserva la configuración de capas de todo el documento (la lista de todas las capas, la configuración predeterminada, el árbol de orden de visualización del panel de capas, los grupos de selección mutuamente excluyentes, el bloqueo, etc.) |

**`PdfRawValueDef`** («valores en bruto» de PDF)

Muchas de las propiedades de preservación transportan datos internos del PDF como «valores en bruto», sin interpretarlos. Un valor en bruto es un valor JavaScript con la forma siguiente: `null`, booleanos y números tal cual; un nombre PDF es `{ kind: 'name', value: 'DeviceRGB' }`; una cadena es `{ kind: 'string', bytes: Uint8Array }`; una matriz es `{ kind: 'array', items: [...] }`; un diccionario es `{ kind: 'dictionary', entries: { ... } }`; un flujo es `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (acciones ejecutadas por un visor de PDF)

Usado en el `additionalActions` de los campos de formulario y en otros lugares, define «qué debe hacer el visor». El contenido solo se serializa e importa: **el motor central nunca lo ejecuta** (la ejecución corre a cargo de un visor que lo admita).

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | Tipo de acción. `'JavaScript'` = ejecutar un script (el formateo, la validación y el cálculo automático de la entrada de formularios usan esto) / `'GoTo'` = ir a un destino dentro del documento / `'GoToR'` = ir a otro documento / `'GoToE'` = ir a un documento incrustado / `'URI'` = abrir una URL / `'Launch'` = iniciar una aplicación o un archivo / `'Named'` = comando predefinido (página siguiente, etc.) / `'SubmitForm'` = enviar el formulario / `'ResetForm'` = restablecer el formulario / `'ImportData'` = importar datos / `'Hide'` = alternar la visibilidad de una anotación / `'SetOCGState'` = alternar la visibilidad de una capa / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = otras acciones PDF estándar |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Diccionario que guarda los ajustes de cada tipo de acción como valores en bruto (véase **`PdfRawValueDef`** más arriba). Ejemplo: para `'JavaScript'`, `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | Destino para la familia `'GoTo'`. Con nombre (`{ kind: 'named', name, representation: 'name' \| 'string' }`) o explícito (página de destino + cómo se ajusta la vista) |
| `structureDestination` | PdfStructureDestinationDef |  | Destino basado en un elemento de la estructura del documento (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | Especifica la anotación a la que se dirigen las acciones multimedia |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | Secuencia de capas y operaciones (`'ON'` / `'OFF'` / `'Toggle'`) conmutadas por `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | Especifica los nombres de campo a los que se dirigen `'Hide'` / `'SubmitForm'` / `'ResetForm'` |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | Especificación de archivo incrustado para `'GoToE'` (estructura recursiva) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | Parámetros específicos de la plataforma para `'Launch'`. Solo se preservan, nunca se ejecutan |
| `articleTarget` | PdfArticleActionTargetDef |  | Especificación del hilo de artículo para `'Thread'` |
| `documentPartIndex` | number |  | Número de la parte del documento de destino para `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | Número de instancia de contenido multimedia enriquecido |
| `next` | PdfActionDef \| PdfActionDef[] |  | Acción o acciones que se ejecutan a continuación (encadenamiento) |

**`PdfFormXObjectDef`** (preservación de metadatos de los componentes de un PDF importado)

Dentro de un PDF, el contenido de dibujo que se usa repetidamente puede empaquetarse en componentes llamados «Form XObjects». La importación de PDF convierte tal componente en un elemento `frame` y conserva en este tipo el sistema de coordenadas y los metadatos del componente, para poder restaurarlos al reemitir. No hace falta especificarlo en plantillas escritas a mano.

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | Cuadro delimitador del componente (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | Matriz de transformación del sistema de coordenadas del componente (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | Transformación de coordenadas que estaba vigente cuando este componente se dibujó en el PDF de origen |
| `formType` | 1 |  | Número de tipo de formulario del componente (la especificación PDF solo define 1) |
| `group` | Record<string, PdfRawValueDef> |  | Preservación como valores en bruto del diccionario del grupo de transparencia |
| `reference` | Record<string, PdfRawValueDef> |  | Preservación como valores en bruto del diccionario de referencia a un PDF externo |
| `metadata` | Forma de flujo de PdfRawValueDef (`kind: 'stream'`) |  | Preserva el flujo de metadatos |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | Preserva los datos específicos de la aplicación creadora (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | Preserva la marca de tiempo de la última modificación |
| `structParent` / `structParents` | number |  | Preserva las claves de correspondencia con el PDF etiquetado (estructura del documento, como el orden de lectura) |
| `opi` | PdfOpiMetadataDef |  | Preserva la información OPI (véase la tabla más abajo) |
| `name` | string |  | Nombre del componente |
| `measure` | PdfMeasurement |  | Preserva la información de medición (véase la tabla más abajo) |
| `pointData` | PdfPointData[] |  | Preserva los datos de nube de puntos (véase la tabla más abajo) |

**`PdfSourceVectorDef`** (definiciones compartidas de formas repetidas importadas)

Al importar un PDF en el que la misma forma se repite en gran número —como los símbolos de un mapa—, los datos del contorno de la forma se preservan en la forma «una definición + N ubicaciones». Aparece en el `pdfSourceVector` de un elemento `path`; cuando se especifica, no se analiza `d`. No hace falta especificarlo en plantillas escritas a mano.

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | Matriz de definiciones de forma reutilizables. Cada definición tiene `commands` (0 = mover al punto inicial [2 coordenadas], 1 = línea recta [2], 2 = curva de Bézier cúbica [6], 3 = cerrar trazado [0]) y `coords` (una matriz aplanada de coordenadas en el orden de los comandos) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | Matriz de ubicaciones de las definiciones. Cada ubicación tiene `definitionIndex` (número de definición) y `matrix` (matriz afín de 6 elementos) |

**`PdfOpiMetadataDef`** (información de sustitución de imágenes para impresión comercial)

OPI (Open Prepress Interface) es un mecanismo de impresión comercial en el que se usa una imagen ligera de baja resolución durante la edición y se intercambia por la imagen de alta resolución cuando la imprenta produce la salida. Se preserva cuando el PDF importado llevaba esta especificación.

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | Versión de OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Guarda el contenido del diccionario OPI como valores en bruto de PDF (nombre del archivo de origen para la sustitución, área de recorte, etc.) |

**`PdfMeasurement`** (información de medición para planos y mapas)

En los PDF de planos y mapas, las herramientas de medición del visor pueden medir distancias y áreas a una escala como «1 cm en el papel corresponde a 1 m en el mundo real». Este tipo preserva esa escala y la información del sistema de coordenadas, y se presenta en una forma rectilínea (`kind: 'rectilinear'`) y una forma geoespacial (`kind: 'geospatial'`).

| Propiedad (`'rectilinear'`) | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | Discriminador para la medición rectilínea |
| `scaleRatio` | string | ✓ | Texto de visualización de la escala (p. ej. `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` es opcional) | Cadena de formatos de visualización numérica para las direcciones X/Y (etiquetas de unidad, factores de conversión, visualización decimal o fraccionaria, etc.). Cuando se omite `y`, se usa `x` |
| `distance` / `area` | PdfNumberFormat[] | ✓ | Formatos de visualización numérica para la distancia y el área |
| `angle` / `slope` | PdfNumberFormat[] |  | Formatos de visualización numérica para el ángulo y la pendiente |
| `origin` | [number, number] |  | Origen de la medición |
| `yToX` | number |  | Factor de conversión de las unidades Y a las X |

| Propiedad (`'geospatial'`) | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | Discriminador para la medición geoespacial |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | Sistema de coordenadas geodésico. Se requiere un código EPSG o una cadena WKT |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | Puntos de control en coordenadas geodésicas y los puntos de control locales correspondientes dentro de la imagen o el componente (el mismo número) |
| `dimension` | 2 \| 3 |  | Dimensión de las coordenadas. Predeterminado: 2 |
| `bounds` | [number, number][] |  | Polígono del área medible |
| `displayCoordinateSystem` | Igual que `coordinateSystem` |  | Sistema de coordenadas para la visualización |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | Unidades de visualización preferidas para la distancia, el área y el ángulo |
| `projectedCoordinateSystemMatrix` | Tupla numérica de 12 elementos |  | Matriz afín 4×4 para el sistema de coordenadas proyectado (12 elementos en orden de filas, omitiendo la cuarta columna constante) |

**`PdfPointData`** (datos de nube de puntos de mapas)

Para preservar las tablas de datos de puntos incrustadas en los PDF de mapas, con columnas nombradas como `LAT` (latitud), `LON` (longitud) y `ALT` (altitud).

| Propiedad | Tipo / valores permitidos | Obligatoria | Descripción |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | Matriz de nombres de columna (únicos y no vacíos; las columnas `LAT`/`LON`/`ALT` deben ser numéricas) |
| `rows` | PdfRawValueDef[][] | ✓ | Valores de cada fila. La longitud de la fila coincide con `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (funciones de transferencia tonal de preimpresión)

Funciones usadas en el `deviceParams` y el `softMask` de `frame` que asignan un valor (0–1) a otro valor. En preimpresión expresan curvas tonales: «la tinta de esta densidad se imprime con aquella densidad». Un `TransferFunctionDef` es o bien un `CalculatorFunctionDef` (una expresión de calculadora PostScript, p. ej. `{ expression: '{ 1 exch sub }' }` = invertir el blanco y el negro) o bien un `PdfFunctionDef` (un objeto de función PDF: una tabla de valores muestreados, una interpolación exponencial o una combinación de ambas); allí donde se usa, también puede especificarse `'Identity'` (sin transformación).

**`HalftoneDef`** (definición de trama de semitonos para preimpresión)

Las prensas de imprenta expresan la gradación tonal mediante el tamaño de pequeños puntos (puntos de trama). Esto especifica cómo se construyen esos puntos y se usa para la preservación en la importación de PDF y para crear datos de preimpresión. `type` distingue cinco formas:

| Forma | Propiedades principales | Descripción |
| --- | --- | --- |
| type 1 (trama) | `frequency` (lineatura) ✓, `angle` (ángulo) ✓, `spotFunction` (forma del punto; un nombre predefinido como `'Round'` o una expresión de calculadora) ✓, `accurateScreens` (solicita una construcción de trama de alta precisión; opcional) | Forma estándar que define el semitono mediante lineatura, ángulo y forma del punto (`type` puede omitirse) |
| type 6 (matriz de umbrales) | `width` ✓, `height` ✓, `thresholds` (width × height valores, 0–255) ✓ | Define el semitono directamente con una tabla de umbrales |
| type 10 (umbrales angulados) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | Definición de umbrales con celdas anguladas |
| type 16 (umbrales de 16 bits) | `width` ✓, `height` ✓, `thresholds` (valores de 16 bits) ✓, segundo rectángulo opcional | Definición de umbrales de alta precisión |
| type 5 (colección por plancha) | `halftones` (matriz de `{ colorant: nombre de la tinta, halftone: cualquiera de las formas anteriores }`) ✓ | Asigna un semitono distinto a cada plancha de color, como el cian y el magenta |

Las cuatro formas distintas de type 5 pueden llevar un `transferFunction` opcional (`'Identity'` o un `TransferFunctionDef`) (en type 5, cada definición interna de semitono por plancha lleva el suyo propio).

## API principal

Las API de uso más frecuente, enumeradas una a una con una muestra mínima para que pueda consultarlas por «lo que quiere hacer». Se supone que `template`, `dataSource`, `fontMap` y `fonts` son exactamente los que se construyeron en el tutorial.

### Construir un informe

#### Construir un informe a partir de una plantilla y datos — `createReport()`

Maqueta la plantilla y los datos y devuelve un `RenderDocument` orientado a páginas. Las expresiones usan un lenguaje de expresiones incorporado y seguro que puede referenciar `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` y más; no se usa `eval` ni `Function`. Las expresiones de callback de TypeScript también son una opción.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // número de páginas maquetadas
```

#### Buscar y modificar elementos de la plantilla por ID — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

Ambas API devuelven referencias a los elementos de la plantilla original. Haga sus cambios antes de llamar a `createReport()`. `getElementChildren()` devuelve elementos hijos solo para `frame` y `table` (elementos dentro de las celdas); para los demás elementos devuelve una matriz vacía. Para obtener detalles sobre el ámbito de búsqueda, véase «Buscar elementos por ID y modificarlos antes del renderizado».

#### Construir un informe a partir de un archivo `.report` — `createReportFromFile()` (Node.js)

Lee una plantilla JSON y resuelve las rutas relativas de las imágenes y los subinformes con respecto al directorio de la plantilla.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### Combinar varios informes en un solo volumen — `createReportBook()`

Concatena varias plantillas —una portada, un cuerpo, etc.— en un único `RenderDocument` con numeración de páginas continua.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### Concatenar `RenderDocument`s ya construidos — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

Los ID de imagen que colisionan se renombran automáticamente.

#### Generar automáticamente una página de índice — `insertTableOfContents()`

Recopila las entradas del índice a partir de las anclas (`anchorName`) del informe e inserta las páginas del índice al principio.

```ts
const withToc = insertTableOfContents(
  document,
  // Tamaño y márgenes de la página del índice en pt (en este ejemplo: A4 vertical)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // ID de fuente (clave de fontMap) usado para el texto del índice
  { title: '目次' },
)
```

#### Obtener el número de páginas de un PDF existente — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### Importar un PDF existente como elementos de informe — `importPdfPage()`

Para obtener detalles, véase **Convertir un PDF existente en elementos de informe (importación de PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### Renderizado y salida

#### Emitir un PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### Previsualizar una sola página — `renderPage()`

Renderizado página a página. Úselo para dibujar solo la página mostrada actualmente en una previsualización del navegador.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### Renderizar el informe completo a cualquier backend — `render()`

Renderiza todas las páginas a cualquier destino de salida que implemente la interfaz `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### Dibujar en un Canvas de HTML — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### Emitir SVG — `SvgBackend`

Genera una cadena `<svg>` autocontenida por página.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // matriz de cadenas <svg>, una por página
```

#### Control detallado sobre la generación de PDF — `PdfBackend`

Las opciones específicas de PDF, como las miniaturas de página, se pasan al constructor.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` se aplica a la página i-ésima. Para `thumbnailImageId` (la imagen en miniatura mostrada en la lista de páginas), especifique un ID de imagen que exista en `document.images`.

#### Fusionar PDF terminados — `mergePdfFiles()`

Fusiona varios PDF en uno solo con un analizador de PDF en TypeScript puro.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### Trabajar con fuentes

#### Cargar un archivo de fuente — `Font.load()`

Analiza TTF, OTF, TTC, OTC, WOFF, WOFF2 y EOT.

```ts
const font = Font.load(fontBuffer)
```

#### Medir la anchura del texto — `TextMeasurer`

Medición rápida de texto respaldada por la caché de glifos de `Font`. Registrado en el `fontMap`, se usa también para la maquetación.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### Convertir una cadena en una secuencia de glifos — `font.shapeText()`

Usa la información de OpenType / AAT (la especificación de extensión de las fuentes de linaje Apple) / Graphite (la especificación de extensión de las fuentes de linaje SIL) para obtener una secuencia de glifos (números de glifo con posiciones y avances) con la selección de glifos, las ligaduras y los ajustes de posicionamiento aplicados.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### Detectar glifos faltantes antes de imprimir — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### Usar por separado los códigos de barras, SVG, las fórmulas matemáticas y las imágenes

#### Generar un código de barras por separado — `renderBarcode()`

Genera directamente los nodos de dibujo del código de barras, sin pasar por un elemento de informe.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### Analizar y renderizar SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### Componer una fórmula matemática por separado — `parseMathLaTeX()` / `layoutMathFormula()`

Requiere una fuente que incluya información de dimensiones para fórmulas matemáticas (la tabla MATH de OpenType), por ejemplo STIX Two Math o Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// argumentos: fórmula analizada, objeto Font, ID de fuente (clave de fontMap), tamaño de fuente en pt, color del texto
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box es el resultado maquetado; los elementos math de la plantilla ejecutan internamente esta misma maquetación
```

#### Obtener las dimensiones de una imagen — `getImageDimensions()`

Admite PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### Decodificar un PNG — `decodePng()`

Un decodificador de PNG en TypeScript puro.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### Emitir un PDF que contiene WebP/AVIF en el navegador — `prepareBrowserPdfImageResources()`

El JPEG se almacena directamente en el PDF y el PNG lo gestiona el decodificador incorporado. Al generar en el navegador un PDF que contiene WebP/AVIF, `tsreport-core/browser` primero decodifica únicamente las imágenes realmente referenciadas por el `RenderDocument` usando los códecs estándar del navegador y pasa los resultados a la generación del PDF. Las imágenes no referenciadas se conservan tal cual y no se decodifican.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: bytes de imagen suministrados en el momento del renderizado; catalog: ajustes
// del catálogo del documento PDF; collection: ajustes del portafolio PDF — omita los que no use
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

Para decodificar WebP/AVIF en Node.js, use `createNodeExternalRasterImageDecoder()` de `tsreport-core/node`.

## Restricciones de carga de recursos y reglas de los ID de imagen

Reglas detalladas que conviene consultar cuando cobran relevancia para la operación de un servidor o la incrustación de la biblioteca.

### Restringir los directorios desde los que se cargan las imágenes y las plantillas

La carga de archivos de imagen puede confinarse a directorios permitidos explícitamente.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` resuelve de forma predeterminada las rutas relativas con respecto al directorio de la plantilla principal, pero por compatibilidad con versiones anteriores no restringe implícitamente el propio ámbito de carga. Cuando se especifica `resources.fileRoot`, la misma restricción se aplica por igual a las imágenes, la plantilla principal y los subinformes. Las imágenes que faltan se gestionan según el ajuste `onError` de cada elemento, y las referencias que apuntan fuera del directorio permitido (incluidas las que pasan por enlaces simbólicos) siempre producen un error.

### Reglas de los ID de imagen

Cada imagen de un `RenderDocument` se busca en `RenderDocument.images` usando como clave `RenderImage.imageId` (lo mismo ocurre con el `imageId` de una alternativa). **Los consumidores deben usar este ID como clave exactamente tal cual y no deben reensamblar claves mediante la unión de rutas o métodos similares.** Los ID se asignan según las reglas siguientes.

- Cargar una imagen mediante una ruta relativa no sustituye el ID por la ruta absoluta del servidor ni por la ruta resuelta del enlace simbólico. La referencia tal como está escrita en la plantilla sigue siendo la clave (si está escrita como ruta absoluta, ese valor se conserva tal cual)
- La ruta física resuelta del enlace simbólico se usa internamente solo para decidir si dos referencias son el mismo archivo. Incluso cuando los directorios base difieren, las imágenes que apuntan al mismo archivo físico reutilizan el mismo ID
- En las configuraciones en las que el informe raíz difiere una imagen al suministro en el momento del renderizado —usando `createReport()` directamente sin pasar tampoco la imagen en cuestión por `resources`, de modo que la referencia escrita en la plantilla se convierte tal cual en el ID y los bytes se suministran después mediante `renderToPdf(document, { images })`—, a las imágenes locales de ruta relativa cargadas por los subinformes siempre se les asignan ID internos independientes del host. Como las referencias en expresiones y subinformes dinámicos no pueden enumerarse de antemano, esto no depende de si un nombre colisionó realmente ni del orden de la maquetación. Como resultado, la imagen local de un subinforme nunca puede secuestrar un ID de suministro en el momento del renderizado con el mismo nombre

### Suministro de imágenes en el momento del renderizado y alternativas

Cuando una alternativa no se ha podido resolver en el momento de la maquetación, se conserva el ID de la imagen original. Por tanto, las previsualizaciones en Canvas/SVG no se detienen y los bytes pueden suministrarse después mediante `renderToPdf(document, { images })`. Las `images` pasadas explícitamente se fusionan en `document.images`, y el valor pasado explícitamente tiene prioridad para un mismo ID. También durante la generación del PDF, las alternativas no suministradas simplemente quedan excluidas de las candidatas alternativas: no se detiene ni el renderizado de la imagen principal ni el informe en su conjunto.

### Ámbito de la recopilación de referencias a imágenes

La recopilación de referencias a imágenes gestiona no solo los elementos `image` corrientes, sino también las alternativas, las máscaras suaves de grupo y los patrones de mosaico de los rellenos (fill/stroke) junto con sus máscaras suaves anidadas, todo mediante el mismo mecanismo. Al usar miniaturas de página específicas de PDF, miniaturas de carpeta de colección o imágenes de Web Capture en el navegador, pase los mismos `catalog`, `collection` y `pageOptions` tanto a `prepareBrowserPdfImageResources(document, options)` como a `renderToPdf(document, options)` (con la API primitiva, pase las mismas opciones a `new PdfBackend(options)` y llame a `render(document, backend)`). Estas imágenes WebP/AVIF también se decodifican solo cuando es necesario, antes de la generación del PDF.

## Requisitos de tiempo de ejecución

- Node.js 18 o posterior
- ES Modules / CommonJS
- Navegadores modernos
- Sin paquetes de dependencia en tiempo de ejecución

La compresión y descompresión Brotli de WOFF2 usan la implementación en TypeScript puro integrada en tsreport-core, tanto en Node.js como en los navegadores. No se requieren paquetes externos, WASM ni bibliotecas nativas.

## Licencia

tsreport-core está disponible, a su elección, bajo la [Licencia MIT](./LICENSE-MIT) o la [Licencia Apache 2.0](./LICENSE-APACHE) (SPDX: `MIT OR Apache-2.0`). Para los avisos de copyright y las condiciones de licencia del código y los datos de terceros, véase [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
