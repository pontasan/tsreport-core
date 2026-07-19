# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | Português | [العربية](./README.ar.md) | [עברית](./README.he.md)

**Do japonês, chinês e coreano à escrita árabe — um motor de relatórios que transforma os sistemas de escrita do mundo em PDFs belíssimos, em TypeScript puro.**

O `tsreport-core` cuida da análise de fontes OpenType, da composição tipográfica de texto (dispor os caracteres na página com as formas de glifo, larguras e posições corretas), do layout de relatórios baseado em bandas, da pré-visualização em Canvas/SVG e da geração de PDF — tudo por meio de um único modelo de renderização consistente. Ele tem zero dependências em tempo de execução. Sem módulos nativos e sem WASM, este único pacote roda tanto no Node.js quanto em navegadores modernos.

Os exemplos de código deste documento usam intencionalmente dados comerciais japoneses (orçamentos, faturas): eles funcionam também como uma demonstração ao vivo da composição tipográfica CJK deste motor.

```bash
npm install tsreport-core
```

Este README está repleto de exemplos que você pode copiar e executar como estão, cobrindo tudo, desde a sua primeira geração de PDF até os 16 elementos de relatório, escrita vertical, composição tipográfica multilíngue, incorporação de fontes e conversão de texto em contornos, e pré-visualização no navegador. Se ferramentas de relatório são novidade para você, comece por **Fundamentos do layout de relatórios** para assimilar os conceitos e, em seguida, construa seu primeiro PDF com o tutorial.

## Criar relatórios WYSIWYG visualmente com o tsreport-editor

