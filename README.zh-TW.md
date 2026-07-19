# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | 繁體中文 | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**從日文、中文、韓文到阿拉伯文字。這是一套僅以 Pure TypeScript，就能將世界各地的文字排成精美 PDF 的報表引擎。**

`tsreport-core` 以單一的繪製模型，一貫地處理 OpenType 字型解析、文字排版（把文字以正確的字形、寬度與位置排列在版面上的處理）、帶區（Band）方式的報表版面配置、Canvas/SVG 預覽，直到 PDF 產生。執行期相依套件為零。不使用原生模組也不使用 WASM，只憑這一個套件即可同時在 Node.js 與現代瀏覽器上運作。

本文件中的程式碼範例刻意使用日文商業資料（報價單、請款單）：它們同時也是本引擎 CJK 排版能力的實際展示。

```bash
npm install tsreport-core
```

本 README 收錄了從第一份 PDF 的產生，到全部 16 種報表元素、直排、多語系排版、字型嵌入與外框化、瀏覽器預覽為止，可以直接複製執行的範例。若您是第一次接觸報表工具，建議先在**報表版面配置的基礎**一節掌握基本概念，再透過教學課程做出第一份 PDF。

## 用單一引擎，正確排出世界各地的文字

多語系報表若只是把字串原封不動寫出到 PDF，是無法正確顯示的。字形的選擇、文字寬度的量測、位置的調整、換行、直排，以及字型嵌入 PDF——這一連串處理全部環環相扣，才能得到符合預期的版面。

`tsreport-core` 從字型解析到 PDF 產生，一貫地承擔這整個流程。

- **日文、中文、韓文** — 從簡體字、繁體字、韓文字母（Hangul）、標點符號的處理，到直排專用字形，皆依據 Unicode 與 OpenType 的資訊正確排版
- **阿拉伯文字與由右至左（RTL）排版** — 隨上下文變化的字形、連接與合字（多個字元相連成為單一字形的現象）、Unicode 雙向處理（由右至左行進的文字與數字、拉丁字母混排時的順序控制），都以與其他文字相同的版面配置流程處理
- **複雜文字系統** — 支援由字型內建排版規則（OpenType Layout）進行的字形替換與位置調整、組合字元、異體字（同一文字的不同設計字形），以及各語言專屬的排版功能
- **直排** — 處理 `vertical-rl` / `vertical-lr`、直排專用字形、直排度量（直排專用的字距等尺寸資訊）與文字旋轉
- **字型自動子集嵌入** — 只將實際使用到的字圖（glyph，字型中收錄的單一文字字形資料）收錄進 PDF，因此即使閱覽端沒有相同字型，也能以相同外觀顯示
- **文字外框化** — 能以元素為單位，將文字輸出為不依賴字型的向量路徑
- **系統字型參照** — 針對使用閱覽環境字型的運用方式，也可選擇不嵌入字型的輕量 PDF
- **亂碼的事前偵測** — `checkGlyphCoverage()` 會在輸出前，以頁面、字元為單位找出字型未收錄的文字

而且，這套文字排版與報表專用的高階版面配置引擎是一體運作的。因為把文字正確排列的能力，與把頁面正確分配的能力密不可分。

- **隨文字量連動的版面配置** — 依字數伸展列高（`stretchWithOverflow`）並自動調整帶區高度。再長的品名也不會被截斷
- **依資料量自動分頁** — 明細溢出時自動換頁，並重新輸出頁首與標題列。以群組為單位的小計、分頁也只需宣告即可
- **巢狀結構的配置** — 結合表格、交叉統計、子報表的複雜報表，也由同一套版面配置引擎一貫地安排
- **WYSIWYG（預覽＝列印）** — 元素會依指定的 pt 座標固定配置，Canvas/SVG 預覽與 PDF 輸出共用同一份版面配置結果。畫面上看到的樣子，就是印出來的樣子

## 為什麼選擇 tsreport-core

tsreport-core 是源於三個問題意識而誕生的專案。

**TypeScript 缺少一套像樣的報表解決方案。** 輸出報價單、請款單是商務的基本需求，然而在 TypeScript/Node.js 生態系中，雖然有低階繪製 PDF 的程式庫，卻沒有一套具備帶區版面配置、自動分頁、彙總統計、預覽與列印一致性的「報表引擎」。我們希望終結為了報表而引入其他語言執行環境或外部伺服器產品的架構。

**報表是基本功能，任何人都應該能免費使用。** 報表輸出並非只有部分高價產品才擁有的特殊功能，而是業務系統的基礎功能。無需購買商用授權、無需按量計費，從個人工具到商用產品，任何人都應該能直接使用同一套引擎。tsreport-core 以 MIT OR Apache-2.0 雙授權公開全部功能，正是這個理念的實踐。

**正面實作亞洲語系、阿拉伯文字等多語系支援的解決方案太少。** 許多報表、PDF 產生工具以西文為前提設計，對日文、中文、韓文的排版，以及由右至左書寫的阿拉伯文字，往往只停留在事後補強。tsreport-core 從一開始就把「用單一引擎，正確排出世界各地的文字」定為設計目標，從字型解析到排版、PDF 嵌入全部自行實作。

我們把這些動機化為以下三大特色。

### 從版面配置引擎到 PDF 產生，一套搞定

以範本與資料組出頁面後，結果會彙整為名為 `RenderDocument` 的單一繪製模型。它可以直接繪製為 PDF、Canvas 或 SVG，因此不需要為畫面預覽與列印分別維護兩套版面配置處理，得到的 PDF 就是畫面上看到的樣子。無需再把具備帶區版面配置的報表引擎與 PDF 程式庫分開組合。

### 執行期相依為零的 Pure TypeScript

字型解析、文字排版、PDF 產生、DEFLATE 壓縮、加密、PNG 解碼、條碼產生，全部以 Pure TypeScript 實作。不使用原生模組也不使用外部程序，因此在任何環境都有相同行為，而且要稽核報表產生時執行的程式碼，也只需閱讀這一個套件。

### 報表所需功能標準內建

- 標題、頁首、明細、群組、總結等帶區版面配置
- 表格、交叉統計、子報表、變數、運算式、分頁、目錄、多份報表合併
- 既有 PDF 的匯入 — 將 PDF 頁面轉換為報表元素（`ElementDef`）、樣式、影像、字型資訊
- Code 39/93/128、EAN、UPC、ITF、Codabar、MSI、QR Code、Data Matrix、PDF417
- SVG、漸層、裁切、透明、數學算式排版、影像
- PDF 加密、PDF/A-1b・2b・3b（長期保存用國際標準）、PDF/X-1a（印刷交付用國際標準）、書籤、連結、表單、註解
- TTF、OTF、TTC、OTC、WOFF、WOFF2、EOT、可變字型（可連續改變粗細、寬度等的字型）、彩色字型

## 報表版面配置的基礎

以下依序說明給第一次使用報表引擎的讀者的基礎概念。

### 前提: 報表分成「範本」與「資料」來製作

在 tsreport-core 中，報表分成**範本**（版面配置的定義）與**資料**（JSON）兩部分來製作。

範本中不寫實際的值。只定義「在這個位置放品名、以這個寬度與格式放金額」的框架，以及**要顯示資料的哪個項目**的參照（`field.item`＝資料的 `item` 項目，這樣的寫法）。

實際的值以 JSON 資料傳入。`rows` 陣列的一個元素，就是明細的一列。

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

產生報表時，引擎會從頭逐列走訪 `rows`，每一列輸出一次明細的版面配置。以上面的例子來說，明細會印出 3 列，`field.item` 分別被替換為「りんご」「みかん」「ぶどう」。即使資料增加到 10,000 列，範本一個字都不用改，就能產出 10,000 列的報表。這種「版面固定、列數由資料決定」的分工，正是報表引擎的出發點。

### 頁面是「帶區」的堆疊

在此之上，範本端把頁面設計成名為**帶區（Band）**的橫長區域的堆疊。不需要自己計算元素的 Y 座標排進頁面，只要宣告「哪個帶區放什麼」，引擎就會依資料列數自動組出頁面。一頁的結構如下。

```text
┌──────────────────────────┐
│ title                    │ ← 報表開頭僅一次（標題、收件人等）
├──────────────────────────┤
│ pageHeader               │ ← 每頁上方（公司名稱、開立日期等）
├──────────────────────────┤
│ columnHeader             │ ← 明細的標題列（「品名・数量・金額」等）
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ rows 的每一列各一次、
│ details                  │ │ 依列數重複
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← 明細的收尾（每頁、每欄）
├──────────────────────────┤
│ pageFooter               │ ← 每頁下方（頁碼等）
└──────────────────────────┘
```

在最後一頁，最後的 `details` 之後會輸出一次 `summary`（整份報表的合計等）。除此之外，還有鋪在每頁背景的 `background`、最後一頁專用的 `lastPageFooter`、僅在資料為 0 列時出現的 `noData`，可在 `bands` 中定義的帶區共有 10 種。

| 帶區 | 輸出時機 | 典型用途 |
| --- | --- | --- |
| `background` | 每頁的背景 | 浮水印、裝飾框 |
| `title` | 報表開頭一次 | 標題、收件人 |
| `pageHeader` | 每頁的上方 | 公司名稱、開立日期 |
| `columnHeader` | 明細之前（每頁、每欄） | 明細的標題列 |
| `details` | 資料（`rows`）的每一列 | 明細列 |
| `columnFooter` | 明細之後（每頁、每欄） | 小計欄 |
| `pageFooter` | 每頁的下方 | 頁碼 |
| `lastPageFooter` | 最後一頁的下方（指定時取代 `pageFooter`） | 結尾文字 |
| `summary` | 全部明細之後一次 | 總計、備註 |
| `noData` | 資料為 0 列時 | 「查無資料」 |

進一步定義 `groups` 之後，群組鍵的值變化的位置會自動插入群組的頁首、頁尾，即可做出「依部門輸出小計並分頁」這類版面。

另外，指定範本的 `columns`（`count`＝欄數、`spacing`＝欄距 pt）後，可將明細區域像報紙一樣分成多個縱向欄位（**多欄**）流入內容。預設為 1 欄，此時本文件中「每欄」的行為即等同於「每頁」。此外，把內容送往下一欄稱為「換欄」。

### 分頁會自動進行

當明細無法容納於頁面時，引擎會自動結束該頁（輸出 `pageFooter`）並開始下一頁，再次輸出 `pageHeader` 與 `columnHeader` 之後，接著流入後續的明細。不需要撰寫計算列數或頁面剩餘高度的程式碼。

只有在需要控制時，才使用下列手段。

- `break` 元素 — 在任意位置強制分頁、換欄
- 帶區的 `startNewPage` — 讓該帶區必定從新頁面開始
- 帶區的 `splitType` — 高度不足時，選擇允許帶區中途跨頁（`stretch`），或不分割整個送往下一頁（`prevent`）

### 子報表 = 嵌入報表之中的另一份報表

`subreport` 元素會把另一份 `.report` 整個嵌入父報表的版面之中。這是用來排「印出訂單清單，並在每筆訂單內以表格印出其明細」——這類**巢狀資料**的機制。

例如，假設父報表 `rows` 的一列（＝一筆訂單）擁有明細陣列 `items`。

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

在父報表的 `details` 帶區放置 `subreport` 元素，以 `dataSourceExpression` 傳入「這筆訂單的 `items`」。

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` 一如其名是「運算式」。要傳固定檔名時，以 `'...'` 包成運算式中的字串常值（也可以像 `"field.templatePath"` 一樣用運算式動態切換）。

如此一來，**父報表的每一列明細都會執行一次子報表**，傳入的 `items` 會被當成子報表端的 `rows`。子報表（`order-items.report`）是獨立的一份範本，擁有自己的帶區定義，以 `field.name`、`field.qty` 參照明細的每一列。在頁面上會像下面這樣展開。

```text
┌──────────────────────────────┐
│ details                      │ ← 父報表 rows 第 1 列（訂單 A-001）
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← 傳入這筆訂單的 items（2 筆）
│   │   details              │ │ ← items 第 1 列（りんご 10）
│   │   details              │ │ ← items 第 2 列（みかん 5）
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← 父報表 rows 第 2 列（訂單 A-002）
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← 傳入這筆訂單的 items（1 筆）
│   │   details              │ │ ← items 第 1 列（ぶどう 2）
│   └────────────────────────┘ │
└──────────────────────────────┘
```

請款單中的明細表、依客戶重複的明細區塊等，「報表中的小報表」都可以切出成零件重複使用。也可以從父報表傳入參數（標題文字等）。稍後的**全部報表元素的實作範例**中，有相同構成、可直接執行的完整範例（父元素＋子報表端範本）。

## 從 `.report` 與 JSON 資料產生 PDF

`.report` 是以 JSON 描述 `ReportTemplate` 的報表範本。內容就只是 JSON，因此可以用 Git 管理差異，也可以由任意語言或工具產生。

最小構成為以下 3 個檔案。

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

兩個字型檔名假定為日文字型（例: Noto Sans JP）的 Regular / Bold。請依手邊的字型自行替換。在同一份報表中處理多種語言的方法，於後述的**製作多語系報表**中說明。

### 1. 撰寫範本 `quotation.report`

座標、尺寸、邊界、字型大小的單位，全部是 PDF 的標準單位 **pt（point，1pt = 1/72 英吋 ≈ 0.353mm）**。`"size": "A4"` 會被視為 595 × 842pt（將 ISO 尺寸 210×297mm 換算為 pt 並捨入為整數的值），本例的邊界 36pt 約為 12.7mm。

另一個前提是，`styles` 的 `fontFamily` 並非字型檔名，而是稍後在執行程式端的 `fontMap`、`fonts` 中註冊的**鍵名（邏輯名稱）**。在範本與程式中使用相同名稱（本例為 `jp`、`jpBold`）來建立對應。

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

明細中使用的 `pattern` 是數值、日期的格式指定（`#,##0`＝千分位分隔，`¥#,##0`＝帶日圓符號的千分位分隔。詳見後述的「想將數值、日期格式化」）。

### 2. 準備資料 `quotation.test-data.json`

`rows` 的每一列會繫結到明細帶區的 `field.*`，`parameters` 會繫結到整份報表的 `param.*`。

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

繫結的對應關係如下。

| JSON | `.report` 的運算式 | 用途 |
| --- | --- | --- |
| `rows[n].item` | `field.item` | 目前的明細列 |
| `parameters.title` | `param.title` | 整份報表的引數 |
| 變數 `grandTotal` | `vars.grandTotal` | 彙總、計數等報表變數 |
| 頁面內容脈絡 | `PAGE_NUMBER` / `TOTAL_PAGES` | 頁碼、總頁數 |

### 3. 讀入 `.report` 並產生 PDF

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
  // Node.js Buffers can share a larger memory pool; pass Font.load an ArrayBuffer
  // sliced to exactly this file's bytes
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

`fontMap` 與 `fonts` 之所以把同一字型重複註冊兩次，是因為兩者角色不同。`fontMap` 用於版面配置時的文字寬度量測（`TextMeasurer`），`fonts` 用於 PDF 產生時的字型嵌入。請把同一字型，以與範本 `fontFamily` 相同的鍵名，同時註冊到兩者。

`createReportFromFile()` 會以主 `.report` 的目錄為基準解析影像與子報表的相對路徑。若指定了 `workingDirectory`，則以該目錄為基準。要限制讀取範圍時，請在 `resources.fileRoot` 明示允許的根目錄。指向根目錄之外的相對參照，以及指向根目錄之外的符號連結都會被拒絕。

## 以 TypeScript 直接定義範本

不使用 `.report` 檔案，也可以把範本寫成 TypeScript 的物件。因為有型別檢查與自動完成，適合以程式產生範本的用途。內容與教學課程相同，是一份報價單。座標與尺寸的單位為 pt。

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

### 以 ID 取得元素，並在繪製前修改

為元素加上任意的 `id` 後，即可用 `findElementById()` 取得，而不受帶區或框架的深度影響。回傳值不是複本，而是 `template` 內的元素本身，因此在 `createReport()` 之前所做的修改，會反映到版面配置與繪製。

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

`findElementById()` 會以深度優先搜尋一般帶區、明細帶區、群組的頁首／頁尾、框架、軟遮罩、表格儲存格。同一 ID 存在多個時，會回傳搜尋順序中的第一個元素，因此作為修改對象使用的 ID，請在範本內保持唯一。`getElementChildren()` 回傳陣列中的元素同樣是原範本內的參照。

> 字型檔不隨套件附帶。請指定授權適合用途、發布方式與嵌入許可的字型。一個樣式只能指定一個字型。若要在單一元素中混排多種語言的文字，需要將它們收錄於一體的 Pan-CJK 字型（將日中韓文字統整收錄的字型。例: Source Han Sans〔思源黑體〕、Noto Sans CJK）。若各語言使用不同字型，則如下一節「製作多語系報表」所示，以語言為單位拆分元素並分別套用樣式。

## 製作多語系報表

一個樣式只能指定一個字型，字型之間沒有自動遞補。因此多語系報表的基本形是：**依語言載入字型，對各語言的元素分別套用其樣式**。

以下範例是日文與簡體中文並列的報價單節錄。首先依語言載入字型。

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

在範本中，對日文文字套用 `ja` 樣式、對中文文字套用 `zh` 樣式，以語言為單位拆分元素。

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

資料也依語言分項持有。

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

例外是像自由填寫的備註那樣，**直到執行期才知道會輸入哪種語言的單一欄位**。該欄位無法依語言拆分元素，因此比較實際的做法是只對該樣式指派將多種文字系統收錄於一體的 Pan-CJK 字型（Source Han Sans〔思源黑體〕、Noto Sans CJK 等）。無論採用哪種方式，字型未收錄的缺漏都會由 `checkGlyphCoverage()` 在輸出前偵測出來。

## 依文字元素個別選擇字型輸出方式

即使在同一份報表內，也可以依每個 `staticText` 或 `textField` 指定輸出方式，例如內文用可搜尋的嵌入文字、標誌用外框化、定型文字用系統字型參照。

| 方式 | 指定 | 在 PDF 中的狀態 | 適合的用途 |
| --- | --- | --- | --- |
| 子集嵌入 | `pdfFontMode: 'embedded'`（預設） | 嵌入使用到的字圖與字型程式。文字可選取、可搜尋 | 發布、長期保存、印刷、多語系報表 |
| 外框化 | `outlineText: true` | 將字形轉換為向量路徑。不含字型資訊 | 標誌、完稿等想完全固定字形的文字 |
| 系統字型參照 | `pdfFontMode: 'reference'` | 不嵌入字型，只記錄字型名稱與文字 | 可控管字型環境的公司內部發布等的輕量 PDF |

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

子集嵌入是不依賴輸出端環境、能保持字形的建議方式。系統字型參照需要開啟 PDF 的環境擁有相容字型，環境不同外觀也可能改變。外框化後的文字無法作為一般字串選取、搜尋。

## 直排

只要在樣式中指定 `writingMode`，就會使用直排專用字形與直排專用的尺寸資訊（直排度量＝文字的字距等）進行直排。`vertical-rl` 的行由右往左推進，`vertical-lr` 的行由左往右推進。

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

## 在瀏覽器中預覽與 PDF 相同的報表

為 PDF 建立的 `RenderDocument`，可以原封不動繪製到 Canvas 上。預覽與列印共用同一份版面配置結果，因此不會發生「畫面與紙張外觀不同」的問題。搭配 pt 單位的固定版面配置，成為 WYSIWYG 預覽、編輯體驗的基礎（字型嵌入為預設。只有系統字型參照模式的外觀依賴閱覽環境）。只要呼叫 `renderPage()`，連同頁面的開始、結束處理都會一併繪製。

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
  scale: 1.5, // display scale: 1.0 draws 1pt as 1px
  devicePixelRatio: window.devicePixelRatio, // keeps text and lines crisp on high-DPI displays
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

若要以 React 組建預覽 UI，也可以使用 `tsreport-react` 套件。

## 單獨使用字型引擎

即使不製作報表，也可以單獨使用字型解析、成形（shaping，將字串轉換為實際繪製的字形序列與位置的處理）、文字量測、子集產生等各項功能。

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: string width in pt at 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // glyph IDs and positions after shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: Bezier path data

console.log(measurement.width, shaped, glyph.outline)
```

## 將既有 PDF 轉換為報表元素（PDF 匯入）

`importPdfPage()` 會解析既有 PDF 的頁面，轉換為 tsreport-core 報表元素（`ElementDef`）的陣列。它不只是檢視器：文字轉為 `staticText`、影像轉為 `image`、圖形轉為 `path`，以可在本報表引擎中直接編輯、重新配置的零件形式匯入。

以長年紙本運用的報表 PDF 或其他系統輸出的 PDF 為底稿，加上資料合併欄位、重組版面——這是「把既有報表資產範本化」的入口。

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: staticText / image / path 等報表元素的陣列
// page.styles:   元素參照的文字樣式定義
// page.images:   元素參照的影像資料
// page.fonts:    被參照字型的資訊
console.log(pageCount, page.width, page.height, page.elements.length)
```

匯入的 `elements` 與 `styles` 可以直接配置到範本的帶區。加密 PDF 的密碼指定、註解的匯入、匯入文字的外框化等，以 `PdfImportOptions` 控制。

## 靈活運用運算式（Expression）

報表的「會動的部分」，全部以運算式撰寫。`textField` 的列印內容、`printWhenExpression` 的列印條件、條碼的資料、影像的路徑、傳給子報表的資料——型別為 `Expression` 的屬性，在任何地方都能寫相同的運算式。

運算式有兩種形式。

- **字串運算式** — 如 `"field.price * field.quantity"` 的字串。由專用剖析器解讀的 JavaScript 安全子集，完全不使用 `eval` 或 `new Function`。範本可儲存為 JSON（`.report` 檔案）
- **回呼運算式** — `(field, vars, param, report) => …` 的 TypeScript 函式。可完整使用語言功能，但範本將無法儲存為 JSON（以 TypeScript 保存範本為前提）

建議先掌握字串運算式能寫到什麼程度，不夠用時再進到回呼運算式。

### 運算式中可參照的值

| 名稱 | 內容 |
| --- | --- |
| `field.*` | 目前的資料列。可如 `field.customer.name` 巢狀參照 |
| `vars.*` | 變數（後述 `variables` 定義的彙總值）。寫 `var.*` 也相同 |
| `param.*` | 整份報表的值。以資料來源的 `parameters` 傳入的值，與範本 `parameters` 的 `defaultValue`。在子報表中，由父報表傳入的參數也在這裡 |
| `PAGE_NUMBER` | 目前的頁碼（從 1 開始） |
| `COLUMN_NUMBER` | 目前的欄號（從 1 開始） |
| `REPORT_COUNT` | 已處理的資料列數 |
| `TOTAL_PAGES` | 總頁數。**直接參照會得到「截至當時的頁數」**，要列印最終總頁數需搭配 `evaluationTime: 'report'` 或 `'auto'`（後述） |

參照不存在的欄位不會擲出例外，而是得到 `undefined`（`field.a.b` 中途為 `null` 時也會安全地回傳 `null`）。

### 字串運算式可用的語法

| 分類 | 可用項目 |
| --- | --- |
| 常值 | 數值（`1200`、`0.5`）、字串（`'見積'` 或 `"見積"`。支援 `\n` 等逸出）、`true`／`false`／`null`／`undefined` |
| 樣板常值 | `` `合計 ${vars.total} 円` `` — `${}` 之中可寫完整的運算式 |
| 算術 | `+`（數值加法與字串串接）、`-`、`*`、`/` |
| 比較 | `>`、`>=`、`<`、`<=`、`===`、`!==` |
| 邏輯 | `&&`、`\|\|`、`!`（與 JavaScript 相同的短路求值） |
| 空值合併 | `??` — 左邊為 null/undefined 時回傳右邊 |
| 條件（三元） | `條件 ? 真值 : 假值` |
| 其他 | 一元的 `-`／`+`、括號 `( )`、點記法的成員存取（屬性名稱也可用日文: `field.顧客名`） |
| 內建函式 | `format(值, 樣式)`＝格式化（後述）／`round(值, 位數?)`＝四捨五入／`roundUp`・`roundDown`・`roundHalfEven`（銀行家捨入）・`ceil`・`floor`・`trunc`（第 2 引數皆為小數位數，省略時為 0）／`now()`＝目前時刻 |

**不可用的項目**: `==`／`!=`（請用 `===`／`!==`）、`%` 或 `**`、中括號記法（`field['a-b']`）與陣列索引、方法呼叫（`field.name.toUpperCase()` 會在求值時發生錯誤——可呼叫的函式只有上述內建函式）、指派、函式定義、`new`、optional chaining（`?.`——因為中途為 null 本來就不會擲出例外，所以不需要）。需要這些時請使用回呼運算式。

這些限制是為了安全。字串運算式由自製剖析器解讀，絕不會作為程式碼執行，因此無法在外部收到的範本中植入任意程式碼。

### 想列印計算結果

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

資料範例:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

會列印為 `¥3,960`。

### 想組合字串

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

嵌入樣板常值 `${}` 的值會被字串化後串接。**null 會變成字串 `"null"`**，因此可能缺漏的項目請如範例加上 `?? ''`。

### 想依條件切換顯示內容

以三元運算子切換列印內容。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

若不是「改變顯示的內容」而是「決定要不要顯示」，請使用全元素共通的 `printWhenExpression`（參照「想在符合條件時才列印元素」）。要依條件改變樣式（顏色或粗體）時，在樣式定義的 `conditionalStyles` 中指定寫法相同的條件運算式。

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### 想將數值、日期格式化 — `format` 與 `pattern`

`textField` 可透過 `pattern` 屬性，在列印時將運算式的求值結果格式化。想在運算式中局部格式化時，使用內建函式 `format(值, 樣式)`。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

數值樣式由 `#`（有位數才顯示）、`0`（補 0）與 `,`（千分位分隔）組合而成，前後可加上前綴、後綴。捨入方式為四捨五入。

| 樣式 | 輸入 | 輸出 |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

日期樣式的代碼為 `yyyy`（4 位數年）、`MM`／`M`（補 0 月／月）、`dd`／`d`（補 0 日／日）、`HH`（補 0 時、24 小時制）、`mm`（分）、`ss`（秒）。值為 null/undefined 時輸出空字串。

需要這些不敷使用的格式（日本年號、星期、貨幣位數處理等）時，在範本的 `formatters` 註冊具名的 TypeScript 函式，並在 `pattern` 寫上該名稱。

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// 元素端: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` 會先尋找已註冊的格式器名稱，找不到時解讀為內建格式。格式器是函式，因此使用此功能的範本以 TypeScript 而非 JSON 保存。

### 想列印合計、平均、筆數 — 變數（`variables`）

跨越明細的彙總，定義在範本的 `variables`。變數在每處理一筆資料列時，會把 `expression` 的結果納入彙總，運算式中則以 `vars.名稱` 參照目前值。

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

在 `pageFooter` 帶區放置 `"expression": "vars.pageTotal"` 的 `textField` 即為頁面小計，在 `summary` 帶區放置 `"expression": "vars.grandTotal"` 即為總計。

**屬性清單（`variables` 的各元素）**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 變數名稱。運算式中以 `vars.名稱` 參照 |
| `expression` | Expression | ✓ | 每列求值，結果納入彙總 |
| `calculation` | `'sum'`＝合計 / `'average'`＝平均 / `'count'`＝筆數 / `'distinctCount'`＝去除重複的筆數 / `'min'`＝最小值 / `'max'`＝最大值 / `'first'`＝第一個值 / `'nothing'`＝每列覆寫（最後的值） | ✓ | 彙總方法 |
| `resetType` | `'report'`＝整份報表持續彙總（不重設、預設） / `'page'`＝每頁重設 / `'column'`＝每欄重設 / `'group'`＝依 `resetGroup` 的群組重設 / `'none'`＝不重設這點與 `'report'` 相同，但即使延遲求值（`evaluationTime`）也會以配置元素當下的值定案（不會事後替換為最終彙總值） |  | 彙總的重設單位 |
| `resetGroup` | string |  | `resetType: 'group'` 時的對象群組名稱 |
| `incrementCondition` | Expression |  | 指定時，求值結果為假的列不納入彙總（條件式彙總） |
| `initialValue` | Expression |  | 初始化、重設時的初始值 |

使用 `incrementCondition`，「只合計特定類別」這類條件式彙總可以用一個變數寫成:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

另外，想在父報表彙總子報表的執行結果時，`subreport` 元素的 `returnValues` 會把子報表的變數寫回父報表的 `vars.*`（參照 `subreport` 的屬性清單）。

### 想列印頁碼、總頁數

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

重點在 `evaluationTime: 'auto'`。運算式通常在配置元素的當下求值，但那個時間點還不知道最終的總頁數。指定 `'auto'` 後，會靜態分析運算式，讓 `PAGE_NUMBER` 在頁面定案時、`TOTAL_PAGES` 在報表完成時，**依各參照在正確的時機求值**。`'auto'` 需要分析運算式，因此僅限字串運算式（對回呼運算式指定會擲出例外）。

### 想寫字串運算式做不到的事 — 回呼運算式

若範本以 TypeScript 定義，所有接受 `Expression` 的位置都可以直接寫函式。引數為 `(field, vars, param, report)` 四個，可從 `report` 參照 `PAGE_NUMBER` 等內建值、`format` 函式與已註冊的 `formatters`。

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

方法呼叫、正規表達式、外部函式的使用等，TypeScript 能寫的都能寫。代價有兩個——範本無法再以 JSON 儲存、傳輸，以及不能使用 `evaluationTime: 'auto'`（`'report'` 等明示指定仍可使用）。

### 運算式發生錯誤時的行為

- **語法錯誤、禁止語法**（方法呼叫等）會擲出帶位置資訊的 `ExpressionLanguageError`，並直接傳播到 `createReport()` 的呼叫端。不會被吞掉變成空欄
- **參照不存在的欄位、變數**不會產生錯誤，而是求值為 `undefined`。在 `textField` 中若指定了 `blankWhenNull: true` 則為空欄，未指定則列印字串 `null`
- 想在執行前驗證使用者輸入的運算式時，`validateExpressionSource(source)` 會回傳語法檢查結果（錯誤或 `null`）