O [tsreport-editor](https://github.com/pontasan/tsreport-editor) é um designer de relatórios WYSIWYG construído sobre o tsreport-core. Você pode organizar bandas e elementos visualmente, vincular dados de teste JSON, conferir a pré-visualização de impressão, importar PDFs e gerar PDFs com o mesmo motor central de renderização. Os vídeos mostram uma IA editando um relatório via MCP e abrindo a pré-visualização concluída no Editor.

| Demonstração em inglês | Demonstração em japonês |
| --- | --- |
| [![Demonstração WYSIWYG do tsreport-editor em inglês](https://img.youtube.com/vi/CHsNew6yQr4/hqdefault.jpg)](https://youtu.be/CHsNew6yQr4) | [![Demonstração WYSIWYG do tsreport-editor em japonês](https://img.youtube.com/vi/0I3ljxLUbys/hqdefault.jpg)](https://youtu.be/0I3ljxLUbys) |

## Compor corretamente os sistemas de escrita do mundo, com um único motor

Um relatório multilíngue não pode ser exibido corretamente simplesmente gravando strings diretamente em um PDF. Seleção de glifos, medição da largura dos caracteres, posicionamento, quebra de linha, escrita vertical e incorporação de fontes no PDF — somente quando toda essa cadeia de processamento se engrena é que você obtém a página esperada.

O `tsreport-core` assume esse fluxo inteiro, da análise da fonte à geração do PDF.

- **Japonês, chinês e coreano** — chinês simplificado e tradicional, hangul, tratamento de pontuação e glifos de escrita vertical são todos compostos corretamente com base em dados Unicode e OpenType
- **Escrita árabe e composição da direita para a esquerda (RTL)** — a modelagem contextual de glifos, as junções e ligaduras (vários caracteres fundindo-se em uma única forma de glifo) e o processamento bidirecional Unicode (controle de ordenação quando texto da direita para a esquerda se mistura com dígitos e letras latinas) são tratados pelo mesmo pipeline de layout de todas as outras escritas
- **Sistemas de escrita complexos** — substituição e posicionamento de glifos guiados pelas regras de composição embutidas na fonte (OpenType Layout), caracteres combinantes, variantes de glifo (desenhos alternativos do mesmo caractere) e recursos tipográficos por idioma são suportados
- **Escrita vertical** — trata `vertical-rl` / `vertical-lr`, glifos de escrita vertical, métricas verticais (dados dimensionais, como larguras de avanço, específicos do texto vertical) e rotação de caracteres
- **Incorporação automática de subconjunto de fonte** — apenas os glifos realmente usados (os dados de forma por caractere armazenados na fonte) são incorporados ao PDF, de modo que o documento tem a mesma aparência mesmo em máquinas que não têm a fonte instalada
- **Conversão de texto em contornos** — por elemento, o texto pode ser emitido como caminhos vetoriais independentes de fonte
- **Referências a fontes do sistema** — para fluxos de trabalho que dependem das fontes do visualizador, também é possível produzir PDFs leves sem fontes incorporadas
- **Detecção de texto corrompido antes que aconteça** — `checkGlyphCoverage()` aponta os caracteres ausentes na fonte, por página e por caractere, antes da saída

E essa composição tipográfica de texto funciona como uma unidade com um motor de layout construído especificamente para relatórios — porque a capacidade de assentar caracteres corretamente e a capacidade de paginar corretamente não podem ser separadas.

- **Layout que responde ao volume de texto** — as linhas se esticam conforme a quantidade de texto (`stretchWithOverflow`) e as alturas das bandas se ajustam automaticamente. Nomes de produto longos nunca são cortados
- **Quebras de página automáticas guiadas pelo volume de dados** — quando as linhas de detalhe transbordam, o motor inicia uma nova página e reemite automaticamente o cabeçalho e as linhas de título. Subtotais por grupo e quebras de página exigem nada além de uma declaração
- **Layout aninhado** — até relatórios complexos que combinam tabelas, tabelas cruzadas e sub-relatórios são posicionados de forma consistente pelo mesmo motor de layout
- **WYSIWYG (pré-visualização = impressão)** — os elementos são fixados exatamente nas coordenadas em pt que você especifica, e a pré-visualização em Canvas/SVG compartilha com a saída em PDF o mesmíssimo resultado de layout. O que você vê na tela é o que sai no papel

## Por que tsreport-core

O tsreport-core nasceu de três inquietações.

**O TypeScript não tem uma solução séria de relatórios.** Produzir orçamentos e faturas é uma necessidade básica de negócio e, no entanto, o ecossistema TypeScript/Node.js — embora tenha bibliotecas para desenho de PDF de baixo nível — não tinha nada que merecesse ser chamado de "motor de relatórios": layout em bandas, quebras de página automáticas, agregação e fidelidade entre pré-visualização e impressão em um único pacote. Queríamos acabar com a prática de arrastar o runtime de outra linguagem ou um produto de servidor externo apenas para relatórios.

**Relatórios são uma capacidade fundamental, e todos deveriam poder usá-la gratuitamente.** A emissão de relatórios não é um recurso premium reservado a alguns produtos caros; ela faz parte da fundação de qualquer sistema de negócio. Sem licenças comerciais para comprar e sem tarifas por uso, todos — de ferramentas pessoais a produtos comerciais — deveriam poder usar o mesmo motor tal como está. O tsreport-core publica todos os seus recursos sob licença dupla MIT OR Apache-2.0 como a materialização dessa convicção.

**Poucas soluções encaram de frente o suporte multilíngue — escritas asiáticas, escrita árabe e além.** A maioria das ferramentas de relatório e PDF é projetada em torno do texto latino, tratando a composição do japonês, do chinês e do coreano, ou a escrita árabe da direita para a esquerda, como algo secundário. O tsreport-core fez de "compor corretamente os sistemas de escrita do mundo, com um único motor" uma meta de projeto desde o primeiro dia, implementando internamente tudo, da análise de fontes à composição e à incorporação em PDF.

Essas motivações tomam forma em três pontos fortes.

### Do motor de layout à geração de PDF, completo em um único pacote

Quando as páginas são montadas a partir de um template e de dados, o resultado é capturado em um único modelo de renderização chamado `RenderDocument`. Esse mesmo modelo pode ser renderizado em PDF, Canvas ou SVG, de modo que não é preciso manter lógica de layout duplicada para a pré-visualização na tela e para a impressão — o PDF fica exatamente igual ao que você viu na tela. Não há necessidade de acoplar um motor de relatórios de layout em bandas a uma biblioteca de PDF.

### TypeScript puro com zero dependências em tempo de execução

Análise de fontes, composição tipográfica de texto, geração de PDF, compressão DEFLATE, criptografia, decodificação de PNG e geração de códigos de barras são todos implementados em TypeScript puro. Sem módulos nativos e sem processos externos, ele se comporta de forma idêntica em qualquer ambiente, e auditar o código que roda durante a geração do relatório significa ler apenas este único pacote.

### Tudo o que um relatório precisa, já embutido

- Layout em bandas com título, cabeçalho de página, detalhe, grupo, sumário e mais
- Tabelas, tabelas cruzadas, sub-relatórios, variáveis, expressões, quebras de página, sumário (índice), mesclagem de múltiplos relatórios
- Importação de PDFs existentes — conversão de páginas de PDF em elementos de relatório (`ElementDef`), estilos, imagens e informações de fonte
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, gradientes, recorte (clipping), transparência, composição matemática, imagens
- Criptografia de PDF, PDF/A-1b, 2b e 3b (normas internacionais de arquivamento de longo prazo), PDF/X-1a (norma internacional para envio à gráfica), marcadores, links, formulários, anotações
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, fontes variáveis (fontes cujo peso, largura e outros eixos variam continuamente) e fontes coloridas

## Fundamentos do layout de relatórios

Para leitores que estão conhecendo motores de relatório agora, esta seção percorre os conceitos fundamentais em ordem.

### Premissa: um relatório é construído a partir de um "template" mais "dados"

No tsreport-core, um relatório é construído a partir de duas partes: um **template** (a definição do layout) e **dados** (JSON).

O template não contém valores reais. Ele define apenas as molduras — "o nome do item vai aqui; o valor vai ali, com esta largura e neste formato" — e referências a **qual campo dos dados exibir** em cada uma (escritas como `field.item`, significando o campo `item` dos dados).

Os valores reais são passados como dados JSON. Cada elemento do array `rows` é uma linha de detalhe.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

Quando o relatório é gerado, o motor percorre `rows` de cima para baixo, emitindo o layout de detalhe uma vez por linha. No exemplo acima, três linhas de detalhe são impressas, e `field.item` resolve para りんご, みかん e ぶどう, uma de cada vez. Se os dados crescerem para 10.000 linhas, o relatório passa a ter 10.000 linhas sem mudar um único caractere do template. Essa divisão de trabalho — o layout é fixo, o número de linhas acompanha os dados — é o ponto de partida de todo motor de relatórios.

### Uma página é uma pilha de "bandas"

Do lado do template, você então projeta a página como uma pilha de faixas horizontais chamadas **bandas**. Em vez de calcular coordenadas Y por conta própria e posicionar elementos na página, você declara apenas "qual banda contém o quê", e o motor monta as páginas automaticamente de acordo com o número de linhas de dados. Uma página tem a estrutura a seguir.

```text
┌──────────────────────────┐
│ title                    │ ← uma vez no início do relatório (título, destinatário, …)
├──────────────────────────┤
│ pageHeader               │ ← topo de cada página (nome da empresa, data de emissão, …)
├──────────────────────────┤
│ columnHeader             │ ← linha de título das linhas de detalhe (item, quantidade, valor, …)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ uma vez por linha de rows,
│ details                  │ │ repetida por quantas linhas houver
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← fecha as linhas de detalhe (por página/coluna)
├──────────────────────────┤
│ pageFooter               │ ← rodapé de cada página (números de página, …)
└──────────────────────────┘
```

Na última página, depois do último `details`, `summary` (totais gerais do relatório inteiro e afins) é emitido exatamente uma vez. Além dessas, existem `background`, aplicada sob todas as páginas; `lastPageFooter`, usada apenas na página final; e `noData`, que aparece apenas quando os dados têm zero linhas — no total, dez tipos de banda podem ser definidos em `bands`.

| Banda | Quando é emitida | Uso típico |
| --- | --- | --- |
| `background` | Fundo de todas as páginas | Marcas-d'água, molduras decorativas |
| `title` | Uma vez no início do relatório | Título, destinatário |
| `pageHeader` | Topo de cada página | Nome da empresa, data de emissão |
| `columnHeader` | Antes das linhas de detalhe (por página/coluna) | Linha de título do detalhe |
| `details` | Uma vez por linha de dados (`rows`) | Linhas de detalhe |
| `columnFooter` | Depois das linhas de detalhe (por página/coluna) | Área de subtotal |
| `pageFooter` | Rodapé de cada página | Números de página |
| `lastPageFooter` | Rodapé da página final (substitui `pageFooter` quando especificada) | Observações de encerramento |
| `summary` | Uma vez depois de todas as linhas de detalhe | Total geral, observações |
| `noData` | Quando os dados têm zero linhas | "Nenhum dado correspondente" |

Se você definir adicionalmente `groups`, cabeçalhos e rodapés de grupo são inseridos automaticamente onde quer que a chave do grupo mude, produzindo layouts como "subtotal por departamento e, em seguida, iniciar uma nova página".

Você também pode especificar `columns` no template (`count` = número de colunas, `spacing` = espaço entre colunas em pt) para fazer a área de detalhe fluir em múltiplas **colunas** verticais, no estilo de jornal. O padrão é uma coluna; nesse caso, tudo o que neste documento é descrito como "por coluna" equivale a "por página". Passar para a coluna seguinte é chamado de "quebra de coluna".

### Quebras de página acontecem automaticamente

Quando as linhas de detalhe já não cabem na página, o motor automaticamente fecha aquela página (emitindo `pageFooter`), inicia a seguinte, emite `pageHeader` e `columnHeader` de novo e então continua fazendo fluir as linhas de detalhe restantes. Você nunca precisa contar linhas nem calcular a altura restante de uma página.

Somente quando quiser controle é que você recorre ao seguinte.

- O elemento `break` — força uma quebra de página ou de coluna em qualquer posição
- O `startNewPage` de uma banda — sempre inicia aquela banda em uma página nova
- O `splitType` de uma banda — quando não há altura suficiente, escolhe se a banda pode atravessar páginas no meio (`stretch`) ou se deve ser movida inteira para a página seguinte (`prevent`)

### Sub-relatório = outro relatório embutido dentro de um relatório

O elemento `subreport` embute um `.report` separado inteiro dentro do layout do relatório pai. "Imprimir uma lista de pedidos e, dentro de cada pedido, imprimir seus itens como uma tabela" — este é o mecanismo para dispor **dados aninhados** desse tipo.

Suponha que cada linha de `rows` do pai (um pedido) carregue um array `items` de itens de linha.

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

Coloque um elemento `subreport` na banda `details` do pai e passe "os `items` deste pedido" por meio de `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` é, como o nome diz, uma expressão. Para passar um nome de arquivo fixo, envolva-o em `'...'` como literal de string dentro da expressão (você também pode alterná-lo dinamicamente com uma expressão como `"field.templatePath"`).

O sub-relatório então **é executado uma vez para cada linha de detalhe do pai**, e os `items` passados são tratados como as próprias `rows` do sub-relatório. O sub-relatório (`order-items.report`) é, por si só, um template independente: tem suas próprias definições de bandas e referencia cada item de linha via `field.name` e `field.qty`. Na página, ele se desdobra assim.

```text
┌──────────────────────────────┐
│ details                      │ ← rows do pai, linha 1 (pedido A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← recebe os items deste pedido (2 linhas)
│   │   details              │ │ ← items, linha 1 (りんご 10)
│   │   details              │ │ ← items, linha 2 (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← rows do pai, linha 2 (pedido A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← recebe os items deste pedido (1 linha)
│   │   details              │ │ ← items, linha 1 (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

A tabela de itens dentro de uma fatura, um bloco de detalhe repetido por cliente — "pequenos relatórios dentro de um relatório" podem ser extraídos como componentes e reutilizados. Parâmetros (strings de título e afins) também podem ser passados do pai para baixo. A seção posterior **Exemplos funcionais de todos os elementos** contém um exemplo completo e pronto para executar exatamente dessa configuração (o elemento do pai mais o template do lado do sub-relatório).

## Gerando um PDF a partir de um arquivo `.report` e dados JSON

Um arquivo `.report` é um template de relatório: um `ReportTemplate` escrito como JSON. Por ser JSON puro, você pode acompanhar diffs no Git e gerá-lo a partir de qualquer linguagem ou ferramenta.

A configuração mínima são estes três arquivos.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

Os dois nomes de arquivo de fonte pressupõem os pesos Regular / Bold de uma fonte japonesa (por exemplo, Noto Sans JP). Substitua pelas fontes que você tiver à mão. O tratamento de vários idiomas em um único relatório é abordado mais adiante em **Construindo relatórios multilíngues**.

### 1. Escreva o template, `quotation.report`

Coordenadas, dimensões, margens e tamanhos de fonte estão todos em **pt (pontos, 1pt = 1/72 de polegada ≈ 0,353mm)**, a unidade padrão do PDF. `"size": "A4"` é tratado como 595 × 842pt (as dimensões ISO de 210×297mm convertidas para pt e arredondadas para inteiros), e as margens de 36pt deste exemplo equivalem a cerca de 12,7mm.

Mais uma premissa: `fontFamily` em `styles` não é um nome de arquivo de fonte, mas uma **chave (nome lógico)** que você registrará depois no `fontMap` e em `fonts` do código de execução. Usar os mesmos nomes no template e no código (`jp` e `jpBold` neste exemplo) é o que faz a amarração entre eles.

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

O `pattern` usado nas linhas de detalhe é um especificador de formato de número/data (`#,##0` = separadores de milhar, `¥#,##0` = separadores de milhar com o símbolo do iene; veja "Formatando números e datas" mais adiante neste documento para detalhes).

### 2. Prepare os dados, `quotation.test-data.json`

Cada linha de `rows` é vinculada a `field.*` na banda de detalhe, e `parameters` é vinculado a `param.*` para o relatório inteiro.

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

Os vínculos mapeiam-se da seguinte forma.

| JSON | Expressão no `.report` | Finalidade |
| --- | --- | --- |
| `rows[n].item` | `field.item` | Linha de detalhe atual |
| `parameters.title` | `param.title` | Argumento para o relatório inteiro |
| Variável `grandTotal` | `vars.grandTotal` | Variáveis do relatório para somas, contagens etc. |
| Contexto de página | `PAGE_NUMBER` / `TOTAL_PAGES` | Número da página, total de páginas |

### 3. Carregue o `.report` e gere o PDF

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
  // Buffers do Node.js podem compartilhar um pool de memória maior; passe ao Font.load
  // um ArrayBuffer fatiado para conter exatamente os bytes deste arquivo
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

As mesmas fontes são registradas duas vezes, tanto em `fontMap` quanto em `fonts`, porque as duas estruturas cumprem papéis diferentes: `fontMap` é usada para a medição da largura dos caracteres no momento do layout (`TextMeasurer`), enquanto `fonts` é usada para a incorporação de fontes no momento da geração do PDF. Registre a mesma fonte em ambas, sob os mesmos nomes de chave do `fontFamily` do template.

`createReportFromFile()` resolve caminhos relativos de imagens e sub-relatórios em relação ao diretório do `.report` principal. Se você especificar `workingDirectory`, esse diretório passa a ser a base. Para restringir o que pode ser lido, declare a raiz permitida explicitamente em `resources.fileRoot`; referências relativas que escapem da raiz, e links simbólicos que apontem para fora dela, são rejeitados.

## Definindo templates diretamente em TypeScript

Em vez de usar um arquivo `.report`, você pode escrever o template como um objeto TypeScript. Com verificação de tipos e autocompletar ao seu alcance, isso convém à geração de templates a partir de código. O conteúdo é o mesmo orçamento do tutorial. Coordenadas e dimensões estão em pt.

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

### Localizando elementos por ID e modificando-os antes da renderização

Dê a um elemento um `id` qualquer e você pode recuperá-lo com `findElementById()`, não importa quão fundo ele esteja dentro de bandas ou frames. O valor retornado não é uma cópia, mas o próprio elemento dentro de `template`, de modo que quaisquer mudanças feitas antes de `createReport()` são refletidas no layout e na renderização.

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

`findElementById()` busca em profundidade nas bandas comuns, bandas de detalhe, cabeçalhos/rodapés de grupo, frames, máscaras de suavidade (soft masks) e células de tabela. Quando o mesmo ID aparece mais de uma vez, é retornado o primeiro elemento na ordem de busca; portanto, mantenha único dentro do template qualquer ID que você pretenda modificar. Os elementos do array retornado por `getElementChildren()` são, da mesma forma, referências ao template original.

> Os arquivos de fonte não são empacotados com o pacote. Escolha fontes cujas licenças sejam adequadas ao seu caso de uso, método de distribuição e permissões de incorporação. Um estilo pode nomear apenas uma fonte. Para misturar caracteres de vários idiomas dentro de um único elemento, você precisa de uma fonte Pan-CJK que cubra todos eles em um único arquivo (uma fonte que reúne caracteres japoneses, chineses e coreanos; por exemplo, Source Han Sans, Noto Sans CJK). Para usar uma fonte separada por idioma, divida os elementos por idioma e alterne os estilos, como na próxima seção, "Construindo relatórios multilíngues".

## Construindo relatórios multilíngues

Cada estilo pode nomear exatamente uma fonte, e não há fallback automático entre fontes. O padrão básico de um relatório multilíngue é, portanto, **carregar uma fonte por idioma e aplicar o estilo de cada idioma aos elementos daquele idioma**.

O trecho a seguir é de um orçamento que apresenta japonês e chinês simplificado lado a lado. Primeiro, carregue uma fonte para cada idioma.

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

No template, aplique o estilo `ja` ao texto em japonês e o estilo `zh` ao texto em chinês, dividindo os elementos por idioma.

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

Da mesma forma, os dados carregam um campo por idioma.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

A exceção é **um campo único cujo idioma só se conhece em tempo de execução**, como uma caixa de observações de texto livre. Como esse campo não pode ser dividido em elementos por idioma, a resposta prática é atribuir — somente a esse estilo — uma fonte Pan-CJK que cubra muitos sistemas de escrita em um único arquivo (Source Han Sans, Noto Sans CJK e afins). De um jeito ou de outro, `checkGlyphCoverage()` detecta quaisquer lacunas na cobertura da fonte antes da saída.

## Escolhendo um modo de saída de fonte por elemento de texto

Mesmo dentro de um único relatório, você pode especificar o modo de saída por `staticText` ou `textField`: texto incorporado pesquisável para o corpo, contornos para o logotipo, referências a fontes do sistema para textos padronizados.

| Modo | Como especificar | Estado no PDF | Adequado para |
| --- | --- | --- | --- |
| Incorporação de subconjunto | `pdfFontMode: 'embedded'` (padrão) | Incorpora os glifos usados mais o programa da fonte. O texto pode ser selecionado e pesquisado | Distribuição, arquivamento de longo prazo, impressão, relatórios multilíngues |
| Conversão em contornos | `outlineText: true` | Converte as formas dos glifos em caminhos vetoriais. Não carrega nenhuma informação de fonte | Logotipos, arte-final — texto cujas formas devem ser congeladas exatamente |
| Referência a fonte do sistema | `pdfFontMode: 'reference'` | Não incorpora fonte; registra apenas o nome da fonte e os caracteres | PDFs leves para distribuição interna, onde o ambiente de fontes está sob controle |

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

A incorporação de subconjunto é o modo recomendado para preservar as formas dos glifos independentemente do ambiente de destino. Referências a fontes do sistema exigem uma fonte compatível onde quer que o PDF seja aberto, e a aparência pode variar de um ambiente para outro. Texto convertido em contornos não pode ser selecionado nem pesquisado como texto comum.

## Escrita vertical

Basta especificar `writingMode` em um estilo, e o texto é composto verticalmente usando glifos de escrita vertical e dados dimensionais específicos da vertical (métricas verticais — larguras de avanço e afins). `vertical-rl` avança as linhas da direita para a esquerda; `vertical-lr` avança da esquerda para a direita.

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

## Pré-visualizando exatamente o mesmo relatório no navegador

O `RenderDocument` que você construiu para o PDF também pode ser renderizado diretamente em um Canvas. Pré-visualização e impressão compartilham o mesmo resultado de layout, de modo que "a tela e o papel ficaram diferentes" simplesmente não pode acontecer. Combinado com o layout fixo baseado em pt, esse é o alicerce de uma experiência WYSIWYG de pré-visualização e edição (a incorporação de fontes é o padrão; apenas o modo de referência a fontes do sistema depende do ambiente de visualização para sua aparência). Uma única chamada a `renderPage()` desenha a página, incluindo a preparação e a finalização da página.

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
  scale: 1.5, // escala de exibição: 1.0 desenha 1pt como 1px
  devicePixelRatio: window.devicePixelRatio, // mantém texto e linhas nítidos em telas de alta densidade (high-DPI)
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

Se você estiver construindo uma interface de pré-visualização em React, o pacote `tsreport-react` também está disponível.

## Usando o motor de fontes por conta própria

Mesmo sem construir um relatório, você pode usar cada capacidade isoladamente: análise de fontes, shaping (converter uma string na sequência e nas posições dos glifos realmente desenhados), medição de texto e geração de subconjuntos.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: largura da string em pt no corpo 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // IDs e posições dos glifos após o shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: dados de caminho de Bézier

console.log(measurement.width, shaped, glyph.outline)
```

## Convertendo um PDF existente em elementos de relatório (importação de PDF)

`importPdfPage()` analisa uma página de um PDF existente e a converte em um array de elementos de relatório do tsreport-core (`ElementDef`). Não se trata de um mero visualizador: o texto entra como `staticText`, as imagens como `image`, as formas como `path` — componentes que você pode editar e reorganizar diretamente neste motor de relatórios.

Pegue o PDF de um formulário que você vinha usando em papel, ou um PDF produzido por outro sistema, e use-o como base — acrescentando campos de mesclagem de dados, reorganizando o layout. É a porta de entrada para **transformar ativos de relatório existentes em templates**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: array de elementos de relatório (staticText / image / path, …)
// page.styles:   definições de estilo de texto referenciadas pelos elementos
// page.images:   dados de imagem referenciados pelos elementos
// page.fonts:    informações sobre as fontes referenciadas
console.log(pageCount, page.width, page.height, page.elements.length)
```

Os `elements` e `styles` importados podem ser colocados diretamente nas bandas do template. Senhas de PDFs criptografados, importação de anotações, conversão do texto importado em contornos e mais são controlados via `PdfImportOptions`.
## Dominando as expressões

Tudo o que é "dinâmico" em um relatório é escrito como expressão: o conteúdo que um `textField` imprime, a condição de impressão em `printWhenExpression`, os dados de código de barras, os caminhos de imagem, os dados passados a um sub-relatório — toda propriedade cujo tipo é `Expression` aceita a mesma linguagem de expressões.

As expressões vêm em duas formas.

- **Expressões de string** — strings como `"field.price * field.quantity"`. São um subconjunto seguro de JavaScript interpretado por um parser dedicado; `eval` e `new Function` nunca são usados. Os templates continuam podendo ser salvos como JSON (arquivos `.report`)
- **Expressões de callback** — funções TypeScript da forma `(field, vars, param, report) => …`. Você tem todo o poder da linguagem, mas o template deixa de poder ser salvo como JSON (isso pressupõe que você mantenha os templates em TypeScript)

Recomendamos primeiro ver até onde as expressões de string levam você e passar aos callbacks apenas quando elas ficarem aquém.

### Valores que podem ser referenciados em expressões

| Nome | Descrição |
| --- | --- |
| `field.*` | A linha de dados atual. Acesso aninhado como `field.customer.name` é suportado |
| `vars.*` | Variáveis (valores de agregação definidos em `variables`, descritos adiante). `var.*` funciona igual |
| `param.*` | Valores para o relatório inteiro: os valores passados via `parameters` da fonte de dados e os `defaultValue` dos `parameters` do template. Em um sub-relatório, os parâmetros passados pelo pai também aparecem aqui |
| `PAGE_NUMBER` | O número da página atual (a partir de 1) |
| `COLUMN_NUMBER` | O número da coluna atual (a partir de 1) |
| `REPORT_COUNT` | O número de linhas de dados processadas |
| `TOTAL_PAGES` | O total de páginas. **Referenciado tal qual, produz "o número de páginas até aqui"**; portanto, para imprimir o total final de páginas, combine-o com `evaluationTime: 'report'` ou `'auto'` (descritos adiante) |

Referenciar um campo inexistente não lança exceção; a expressão avalia para `undefined` (mesmo quando uma parte intermediária de `field.a.b` é `null`, ela retorna `null` com segurança).

### Sintaxe disponível nas expressões de string

| Categoria | Disponível |
| --- | --- |
| Literais | números (`1200`, `0.5`), strings (`'見積'` ou `"見積"`, com escapes como `\n`), `true` / `false` / `null` / `undefined` |
| Template literals | `` `合計 ${vars.total} 円` `` — uma expressão completa pode aparecer dentro de `${}` |
| Aritmética | `+` (adição numérica e concatenação de strings), `-`, `*`, `/` |
| Comparação | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| Lógicos | `&&`, `\|\|`, `!` (avaliação em curto-circuito, como em JavaScript) |
| Coalescência nula | `??` — retorna o lado direito quando o esquerdo é null/undefined |
| Condicional (ternário) | `condição ? valorSeVerdadeiro : valorSeFalso` |
| Outros | `-` / `+` unários, parênteses `( )`, acesso a membros com notação de ponto (nomes de propriedade podem ser japoneses: `field.顧客名`) |
| Funções embutidas | `format(value, pattern)` = formatação (descrita adiante) / `round(value, digits?)` = arredondamento half-up / `roundUp`, `roundDown`, `roundHalfEven` (arredondamento bancário), `ceil`, `floor`, `trunc` (em todas, o segundo argumento é o número de casas decimais, 0 quando omitido) / `now()` = hora atual |

**Não disponível**: `==` / `!=` (use `===` / `!==`), `%` e `**`, notação de colchetes (`field['a-b']`) e indexação de arrays, chamadas de método (`field.name.toUpperCase()` falha no momento da avaliação — as únicas funções chamáveis são as embutidas acima), atribuição, definição de funções, `new`, encadeamento opcional (`?.` — desnecessário, de todo modo, já que nulls intermediários nunca lançam exceção). Quando precisar de algo disso, use uma expressão de callback.

Essas restrições existem por segurança. As expressões de string são interpretadas por um parser dedicado e nunca são executadas como código, de modo que um template recebido de fora não pode contrabandear código arbitrário.

### Imprimindo um resultado calculado

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

Dados de exemplo:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

Isto imprime `¥3,960`.

### Construindo strings

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

Os valores embutidos no `${}` de um template literal são convertidos em string e concatenados. **null vira a string `"null"`**; portanto, acrescente `?? ''` aos valores que podem estar ausentes, como no exemplo.

### Alternando o conteúdo por uma condição

Use o operador ternário para alternar o que é impresso.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

Quando você quer mudar *se* algo é exibido, e não *o que* é exibido, use o `printWhenExpression` comum a todos os elementos (veja "Imprimindo um elemento apenas quando uma condição é atendida"). Para alternar a estilização (cor, negrito) por condição, especifique uma expressão de condição da mesma forma em `conditionalStyles` da definição de estilo.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### Formatando números e datas — `format` e `pattern`

O `textField` pode formatar o resultado da expressão no momento da impressão por meio da propriedade `pattern`. Para formatar parte de um valor dentro de uma expressão, use a função embutida `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

Os padrões numéricos combinam `#` (exibe o dígito se presente), `0` (preenchimento com zeros) e `,` (separador de milhar), e podem carregar um prefixo e um sufixo. O arredondamento é half-up.

| Padrão | Entrada | Saída |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

Os tokens de padrão de data são `yyyy` (ano com 4 dígitos), `MM` / `M` (mês com zero à esquerda / mês), `dd` / `d` (dia com zero à esquerda / dia), `HH` (hora com zero à esquerda, relógio de 24 horas), `mm` (minutos) e `ss` (segundos). Um valor null/undefined produz uma string vazia.

Para formatos além desses (datas em eras japonesas, nomes de dias da semana, tratamento de dígitos monetários e assim por diante), registre funções TypeScript nomeadas em `formatters` do template e escreva o nome em `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// Do lado do elemento: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` primeiro procura um formatador registrado com aquele nome e, se nenhum for encontrado, é interpretado como formato embutido. Formatadores são funções, portanto os templates que usam esse recurso são mantidos em TypeScript, não em JSON.

### Imprimindo totais, médias e contagens — variáveis (`variables`)

Agregações que atravessam as linhas de detalhe são definidas em `variables` do template. Cada vez que uma linha de dados é processada, a variável alimenta o resultado de sua `expression` em seu agregado, e as expressões podem referenciar o valor atual como `vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

Coloque um `textField` com `"expression": "vars.pageTotal"` na banda `pageFooter` para um subtotal de página, e um com `"expression": "vars.grandTotal"` na banda `summary` para um total geral.

**Lista de propriedades (cada entrada de `variables`)**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nome da variável, referenciado nas expressões como `vars.name` |
| `expression` | Expression | ✓ | Avaliada para cada linha; o resultado alimenta o agregado |
| `calculation` | `'sum'` = total / `'average'` = média / `'count'` = contagem / `'distinctCount'` = contagem de valores distintos / `'min'` = mínimo / `'max'` = máximo / `'first'` = primeiro valor / `'nothing'` = sobrescrita a cada linha (último valor) | ✓ | Método de agregação |
| `resetType` | `'report'` = continua agregando ao longo de todo o relatório (sem reinício; padrão) / `'page'` = reinicia a cada página / `'column'` = reinicia a cada coluna / `'group'` = reinicia a cada grupo nomeado em `resetGroup` / `'none'` = nunca reinicia, como `'report'`, mas sob avaliação adiada (`evaluationTime`) o valor fica congelado no momento em que o elemento foi posicionado (não é substituído depois pelo agregado final) |  | Escopo de reinício da agregação |
| `resetGroup` | string |  | Nome do grupo-alvo quando `resetType: 'group'` |
| `incrementCondition` | Expression |  | Quando definida, linhas cujo resultado de avaliação é falsy não alimentam o agregado (agregação condicional) |
| `initialValue` | Expression |  | Valor inicial na inicialização e a cada reinício |

Com `incrementCondition`, uma agregação condicional como "somar apenas uma determinada categoria" cabe em uma única variável:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

Para agregar no pai os resultados da execução de um sub-relatório, use os `returnValues` do elemento `subreport`, que gravam as variáveis do filho de volta em `vars.*` do pai (veja a lista de propriedades de `subreport`).

### Imprimindo números de página e o total de páginas

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

A chave é `evaluationTime: 'auto'`. Normalmente, as expressões são avaliadas no momento em que o elemento é posicionado, mas nesse ponto o total final de páginas ainda não é conhecido. Com `'auto'`, a expressão é analisada estaticamente e **cada referência é avaliada no seu próprio momento correto** — `PAGE_NUMBER` quando a página é finalizada, `TOTAL_PAGES` quando o relatório é concluído. Como `'auto'` precisa analisar a expressão, ele só está disponível para expressões de string (especificá-lo em uma expressão de callback lança exceção).

### Indo além das expressões de string — expressões de callback

Se o seu template é definido em TypeScript, você pode escrever uma função diretamente em qualquer lugar onde uma `Expression` é aceita. Ela recebe quatro argumentos, `(field, vars, param, report)`; por meio de `report` você alcança valores embutidos como `PAGE_NUMBER`, a função `format` e os `formatters` registrados.

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

Chamadas de método, expressões regulares, funções externas — tudo o que você pode escrever em TypeScript está disponível. Há duas contrapartidas: o template deixa de poder ser salvo ou transferido como JSON, e `evaluationTime: 'auto'` fica indisponível (valores explícitos como `'report'` continuam funcionando).

### O que acontece quando uma expressão falha

- **Erros de sintaxe e construções proibidas** (chamadas de método etc.) lançam um `ExpressionLanguageError` com informação de posição, que se propaga tal qual até quem chamou `createReport()`. Ele nunca é engolido em uma célula em branco
- **Referências a campos ou variáveis inexistentes** não são erros; avaliam para `undefined`. Em um `textField`, uma string vazia é impressa quando `blankWhenNull: true` está definido; sem isso, a string `null` é impressa
- Para validar expressões fornecidas pelo usuário antes da execução, `validateExpressionSource(source)` retorna o resultado da checagem sintática (um erro, ou `null`)

## Exemplos funcionais de todos os elementos

Aqui estão todos os 16 elementos fornecidos por `ElementDef`. Todo elemento recebe `x`, `y`, `width` e `height` (em pt, 1pt = 1/72 de polegada) e é posicionado no `elements` de uma banda ou de um `frame`.

| O que você quer fazer | Elemento |
| --- | --- |
| Imprimir texto fixo | `staticText` |
| Imprimir dados, variáveis ou resultados de expressões | `textField` |
| Desenhar uma linha | `line` |
| Desenhar um retângulo ou caixa arredondada | `rectangle` |
| Desenhar um círculo ou elipse | `ellipse` |
| Desenhar uma forma vetorial arbitrária | `path` |
| Posicionar uma imagem | `image` |
| Agrupar vários elementos dentro de uma moldura | `frame` |
| Imprimir uma tabela | `table` |
| Imprimir uma tabela cruzada | `crosstab` |
| Embutir um relatório dentro de outro | `subreport` |
| Imprimir um código de barras ou QR Code | `barcode` |
| Imprimir uma fórmula matemática | `math` |
| Imprimir SVG | `svg` |
| Criar um formulário PDF preenchível | `formField` |
| Forçar uma quebra de página ou de coluna em qualquer lugar | `break` |
| Imprimir um elemento apenas quando uma condição é atendida | `printWhenExpression` (atributo comum a todos os elementos) |

A seguir, cada elemento recebe uma definição que você pode soltar diretamente no array `elements` de uma banda, além de dados de exemplo para os elementos que usam expressões. Ao final da seção de cada elemento está a lista de propriedades específica daquele elemento. Para as propriedades comuns a todos os elementos (posição, cores, condições de impressão etc.) e as propriedades de estilo, veja "Referência de propriedades dos elementos" adiante.

### Imprimindo texto fixo — `staticText`

Imprime uma string escrita no template, exatamente como está. Use-o para títulos e rótulos.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | Tipo do elemento |
| `text` | string | ✓ | A string fixa a imprimir |
| `actualText` | string |  | Texto substituto para quando os caracteres visíveis diferem do texto obtido por cópia e busca (PDF /ActualText). Usado principalmente pela importação de PDF para preservar a configuração do PDF de origem |
| `hyperlink` | HyperlinkDef |  | Hiperlink (veja **`HyperlinkDef`** na seção de propriedades comuns) |
| `anchorName` | string |  | Nome de âncora. Registrado como destino para marcadores e links internos do documento (`hyperlink` do tipo `'localAnchor'`) |
| `bookmarkLevel` | number |  | Nível hierárquico (1 = nível superior, 1–6) para listar o texto deste elemento no sumário (marcadores) exibido na barra lateral do visualizador de PDF |

Observação: adicionalmente, todas as propriedades comuns aos elementos e todas as propriedades de `TextProperties` podem ser especificadas.

### Imprimindo dados e resultados de expressões — `textField`

Imprime o resultado da avaliação de `expression`. Ela pode referenciar `field.*` (dados), `vars.*` (variáveis), `param.*` (parâmetros), `PAGE_NUMBER` e mais, e template literals permitem construir strings. Para a linguagem de expressões completa, veja "Dominando as expressões". Use `pattern` para formatação de números/datas e `stretchWithOverflow` para deixar a altura crescer com a quantidade de texto.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

Dados de exemplo:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | Tipo do elemento |
| `expression` | Expression | ✓ | Expressão que retorna o valor a imprimir |
| `pattern` | string |  | Padrão de formato. Um formatador personalizado registrado no template (um nome de `formatters`) tem precedência; caso contrário, o valor é formatado com o formatador embutido |
| `blankWhenNull` | boolean |  | Imprime uma string vazia quando o resultado da expressão é null/undefined (sem isso, a string `'null'` é impressa) |
| `stretchWithOverflow` | boolean |  | Quando o conteúdo não cabe em height, estica a altura do elemento para acomodar o conteúdo |
| `evaluationTime` | `'now'` = avalia imediatamente no local (padrão) / `'band'` = avalia quando a banda é finalizada / `'column'` = avalia no fim da coluna / `'page'` = avalia no fim da página / `'group'` = avalia quando o grupo nomeado em `evaluationGroup` se fecha / `'report'` = avalia no fim do relatório (TOTAL_PAGES etc. são finais) / `'auto'` = avalia cada variável e valor embutido referenciados pela expressão individualmente, cada qual no seu próprio momento de reinício (somente expressões de string; expressões de callback lançam exceção) |  | Quando a expressão é avaliada. Com qualquer valor diferente do padrão, a área é primeiro reservada vazia no momento do posicionamento e preenchida quando o valor é finalizado no momento correspondente. Usos típicos: exibir um total de grupo antes do grupo (`'group'`), imprimir o total final de páginas (`'report'`) |
| `evaluationGroup` | string |  | Nome do grupo-alvo quando `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = linhas que não cabem não são desenhadas (padrão; idêntico a `'truncate'` na implementação atual) / `'truncate'` = corta o texto que não cabe linha a linha / `'ellipsisChar'` = apara a última linha em um limite de caractere e acrescenta `...` / `'ellipsisWord'` = apara a última linha em um limite de palavra e acrescenta `...` |  | Tratamento do texto que não cabe na altura quando `stretchWithOverflow` está desligado. Padrão: `none` |
| `hyperlink` | HyperlinkDef |  | Hiperlink (veja **`HyperlinkDef`** na seção de propriedades comuns) |
| `anchorName` | string |  | Nome de âncora. Registrado como destino para marcadores e links internos do documento (`hyperlink` do tipo `'localAnchor'`) |
| `bookmarkLevel` | number |  | Nível hierárquico (1 = nível superior, 1–6) para listar o texto deste elemento no sumário (marcadores) exibido na barra lateral do visualizador de PDF |

Observação: adicionalmente, todas as propriedades comuns aos elementos e todas as propriedades de `TextProperties` podem ser especificadas. `isPrintRepeatedValues: false` é respeitado por este elemento (suprime a impressão de valores idênticos consecutivos).

### Desenhando uma linha — `line`

Este exemplo é uma linha horizontal de altura 0. `lineStyle` aceita `dashed` e outros além de `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | Tipo do elemento. O segmento é desenhado do canto superior esquerdo do elemento `(x, y)` ao canto inferior direito `(x+width, y+height)` (`height: 0` dá uma linha horizontal, `width: 0` uma vertical, ambos não nulos uma diagonal) |
| `lineWidth` | number |  | Largura da linha (pt). Padrão: 1 |
| `lineStyle` | `'solid'` = contínua / `'dashed'` = tracejada / `'dotted'` = pontilhada |  | Estilo da linha. Padrão: solid |
| `lineColor` | string |  | Cor da linha. Padrão: o `forecolor` do elemento, ou `#000000` se este também estiver ausente |

### Desenhando um retângulo ou caixa arredondada — `rectangle`

`cornerRadii` permite arredondar cada canto individualmente.

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

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | Tipo do elemento |
| `radius` | number |  | Raio dos cantos (pt, compartilhado por todos os cantos) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | Raio por canto (pt) |
| `fill` | FillDef |  | Preenchimento (veja **`FillDef`** na seção de propriedades comuns). Padrão: o `backcolor` do estilo (quando não é `transparent`) |
| `stroke` | string |  | Cor da borda. Padrão: o `forecolor` do estilo |
| `strokeWidth` | number |  | Largura da borda (pt). Padrão: 1 |

### Desenhando um círculo ou elipse — `ellipse`

Desenha uma elipse inscrita na largura e na altura do elemento.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | Tipo do elemento. Desenha a elipse inscrita na caixa delimitadora do elemento (centro `(x+width/2, y+height/2)`, raios `width/2` × `height/2`) |
| `fill` | FillDef |  | Preenchimento (veja **`FillDef`** na seção de propriedades comuns). Sem preenchimento quando omitido |
| `stroke` | string |  | Cor da borda. Sem borda quando omitido |
| `strokeWidth` | number |  | Largura da borda (pt). Padrão: 1 (quando `stroke` está definido) |

### Desenhando uma forma vetorial arbitrária — `path`

Coloque a sintaxe de caminho SVG em `d` e seu sistema de coordenadas em `viewBox`. A forma é escalada para caber na moldura do elemento.

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

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | Tipo do elemento |
| `d` | string | ✓ | Dados de caminho SVG (M/L/C/Z etc.). As coordenadas são pt locais do elemento |
| `pdfSourceVector` | PdfSourceVectorDef |  | Produzido pela importação de PDF para preservar uma forma que aparece repetidamente (símbolos de mapa etc.) como "uma definição + N posicionamentos" (veja **`PdfSourceVectorDef`** adiante). Quando definido, `d` não é analisado. Desnecessário em templates escritos à mão |
| `affineTransform` | [number, number, number, number, number, number] |  | Matriz de transformação afim que mapeia as coordenadas do caminho para as coordenadas locais do elemento antes do desenho. `[a, b, c, d, e, f]` dá `x' = a·x + c·y + e`, `y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. As coordenadas do caminho são escaladas dessa região para a largura e a altura do elemento |
| `fill` | FillDef |  | Preenchimento (veja **`FillDef`** na seção de propriedades comuns). Sem preenchimento quando omitido |
| `fillRule` | `'nonzero'` (padrão) / `'evenodd'` |  | Regra que decide quais regiões contam como "interior" em caminhos autointersectantes ou aninhados. Para abrir um furo estilo rosquinha, `'evenodd'` é a escolha confiável |
| `fillOpacity` | number |  | Opacidade do preenchimento (0.0–1.0) |
| `stroke` | FillDef |  | Traço (cores sólidas, bem como gradientes e mais). Sem traço quando omitido |
| `strokeWidth` | number |  | Largura do traço (pt). Padrão: 1 (quando `stroke` está definido) |
| `strokeOpacity` | number |  | Opacidade do traço (0.0–1.0) |
| `strokeLinecap` | `'butt'` = corte na extremidade / `'round'` = extremidade arredondada / `'square'` = extremidade quadrada (estendida em metade da largura da linha) |  | Forma da extremidade da linha |
| `strokeLinejoin` | `'miter'` = meia-esquadria (pontiaguda) / `'round'` = arredondada / `'bevel'` = chanfrada |  | Forma da junção das linhas |
| `strokeMiterLimit` | number |  | Limite de meia-esquadria. Padrão: 10 |
| `strokeDasharray` | number[] |  | Padrão de tracejado (array de comprimentos de traço e intervalo, pt) |
| `strokeDashoffset` | number |  | Deslocamento inicial dentro do padrão de tracejado (pt) |

### Posicionando uma imagem — `image`

Especifique a imagem com `sourceExpression` (uma expressão) ou `source` (um valor fixo). `scaleMode` controla como a imagem se encaixa na moldura, e `onError` escolhe o comportamento quando a imagem não pode ser encontrada (`error` = lançar erro / `blank` = deixar em branco / `icon` = exibir um ícone).

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

Dados de exemplo:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | Tipo do elemento |
| `source` | string | | Referência fixa de imagem (ID de imagem). Escreva tal qual um caminho relativo ao arquivo `.report`, um caminho absoluto, uma URL, um data URI etc. (para as regras de ID, veja "Restrições de carregamento de recursos e regras de ID de imagem" adiante). Usada quando `sourceExpression` está ausente ou seu resultado não resolve |
| `sourceExpression` | Expression | | Expressão dinâmica da origem da imagem. Um resultado string é resolvido como ID de imagem; um resultado `Uint8Array` é tratado como os próprios dados da imagem |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | Como a imagem é escalada. `'clip'` = posiciona a imagem no tamanho natural e recorta pela moldura do elemento / `'fillFrame'` = estica para preencher a moldura, ignorando a proporção / `'retainShape'` = mantém a proporção e escala para o maior tamanho que cabe na moldura / `'realSize'` = tamanho natural mais recorte pela moldura (implementado de forma idêntica a `'clip'`). Padrão: `'retainShape'`. Quando o tamanho da imagem não pode ser determinado, comporta-se como `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | Posicionamento horizontal da imagem dentro da moldura (afeta a colocação das margens com `retainShape` e a posição do recorte com `clip`/`realSize`). Padrão: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | Posicionamento vertical da imagem dentro da moldura. Padrão: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | Comportamento quando a origem da imagem é indefinida ou falha ao resolver. `'error'` = lança exceção / `'blank'` = não desenha nada / `'icon'` = desenha uma caixa cinza de espaço reservado com uma marca ×. Padrão: `'icon'` |
| `lazy` | boolean | | Existe apenas na definição de tipos; não é referenciado pelas implementações atuais do motor de layout nem dos renderizadores (fora do escopo da especificação) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | Ângulo de rotação da imagem (graus) |
| `affineTransform` | [number, number, number, number, number, number] | | Forma alternativa de especificar o posicionamento diretamente como matriz. `[a, b, c, d, e, f]` é uma transformação que mapeia a imagem no quadrado unitário (0–1) por `x' = a·x + c·y + e`, `y' = b·x + d·y + f`; quando definida, o cálculo de posicionamento de `scaleMode`/`hAlign`/`vAlign`/`rotation` é pulado. Usada principalmente pela importação de PDF para preservar o posicionamento original |
| `opacity` | number | | Opacidade (0.0–1.0) |
| `interpolate` | boolean | | Faz o visualizador suavizar os limites dos pixels quando uma imagem de baixa resolução é ampliada (PDF /Interpolate). Habilite para fotos; desabilite para imagens que devem permanecer nítidas, como códigos de barras |
| `alternates` | PdfImageAlternateDef[] |  | Imagens alternativas de PDF (/Alternates) para usar imagens diferentes na tela e na impressão. Cada entrada tem duas propriedades: `source` = referência à imagem alternativa (obrigatória) e `defaultForPrinting` = se esta é a usada ao imprimir |
| `opi` | PdfOpiMetadataDef |  | Informações OPI para impressão comercial, em que uma imagem de espaço reservado de baixa resolução é trocada pela imagem de alta resolução no momento da saída. Principalmente para preservação na importação de PDF (veja **`PdfOpiMetadataDef`** adiante) |
| `measure` | PdfMeasurement |  | Informações de escala e sistema de coordenadas usadas pelas ferramentas de medição do visualizador em PDFs de desenho técnico e de mapas. Principalmente para preservação na importação de PDF (veja **`PdfMeasurement`** adiante) |
| `pointData` | PdfPointData[] |  | Dados de pontos (latitude/longitude etc.) em PDFs de mapas. Principalmente para preservação na importação de PDF (veja **`PdfPointData`** adiante) |
| `hyperlink` | HyperlinkDef | | Hiperlink (`type`: `'reference'` = URL / `'localAnchor'` = âncora no documento / `'localPage'` = página no documento / `'remoteAnchor'`, `'remotePage'` = âncora/página dentro de um PDF externo; `target`: expressão para o destino do link; `remoteDocument?`: expressão para o caminho do PDF externo) |

### Agrupando vários elementos dentro de uma moldura — `frame`

Agrupa elementos filhos; `border` desenha uma moldura e `clip` recorta o que transborda. As coordenadas dos elementos filhos usam o canto superior esquerdo do frame como origem.

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

Dados de exemplo:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | Tipo do elemento |
| `clip` | boolean | | Se os filhos são recortados no limite do frame. Padrão: true |
| `border` | BorderDef | | Borda (veja **`BorderDef`** na seção de propriedades comuns) |
| `padding` | Padding | | Preenchimento interno (`top?`/`bottom?`/`left?`/`right?`, cada um em pt) |
| `rotation` | number | | Ângulo de rotação do frame (graus, anti-horário em coordenadas de página) |
| `rotationOriginX` | number | | X da origem de rotação (relativo ao frame, pt). Padrão: 0 |
| `rotationOriginY` | number | | Y da origem de rotação (relativo ao frame, pt). Padrão: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Matriz afim que mapeia as coordenadas locais do frame (Y apontando para cima) para o espaço de coordenadas do pai (layout e significado da matriz como no `affineTransform` de `image`). Usada principalmente pela importação de PDF para preservar o posicionamento original |
| `pdfForm` | PdfFormXObjectDef |  | Na importação de PDF, retém e reemite o sistema de coordenadas e os metadados que um componente (Form XObject) do PDF de origem carregava (veja **`PdfFormXObjectDef`** adiante). Desnecessário em templates escritos à mão |
| `hyperlink` | HyperlinkDef | | Hiperlink (mesma estrutura da propriedade homônima em `image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | Caminho de recorte em sintaxe de caminho SVG. `d` = dados do caminho, `fillRule` = regra de preenchimento |
| `transparencyGroup` | boolean | | Mantém o limite do grupo de transparência do PDF mesmo quando nem `isolated` nem `knockout` estão habilitados. Mantê-lo garante que o resultado da composição de opacidade e mesclagem permaneça o mesmo que se o frame fosse composto como uma única imagem achatada (principalmente para fidelidade na importação de PDF) |
| `isolated` | boolean | | Grupo de transparência isolado (PDF /Group /I). Quando este (ou `knockout` / `softMask`) está definido, o frame é composto como uma unidade antes da aplicação de opacidade, mesclagem e máscaras |
| `knockout` | boolean | | Grupo de transparência knockout (PDF /Group /K). Filhos sobrepostos dentro do grupo não transparecem uns através dos outros; em cada posição, apenas o filho mais acima é composto com o plano de fundo |
| `softMask` | FrameSoftMaskDef | | Máscara de suavidade que torna o frame parcialmente transparente (veja **`FrameSoftMaskDef`** na tabela abaixo). Usa a renderização de seus `elements` como um "mapa de transparência", possibilitando efeitos como esmaecer gradualmente ao longo de um gradiente |
| `deviceParams` | DeviceParamsDef | | Parâmetros para a etapa de pré-impressão (prepress) da impressão comercial (veja **`DeviceParamsDef`** na tabela abaixo). Desnecessários em relatórios comuns; usados principalmente pela importação de PDF para preservar as configurações do PDF de origem |
| `elements` | ElementDef[] | | Elementos filhos dentro do frame |

**`FrameSoftMaskDef`** (estrutura de `softMask`)
| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | Tipo da máscara. `'luminosity'` = quanto mais clara uma área da máscara, mais opaco o frame / `'alpha'` = quanto mais opaca uma área da máscara, mais opaco o frame |
| `colorSpace` | PdfProcessColorSpaceDef | | Espaço de cor de mesclagem do grupo de transparência da máscara |
| `isolated` | boolean | | Flag de isolamento do grupo de transparência da máscara |
| `knockout` | boolean | | Flag de knockout do grupo de transparência da máscara |
| `backdrop` | [number, number, number] | | Cor de fundo /BC para máscaras de luminosidade (DeviceRGB 0–1). Padrão: preto |
| `elements` | ElementDef[] | ✓ | Elementos compostos como grupo de transparência para definir a máscara |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | Função de transferência /SMask /TR que remapeia os valores da máscara (0..1) |

**`DeviceParamsDef`** (estrutura de `deviceParams`. Para pré-impressão comercial e normalmente desnecessária — principalmente para preservação na importação de PDF)
| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | Função de transferência /TR: `'Identity'` / `'Default'` / uma única função compartilhada por todas as chapas de cor / um array de funções, uma por chapa das quatro cores |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | Função de geração de preto /BG (`'Default'` = padrão do dispositivo via /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | Função de remoção de cor de base /UCR (`'Default'` = padrão do dispositivo via /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | Retícula /HT (retícula tipo 1 / arrays de limiar tipo 6, 10, 16 / coleção por colorante tipo 5) |
| `halftoneOrigin` | [number, number] | | Origem da retícula do PDF 2.0 (/HTO, pixels no espaço do dispositivo) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | Controle de compensação de ponto preto do PDF 2.0 (/UseBlackPtComp) |
| `flatness` | number | | Tolerância de achatamento (/FL) |
| `smoothness` | number | | Tolerância de suavidade de sombreamento (/SM) |
| `strokeAdjustment` | boolean | | Ajuste automático de traço (/SA) |

### Imprimindo uma tabela — `table`

Uma tabela com linhas de cabeçalho, linhas de detalhe e linhas de rodapé. Passe um array de dados de linha via `dataSourceExpression`, e as linhas de detalhe se repetem uma vez por elemento do array.

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

Dados de exemplo (cada elemento de `items` vira uma linha de detalhe da tabela):

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

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | Tipo do elemento |
| `columns` | TableColumnElementDef[] | ✓ | Array de definições de coluna. Se a soma das `width` de todas as colunas diferir da largura do elemento, todas as colunas são escaladas proporcionalmente para caberem exatamente na largura do elemento |
| `headerRows` | TableRowElementDef[] |  | Array de linhas de cabeçalho. Quando a tabela se divide entre páginas, elas são desenhadas de novo no topo de cada página |
| `detailRows` | TableRowElementDef[] |  | Array de linhas de detalhe. Desenhadas repetidamente, uma vez por linha de dados (linhas de dados × todas as linhas de detailRows) |
| `footerRows` | TableRowElementDef[] |  | Array de linhas de rodapé. Quando a tabela se divide entre páginas, são desenhadas apenas na última página |
| `dataSourceExpression` | Expression |  | Usa o array em que a expressão avalia como as linhas de dados desta tabela. Quando omitida, as linhas da fonte de dados principal são usadas. Lança exceção quando o resultado não é um array |

**`TableColumnElementDef`** (cada entrada de `columns` = uma definição de coluna)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `width` | number | ✓ | Largura da coluna (pt). Se o total de todas as colunas não coincidir com a largura do elemento, as larguras são distribuídas proporcionalmente |
| `style` | TableCellStyleDef |  | Estilo de célula padrão desta coluna. Quando uma célula especifica uma propriedade homônima, a configuração da célula vence (bordas são mescladas aresta por aresta) |

**`TableRowElementDef`** (cada entrada de `headerRows`/`detailRows`/`footerRows` = uma definição de linha)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `height` | number | ✓ | Altura da linha (pt). Tratada como mínimo: a linha se expande automaticamente quando texto com quebra de linha ou elementos filhos na célula não cabem (em células com rowSpan, o transbordo de conteúdo expande a última linha do intervalo mesclado) |
| `cells` | TableCellElementDef[] | ✓ | Array de definições de célula desta linha. Colunas ocupadas por um `rowSpan` de uma linha acima são puladas automaticamente durante o posicionamento |

**`TableCellElementDef`** (cada entrada de `cells` = uma definição de célula. Além do seguinte, toda propriedade de `TableCellStyleDef` pode ser especificada diretamente)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `text` | string |  | Texto fixo da célula |
| `expression` | Expression |  | Expressão de vínculo de dados. A forma simples `field.name` lê o valor diretamente da linha de dados; qualquer outra coisa é resolvida pela avaliação de expressões do motor. Tem precedência sobre `text` quando especificada |
| `colSpan` | number |  | Número de colunas a mesclar horizontalmente. Padrão: 1 |
| `rowSpan` | number |  | Número de linhas a mesclar verticalmente. Padrão: 1. A altura da célula é a soma das alturas das linhas no intervalo mesclado |
| `elements` | ElementDef[] |  | Array de elementos filhos posicionados dentro da célula. Quando especificado, tem precedência sobre a renderização de `text`/`expression` e é desenhado recortado pela área menos o padding. A altura da linha se expande automaticamente até a altura de que os filhos precisam |

**`TableCellStyleDef`** (estilo de célula usado nas definições de célula e no `style` de uma coluna)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = alinhado à esquerda / `'center'` = centralizado / `'right'` = alinhado à direita |  | Alinhamento horizontal do texto |
| `vAlign` | `'top'` = alinhado ao topo / `'middle'` = centralizado / `'bottom'` = alinhado à base |  | Alinhamento vertical do texto |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotação do texto (graus). Padrão: 0 |
| `backcolor` | string |  | Cor de fundo da célula |
| `forecolor` | string |  | Cor do texto. Padrão: `#000000` |
| `fontId` | string |  | ID da fonte. Padrão: `'default'` |
| `fontSize` | number |  | Tamanho da fonte (pt). Padrão: 10 |
| `bold` | boolean |  | Negrito |
| `italic` | boolean |  | Itálico |
| `underline` | boolean |  | Sublinhado |
| `strikethrough` | boolean |  | Tachado |
| `lineSpacing` | LineSpacingDef |  | Configurações de entrelinha (veja **`LineSpacingDef`** na seção de propriedades comuns) |
| `letterSpacing` | number |  | Espaçamento entre letras (pt). Adiciona uma quantidade fixa entre todos os caracteres (valores negativos comprimem) |
| `wordSpacing` | number |  | Espaçamento entre palavras (pt; largura extra adicionada aos caracteres de espaço) |
| `firstLineIndent` | number |  | Recuo da primeira linha (pt) |
| `leftIndent` | number |  | Recuo à esquerda (pt) |
| `rightIndent` | number |  | Recuo à direita (pt) |
| `wrap` | boolean |  | Quebra automática de texto. Padrão: true |
| `shrinkToFit` | boolean |  | Reduz automaticamente o tamanho da fonte para que o texto caiba na célula |
| `minFontSize` | number |  | Tamanho mínimo da fonte (pt) sob `shrinkToFit`. Padrão: 4 |
| `fitWidth` | boolean |  | Ajusta automaticamente o tamanho da fonte (nos dois sentidos, reduzindo e ampliando) para que a linha mais longa caiba exatamente na largura da célula. Uma célula assim não contribui para a expansão automática da altura da linha |
| `outlineText` | boolean |  | Desenha o texto convertido em contornos (caminhos) |
| `padding` | number |  | Preenchimento interno da célula (pt). Padrão: 2 |
| `border` | BorderDef |  | Borda por célula (veja **`BorderDef`** na seção de propriedades comuns). Mesclada com a borda do `style` da coluna; a configuração da célula vence |
| `opacity` | number |  | Opacidade (0.0–1.0). Abaixo de 1, a célula inteira é desenhada como um grupo de opacidade |

### Imprimindo uma tabela cruzada — `crosstab`

Agrega os dados por grupos de linha × grupos de coluna. Este exemplo soma `amount` por região × categoria e também emite subtotais e um total geral.

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

Dados de exemplo:

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

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | Tipo do elemento |
| `rowGroups` | { field, headerFormat? }[] | ✓ | Array de definições de grupo de linha. Múltiplas entradas formam níveis de grupo aninhados, cada nível ocupando uma coluna de cabeçalho de linha a partir da esquerda. As células de cabeçalho dos grupos externos são mescladas verticalmente ao longo do seu intervalo |
| `columnGroups` | { field, headerFormat? }[] | ✓ | Array de definições de grupo de coluna. Grupos externos ficam empilhados em cima e os internos abaixo; cabeçalhos externos são mesclados horizontalmente ao longo da largura de suas colunas |
| `measures` | { field, calculation, format? }[] | ✓ | Array de definições de medida (célula de agregação). Com múltiplas entradas, elas são empilhadas verticalmente dentro de cada célula de dados, cada uma ocupando um slot (no mínimo `cellHeight`) e aplicando seu próprio `calculation`/`format`. Um array vazio é tratado como uma única medida implícita com `field: ''` e `calculation: 'sum'` |
| `rowHeaderWidth` | number |  | Largura do cabeçalho de linha (pt), aplicada a cada nível dos grupos de linha. Padrão: 80 |
| `columnHeaderHeight` | number |  | Altura do cabeçalho de coluna (pt), aplicada a cada nível dos grupos de coluna. Padrão: 20 |
| `cellWidth` | number |  | Largura da célula de dados (pt). Padrão: 60 |
| `cellHeight` | number |  | Altura da célula de dados (pt; a altura do slot de uma medida). Expande-se automaticamente com a quebra de texto. Padrão: 20 |
| `border` | { color?, width? } |  | Configurações de borda (veja a tabela abaixo). Somente quando especificadas é que a moldura externa, os separadores de linha/coluna e os separadores de nível de cabeçalho são desenhados (eles nunca atravessam uma célula de cabeçalho externo mesclada) |
| `showSubtotals` | boolean |  | Exibe subtotais. Padrão: false. Quando true, uma linha/coluna de subtotal rotulada "Total" é inserida ao final do bloco de cada grupo, exceto para o nível mais interno. Os valores de subtotal são reagregados a partir dos valores brutos usando o `calculation` de cada medida |
| `showGrandTotal` | boolean |  | Exibe o total geral. Padrão: false. Quando true, uma linha/coluna de total geral rotulada "Total" é acrescentada ao final (não emitida quando há zero linhas de dados). Os valores do total geral também são reagregados a partir dos valores brutos |
| `dataSourceExpression` | Expression |  | Usa o array em que a expressão avalia como as linhas de dados desta tabela cruzada. Quando omitida (ou quando o resultado não é um array), as linhas da fonte de dados principal são usadas |

**Definição de grupo de linha/coluna (cada entrada de `rowGroups`/`columnGroups`)**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nome do campo pelo qual agrupar. Os grupos aparecem na ordem da primeira ocorrência nos dados |
| `headerFormat` | string |  | Formato de exibição dos valores de cabeçalho. Um formato simples aplicado somente quando o valor é numérico (`'#,##0'` ou qualquer coisa contendo `,` → separadores de milhar; uma especificação decimal como `'.00'` → decimais fixas naquela precisão; qualquer outra coisa → conversão simples em string) |

**Definição de medida (cada entrada de `measures`)**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nome do campo a agregar. Valores não numéricos são convertidos em números; valores que não podem ser convertidos contam como 0 |
| `calculation` | `'sum'` = total / `'count'` = contagem / `'average'` = média / `'min'` = mínimo / `'max'` = máximo | ✓ | Método de agregação. Subtotais e totais gerais também são reagregados a partir do conjunto de valores brutos usando o mesmo método, de modo que até `average` e afins saem corretos |
| `format` | string |  | Formato de exibição dos valores agregados (o mesmo formato simples de `headerFormat`: `'#,##0'` ou `,` → separadores de milhar, `'.NN'` → NN decimais fixas, nenhum → conversão simples em string) |

**Configurações de borda (`border`)**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `color` | string |  | Cor da linha. Padrão: `#000000` |
| `width` | number |  | Largura da linha (pt) da moldura externa e dos limites entre cabeçalho e dados. Padrão: 0.5. Os separadores internos de linha/coluna são desenhados com metade dessa largura |

### Embutindo um relatório dentro de outro — `subreport`

A ideia foi explicada em **Fundamentos do layout de relatórios**. Aqui está uma definição completa que funciona como está. O sub-relatório é executado uma vez por linha de detalhe do pai, e o array passado via `dataSourceExpression` vira as `rows` do sub-relatório.

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

Dados de exemplo:

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

O `subreport.report` embutido é, por si só, um template independente. Ele referencia cada elemento dos `items` recebidos como valores `field.*` comuns e recebe os parâmetros passados pelo pai por meio de `param.*`. Note que templates executados como sub-relatórios não emitem suas bandas `pageHeader`, `pageFooter` nem `background` (a gestão de páginas é tarefa do relatório pai). Títulos vão na banda `title`, assim:

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

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | Tipo do elemento |
| `templateExpression` | Expression | ✓ | Expressão que retorna o nome do template filho. Ao usar `createReportFromFile()` ele é resolvido automaticamente como caminho de arquivo; ao chamar `createReport()` diretamente, resolva-o com a opção `resolveSubreportTemplate` (uma função que recebe o nome e o diretório de trabalho e retorna `{ template, workingDirectory? }`, ou `null` quando não consegue resolver) |
| `dataSourceExpression` | Expression | | Expressão que retorna a fonte de dados do relatório filho (um array de objetos de linha). Quando omitida, as linhas da fonte de dados do pai são usadas tal qual. Um resultado que não seja array é tratado como dados vazios |
| `parameters` | SubreportParamDef[] |  | Parâmetros passados ao relatório filho (veja **`SubreportParamDef`** na tabela abaixo). Eles têm precedência sobre entradas homônimas de `parametersMapExpression` |
| `parametersMapExpression` | Expression | | Expressão que retorna um objeto mesclado nos parâmetros do filho (os `parameters` individuais vencem) |
| `returnValues` | ReturnValueDef[] |  | Definições que retornam valores de variáveis do relatório filho ao pai (veja **`ReturnValueDef`** na tabela abaixo) |
| `usingCache` | boolean | | Dentro de uma execução do relatório pai, armazena em cache e reutiliza os templates filhos resolvidos por nome de template |
| `runToBottom` | boolean | | Depois do conteúdo do sub-relatório, consome o espaço restante da página/coluna (empurrando os elementos subsequentes para baixo do espaço restante) |

**`SubreportParamDef`** (cada entrada de `parameters` = um parâmetro passado ao relatório filho)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nome do parâmetro passado ao relatório filho (referenciado no lado do filho como `param.name`) |
| `expression` | Expression | ✓ | Expressão que calcula o valor do parâmetro. Avaliada no contexto do relatório pai |

**`ReturnValueDef`** (cada entrada de `returnValues` = uma definição que retorna um valor do filho ao pai)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nome da variável que recebe o valor no lado do pai. Essa variável fica excluída de ser sobrescrita pelo cálculo normal de variáveis do pai |
| `subreportVariable` | string | ✓ | Nome da variável de origem no lado do filho. Quando o relatório filho termina de executar, seu valor é propagado ao pai |
| `calculation` | `'nothing'` = atribui o valor do filho tal qual (sobrescrito a cada execução) / `'count'` = contagem / `'sum'` = total / `'average'` = média / `'min'` = mínimo / `'max'` = máximo / `'first'` = mantém o primeiro valor obtido | ✓ | Como o valor é incorporado à variável do pai. Tudo, exceto `'nothing'`, agrega entre execuções quando o sub-relatório executa várias vezes |

### Imprimindo códigos de barras e QR Codes — `barcode`

`barcodeType` aceita Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code (`qrcode`), Data Matrix, PDF417 e mais. `showText` adiciona o texto legível por humanos para referência na leitura.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

Dados de exemplo:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | Tipo do elemento |
| `barcodeType` | string | ✓ | Simbologia do código de barras (sem distinção de maiúsculas/minúsculas). Valores permitidos: `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. Qualquer outro valor não é suportado e desenha um espaço reservado |
| `expression` | Expression | ✓ | Expressão que retorna os dados do código de barras (o resultado da avaliação é convertido em string e codificado) |
| `showText` | boolean | | Exibe o texto legível por humanos abaixo dos códigos de barras unidimensionais (altura da área de texto 10pt, tamanho de fonte 8pt; a altura das barras encolhe nessa medida). Não usado em códigos bidimensionais (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | Nível de correção de erros do QR Code — a capacidade de permanecer legível mesmo quando parte do código está borrada ou ausente. A resiliência sobe de `'L'` a `'H'`, ao custo de um padrão mais fino. `'Q'` ou `'H'` é recomendado para mídias de impressão grosseiras. Padrão: `'M'`. Efetivo apenas para QR Codes (o nível de correção de erros do PDF417 é selecionado automaticamente a partir do comprimento dos dados) |

### Imprimindo fórmulas matemáticas — `math`

Compõe fórmulas no estilo LaTeX. A composição matemática exige uma fonte dedicada que carregue métricas específicas de matemática (a tabela MATH do OpenType); exemplos disponíveis livremente incluem STIX Two Math e Latin Modern Math. Uma fonte comum de corpo de texto não serve como substituta. `formula` é avaliada como expressão (este exemplo referencia o campo `formula` dos dados).

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

Dados de exemplo:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

Ao usar o elemento `math`, registre uma fonte que tenha uma tabela MATH do OpenType tanto em `fontMap` quanto no `fonts` da saída de PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | Tipo do elemento |
| `formula` | Expression | ✓ | Expressão que retorna uma string de fórmula LaTeX (envolva uma fórmula fixa em `'...'` como literal de string dentro da expressão). Nada é desenhado quando o resultado é uma string vazia |
| `mathFontFamily` | string | | Fonte usada para a renderização matemática (um ID de fonte registrado no fontMap). Padrão: o fontFamily do estilo do elemento, ou `'default'` se este também estiver ausente |
| `fontSize` | number | | Tamanho da fonte (pt). Padrão: o fontSize do estilo do elemento, ou 12 se este também estiver ausente |
| `color` | string | | Cor do texto. Padrão: resolvida na ordem — forecolor do elemento → forecolor do estilo → `#000000` |

### Imprimindo SVG — `svg`

Renderiza um documento SVG diretamente no relatório. `svgContent` é avaliada como expressão (uma string SVG fixa pode ser fornecida via dados ou parâmetros).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

Dados de exemplo:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | Tipo do elemento |
| `svgContent` | Expression | ✓ | Expressão que retorna uma string de marcação SVG. O resultado é convertido em string e renderizado como SVG na posição e no tamanho do elemento |

### Criando formulários PDF preenchíveis — `formField`

Posiciona campos de formulário que quem abre o PDF pode preencher. `fieldType` aceita `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox` e `signature`.

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

Dados de exemplo (viram o valor inicial do formulário):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | Tipo do elemento. Um campo de formulário interativo. Os backends de pré-visualização desenham sua aparência inicial, e a saída de PDF o emite como um campo genuinamente preenchível |
| `fieldType` | `'text'` = campo de entrada de texto (PDF /Tx) / `'checkbox'` = caixa de seleção (/Btn) / `'radio'` = botão de opção (/Btn; widgets que compartilham o mesmo `fieldName` formam um grupo mutuamente exclusivo) / `'pushbutton'` = botão de ação (/Btn; legenda mais ação de URI opcional) / `'dropdown'` = lista suspensa (caixa de combinação, /Ch) / `'listbox'` = caixa de lista (/Ch) / `'signature'` = campo de assinatura (/Sig) | ✓ | Tipo do campo |
| `fieldName` | string | ✓ | Nome totalmente qualificado do campo. Deve ser único dentro do documento (duplicatas lançam exceção). A exceção é `radio`, em que compartilhar o mesmo nome forma um grupo mutuamente exclusivo |
| `value` | Expression |  | Valor inicial (text: o valor digitado; dropdown/listbox: o valor selecionado; para um listbox com `multiSelect`, especifique múltiplos valores separados por quebras de linha). Avaliado como expressão. Combinar com `valueStream` lança exceção |
| `checked` | Expression |  | Estado inicial de marcação (checkbox/radio). Avaliado como expressão. Para radios, o `exportValue` do botão marcado vira o valor selecionado do grupo |
| `exportValue` | string |  | A string registrada como o valor que significa que esta checkbox/radio está "ligada" quando a entrada do formulário é enviada ou extraída (checkbox/radio). Padrão: `'Yes'`. Em um grupo de radio, esse valor distingue as opções individuais |
| `options` | FormFieldOption[] |  | Array de opções (dropdown/listbox). Veja a tabela abaixo |
| `editable` | boolean |  | Permite digitação livre além das opções (faz um dropdown aceitar entrada estilo combo) |
| `multiSelect` | boolean |  | Permite seleção múltipla (listbox) |
| `caption` | string |  | Legenda do botão (pushbutton) |
| `action` | string |  | URI aberta quando o pushbutton é pressionado |
| `multiline` | boolean |  | Entrada multilinha (text) |
| `readOnly` | boolean |  | Torna o campo somente leitura |
| `required` | boolean |  | Torna o campo obrigatório |
| `noExport` | boolean |  | Não exporta o valor deste campo no envio do formulário |
| `password` | boolean |  | Entrada de senha (text; os caracteres digitados são mascarados) |
| `fileSelect` | boolean |  | Torna-o um campo de seleção de arquivo (text). Combinar com `multiline`/`password` lança exceção |
| `doNotSpellCheck` | boolean |  | Desabilita a verificação ortográfica (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | Proíbe a rolagem para entrada que exceda a área visível (text) |
| `comb` | boolean |  | Exibe como caixas de caracteres igualmente espaçadas (comb) (text). `maxLength` deve ser especificado; combinar com `multiline`/`password`/`fileSelect` lança exceção |
| `richText` | string |  | Valor rich text (PDF /RV) exibido com formatação (negrito, cores etc.) em visualizadores compatíveis. Defini-lo levanta a flag de rich text do campo. Combinar com `richTextStream` lança exceção |
| `richTextStream` | Uint8Array |  | Forma de stream de `richText`. Para preservação byte a byte quando o /RV do PDF de origem era um stream durante a importação de PDF; templates escritos à mão normalmente usam `richText`. Combinar com `richText` lança exceção |
| `defaultStyle` | string |  | Estilo padrão do rich text (PDF /DS). Uma string de formato semelhante a CSS (por exemplo, `font: Helvetica 12pt`) que fornece padrões para o que `richText` não especificar |
| `valueStream` | Uint8Array |  | Para preservação na importação de PDF. Quando o valor do campo (/V) do PDF de origem era um objeto stream em vez de uma string, reemite esses bytes sem perdas. Templates escritos à mão normalmente usam `value`. Combinar com `value` lança exceção |
| `defaultValue` | string |  | Valor padrão ao qual o campo retorna no reset do formulário (/DV) |
| `sort` | boolean |  | Exibe as opções ordenadas (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | Confirma o valor imediatamente quando a seleção muda (dropdown/listbox) |
| `radiosInUnison` | boolean |  | Alterna em uníssono os botões de opção de um grupo que compartilham o mesmo `exportValue` |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | Anexa ao campo scripts de entrada que rodam nos visualizadores de PDF. K = a cada tecla digitada (por exemplo, remover não dígitos), F = formatação de exibição (por exemplo, mostrar duas casas decimais), V = validação de valor (por exemplo, rejeitar números negativos), C = recálculo (por exemplo, calcular automaticamente a partir dos valores de outros campos). O conteúdo normalmente é um `PdfActionDef` (descrito adiante) com `subtype: 'JavaScript'`. O motor central apenas embute os scripts no PDF e nunca os executa. Em um grupo de radio, todos os widgets devem carregar definições idênticas ou uma exceção é lançada |
| `calculationOrder` | number |  | Quando múltiplos campos têm uma ação `'C'` (recálculo), a ordem em que o visualizador os recalcula (PDF /CO). Ordem crescente de inteiros ≥ 0. Duplicatas, valores negativos e não inteiros lançam exceção |
| `maxLength` | number |  | Comprimento máximo de entrada (text) |
| `borderColor` | string |  | Cor da borda (`#RRGGBB`). Sem borda quando omitida. Desenhada como um contorno de 1pt — circular para radios, retangular nos demais casos |
| `backgroundColor` | string |  | Cor de fundo (`#RRGGBB`). Transparente quando omitida. Preenchida como círculo para radios, retângulo nos demais casos |

**`FormFieldOption`** (cada entrada de `options` = uma definição de opção)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `value` | string | ✓ | Valor de exportação armazenado no valor do campo (/V) |
| `label` | string |  | Rótulo de exibição. Padrão: igual a `value` |

Observação: adicionalmente, todas as propriedades comuns aos elementos e todas as propriedades de `TextProperties` podem ser especificadas (aplicadas à fonte, ao alinhamento etc. do texto digitado).

### Forçando uma quebra de página ou de coluna em qualquer lugar — `break`

Força a passagem para a próxima página (`"breakType": "page"`) ou coluna (`"column"`) no meio do fluxo de detalhes. Posicione-o diretamente em uma banda; ele não pode ir dentro de um `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**Lista de propriedades**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | Tipo do elemento |
| `breakType` | `'page'` \| `'column'` | ✓ | Tipo de quebra. Divide a banda na posição y do elemento; `'page'` = continua na próxima página / `'column'` = continua na próxima coluna quando o layout é multicoluna (`columns.count` do template com 2 ou mais; veja **Fundamentos do layout de relatórios**) e esta não é a última coluna (caso contrário, age como quebra de página) |

### Imprimindo um elemento apenas quando uma condição é atendida — `printWhenExpression`

`printWhenExpression` não é um tipo de elemento distinto, mas **um atributo comum a todos os elementos**. O elemento é impresso apenas nas linhas em que a expressão avalia como verdadeira (truthy). O exemplo a seguir imprime "※ 至急" (urgente) apenas nas linhas de detalhe em que `urgent` é `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

Dados de exemplo (impresso apenas para a primeira linha):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

As bandas também aceitam um `printWhenExpression` homônimo, suprimindo a saída da banda inteira (por exemplo, emitir uma banda de observações somente quando `param.showNotes` estiver definido). Quando o template é definido em TypeScript, o callback `onBeforeRender` do elemento dá um controle ainda mais fino — retorne `null` para pular a impressão do elemento, ou retorne um `ElementDef` para imprimir com atributos como texto, dimensões e cores sobrescritos na hora.
## Referência de propriedades dos elementos

A "Lista de propriedades" anexada ao exemplo de cada elemento cobre apenas as propriedades específicas daquele elemento. Além delas, todo elemento aceita propriedades comuns de posição, tamanho, condições de impressão, cores e mais. Esta seção resume as propriedades comuns a todos os elementos e as propriedades dos estilos definidos em `styles` do template.

### Propriedades comuns a todos os elementos

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `id` | string |  | Identificador para localizar e modificar um elemento antes da renderização com `findElementById()`. Não afeta o conteúdo impresso em si. Mantenha únicos dentro do template os IDs usados como alvo de modificação (quando duplicados, o primeiro elemento na ordem de busca é retornado) |
| `x` | number | ✓ | Coordenada X dentro da banda/contêiner pai (pt) |
| `y` | number | ✓ | Coordenada Y dentro da banda/contêiner pai (pt) |
| `width` | number | ✓ | Largura (pt) |
| `height` | number | ✓ | Altura (pt) |
| `style` | string |  | Nome do estilo a aplicar (referencia o `name` de um `StyleDef` definido em `styles`; quando não especificado, o estilo `isDefault` é aplicado) |
| `positionType` | `'float'` = desce na medida em que os elementos acima dele se esticaram / `'fixRelativeToTop'` = fixa a posição a partir da borda superior da banda (padrão) / `'fixRelativeToBottom'` = mantém a distância da borda inferior da banda (desce na medida do estiramento da banda) |  | Regra de posicionamento quando a banda se estica. Padrão: `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = não estica (padrão) / `'containerHeight'` = faz a altura do elemento acompanhar a altura efetiva da banda / `'containerBottom'` = estica a borda inferior do elemento até a base efetiva da banda (muda apenas a altura) |  | Regra de estiramento do elemento quando a banda se estica. Padrão: `noStretch` |
| `printWhenExpression` | Expression \| null |  | Quando o resultado da avaliação é falsy, este elemento não é impresso |
| `onBeforeRender` | OnBeforeRenderCallback |  | Callback invocado imediatamente antes da renderização: `(elem, field, vars, param, report) => ElementDef \| null`. Retornar `null` pula a impressão (um superconjunto de `printWhenExpression`); retornar um `ElementDef` renderiza com aquela definição (sobrescrevendo dinamicamente qualquer atributo). Ordem de avaliação: `onBeforeRender` → `printWhenExpression` (avaliado sobre a definição sobrescrita) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | Quando o elemento não é impresso, se nenhum outro elemento impresso se sobrepuser à faixa vertical que o elemento ocupa, remove essa faixa e puxa os elementos abaixo para cima, encolhendo a banda |
| `isPrintRepeatedValues` | boolean |  | Quando definido como `false`, a impressão é suprimida quando o valor (textField) é igual ao anterior (enquanto suprimido, o elemento é tratado como altura 0 se `isRemoveLineWhenBlank` for truthy) |
| `isPrintWhenDetailOverflows` | boolean |  | Reimprime este elemento em cada segmento de página/coluna sobre o qual a banda transborda |
| `mode` | `'opaque'` = preenche o fundo com `backcolor` / `'transparent'` = não preenche o fundo |  | Modo de exibição. Padrão: `transparent` (resolvido primeiro no elemento, depois no estilo) |
| `forecolor` | string |  | Cor de primeiro plano (`#RRGGBB` ou `#RRGGBBAA`) |
| `backcolor` | string |  | Cor de fundo (desenhada quando `mode` é `opaque`) |
| `border` | BorderDef |  | Borda (veja **`BorderDef`** abaixo). Para os elementos line/rectangle/ellipse/path, a borda não é desenhada (venha ela de um estilo ou seja especificada diretamente no elemento; esses elementos especificam linhas por meio de seus próprios `stroke` e propriedades similares) |
| `padding` | Padding |  | Preenchimento interno (veja **`Padding`** abaixo) |
| `blendMode` | BlendModeDef |  | Como as cores deste elemento são compostas com o conteúdo já desenhado abaixo dele (veja **`BlendModeDef`** abaixo). Exemplo típico: especificar `'multiply'` em uma imagem de carimbo ou selo sobrepõe-na de forma translúcida sem esconder o texto por baixo |
| `overprintFill` | boolean |  | Para a pré-impressão comercial. Especifica sobreimpressão para preenchimentos (as faces de textos e formas): eles são impressos por cima das chapas de cor subjacentes sem vazá-las (knockout) |
| `overprintStroke` | boolean |  | Para a pré-impressão comercial. Configuração de sobreimpressão para linhas (traços) |
| `overprintMode` | 0 \| 1 |  | Seleciona o comportamento quando `overprintFill`/`overprintStroke` estão habilitados (PDF /OPM). `0` = todo componente de cor sobrescreve a cor subjacente (padrão) / `1` = componentes de cor com valor 0 deixam a cor subjacente intacta |
| `renderingIntent` | `'AbsoluteColorimetric'` = colorimetricamente fiel / `'RelativeColorimetric'` = fiel após o casamento dos pontos brancos / `'Saturation'` = prioriza a vivacidade / `'Perceptual'` = prioriza uma aparência natural |  | Política de prioridade para converter cores que não cabem no gamute do dispositivo de saída (rendering intent do PDF). Destinada à impressão comercial e à gestão de cores; normalmente não é preciso especificar |
| `alphaIsShape` | boolean |  | Controle refinado da composição de transparência do PDF (interpreta opacidade e máscaras como "forma"; /AIS). Normalmente não é preciso especificar; usado principalmente para a re-emissão fiel de PDFs importados |
| `textKnockout` | boolean |  | Quando caracteres translúcidos se sobrepõem, evita a composição dupla das sobreposições dentro do mesmo texto (PDF /TK). Padrão: `true`. Normalmente não é preciso especificar |
| `optionalContent` | OptionalContentDef |  | Coloca este elemento em uma "camada" do PDF. Visibilidade e impressão podem ser alternadas no painel de camadas do visualizador (por exemplo, mostrar uma marca-d'água na tela mas descartá-la ao imprimir). Veja **`OptionalContentDef`** abaixo |
| `opacity` | number |  | Opacidade do elemento (0.0–1.0). Para elementos com filhos, aplicada depois de compô-los como grupo |

**`BlendModeDef`** (modos de mesclagem que podem ser especificados em `blendMode`)

Os elementos normalmente pintam por cima do que foi desenhado abaixo deles (`'normal'`). Especificar um modo de mesclagem combina computacionalmente as cores de cima e de baixo. Em documentos comerciais, os usos típicos são sobrepor um carimbo pessoal ou da empresa sobre o texto (`'multiply'`) e produzir um efeito parecido com knockout branco sobre fundo escuro (`'screen'`).

| Constante | Efeito |
| --- | --- |
| `'normal'` | Pinta com a cor superior sem mesclar (equivalente ao padrão) |
| `'multiply'` | Multiplicação. As sobreposições sempre ficam mais escuras. Para carimbos, selos e sobreposições estilo marca-texto |
| `'screen'` | Multiplicação inversa. As sobreposições sempre ficam mais claras |
| `'overlay'` | Multiplica onde a base é escura, aplica screen onde é clara. Enfatiza o contraste |
| `'darken'` | Fica com a mais escura das duas cores |
| `'lighten'` | Fica com a mais clara das duas cores |
| `'color-dodge'` | Clareia (estoura) a base de acordo com a cor superior |
| `'color-burn'` | Queima a base, escurecendo-a de acordo com a cor superior |
| `'hard-light'` | Alterna entre multiplicação e multiplicação inversa com base na claridade da cor superior (efeito de iluminação forte) |
| `'soft-light'` | Uma versão mais fraca de `'hard-light'` (efeito de iluminação suave) |
| `'difference'` | Valor absoluto da diferença entre as duas cores |
| `'exclusion'` | Uma versão de menor contraste de `'difference'` |
| `'hue'` | Matiz superior + saturação e luminosidade inferiores |
| `'saturation'` | Saturação superior + matiz e luminosidade inferiores |
| `'color'` | Matiz e saturação superiores + luminosidade inferior (para tingir uma base monocromática) |
| `'luminosity'` | Luminosidade superior + matiz e saturação inferiores |

**`Expression`** (veja "Dominando as expressões" para detalhes)
| Forma | Descrição |
| --- | --- |
| string | Minilinguagem de expressões. Exemplos: `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | Uma função TypeScript `(field, vars, param, report) => unknown`. `report` (ReportContext) fornece `PAGE_NUMBER` (número da página atual, a partir de 1), `COLUMN_NUMBER` (número da coluna atual, a partir de 1), `REPORT_COUNT` (número de registros processados), `TOTAL_PAGES` (total de páginas; finalizado com evaluationTime=report), `RETURN_VALUE` (presente na definição de tipos, mas sempre undefined na implementação atual — valores de retorno de sub-relatórios são recebidos via `vars.*`), `format` (funções de formatação embutidas) e `formatters` (formatadores personalizados registrados no template) |

**`BorderDef`**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `width` | number |  | Largura da linha (pt). Padrão compartilhado por todos os lados |
| `color` | string |  | Cor da linha. Padrão compartilhado por todos os lados |
| `style` | `'solid'` = linha contínua / `'dashed'` = linha tracejada / `'dotted'` = linha pontilhada |  | Estilo da linha. Padrão compartilhado por todos os lados |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | Configurações por lado (veja **`BorderSideDef`** abaixo). Elas têm precedência sobre as configurações de todos os lados; `null` oculta aquele lado |

**`BorderSideDef`** (usado em `top`/`bottom`/`left`/`right` de `BorderDef`)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `width` | number | ✓ | Largura da linha (pt) |
| `color` | string | ✓ | Cor da linha |
| `style` | `'solid'` = linha contínua / `'dashed'` = linha tracejada / `'dotted'` = linha pontilhada | ✓ | Estilo da linha |

**`Padding`**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | Preenchimento em cada lado (pt) |

**`HyperlinkDef`**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'reference'` = URL externa / `'localAnchor'` = para uma âncora dentro do mesmo documento / `'localPage'` = para um número de página dentro do mesmo documento / `'remoteAnchor'` = para uma âncora em outro documento PDF / `'remotePage'` = para uma página em outro documento PDF | ✓ | Tipo de link |
| `target` | Expression | ✓ | Destino do link (uma URL, um nome de âncora ou uma expressão de número de página) |
| `remoteDocument` | Expression |  | Caminho do arquivo PDF remoto (para remotePage / remoteAnchor) |

**`TextProperties`** (propriedades de texto e parágrafo de staticText / textField / formField)
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `markup` | `'none'` = texto puro / `'styled'` = marcação com estilos (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>` etc.) / `'html'` = subconjunto de HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | Tipo de marcação |
| `hAlign` | `'left'` = alinhado à esquerda / `'center'` = centralizado / `'right'` = alinhado à direita / `'justify'` = justificado |  | Alinhamento horizontal |
| `vAlign` | `'top'` = alinhado ao topo / `'middle'` = alinhado ao meio / `'bottom'` = alinhado à base |  | Alinhamento vertical |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotação do texto (graus) |
| `lineSpacing` | LineSpacingDef |  | Configurações de entrelinha (veja **`LineSpacingDef`** abaixo) |
| `letterSpacing` | number |  | Espaçamento entre letras (pt). Adiciona uma quantidade fixa entre todos os caracteres (valores negativos comprimem) |
| `tracking` | number |  | Outro tipo de ajuste de espaçamento entre letras. Enquanto `letterSpacing` adiciona uma quantidade fixa uniformemente, este usa a tabela de ajuste de espaçamento embutida na própria fonte (a tabela AAT `trak`) para apertar ou alargar o espaçamento por valores de design que dependem do tamanho da fonte. O número é o "valor de track" da tabela: 0 = normal, negativo = mais apertado, positivo = mais largo (valores intermediários são interpolados). Sem efeito em fontes sem tabela `trak` |
| `wordSpacing` | number |  | Espaçamento entre palavras (pt; largura extra adicionada aos caracteres de espaço) |
| `horizontalScale` | number |  | Fator de escala que estica as formas dos glifos horizontalmente (abaixo de 1 = condensado, estreitando a largura; acima de 1 = expandido, alargando-a). A quebra de linha e o avanço de linha são calculados a partir das larguras escaladas. Padrão: 1 |
| `baselineOffset` | number |  | Define explicitamente a posição da linha de base (a linha de referência sobre a qual os caracteres se assentam) em pt a partir da borda superior do elemento. Normalmente calculada automaticamente, portanto não é preciso especificar (definida principalmente pela importação de PDF para reproduzir as posições originais do texto) |
| `firstLineIndent` | number |  | Recuo da primeira linha (pt) |
| `leftIndent` | number |  | Recuo à esquerda (pt) |
| `rightIndent` | number |  | Recuo à direita (pt) |
| `padding` | Padding |  | Preenchimento interno |
| `direction` | `'ltr'` = da esquerda para a direita / `'rtl'` = da direita para a esquerda / `'auto'` = detectada automaticamente a partir do conteúdo (análise de texto bidirecional) |  | Direção do texto |
| `openTypeScript` | string |  | Tag OpenType que especifica as regras de qual sistema de escrita da fonte são usadas ao converter texto em formas de glifo (shaping) (por exemplo, `'latn'` = escrita latina, `'arab'` = escrita árabe). Normalmente não é preciso especificar (tratado automaticamente a partir do conteúdo do texto) |
| `openTypeLanguage` | string |  | Tag OpenType que explicita o idioma para fontes que variam as formas dos glifos por idioma dentro do mesmo sistema de escrita. Normalmente não é preciso especificar |
| `openTypeFeatures` | Record<string, number> |  | Liga ou desliga os recursos de troca de glifos embutidos na fonte. Exemplos: `{ "palt": 1 }` = apertar o espaçamento de letras japonês, `{ "liga": 0 }` = desabilitar ligaduras, `{ "zero": 1 }` = zero cortado. Valores: 0 = desligado / 1 = ligado; para recursos de seleção de glifos, um número de glifo alternativo a partir de 1 |
| `shrinkToFit` | boolean |  | Redução automática: diminui o tamanho da fonte para que o texto caiba na largura e na altura do elemento |
| `minFontSize` | number |  | Tamanho mínimo da fonte (pt) para `shrinkToFit`. Padrão: 4 |
| `fitWidth` | boolean |  | Ajusta automaticamente o tamanho da fonte para que a linha mais longa caiba exatamente na largura de conteúdo do elemento (nos dois sentidos, reduzindo e ampliando) |
| `outlineText` | boolean |  | Converte o texto em contornos (caminhos). Padrão: `false` |
| `pdfFontMode` | `'embedded'` = incorpora o programa da fonte / `'reference'` = emite uma referência a fonte do sistema sem incorporar |  | Como o programa da fonte é tratado no PDF |
| `textPaintMode` | `'fill'` = preenchimento / `'stroke'` = contorno apenas / `'fillStroke'` = preenchimento + contorno |  | Semântica de pintura do texto preservada pela importação de PDF. Padrão: `fill` |
| `textStrokeColor` | string |  | Cor do traço para stroke / fillStroke |
| `textStrokeWidth` | number |  | Largura do traço de contorno do texto (pt) |
| `tabStops` | TabStopDef[] |  | Definições de paradas de tabulação (veja **`TabStopDef`** abaixo) |
| `tabStopWidth` | number |  | Intervalo padrão de tabulação (pt). 40pt quando não especificado |
| `wrap` | boolean |  | Quebra automática de texto. Padrão: `true` (undefined significa quebra habilitada) |

**`LineSpacingDef`**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'single'` = linha simples / `'1.5'` = 1,5 linha / `'double'` = dupla / `'proportional'` = proporção / `'fixed'` = valor fixo / `'minimum'` = valor mínimo | ✓ | Tipo de entrelinha |
| `value` | number |  | Valor para fixed / minimum / proportional |

**`TabStopDef`**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `position` | number | ✓ | Posição da tabulação (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | Alinhamento da tabulação. Padrão: `left` |

**`FillDef`** (a união dos tipos aceitos pelo preenchimento (`fill`) e pelo traço (`stroke`) de `path` e pelo preenchimento (`fill`) de `rectangle`/`ellipse`. O `stroke` de `rectangle`/`ellipse` aceita apenas uma string de cor sólida)
| Forma | Descrição |
| --- | --- |
| string | Cor sólida (`#RRGGBB` ou `#RRGGBBAA`) |
| PdfSpecialColorDef | Cor especial (Separation/DeviceN). Especificação de cor para tintas particulares como ouro, prata ou cores corporativas (veja a tabela abaixo) |
| LinearGradientDef | Gradiente linear — as cores mudam ao longo de um eixo que liga dois pontos (veja a tabela abaixo) |
| RadialGradientDef | Gradiente radial — as cores mudam para fora a partir de um centro (veja a tabela abaixo) |
| MeshGradientDef | Gradiente de malha — as cores mudam ao longo de formas livres (veja a tabela abaixo) |
| TilingPatternDef | Padrão de ladrilho — preenche repetindo um pequeno motivo (veja a tabela abaixo) |
| FunctionShadingDef | Sombreado por função — as cores são calculadas a partir das coordenadas por uma fórmula (veja a tabela abaixo) |

**`GradientStopDef`** (paradas de cor de um gradiente; usadas nos `stops` de cada gradiente)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `offset` | number | ✓ | Posição ao longo do eixo do gradiente, como proporção de 0 a 1 (0 = ponto inicial, 1 = ponto final) |
| `color` | string | ✓ | Cor nesta posição (`#RRGGBB`) |
| `opacity` | number |  | Opacidade nesta posição (0–1). Padrão: 1 |

**`LinearGradientDef`** (gradiente linear — um preenchimento cujas cores mudam ao longo de um eixo que liga dois pontos)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | Discriminador indicando um gradiente linear |
| `x1` | number |  | Coordenada X do ponto inicial, **como proporção da largura da caixa delimitadora do elemento** (0 = borda esquerda, 1 = borda direita). Padrão: 0 |
| `y1` | number |  | Coordenada Y do ponto inicial, **como proporção da altura da caixa delimitadora do elemento** (0 = borda superior, 1 = borda inferior). Padrão: 0 |
| `x2` | number |  | Coordenada X do ponto final (proporção da largura). Padrão: 1 (com os padrões inalterados, um gradiente horizontal da esquerda para a direita) |
| `y2` | number |  | Coordenada Y do ponto final (proporção da altura). Padrão: 0 |
| `stops` | GradientStopDef[] | ✓ | Array de paradas de cor (veja a tabela acima) |
| `spreadMethod` | `'pad'` = preenche com as cores das extremidades / `'reflect'` = repete espelhando / `'repeat'` = repete tal qual |  | Como pintar fora do intervalo do gradiente. Padrão: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadados de preservação para reemitir sem perdas um gradiente de PDF importado. Não é preciso especificar em templates escritos à mão |

**`RadialGradientDef`** (gradiente radial — um preenchimento cujas cores mudam para fora a partir de um centro)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | Discriminador indicando um gradiente radial |
| `cx` | number |  | Coordenada X do centro do círculo externo (proporção da largura da caixa delimitadora do elemento). Padrão: 0.5 |
| `cy` | number |  | Coordenada Y do centro do círculo externo (proporção da altura). Padrão: 0.5 |
| `r` | number |  | Raio do círculo externo, **como proporção do maior valor entre largura e altura**. Padrão: 0.5 |
| `fx` | number |  | Coordenada X do ponto focal (onde o gradiente começa) (proporção da largura). Padrão: `cx` |
| `fy` | number |  | Coordenada Y do ponto focal (proporção da altura). Padrão: `cy` |
| `fr` | number |  | Raio do círculo focal (proporção do maior valor entre largura e altura). Padrão: 0 |
| `stops` | GradientStopDef[] | ✓ | Array de paradas de cor |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | Como pintar fora do intervalo (igual ao `LinearGradientDef`). Padrão: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadados para reemitir sem perdas uma importação de PDF. Não é preciso especificar em templates escritos à mão |

**`MeshGradientDef`** (gradiente de malha — um preenchimento que atribui cores aos vértices de reticulados ou triângulos e varia as cores ao longo de formas livres)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | Discriminador indicando um gradiente de malha |
| `patches` | MeshPatchDef[] |  | Array de retalhos de superfície. Cada retalho tem `points` (uma malha 4×4 de pontos de controle expressa como 32 números na ordem x,y; **as coordenadas são em pt locais ao elemento**) e `colors` (as cores dos 4 cantos) |
| `triangles` | MeshTriangleDef[] |  | Array de triângulos de gradiente. Cada triângulo tem `points` (x0,y0,x1,y1,x2,y2; pt locais ao elemento) e `colors` (as cores dos 3 vértices); as cores são interpoladas entre os vértices |
| `lattice` | MeshLatticeDef |  | Malha em forma de reticulado. Tem `columns` (número de vértices por linha, 2 ou mais), `points` (sequência de coordenadas dos vértices; pt locais ao elemento) e `colors` (uma cor por vértice, na mesma ordem de `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | Representação compacta de dados de malha nativos importados de um PDF. Não é preciso especificar em templates escritos à mão |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | Igual ao anterior, para triângulos de gradiente |
| `pdfShading` | PdfMeshShadingDef |  | Metadados para reemitir sem perdas uma importação de PDF. Não é preciso especificar em templates escritos à mão |

**`TilingPatternDef`** (padrão de ladrilho — preenche ladrilhando um pequeno motivo; para hachuras, xadrezes, logotipos repetidos e afins)

O "espaço do padrão" na tabela é o sistema de coordenadas próprio do padrão. Se `matrix` não for especificada, ele coincide com as coordenadas em pt locais ao elemento.

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | Discriminador indicando um padrão de ladrilho |
| `bbox` | [number, number, number, number] | ✓ | Caixa delimitadora de um motivo (a célula do padrão), em coordenadas do espaço do padrão |
| `xStep` | number | ✓ | Intervalo de repetição horizontal da célula (espaço do padrão) |
| `yStep` | number | ✓ | Intervalo de repetição vertical da célula (espaço do padrão) |
| `graphics` | TileGraphicDef[] | ✓ | Array de gráficos desenhados dentro da célula, discriminados por `kind`: `'path'` (dados de caminho SVG + preenchimento/traço) / `'image'` (referencia um ID de recurso de imagem por meio de `source`) / `'text'` (texto com fonte, tamanho e cor) / `'group'` (grupo aninhado com transformação, recorte, opacidade etc.). Todas as coordenadas são em espaço do padrão |
| `tilingType` | 1 = espaçamento constante (as células podem ser levemente distorcidas para se adequar ao dispositivo de saída) \| 2 = sem distorção (o espaçamento pode variar levemente) \| 3 = espaçamento constante com ladrilhamento rápido |  | Modo de precisão do ladrilhamento. Padrão: 1 |
| `paintType` | `'colored'` = o padrão carrega as próprias cores / `'uncolored'` = tingido com uma única cor a partir do `color` de quem o utiliza |  | Como a cor é carregada. Padrão: `'colored'` |
| `color` | string |  | Cor de tingimento ao usar um padrão `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | Matriz de transformação afim do espaço do padrão para o espaço local ao elemento. Padrão: matriz identidade |

**`FunctionShadingDef`** (sombreado por função — um preenchimento cuja cor é calculada por uma fórmula a partir das coordenadas (x, y); aparece principalmente na importação de PDF)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | Discriminador indicando sombreado por função. Há duas variantes: uma forma de fórmula com `expression` e uma forma amostrada com `sampled` |
| `domain` | [number, number, number, number] | ✓ | Domínio de entrada `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (apenas na forma de fórmula) | Expressão de calculadora PostScript (PDF FunctionType 4). Recebe x, y e retorna r, g, b. Exemplo: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (apenas na forma amostrada) | Dados de função amostrada (PDF FunctionType 0). Tem `size` (dimensões da grade de amostras), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (intervalo de saída), `samples` (valores de amostra por ponto da grade) e, opcionalmente, `encode`/`decode` |
| `matrix` | [number, number, number, number, number, number] |  | Matriz de mapeamento do domínio de entrada para **pt locais ao elemento**. Padrão: matriz identidade |
| `background` | [number, number, number] |  | Cor de fundo fora do domínio (componentes DeviceRGB, 0–1) |
| `bbox` | [number, number, number, number] |  | Caixa delimitadora que limita a pintura |
| `antiAlias` | boolean |  | Dica de suavização de serrilhado |
| `paintOperator` | `'pattern'` = pintado como um padrão (padrão) / `'sh'` = desenhado diretamente sob o recorte atual |  | Método de pintura para a saída em PDF |

**`PdfSpecialColorDef`** (preenchimento com cor especial — especificação de cor para impressão com tintas particulares, como ouro, prata ou cores corporativas, que a mistura CMYK comum não consegue reproduzir)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | Discriminador indicando um preenchimento com cor especial |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | O espaço de cores da cor especial. Uma única tinta usa `kind: 'separation'` com `name` (nome da tinta), `alternate` (o espaço de cores de processo usado no lugar dela em ambientes sem a tinta especial; veja a tabela abaixo) e `tintTransform` (especifica a conversão de tonalidade para cor alternativa como uma função PDF, p. ex. `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = branco na tonalidade 0 e azul em 1). Várias tintas usam `kind: 'deviceN'` com `names` (array de nomes de tintas), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = padrão / `'NChannel'` = forma estendida que pode carregar informações de atributo por tinta), `colorants` (um mapa de cada nome de tinta para uma definição de tinta única), `process` e `mixingHints` |
| `components` | number[] | ✓ | Valor de tonalidade de cada tinta (0–1) |
| `displayColor` | string | ✓ | Cor usada no lugar dela para exibição em tela e pré-visualizações, que não têm a tinta especial |

**`PdfProcessColorSpaceDef`** (espaço de cores de processo — o espaço de cores das "cores comuns" expressas pela mistura de tintas padrão, como CMYK. Usado no `alternate` de uma cor especial e no `colorSpace` de uma máscara suave, discriminado por `kind`)

| Variante (`kind`) | Propriedades adicionais | Descrição |
| --- | --- | --- |
| `'gray'` | Nenhuma | Escala de cinza (DeviceGray) |
| `'rgb'` | Nenhuma | RGB (DeviceRGB) |
| `'cmyk'` | Nenhuma | CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (todas obrigatórias) | Cinza calibrado colorimetricamente (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (por componente), `matrix` (3×3) (todas obrigatórias) | RGB calibrado colorimetricamente (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (todas obrigatórias) | Espaço de cores L\*a\*b\* |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (bytes do perfil ICC) (todas obrigatórias) | Espaço de cores baseado em um perfil ICC |

`whitePoint`/`blackPoint` são especificados como arrays `[x, y, z]` no espaço de cores CIE XYZ.

### Propriedades das bandas (`bands`) e dos grupos (`groups`)

Os dez tipos de banda especificados no `bands` do template (veja "Uma página é uma pilha de "bandas"") são todos definidos com o `BandDef` a seguir (apenas `details` é um array de `BandDef`).

**`BandDef`**

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `height` | number | ✓ | Altura mínima da banda (pt). Cresce conforme os elementos se esticam |
| `elements` | ElementDef[] |  | Elementos colocados na banda |
| `startNewPage` | boolean |  | Sempre inicia esta banda em uma nova página |
| `spacingBefore` | number |  | Espaço antes da banda (pt) |
| `spacingAfter` | number |  | Espaço depois da banda (pt) |
| `splitType` | `'stretch'` = imprime o quanto couber na página e continua o restante na página seguinte (padrão) / `'prevent'` = não divide; envia a banda inteira para a página seguinte (ela é dividida se também não couber na nova página) / `'immediate'` = divide imediatamente na posição atual, mesmo no meio de um elemento |  | Como a banda é dividida quando não cabe em um limite de página |
| `printWhenExpression` | Expression \| null |  | Quando o resultado da avaliação é falsy, esta banda não é emitida |

**`GroupDef`** (cada entrada de `groups`)

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nome do grupo. Referenciado a partir do `resetGroup` de uma variável e do `evaluationGroup` de um textField |
| `expression` | Expression | ✓ | Chave do grupo. Avaliada para cada linha; sempre que o valor muda, o grupo anterior é fechado e um novo grupo começa |
| `header` | BandDef |  | Banda emitida no início do grupo |
| `footer` | BandDef |  | Banda emitida no fim do grupo |
| `keepTogether` | boolean |  | Quando o grupo inteiro não cabe no espaço restante, mas caberia em uma nova página, inicia-o depois de uma quebra de página |
| `minHeightToStartNewPage` | number |  | Inicia o grupo em uma nova página quando a altura restante da página é menor que este valor (pt) |
| `reprintHeaderOnEachPage` | boolean |  | Quando o grupo se estende por várias páginas, reimprime o cabeçalho em cada página de continuação |
| `resetPageNumber` | boolean |  | Reinicia `PAGE_NUMBER` em 1 quando o grupo começa |
| `startNewPage` | boolean |  | Inicia cada grupo em uma nova página |
| `startNewColumn` | boolean |  | Inicia cada grupo em uma nova coluna |
| `footerPosition` | `'normal'` = emitido logo após as linhas de detalhe (padrão) / `'stackAtBottom'` = empilhado em direção ao rodapé da página / `'forceAtBottom'` = sempre colocado no extremo inferior da página, consumindo o espaço restante no meio / `'collateAtBottom'` = alinha-se ao rodapé apenas quando o rodapé de outro grupo está alinhado ao rodapé (isoladamente, igual a `'normal'`) |  | Posição vertical do rodapé do grupo |

### Propriedades disponíveis nos estilos (`styles`)

Os estilos são definidos no array `styles` do template e referenciados por `name` a partir da propriedade `style` de um elemento. Fontes, alinhamento de texto, cores e outras configurações relacionadas a texto são feitas primordialmente por meio de estilos.

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nome do estilo (referenciado a partir do `style` dos elementos) |
| `parentStyle` | string |  | Nome do estilo pai. Herda as propriedades do pai e as sobrescreve com as próprias configurações (referências circulares são ignoradas) |
| `isDefault` | boolean |  | Um estilo com `true` é aplicado como padrão aos elementos sem `style` |
| `fontFamily` | string |  | Família da fonte. Padrão: `'default'` |
| `fontSize` | number |  | Tamanho da fonte (pt). Padrão: 10 |
| `bold` | boolean |  | Negrito. Padrão: `false` |
| `italic` | boolean |  | Itálico. Padrão: `false` |
| `underline` | boolean |  | Sublinhado. Padrão: `false` |
| `strikethrough` | boolean |  | Tachado. Padrão: `false` |
| `forecolor` | string |  | Cor de primeiro plano (`#RRGGBB` ou `#RRGGBBAA`). Padrão: `#000000` |
| `backcolor` | string |  | Cor de fundo. Padrão: `transparent` |
| `hAlign` | `'left'` = alinhado à esquerda / `'center'` = centralizado / `'right'` = alinhado à direita / `'justify'` = justificado |  | Alinhamento horizontal. Padrão: `left` |
| `vAlign` | `'top'` = alinhado ao topo / `'middle'` = alinhado ao centro / `'bottom'` = alinhado à base |  | Alinhamento vertical. Padrão: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotação do texto (graus) |
| `padding` | Padding |  | Preenchimento interno |
| `border` | BorderDef |  | Borda |
| `mode` | `'opaque'` = preenche o fundo com `backcolor` / `'transparent'` = não preenche o fundo |  | Modo de exibição |
| `opacity` | number |  | Opacidade (0.0–1.0) |
| `variation` | Record<string, number> |  | Valores dos eixos de fontes variáveis (p. ex. `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = escrita horizontal / `'vertical-rl'` = escrita vertical com as linhas avançando da direita para a esquerda / `'vertical-lr'` = escrita vertical com as linhas avançando da esquerda para a direita |  | Direção da escrita |
| `conditionalStyles` | ConditionalStyleDef[] |  | Estilos condicionais (veja a tabela abaixo). Quando uma condição é válida, as propriedades correspondentes são sobrescritas |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | Direção do texto (ltr = da esquerda para a direita / rtl = da direita para a esquerda / auto = detectada automaticamente a partir do conteúdo) |
| `openTypeScript` | string |  | Tag OpenType que especifica quais regras de sistema de escrita da fonte são usadas ao converter texto em formas de glifo (shaping) (p. ex. `'latn'` = escrita latina, `'arab'` = escrita árabe). Normalmente não é preciso especificar (tratado automaticamente a partir do conteúdo do texto) |
| `openTypeLanguage` | string |  | Tag OpenType que torna o idioma explícito para fontes que variam as formas de glifo por idioma dentro do mesmo sistema de escrita. Normalmente não é preciso especificar |
| `openTypeFeatures` | Record<string, number> |  | Liga ou desliga os recursos de troca de glifos embutidos na fonte. Exemplos: `{ "palt": 1 }` = aperta o espaçamento entre caracteres japoneses, `{ "liga": 0 }` = desativa ligaduras, `{ "zero": 1 }` = zero cortado. Valores: 0 = desligado / 1 = ligado; para recursos de seleção de glifo, o número (base 1) do glifo alternativo |

**`ConditionalStyleDef`**
| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | Condição de aplicação. Quando truthy, as propriedades abaixo sobrescrevem o estilo |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | Mesmos tipos das propriedades homônimas de StyleDef |  | Valores sobrescritos quando a condição é válida (os significados são os mesmos das propriedades correspondentes de StyleDef) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | Mesmos tipos das propriedades homônimas de StyleDef |  | Declaradas na definição de tipo, mas a implementação atual não aplica suas sobrescritas quando a condição é válida |

### Tipos para importação de PDF e recursos avançados de PDF

Os tipos listados aqui têm duas finalidades: (1) tipos de "preservação" para reemitir um PDF importado sem perder um único byte e (2) tipos para usar recursos avançados como camadas de PDF, scripts de formulário e configurações de pré-impressão para impressão comercial. Você quase nunca vai especificá-los ao escrever um relatório comum à mão. Os tipos descritos como "definidos pela importação de PDF" aparecem dentro dos elementos gerados por `importPdfPage()`.

**`OptionalContentDef`** (recurso de camadas do PDF)

O PDF pode colocar conteúdo em "camadas" (optional content groups, OCGs), cuja visibilidade e impressão podem ser alternadas no painel de camadas do visualizador. Especificar isso no `optionalContent` de um elemento coloca esse elemento em uma camada. Exemplo: colocar uma marca-d'água "Confidencial" em uma camada que aparece apenas na impressão.

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nome da camada mostrado no painel de camadas do visualizador |
| `visible` | boolean |  | Visibilidade inicial na tela. Padrão: true |
| `print` | boolean |  | Estado inicial de impressão. Padrão: segue `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | Definida pela importação de PDF. Preserva a definição de camada do PDF de origem (OCG) ou uma definição de pertencimento (OCMD) que decide a visibilidade a partir de uma combinação de várias camadas. Um pertencimento tem `groups` (as camadas alvo), `policy` (`'AllOn'` = visível quando todas estão ligadas / `'AnyOn'` = quando alguma está ligada / `'AnyOff'` = quando alguma está desligada / `'AllOff'` = quando todas estão desligadas) e uma expressão opcional de lógica de visibilidade `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | Definida pela importação de PDF. Preserva a configuração de camadas de todo o documento (a lista de todas as camadas, a configuração padrão, a árvore de ordem de exibição do painel de camadas, grupos de seleção mutuamente exclusivos, bloqueio etc.) |

**`PdfRawValueDef`** (os "valores brutos" do PDF)

Muitas das propriedades de preservação carregam dados internos do PDF como "valores brutos", sem interpretá-los. Um valor bruto é um valor JavaScript com o seguinte formato: `null`, booleanos e números tal como estão; um nome PDF é `{ kind: 'name', value: 'DeviceRGB' }`; uma string é `{ kind: 'string', bytes: Uint8Array }`; um array é `{ kind: 'array', items: [...] }`; um dicionário é `{ kind: 'dictionary', entries: { ... } }`; um stream é `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (ações executadas por um visualizador de PDF)

Usado no `additionalActions` de campos de formulário e em outros lugares, isso define "o que o visualizador deve fazer". O conteúdo é apenas serializado e importado — **o motor central nunca o executa** (a execução é feita por um visualizador que o suporte).

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | Tipo de ação. `'JavaScript'` = executar um script (formatação de entrada de formulário, validação e cálculo automático usam isto) / `'GoTo'` = ir para um destino dentro do documento / `'GoToR'` = ir para outro documento / `'GoToE'` = ir para um documento embutido / `'URI'` = abrir uma URL / `'Launch'` = iniciar uma aplicação ou arquivo / `'Named'` = comando predefinido (próxima página etc.) / `'SubmitForm'` = enviar o formulário / `'ResetForm'` = redefinir o formulário / `'ImportData'` = importar dados / `'Hide'` = alternar a visibilidade de anotações / `'SetOCGState'` = alternar a visibilidade de camadas / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = outras ações padrão do PDF |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Dicionário que mantém as configurações de cada tipo de ação como valores brutos (veja **`PdfRawValueDef`** acima). Exemplo: para `'JavaScript'`, `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | Destino para a família `'GoTo'`. Nomeado (`{ kind: 'named', name, representation: 'name' \| 'string' }`) ou explícito (página alvo + como a visualização é ajustada) |
| `structureDestination` | PdfStructureDestinationDef |  | Destino baseado em um elemento da estrutura do documento (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | Especifica a anotação alvo das ações de mídia |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | Sequência de camadas e operações (`'ON'` / `'OFF'` / `'Toggle'`) alternadas por `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | Especifica os nomes de campo alvos de `'Hide'` / `'SubmitForm'` / `'ResetForm'` |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | Especificação de arquivo embutido para `'GoToE'` (estrutura recursiva) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | Parâmetros específicos de plataforma para `'Launch'`. Apenas preservados, nunca executados |
| `articleTarget` | PdfArticleActionTargetDef |  | Especificação de fio de artigo para `'Thread'` |
| `documentPartIndex` | number |  | Número da parte do documento de destino para `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | Número da instância de mídia rica |
| `next` | PdfActionDef \| PdfActionDef[] |  | Ação (ou ações) a executar em seguida (encadeamento) |

**`PdfFormXObjectDef`** (preservação de metadados de componentes de PDF importados)

Dentro de um PDF, o conteúdo de desenho usado repetidamente pode ser empacotado em componentes chamados "Form XObjects". A importação de PDF converte um componente desses em um elemento `frame` e mantém o sistema de coordenadas e os metadados do componente neste tipo, para que possam ser restaurados na reemissão. Não é preciso especificar em templates escritos à mão.

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | Caixa delimitadora do componente (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | Matriz de transformação do sistema de coordenadas do componente (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | Transformação de coordenadas que estava em vigor quando este componente foi desenhado no PDF de origem |
| `formType` | 1 |  | Número do tipo de formulário do componente (a especificação PDF define apenas 1) |
| `group` | Record<string, PdfRawValueDef> |  | Preservação em valores brutos do dicionário de grupo de transparência |
| `reference` | Record<string, PdfRawValueDef> |  | Preservação em valores brutos do dicionário de referência a PDF externo |
| `metadata` | Forma de stream de PdfRawValueDef (`kind: 'stream'`) |  | Preserva o stream de metadados |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | Preserva dados específicos da aplicação criadora (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | Preserva o carimbo de data/hora da última modificação |
| `structParent` / `structParents` | number |  | Preserva as chaves de correspondência para o PDF marcado (estrutura do documento, como a ordem de leitura) |
| `opi` | PdfOpiMetadataDef |  | Preserva informações OPI (veja a tabela abaixo) |
| `name` | string |  | Nome do componente |
| `measure` | PdfMeasurement |  | Preserva informações de medição (veja a tabela abaixo) |
| `pointData` | PdfPointData[] |  | Preserva dados de nuvem de pontos (veja a tabela abaixo) |

**`PdfSourceVectorDef`** (definições compartilhadas de formas repetidas importadas)

Ao importar um PDF em que a mesma forma se repete em grande quantidade — como símbolos de mapa —, os dados de contorno da forma são preservados no formato "uma definição + N posicionamentos". Aparece no `pdfSourceVector` de um elemento `path`; quando especificado, nenhuma análise de `d` é realizada. Não é preciso especificar em templates escritos à mão.

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | Array de definições de forma reutilizáveis. Cada definição tem `commands` (0 = mover para o ponto inicial [2 coordenadas], 1 = linha reta [2], 2 = curva de Bézier cúbica [6], 3 = fechar caminho [0]) e `coords` (um array achatado de coordenadas na ordem dos comandos) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | Array de posicionamentos das definições. Cada posicionamento tem `definitionIndex` (número da definição) e `matrix` (matriz afim de 6 elementos) |

**`PdfOpiMetadataDef`** (informações de substituição de imagem para impressão comercial)

OPI (Open Prepress Interface) é um mecanismo de impressão comercial em que uma imagem leve e de baixa resolução é usada durante a edição e trocada pela imagem de alta resolução quando a gráfica produz a saída. Preservado quando o PDF importado carregava esta especificação.

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | Versão do OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Mantém o conteúdo do dicionário OPI como valores brutos de PDF (nome do arquivo de origem para a substituição, área de corte etc.) |

**`PdfMeasurement`** (informações de medição para desenhos técnicos e mapas)

Em PDFs de desenho técnico e de mapas, as ferramentas de medição do visualizador podem medir distâncias e áreas em uma escala do tipo "1 cm no papel corresponde a 1 m no mundo real". Este tipo preserva essa escala e as informações de sistema de coordenadas, e vem em uma forma retilínea (`kind: 'rectilinear'`) e uma forma geoespacial (`kind: 'geospatial'`).

| Propriedade (`'rectilinear'`) | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | Discriminador para medição retilínea |
| `scaleRatio` | string | ✓ | Texto de exibição da escala (p. ex. `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` é opcional) | Cadeia de formatos de exibição numérica para as direções X/Y (rótulos de unidade, fatores de conversão, exibição decimal/fracionária etc.). Quando `y` é omitido, `x` é usado |
| `distance` / `area` | PdfNumberFormat[] | ✓ | Formatos de exibição numérica para distância/área |
| `angle` / `slope` | PdfNumberFormat[] |  | Formatos de exibição numérica para ângulo/inclinação |
| `origin` | [number, number] |  | Origem da medição |
| `yToX` | number |  | Fator de conversão de unidades de Y para X |

| Propriedade (`'geospatial'`) | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | Discriminador para medição geoespacial |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | Sistema de coordenadas geodésicas. É obrigatório um código EPSG ou uma string WKT |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | Pontos de controle em coordenadas geodésicas e os pontos de controle locais correspondentes dentro da imagem ou do componente (mesma quantidade) |
| `dimension` | 2 \| 3 |  | Dimensão das coordenadas. Padrão: 2 |
| `bounds` | [number, number][] |  | Polígono da área mensurável |
| `displayCoordinateSystem` | Igual a `coordinateSystem` |  | Sistema de coordenadas para exibição |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | Unidades de exibição preferidas para distância, área e ângulo |
| `projectedCoordinateSystemMatrix` | Tupla numérica de 12 elementos |  | Matriz afim 4×4 para o sistema de coordenadas projetado (12 elementos em ordem de linha, com a quarta coluna constante omitida) |

**`PdfPointData`** (dados de nuvem de pontos de mapa)

Para preservar tabelas de dados de pontos embutidas em PDFs de mapa, com colunas nomeadas como `LAT` (latitude), `LON` (longitude) e `ALT` (altitude).

| Propriedade | Tipo / valores permitidos | Obrigatória | Descrição |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | Array de nomes de coluna (únicos e não vazios; as colunas `LAT`/`LON`/`ALT` devem ser numéricas) |
| `rows` | PdfRawValueDef[][] | ✓ | Valores de cada linha. O comprimento da linha corresponde a `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (funções de transferência de tons para pré-impressão)

Funções usadas no `deviceParams` e no `softMask` do `frame` que mapeiam um valor (0–1) para outro valor. Na pré-impressão elas expressam curvas de tom — "a tinta desta densidade é impressa naquela densidade". Um `TransferFunctionDef` é ou um `CalculatorFunctionDef` (uma expressão de calculadora PostScript, p. ex. `{ expression: '{ 1 exch sub }' }` = inverter preto e branco) ou um `PdfFunctionDef` (um objeto de função PDF: uma tabela de valores amostrados, interpolação exponencial ou uma combinação destes); onde é usado, também pode ser especificado `'Identity'` (nenhuma transformação).

**`HalftoneDef`** (definição de meio-tom para pré-impressão)

As máquinas impressoras expressam a gradação tonal com o tamanho de pequenos pontos (pontos de meio-tom). Isto especifica como esses pontos são construídos e é usado para preservação na importação de PDF e para criar dados de pré-impressão. `type` distingue cinco formas:

| Forma | Propriedades principais | Descrição |
| --- | --- | --- |
| type 1 (retícula) | `frequency` (lineatura da retícula) ✓, `angle` (ângulo) ✓, `spotFunction` (formato do ponto; um nome predefinido como `'Round'` ou uma expressão de calculadora) ✓, `accurateScreens` (solicita a construção de retícula de alta precisão; opcional) | Forma padrão que define o meio-tom por lineatura, ângulo e formato do ponto (`type` pode ser omitido) |
| type 6 (matriz de limiares) | `width` ✓, `height` ✓, `thresholds` (largura × altura valores, 0–255) ✓ | Define o meio-tom diretamente com uma tabela de limiares |
| type 10 (limiares angulados) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | Definição de limiares com células anguladas |
| type 16 (limiares de 16 bits) | `width` ✓, `height` ✓, `thresholds` (valores de 16 bits) ✓, segundo retângulo opcional | Definição de limiares de alta precisão |
| type 5 (coleção por chapa) | `halftones` (array de `{ colorant: nome da tinta, halftone: qualquer uma das formas acima }`) ✓ | Atribui um meio-tom diferente a cada chapa de cor, como ciano e magenta |

As quatro formas além da type 5 podem carregar uma `transferFunction` opcional (`'Identity'` ou um `TransferFunctionDef`) (na type 5, cada definição interna de meio-tom por chapa carrega a sua própria).

## API principal

As APIs usadas com mais frequência, listadas uma a uma com um exemplo mínimo, para que você possa consultá-las por "o que você quer fazer". Presume-se que `template`, `dataSource`, `fontMap` e `fonts` sejam exatamente os construídos no tutorial.

### Construindo um relatório

#### Construindo um relatório a partir de um template e de dados — `createReport()`

Faz o layout do template e dos dados e retorna um `RenderDocument` orientado a páginas. As expressões usam uma linguagem de expressões embutida e segura que pode referenciar `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` e mais — nenhum `eval` ou `Function` é usado. Expressões de callback em TypeScript também são uma opção.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // número de páginas com layout concluído
```

#### Consultando e modificando elementos do template por ID — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

Ambas as APIs retornam referências a elementos do template original. Faça suas alterações antes de chamar `createReport()`. `getElementChildren()` retorna elementos filhos apenas para `frame` e `table` (elementos dentro das células); para outros elementos, retorna um array vazio. Para detalhes sobre o escopo da busca, veja "Localizando elementos por ID e modificando-os antes da renderização".

#### Construindo um relatório a partir de um arquivo `.report` — `createReportFromFile()` (Node.js)

Lê um template JSON e resolve os caminhos relativos de imagens e sub-relatórios em relação ao diretório do template.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### Combinando vários relatórios em um único volume — `createReportBook()`

Concatena vários templates — uma capa, um corpo e assim por diante — em um único `RenderDocument` com numeração de páginas contínua.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### Concatenando `RenderDocument`s já construídos — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

IDs de imagem em conflito são renomeados automaticamente.

#### Gerando automaticamente uma página de sumário — `insertTableOfContents()`

Coleta as entradas do sumário a partir das âncoras (`anchorName`) do relatório e insere as páginas do sumário no início.

```ts
const withToc = insertTableOfContents(
  document,
  // Tamanho e margens da página do sumário em pt (neste exemplo: A4 retrato)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // ID da fonte (chave de fontMap) usada no texto do sumário
  { title: '目次' },
)
```

#### Obtendo a contagem de páginas de um PDF existente — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### Importando um PDF existente como elementos de relatório — `importPdfPage()`

Para detalhes, veja **Convertendo um PDF existente em elementos de relatório (importação de PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### Renderização e saída

#### Emitindo um PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### Pré-visualizando uma única página — `renderPage()`

Renderização página a página. Use-a para desenhar apenas a página exibida no momento em uma pré-visualização no navegador.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### Renderizando o relatório inteiro para qualquer backend — `render()`

Renderiza todas as páginas para qualquer destino de saída que implemente a interface `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### Desenhando em um Canvas HTML — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### Emitindo SVG — `SvgBackend`

Gera uma string `<svg>` autocontida por página.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // array de strings <svg>, uma por página
```

#### Controle refinado sobre a geração de PDF — `PdfBackend`

Opções específicas de PDF, como miniaturas de página, são passadas ao construtor.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` se aplica à i-ésima página. Para `thumbnailImageId` (a imagem em miniatura mostrada na lista de páginas), especifique um ID de imagem que exista em `document.images`.

#### Mesclando PDFs finalizados — `mergePdfFiles()`

Mescla vários PDFs em um só com um analisador de PDF em TypeScript puro.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### Trabalhando com fontes

#### Carregando um arquivo de fonte — `Font.load()`

Analisa TTF, OTF, TTC, OTC, WOFF, WOFF2 e EOT.

```ts
const font = Font.load(fontBuffer)
```

#### Medindo a largura do texto — `TextMeasurer`

Medição rápida de texto apoiada no cache de glifos do `Font`. Registrado no `fontMap`, ele também é usado para o layout.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### Convertendo uma string em uma sequência de glifos — `font.shapeText()`

Usa informações de OpenType / AAT (a especificação de extensão das fontes de linhagem Apple) / Graphite (a especificação de extensão das fontes de linhagem SIL) para obter uma sequência de glifos (números de glifo com posições e avanços) com seleção de glifos, ligaduras e ajustes de posicionamento aplicados.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### Detectando glifos ausentes antes da impressão — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### Usando códigos de barras, SVG, fórmulas matemáticas e imagens de forma autônoma

#### Gerando um código de barras de forma autônoma — `renderBarcode()`

Gera nós de desenho de código de barras diretamente, sem passar por um elemento de relatório.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### Analisando e renderizando SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### Compondo uma fórmula matemática de forma autônoma — `parseMathLaTeX()` / `layoutMathFormula()`

Requer uma fonte que inclua informações de dimensão para fórmulas matemáticas (a tabela MATH do OpenType) — por exemplo, STIX Two Math ou Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// argumentos: fórmula analisada, objeto Font, ID da fonte (chave de fontMap), tamanho da fonte em pt, cor do texto
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box é o resultado com layout concluído; os elementos math de template executam este mesmo layout internamente
```

#### Obtendo as dimensões de uma imagem — `getImageDimensions()`

Suporta PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### Decodificando um PNG — `decodePng()`

Um decodificador de PNG em TypeScript puro.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### Emitindo no navegador um PDF que contém WebP/AVIF — `prepareBrowserPdfImageResources()`

JPEG é armazenado diretamente no PDF, e PNG é tratado pelo decodificador embutido. Ao gerar no navegador um PDF que contém WebP/AVIF, o `tsreport-core/browser` primeiro decodifica apenas as imagens efetivamente referenciadas pelo `RenderDocument` usando os codecs padrão do navegador e passa os resultados para a geração do PDF. Imagens não referenciadas são mantidas como estão e não são decodificadas.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: bytes de imagem fornecidos no momento da renderização; catalog: configurações
// do catálogo do documento PDF; collection: configurações do portfólio PDF — omita as que não usar
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

Para decodificar WebP/AVIF no Node.js, use `createNodeExternalRasterImageDecoder()` de `tsreport-core/node`.

## Restrições de carregamento de recursos e regras de ID de imagem

Regras detalhadas para consultar quando se tornarem relevantes para a operação em servidor ou para a incorporação como biblioteca.

### Restringindo os diretórios de onde imagens e templates são carregados

O carregamento de arquivos de imagem pode ser confinado a diretórios explicitamente permitidos.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

O `createReportFromFile()` resolve caminhos relativos em relação ao diretório do template principal por padrão, mas, por compatibilidade retroativa, não restringe implicitamente o próprio escopo de carregamento. Quando `resources.fileRoot` é especificado, a mesma restrição se aplica igualmente a imagens, ao template principal e aos sub-relatórios. Imagens ausentes são tratadas conforme a configuração `onError` de cada elemento, e referências que apontam para fora do diretório permitido (inclusive por meio de links simbólicos) sempre resultam em erro.

### Regras de ID de imagem

Cada imagem de um `RenderDocument` é consultada em `RenderDocument.images` usando o `RenderImage.imageId` como chave (o mesmo vale para o `imageId` de uma alternativa). **Os consumidores devem usar esse ID como chave exatamente como está e não devem remontar chaves por concatenação de caminhos ou algo semelhante.** Os IDs são atribuídos pelas regras a seguir.

- Carregar uma imagem por um caminho relativo não substitui o ID pelo caminho absoluto do servidor nem pelo caminho com links simbólicos resolvidos. A referência tal como escrita no template permanece a chave (se escrita como caminho absoluto, esse valor é mantido como está)
- O caminho físico com links simbólicos resolvidos é usado internamente apenas para decidir se duas referências são o mesmo arquivo. Mesmo quando os diretórios base diferem, imagens que apontam para o mesmo arquivo físico reutilizam o mesmo ID
- Em configurações em que o relatório raiz adia uma imagem para fornecimento no momento da renderização — usando `createReport()` diretamente, sem passar a imagem em questão por `resources` tampouco, de modo que a referência escrita no template se torna o ID tal como está e os bytes são fornecidos depois via `renderToPdf(document, { images })` —, as imagens locais de caminho relativo carregadas por sub-relatórios sempre recebem IDs internos independentes do host. Como referências em expressões e em sub-relatórios dinâmicos não podem ser enumeradas antecipadamente, isso não depende de um nome ter de fato colidido nem da ordem de layout. Como resultado, a imagem local de um sub-relatório nunca pode sequestrar um ID de fornecimento no momento da renderização com o mesmo nome

### Fornecimento de imagens no momento da renderização e alternativas

Quando uma alternativa não pôde ser resolvida no momento do layout, o ID da imagem original é mantido. As pré-visualizações em Canvas/SVG, portanto, não param, e os bytes podem ser fornecidos depois via `renderToPdf(document, { images })`. As `images` passadas explicitamente são mescladas em `document.images`, com o valor passado explicitamente tendo precedência para o mesmo ID. Também durante a geração do PDF, alternativas não fornecidas são apenas excluídas das candidatas a alternativa — nem a renderização da imagem principal nem o relatório como um todo param.

### Escopo da coleta de referências de imagem

A coleta de referências de imagem trata não apenas dos elementos `image` comuns, mas também das alternativas, das máscaras suaves de grupo e dos padrões de ladrilho dos preenchimentos (fill/stroke) junto com suas máscaras suaves aninhadas, tudo pelo mesmo mecanismo. Ao usar miniaturas de página específicas de PDF, miniaturas de pasta de coleção ou imagens de Web Capture no navegador, passe os mesmos `catalog`, `collection` e `pageOptions` tanto para `prepareBrowserPdfImageResources(document, options)` quanto para `renderToPdf(document, options)` (com a API primitiva, passe as mesmas opções para `new PdfBackend(options)` e chame `render(document, backend)`). Essas imagens WebP/AVIF também são decodificadas apenas conforme necessário antes da geração do PDF.

## Requisitos de runtime

- Node.js 18 ou superior
- ES Modules / CommonJS
- Navegadores modernos
- Nenhum pacote de dependência em tempo de execução

A compressão e a descompressão Brotli do WOFF2 usam a implementação em TypeScript puro embutida no tsreport-core, tanto no Node.js quanto em navegadores. Nenhum pacote externo, WASM ou biblioteca nativa é necessário.

## Projetos relacionados

- [tsreport-core](https://github.com/pontasan/tsreport-core)
- [tsreport-editor](https://github.com/pontasan/tsreport-editor)
- [tsreport-sdk](https://github.com/pontasan/tsreport-sdk)
- [tsreport-react](https://github.com/pontasan/tsreport-react)

## Licença

O tsreport-core está disponível, à sua escolha, sob a [Licença MIT](./LICENSE-MIT) ou a [Licença Apache 2.0](./LICENSE-APACHE) (SPDX: `MIT OR Apache-2.0`). Para avisos de direitos autorais e termos de licença de código e dados de terceiros, veja [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