## 全部報表元素的實作範例

以下列出 `ElementDef` 提供的全部 16 種元素。所有元素都指定 `x`、`y`、`width`、`height`（單位為 pt，1pt = 1/72 英吋），配置到帶區或 `frame` 的 `elements`。

| 想做的事 | 元素 |
| --- | --- |
| 列印固定字串 | `staticText` |
| 列印資料、變數、運算式的結果 | `textField` |
| 畫線 | `line` |
| 畫矩形、圓角框 | `rectangle` |
| 畫圓、橢圓 | `ellipse` |
| 畫任意向量圖形 | `path` |
| 配置影像 | `image` |
| 將多個元素框在一起 | `frame` |
| 列印表格 | `table` |
| 列印交叉統計表 | `crosstab` |
| 在報表中嵌入另一份報表 | `subreport` |
| 列印條碼、QR Code | `barcode` |
| 列印數學算式 | `math` |
| 列印 SVG | `svg` |
| 製作可輸入的 PDF 表單 | `formField` |
| 在任意位置分頁、換欄 | `break` |
| 僅在符合條件時列印元素 | `printWhenExpression`（全元素共通的屬性） |

以下每種元素各提供一個可直接放進帶區 `elements` 陣列的定義，使用運算式的元素並附上對應的資料範例。同時在各元素小節末尾，列出該元素特有的屬性清單。全元素共通的屬性（位置、顏色、列印條件等）與樣式的屬性，請參照後述的「元素屬性參考」。

### 想列印固定字串 — `staticText`

將寫在範本中的字串原樣列印。用於標題或標籤。

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | 元素種別 |
| `text` | string | ✓ | 要列印的固定字串 |
| `actualText` | string |  | 當外觀文字與複製、搜尋取出的文字不同時的替換文字（PDF 的 /ActualText）。主要供 PDF 匯入保留來源 PDF 的指定 |
| `hyperlink` | HyperlinkDef |  | 超連結（參照共通屬性一節的 **`HyperlinkDef`**） |
| `anchorName` | string |  | 錨點名稱。作為書籤或文件內連結（`hyperlink` 的 `'localAnchor'`）的目的地登錄 |
| `bookmarkLevel` | number |  | 將此元素的文字放入 PDF 檢視器側邊欄顯示的目錄（書籤）時的階層層級（1 為最上層，1〜6） |

※ 此外可指定全元素共通屬性與 `TextProperties` 的全部屬性。

### 想列印資料或運算式的結果 — `textField`

列印 `expression` 的求值結果。可參照 `field.*`（資料）、`vars.*`（變數）、`param.*`（參數）、`PAGE_NUMBER` 等，並以樣板常值組合字串。運算式寫法的全貌請參照「靈活運用運算式（Expression）」。以 `pattern` 指定數值、日期的格式，以 `stretchWithOverflow` 指定隨文字量伸展高度。
```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

資料範例:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | 元素種別 |
| `expression` | Expression | ✓ | 回傳列印值的運算式 |
| `pattern` | string |  | 格式樣式。優先使用範本註冊的自訂格式器（`formatters` 的樣式名稱），沒有時以內建格式器整形 |
| `blankWhenNull` | boolean |  | 運算式結果為 null/undefined 時輸出空字串（未指定時會列印字串 `'null'`） |
| `stretchWithOverflow` | boolean |  | 內容超出 height 時，將元素高度伸展至符合內容 |
| `evaluationTime` | `'now'`＝當場立即求值（預設） / `'band'`＝帶區定案時求值 / `'column'`＝欄結束時求值 / `'page'`＝頁面結束時求值 / `'group'`＝`evaluationGroup` 的群組定案時求值 / `'report'`＝報表結束時求值（TOTAL_PAGES 等已定案） / `'auto'`＝將運算式參照的各變數、內建值分別在各自的重設時機個別求值（僅限字串運算式。回呼運算式會擲出例外） |  | 運算式的求值時機。指定預設以外的值時，配置當下先保留空白區域，待該時機的值定案後再填入。典型例: 把群組合計提前印在群組開頭（`'group'`）、列印最終總頁數（`'report'`） |
| `evaluationGroup` | string |  | `evaluationTime: 'group'` 時的對象群組名稱 |
| `textTruncate` | `'none'`＝不繪製放不下的行（預設。現行實作與 `'truncate'` 行為相同） / `'truncate'`＝以行為單位截掉放不下的行 / `'ellipsisChar'`＝在最後一行的字元邊界截斷並加上 `...` / `'ellipsisWord'`＝在最後一行的單字邊界截斷並加上 `...` |  | `stretchWithOverflow` 停用時，超出高度的文字的處理方式。預設: `none` |
| `hyperlink` | HyperlinkDef |  | 超連結（參照共通屬性一節的 **`HyperlinkDef`**） |
| `anchorName` | string |  | 錨點名稱。作為書籤或文件內連結（`hyperlink` 的 `'localAnchor'`）的目的地登錄 |
| `bookmarkLevel` | number |  | 將此元素的文字放入 PDF 檢視器側邊欄顯示的目錄（書籤）時的階層層級（1 為最上層，1〜6） |

※ 此外可指定全元素共通屬性與 `TextProperties` 的全部屬性。`isPrintRepeatedValues: false` 在本元素有效（抑制相同值的連續列印）。

### 想畫線 — `line`

此例為高度 0 的水平線。`lineStyle` 除 `solid` 外還可指定 `dashed` 等。

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | 元素種別。線段從元素左上 `(x, y)` 繪製到右下 `(x+width, y+height)`（`height: 0` 為水平線，`width: 0` 為垂直線，兩者皆非 0 為對角線） |
| `lineWidth` | number |  | 線寬（pt）。預設: 1 |
| `lineStyle` | `'solid'`＝實線 / `'dashed'`＝虛線 / `'dotted'`＝點線 |  | 線種。預設: 實線 |
| `lineColor` | string |  | 線色。預設: 元素的 `forecolor`，再沒有則為 `#000000` |

### 想畫矩形、圓角框 — `rectangle`

以 `cornerRadii` 可個別指定四個角的圓角。

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

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | 元素種別 |
| `radius` | number |  | 圓角半徑（pt。四角共通） |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | 各角的圓角半徑（pt） |
| `fill` | FillDef |  | 填色（參照共通屬性一節的 **`FillDef`**）。預設: 樣式的 `backcolor`（非 `transparent` 時） |
| `stroke` | string |  | 框線色。預設: 樣式的 `forecolor` |
| `strokeWidth` | number |  | 框線寬（pt）。預設: 1 |

### 想畫圓、橢圓 — `ellipse`

繪製內接於框的寬度、高度的橢圓。

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | 元素種別。繪製內接於元素邊界框的橢圓（中心 `(x+width/2, y+height/2)`、半徑 `width/2`×`height/2`） |
| `fill` | FillDef |  | 填色（參照共通屬性一節的 **`FillDef`**）。未指定時不填色 |
| `stroke` | string |  | 框線色。未指定時無框線 |
| `strokeWidth` | number |  | 框線寬（pt）。預設: 1（指定 `stroke` 時） |

### 想畫任意向量圖形 — `path`

在 `d` 指定 SVG 的路徑語法，在 `viewBox` 指定其座標系。圖形會配合元素的框縮放。

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

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | 元素種別 |
| `d` | string | ✓ | SVG 路徑資料（M/L/C/Z 等）。座標為元素區域 pt |
| `pdfSourceVector` | PdfSourceVectorDef |  | PDF 匯入將反覆出現的相同圖形（地圖符號等）以「定義 1 次＋配置 N 次」的形式保全的資料（參照後述的 **`PdfSourceVectorDef`**）。指定時不剖析 `d`。手寫範本不需指定 |
| `affineTransform` | [number, number, number, number, number, number] |  | 繪製前將路徑座標映射到元素區域座標的仿射變換矩陣。`[a, b, c, d, e, f]` 表示 `x' = a·x + c·y + e、y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, 寬, 高]`。將路徑座標從此區域縮放到元素的寬、高 |
| `fill` | FillDef |  | 填色（參照共通屬性一節的 **`FillDef`**）。未指定時不填色 |
| `fillRule` | `'nonzero'`（預設） / `'evenodd'` |  | 對自我相交或巢狀的路徑，判定何處為「內側」而填色的規則。要挖出甜甜圈狀的孔時，用 `'evenodd'` 較為可靠 |
| `fillOpacity` | number |  | 填色的不透明度（0.0〜1.0） |
| `stroke` | FillDef |  | 描邊（除單色外也可指定漸層等）。未指定時無描邊 |
| `strokeWidth` | number |  | 描邊寬（pt）。預設: 1（指定 `stroke` 時） |
| `strokeOpacity` | number |  | 描邊的不透明度（0.0〜1.0） |
| `strokeLinecap` | `'butt'`＝端點截平 / `'round'`＝圓端 / `'square'`＝方端（延長線寬的一半） |  | 線端形狀 |
| `strokeLinejoin` | `'miter'`＝尖角（miter） / `'round'`＝圓角 / `'bevel'`＝斜切 |  | 線的接合形狀 |
| `strokeMiterLimit` | number |  | 尖角限界值。預設: 10 |
| `strokeDasharray` | number[] |  | 虛線樣式（線段與間隔長度的陣列，pt） |
| `strokeDashoffset` | number |  | 虛線樣式的開始位移（pt） |

### 想配置影像 — `image`

以 `sourceExpression`（運算式）或 `source`（固定值）指定影像。以 `scaleMode` 選擇如何收入框內，以 `onError` 選擇找不到影像時的行為（`error`＝視為錯誤 / `blank`＝空白 / `icon`＝顯示圖示）。

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

資料範例:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | 元素種別 |
| `source` | string | | 固定的影像參照（影像 ID）。可直接寫以 `.report` 為基準的相對路徑、絕對路徑、URL、data URI 等（ID 的規則參照後述的「資源讀取的限制與影像 ID 的規則」）。在 `sourceExpression` 未指定或求值結果未解析時使用 |
| `sourceExpression` | Expression | | 動態的影像來源運算式。結果為字串時解析為影像 ID，為 `Uint8Array` 時視為影像資料本身 |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | 影像的縮放方式。`'clip'`＝以原尺寸配置並以元素框裁切／`'fillFrame'`＝忽略長寬比變形縮放至填滿元素框／`'retainShape'`＝維持長寬比，以能收入框內的最大倍率縮放／`'realSize'`＝原尺寸配置＋框裁切（實作上與 `'clip'` 為相同處理）。預設: `'retainShape'`。另外，無法取得影像尺寸時，行為與 `'fillFrame'` 相同 |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | 影像在框內的水平配置（作用於 `retainShape` 的留白配置、`clip`/`realSize` 的裁切位置）。預設: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | 影像在框內的垂直配置。預設: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | 影像來源未定義、解析失敗時的行為。`'error'`＝擲出例外／`'blank'`＝不繪製任何內容／`'icon'`＝繪製灰色框與 × 記號的預留位置。預設: `'icon'` |
| `lazy` | boolean | | 僅存在於型別定義，現行的版面配置引擎、渲染器實作不會參照（規格未記載） |
| `rotation` | `0` \| `90` \| `180` \| `270` | | 影像的旋轉角（度） |
| `affineTransform` | [number, number, number, number, number, number] | | 以矩陣直接指定配置的替代手段。`[a, b, c, d, e, f]` 是把單位正方形（0〜1）的影像以 `x' = a·x + c·y + e、y' = b·x + d·y + f` 映射的變換，指定時不進行 `scaleMode`/`hAlign`/`vAlign`/`rotation` 的配置計算。主要供 PDF 匯入保全原始配置 |
| `opacity` | number | | 不透明度（0.0〜1.0） |
| `interpolate` | boolean | | 放大低解析度影像時，讓檢視器平滑內插像素邊界顯示（PDF 的 /Interpolate）。照片適合啟用，條碼等想清晰顯示的影像適合停用 |
| `alternates` | PdfImageAlternateDef[] |  | 螢幕顯示用與列印用分別使用不同影像的 PDF 替代影像（/Alternates）。各元素有 `source`＝替代影像的參照（必填）與 `defaultForPrinting`＝列印時是否改用此影像，共 2 個屬性 |
| `opi` | PdfOpiMetadataDef |  | 商業印刷中將低解析度預留影像於輸出時替換為高解析度影像的 OPI 資訊。主要供 PDF 匯入保全用（參照後述的 **`PdfOpiMetadataDef`**） |
| `measure` | PdfMeasurement |  | 圖面、地圖 PDF 中檢視器量測工具使用的比例尺、座標系資訊。主要供 PDF 匯入保全用（參照後述的 **`PdfMeasurement`**） |
| `pointData` | PdfPointData[] |  | 地圖 PDF 的點群資料（緯度、經度等）。主要供 PDF 匯入保全用（參照後述的 **`PdfPointData`**） |
| `hyperlink` | HyperlinkDef | | 超連結（`type`: `'reference'`＝URL／`'localAnchor'`＝文件內錨點／`'localPage'`＝文件內頁面／`'remoteAnchor'`・`'remotePage'`＝外部 PDF 內錨點、頁面，`target`: 連結目的地的運算式，`remoteDocument?`: 外部 PDF 路徑的運算式） |

### 想將多個元素框在一起 — `frame`

將子元素群組化，可用 `border` 指定框線、`clip` 指定超出部分的裁切。子元素的座標以 `frame` 的左上為原點。

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

資料範例:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | 元素種別 |
| `clip` | boolean | | 是否以框架邊界裁切子元素。預設: true |
| `border` | BorderDef | | 框線（參照共通屬性一節的 **`BorderDef`**） |
| `padding` | Padding | | 內側留白（`top?`/`bottom?`/`left?`/`right?`，各為 pt） |
| `rotation` | number | | 框架的旋轉角（度，頁面座標中逆時針） |
| `rotationOriginX` | number | | 旋轉原點 X（相對於框架，pt）。預設: 0 |
| `rotationOriginY` | number | | 旋轉原點 Y（相對於框架，pt）。預設: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | 將 Y 軸朝上的框架區域座標映射到父座標空間的仿射矩陣（矩陣的排列與意義和 `image` 的 `affineTransform` 相同）。主要供 PDF 匯入保全原始配置 |
| `pdfForm` | PdfFormXObjectDef |  | 供 PDF 匯入保留來源 PDF 零件（Form XObject）持有的座標系、中繼資料並重新輸出（參照後述的 **`PdfFormXObjectDef`**）。手寫範本不需指定 |
| `hyperlink` | HyperlinkDef | | 超連結（與 image 的同名屬性結構相同） |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | 以 SVG 路徑語法定義的裁切路徑。`d`＝路徑資料，`fillRule`＝填色規則 |
| `transparencyGroup` | boolean | | 即使 `isolated`/`knockout` 皆停用，仍保持 PDF 的透明群組邊界。保持後，不透明度、混合的合成結果會與把框架當作一張圖合成時相同（主要用於 PDF 匯入的重現） |
| `isolated` | boolean | | 隔離透明群組（PDF /Group /I）。設定它（或 `knockout` / `softMask`）之後，框架會先整體合成，再套用不透明度、混合、遮罩 |
| `knockout` | boolean | | 去底（knockout）透明群組（PDF /Group /K）。群組內重疊的子元素彼此不互相透出，各位置只有最前面的子元素與背景合成 |
| `softMask` | FrameSoftMaskDef | | 讓框架局部透明化的軟遮罩（參照下表 **`FrameSoftMaskDef`**）。把 `elements` 的繪製結果當作「透明度地圖」使用，可做出以漸層逐漸消失之類的表現 |
| `deviceParams` | DeviceParamsDef | | 面向商業印刷製版流程的參數（參照下表 **`DeviceParamsDef`**）。一般報表不需指定，主要供 PDF 匯入保全來源 PDF 的指定 |
| `elements` | ElementDef[] | | 框架內的子元素 |

**`FrameSoftMaskDef`**（`softMask` 的結構）
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | 遮罩種別。`'luminosity'`＝遮罩越亮的部分框架越不透明／`'alpha'`＝遮罩越不透明的部分框架越不透明 |
| `colorSpace` | PdfProcessColorSpaceDef | | 軟遮罩透明群組的混合色彩空間 |
| `isolated` | boolean | | 軟遮罩透明群組的隔離旗標 |
| `knockout` | boolean | | 軟遮罩透明群組的去底旗標 |
| `backdrop` | [number, number, number] | | 亮度遮罩用 /BC 背景色（DeviceRGB 0〜1）。預設: 黑 |
| `elements` | ElementDef[] | ✓ | 作為透明群組合成、定義遮罩的元素群 |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | 重新映射遮罩值（0..1）的 /SMask /TR 轉換函式 |

**`DeviceParamsDef`**（`deviceParams` 的結構。面向商業印刷製版，通常不需指定——主要供 PDF 匯入保全用）
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | /TR 轉換函式。`'Identity'`／`'Default'`／全色版共通的單一函式／每 4 色版各一的函式陣列 |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | /BG 黑版產生函式（`'Default'`＝依 /BG2 的裝置預設） |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | /UCR 底色移除函式（`'Default'`＝依 /UCR2 的裝置預設） |
| `halftone` | `'Default'` \| HalftoneDef | | /HT 網點（type 1 網屏／type 6・10・16 閾值陣列／type 5 各色版集合） |
| `halftoneOrigin` | [number, number] | | PDF 2.0 網點原點（/HTO，裝置空間像素） |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | PDF 2.0 黑點補償控制（/UseBlackPtComp） |
| `flatness` | number | | 平滑化容許誤差（/FL） |
| `smoothness` | number | | 漸變平滑度容許誤差（/SM） |
| `strokeAdjustment` | boolean | | 自動描邊調整（/SA） |

### 想列印表格 — `table`

擁有標題列、明細列、頁尾列的表格。以 `dataSourceExpression` 傳入列資料的陣列後，明細列會依陣列元素數量重複。

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

資料範例（`items` 的每個元素即為表格明細的一列）:

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

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | 元素種別 |
| `columns` | TableColumnElementDef[] | ✓ | 欄定義的陣列。全部欄的 `width` 合計與元素寬度不同時，全部欄會等比縮放至恰好收入元素寬度 |
| `headerRows` | TableRowElementDef[] |  | 標題列的陣列。分頁分割時，在各頁開頭重複繪製 |
| `detailRows` | TableRowElementDef[] |  | 明細列的陣列。每一筆資料列重複繪製（資料列 × detailRows 的全部列） |
| `footerRows` | TableRowElementDef[] |  | 頁尾列的陣列。分頁分割時只在最後一頁繪製 |
| `dataSourceExpression` | Expression |  | 將求值結果的陣列作為此表格的資料列使用。省略時使用主資料來源的列。求值結果不是陣列時擲出例外 |

**`TableColumnElementDef`**（`columns` 的各元素＝欄定義）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 欄寬（pt）。全部欄合計與元素寬度不一致時等比分配 |
| `style` | TableCellStyleDef |  | 此欄的預設儲存格樣式。儲存格端指定了同名屬性時以儲存格端優先（框線以邊為單位合併） |

**`TableRowElementDef`**（`headerRows`/`detailRows`/`footerRows` 的各元素＝列定義）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 列高（pt）。視為最小值，文字換行或儲存格內子元素放不下時自動擴張（rowSpan 儲存格內容超出的部分，由合併範圍的最後一列擴張） |
| `cells` | TableCellElementDef[] | ✓ | 此列儲存格定義的陣列。被上方列的 `rowSpan` 佔用的欄會自動跳過配置 |

**`TableCellElementDef`**（`cells` 的各元素＝儲存格定義。除下列外還可直接指定 `TableCellStyleDef` 的全部屬性）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `text` | string |  | 儲存格的固定文字 |
| `expression` | Expression |  | 資料繫結用的運算式。`field.名稱` 的單獨形式直接從資料列取值，其餘由引擎的運算式求值解析。指定時優先於 `text` |
| `colSpan` | number |  | 橫向合併的欄數。預設: 1 |
| `rowSpan` | number |  | 縱向合併的列數。預設: 1。儲存格高為合併範圍列高的合計 |
| `elements` | ElementDef[] |  | 配置於儲存格內的子元素陣列。指定時優先於 `text`/`expression` 的繪製，並在扣除留白的區域內裁切繪製。列高會依子元素所需高度自動擴張 |

**`TableCellStyleDef`**（儲存格定義及欄的 `style` 使用的儲存格樣式）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `hAlign` | `'left'`＝靠左 / `'center'`＝置中 / `'right'`＝靠右 |  | 水平方向的文字對齊 |
| `vAlign` | `'top'`＝靠上 / `'middle'`＝置中 / `'bottom'`＝靠下 |  | 垂直方向的文字對齊 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 文字旋轉（度）。預設: 0 |
| `backcolor` | string |  | 儲存格背景色 |
| `forecolor` | string |  | 文字色。預設: `#000000` |
| `fontId` | string |  | 字型 ID。預設: `'default'` |
| `fontSize` | number |  | 字型大小（pt）。預設: 10 |
| `bold` | boolean |  | 粗體 |
| `italic` | boolean |  | 斜體 |
| `underline` | boolean |  | 底線 |
| `strikethrough` | boolean |  | 刪除線 |
| `lineSpacing` | LineSpacingDef |  | 行距設定（參照共通屬性一節的 **`LineSpacingDef`**） |
| `letterSpacing` | number |  | 字距（pt）。在所有文字之間追加固定量（負值則縮緊） |
| `wordSpacing` | number |  | 詞距（pt。加在空白字元上的寬度） |
| `firstLineIndent` | number |  | 第一行縮排（pt） |
| `leftIndent` | number |  | 左縮排（pt） |
| `rightIndent` | number |  | 右縮排（pt） |
| `wrap` | boolean |  | 文字換行。預設: true |
| `shrinkToFit` | boolean |  | 自動縮小字型大小以收入儲存格 |
| `minFontSize` | number |  | `shrinkToFit` 時的最小字型大小（pt）。預設: 4 |
| `fitWidth` | boolean |  | 自動調整字型大小使最長行恰好收入儲存格寬度（縮小、放大雙向）。此儲存格不參與列高的自動擴張 |
| `outlineText` | boolean |  | 將文字外框（路徑）化繪製 |
| `padding` | number |  | 儲存格內留白（pt）。預設: 2 |
| `border` | BorderDef |  | 儲存格單位的框線（參照共通屬性一節的 **`BorderDef`**）。與欄 `style` 的框線合併，儲存格端的指定優先 |
| `opacity` | number |  | 不透明度（0.0〜1.0）。小於 1 時整個儲存格作為不透明度群組繪製 |

### 想列印交叉統計表 — `crosstab`

以列群組×欄群組彙總資料。此例以「地區×分類」合計 `amount`，並輸出小計與總計。

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

資料範例:

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

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | 元素種別 |
| `rowGroups` | { field, headerFormat? }[] | ✓ | 列群組定義的陣列。指定多個即成為多階層群組，各階層由左至右各佔一欄列標題欄。外層群組的標題儲存格會跨對象範圍縱向合併 |
| `columnGroups` | { field, headerFormat? }[] | ✓ | 欄群組定義的陣列。外層群組在上、內層群組在下堆疊，外層標題會跨對象欄寬橫向合併 |
| `measures` | { field, calculation, format? }[] | ✓ | 量值（彙總儲存格）定義的陣列。指定多個時在資料儲存格內縱向堆疊顯示，各量值佔一個插槽（最低 `cellHeight`），並個別套用 `calculation`/`format`。空陣列時視為 `field: ''`、`calculation: 'sum'` 的隱含 1 筆 |
| `rowHeaderWidth` | number |  | 列標題寬（pt）。套用於列群組的各階層。預設: 80 |
| `columnHeaderHeight` | number |  | 欄標題高（pt）。套用於欄群組的各階層。預設: 20 |
| `cellWidth` | number |  | 資料儲存格寬（pt）。預設: 60 |
| `cellHeight` | number |  | 資料儲存格高（pt，一個量值的插槽高）。依文字換行自動擴張。預設: 20 |
| `border` | { color?, width? } |  | 框線設定（參照下表）。僅在指定時繪製外框、列/欄的分隔線、標題階層的分隔線（不會穿過合併後的外層標題儲存格） |
| `showSubtotals` | boolean |  | 顯示小計。預設: false。為 true 時，在最內層以外的各群組區塊末尾插入「Total」標籤的小計列/欄。小計值由原始值以各量值的 `calculation` 重新彙總 |
| `showGrandTotal` | boolean |  | 顯示總計。預設: false。為 true 時，在末尾追加「Total」標籤的總計列/欄（資料 0 筆時不輸出）。總計值也由原始值重新彙總 |
| `dataSourceExpression` | Expression |  | 將求值結果的陣列作為此交叉統計的資料列使用。省略時（或求值結果不是陣列時）使用主資料來源的列 |

**列/欄群組定義（`rowGroups`/`columnGroups` 的各元素）**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 用於分組的欄位名稱。群組依資料中出現的順序排列 |
| `headerFormat` | string |  | 標題值的顯示格式。僅在值為數值時套用的簡易格式（`'#,##0'` 或含 `,`→千分位顯示、如 `'.00'` 的小數指定→以該位數固定小數顯示、其他→直接字串化） |

**量值定義（`measures` 的各元素）**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 彙總對象的欄位名稱。非數值的值會轉換為數值，無法轉換時視為 0 |
| `calculation` | `'sum'`＝合計 / `'count'`＝筆數 / `'average'`＝平均 / `'min'`＝最小值 / `'max'`＝最大值 | ✓ | 彙總方法。小計、總計也由原始值的集合以相同計算方法重新彙總，因此 `average` 等也會是正確的值 |
| `format` | string |  | 彙總值的顯示格式（與 `headerFormat` 相同的簡易格式: `'#,##0'` 或含 `,`→千分位、`'.NN'`→固定小數 NN 位、未指定→直接字串化） |

**框線設定（`border`）**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `color` | string |  | 線色。預設: `#000000` |
| `width` | number |  | 外框、標題/資料邊界的線寬（pt）。預設: 0.5。內部的列/欄分隔線以此值的一半線寬繪製 |

### 想在報表中嵌入另一份報表 — `subreport`

其概念已在**報表版面配置的基礎**中說明。這裡展示可直接執行的完整定義。父報表的每一列明細會執行一次子報表，以 `dataSourceExpression` 傳入的陣列會成為子報表端的 `rows`。

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

資料範例:

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

被嵌入端的 `subreport.report` 是獨立的一份範本。它把傳入的 `items` 的各元素當作一般的 `field.*` 參照，並以 `param.*` 接收父報表傳來的參數。另外，作為子報表執行的範本不會輸出 `pageHeader`、`pageFooter`、`background` 帶區（因為頁面管理由父報表負責）。標題如下放在 `title` 帶區。

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

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | 元素種別 |
| `templateExpression` | Expression | ✓ | 回傳子範本名稱的運算式。使用 `createReportFromFile()` 時會自動解析為檔案路徑，直接使用 `createReport()` 時以選項 `resolveSubreportTemplate`（接收名稱與工作目錄，回傳 `{ template, workingDirectory? }` 的函式。無法解析時回傳 `null`）解析 |
| `dataSourceExpression` | Expression | | 回傳子報表資料來源（列物件的陣列）的運算式。省略時直接使用父報表的資料來源列。結果不是陣列時視為空資料 |
| `parameters` | SubreportParamDef[] |  | 傳給子報表的參數（參照下表 **`SubreportParamDef`**）。優先於 `parametersMapExpression` 的同名項目 |
| `parametersMapExpression` | Expression | | 回傳要合併進子參數的物件的運算式（個別的 `parameters` 優先） |
| `returnValues` | ReturnValueDef[] |  | 將子報表的變數值回傳給父報表的定義（參照下表 **`ReturnValueDef`**） |
| `usingCache` | boolean | | 在父報表的單次執行內，依範本名稱快取並重複使用已解析的子範本 |
| `runToBottom` | boolean | | 在子報表內容之後，耗用頁面／欄的剩餘空間（把後續元素推到剩餘空間之下） |

**`SubreportParamDef`**（`parameters` 的各元素＝傳給子報表的參數）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 傳給子報表的參數名稱（子報表端以 `param.名稱` 參照） |
| `expression` | Expression | ✓ | 計算參數值的運算式。以父報表的內容脈絡求值 |

**`ReturnValueDef`**（`returnValues` 的各元素＝從子報表向父報表回傳值的定義）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 父報表端接收值的變數名稱。此變數會從父報表一般變數計算的覆寫中排除 |
| `subreportVariable` | string | ✓ | 子報表端的來源變數名稱。子報表執行完成時，其值反映到父報表 |
| `calculation` | `'nothing'`＝直接代入子報表的值（每次執行覆寫） / `'count'`＝筆數 / `'sum'`＝合計 / `'average'`＝平均 / `'min'`＝最小值 / `'max'`＝最大值 / `'first'`＝保留最先得到的值 | ✓ | 反映到父變數的方法。`'nothing'` 以外，在子報表被執行多次時做跨次彙總 |

### 想列印條碼、QR Code — `barcode`

`barcodeType` 可指定 Code 39/93/128、EAN、UPC、ITF、Codabar、MSI、QR Code（`qrcode`）、Data Matrix、PDF417 等。以 `showText` 併記可讀文字。

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

資料範例:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | 元素種別 |
| `barcodeType` | string | ✓ | 條碼規格（不區分大小寫）。可設定值: `'code39'`＝Code 39／`'code128'`＝Code 128／`'ean13'`・`'ean-13'`＝EAN-13／`'ean8'`・`'ean-8'`＝EAN-8／`'qrcode'`・`'qr'`＝QR Code／`'datamatrix'`・`'data-matrix'`＝Data Matrix／`'pdf417'`＝PDF417／`'upca'`・`'upc-a'`＝UPC-A／`'upce'`・`'upc-e'`＝UPC-E／`'itf'`・`'interleaved2of5'`＝ITF（Interleaved 2 of 5）／`'codabar'`＝Codabar（NW-7）／`'code93'`＝Code 93／`'msi'`＝MSI。以外的值視為未支援，繪製預留位置 |
| `expression` | Expression | ✓ | 回傳條碼資料的運算式（將求值結果字串化後編碼） |
| `showText` | boolean | | 在一維條碼下方顯示人類可讀文字（文字區域高 10pt、字型大小 8pt。條的高度相應減少）。二維碼（QR／Data Matrix／PDF417）不使用 |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | QR Code 的錯誤更正等級＝即使碼的一部分髒污、缺損仍可讀取的復原能力。依 `'L'`→`'H'` 順序耐受度提高，但圖樣變得更細。印刷粗糙的媒材建議 `'Q'` 或 `'H'`。預設: `'M'`。僅 QR Code 有效（PDF417 的錯誤更正等級由資料長度自動選定） |

### 想列印數學算式 — `math`

排版 LaTeX 風格的數學算式。算式排版需要內建算式用尺寸資訊（OpenType MATH 表）的專用字型（可免費取得的例子: STIX Two Math、Latin Modern Math。一般內文字型無法替代）。`formula` 會作為運算式求值（此例參照資料的 `formula` 項目）。

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

資料範例:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

使用 `math` 元素時，將擁有 OpenType MATH 表的字型同時註冊到 `fontMap` 與 PDF 輸出用的 `fonts`。

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | 元素種別 |
| `formula` | Expression | ✓ | 回傳 LaTeX 算式字串的運算式（固定算式以運算式中的字串常值 `'...'` 包住）。求值結果為空字串時不繪製任何內容 |
| `mathFontFamily` | string | | 算式繪製使用的字型（fontMap 中註冊的字型 ID）。預設: 元素樣式的 fontFamily，再沒有則為 `'default'` |
| `fontSize` | number | | 字型大小（pt）。預設: 元素樣式的 fontSize，再沒有則為 12 |
| `color` | string | | 文字色。預設: 依元素的 forecolor → 樣式的 forecolor → `#000000` 順序解析 |

### 想列印 SVG — `svg`

將 SVG 文件原樣繪製到報表上。`svgContent` 會作為運算式求值（可用資料或參數傳入固定的 SVG 字串）。

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

資料範例:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | 元素種別 |
| `svgContent` | Expression | ✓ | 回傳 SVG 標記字串的運算式。將求值結果字串化，以元素的位置、尺寸作為 SVG 繪製 |

### 想製作可輸入的 PDF 表單 — `formField`

配置讓開啟 PDF 的人可以輸入的表單欄位。`fieldType` 可指定 `text`、`checkbox`、`radio`、`pushbutton`、`dropdown`、`listbox`、`signature`。

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

資料範例（會成為表單的初始值）:

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | 元素種別。互動式表單欄位。預覽系後端繪製初始外觀，PDF 輸出時輸出為實際可輸入的欄位 |
| `fieldType` | `'text'`＝文字輸入欄位（PDF /Tx） / `'checkbox'`＝核取方塊（/Btn） / `'radio'`＝選項按鈕（/Btn。`fieldName` 相同的 widget 彼此構成一個互斥群組） / `'pushbutton'`＝按鈕（/Btn。標題＋任意 URI 動作） / `'dropdown'`＝下拉選單（下拉式方塊，/Ch） / `'listbox'`＝清單方塊（/Ch） / `'signature'`＝簽章欄位（/Sig） | ✓ | 欄位種別 |
| `fieldName` | string | ✓ | 完整限定欄位名稱。在文件內必須唯一（重複時擲出例外）。例外是 `radio`，透過共用同名形成一個互斥群組 |
| `value` | Expression |  | 初始值（text: 輸入值，dropdown/listbox: 選取值。`multiSelect` 的 listbox 以換行分隔指定多個值）。會做運算式求值。與 `valueStream` 併用時擲出例外 |
| `checked` | Expression |  | 初始勾選狀態（checkbox/radio）。會做運算式求值。radio 中被勾選按鈕的 `exportValue` 會成為群組的選取值 |
| `exportValue` | string |  | 送出、擷取表單輸入內容時，用來表示此核取方塊／選項按鈕為「ON」而記錄的字串（checkbox/radio）。預設: `'Yes'`。在選項按鈕群組中以此值區別各選項 |
| `options` | FormFieldOption[] |  | 選項的陣列（dropdown/listbox）。參照下表 |
| `editable` | boolean |  | 除選項外也允許自由輸入（讓 dropdown 可作組合輸入） |
| `multiSelect` | boolean |  | 允許複選（listbox） |
| `caption` | string |  | 按鈕的標題（pushbutton） |
| `action` | string |  | 按下 pushbutton 時開啟的 URI |
| `multiline` | boolean |  | 多行輸入（text） |
| `readOnly` | boolean |  | 設為唯讀 |
| `required` | boolean |  | 設為必填 |
| `noExport` | boolean |  | 表單送出時不匯出此欄位的值 |
| `password` | boolean |  | 密碼輸入（text，輸入文字以遮蔽顯示） |
| `fileSelect` | boolean |  | 設為檔案選擇欄位（text）。與 `multiline`/`password` 併用時擲出例外 |
| `doNotSpellCheck` | boolean |  | 停用拼字檢查（text/dropdown/listbox） |
| `doNotScroll` | boolean |  | 禁止超出顯示範圍的輸入捲動（text） |
| `comb` | boolean |  | 以等寬字元格（comb）顯示（text）。必須指定 `maxLength`，與 `multiline`/`password`/`fileSelect` 併用時擲出例外 |
| `richText` | string |  | 在支援的檢視器中以帶格式（粗體、顏色等）顯示的富文字值（PDF 的 /RV）。指定後會設定欄位的富文字旗標。與 `richTextStream` 併用時擲出例外 |
| `richTextStream` | Uint8Array |  | `richText` 的串流版。供 PDF 匯入在來源 PDF 的 /RV 為串流時做位元組保全，手寫範本通常使用 `richText`。與 `richText` 併用時擲出例外 |
| `defaultStyle` | string |  | 富文字的預設樣式（PDF 的 /DS）。CSS 風格的格式指定字串（例: `font: Helvetica 12pt`），成為 `richText` 端未指定部分的預設 |
| `valueStream` | Uint8Array |  | 供 PDF 匯入保全用。來源 PDF 的欄位值（/V）不是字串而是串流物件時，無損重新輸出該位元組序列。手寫範本通常使用 `value`。與 `value` 併用時擲出例外 |
| `defaultValue` | string |  | 表單重設時還原的預設值（/DV） |
| `sort` | boolean |  | 將選項排序顯示（dropdown/listbox） |
| `commitOnSelectionChange` | boolean |  | 選取變更時立即確定值（dropdown/listbox） |
| `radiosInUnison` | boolean |  | 讓群組內擁有相同 `exportValue` 的選項按鈕連動 ON/OFF |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | 為欄位附加在支援的 PDF 檢視器上執行的輸入指令碼。K＝每次輸入（例: 移除非數字）、F＝顯示整形（例: 以小數 2 位顯示）、V＝值驗證（例: 拒絕負數）、C＝重新計算（例: 由其他欄位的值自動計算）。內容通常是 `subtype: 'JavaScript'` 的 `PdfActionDef`（後述）。核心引擎只把指令碼嵌入 PDF，不會執行。radio 群組中全部 widget 必須為相同定義，否則擲出例外 |
| `calculationOrder` | number |  | 有多個擁有 `'C'`（重新計算）動作的欄位時，檢視器以什麼順序重新計算（PDF 的 /CO）。0 以上整數的升冪。重複、負值、非整數擲出例外 |
| `maxLength` | number |  | 最大輸入字元數（text） |
| `borderColor` | string |  | 框線色（`#RRGGBB`）。省略時無框線。radio 為圓形，其餘以矩形的框、線寬 1pt 繪製 |
| `backgroundColor` | string |  | 背景色（`#RRGGBB`）。省略時透明。radio 為圓形，其餘以矩形填色 |

**`FormFieldOption`**（`options` 的各元素＝選項定義）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `value` | string | ✓ | 存入欄位值（/V）的匯出值 |
| `label` | string |  | 顯示標籤。預設: 與 `value` 相同 |

※ 此外可指定全元素共通屬性與 `TextProperties` 的全部屬性（套用於輸入文字的字型、配置等）。

### 想在任意位置分頁、換欄 — `break`

在明細流動的中途，強制切換頁面（`"breakType": "page"`）或欄（`"column"`）。放在帶區的直屬層級，不能放在 `frame` 之中。

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**屬性清單**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | 元素種別 |
| `breakType` | `'page'` \| `'column'` | ✓ | 分頁種別。在元素的 y 位置分割帶區，`'page'`＝送往下一頁／`'column'`＝多欄構成（範本的 `columns.count` 為 2 以上。參照「報表版面配置的基礎」）且非最後一欄時送往下一欄（其餘情況作為分頁動作） |

### 想在符合條件時才列印元素 — `printWhenExpression`

`printWhenExpression` 不是特定的元素種類，而是**全元素共通的屬性**。只在運算式求值為 truthy 的列，列印該元素。以下範例只在 `urgent` 為 `true` 的明細列列印「※ 至急」。

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

資料範例（只會列印在第 1 列）:

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

帶區也可以指定同名的 `printWhenExpression`，抑制整個帶區的輸出（例: 只在 `param.showNotes` 時輸出備註帶區）。以 TypeScript 定義範本時，可用元素的 `onBeforeRender` 回呼做更細緻的控制——回傳 `null` 即跳過該元素的列印，回傳 `ElementDef` 則以當場覆寫後的字串、尺寸、顏色等屬性列印。

## 元素屬性參考

各元素範例所附的「屬性清單」是該元素獨有的屬性。此外，任何元素都可以指定位置、尺寸、列印條件、顏色等共通屬性。這裡彙整全元素共通的屬性，以及在範本 `styles` 中定義的樣式的屬性。

### 全元素共通的屬性

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `id` | string |  | 供 `findElementById()` 在繪製前取得、修改元素的識別碼。不影響列印內容本身。作為修改對象使用的 ID 請在範本內保持唯一（重複時回傳搜尋順序中的第一個元素） |
| `x` | number | ✓ | 父帶區／容器內的 X 座標（pt） |
| `y` | number | ✓ | 父帶區／容器內的 Y 座標（pt） |
| `width` | number | ✓ | 寬度（pt） |
| `height` | number | ✓ | 高度（pt） |
| `style` | string |  | 要套用的樣式名稱（參照 `styles` 中定義的 `StyleDef` 的 `name`。未指定時套用 `isDefault` 的樣式） |
| `positionType` | `'float'`＝依位於自身上方元素的伸展量向下移動 / `'fixRelativeToTop'`＝固定相對帶區上緣的位置（預設） / `'fixRelativeToBottom'`＝維持與帶區下緣的距離（依帶區伸展量向下移動） |  | 帶區伸展時的定位規則。預設: `fixRelativeToTop` |
| `stretchType` | `'noStretch'`＝不伸展（預設） / `'containerHeight'`＝讓元素高度與帶區的實效高度一致 / `'containerBottom'`＝將元素下緣伸展到帶區的實效下緣（只改變高度） |  | 帶區伸展時元素的伸展規則。預設: `noStretch` |
| `printWhenExpression` | Expression \| null |  | 求值結果為假時，不列印此元素 |
| `onBeforeRender` | OnBeforeRenderCallback |  | 繪製前一刻呼叫的回呼 `(elem, field, vars, param, report) => ElementDef \| null`。回傳 `null` 則跳過列印（`printWhenExpression` 的上位相容），回傳 `ElementDef` 則以該定義繪製（任意屬性的動態覆寫）。求值順序: `onBeforeRender` → `printWhenExpression`（對覆寫後的定義求值） → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | 元素未被列印時，若該元素佔用的垂直帶上沒有其他列印元素重疊，則移除該帶，把下方元素向上遞補以縮小帶區 |
| `isPrintRepeatedValues` | boolean |  | 指定 `false` 時，與前一筆相同值（textField）的情況抑制列印（抑制時，若 `isRemoveLineWhenBlank` 為真則視為高度 0） |
| `isPrintWhenDetailOverflows` | boolean |  | 在帶區溢出後的各頁／各欄區段中，重新列印此元素 |
| `mode` | `'opaque'`＝以 `backcolor` 填背景 / `'transparent'`＝不填背景 |  | 顯示模式。預設: `transparent`（依元素→樣式的順序解析） |
| `forecolor` | string |  | 前景色（`#RRGGBB` 或 `#RRGGBBAA`） |
| `backcolor` | string |  | 背景色（`mode` 為 `opaque` 時繪製） |
| `border` | BorderDef |  | 框線（參照後述的 **`BorderDef`**）。line/rectangle/ellipse/path 元素不繪製框線（無論來自樣式或元素直接指定。這些元素以自身的 `stroke` 等指定線） |
| `padding` | Padding |  | 留白（參照後述的 **`Padding`**） |
| `blendMode` | BlendModeDef |  | 此元素的顏色與已繪內容如何合成（參照後述的 **`BlendModeDef`**）。典型例: 對印章、戳章影像指定 `'multiply'`，即可不遮住下方文字、以透出的狀態疊印 |
| `overprintFill` | boolean |  | 面向商業印刷製版。指定填色（文字、圖形的面）不消去下方色版而疊印（overprint） |
| `overprintStroke` | boolean |  | 面向商業印刷製版。線（描邊）的疊印指定 |
| `overprintMode` | 0 \| 1 |  | 啟用 `overprintFill`/`overprintStroke` 時行為的選擇（PDF /OPM）。`0`＝所有色彩成分覆寫下方顏色（預設） / `1`＝值為 0 的色彩成分保留下方顏色 |
| `renderingIntent` | `'AbsoluteColorimetric'`＝測色上忠實 / `'RelativeColorimetric'`＝對齊白點後忠實 / `'Saturation'`＝鮮豔度優先 / `'Perceptual'`＝外觀自然度優先 |  | 超出輸出裝置色域的顏色如何轉換的優先方針（PDF 渲染意圖）。面向商業印刷、色彩管理，通常不需指定 |
| `alphaIsShape` | boolean |  | PDF 透明合成的細部控制（將不透明度、遮罩解釋為「形狀」的 /AIS）。通常不需指定，主要用於 PDF 匯入的忠實重新輸出 |
| `textKnockout` | boolean |  | 半透明文字彼此重疊時，同一文字內不做重疊的雙重合成（PDF /TK）。預設: `true`。通常不需指定 |
| `optionalContent` | OptionalContentDef |  | 把此元素放到 PDF 的「圖層」上。可從檢視器的圖層面板切換顯示/隱藏、是否列印（例: 浮水印在螢幕顯示、列印時消除）。參照後述的 **`OptionalContentDef`** |
| `opacity` | number |  | 元素的不透明度（0.0〜1.0）。擁有子元素時，作為群組合成後套用 |

**`BlendModeDef`**（`blendMode` 可指定的混合模式）

元素通常直接覆蓋下方的繪製結果（`'normal'`）。指定混合模式後，上下的顏色會以計算合成。在報表中，典型用法是把印章、公司章疊在文字上（`'multiply'`）、在深色背景上做出反白風效果（`'screen'`）。

| 常數 | 效果 |
| --- | --- |
| `'normal'` | 不合成，以上方顏色繪製（相當於預設） |
| `'multiply'` | 相乘。重疊處必定變暗。適合印章、戳章、螢光筆風的疊塗 |
| `'screen'` | 反轉相乘。重疊處必定變亮 |
| `'overlay'` | 底色暗則相乘、亮則反轉相乘。對比被強調 |
| `'darken'` | 採用上下較暗的顏色 |
| `'lighten'` | 採用上下較亮的顏色 |
| `'color-dodge'` | 依上方顏色將底色打亮 |
| `'color-burn'` | 依上方顏色將底色燒暗 |
| `'hard-light'` | 依上方顏色的明暗切換相乘／反轉相乘（強烈的照明效果） |
| `'soft-light'` | `'hard-light'` 的弱化版（柔和的照明效果） |
| `'difference'` | 上下顏色差的絕對值 |
| `'exclusion'` | `'difference'` 的低對比版 |
| `'hue'` | 上方的色相＋下方的飽和度、亮度 |
| `'saturation'` | 上方的飽和度＋下方的色相、亮度 |
| `'color'` | 上方的色相、飽和度＋下方的亮度（適合為單色底稿上色） |
| `'luminosity'` | 上方的亮度＋下方的色相、飽和度 |

**`Expression`**（詳細參照「靈活運用運算式（Expression）」）
| 形式 | 說明 |
| --- | --- |
| string | 運算式迷你語言。例: `'field.customer.name'`、`'field.price * field.quantity'`、`` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``、`'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | TypeScript 函式 `(field, vars, param, report) => unknown`。`report`（ReportContext）擁有 `PAGE_NUMBER`（目前頁碼、從 1 開始）、`COLUMN_NUMBER`（目前欄號、從 1 開始）、`REPORT_COUNT`（已處理筆數）、`TOTAL_PAGES`（總頁數。於 evaluationTime=report 定案）、`RETURN_VALUE`（型別定義上存在，但現行實作恆為 undefined——子報表的回傳值以 `vars.*` 接收）、`format`（內建格式函式）、`formatters`（範本註冊的自訂格式器） |

**`BorderDef`**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `width` | number |  | 線寬（pt）。全部邊共通的預設值 |
| `color` | string |  | 線色。全部邊共通的預設值 |
| `style` | `'solid'`＝實線 / `'dashed'`＝虛線 / `'dotted'`＝點線 |  | 線種。全部邊共通的預設值 |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | 各邊的個別指定（參照後述的 **`BorderSideDef`**）。優先於全部邊共通的指定，`null` 表示隱藏該邊 |

**`BorderSideDef`**（用於 `BorderDef` 的 `top`/`bottom`/`left`/`right`）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 線寬（pt） |
| `color` | string | ✓ | 線色 |
| `style` | `'solid'`＝實線 / `'dashed'`＝虛線 / `'dotted'`＝點線 | ✓ | 線種 |

**`Padding`**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | 各邊的留白（pt） |

**`HyperlinkDef`**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'reference'`＝外部 URL / `'localAnchor'`＝到同一文件內的錨點 / `'localPage'`＝到同一文件內的頁碼 / `'remoteAnchor'`＝到另一份 PDF 文件的錨點 / `'remotePage'`＝到另一份 PDF 文件的頁面 | ✓ | 連結種別 |
| `target` | Expression | ✓ | 連結目的地（URL、錨點名稱或頁碼的運算式） |
| `remoteDocument` | Expression |  | 遠端 PDF 檔案路徑（remotePage / remoteAnchor 用） |

**`TextProperties`**（staticText / textField / formField 擁有的文字、段落屬性）
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `markup` | `'none'`＝純文字 / `'styled'`＝帶樣式標記（`<style forecolor=... isBold=...>`、`<b>`/`<i>`/`<u>` 等） / `'html'`＝HTML 子集（`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`） |  | 標記種別 |
| `hAlign` | `'left'`＝靠左 / `'center'`＝置中 / `'right'`＝靠右 / `'justify'`＝左右對齊 |  | 水平方向的配置 |
| `vAlign` | `'top'`＝靠上 / `'middle'`＝置中 / `'bottom'`＝靠下 |  | 垂直方向的配置 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 文字旋轉（度） |
| `lineSpacing` | LineSpacingDef |  | 行距設定（參照後述的 **`LineSpacingDef`**） |
| `letterSpacing` | number |  | 字距（pt）。在所有文字之間追加固定量（負值則縮緊） |
| `tracking` | number |  | 字距調整的一種。相對於 `letterSpacing` 一律加上固定量，這個屬性使用字型自身內建的字距調整表（AAT `trak` 表），以配合字型大小的設計值增減字距。數值為調整表的「track 值」，0＝標準、負＝縮緊、正＝加寬（中間值以內插求得）。沒有 `trak` 表的字型無效果 |
| `wordSpacing` | number |  | 詞距（pt。加在空白字元上的寬度） |
| `horizontalScale` | number |  | 將文字字形沿水平方向伸縮的倍率（小於 1＝縮窄的長體、大於 1＝加寬的平體）。以伸縮後的寬度計算換行、行距。預設: 1 |
| `baselineOffset` | number |  | 以距元素上緣的 pt 明示基線（文字所乘基準線）的位置。通常自動計算故不需指定（主要供 PDF 匯入重現原文字位置而設定） |
| `firstLineIndent` | number |  | 第一行縮排（pt） |
| `leftIndent` | number |  | 左縮排（pt） |
| `rightIndent` | number |  | 右縮排（pt） |
| `padding` | Padding |  | 留白 |
| `direction` | `'ltr'`＝左→右 / `'rtl'`＝右→左 / `'auto'`＝由內容自動判定（雙向文字分析） |  | 文字的方向 |
| `openTypeScript` | string |  | 將字串轉換為字形（成形）時，指定使用字型中哪個文字系統的規則的 OpenType 標籤（例: `'latn'`＝拉丁文字、`'arab'`＝阿拉伯文字）。通常不需指定（依文字內容自動處理） |
| `openTypeLanguage` | string |  | 對同一文字系統中依語言改變字形的字型，明示語言的 OpenType 標籤。通常不需指定 |
| `openTypeFeatures` | Record<string, number> |  | 字型內建字形切換功能（feature）的 ON/OFF。例: `{ "palt": 1 }`＝縮緊日文字距、`{ "liga": 0 }`＝停用合字、`{ "zero": 1 }`＝帶斜線的零。值 0＝停用／1＝啟用，字形選擇型 feature 為從 1 開始的替代字形編號 |
| `shrinkToFit` | boolean |  | 自動縮小: 縮小字型大小以收入元素的寬、高 |
| `minFontSize` | number |  | `shrinkToFit` 時的最小字型大小（pt）。預設: 4 |
| `fitWidth` | boolean |  | 自動調整字型大小使最長行恰好收入元素的內容寬度（縮小、放大雙向） |
| `outlineText` | boolean |  | 將文字外框化（轉為路徑）。預設: `false` |
| `pdfFontMode` | `'embedded'`＝嵌入字型程式 / `'reference'`＝不嵌入、輸出系統字型參照 |  | PDF 字型程式的處理 |
| `textPaintMode` | `'fill'`＝填色 / `'stroke'`＝僅描邊 / `'fillStroke'`＝填色＋描邊 |  | PDF 匯入保留的文字繪製語意。預設: `fill` |
| `textStrokeColor` | string |  | stroke / fillStroke 時的描邊色 |
| `textStrokeWidth` | number |  | 文字的外框線寬（pt） |
| `tabStops` | TabStopDef[] |  | 定位點定義（參照後述的 **`TabStopDef`**） |
| `tabStopWidth` | number |  | 預設的定位點間隔（pt）。未指定時為 40pt |
| `wrap` | boolean |  | 文字換行。預設: `true`（undefined 表示換行啟用） |

**`LineSpacingDef`**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'single'`＝1 行 / `'1.5'`＝1.5 行 / `'double'`＝2 行 / `'proportional'`＝指定倍率 / `'fixed'`＝固定值 / `'minimum'`＝最小值 | ✓ | 行距的種別 |
| `value` | number |  | fixed / minimum / proportional 時的值 |

**`TabStopDef`**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `position` | number | ✓ | 定位點位置（pt） |
| `alignment` | `'left'` / `'center'` / `'right'` |  | 定位點對齊。預設: `left` |

**`FillDef`**（可指定給 `path` 的填色（`fill`）、描邊（`stroke`）以及 `rectangle`/`ellipse` 的填色（`fill`）的型別聯集。`rectangle`/`ellipse` 的 `stroke` 僅限單色字串）
| 形式 | 說明 |
| --- | --- |
| string | 單色（`#RRGGBB` 或 `#RRGGBBAA`） |
| PdfSpecialColorDef | 特別色（Separation／DeviceN）。金、銀、企業識別色等特定油墨的色彩指定（參照後述的表） |
| LinearGradientDef | 線性漸層——沿連接兩點的軸改變顏色（參照後述的表） |
| RadialGradientDef | 圓形漸層——由中心向外側改變顏色（參照後述的表） |
| MeshGradientDef | 網格漸層——沿自由形狀改變顏色（參照後述的表） |
| TilingPatternDef | 拼貼圖樣——以小圖樣鋪滿填色（參照後述的表） |
| FunctionShadingDef | 函式漸變——由座標以計算式決定顏色（參照後述的表） |

**`GradientStopDef`**（漸層的色彩切換點。各漸層的 `stops` 使用）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `offset` | number | ✓ | 沿漸層軸的位置。0〜1 的比率（0＝起點、1＝終點） |
| `color` | string | ✓ | 此位置的顏色（`#RRGGBB`） |
| `opacity` | number |  | 此位置的不透明度（0〜1）。預設: 1 |

**`LinearGradientDef`**（線性漸層——沿連接兩點的軸改變顏色的填色）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | 表示為線性漸層的判別子 |
| `x1` | number |  | 起點的 X 座標。**相對元素邊界框寬度的比率**（0＝左端、1＝右端）。預設: 0 |
| `y1` | number |  | 起點的 Y 座標。**相對元素邊界框高度的比率**（0＝上端、1＝下端）。預設: 0 |
| `x2` | number |  | 終點的 X 座標（相對寬度的比率）。預設: 1（維持預設值即為左→右的水平漸層） |
| `y2` | number |  | 終點的 Y 座標（相對高度的比率）。預設: 0 |
| `stops` | GradientStopDef[] | ✓ | 色彩切換點的陣列（參照上表） |
| `spreadMethod` | `'pad'`＝以端點顏色填滿 / `'reflect'`＝反轉並重複 / `'repeat'`＝原樣重複 |  | 漸層範圍外側的填法。預設: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | 供無損重新輸出 PDF 匯入漸層的保全中繼資料。手寫範本不需指定 |

**`RadialGradientDef`**（圓形漸層——由中心向外側改變顏色的填色）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | 表示為圓形漸層的判別子 |
| `cx` | number |  | 外圓的中心 X 座標（相對元素邊界框寬度的比率）。預設: 0.5 |
| `cy` | number |  | 外圓的中心 Y 座標（相對高度的比率）。預設: 0.5 |
| `r` | number |  | 外圓的半徑。**相對寬、高中較大者的比率**。預設: 0.5 |
| `fx` | number |  | 焦點（漸層開始的點）的 X 座標（相對寬度的比率）。預設: `cx` |
| `fy` | number |  | 焦點的 Y 座標（相對高度的比率）。預設: `cy` |
| `fr` | number |  | 焦點圓的半徑（相對寬、高中較大者的比率）。預設: 0 |
| `stops` | GradientStopDef[] | ✓ | 色彩切換點的陣列 |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | 範圍外的填法（與 `LinearGradientDef` 相同）。預設: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | PDF 匯入的無損重新輸出用中繼資料。手寫範本不需指定 |

**`MeshGradientDef`**（網格漸層——為格子或三角形的各頂點賦予顏色，沿自由形狀改變顏色的填色）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | 表示為網格漸層的判別子 |
| `patches` | MeshPatchDef[] |  | 曲面 patch 的陣列。各 patch 擁有 `points`（以 x,y 順序的 32 個數值表示 4×4 控制點網。**座標為元素區域的 pt**）與 `colors`（4 個角的顏色） |
| `triangles` | MeshTriangleDef[] |  | 漸層三角形的陣列。各三角形擁有 `points`（x0,y0,x1,y1,x2,y2。元素區域 pt）與 `colors`（3 個頂點的顏色），頂點之間顏色以內插求得 |
| `lattice` | MeshLatticeDef |  | 格子形式的網格。擁有 `columns`（每列的頂點數，2 以上）、`points`（頂點座標的序列。元素區域 pt）、`colors`（各頂點的顏色，與 `points` 同順序） |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | PDF 匯入的原生網格資料的緊湊表現。手寫範本不需指定 |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | 同上的漸層三角形版 |
| `pdfShading` | PdfMeshShadingDef |  | PDF 匯入的無損重新輸出用中繼資料。手寫範本不需指定 |

**`TilingPatternDef`**（拼貼圖樣——以小圖樣鋪滿填色。適合網底、棋盤格紋、重複標誌等）

表中的「圖樣空間」是圖樣專用的座標系。若未指定 `matrix`，即與元素區域的 pt 座標一致。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | 表示為拼貼圖樣的判別子 |
| `bbox` | [number, number, number, number] | ✓ | 一張圖樣（圖樣格）的邊界框（圖樣空間的座標） |
| `xStep` | number | ✓ | 圖樣格水平方向的重複間隔（圖樣空間） |
| `yStep` | number | ✓ | 圖樣格垂直方向的重複間隔（圖樣空間） |
| `graphics` | TileGraphicDef[] | ✓ | 繪製於圖樣格內的圖形陣列。以 `kind` 判別: `'path'`（SVG 路徑資料＋填色、線）／`'image'`（以 `source` 參照影像資源 ID）／`'text'`（指定字型、大小、顏色的文字）／`'group'`（帶變換、裁切、不透明度等的巢狀群組）。座標皆為圖樣空間 |
| `tilingType` | 1＝固定間隔（可配合繪製裝置讓圖樣格稍微變形） \| 2＝不變形（間隔可能稍有變動） \| 3＝固定間隔且高速拼貼 |  | 鋪滿的精度模式。預設: 1 |
| `paintType` | `'colored'`＝圖樣自身帶顏色 / `'uncolored'`＝以使用端的 `color` 上單色 |  | 顏色的持有方式。預設: `'colored'` |
| `color` | string |  | 使用 `'uncolored'` 圖樣時的著色顏色 |
| `matrix` | [number, number, number, number, number, number] |  | 從圖樣空間到元素區域空間的仿射變換矩陣。預設: 單位矩陣 |

**`FunctionShadingDef`**（函式漸變——由座標 (x, y) 以計算式決定顏色的填色。主要出現於 PDF 匯入）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | 表示為函式漸變的判別子。有帶 `expression` 的計算式形式與帶 `sampled` 的取樣形式兩種變體 |
| `domain` | [number, number, number, number] | ✓ | `[x0, x1, y0, y1]` 的輸入區域 |
| `expression` | string | ✓（僅計算式形式） | PostScript 計算式（PDF FunctionType 4）。接收 x, y 回傳 r, g, b。例: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓（僅取樣形式） | 已取樣的函式資料（PDF FunctionType 0）。擁有 `size`（取樣格的尺寸）、`bitsPerSample`（1/2/4/8/12/16/24/32）、`range`（輸出範圍）、`samples`（各格點的取樣值）、選填的 `encode`／`decode` |
| `matrix` | [number, number, number, number, number, number] |  | 從輸入區域到**元素區域 pt** 的映射矩陣。預設: 單位矩陣 |
| `background` | [number, number, number] |  | 區域外的背景色（DeviceRGB 成分，0〜1） |
| `bbox` | [number, number, number, number] |  | 限制繪製的邊界框 |
| `antiAlias` | boolean |  | 反鋸齒的提示 |
| `paintOperator` | `'pattern'`＝作為圖樣填色（預設） / `'sh'`＝在目前的裁切下直接繪製 |  | PDF 輸出時的繪製方式 |

**`PdfSpecialColorDef`**（特別色填色——金、銀、企業識別色等，用一般 CMYK 疊印無法重現的特定油墨印刷的色彩指定）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | 表示為特別色填色的判別子 |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | 特別色的色彩空間。單一油墨為 `kind: 'separation'`，擁有 `name`（油墨名）、`alternate`（在不支援特別色油墨的環境改用的印刷色色彩空間，參照下表）、`tintTransform`（以 PDF 函式指定濃度→替代色的轉換。例: `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }`＝濃度 0 為白、1 為藍）。多油墨為 `kind: 'deviceN'`，擁有 `names`（油墨名的陣列）、`alternate`、`tintTransform`、`subtype`（`'DeviceN'`＝標準／`'NChannel'`＝可追加各油墨屬性資訊的擴充形式）、`colorants`（各油墨名→單一油墨定義的對應表）、`process`、`mixingHints` |
| `components` | number[] | ✓ | 各油墨的濃度值（0〜1） |
| `displayColor` | string | ✓ | 在沒有特別色油墨的螢幕顯示、預覽中改用的顏色 |

**`PdfProcessColorSpaceDef`**（印刷色色彩空間＝以 CMYK 等標準油墨疊印表示「一般顏色」的色彩空間。用於特別色的 `alternate` 或軟遮罩的 `colorSpace`，以 `kind` 判別）

| 變體（`kind`） | 追加屬性 | 說明 |
| --- | --- | --- |
| `'gray'` | 無 | 灰階（DeviceGray） |
| `'rgb'` | 無 | RGB（DeviceRGB） |
| `'cmyk'` | 無 | CMYK（DeviceCMYK） |
| `'calgray'` | `whitePoint`・`blackPoint`・`gamma`（皆為必填） | 經測色校正的灰（CalGray） |
| `'calrgb'` | `whitePoint`・`blackPoint`・`gamma`（分成分）・`matrix`（3×3）（皆為必填） | 經測色校正的 RGB（CalRGB） |
| `'lab'` | `whitePoint`・`blackPoint`・`range`（皆為必填） | L\*a\*b\* 色彩空間 |
| `'icc'` | `components`（1\|3\|4）・`range`・`profile`（ICC 描述檔的位元組序列）（皆為必填） | 基於 ICC 描述檔的色彩空間 |

`whitePoint`／`blackPoint` 以 CIE XYZ 色彩空間的 `[x, y, z]` 陣列指定。

### 帶區（`bands`）與群組（`groups`）的屬性

範本 `bands` 中指定的 10 種帶區（參照「頁面是「帶區」的堆疊」），皆以下列 `BandDef` 定義（僅 `details` 為 `BandDef` 的陣列）。

**`BandDef`**

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 帶區的最小高度（pt）。隨元素的伸展而增高 |
| `elements` | ElementDef[] |  | 配置於帶區的元素 |
| `startNewPage` | boolean |  | 讓此帶區必定從新頁面開始 |
| `spacingBefore` | number |  | 帶區之前的空隙（pt） |
| `spacingAfter` | number |  | 帶區之後的空隙（pt） |
| `splitType` | `'stretch'`＝列印到頁面能容納的部分為止，其餘接續到下一頁（預設） / `'prevent'`＝不分割，把整個帶區送往下一頁（新頁面也放不下時才分割） / `'immediate'`＝即使在元素中途也於目前位置立即分割 |  | 帶區在頁面邊界放不下時的分割方法 |
| `printWhenExpression` | Expression \| null |  | 求值結果為假時，不輸出此帶區 |

**`GroupDef`**（`groups` 的各元素）

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 群組名稱。由變數的 `resetGroup` 或 textField 的 `evaluationGroup` 參照 |
| `expression` | Expression | ✓ | 群組判定鍵。逐列求值，在值改變的位置關閉前一群組並開始新群組 |
| `header` | BandDef |  | 輸出於群組開頭的帶區 |
| `footer` | BandDef |  | 輸出於群組末尾的帶區 |
| `keepTogether` | boolean |  | 整個群組放不進剩餘空間時，若換到新頁面能放得下，則先分頁再開始 |
| `minHeightToStartNewPage` | number |  | 頁面剩餘高度低於此值（pt）時，讓群組從新頁面開始 |
| `reprintHeaderOnEachPage` | boolean |  | 群組跨多頁時，在後續各頁重新列印頁首 |
| `resetPageNumber` | boolean |  | 群組開始時將 `PAGE_NUMBER` 重設為 1 |
| `startNewPage` | boolean |  | 讓各群組從新頁面開始 |
| `startNewColumn` | boolean |  | 讓各群組從新欄開始 |
| `footerPosition` | `'normal'`＝緊接明細之後輸出（預設） / `'stackAtBottom'`＝靠往頁面下方堆疊 / `'forceAtBottom'`＝恆置於頁面最下方，耗用其間的剩餘空間 / `'collateAtBottom'`＝僅在其他群組的頁尾靠下時一起排到下方（單獨時與 `'normal'` 相同） |  | 群組頁尾的縱向位置 |

### 樣式（`styles`）可指定的屬性

定義於範本的 `styles` 陣列，由元素的 `style` 屬性以 `name` 參照。字型、文字對齊、顏色等文字相關的指定，主要透過樣式進行。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 樣式名稱（由元素的 `style` 參照） |
| `parentStyle` | string |  | 父樣式名稱。繼承父樣式的屬性，以自身的指定覆寫（循環參照被忽略） |
| `isDefault` | boolean |  | 為 `true` 的樣式，作為預設套用於未指定 `style` 的元素 |
| `fontFamily` | string |  | 字型家族。預設: `'default'` |
| `fontSize` | number |  | 字型大小（pt）。預設: 10 |
| `bold` | boolean |  | 粗體。預設: `false` |
| `italic` | boolean |  | 斜體。預設: `false` |
| `underline` | boolean |  | 底線。預設: `false` |
| `strikethrough` | boolean |  | 刪除線。預設: `false` |
| `forecolor` | string |  | 前景色（`#RRGGBB` 或 `#RRGGBBAA`）。預設: `#000000` |
| `backcolor` | string |  | 背景色。預設: `transparent` |
| `hAlign` | `'left'`＝靠左 / `'center'`＝置中 / `'right'`＝靠右 / `'justify'`＝左右對齊 |  | 水平方向的配置。預設: `left` |
| `vAlign` | `'top'`＝靠上 / `'middle'`＝置中 / `'bottom'`＝靠下 |  | 垂直方向的配置。預設: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 文字旋轉（度） |
| `padding` | Padding |  | 留白 |
| `border` | BorderDef |  | 框線 |
| `mode` | `'opaque'`＝以 `backcolor` 填背景 / `'transparent'`＝不填背景 |  | 顯示模式 |
| `opacity` | number |  | 不透明度（0.0〜1.0） |
| `variation` | Record<string, number> |  | 可變字型（Variable Font）的軸值（例: `{ wght: 700, wdth: 75 }`） |
| `writingMode` | `'horizontal-tb'`＝橫排 / `'vertical-rl'`＝直排、行由右至左推進 / `'vertical-lr'`＝直排、行由左至右推進 |  | 書寫方向 |
| `conditionalStyles` | ConditionalStyleDef[] |  | 條件式樣式（參照下表）。條件成立時覆寫對應屬性 |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | 文字的方向（ltr＝左→右 / rtl＝右→左 / auto＝由內容自動判定） |
| `openTypeScript` | string |  | 將字串轉換為字形（成形）時，指定使用字型中哪個文字系統的規則的 OpenType 標籤（例: `'latn'`＝拉丁文字、`'arab'`＝阿拉伯文字）。通常不需指定（依文字內容自動處理） |
| `openTypeLanguage` | string |  | 對同一文字系統中依語言改變字形的字型，明示語言的 OpenType 標籤。通常不需指定 |
| `openTypeFeatures` | Record<string, number> |  | 字型內建字形切換功能（feature）的 ON/OFF。例: `{ "palt": 1 }`＝縮緊日文字距、`{ "liga": 0 }`＝停用合字、`{ "zero": 1 }`＝帶斜線的零。值 0＝停用／1＝啟用，字形選擇型 feature 為從 1 開始的替代字形編號 |

**`ConditionalStyleDef`**
| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | 套用條件。為真時以下列屬性覆寫 |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | 與 StyleDef 同名屬性同型 |  | 條件成立時被覆寫的值（意義與 StyleDef 的各屬性相同） |
| `underline` / `strikethrough` / `vAlign` / `opacity` | 與 StyleDef 同名屬性同型 |  | 型別定義上有宣告，但現行實作不套用條件成立時的覆寫 |

### PDF 匯入、進階 PDF 功能的型別

此處列出的型別，用途是 (1) 把匯入既有 PDF 的結果不損失任何一個位元組地重新輸出的「保全用」，以及 (2) 使用 PDF 的圖層、表單指令碼、商業印刷的製版指定等進階功能。手寫一般報表時幾乎不需指定。標示「由 PDF 匯入設定」的型別，會包含在 `importPdfPage()` 產生的元素中出現。

**`OptionalContentDef`**（PDF 的圖層功能）

PDF 具有把內容放到「圖層」（選擇性內容群組，OCG）上，從檢視器的圖層面板切換顯示/隱藏、列印/不列印的功能。在元素的 `optionalContent` 指定它，該元素就會被放到圖層上。例: 把「社外秘」浮水印做成圖層，只在列印時輸出。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 顯示於檢視器圖層面板的圖層名稱 |
| `visible` | boolean |  | 螢幕顯示的初始狀態。預設: true |
| `print` | boolean |  | 列印的初始狀態。預設: 依循 `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | 由 PDF 匯入設定。保全來源 PDF 的圖層定義（OCG），或依多個圖層組合決定可視性的成員資格定義（OCMD）。成員資格擁有 `groups`（對象圖層）與 `policy`（`'AllOn'`＝全部 ON 時可視 / `'AnyOn'`＝任一 ON / `'AnyOff'`＝任一 OFF / `'AllOff'`＝全部 OFF）、選填的可視性邏輯運算式 `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | 由 PDF 匯入設定。保全整份文件的圖層構成（全部圖層的清單、預設構成、圖層面板的顯示順序樹、互斥選擇群組、鎖定等） |

**`PdfRawValueDef`**（PDF 的「原始值」）

保全用屬性多半以「原始值」保持 PDF 內部資料，不解讀而原樣搬運。原始值是下列形式的 JavaScript 值: `null`、布林值、數值原樣，PDF 的名稱為 `{ kind: 'name', value: 'DeviceRGB' }`，字串為 `{ kind: 'string', bytes: Uint8Array }`，陣列為 `{ kind: 'array', items: [...] }`，字典為 `{ kind: 'dictionary', entries: { ... } }`，串流為 `{ kind: 'stream', entries: { ... }, data: Uint8Array }`。

**`PdfActionDef`**（PDF 檢視器執行的動作）

用於表單欄位的 `additionalActions` 等，定義「要檢視器做什麼」。內容只會被序列化、匯入，**核心引擎絕不執行**（執行者是支援的 PDF 檢視器）。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | 動作的種類。`'JavaScript'`＝執行指令碼（表單的輸入整形、驗證、自動計算即為此）／`'GoTo'`＝文件內移動／`'GoToR'`＝移動到另一份文件／`'GoToE'`＝移動到內嵌文件／`'URI'`＝開啟 URL／`'Launch'`＝啟動應用程式、檔案／`'Named'`＝預定義命令（下一頁等）／`'SubmitForm'`＝送出表單／`'ResetForm'`＝重設表單／`'ImportData'`＝匯入資料／`'Hide'`＝切換註解顯示／`'SetOCGState'`＝切換圖層顯示／`'Thread'`・`'Sound'`・`'Movie'`・`'Rendition'`・`'Trans'`・`'GoTo3DView'`・`'RichMediaExecute'`・`'GoToDp'`＝其他 PDF 標準動作 |
| `entries` | Record<string, PdfRawValueDef> | ✓ | 以原始值（上述 **`PdfRawValueDef`**）保持各種類設定值的字典。例: `'JavaScript'` 則為 `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | `'GoTo'` 系的移動目的地。具名（`{ kind: 'named', name, representation: 'name' \| 'string' }`）或明示指定（對象頁面＋顯示倍率的對齊方式） |
| `structureDestination` | PdfStructureDestinationDef |  | 以文件結構元素為基準的移動目的地（PDF 2.0） |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | 媒體系動作對象註解的指定 |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | `'SetOCGState'` 切換的圖層與操作（`'ON'`／`'OFF'`／`'Toggle'`）的序列 |
| `fieldTargets` | PdfActionFieldTargetsDef |  | `'Hide'`／`'SubmitForm'`／`'ResetForm'` 對象欄位名稱的指定 |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | `'GoToE'` 的內嵌檔案指定（遞迴結構） |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | `'Launch'` 的各平台參數。僅保持，不執行 |
| `articleTarget` | PdfArticleActionTargetDef |  | `'Thread'` 的文章串指定 |
| `documentPartIndex` | number |  | `'GoToDp'` 的移動目的地文件部分編號 |
| `richMediaInstanceIndex` | number |  | 富媒體的實例編號 |
| `next` | PdfActionDef \| PdfActionDef[] |  | 接續執行的動作（連鎖） |

**`PdfFormXObjectDef`**（匯入 PDF 零件的中繼資料保全）

在 PDF 內部，可將重複使用的繪製內容彙整為名為「Form XObject」的零件。PDF 匯入將此零件轉換為 `frame` 元素，以此型別保持零件持有的座標系、中繼資料，並在重新輸出時還原。手寫範本不需指定。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | 零件的邊界框（/BBox） |
| `matrix` | [number, number, number, number, number, number] | ✓ | 零件座標系的變換矩陣（/Matrix） |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | 來源 PDF 繪製此零件時有效的座標變換 |
| `formType` | 1 |  | 零件的形式編號（PDF 規格上僅有 1） |
| `group` | Record<string, PdfRawValueDef> |  | 透明群組字典的原始值保持 |
| `reference` | Record<string, PdfRawValueDef> |  | 外部 PDF 參照字典的原始值保持 |
| `metadata` | PdfRawValueDef 的串流形（`kind: 'stream'`） |  | 中繼資料串流的保持 |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | 建立應用程式專屬資料（/PieceInfo）的保持 |
| `lastModified` | PdfRawValueDef |  | 最後更新日期時間的保持 |
| `structParent` / `structParents` | number |  | 與帶標籤 PDF（朗讀順序等文件結構）對應鍵的保持 |
| `opi` | PdfOpiMetadataDef |  | OPI 資訊的保持（參照下表） |
| `name` | string |  | 零件名稱 |
| `measure` | PdfMeasurement |  | 量測資訊的保持（參照下表） |
| `pointData` | PdfPointData[] |  | 點群資料的保持（參照下表） |

**`PdfSourceVectorDef`**（匯入的重複圖形的共享定義）

匯入像地圖符號那樣大量重複同一圖形的 PDF 時，會以「定義 1 次＋配置 N 次」的形式保全圖形的輪廓資料。出現於 `path` 元素的 `pdfSourceVector`，指定時不剖析 `d`。手寫範本不需指定。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | 被重複使用的圖形定義的陣列。各定義擁有 `commands`（0＝移動起點〔座標 2 個〕、1＝直線〔2 個〕、2＝三次貝茲曲線〔6 個〕、3＝關閉路徑〔0 個〕）與 `coords`（依命令順序的座標扁平陣列） |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | 定義的配置的陣列。各配置擁有 `definitionIndex`（定義編號）與 `matrix`（6 元素仿射矩陣） |

**`PdfOpiMetadataDef`**（商業印刷的影像替換資訊）

OPI（Open Prepress Interface）是編輯期間放置輕量的低解析度影像，於印刷廠輸出時替換為高解析度影像的商業印刷機制。匯入的 PDF 擁有此指定時予以保全。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | OPI 的版本 |
| `entries` | Record<string, PdfRawValueDef> | ✓ | 以 PDF 原始值保持 OPI 字典的內容（替換來源檔名、裁切範圍等） |

**`PdfMeasurement`**（圖面、地圖的量測資訊）

在圖面 PDF 或地圖 PDF 中，檢視器的量測工具可依「紙上的 1cm 相當於實物的 1m」這類比例尺量測距離、面積。這是保全該比例尺、座標系資訊的型別，分為直角座標形式（`kind: 'rectilinear'`）與地理空間形式（`kind: 'geospatial'`）。

| 屬性（`'rectilinear'`） | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | 直角座標量測的判別子 |
| `scaleRatio` | string | ✓ | 比例尺的顯示文字（例: `'1in = 1ft'`） |
| `x` / `y` | PdfNumberFormat[] | ✓（`y` 為選填） | X／Y 方向數值顯示格式的連鎖（單位標籤、換算係數、小數/分數顯示等）。省略 `y` 時使用 `x` |
| `distance` / `area` | PdfNumberFormat[] | ✓ | 距離／面積的數值顯示格式 |
| `angle` / `slope` | PdfNumberFormat[] |  | 角度／坡度的數值顯示格式 |
| `origin` | [number, number] |  | 量測原點 |
| `yToX` | number |  | Y→X 單位的換算係數 |

| 屬性（`'geospatial'`） | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | 地理空間量測的判別子 |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | 大地座標系。EPSG 代碼或 WKT 字串擇一必填 |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | 大地座標的控制點，以及與其對應的影像、零件內的區域控制點（同數量） |
| `dimension` | 2 \| 3 |  | 座標的維度。預設: 2 |
| `bounds` | [number, number][] |  | 可量測區域的多邊形 |
| `displayCoordinateSystem` | 同 `coordinateSystem` |  | 顯示用的座標系 |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | 距離、面積、角度的優先顯示單位 |
| `projectedCoordinateSystemMatrix` | 12 元素的 number tuple |  | 投影座標系用的 4×4 仿射矩陣（省略常數第 4 欄的列序 12 元素） |

**`PdfPointData`**（地圖的點群資料）

保全內嵌於地圖 PDF、擁有具名欄（`LAT`＝緯度、`LON`＝經度、`ALT`＝高度等）的點資料表。

| 屬性 | 型別、可設定的值 | 必填 | 說明 |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | 欄名的陣列（唯一、非空。`LAT`/`LON`/`ALT` 欄必須為數值） |
| `rows` | PdfRawValueDef[][] | ✓ | 各列的值。列的長度與 `names` 一致 |

**`TransferFunctionDef`**／**`CalculatorFunctionDef`**（製版的階調轉換函式）

用於 `frame` 的 `deviceParams` 或 `softMask`，將值（0〜1）映射到另一個值的函式。表示製版中「這個濃度的油墨要以這個濃度印刷」的階調曲線。`TransferFunctionDef` 是 `CalculatorFunctionDef`（PostScript 計算式。例: `{ expression: '{ 1 exch sub }' }`＝黑白反轉）或 `PdfFunctionDef`（取樣值的表／指數內插／它們的結合，即 PDF 的函式物件）其中之一，使用處也可指定 `'Identity'`（不轉換）。

**`HalftoneDef`**（製版的網點定義）

印刷機以小點（網點）的大小表現顏色的濃淡。這是網點產生方式的指定，用於 PDF 匯入的保全與製版資料製作。依 `type` 分為 5 種形式:

| 形式 | 主要屬性 | 說明 |
| --- | --- | --- |
| type 1（網屏） | `frequency`（線數）✓・`angle`（角度）✓・`spotFunction`（點的形狀。`'Round'` 等預定義名稱或計算式）✓・`accurateScreens`（要求高精度網屏建構、選填） | 以線數、角度、點形狀定義網點的標準形式（`type` 可省略） |
| type 6（閾值陣列） | `width`✓・`height`✓・`thresholds`（寬×高個 0〜255）✓ | 以閾值的表直接定義網點 |
| type 10（帶角度閾值） | `xsquare`✓・`ysquare`✓・`thresholds`✓ | 帶角度儲存格的閾值定義 |
| type 16（16 位元閾值） | `width`✓・`height`✓・`thresholds`（16 位元值）✓・選填的第 2 矩形 | 高精度的閾值定義 |
| type 5（各色版集合） | `halftones`（`{ colorant: 油墨名, halftone: 上述任一形式 }` 的陣列）✓ | 為青、洋紅等各色版指派不同的網點 |

除 type 5 外的 4 種形式可擁有選填的 `transferFunction`（`'Identity'` 或 `TransferFunctionDef`）（type 5 則由各色版內側的網點定義分別持有）。

## 主要 API

以下將常用 API 依「想做什麼」逐一列出，附上最小範例。`template`、`dataSource`、`fontMap`、`fonts` 以直接沿用教學課程中建立者為前提。

### 組建報表

#### 想從範本與資料組建報表 — `createReport()`

將範本與資料做版面配置，回傳以頁面為單位的 `RenderDocument`。運算式是可參照 `field.*`、`vars.*`、`param.*`、`PAGE_NUMBER`、`TOTAL_PAGES` 等的安全內建運算式語言，不使用 `eval` 或 `Function`。也可選擇 TypeScript 的回呼運算式。

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // 已完成版面配置的頁數
```

#### 想以 ID 取得、修改範本元素 — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

兩個 API 都回傳原範本的元素參照。請在呼叫 `createReport()` 之前進行修改。`getElementChildren()` 會回傳子元素的是 `frame` 與 `table`（儲存格內元素），其他元素為空陣列。搜尋範圍的詳細請參照「以 ID 取得元素，並在繪製前修改」。

#### 想從 `.report` 檔案組建報表 — `createReportFromFile()`（Node.js）

讀入 JSON 範本，以範本的目錄為基準解析影像、子報表的相對路徑。

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### 想把多份報表合併成一冊 — `createReportBook()`

連結封面、內文等多個範本，做成編上連續頁碼的單一 `RenderDocument`。

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### 想連結已建立的 `RenderDocument` — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

影像 ID 發生衝突時會自動重新命名。

#### 想自動製作目錄頁 — `insertTableOfContents()`

從報表內的錨點（`anchorName`）收集目錄項目，並在開頭插入目錄頁。

```ts
const withToc = insertTableOfContents(
  document,
  // TOC page size and margins in pt (this example: A4 portrait)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // font ID (fontMap key) used for the TOC text
  { title: '目次' },
)
```

#### 想知道既有 PDF 的頁數 — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### 想把既有 PDF 匯入為報表元素 — `importPdfPage()`

詳細請參照**將既有 PDF 轉換為報表元素（PDF 匯入）**。

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### 繪製、輸出

#### 想輸出 PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### 只想預覽一頁 — `renderPage()`

以頁面為單位的繪製。用於瀏覽器預覽中只繪製顯示中的頁面。

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### 想把整份報表繪製到任意後端 — `render()`

將全部頁面繪製到實作了 `RenderBackend` 介面的任意輸出端。

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### 想繪製到 HTML Canvas — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### 想輸出為 SVG — `SvgBackend`

每頁產生一個完整獨立的 `<svg>` 字串。

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // 各頁 <svg> 字串的陣列
```

#### 想細部控制 PDF 產生 — `PdfBackend`

頁面縮圖等 PDF 特有選項傳給建構子。

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` 套用於第 i 頁。`thumbnailImageId`（顯示於頁面清單的縮圖影像）指定存在於 `document.images` 中的影像 ID。

#### 想合併已完成的 PDF — `mergePdfFiles()`

以 Pure TypeScript 的 PDF 剖析器將多個 PDF 合併為一個。

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### 處理字型

#### 想讀入字型檔 — `Font.load()`

解析 TTF、OTF、TTC、OTC、WOFF、WOFF2、EOT。

```ts
const font = Font.load(fontBuffer)
```

#### 想量測文字寬度 — `TextMeasurer`

利用 `Font` 的字圖快取的高速文字量測。註冊到 `fontMap` 後也用於版面配置。

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### 想把字串轉換為字形序列 — `font.shapeText()`

使用 OpenType/AAT（Apple 系字型的擴充規格）/Graphite（SIL 系字型的擴充規格）的資訊，取得套用了字形選擇、合字、位置調整的字形序列（字形編號與位置、字距的序列）。

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### 想在列印前偵測亂碼 — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### 單獨使用條碼、SVG、算式、影像

#### 想單獨產生條碼 — `renderBarcode()`

不經由報表元素，直接產生條碼的繪製節點。

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### 想解析並繪製 SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### 想單獨排版算式 — `parseMathLaTeX()` / `layoutMathFormula()`

需要內建算式用尺寸資訊（OpenType MATH 表）的字型（例: STIX Two Math、Latin Modern Math）。

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// arguments: parsed formula, Font object, font ID (fontMap key), font size in pt, text color
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box is the laid-out result; template math elements run this same layout internally
```

#### 想知道影像的尺寸 — `getImageDimensions()`

支援 PNG/JPEG/WebP/AVIF。

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### 想解碼 PNG — `decodePng()`

Pure TypeScript 的 PNG 解碼器。

```ts
const png = decodePng(pngBytes) // { width, height, pixels }（RGBA）
```

#### 想在瀏覽器輸出含 WebP/AVIF 的 PDF — `prepareBrowserPdfImageResources()`

JPEG 直接收錄進 PDF，PNG 由內建解碼器處理。要在瀏覽器產生含 WebP/AVIF 的 PDF 時，`tsreport-core/browser` 只將 `RenderDocument` 中實際被參照的影像先以瀏覽器標準轉碼器解碼，並將結果傳給 PDF 產生。未被參照的影像原樣保留、不會被解碼。

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: image bytes supplied at render time; catalog: PDF document catalog
// settings; collection: PDF portfolio settings — omit any of these you do not use
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

要在 Node.js 展開 WebP/AVIF 時，使用 `tsreport-core/node` 的 `createNodeExternalRasterImageDecoder()`。

## 資源讀取的限制與影像 ID 的規則

這是在伺服器運用或程式庫嵌入時需要時參照的詳細規則。

### 限制影像、範本的讀取目錄

影像檔的讀取可限定於明示允許的目錄之內。

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` 預設以主範本的目錄作為相對路徑的基準，但為了向後相容，讀取範圍本身不做隱含限制。指定 `resources.fileRoot` 後，影像、主範本、子報表全部套用相同限制。不存在的影像依各元素 `onError` 的指定處理，指向允許目錄之外的參照（包含經由符號連結）恆為錯誤。

### 影像 ID 的規則

`RenderDocument` 的各影像以 `RenderImage.imageId`（alternate 的 `imageId` 亦同）為鍵，從 `RenderDocument.images` 查找。**使用端請直接以此 ID 作為鍵，不要以路徑串接等方式重新組出鍵。**ID 依下列規則賦予。

- 即使讀入相對路徑的影像，也不會把 ID 替換為伺服器的絕對路徑或符號連結解析後的路徑。寫在範本中的參照原樣留作鍵（以絕對路徑撰寫時保留該值）
- 符號連結解析後的實體路徑，內部只用於「是否為同一檔案」的判定。即使基準目錄不同，指向相同實體的影像會重複使用相同 ID
- 在根報表把影像交由繪製時供給的構成——直接使用 `createReport()`，且對象影像也未傳入 `resources`，因此寫在範本中的參照原樣成為 ID，位元組序列事後以 `renderToPdf(document, { images })` 供給的構成——中，對子報表讀入的相對路徑本機影像，恆指派與主機無關的內部 ID。因為運算式或動態子報表的參照無法事先列舉，所以不依賴名稱是否實際衝突或版面配置的順序。如此一來，子報表的本機影像不會奪走同名的繪製時供給用 ID

### 繪製時的影像供給與 alternate

alternate 在版面配置時無法解析的情況下，保持原本的 image ID。因此 Canvas/SVG 預覽不會停住，可事後以 `renderToPdf(document, { images })` 供給位元組序列。明示傳入的 `images` 會合併進 `document.images`，相同 ID 時明示傳入的值優先。PDF 產生時，未供給的 alternate 也只是從替代候選中排除，主影像的繪製與整份報表不會停止。

### 影像參照的收集範圍

影像參照的收集，不只一般的 `image` 元素，還包括 alternate、群組的軟遮罩、填色（fill/stroke）的拼貼圖樣及其巢狀的軟遮罩，全部以相同機制處理。在瀏覽器使用 PDF 特有的頁面縮圖、collection 資料夾縮圖、Web Capture 影像時，請把相同的 `catalog`、`collection`、`pageOptions` 同時傳給 `prepareBrowserPdfImageResources(document, options)` 與 `renderToPdf(document, options)` 兩者（primitive API 則把相同 options 傳給 `new PdfBackend(options)` 並呼叫 `render(document, backend)`）。這些 WebP/AVIF 也只在 PDF 產生前解碼需要的部分。

## 執行環境

- Node.js 18 以上
- ES Modules / CommonJS
- 現代瀏覽器
- 無執行期相依套件

WOFF2 的 Brotli 壓縮、解壓縮，在 Node.js 與瀏覽器都使用 tsreport-core 內建的 Pure TypeScript 實作。不需要外部套件、WASM、原生程式庫。

## License

tsreport-core 可依使用者的選擇，以 [MIT License](./LICENSE-MIT) 或 [Apache License 2.0](./LICENSE-APACHE) 使用（SPDX: `MIT OR Apache-2.0`）。第三方來源程式碼、資料的著作權標示與授權條件，請參照 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
