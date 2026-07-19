# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | 简体中文 | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**从日文、中文、韩文到阿拉伯文——只用 Pure TypeScript，就能把世界上的各种文字排成精美 PDF 的报表引擎。**

`tsreport-core` 以同一套绘制模型，一以贯之地处理 OpenType 字体解析、文字排版（把文字以正确的字形、宽度和位置排布到版面上的处理）、带区（Band）方式的报表布局、Canvas/SVG 预览，直至 PDF 生成。运行时依赖包为零。不使用原生模块也不使用 WASM，仅凭这一个包即可同时运行于 Node.js 和现代浏览器。

本文档中的代码示例特意使用了日文业务数据（报价单、请款单）：它们同时也是本引擎 CJK 排版能力的现场演示。

```bash
npm install tsreport-core
```

本 README 汇集了从第一个 PDF 的生成，到全部 16 种报表元素、竖排、多语言排版、字体嵌入与文字转曲、浏览器预览等可以直接复制运行的示例。如果您是第一次接触报表工具，建议先阅读**报表布局的基本概念**一节掌握思路，再跟随教程生成您的第一个 PDF。

## 使用 tsreport-editor 进行 WYSIWYG 报表设计

[tsreport-editor](https://github.com/pontasan/tsreport-editor) 是基于 tsreport-core 构建的 WYSIWYG 报表设计器。您可以在画面上直观配置带区与元素、绑定 JSON 测试数据、检查打印预览、导入 PDF，并使用同一套 core 绘制引擎生成 PDF。以下视频展示了 AI 通过 MCP 编辑报表并在 Editor 中打开最终预览的完整过程。

| 英文演示 | 日文演示 |
| --- | --- |
| [![英文版 tsreport-editor WYSIWYG 演示](https://img.youtube.com/vi/CHsNew6yQr4/hqdefault.jpg)](https://youtu.be/CHsNew6yQr4) | [![日文版 tsreport-editor WYSIWYG 演示](https://img.youtube.com/vi/0I3ljxLUbys/hqdefault.jpg)](https://youtu.be/0I3ljxLUbys) |

## 用一个引擎，正确排布世界上的各种文字

多语言报表并不是把字符串原样写入 PDF 就能正确显示的。字形的选择、字宽的测量、位置的调整、换行、竖排，以及向 PDF 嵌入字体——只有这一整套处理环环相扣，才能得到符合预期的版面。

`tsreport-core` 将这一流程从字体解析到 PDF 生成一手包办。

- **日文、中文、韩文** — 从简体字、繁体字、谚文（Hangul）、标点处理到竖排专用字形，都基于 Unicode 与 OpenType 的信息进行正确排版
- **阿拉伯文字与从右到左（RTL）排版** — 依上下文变化的字形、连接与连字（多个字符相连合并为一个字形的现象）、Unicode 双向处理（从右到左书写的文字与数字、拉丁字母混排时的顺序控制），都由与其他文字相同的布局流程处理
- **复杂文字体系** — 支持基于字体内置排版规则（OpenType Layout）的字形替换与位置调整、组合字符、异体字（同一字符的不同设计字形），以及按语言区分的排版特性
- **竖排** — 处理 `vertical-rl` / `vertical-lr`、竖排专用字形、竖排度量（竖排专用的字符步进宽度等尺寸信息）以及文字旋转
- **字体自动子集化嵌入** — 只把实际用到的字形（glyph，字体中收录的单个字符的字形数据）收录进 PDF，即使阅读方没有同款字体也能以相同外观显示
- **文字转曲（轮廓化）** — 可以按元素为单位，把文字输出为不依赖字体的矢量路径
- **系统字体引用** — 面向使用阅读环境字体的运用场景，也可以选择不嵌入字体的轻量 PDF
- **乱码的事前检测** — `checkGlyphCoverage()` 会在输出前按页、按字符逐一找出字体中未收录的字符

而且，这套文字排版与专为报表打造的高级布局引擎是一体运作的。因为正确排布文字的能力与正确划分页面的能力密不可分。

- **随文字量联动的布局** — 按字符数伸展行高（`stretchWithOverflow`）并自动调整带区高度。再长的品名也不会被截断
- **随数据量自动分页** — 明细溢出时自动翻页，并重新输出页眉、表头行。按分组输出小计、分页也只需声明即可
- **嵌套结构的排布** — 组合了表格、交叉表、子报表的复杂报表，也由同一个布局引擎一致地完成排布
- **WYSIWYG（预览＝打印）** — 元素按指定的 pt 坐标精确固定排布，Canvas/SVG 预览与 PDF 输出共享同一布局结果。屏幕上看到的样子，就是纸上打印出的样子

## 为什么选择 tsreport-core

tsreport-core 是源于三个问题意识的项目。

**TypeScript 没有一个像样的报表解决方案。** 输出报价单、请款单是业务的基本功，然而在 TypeScript/Node.js 生态中，虽然有低层级绘制 PDF 的库，却没有一个具备带区布局、自动分页、汇总、预览与打印一致性的、称得上「报表引擎」的东西。我们想终结为了报表而专门引入其他语言运行时或外部服务器产品的架构。

**报表是基础功能，应当人人免费可用。** 报表输出不是少数昂贵产品才拥有的特殊功能，而是业务系统的基石。无需购买商业许可证，也无需按量付费，从个人工具到商业产品，任何人都应能原样使用同一个引擎。tsreport-core 以 MIT OR Apache-2.0 双许可证公开全部功能，正是这一理念的落实。

**正面完整实现亚洲文字、阿拉伯文字等多语言支持的解决方案太少。** 许多报表、PDF 生成工具以西文为前提设计，对日文、中文、韩文的排版以及从右到左书写的阿拉伯文字，往往只停留在事后补丁式的支持。tsreport-core 从一开始就把「用一个引擎正确排布世界上的各种文字」定为设计目标，从字体解析到排版、PDF 嵌入全部自行实现。

我们把这一动机凝结为以下三个特长。

### 从布局引擎到 PDF 生成，这一个包全部搞定

用模板和数据组出页面后，结果汇成一个名为 `RenderDocument` 的统一绘制模型。它可以原样绘制到 PDF、Canvas 或 SVG，因此无需为屏幕预览和打印维护两套布局处理，屏幕上看到什么，PDF 里就是什么。不需要再把具备带区布局的报表引擎和 PDF 库分开来拼装。

### 运行时零依赖的 Pure TypeScript

字体解析、文字排版、PDF 生成、DEFLATE 压缩、加密、PNG 解码、条形码生成，全部用 Pure TypeScript 实现。既不使用原生模块也不启动外部进程，因此在任何环境中的行为都一致，而且只需阅读这一个包就能审计报表生成时执行的全部代码。

### 报表所需功能标准配备

- 标题、页眉、明细、分组、摘要等带区布局
- 表格、交叉表、子报表、变量、表达式、分页、目录、多份报表的合并
- 既有 PDF 的导入 — 将 PDF 页面转换为报表元素（`ElementDef`）、样式、图像、字体信息
- Code 39/93/128、EAN、UPC、ITF、Codabar、MSI、QR Code、Data Matrix、PDF417
- SVG、渐变、裁剪、透明、数学公式排版、图像
- PDF 加密、PDF/A-1b・2b・3b（面向长期保存的国际标准）、PDF/X-1a（面向印刷交付的国际标准）、书签、链接、表单、注释
- TTF、OTF、TTC、OTC、WOFF、WOFF2、EOT、可变字体（可连续改变粗细、宽度等的字体）、彩色字体

## 报表布局的基本概念

面向第一次使用报表引擎的读者，下面按顺序讲解作为基础的思路。

### 前提: 报表由「模板」和「数据」两部分组成

在 tsreport-core 中，报表分成**模板**（布局定义）和**数据**（JSON）两部分来制作。

模板里不写实际的值。只定义「在这个位置放品名，以这个宽度、这个格式放金额」这样的框，以及**显示数据中哪个字段**的引用（写作 `field.item`，即数据的 `item` 字段）。

实际的值以 JSON 数据传入。`rows` 数组的一个元素就是明细的一行。

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

生成报表时，引擎自上而下逐行遍历 `rows`，每一行输出一次明细布局。上面的例子会打印 3 行明细，`field.item` 分别被替换为「りんご」「みかん」「ぶどう」。即使数据增加到 10,000 行，模板一个字符都不用改，就能得到 10,000 行的报表。这种「布局固定、行数由数据决定」的分工正是报表引擎的出发点。

### 页面是「带区」的层层堆叠

在此基础上，模板一侧把页面设计为称作**带区（Band）**的横向长条区域的堆叠。不必自己计算元素的 Y 坐标去排布页面，只需声明「哪个带区里放什么」，引擎就会根据数据行数自动组装页面。一页的结构如下。

```text
┌──────────────────────────┐
│ title                    │ ← 报表开头仅一次（标题、收件方等）
├──────────────────────────┤
│ pageHeader               │ ← 每页的上部（公司名、签发日期等）
├──────────────────────────┤
│ columnHeader             │ ← 明细的表头行（「品名・数量・金额」等）
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ rows 每 1 行输出 1 次，
│ details                  │ │ 按行数重复
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← 明细的收尾（每页、每栏）
├──────────────────────────┤
│ pageFooter               │ ← 每页的下部（页码等）
└──────────────────────────┘
```

在最后一页，最后的 `details` 之后会输出一次 `summary`（整份报表的合计等）。除此之外还有铺在每页背景上的 `background`、仅用于最后一页的 `lastPageFooter`、只在数据为 0 行时出现的 `noData`，可在 `bands` 中定义的带区共有 10 种。

| 带区 | 输出时机 | 典型用途 |
| --- | --- | --- |
| `background` | 每页的背景 | 水印、装饰边框 |
| `title` | 报表开头一次 | 标题、收件方 |
| `pageHeader` | 每页的上部 | 公司名、签发日期 |
| `columnHeader` | 明细之前（每页、每栏） | 明细的表头行 |
| `details` | 数据（`rows`）的每一行 | 明细行 |
| `columnFooter` | 明细之后（每页、每栏） | 小计栏 |
| `pageFooter` | 每页的下部 | 页码 |
| `lastPageFooter` | 最后一页的下部（指定时代替 `pageFooter`） | 结尾文句 |
| `summary` | 全部明细之后一次 | 总计、备注 |
| `noData` | 数据为 0 行时 | 「没有符合条件的数据」 |

进一步定义 `groups` 后，会在分组键的值发生变化的位置自动插入分组的页眉、页脚，实现「按部门输出小计并分页」之类的布局。

另外，指定模板的 `columns`（`count`＝栏数、`spacing`＝栏间距 pt）后，可以把明细区域像报纸那样分成多个纵向分栏（**栏**）来灌排。默认是 1 栏，此时本文档中「每栏」的行为与「每页」含义相同。此外，把内容送往下一栏的动作在本文档中表述为「换栏」。

### 分页是自动进行的

当明细在页面上放不下时，引擎会自动收束该页（输出 `pageFooter`）并开始下一页，再次输出 `pageHeader` 和 `columnHeader` 之后继续灌入后续明细。不需要写任何数行数、计算页面剩余高度的代码。

只有在需要控制时，才使用下列手段。

- `break` 元素 — 在任意位置强制分页、换栏
- 带区的 `startNewPage` — 让该带区必须从新的一页开始
- 带区的 `splitType` — 高度不足时，选择允许带区中途跨页（`stretch`），还是不分割、整体送往下一页（`prevent`）

### 子报表 = 嵌入报表之中的另一份报表

`subreport` 元素把另一个 `.report` 整体嵌入父报表的布局之中。「打印订单一览，并在每张订单内用表格打印其明细」——它就是用来组织这种**嵌套数据**的机制。

例如，假设父报表 `rows` 的一行（＝一张订单）持有明细数组 `items`。

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

在父报表的 `details` 带区放置 `subreport` 元素，用 `dataSourceExpression` 传入「这张订单的 `items`」。

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression` 顾名思义是一个「表达式」。传入固定文件名时，要作为表达式中的字符串字面量用 `'...'` 括起来（也可以像 `"field.templatePath"` 那样用表达式动态切换）。

于是，**父报表的每一行明细都会执行一次子报表**，传入的 `items` 被当作子报表一侧的 `rows` 处理。子报表（`order-items.report`）是独立的一份模板，拥有自己的带区定义，用 `field.name`、`field.qty` 引用明细的每一行。页面上会像下面这样展开。

```text
┌──────────────────────────────┐
│ details                      │ ← 父报表 rows 第 1 行（订单 A-001）
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← 传入这张订单的 items（2 条）
│   │   details              │ │ ← items 第 1 行（りんご 10）
│   │   details              │ │ ← items 第 2 行（みかん 5）
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← 父报表 rows 第 2 行（订单 A-002）
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← 传入这张订单的 items（1 条）
│   │   details              │ │ ← items 第 1 行（ぶどう 2）
│   └────────────────────────┘ │
└──────────────────────────────┘
```

请款单中的明细表、按客户重复的明细块……可以把「报表中的小报表」切分成部件加以复用。也可以从父报表传入参数（表头文字等）。在后面的**全部报表元素的实现示例**中，有一个结构相同、可直接运行的完整例子（父元素＋子报表侧模板）。

## 从 `.report` 与 JSON 数据生成 PDF

`.report` 是用 JSON 描述 `ReportTemplate` 的报表模板。内容就是纯粹的 JSON，因此可以用 Git 管理差异，也可以用任意语言或工具生成。

最小构成是以下 3 个文件。

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

两个字体文件名假定使用日文字体（例: Noto Sans JP）的 Regular / Bold。请按您手头的字体自行替换。在一份报表中处理多种语言的方法，见后文的**制作多语言报表**。

### 1. 编写模板 `quotation.report`

坐标、尺寸、边距、字号的单位全部是 PDF 的标准单位 **pt（点，1pt = 1/72 英寸 ≈ 0.353mm）**。`"size": "A4"` 按 595 × 842pt 处理（把 ISO 尺寸 210×297mm 换算成 pt 并取整的值），本例的边距 36pt 约合 12.7mm。

另一个前提是，`styles` 的 `fontFamily` 不是字体文件名，而是稍后在执行代码一侧注册到 `fontMap`、`fonts` 的**键名（逻辑名）**。在模板和代码中使用相同的名字（本例中为 `jp`、`jpBold`）即可建立对应关系。

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

明细中使用的 `pattern` 是数值、日期的格式指定（`#,##0`＝千位分隔，`¥#,##0`＝带日元符号的千位分隔。详见后文的「想对数值、日期进行格式化」）。

### 2. 把数据准备为 `quotation.test-data.json`

`rows` 的每一行绑定到明细带区的 `field.*`，`parameters` 绑定到整份报表的 `param.*`。

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

绑定的对应关系如下。

| JSON | `.report` 的表达式 | 用途 |
| --- | --- | --- |
| `rows[n].item` | `field.item` | 当前明细行 |
| `parameters.title` | `param.title` | 整份报表的参数 |
| 变量 `grandTotal` | `vars.grandTotal` | 汇总、计数等报表变量 |
| 页面上下文 | `PAGE_NUMBER` / `TOTAL_PAGES` | 页码、总页数 |

### 3. 读入 `.report` 并生成 PDF

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

把同一字体重复注册到 `fontMap` 和 `fonts`，是因为二者角色不同。`fontMap` 用于布局时的字宽测量（`TextMeasurer`），`fonts` 用于 PDF 生成时的字体嵌入。请把同一字体，用与模板 `fontFamily` 相同的键名注册到两处。

`createReportFromFile()` 以主 `.report` 所在目录为基准解析图像和子报表的相对路径。指定了 `workingDirectory` 时，则以该目录为基准。若要限制读取范围，请在 `resources.fileRoot` 中显式指定允许的根目录。指向根目录之外的相对引用，以及指向根目录之外的符号链接，都会被拒绝。

## 用 TypeScript 直接定义模板

也可以不使用 `.report` 文件，把模板写成 TypeScript 对象。由于可以享受类型检查和补全，这种方式适合从代码生成模板的用途。内容与教程相同，是一份报价单。坐标与尺寸的单位是 pt。

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

### 按 ID 获取元素并在绘制前修改

给元素附加任意 `id` 后，无论其处于带区或框架的哪一层深度，都可以用 `findElementById()` 获取。返回值不是副本，而是 `template` 中的元素本身，因此在 `createReport()` 之前所做的修改会反映到布局与绘制中。

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

`findElementById()` 按深度优先搜索普通带区、明细带区、分组的页眉／页脚、框架、软遮罩以及表格单元格。若同一 ID 存在多个，会返回搜索顺序中的第一个元素，因此作为修改目标使用的 ID 请在模板内保持唯一。`getElementChildren()` 返回的数组中的元素同样是对原模板的引用。

> 字体文件不随包附带。请指定许可证符合您的用途、分发方式、可否嵌入的字体。一个样式只能指定一个字体。若想在同一个元素中混排多种语言的文字，需要把它们收录在一起的 Pan-CJK 字体（一并收录日中韩文字的字体。例: Source Han Sans〔思源黑体〕、Noto Sans CJK）。按语言使用不同字体时，则如下一节「制作多语言报表」那样，把元素按语言拆分并分别套用样式。

## 制作多语言报表

一个样式只能指定一个字体，字体之间没有自动回退。因此多语言报表的基本形态是：**按语言加载字体，对各语言的元素分别套用对应的样式**。

下面的例子是一份日文与简体中文并排书写的报价单的节选。首先按语言加载字体。

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

在模板中，对日文文句套用 `ja` 样式，对中文文句套用 `zh` 样式，把元素按语言拆分。

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

数据也按语言分字段持有。

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

例外是像自由填写的备注那样、**直到运行时才知道会输入哪种语言的单个栏位**。该栏位的元素无法按语言拆分，现实的做法是只给这个样式分配一款把众多文字体系收录于一体的 Pan-CJK 字体（Source Han Sans〔思源黑体〕、Noto Sans CJK 等）。无论采用哪种方式，字体收录缺漏都会由 `checkGlyphCoverage()` 在输出前检出。

## 按文字元素逐个选择字体输出方式

即使在同一份报表内，也可以按每个 `staticText` 或 `textField` 指定输出方式，例如正文用可检索的嵌入文字、Logo 用转曲、固定文句用系统字体引用。

| 方式 | 指定 | 在 PDF 中的状态 | 适合的用途 |
| --- | --- | --- | --- |
| 子集嵌入 | `pdfFontMode: 'embedded'`（默认） | 嵌入用到的字形与字体程序。文字可选择、可检索 | 分发、长期保存、印刷、多语言报表 |
| 转曲（轮廓化） | `outlineText: true` | 把字形转换为矢量路径。不携带字体信息 | Logo、制版底稿等需要完全固定字形的文字 |
| 系统字体引用 | `pdfFontMode: 'reference'` | 不嵌入字体，只记录字体名与文字 | 字体环境可控的公司内部分发等场景下的轻量 PDF |

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

子集嵌入是不依赖输出目标环境、保持字形一致的推荐方式。系统字体引用要求打开 PDF 的环境具备兼容字体，环境不同外观也可能不同。转曲后的文字无法作为普通字符串被选择、检索。

## 竖排

只需在样式中指定 `writingMode`，就会使用竖排专用字形和竖排专用的尺寸信息（竖排度量＝字符步进宽度等）进行竖向排版。`vertical-rl` 使行从右向左推进，`vertical-lr` 使行从左向右推进。

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

## 在浏览器中预览与 PDF 相同的报表

为 PDF 生成的 `RenderDocument` 可以原样绘制到 Canvas。预览与打印共享同一布局结果，因此不会出现「屏幕和纸面看起来不一样」的问题。与 pt 单位的固定布局相结合，它是 WYSIWYG 预览、编辑体验的基石（默认字体嵌入。仅系统字体引用模式的外观依赖阅读环境）。只需调用 `renderPage()`，就会连同页面的开始、结束处理一起完成绘制。

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

用 React 搭建预览 UI 时，也可以使用 `tsreport-react` 包。

## 单独使用字体引擎

即使不制作报表，也可以单独使用字体解析、整形（shaping，把字符串转换为实际绘制的字形序列及其位置的处理）、文字测量、子集生成等各项功能。

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

## 把既有 PDF 转换为报表元素（PDF 导入）

`importPdfPage()` 解析既有 PDF 的页面，并将其转换为 tsreport-core 报表元素（`ElementDef`）的数组。它不是单纯的查看器：文本转为 `staticText`、图像转为 `image`、图形转为 `path`，以可在本报表引擎中直接编辑、重新排布的部件形式导入。

以纸面运用多年的报表 PDF、或其他系统输出的 PDF 为底稿，补充数据填充栏、重组布局——这是「把既有报表资产模板化」的入口。

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: staticText / image / path 等报表元素的数组
// page.styles:   元素引用的文字样式定义
// page.images:   元素引用的图像数据
// page.fonts:    被引用字体的信息
console.log(pageCount, page.width, page.height, page.elements.length)
```

导入的 `elements` 和 `styles` 可以原样放入模板的带区。加密 PDF 的密码指定、注释的导入、对导入文字的转曲处理等，由 `PdfImportOptions` 控制。

## 用好表达式（Expression）

报表中「会动的部分」全部用表达式书写。`textField` 的打印内容、`printWhenExpression` 的打印条件、条形码的数据、图像的路径、传给子报表的数据——凡类型为 `Expression` 的属性，处处都可以写同样的表达式。

表达式有两种形式。

- **字符串表达式** — 形如 `"field.price * field.quantity"` 的字符串。由专用解析器解释的 JavaScript 安全子集，完全不使用 `eval` 和 `new Function`。模板可以保存为 JSON（`.report` 文件）
- **回调表达式** — 形如 `(field, vars, param, report) => …` 的 TypeScript 函数。可以使用全部语言特性，但模板将无法保存为 JSON（前提是以 TypeScript 持有模板）

建议先掌握字符串表达式能写到什么程度，不够用时再转向回调。

### 表达式中可引用的值

| 名称 | 内容 |
| --- | --- |
| `field.*` | 当前数据行。可以像 `field.customer.name` 那样嵌套引用 |
| `vars.*` | 变量（后述 `variables` 中定义的汇总值）。写作 `var.*` 也相同 |
| `param.*` | 整份报表的值。包括数据源 `parameters` 传入的值和模板 `parameters` 的 `defaultValue`。在子报表中，父报表传入的参数也在这里 |
| `PAGE_NUMBER` | 当前页码（从 1 开始） |
| `COLUMN_NUMBER` | 当前栏号（从 1 开始） |
| `REPORT_COUNT` | 已处理的数据行数 |
| `TOTAL_PAGES` | 总页数。**直接引用会得到「截至该时点的页数」**，要打印最终总页数需与 `evaluationTime: 'report'` 或 `'auto'` 组合使用（后述） |

引用不存在的字段不会抛出异常，而是得到 `undefined`（`field.a.b` 中途为 `null` 时也会安全地返回 `null`）。

### 字符串表达式可用的语法

| 分类 | 可用内容 |
| --- | --- |
| 字面量 | 数值（`1200`、`0.5`）、字符串（`'見積'` 或 `"見積"`。支持 `\n` 等转义）、`true`／`false`／`null`／`undefined` |
| 模板字面量 | `` `合計 ${vars.total} 円` `` — `${}` 中可以写完整的表达式 |
| 算术 | `+`（数值加法与字符串拼接）、`-`、`*`、`/` |
| 比较 | `>`、`>=`、`<`、`<=`、`===`、`!==` |
| 逻辑 | `&&`、`\|\|`、`!`（与 JavaScript 相同的短路求值） |
| 空值合并 | `??` — 左侧为 null/undefined 时返回右侧 |
| 条件（三元） | `条件 ? 为真的值 : 为假的值` |
| 其他 | 一元 `-`／`+`、括号 `( )`、点记法的成员访问（属性名可以是日文: `field.顧客名`） |
| 内置函数 | `format(值, 模式)`＝格式化（后述）／`round(值, 位数?)`＝四舍五入／`roundUp`・`roundDown`・`roundHalfEven`（银行家舍入）・`ceil`・`floor`・`trunc`（第 2 参数均为小数位数，省略时为 0）／`now()`＝当前时刻 |

**不可用的内容**: `==`／`!=`（请用 `===`／`!==`）、`%` 和 `**`、方括号记法（`field['a-b']`）与数组索引、方法调用（`field.name.toUpperCase()` 在求值时报错——可调用的函数只有上表的内置函数）、赋值、函数定义、`new`、可选链（`?.`——中途为 null 本来就不会抛异常，因此并无必要）。需要这些时请使用回调表达式。

这一限制是出于安全考虑。字符串表达式由独立解析器解释，绝不会作为代码执行，因此无法在外部接收的模板中埋入任意代码。

### 想打印计算结果

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

数据示例:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

将打印出 `¥3,960`。

### 想拼接字符串

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

嵌入模板字面量 `${}` 中的值会被字符串化后拼接。**null 会变成字符串 `"null"`**，因此对可能缺失的字段要像例子那样附上 `?? ''`。

### 想按条件切换显示内容

用三元运算符切换打印内容。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

如果不是「改变显示的内容」而是「改变是否显示」，请使用全元素通用的 `printWhenExpression`（参见「想仅在满足条件时打印元素」）。要按条件改变样式（颜色或粗体）时，在样式定义的 `conditionalStyles` 中指定写法相同的条件表达式。

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### 想对数值、日期进行格式化 — `format` 与 `pattern`

`textField` 可以通过 `pattern` 属性在打印时对表达式的求值结果进行格式化。想在表达式内部对局部进行格式化时，使用内置函数 `format(值, 模式)`。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

数值模式由 `#`（该位有值则显示）、`0`（补零）、`,`（千位分隔）组合而成，前后可以写前缀、后缀。舍入方式为四舍五入。

| 模式 | 输入 | 输出 |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

日期模式的标记为 `yyyy`（4 位年）、`MM`／`M`（补零月／月）、`dd`／`d`（补零日／日）、`HH`（补零时・24 小时制）、`mm`（分）、`ss`（秒）。值为 null/undefined 时输出空字符串。

对此仍不够用的格式（日本年号纪年、星期、货币位数处理等），可在模板的 `formatters` 中注册具名的 TypeScript 函数，并把该名字写进 `pattern`。

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// 元素侧: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` 会先查找已注册的格式化器名称，找不到时才作为内置格式解释。格式化器是函数，因此使用该功能的模板要用 TypeScript 而非 JSON 来持有。

### 想打印合计、平均、件数 — 变量（`variables`）

跨明细的汇总在模板的 `variables` 中定义。变量在每处理一行数据时把 `expression` 的结果并入汇总，表达式中可用 `vars.名称` 引用当前值。

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

在 `pageFooter` 带区放一个 `"expression": "vars.pageTotal"` 的 `textField` 即为页小计，在 `summary` 带区放 `"expression": "vars.grandTotal"` 即为总合计。

**属性一览（`variables` 的各元素）**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 变量名。表达式中以 `vars.名称` 引用 |
| `expression` | Expression | ✓ | 逐行求值，结果并入汇总 |
| `calculation` | `'sum'`＝合计 / `'average'`＝平均 / `'count'`＝件数 / `'distinctCount'`＝去重后的件数 / `'min'`＝最小值 / `'max'`＝最大值 / `'first'`＝最初的值 / `'nothing'`＝每行覆盖（最后的值） | ✓ | 汇总方法 |
| `resetType` | `'report'`＝在整份报表范围持续汇总（不重置・默认） / `'page'`＝每页重置 / `'column'`＝每栏重置 / `'group'`＝按 `resetGroup` 的分组重置 / `'none'`＝不重置这点与 `'report'` 相同，但在延迟求值（`evaluationTime`）下也按元素放置时点的值定格（不会事后替换为最终汇总值） |  | 汇总的重置单位 |
| `resetGroup` | string |  | `resetType: 'group'` 时的目标分组名 |
| `incrementCondition` | Expression |  | 指定时，求值结果为假的行不并入汇总（条件汇总） |
| `initialValue` | Expression |  | 初始化、重置时的初始值 |

使用 `incrementCondition`，「只合计特定类别」之类的条件汇总用一个变量就能写出:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

另外，想在父报表中汇总子报表的执行结果时，`subreport` 元素的 `returnValues` 会把子报表的变量写回父报表的 `vars.*`（参见 `subreport` 的属性一览）。

### 想打印页码、总页数

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

要点是 `evaluationTime: 'auto'`。表达式通常在元素放置的一瞬间求值，但那个时点还不知道最终的总页数。指定 `'auto'` 后，会对表达式进行静态分析，`PAGE_NUMBER` 在页面定格时、`TOTAL_PAGES` 在报表完成时——像这样**按引用逐个在正确的时机求值**。`'auto'` 需要解析表达式，因此仅限字符串表达式（对回调表达式指定会抛出异常）。

### 想写字符串表达式办不到的事 — 回调表达式

如果模板是用 TypeScript 定义的，那么在所有接受 `Expression` 的地方都可以直接写函数。参数为 `(field, vars, param, report)` 四个，从 `report` 可以引用 `PAGE_NUMBER` 等内置值、`format` 函数以及已注册的 `formatters`。

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

方法调用、正则表达式、外部函数的利用……凡是 TypeScript 能写的都能写。代价有两个——模板无法再作为 JSON 保存、传输；无法使用 `evaluationTime: 'auto'`（`'report'` 等显式指定仍可使用）。

### 表达式出错时的行为

- **语法错误、被禁语法**（方法调用等）会抛出带位置信息的 `ExpressionLanguageError`，并原样传播到 `createReport()` 的调用方。不会被吞掉而变成空栏
- **引用不存在的字段、变量**不会报错，而是求值为 `undefined`。在 `textField` 中，指定了 `blankWhenNull: true` 则为空栏，未指定则打印字符串 `null`
- 想在执行前校验用户输入的表达式时，`validateExpressionSource(source)` 会返回语法检查结果（错误或 `null`）

## 全部报表元素的实现示例

下面展示 `ElementDef` 提供的全部 16 种元素。所有元素都要指定 `x`、`y`、`width`、`height`（单位为 pt，1pt = 1/72 英寸），并放入带区或 `frame` 的 `elements`。

| 想做的事 | 元素 |
| --- | --- |
| 打印固定字符串 | `staticText` |
| 打印数据、变量、表达式的结果 | `textField` |
| 画边线 | `line` |
| 画矩形、圆角框 | `rectangle` |
| 画圆、椭圆 | `ellipse` |
| 画任意矢量图形 | `path` |
| 放置图像 | `image` |
| 把多个元素框在一起 | `frame` |
| 打印表格 | `table` |
| 打印交叉表 | `crosstab` |
| 在报表中嵌入另一份报表 | `subreport` |
| 打印条形码、二维码 | `barcode` |
| 打印数学公式 | `math` |
| 打印 SVG | `svg` |
| 制作可输入的 PDF 表单 | `formField` |
| 在任意位置分页、换栏 | `break` |
| 仅在满足条件时打印元素 | `printWhenExpression`（全元素通用属性） |

以下每个元素给出一段可直接放入带区 `elements` 数组的定义，使用表达式的元素还附上对应的数据示例。同时在各元素小节末尾载有该元素特有的属性一览。全元素通用的属性（位置、颜色、打印条件等）和样式的属性，参见后述的「元素属性参考」。

### 想打印固定字符串 — `staticText`

把写在模板里的字符串原样打印。用于标题和标签。

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | 元素种类 |
| `text` | string | ✓ | 要打印的固定字符串 |
| `actualText` | string |  | 外观文字与复制、检索时取出的文本不同时的替换文本（PDF 的 /ActualText）。主要供 PDF 导入保全原 PDF 的指定 |
| `hyperlink` | HyperlinkDef |  | 超链接（参见通用属性一节的 **`HyperlinkDef`**） |
| `anchorName` | string |  | 锚点名。作为书签和文档内链接（`hyperlink` 的 `'localAnchor'`）的到达目标登记 |
| `bookmarkLevel` | number |  | 把该元素文本载入 PDF 查看器侧栏目录（书签）时的层级（1 为最上层，1〜6） |

※ 此外还可指定全元素通用属性和 `TextProperties` 的全部属性。

### 想打印数据或表达式的结果 — `textField`

打印 `expression` 的求值结果。可引用 `field.*`（数据）、`vars.*`（变量）、`param.*`（参数）、`PAGE_NUMBER` 等，并用模板字面量拼接字符串。表达式的完整写法参见「用好表达式（Expression）」。用 `pattern` 指定数值、日期的格式，用 `stretchWithOverflow` 指定随文字量伸展高度。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

数据示例:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | 元素种类 |
| `expression` | Expression | ✓ | 返回打印值的表达式 |
| `pattern` | string |  | 格式模式。优先查找模板注册的自定义格式化器（`formatters` 的模式名），没有则用内置格式化器整形 |
| `blankWhenNull` | boolean |  | 表达式结果为 null/undefined 时置为空字符串（未指定时会打印字符串 `'null'`） |
| `stretchWithOverflow` | boolean |  | 内容超出 height 时，让元素高度随内容伸展 |
| `evaluationTime` | `'now'`＝当场立即求值（默认） / `'band'`＝带区定格时求值 / `'column'`＝栏结束时求值 / `'page'`＝页面结束时求值 / `'group'`＝`evaluationGroup` 的分组定格时求值 / `'report'`＝报表结束时求值（TOTAL_PAGES 等已定格） / `'auto'`＝把表达式引用的各变量、内置值按各自的重置时机分别求值（仅限字符串表达式。回调表达式会抛出异常） |  | 表达式的求值时机。指定默认以外的值时，放置阶段先留空占位，待相应时机的值定格后再填入。典型例: 把分组合计提前印在分组开头（`'group'`）、打印最终总页数（`'report'`） |
| `evaluationGroup` | string |  | `evaluationTime: 'group'` 时的目标分组名 |
| `textTruncate` | `'none'`＝放不下的行不绘制（默认。当前实现与 `'truncate'` 行为相同） / `'truncate'`＝按行截掉放不下的行 / `'ellipsisChar'`＝在最后一行的字符边界截断并附加 `...` / `'ellipsisWord'`＝在最后一行的单词边界截断并附加 `...` |  | `stretchWithOverflow` 未启用时，超出高度的文本的处理方式。默认: `none` |
| `hyperlink` | HyperlinkDef |  | 超链接（参见通用属性一节的 **`HyperlinkDef`**） |
| `anchorName` | string |  | 锚点名。作为书签和文档内链接（`hyperlink` 的 `'localAnchor'`）的到达目标登记 |
| `bookmarkLevel` | number |  | 把该元素文本载入 PDF 查看器侧栏目录（书签）时的层级（1 为最上层，1〜6） |

※ 此外还可指定全元素通用属性和 `TextProperties` 的全部属性。`isPrintRepeatedValues: false` 对本元素有效（抑止相同值的连续打印）。

### 想画边线 — `line`

本例是高度为 0 的水平边线。`lineStyle` 除 `solid` 外还可以指定 `dashed` 等。

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | 元素种类。线段从元素左上 `(x, y)` 画到右下 `(x+width, y+height)`（`height: 0` 为水平线，`width: 0` 为垂直线，两者皆非 0 为对角线） |
| `lineWidth` | number |  | 线宽（pt）。默认: 1 |
| `lineStyle` | `'solid'`＝实线 / `'dashed'`＝虚线 / `'dotted'`＝点线 |  | 线型。默认: 实线 |
| `lineColor` | string |  | 线色。默认: 元素的 `forecolor`，再没有则为 `#000000` |

### 想画矩形、圆角框 — `rectangle`

用 `cornerRadii` 可以分别指定四角的圆角。

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

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | 元素种类 |
| `radius` | number |  | 圆角半径（pt。四角通用） |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | 每个角各自的圆角半径（pt） |
| `fill` | FillDef |  | 填充（参见通用属性一节的 **`FillDef`**）。默认: 样式的 `backcolor`（非 `transparent` 时） |
| `stroke` | string |  | 边框色。默认: 样式的 `forecolor` |
| `strokeWidth` | number |  | 边框宽（pt）。默认: 1 |

### 想画圆、椭圆 — `ellipse`

绘制内接于框宽、框高的椭圆。

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | 元素种类。绘制内接于元素边界框的椭圆（中心 `(x+width/2, y+height/2)`，半径 `width/2`×`height/2`） |
| `fill` | FillDef |  | 填充（参见通用属性一节的 **`FillDef`**）。未指定时不填充 |
| `stroke` | string |  | 边框色。未指定时无边框 |
| `strokeWidth` | number |  | 边框宽（pt）。默认: 1（指定 `stroke` 时） |

### 想画任意矢量图形 — `path`

在 `d` 中指定 SVG 的路径语法，在 `viewBox` 中指定其坐标系。图形会按元素的框缩放。

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

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | 元素种类 |
| `d` | string | ✓ | SVG 路径数据（M/L/C/Z 等）。坐标为元素局部 pt |
| `pdfSourceVector` | PdfSourceVectorDef |  | PDF 导入以「定义 1 次＋放置 N 次」的形式保全反复出现的同一图形（地图符号等）的产物（参见后述的 **`PdfSourceVectorDef`**）。指定时不执行 `d` 的解析处理。手写模板无需指定 |
| `affineTransform` | [number, number, number, number, number, number] |  | 绘制前把路径坐标映射到元素局部坐标的仿射变换矩阵。`[a, b, c, d, e, f]` 表示 `x' = a·x + c·y + e、y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, 宽, 高]`。把路径坐标从该区域缩放到元素的宽、高 |
| `fill` | FillDef |  | 填充（参见通用属性一节的 **`FillDef`**）。未指定时不填充 |
| `fillRule` | `'nonzero'`（默认） / `'evenodd'` |  | 自相交路径或嵌套路径中判定哪里算「内侧」并填充的规则。想挖出甜甜圈状的孔时用 `'evenodd'` 更稳妥 |
| `fillOpacity` | number |  | 填充的不透明度（0.0〜1.0） |
| `stroke` | FillDef |  | 描边（除单色外也可指定渐变等）。未指定时无描边 |
| `strokeWidth` | number |  | 描边宽（pt）。默认: 1（指定 `stroke` 时） |
| `strokeOpacity` | number |  | 描边的不透明度（0.0〜1.0） |
| `strokeLinecap` | `'butt'`＝端点截断 / `'round'`＝圆端 / `'square'`＝方端（延长线宽的一半） |  | 线端形状 |
| `strokeLinejoin` | `'miter'`＝斜接（尖角） / `'round'`＝圆角 / `'bevel'`＝斜切 |  | 线的连接形状 |
| `strokeMiterLimit` | number |  | 斜接限制值。默认: 10 |
| `strokeDasharray` | number[] |  | 虚线模式（线段与间隔长度的数组，pt） |
| `strokeDashoffset` | number |  | 虚线模式的起始偏移（pt） |

### 想放置图像 — `image`

用 `sourceExpression`（表达式）或 `source`（固定值）指定图像。用 `scaleMode` 选择放入框的方式，用 `onError` 选择找不到图像时的行为（`error`＝报错 / `blank`＝空白 / `icon`＝显示图标）。

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

数据示例:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | 元素种类 |
| `source` | string | | 固定的图像引用（图像 ID）。以 `.report` 为基准的相对路径、绝对路径、URL、data URI 等直接书写（ID 的规则参见后述的「资源读取的限制与图像 ID 的规则」）。在 `sourceExpression` 未指定或求值结果未解决时使用 |
| `sourceExpression` | Expression | | 动态图像源表达式。结果为字符串则作为图像 ID 解析，为 `Uint8Array` 则作为图像数据本身处理 |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | 图像的缩放方式。`'clip'`＝按原尺寸放置并以元素框裁剪／`'fillFrame'`＝忽略纵横比、变形缩放至铺满元素框／`'retainShape'`＝保持纵横比、按框内可容纳的最大倍率缩放／`'realSize'`＝原尺寸放置＋框裁剪（实现上与 `'clip'` 为同一处理）。默认: `'retainShape'`。另外，无法获取图像尺寸时行为与 `'fillFrame'` 相同 |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | 图像在框内的水平放置（作用于 `retainShape` 的留白分配、`clip`/`realSize` 的裁取位置）。默认: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | 图像在框内的垂直放置。默认: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | 图像源未定义、解析失败时的行为。`'error'`＝抛出异常／`'blank'`＝什么都不绘制／`'icon'`＝绘制灰色边框加 × 记号的占位图。默认: `'icon'` |
| `lazy` | boolean | | 仅存在类型定义，当前的布局引擎、渲染器实现不引用（规范未记载） |
| `rotation` | `0` \| `90` \| `180` \| `270` | | 图像的旋转角（度） |
| `affineTransform` | [number, number, number, number, number, number] | | 用矩阵直接指定放置的替代手段。`[a, b, c, d, e, f]` 是把单位正方形（0〜1）的图像按 `x' = a·x + c·y + e、y' = b·x + d·y + f` 映射的变换，指定时不执行基于 `scaleMode`/`hAlign`/`vAlign`/`rotation` 的放置计算。主要供 PDF 导入保全原有放置 |
| `opacity` | number | | 不透明度（0.0〜1.0） |
| `interpolate` | boolean | | 放大低分辨率图像时，让查看器平滑插值像素边界后显示（PDF 的 /Interpolate）。照片适合启用，条形码等需要锐利显示的图像适合停用 |
| `alternates` | PdfImageAlternateDef[] |  | 屏幕显示与打印分别使用不同图像的 PDF 替代图像（/Alternates）。每个元素有 `source`＝替代图像的引用（必需）和 `defaultForPrinting`＝打印时是否使用此图像，共 2 个属性 |
| `opi` | PdfOpiMetadataDef |  | 商业印刷中在输出时把低分辨率占位图替换为高分辨率图像的 OPI 信息。主要用于 PDF 导入的保全（参见后述的 **`PdfOpiMetadataDef`**） |
| `measure` | PdfMeasurement |  | 图纸、地图 PDF 中查看器测量工具使用的比例尺、坐标系信息。主要用于 PDF 导入的保全（参见后述的 **`PdfMeasurement`**） |
| `pointData` | PdfPointData[] |  | 地图 PDF 的点群数据（纬度、经度等）。主要用于 PDF 导入的保全（参见后述的 **`PdfPointData`**） |
| `hyperlink` | HyperlinkDef | | 超链接（`type`: `'reference'`＝URL／`'localAnchor'`＝文档内锚点／`'localPage'`＝文档内页面／`'remoteAnchor'`・`'remotePage'`＝外部 PDF 内的锚点、页面，`target`: 链接目标的表达式，`remoteDocument?`: 外部 PDF 路径的表达式） |

### 想把多个元素框在一起 — `frame`

将子元素分组，可用 `border` 指定边框，用 `clip` 指定对超出部分的裁剪。子元素的坐标以 `frame` 的左上角为原点。

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

数据示例:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | 元素种类 |
| `clip` | boolean | | 是否在框架边界裁剪子元素。默认: true |
| `border` | BorderDef | | 边框（参见通用属性一节的 **`BorderDef`**） |
| `padding` | Padding | | 内边距（`top?`/`bottom?`/`left?`/`right?`，各为 pt） |
| `rotation` | number | | 框架的旋转角（度，在页面坐标中逆时针） |
| `rotationOriginX` | number | | 旋转原点 X（相对框架，pt）。默认: 0 |
| `rotationOriginY` | number | | 旋转原点 Y（相对框架，pt）。默认: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | 把 Y 轴朝上的框架局部坐标映射到父坐标空间的仿射矩阵（矩阵的排列与含义同 `image` 的 `affineTransform`）。主要供 PDF 导入保全原有放置 |
| `pdfForm` | PdfFormXObjectDef |  | PDF 导入时保持并重新输出原 PDF 部件（Form XObject）持有的坐标系、元数据（参见后述的 **`PdfFormXObjectDef`**）。手写模板无需指定 |
| `hyperlink` | HyperlinkDef | | 超链接（与 image 的同名属性结构相同） |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | 基于 SVG 路径语法的裁剪路径。`d`＝路径数据，`fillRule`＝填充规则 |
| `transparencyGroup` | boolean | | 即使 `isolated`/`knockout` 均未启用，也保持 PDF 的透明组边界。保持后，不透明度、混合的合成结果与把框架当作一张图合成时相同（主要用于 PDF 导入的再现） |
| `isolated` | boolean | | 隔离透明组（PDF /Group /I）。设置了它（或 `knockout` / `softMask`）后，框架先作为整体合成，再套用不透明度、混合、遮罩 |
| `knockout` | boolean | | 挖空透明组（PDF /Group /K）。组内相互重叠的子元素之间不互相透视，每个位置只有最前面的子元素与背景合成 |
| `softMask` | FrameSoftMaskDef | | 让框架局部透明化的软遮罩（参见下表 **`FrameSoftMaskDef`**）。把 `elements` 的绘制结果当作「透过率地图」使用，可以实现随渐变逐渐消隐之类的表现 |
| `deviceParams` | DeviceParamsDef | | 面向商业印刷制版工序的参数（参见下表 **`DeviceParamsDef`**）。普通报表无需指定，主要供 PDF 导入保全原 PDF 的指定 |
| `elements` | ElementDef[] | | 框架内的子元素 |

**`FrameSoftMaskDef`**（`softMask` 的结构）
| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | 遮罩种类。`'luminosity'`＝遮罩越亮的部分框架越不透明／`'alpha'`＝遮罩越不透明的部分框架越不透明 |
| `colorSpace` | PdfProcessColorSpaceDef | | 软遮罩透明组的混合色彩空间 |
| `isolated` | boolean | | 软遮罩透明组的隔离标志 |
| `knockout` | boolean | | 软遮罩透明组的挖空标志 |
| `backdrop` | [number, number, number] | | 亮度遮罩用 /BC 背景色（DeviceRGB 0〜1）。默认: 黑 |
| `elements` | ElementDef[] | ✓ | 作为透明组合成、定义遮罩的元素群 |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | 重映射遮罩值（0..1）的 /SMask /TR 传递函数 |

**`DeviceParamsDef`**（`deviceParams` 的结构。面向商业印刷制版，通常无需指定——主要用于 PDF 导入的保全）
| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | /TR 传递函数。`'Identity'`／`'Default'`／全部色版共用的单一函数／按 4 色版分别指定的函数数组 |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | /BG 黑版生成函数（`'Default'`＝按 /BG2 的设备默认） |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | /UCR 底色去除函数（`'Default'`＝按 /UCR2 的设备默认） |
| `halftone` | `'Default'` \| HalftoneDef | | /HT 半色调（type 1 网屏／type 6・10・16 阈值数组／type 5 按色版的集合） |
| `halftoneOrigin` | [number, number] | | PDF 2.0 半色调原点（/HTO，设备空间像素） |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | PDF 2.0 黑点补偿控制（/UseBlackPtComp） |
| `flatness` | number | | 平滑化容差（/FL） |
| `smoothness` | number | | 渐变平滑度容差（/SM） |
| `strokeAdjustment` | boolean | | 自动描边调整（/SA） |

### 想打印表格 — `table`

拥有表头行、明细行、表尾行的表格。用 `dataSourceExpression` 传入行数据的数组后，明细行会按数组元素数量重复。

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

数据示例（`items` 的每个元素成为表格明细的一行）:

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

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | 元素种类 |
| `columns` | TableColumnElementDef[] | ✓ | 列定义的数组。全部列的 `width` 合计与元素宽度不同时，所有列按比例缩放至恰好容纳于元素宽度 |
| `headerRows` | TableRowElementDef[] |  | 表头行的数组。分页拆分时在每页开头重复绘制 |
| `detailRows` | TableRowElementDef[] |  | 明细行的数组。每有一条数据行就重复绘制一遍（数据行 × detailRows 的全部行） |
| `footerRows` | TableRowElementDef[] |  | 表尾行的数组。分页拆分时只在最后一页绘制 |
| `dataSourceExpression` | Expression |  | 把求值结果的数组用作此表格的数据行。省略时使用主数据源的行。求值结果不是数组时抛出异常 |

**`TableColumnElementDef`**（`columns` 的各元素＝列定义）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 列宽（pt）。全部列合计与元素宽度不一致时按比例分配 |
| `style` | TableCellStyleDef |  | 该列的默认单元格样式。单元格一侧指定了同名属性时以单元格一侧优先（边线按边为单位合并） |

**`TableRowElementDef`**（`headerRows`/`detailRows`/`footerRows` 的各元素＝行定义）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 行高（pt）。按最小值处理，文本折行或单元格内子元素容纳不下时自动扩展（rowSpan 单元格的内容超出部分由合并范围的最后一行扩展） |
| `cells` | TableCellElementDef[] | ✓ | 该行单元格定义的数组。被上方行的 `rowSpan` 占用的列会自动跳过再放置 |

**`TableCellElementDef`**（`cells` 的各元素＝单元格定义。除下列外还可直接指定 `TableCellStyleDef` 的全部属性）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `text` | string |  | 单元格的固定文本 |
| `expression` | Expression |  | 用于数据绑定的表达式。`field.名称` 单独形式直接从数据行取值，其余通过引擎的表达式求值解析。指定时优先于 `text` |
| `colSpan` | number |  | 横向合并的列数。默认: 1 |
| `rowSpan` | number |  | 纵向合并的行数。默认: 1。单元格高为合并范围各行行高之和 |
| `elements` | ElementDef[] |  | 放置在单元格内的子元素数组。指定时优先于 `text`/`expression` 的绘制，并裁剪到去除内边距后的区域绘制。行高按子元素所需高度自动扩展 |

**`TableCellStyleDef`**（单元格定义及列 `style` 中使用的单元格样式）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `hAlign` | `'left'`＝左对齐 / `'center'`＝居中 / `'right'`＝右对齐 |  | 水平方向的文字对齐 |
| `vAlign` | `'top'`＝顶对齐 / `'middle'`＝居中 / `'bottom'`＝底对齐 |  | 垂直方向的文字对齐 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 文本旋转（度）。默认: 0 |
| `backcolor` | string |  | 单元格背景色 |
| `forecolor` | string |  | 文字色。默认: `#000000` |
| `fontId` | string |  | 字体 ID。默认: `'default'` |
| `fontSize` | number |  | 字号（pt）。默认: 10 |
| `bold` | boolean |  | 粗体 |
| `italic` | boolean |  | 斜体 |
| `underline` | boolean |  | 下划线 |
| `strikethrough` | boolean |  | 删除线 |
| `lineSpacing` | LineSpacingDef |  | 行距设置（参见通用属性一节的 **`LineSpacingDef`**） |
| `letterSpacing` | number |  | 字距（pt）。在所有字符之间追加固定量（负值收紧） |
| `wordSpacing` | number |  | 词距（pt。对空白字符追加的宽度） |
| `firstLineIndent` | number |  | 首行缩进（pt） |
| `leftIndent` | number |  | 左缩进（pt） |
| `rightIndent` | number |  | 右缩进（pt） |
| `wrap` | boolean |  | 文本折行。默认: true |
| `shrinkToFit` | boolean |  | 自动缩小字号以容纳于单元格 |
| `minFontSize` | number |  | `shrinkToFit` 时的最小字号（pt）。默认: 4 |
| `fitWidth` | boolean |  | 自动调整字号使最长行恰好占满单元格宽度（缩小、放大双向）。该单元格不参与行高的自动扩展 |
| `outlineText` | boolean |  | 把文本转曲（路径化）后绘制 |
| `padding` | number |  | 单元格内边距（pt）。默认: 2 |
| `border` | BorderDef |  | 单元格级的边线（参见通用属性一节的 **`BorderDef`**）。与列 `style` 的边线合并，单元格一侧的指定优先 |
| `opacity` | number |  | 不透明度（0.0〜1.0）。小于 1 时整个单元格作为不透明度组绘制 |

### 想打印交叉表 — `crosstab`

按行分组 × 列分组汇总数据。本例按「地域 × 分类」合计 `amount`，并输出小计与总计。

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

数据示例:

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

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | 元素种类 |
| `rowGroups` | { field, headerFormat? }[] | ✓ | 行分组定义的数组。指定多个即成为多层级分组，每一层从左起各占一列行表头列。外层分组的表头单元格跨其覆盖范围纵向合并 |
| `columnGroups` | { field, headerFormat? }[] | ✓ | 列分组定义的数组。外层分组在上、内层分组在下层层堆叠，外层表头跨其覆盖的列宽横向合并 |
| `measures` | { field, calculation, format? }[] | ✓ | 度量（汇总单元格）定义的数组。指定多个时在数据单元格内纵向堆叠显示，每个度量占 1 个槽位（至少 `cellHeight`）并分别套用 `calculation`/`format`。空数组时按 `field: ''`・`calculation: 'sum'` 的隐式 1 项处理 |
| `rowHeaderWidth` | number |  | 行表头宽（pt）。套用于行分组的每一层。默认: 80 |
| `columnHeaderHeight` | number |  | 列表头高（pt）。套用于列分组的每一层。默认: 20 |
| `cellWidth` | number |  | 数据单元格宽（pt）。默认: 60 |
| `cellHeight` | number |  | 数据单元格高（pt，1 个度量的槽位高）。随文本折行自动扩展。默认: 20 |
| `border` | { color?, width? } |  | 边线设置（参见下表）。仅在指定时绘制外框、行/列分隔线、表头层级分隔线（不会穿过被合并的外层表头单元格） |
| `showSubtotals` | boolean |  | 小计的显示。默认: false。为 true 时，在除最内层外的各分组块末尾插入带「Total」标签的小计行/列。小计值由原始值按各度量的 `calculation` 重新汇总 |
| `showGrandTotal` | boolean |  | 总计的显示。默认: false。为 true 时，在末尾追加带「Total」标签的总计行/列（数据为 0 条时不输出）。总计值同样由原始值重新汇总 |
| `dataSourceExpression` | Expression |  | 把求值结果的数组用作此交叉表的数据行。省略时（或求值结果不是数组时）使用主数据源的行 |

**行/列分组定义（`rowGroups`/`columnGroups` 的各元素）**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 用于分组的字段名。分组按数据中的出现顺序排列 |
| `headerFormat` | string |  | 表头值的显示格式。仅当值为数值时套用的简易格式（`'#,##0'` 或含 `,` →千位分隔显示，`'.00'` 之类的小数指定→按该位数固定小数显示，其他→原样字符串化） |

**度量定义（`measures` 的各元素）**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 汇总对象的字段名。非数值的值会被转换为数值，无法转换时按 0 处理 |
| `calculation` | `'sum'`＝合计 / `'count'`＝件数 / `'average'`＝平均 / `'min'`＝最小值 / `'max'`＝最大值 | ✓ | 汇总方法。小计、总计也由原始值集合按相同计算方法重新汇总，因此即使是 `average` 等也能得到正确的值 |
| `format` | string |  | 汇总值的显示格式（与 `headerFormat` 相同的简易格式: `'#,##0'` 或 `,` →千位分隔，`'.NN'` →固定小数 NN 位，未指定→原样字符串化） |

**边线设置（`border`）**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `color` | string |  | 线色。默认: `#000000` |
| `width` | number |  | 外框、表头/数据边界的线宽（pt）。默认: 0.5。内部的行/列分隔线以其一半的线宽绘制 |

### 想在报表中嵌入另一份报表 — `subreport`

思路已在**报表布局的基本概念**中说明。这里给出可直接运行的完整定义。父报表的每一行明细执行一次子报表，`dataSourceExpression` 传入的数组成为子报表一侧的 `rows`。

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

数据示例:

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

被嵌入一侧的 `subreport.report` 是独立的一份模板。它把接收到的 `items` 的各元素作为普通的 `field.*` 引用，并通过 `param.*` 接收父报表传来的参数。另外，作为子报表执行的模板中不会输出 `pageHeader`、`pageFooter`、`background` 带区（页面管理由父报表负责）。标题像下面这样放在 `title` 带区。

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

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | 元素种类 |
| `templateExpression` | Expression | ✓ | 返回子模板名的表达式。使用 `createReportFromFile()` 时按文件路径自动解析；直接使用 `createReport()` 时用选项 `resolveSubreportTemplate`（接收名称和工作目录、返回 `{ template, workingDirectory? }` 的函数。无法解析时返回 `null`）解析 |
| `dataSourceExpression` | Expression | | 返回子报表数据源（行对象的数组）的表达式。省略时原样使用父报表的数据源行。数组以外的结果按空数据处理 |
| `parameters` | SubreportParamDef[] |  | 传给子报表的参数（参见下表 **`SubreportParamDef`**）。优先于 `parametersMapExpression` 的同名条目 |
| `parametersMapExpression` | Expression | | 返回要合并进子参数的对象的表达式（逐项的 `parameters` 优先） |
| `returnValues` | ReturnValueDef[] |  | 把子报表的变量值返回给父报表的定义（参见下表 **`ReturnValueDef`**） |
| `usingCache` | boolean | | 在父报表的单次执行内，按模板名缓存已解析的子模板并复用 |
| `runToBottom` | boolean | | 在子报表内容之后，占满页面／栏的剩余空间（把后续元素推到剩余空间之下） |

**`SubreportParamDef`**（`parameters` 的各元素＝传给子报表的参数）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 传给子报表的参数名（子侧以 `param.名称` 引用） |
| `expression` | Expression | ✓ | 计算参数值的表达式。在父报表的上下文中求值 |

**`ReturnValueDef`**（`returnValues` 的各元素＝从子报表向父报表返回值的定义）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 父报表侧接收值的变量名。该变量被排除在父报表常规变量计算的覆盖之外 |
| `subreportVariable` | string | ✓ | 子报表侧作为来源的变量名。子报表执行完成时其值反映到父报表 |
| `calculation` | `'nothing'`＝把子报表的值原样赋入（每次执行覆盖） / `'count'`＝件数 / `'sum'`＝合计 / `'average'`＝平均 / `'min'`＝最小值 / `'max'`＝最大值 / `'first'`＝保留最先得到的值 | ✓ | 反映到父变量的方式。除 `'nothing'` 外，在子报表执行多次时进行跨次汇总 |

### 想打印条形码、二维码 — `barcode`

`barcodeType` 可以指定 Code 39/93/128、EAN、UPC、ITF、Codabar、MSI、QR Code（`qrcode`）、Data Matrix、PDF417 等。用 `showText` 并排显示供人读取的文字。

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

数据示例:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | 元素种类 |
| `barcodeType` | string | ✓ | 条形码标准（不区分大小写）。可设置值: `'code39'`＝Code 39／`'code128'`＝Code 128／`'ean13'`・`'ean-13'`＝EAN-13／`'ean8'`・`'ean-8'`＝EAN-8／`'qrcode'`・`'qr'`＝QR 码／`'datamatrix'`・`'data-matrix'`＝Data Matrix／`'pdf417'`＝PDF417／`'upca'`・`'upc-a'`＝UPC-A／`'upce'`・`'upc-e'`＝UPC-E／`'itf'`・`'interleaved2of5'`＝ITF（Interleaved 2 of 5）／`'codabar'`＝Codabar（NW-7）／`'code93'`＝Code 93／`'msi'`＝MSI。除上述以外的值按不支持处理，绘制占位图 |
| `expression` | Expression | ✓ | 返回条形码数据的表达式（求值结果字符串化后编码） |
| `showText` | boolean | | 在一维条形码下方显示人类可读文本（文本区高 10pt・字号 8pt。条码高度相应减少）。二维码（QR／Data Matrix／PDF417）中不使用 |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | QR 码的纠错级别＝码的一部分被污损、缺失时仍可读取的恢复能力。按 `'L'`→`'H'` 顺序耐受性提高，代价是图案变细密。印刷粗糙的介质推荐 `'Q'` 或 `'H'`。默认: `'M'`。仅对 QR 码有效（PDF417 的纠错级别按数据长度自动选定） |

### 想打印数学公式 — `math`

排版 LaTeX 风格的数学公式。公式排版需要内置公式专用尺寸信息（OpenType MATH 表）的专用字体（可免费获取的例子: STIX Two Math、Latin Modern Math。普通正文字体无法替代）。`formula` 作为表达式求值（本例引用数据的 `formula` 字段）。

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

数据示例:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

使用 `math` 元素时，把带 OpenType MATH 表的字体同时注册到 `fontMap` 和 PDF 输出用的 `fonts`。

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | 元素种类 |
| `formula` | Expression | ✓ | 返回 LaTeX 公式字符串的表达式（固定公式作为表达式中的字符串字面量用 `'...'` 括起来）。求值结果为空字符串时什么都不绘制 |
| `mathFontFamily` | string | | 用于公式绘制的字体（fontMap 中注册的字体 ID）。默认: 元素样式的 fontFamily，再没有则为 `'default'` |
| `fontSize` | number | | 字号（pt）。默认: 元素样式的 fontSize，再没有则为 12 |
| `color` | string | | 文字色。默认: 按元素的 forecolor → 样式的 forecolor → `#000000` 的顺序解析 |

### 想打印 SVG — `svg`

把 SVG 文档原样绘制到报表。`svgContent` 作为表达式求值（可以通过数据或参数传入固定的 SVG 字符串）。

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

数据示例:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | 元素种类 |
| `svgContent` | Expression | ✓ | 返回 SVG 标记字符串的表达式。求值结果字符串化后，按元素的位置、尺寸绘制为 SVG |

### 想制作可输入的 PDF 表单 — `formField`

放置打开 PDF 的人可以输入的表单字段。`fieldType` 可以指定 `text`、`checkbox`、`radio`、`pushbutton`、`dropdown`、`listbox`、`signature`。

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

数据示例（作为表单的初始值）:

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | 元素种类。交互式表单字段。预览类后端绘制初始外观，PDF 输出中则作为实际可输入的字段输出 |
| `fieldType` | `'text'`＝文本输入字段（PDF /Tx） / `'checkbox'`＝复选框（/Btn） / `'radio'`＝单选按钮（/Btn。`fieldName` 相同的部件互相构成一个互斥组） / `'pushbutton'`＝按钮（/Btn。标题＋可选的 URI 动作） / `'dropdown'`＝下拉框（组合框，/Ch） / `'listbox'`＝列表框（/Ch） / `'signature'`＝签名字段（/Sig） | ✓ | 字段种类 |
| `fieldName` | string | ✓ | 完全限定字段名。在文档内必须唯一（重复时抛出异常）。例外是 `radio` 通过共享同名形成一个互斥组 |
| `value` | Expression |  | 初始值（text: 输入值，dropdown/listbox: 选中值。`multiSelect` 的 listbox 以换行分隔指定多个值）。经过表达式求值。与 `valueStream` 并用会抛出异常 |
| `checked` | Expression |  | 初始勾选状态（checkbox/radio）。经过表达式求值。radio 中被勾选按钮的 `exportValue` 成为组的选中值 |
| `exportValue` | string |  | 提交、提取表单输入内容时，作为表示该复选框／单选按钮「ON」的值被记录的字符串（checkbox/radio）。默认: `'Yes'`。单选组中以该值区分各选项 |
| `options` | FormFieldOption[] |  | 选项的数组（dropdown/listbox）。参见下表 |
| `editable` | boolean |  | 在选项之外允许自由输入（让 dropdown 可作为组合框输入） |
| `multiSelect` | boolean |  | 允许多选（listbox） |
| `caption` | string |  | 按钮的标题（pushbutton） |
| `action` | string |  | 按下 pushbutton 时打开的 URI |
| `multiline` | boolean |  | 多行输入（text） |
| `readOnly` | boolean |  | 设为只读 |
| `required` | boolean |  | 设为必填 |
| `noExport` | boolean |  | 表单提交时不导出该字段的值 |
| `password` | boolean |  | 密码输入（text，输入字符隐藏显示） |
| `fileSelect` | boolean |  | 设为文件选择字段（text）。与 `multiline`/`password` 并用会抛出异常 |
| `doNotSpellCheck` | boolean |  | 停用拼写检查（text/dropdown/listbox） |
| `doNotScroll` | boolean |  | 禁止超出显示范围的输入滚动（text） |
| `comb` | boolean |  | 等宽字符格（comb）显示（text）。必须指定 `maxLength`，与 `multiline`/`password`/`fileSelect` 并用会抛出异常 |
| `richText` | string |  | 在支持的查看器中带格式（粗体、颜色等）显示的富文本值（PDF 的 /RV）。指定后字段的富文本标志被置位。与 `richTextStream` 并用会抛出异常 |
| `richTextStream` | Uint8Array |  | `richText` 的流版本。用于 PDF 导入时原 PDF 的 /RV 为流的场合的字节保全，手写模板通常使用 `richText`。与 `richText` 并用会抛出异常 |
| `defaultStyle` | string |  | 富文本的默认样式（PDF 的 /DS）。CSS 风格的格式指定字符串（例: `font: Helvetica 12pt`），作为 `richText` 一侧未指定部分的默认值 |
| `valueStream` | Uint8Array |  | 用于 PDF 导入的保全。原 PDF 的字段值（/V）不是字符串而是流对象时，无损重新输出其字节序列。手写模板通常使用 `value`。与 `value` 并用会抛出异常 |
| `defaultValue` | string |  | 表单重置时恢复的默认值（/DV） |
| `sort` | boolean |  | 对选项排序显示（dropdown/listbox） |
| `commitOnSelectionChange` | boolean |  | 选择变化时立即确定值（dropdown/listbox） |
| `radiosInUnison` | boolean |  | 让组内持有相同 `exportValue` 的单选按钮联动 ON/OFF |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | 给字段附加在 PDF 查看器（Acrobat 等）上运行的输入脚本。K＝每次输入时（例: 去除非数字）、F＝显示整形（例: 按 2 位小数显示）、V＝值校验（例: 拒绝负数）、C＝重算（例: 由其他字段的值自动计算）。内容通常是 `subtype: 'JavaScript'` 的 `PdfActionDef`（后述）。核心引擎只把脚本嵌入 PDF 而不执行。单选组中若全部部件的定义不一致则抛出异常 |
| `calculationOrder` | number |  | 有多个字段持有 `'C'`（重算）动作时，查看器按什么顺序重算（PDF 的 /CO）。按 0 以上整数的升序。重复、负值、非整数会抛出异常 |
| `maxLength` | number |  | 最大输入字符数（text） |
| `borderColor` | string |  | 边框色（`#RRGGBB`）。省略时无边框。radio 绘制为圆形、其余为矩形边框，线宽 1pt |
| `backgroundColor` | string |  | 背景色（`#RRGGBB`）。省略时透明。radio 填充为圆形、其余为矩形 |

**`FormFieldOption`**（`options` 的各元素＝选项定义）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `value` | string | ✓ | 存入字段值（/V）的导出值 |
| `label` | string |  | 显示标签。默认: 与 `value` 相同 |

※ 此外还可指定全元素通用属性和 `TextProperties` 的全部属性（套用于输入文本的字体、对齐等）。

### 想在任意位置分页、换栏 — `break`

在明细流的中途，强制切换页面（`"breakType": "page"`）或栏（`"column"`）。直接放在带区之下，不能放进 `frame` 里。

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**属性一览**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | 元素种类 |
| `breakType` | `'page'` \| `'column'` | ✓ | 分页种类。在元素的 y 位置切分带区，`'page'`＝送往下一页／`'column'`＝多栏构成（模板的 `columns.count` 为 2 以上。参见「报表布局的基本概念」）且不在最后一栏时送往下一栏（其余情况按分页动作） |

### 想仅在满足条件时打印元素 — `printWhenExpression`

`printWhenExpression` 不是某种特定元素，而是**全元素通用的属性**。只在表达式求值为 truthy 的行打印该元素。下面的例子只在 `urgent` 为 `true` 的明细行打印「※ 至急」。

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

数据示例（只在第 1 行打印）:

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

带区上也可指定同名的 `printWhenExpression`，把整个带区的输出抑制掉（例: 只在 `param.showNotes` 时输出备注带区）。用 TypeScript 定义模板时，还可以用元素的 `onBeforeRender` 回调做更精细的控制——返回 `null` 则跳过该元素的打印，返回 `ElementDef` 则当场覆盖字符串、尺寸、颜色等属性后打印。

## 元素属性参考

各元素示例所附的「属性一览」是该元素独有的属性。此外任何元素都可以指定位置、尺寸、打印条件、颜色等通用属性。这里汇总全元素通用的属性，以及在模板 `styles` 中定义的样式属性。

### 全元素通用的属性

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string |  | 供 `findElementById()` 在绘制前获取、修改元素的标识符。不影响打印内容本身。作为修改目标使用的 ID 要在模板内保持唯一（重复时按搜索顺序返回第一个元素） |
| `x` | number | ✓ | 在父带区／容器内的 X 坐标（pt） |
| `y` | number | ✓ | 在父带区／容器内的 Y 坐标（pt） |
| `width` | number | ✓ | 宽（pt） |
| `height` | number | ✓ | 高（pt） |
| `style` | string |  | 要套用的样式名（引用 `styles` 中定义的 `StyleDef` 的 `name`。未指定时套用 `isDefault` 的样式） |
| `positionType` | `'float'`＝随位于自身上方的元素的伸展量向下移动 / `'fixRelativeToTop'`＝固定与带区上端的位置（默认） / `'fixRelativeToBottom'`＝维持与带区下端的距离（随带区伸展量向下移动） |  | 带区伸展时的定位规则。默认: `fixRelativeToTop` |
| `stretchType` | `'noStretch'`＝不伸展（默认） / `'containerHeight'`＝让元素高度与带区的实际高度一致 / `'containerBottom'`＝把元素下端伸展到带区的实际下端（只改变高度） |  | 带区伸展时元素的伸展规则。默认: `noStretch` |
| `printWhenExpression` | Expression \| null |  | 求值结果为假时不打印该元素 |
| `onBeforeRender` | OnBeforeRenderCallback |  | 渲染前一刻被调用的回调 `(elem, field, vars, param, report) => ElementDef \| null`。返回 `null` 则跳过打印（`printWhenExpression` 的上位替代），返回 `ElementDef` 则按该定义绘制（任意属性的动态覆盖）。求值顺序: `onBeforeRender` → `printWhenExpression`（对覆盖后的定义求值） → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | 元素未被打印时，若该元素占据的垂直条带上没有其他打印元素重叠，则移除该条带，把下方元素上移并收缩带区 |
| `isPrintRepeatedValues` | boolean |  | 指定 `false` 时，与上一次相同的值（textField）不再打印（抑止时，若 `isRemoveLineWhenBlank` 为真则按高度 0 处理） |
| `isPrintWhenDetailOverflows` | boolean |  | 在带区溢出后的各页／各栏片段中重新打印该元素 |
| `mode` | `'opaque'`＝用 `backcolor` 涂背景 / `'transparent'`＝不涂背景 |  | 显示模式。默认: `transparent`（按元素→样式的顺序解析） |
| `forecolor` | string |  | 前景色（`#RRGGBB` 或 `#RRGGBBAA`） |
| `backcolor` | string |  | 背景色（`mode` 为 `opaque` 时绘制） |
| `border` | BorderDef |  | 边框（参见后述的 **`BorderDef`**）。line/rectangle/ellipse/path 元素不绘制边框（无论来自样式还是元素直接指定。这些元素用自己的 `stroke` 等指定线） |
| `padding` | Padding |  | 内边距（参见后述的 **`Padding`**） |
| `blendMode` | BlendModeDef |  | 该元素的颜色与已绘制的下层内容如何合成（参见后述的 **`BlendModeDef`**）。典型例: 给印章、图章图像指定 `'multiply'`，即可不遮挡下层文字、以透叠状态重叠 |
| `overprintFill` | boolean |  | 面向商业印刷制版。指定填充（文字、图形的面）不抹掉下层色版、叠加印刷（叠印） |
| `overprintStroke` | boolean |  | 面向商业印刷制版。线（描边）的叠印指定 |
| `overprintMode` | 0 \| 1 |  | 启用 `overprintFill`/`overprintStroke` 时行为的选择（PDF /OPM）。`0`＝所有颜色分量都覆盖下层颜色（默认） / `1`＝值为 0 的颜色分量保留下层颜色 |
| `renderingIntent` | `'AbsoluteColorimetric'`＝测色意义上忠实 / `'RelativeColorimetric'`＝对齐白点后忠实 / `'Saturation'`＝鲜艳度优先 / `'Perceptual'`＝观感自然度优先 |  | 对超出输出设备色域的颜色如何转换的优先方针（PDF 渲染意图）。面向商业印刷、色彩管理，通常无需指定 |
| `alphaIsShape` | boolean |  | PDF 透明合成的细节控制（把不透明度、遮罩解释为「形状」的 /AIS）。通常无需指定，主要用于 PDF 导入的忠实重新输出 |
| `textKnockout` | boolean |  | 半透明文字互相重叠时，同一文本内不对重叠做二次合成（PDF /TK）。默认: `true`。通常无需指定 |
| `optionalContent` | OptionalContentDef |  | 把该元素载入 PDF 的「图层」。可在查看器的图层面板切换显示/隐藏、是否打印（例: 水印在屏幕显示、打印时消失）。参见后述的 **`OptionalContentDef`** |
| `opacity` | number |  | 元素的不透明度（0.0〜1.0）。持有子元素时作为组合成后再套用 |

**`BlendModeDef`**（`blendMode` 可指定的合成模式）

元素通常直接覆盖下层的绘制结果（`'normal'`）。指定混合模式后，上下两层的颜色通过计算合成。报表中的典型用法是把印章、公司章叠在文字之上（`'multiply'`），或在深色背景上做出反白风格的效果（`'screen'`）。

| 常量 | 效果 |
| --- | --- |
| `'normal'` | 不合成，用上层颜色绘制（相当于默认） |
| `'multiply'` | 正片叠底。重叠处必然变暗。适合印章、图章、荧光笔风格的叠涂 |
| `'screen'` | 滤色。重叠处必然变亮 |
| `'overlay'` | 底色暗则正片叠底、亮则滤色。对比度被强调 |
| `'darken'` | 取上下两层中较暗的颜色 |
| `'lighten'` | 取上下两层中较亮的颜色 |
| `'color-dodge'` | 按上层颜色把底色提亮冲淡 |
| `'color-burn'` | 按上层颜色把底色加深烧暗 |
| `'hard-light'` | 按上层颜色的明暗切换正片叠底／滤色（强烈的照明效果） |
| `'soft-light'` | `'hard-light'` 的弱化版（柔和的照明效果） |
| `'difference'` | 上下两层颜色之差的绝对值 |
| `'exclusion'` | `'difference'` 的低对比度版 |
| `'hue'` | 上层的色相＋下层的饱和度、明度 |
| `'saturation'` | 上层的饱和度＋下层的色相、明度 |
| `'color'` | 上层的色相、饱和度＋下层的明度（适合给单色底稿上色） |
| `'luminosity'` | 上层的明度＋下层的色相、饱和度 |

**`Expression`**（详见「用好表达式（Expression）」）
| 形式 | 说明 |
| --- | --- |
| string | 表达式迷你语言。例: `'field.customer.name'`、`'field.price * field.quantity'`、`` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``、`'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | TypeScript 函数 `(field, vars, param, report) => unknown`。`report`（ReportContext）持有 `PAGE_NUMBER`（当前页码・从 1 开始）、`COLUMN_NUMBER`（当前栏号・从 1 开始）、`REPORT_COUNT`（已处理记录数）、`TOTAL_PAGES`（总页数。在 evaluationTime=report 时定格）、`RETURN_VALUE`（类型定义上存在但当前实现始终为 undefined——子报表的返回值通过 `vars.*` 接收）、`format`（内置格式化函数）、`formatters`（模板注册的自定义格式化器） |

**`BorderDef`**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `width` | number |  | 线宽（pt）。四边共用的默认值 |
| `color` | string |  | 线色。四边共用的默认值 |
| `style` | `'solid'`＝实线 / `'dashed'`＝虚线 / `'dotted'`＝点线 |  | 线型。四边共用的默认值 |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | 按边的单独指定（参见后述的 **`BorderSideDef`**）。优先于四边共用的指定，`null` 表示隐藏该边 |

**`BorderSideDef`**（在 `BorderDef` 的 `top`/`bottom`/`left`/`right` 中使用）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 线宽（pt） |
| `color` | string | ✓ | 线色 |
| `style` | `'solid'`＝实线 / `'dashed'`＝虚线 / `'dotted'`＝点线 | ✓ | 线型 |

**`Padding`**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | 各边的内边距（pt） |

**`HyperlinkDef`**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'reference'`＝外部 URL / `'localAnchor'`＝到同一文档内的锚点 / `'localPage'`＝到同一文档内的页码 / `'remoteAnchor'`＝到另一份 PDF 文档的锚点 / `'remotePage'`＝到另一份 PDF 文档的页面 | ✓ | 链接种类 |
| `target` | Expression | ✓ | 链接目标（URL、锚点名或页码的表达式） |
| `remoteDocument` | Expression |  | 远程 PDF 文件路径（供 remotePage / remoteAnchor 使用） |

**`TextProperties`**（staticText / textField / formField 持有的文本、段落属性）
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `markup` | `'none'`＝纯文本 / `'styled'`＝带样式标记（`<style forecolor=... isBold=...>`、`<b>`/`<i>`/`<u>` 等） / `'html'`＝HTML 子集（`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`） |  | 标记种类 |
| `hAlign` | `'left'`＝左对齐 / `'center'`＝居中 / `'right'`＝右对齐 / `'justify'`＝两端对齐 |  | 水平方向的对齐 |
| `vAlign` | `'top'`＝顶对齐 / `'middle'`＝居中 / `'bottom'`＝底对齐 |  | 垂直方向的对齐 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 文本旋转（度） |
| `lineSpacing` | LineSpacingDef |  | 行距设置（参见后述的 **`LineSpacingDef`**） |
| `letterSpacing` | number |  | 字距（pt）。在所有字符之间追加固定量（负值收紧） |
| `tracking` | number |  | 字距调整的一种。相对于 `letterSpacing` 一律加上固定量，此项使用字体自身内置的字距调整表（AAT `trak` 表），按字号以设计值增减字距。数值是调整表的「track 值」，0＝标准、负＝收紧、正＝放宽（中间值做插值）。不含 `trak` 表的字体无效果 |
| `wordSpacing` | number |  | 词距（pt。对空白字符追加的宽度） |
| `horizontalScale` | number |  | 把字形横向伸缩的倍率（小于 1＝收窄的长体，大于 1＝加宽的平体）。折行、行进按伸缩后的宽度计算。默认: 1 |
| `baselineOffset` | number |  | 以距元素上端的 pt 显式指定基线（文字所落基准线）的位置。通常自动计算无需指定（主要供 PDF 导入再现原有文字位置） |
| `firstLineIndent` | number |  | 首行缩进（pt） |
| `leftIndent` | number |  | 左缩进（pt） |
| `rightIndent` | number |  | 右缩进（pt） |
| `padding` | Padding |  | 内边距 |
| `direction` | `'ltr'`＝左→右 / `'rtl'`＝右→左 / `'auto'`＝由内容自动判定（双向文本分析） |  | 文本方向 |
| `openTypeScript` | string |  | 指定把字符串转换为字形（整形）时使用字体中面向哪种文字体系的规则的 OpenType 标签（例: `'latn'`＝拉丁文字、`'arab'`＝阿拉伯文字）。通常无需指定（按文字内容自动处理） |
| `openTypeLanguage` | string |  | 对同一文字体系也按语言切换字形的字体，用于显式指明语言的 OpenType 标签。通常无需指定 |
| `openTypeFeatures` | Record<string, number> |  | 字体内置字形切换特性（feature）的 ON/OFF。例: `{ "palt": 1 }`＝收紧日文字距、`{ "liga": 0 }`＝停用连字、`{ "zero": 1 }`＝带斜线的零。值 0＝停用／1＝启用，字形选择型特性中为从 1 开始的替代字形号 |
| `shrinkToFit` | boolean |  | 自动缩小: 缩小字号以容纳于元素的宽、高 |
| `minFontSize` | number |  | `shrinkToFit` 时的最小字号（pt）。默认: 4 |
| `fitWidth` | boolean |  | 自动调整字号使最长行恰好占满元素的内容宽度（缩小、放大双向） |
| `outlineText` | boolean |  | 把文本转曲（路径转换）。默认: `false` |
| `pdfFontMode` | `'embedded'`＝嵌入字体程序 / `'reference'`＝不嵌入、输出系统字体引用 |  | PDF 字体程序的处理 |
| `textPaintMode` | `'fill'`＝填充 / `'stroke'`＝仅描边 / `'fillStroke'`＝填充＋描边 |  | PDF 导入时保持的文本绘制语义。默认: `fill` |
| `textStrokeColor` | string |  | stroke / fillStroke 时的描边色 |
| `textStrokeWidth` | number |  | 文本的轮廓线宽（pt） |
| `tabStops` | TabStopDef[] |  | 制表位定义（参见后述的 **`TabStopDef`**） |
| `tabStopWidth` | number |  | 默认的制表间隔（pt）。未指定时为 40pt |
| `wrap` | boolean |  | 文本折行。默认: `true`（undefined 视为启用折行） |

**`LineSpacingDef`**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'single'`＝1 行 / `'1.5'`＝1.5 行 / `'double'`＝2 行 / `'proportional'`＝按倍率 / `'fixed'`＝固定值 / `'minimum'`＝最小值 | ✓ | 行距的种类 |
| `value` | number |  | fixed / minimum / proportional 时的值 |

**`TabStopDef`**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `position` | number | ✓ | 制表位位置（pt） |
| `alignment` | `'left'` / `'center'` / `'right'` |  | 制表对齐。默认: `left` |

**`FillDef`**（可指定给 `path` 的填充（`fill`）、描边（`stroke`）以及 `rectangle`/`ellipse` 的填充（`fill`）的类型的并集。`rectangle`/`ellipse` 的 `stroke` 仅限单色字符串）
| 形式 | 说明 |
| --- | --- |
| string | 单色（`#RRGGBB` 或 `#RRGGBBAA`） |
| PdfSpecialColorDef | 专色（Separation／DeviceN）。金、银、企业色等特定油墨的颜色指定（参见后述的表） |
| LinearGradientDef | 线性渐变——沿连接两点的轴变化颜色（参见后述的表） |
| RadialGradientDef | 径向渐变——从中心向外变化颜色（参见后述的表） |
| MeshGradientDef | 网格渐变——沿自由形状变化颜色（参见后述的表） |
| TilingPatternDef | 平铺图案——用小图样铺满填充（参见后述的表） |
| FunctionShadingDef | 函数着色——用计算式由坐标决定颜色（参见后述的表） |

**`GradientStopDef`**（渐变的颜色切换点。在各渐变的 `stops` 中使用）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `offset` | number | ✓ | 沿渐变轴的位置。0〜1 的比率（0＝起点，1＝终点） |
| `color` | string | ✓ | 该位置的颜色（`#RRGGBB`） |
| `opacity` | number |  | 该位置的不透明度（0〜1）。默认: 1 |

**`LinearGradientDef`**（线性渐变——沿连接两点的轴变化颜色的填充）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | 表明是线性渐变的判别符 |
| `x1` | number |  | 起点的 X 坐标。**相对元素边界框宽度的比率**（0＝左端，1＝右端）。默认: 0 |
| `y1` | number |  | 起点的 Y 坐标。**相对元素边界框高度的比率**（0＝上端，1＝下端）。默认: 0 |
| `x2` | number |  | 终点的 X 坐标（相对宽度的比率）。默认: 1（保持默认值即为从左到右的水平渐变） |
| `y2` | number |  | 终点的 Y 坐标（相对高度的比率）。默认: 0 |
| `stops` | GradientStopDef[] | ✓ | 颜色切换点的数组（参见上表） |
| `spreadMethod` | `'pad'`＝用端点颜色填满 / `'reflect'`＝往复反转地重复 / `'repeat'`＝原样重复 |  | 渐变范围之外的填充方式。默认: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | 用于把 PDF 导入的渐变无损重新输出的保全元数据。手写模板无需指定 |

**`RadialGradientDef`**（径向渐变——从中心向外变化颜色的填充）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | 表明是径向渐变的判别符 |
| `cx` | number |  | 外圆的中心 X 坐标（相对元素边界框宽度的比率）。默认: 0.5 |
| `cy` | number |  | 外圆的中心 Y 坐标（相对高度的比率）。默认: 0.5 |
| `r` | number |  | 外圆的半径。**相对宽、高中较大一方的比率**。默认: 0.5 |
| `fx` | number |  | 焦点（渐变开始的点）的 X 坐标（相对宽度的比率）。默认: `cx` |
| `fy` | number |  | 焦点的 Y 坐标（相对高度的比率）。默认: `cy` |
| `fr` | number |  | 焦点圆的半径（相对宽、高中较大一方的比率）。默认: 0 |
| `stops` | GradientStopDef[] | ✓ | 颜色切换点的数组 |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | 范围外的填充方式（与 `LinearGradientDef` 相同）。默认: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | PDF 导入无损重新输出用的元数据。手写模板无需指定 |

**`MeshGradientDef`**（网格渐变——给格子或三角形的每个顶点赋色、沿自由形状变化颜色的填充）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | 表明是网格渐变的判别符 |
| `patches` | MeshPatchDef[] |  | 曲面补片的数组。每个补片持有 `points`（4×4 控制点网，以 x,y 顺序的 32 个数值表示。**坐标为元素局部 pt**）和 `colors`（4 个角的颜色） |
| `triangles` | MeshTriangleDef[] |  | 渐变三角形的数组。每个三角形持有 `points`（x0,y0,x1,y1,x2,y2。元素局部 pt）和 `colors`（3 个顶点的颜色），颜色在顶点间插值 |
| `lattice` | MeshLatticeDef |  | 格子形式的网格。持有 `columns`（每行的顶点数，2 以上）、`points`（顶点坐标序列。元素局部 pt）、`colors`（每个顶点的颜色，与 `points` 同序） |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | PDF 导入的原生网格数据的紧凑表示。手写模板无需指定 |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | 同上的渐变三角形版 |
| `pdfShading` | PdfMeshShadingDef |  | PDF 导入无损重新输出用的元数据。手写模板无需指定 |

**`TilingPatternDef`**（平铺图案——用小图样铺满填充。适合网底、棋盘格、Logo 的重复等）

表中的「图案空间」是图案专用的坐标系。若不指定 `matrix`，它与元素局部的 pt 坐标一致。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | 表明是平铺图案的判别符 |
| `bbox` | [number, number, number, number] | ✓ | 一份图样（图案单元）的边界框（图案空间的坐标） |
| `xStep` | number | ✓ | 单元在水平方向的重复间隔（图案空间） |
| `yStep` | number | ✓ | 单元在垂直方向的重复间隔（图案空间） |
| `graphics` | TileGraphicDef[] | ✓ | 单元内绘制的图形的数组。以 `kind` 判别: `'path'`（SVG 路径数据＋填充、线）／`'image'`（以 `source` 引用图像资源 ID）／`'text'`（指定字体、尺寸、颜色的文本）／`'group'`（带变换、裁剪、不透明度等的嵌套组）。坐标均为图案空间 |
| `tilingType` | 1＝恒定间隔（允许为适配绘制设备把单元略微变形） \| 2＝无变形（间隔可能略有波动） \| 3＝恒定间隔且快速平铺 |  | 铺排的精度模式。默认: 1 |
| `paintType` | `'colored'`＝图案自身带颜色 / `'uncolored'`＝用使用侧的 `color` 单色着色 |  | 颜色的持有方式。默认: `'colored'` |
| `color` | string |  | 使用 `'uncolored'` 图案时的着色颜色 |
| `matrix` | [number, number, number, number, number, number] |  | 从图案空间到元素局部空间的仿射变换矩阵。默认: 单位矩阵 |

**`FunctionShadingDef`**（函数着色——用计算式由坐标 (x, y) 决定颜色的填充。主要出现在 PDF 导入中）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | 表明是函数着色的判别符。有持 `expression` 的计算式形式和持 `sampled` 的采样形式两个变体 |
| `domain` | [number, number, number, number] | ✓ | `[x0, x1, y0, y1]` 的输入区域 |
| `expression` | string | ✓（仅计算式形式） | PostScript 计算式（PDF FunctionType 4）。接收 x, y 返回 r, g, b。例: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓（仅采样形式） | 已采样的函数数据（PDF FunctionType 0）。持有 `size`（采样格子的尺寸）、`bitsPerSample`（1/2/4/8/12/16/24/32）、`range`（输出范围）、`samples`（每个格点的采样值）、可选的 `encode`／`decode` |
| `matrix` | [number, number, number, number, number, number] |  | 从输入区域到**元素局部 pt**的映射矩阵。默认: 单位矩阵 |
| `background` | [number, number, number] |  | 区域外的背景色（DeviceRGB 分量，0〜1） |
| `bbox` | [number, number, number, number] |  | 限制绘制的边界框 |
| `antiAlias` | boolean |  | 抗锯齿提示 |
| `paintOperator` | `'pattern'`＝作为图案填充（默认） / `'sh'`＝在当前裁剪下直接绘制 |  | PDF 输出时的绘制方式 |

**`PdfSpecialColorDef`**（专色填充——金、银、企业色等，用于以普通 CMYK 叠印无法再现的特定油墨印刷的颜色指定）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | 表明是专色填充的判别符 |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | 专色的色彩空间。单一油墨为 `kind: 'separation'`，持有 `name`（油墨名）・`alternate`（在不支持专色油墨的环境中代用的印刷原色色彩空间・参见下表）・`tintTransform`（以 PDF 函数指定浓度→替代色的转换。例: `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }`＝浓度 0 为白、1 为蓝）。多油墨为 `kind: 'deviceN'`，持有 `names`（油墨名的数组）・`alternate`・`tintTransform`・`subtype`（`'DeviceN'`＝标准／`'NChannel'`＝可追加每种油墨属性信息的扩展形式）・`colorants`（各油墨名→单一油墨定义的对应表）・`process`・`mixingHints` |
| `components` | number[] | ✓ | 各油墨的浓度值（0〜1） |
| `displayColor` | string | ✓ | 在没有专色油墨的屏幕显示、预览中代用的颜色 |

**`PdfProcessColorSpaceDef`**（印刷原色色彩空间＝以 CMYK 等标准油墨叠印表示的「普通颜色」的色彩空间。用于专色的 `alternate` 和软遮罩的 `colorSpace`，以 `kind` 判别）

| 变体（`kind`） | 追加属性 | 说明 |
| --- | --- | --- |
| `'gray'` | 无 | 灰度（DeviceGray） |
| `'rgb'` | 无 | RGB（DeviceRGB） |
| `'cmyk'` | 无 | CMYK（DeviceCMYK） |
| `'calgray'` | `whitePoint`・`blackPoint`・`gamma`（全部必需） | 经测色校准的灰（CalGray） |
| `'calrgb'` | `whitePoint`・`blackPoint`・`gamma`（按分量）・`matrix`（3×3）（全部必需） | 经测色校准的 RGB（CalRGB） |
| `'lab'` | `whitePoint`・`blackPoint`・`range`（全部必需） | L\*a\*b\* 色彩空间 |
| `'icc'` | `components`（1\|3\|4）・`range`・`profile`（ICC 配置文件的字节序列）（全部必需） | 基于 ICC 配置文件的色彩空间 |

`whitePoint`／`blackPoint` 以 CIE XYZ 色彩空间的 `[x, y, z]` 数组指定。

### 带区（`bands`）与分组（`groups`）的属性

模板 `bands` 中指定的 10 种带区（参见「页面是「带区」的层层堆叠」）都用下面的 `BandDef` 定义（仅 `details` 是 `BandDef` 的数组）。

**`BandDef`**

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 带区的最小高度（pt）。随元素的伸展而变高 |
| `elements` | ElementDef[] |  | 放置在带区中的元素 |
| `startNewPage` | boolean |  | 该带区必须从新的一页开始 |
| `spacingBefore` | number |  | 带区之前的间隔（pt） |
| `spacingAfter` | number |  | 带区之后的间隔（pt） |
| `splitType` | `'stretch'`＝打印页面容纳得下的部分，其余延续到下一页（默认） / `'prevent'`＝不分割，把整个带区送往下一页（连新的一页也容纳不下时才分割） / `'immediate'`＝即使在元素中途也在当前位置立即分割 |  | 带区在页面边界容纳不下时的分割方式 |
| `printWhenExpression` | Expression \| null |  | 求值结果为假时，不输出该带区 |

**`GroupDef`**（`groups` 的各元素）

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 分组名。被变量的 `resetGroup` 和 textField 的 `evaluationGroup` 引用 |
| `expression` | Expression | ✓ | 分组判定键。逐行求值，在值发生变化的位置关闭上一分组、开始新分组 |
| `header` | BandDef |  | 在分组开头输出的带区 |
| `footer` | BandDef |  | 在分组末尾输出的带区 |
| `keepTogether` | boolean |  | 整个分组在剩余空间容纳不下、而在新的一页可以容纳时，先分页再开始 |
| `minHeightToStartNewPage` | number |  | 页面剩余高度低于该值（pt）时，让分组从新的一页开始 |
| `reprintHeaderOnEachPage` | boolean |  | 分组跨越多页时，在后续每一页重新打印分组页眉 |
| `resetPageNumber` | boolean |  | 分组开始时把 `PAGE_NUMBER` 重置为 1 |
| `startNewPage` | boolean |  | 每个分组从新的一页开始 |
| `startNewColumn` | boolean |  | 每个分组从新的一栏开始 |
| `footerPosition` | `'normal'`＝紧跟明细之后输出（默认） / `'stackAtBottom'`＝靠向页面下部堆放 / `'forceAtBottom'`＝始终置于页面最下部，消耗中间的剩余空间 / `'collateAtBottom'`＝仅当其他分组的页脚靠下时才一起排到下部（单独时与 `'normal'` 相同） |  | 分组页脚的纵向位置 |

### 样式（`styles`）中可指定的属性

在模板的 `styles` 数组中定义，从元素的 `style` 属性以 `name` 引用。字体、文字对齐、颜色等文字方面的指定主要通过样式进行。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 样式名（从元素的 `style` 引用） |
| `parentStyle` | string |  | 父样式名。继承父样式的属性，并以自身的指定覆盖（循环引用被忽略） |
| `isDefault` | boolean |  | 为 `true` 的样式，作为默认套用于未指定 `style` 的元素 |
| `fontFamily` | string |  | 字体家族。默认: `'default'` |
| `fontSize` | number |  | 字号（pt）。默认: 10 |
| `bold` | boolean |  | 粗体。默认: `false` |
| `italic` | boolean |  | 斜体。默认: `false` |
| `underline` | boolean |  | 下划线。默认: `false` |
| `strikethrough` | boolean |  | 删除线。默认: `false` |
| `forecolor` | string |  | 前景色（`#RRGGBB` 或 `#RRGGBBAA`）。默认: `#000000` |
| `backcolor` | string |  | 背景色。默认: `transparent` |
| `hAlign` | `'left'`＝左对齐 / `'center'`＝居中 / `'right'`＝右对齐 / `'justify'`＝两端对齐 |  | 水平方向的对齐。默认: `left` |
| `vAlign` | `'top'`＝顶对齐 / `'middle'`＝居中 / `'bottom'`＝底对齐 |  | 垂直方向的对齐。默认: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 文本旋转（度） |
| `padding` | Padding |  | 内边距 |
| `border` | BorderDef |  | 边框 |
| `mode` | `'opaque'`＝用 `backcolor` 涂背景 / `'transparent'`＝不涂背景 |  | 显示模式 |
| `opacity` | number |  | 不透明度（0.0〜1.0） |
| `variation` | Record<string, number> |  | 可变字体（Variable Font）的轴值（例: `{ wght: 700, wdth: 75 }`） |
| `writingMode` | `'horizontal-tb'`＝横排 / `'vertical-rl'`＝竖排・行从右向左推进 / `'vertical-lr'`＝竖排・行从左向右推进 |  | 书写方向 |
| `conditionalStyles` | ConditionalStyleDef[] |  | 条件样式（参见下表）。条件成立时覆盖相应属性 |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | 文本方向（ltr＝左→右 / rtl＝右→左 / auto＝由内容自动判定） |
| `openTypeScript` | string |  | 指定把字符串转换为字形（整形）时使用字体中面向哪种文字体系的规则的 OpenType 标签（例: `'latn'`＝拉丁文字、`'arab'`＝阿拉伯文字）。通常无需指定（按文字内容自动处理） |
| `openTypeLanguage` | string |  | 对同一文字体系也按语言切换字形的字体，用于显式指明语言的 OpenType 标签。通常无需指定 |
| `openTypeFeatures` | Record<string, number> |  | 字体内置字形切换特性（feature）的 ON/OFF。例: `{ "palt": 1 }`＝收紧日文字距、`{ "liga": 0 }`＝停用连字、`{ "zero": 1 }`＝带斜线的零。值 0＝停用／1＝启用，字形选择型特性中为从 1 开始的替代字形号 |

**`ConditionalStyleDef`**
| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | 套用条件。为真时以下列属性覆盖 |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | 与 StyleDef 同名属性同型 |  | 条件成立时被覆盖的值（含义与 StyleDef 的各属性相同） |
| `underline` / `strikethrough` / `vAlign` / `opacity` | 与 StyleDef 同名属性同型 |  | 类型定义上有声明，但当前实现不套用条件成立时的覆盖 |

### PDF 导入・高级 PDF 功能的类型

这里列出的类型用于两个目的: (1) 把导入既有 PDF 的结果一个字节不损地重新输出的「保全用」，(2) 使用 PDF 图层、表单脚本、商业印刷制版指定等高级功能。手写普通报表时几乎不会指定。标注「由 PDF 导入设置」的类型会出现在 `importPdfPage()` 生成的元素中。

**`OptionalContentDef`**（PDF 的图层功能）

PDF 具备把内容载入「图层」（可选内容组，OCG）、从查看器的图层面板切换显示/隐藏、打印/不打印的功能。在元素的 `optionalContent` 中指定它，该元素就会载入图层。例: 把「公司机密」水印做成图层，只在打印时出现。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 显示在查看器图层面板中的图层名 |
| `visible` | boolean |  | 屏幕显示的初始状态。默认: true |
| `print` | boolean |  | 打印的初始状态。默认: 跟随 `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | 由 PDF 导入设置。保全原 PDF 的图层定义（OCG）或由多个图层的组合决定可见性的成员关系定义（OCMD）。成员关系持有 `groups`（对象图层）和 `policy`（`'AllOn'`＝全部 ON 时可见 / `'AnyOn'`＝任一 ON / `'AnyOff'`＝任一 OFF / `'AllOff'`＝全部 OFF），以及可选的可见性逻辑表达式 `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | 由 PDF 导入设置。保全整个文档的图层构成（全部图层的一览、默认配置、图层面板的显示顺序树、互斥选择组、锁定等） |

**`PdfRawValueDef`**（PDF 的「原始值」）

许多保全用属性以「原始值」持有 PDF 内部数据，不做解释、原样携带。原始值是如下形式的 JavaScript 值: `null`、布尔值、数值原样保留，PDF 的名称为 `{ kind: 'name', value: 'DeviceRGB' }`，字符串为 `{ kind: 'string', bytes: Uint8Array }`，数组为 `{ kind: 'array', items: [...] }`，字典为 `{ kind: 'dictionary', entries: { ... } }`，流为 `{ kind: 'stream', entries: { ... }, data: Uint8Array }`。

**`PdfActionDef`**（PDF 查看器执行的动作）

在表单字段的 `additionalActions` 等处使用、「让查看器做什么」的定义。内容只被序列化、导入，**核心引擎绝不执行**（执行者是支持它的 PDF 查看器）。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | 动作的种类。`'JavaScript'`＝执行脚本（表单的输入整形、校验、自动计算用它）／`'GoTo'`＝文档内跳转／`'GoToR'`＝跳转到另一文档／`'GoToE'`＝跳转到嵌入文档／`'URI'`＝打开 URL／`'Launch'`＝启动应用、文件／`'Named'`＝预定义命令（下一页等）／`'SubmitForm'`＝表单提交／`'ResetForm'`＝表单重置／`'ImportData'`＝数据导入／`'Hide'`＝切换注释显示／`'SetOCGState'`＝切换图层显示／`'Thread'`・`'Sound'`・`'Movie'`・`'Rendition'`・`'Trans'`・`'GoTo3DView'`・`'RichMediaExecute'`・`'GoToDp'`＝其他 PDF 标准动作 |
| `entries` | Record<string, PdfRawValueDef> | ✓ | 按种类以原始值（上述 **`PdfRawValueDef`**）持有各设置值的字典。例: `'JavaScript'` 时为 `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | `'GoTo'` 系的跳转目标。具名（`{ kind: 'named', name, representation: 'name' \| 'string' }`）或显式指定（目标页面＋显示倍率的对齐方式） |
| `structureDestination` | PdfStructureDestinationDef |  | 以文档结构元素为基准的跳转目标（PDF 2.0） |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | 媒体类动作所针对的注释的指定 |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | `'SetOCGState'` 切换的图层及操作（`'ON'`／`'OFF'`／`'Toggle'`）的序列 |
| `fieldTargets` | PdfActionFieldTargetsDef |  | `'Hide'`／`'SubmitForm'`／`'ResetForm'` 所针对的字段名的指定 |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | `'GoToE'` 的嵌入文件指定（递归结构） |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | `'Launch'` 的按平台参数。仅保持不执行 |
| `articleTarget` | PdfArticleActionTargetDef |  | `'Thread'` 的文章线程指定 |
| `documentPartIndex` | number |  | `'GoToDp'` 的目标文档部件号 |
| `richMediaInstanceIndex` | number |  | 富媒体的实例号 |
| `next` | PdfActionDef \| PdfActionDef[] |  | 接续执行的动作（链式） |

**`PdfFormXObjectDef`**（导入的 PDF 部件的元数据保全）

在 PDF 内部，可以把反复使用的绘制内容归纳为称作「Form XObject」的部件。PDF 导入把该部件转换为 `frame` 元素，用此类型保持部件持有的坐标系、元数据，并在重新输出时复原。手写模板无需指定。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | 部件的边界框（/BBox） |
| `matrix` | [number, number, number, number, number, number] | ✓ | 部件坐标系的变换矩阵（/Matrix） |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | 原 PDF 中绘制该部件时生效的坐标变换 |
| `formType` | 1 |  | 部件的形式号（PDF 规范中仅有 1） |
| `group` | Record<string, PdfRawValueDef> |  | 透明组字典的原始值保持 |
| `reference` | Record<string, PdfRawValueDef> |  | 外部 PDF 引用字典的原始值保持 |
| `metadata` | PdfRawValueDef 的流形式（`kind: 'stream'`） |  | 元数据流的保持 |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | 创建应用专有数据（/PieceInfo）的保持 |
| `lastModified` | PdfRawValueDef |  | 最后更新时刻的保持 |
| `structParent` / `structParents` | number |  | 与带标签 PDF（朗读顺序等文档结构）的对应键的保持 |
| `opi` | PdfOpiMetadataDef |  | OPI 信息的保持（参见下表） |
| `name` | string |  | 部件名 |
| `measure` | PdfMeasurement |  | 测量信息的保持（参见下表） |
| `pointData` | PdfPointData[] |  | 点群数据的保持（参见下表） |

**`PdfSourceVectorDef`**（导入的重复图形的共享定义）

导入像地图符号那样同一图形大量重复的 PDF 时，把图形的轮廓数据以「定义 1 次＋放置 N 次」的形式保全。它出现在 `path` 元素的 `pdfSourceVector` 中，指定时不执行 `d` 的解析处理。手写模板无需指定。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | 被复用的图形定义的数组。各定义持有 `commands`（0＝移动起点〔坐标 2 个〕、1＝直线〔2 个〕、2＝三次贝塞尔曲线〔6 个〕、3＝闭合路径〔0 个〕）和 `coords`（按命令顺序的坐标扁平数组） |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | 定义放置的数组。各放置持有 `definitionIndex`（定义号）和 `matrix`（6 元素仿射矩阵） |

**`PdfOpiMetadataDef`**（商业印刷的图像替换信息）

OPI（Open Prepress Interface）是编辑时放置轻量低分辨率图像、在印刷厂输出时替换为高分辨率图像的商业印刷机制。导入的 PDF 持有该指定时予以保全。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | OPI 的版本 |
| `entries` | Record<string, PdfRawValueDef> | ✓ | 把 OPI 字典的内容以 PDF 原始值原样保持（替换来源文件名、裁切范围等） |

**`PdfMeasurement`**（图纸、地图的测量信息）

在图纸 PDF、地图 PDF 中，查看器的测量工具可以按「纸上 1cm 相当于实物 1m」的比例尺测量距离、面积。这是用于保全其比例尺、坐标系信息的类型，分直角坐标形式（`kind: 'rectilinear'`）和地理空间形式（`kind: 'geospatial'`）。

| 属性（`'rectilinear'`） | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | 直角坐标测量的判别符 |
| `scaleRatio` | string | ✓ | 比例尺的显示文本（例: `'1in = 1ft'`） |
| `x` / `y` | PdfNumberFormat[] | ✓（`y` 可选） | X／Y 方向数值显示格式的链（单位标签、换算系数、小数/分数显示等）。省略 `y` 时使用 `x` |
| `distance` / `area` | PdfNumberFormat[] | ✓ | 距离／面积的数值显示格式 |
| `angle` / `slope` | PdfNumberFormat[] |  | 角度／坡度的数值显示格式 |
| `origin` | [number, number] |  | 测量原点 |
| `yToX` | number |  | Y→X 单位的换算系数 |

| 属性（`'geospatial'`） | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | 地理空间测量的判别符 |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | 测地坐标系。EPSG 代码或 WKT 字符串必居其一 |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | 测地坐标的控制点，以及与之对应的图像、部件内局部控制点（数量相同） |
| `dimension` | 2 \| 3 |  | 坐标的维度。默认: 2 |
| `bounds` | [number, number][] |  | 可测量区域的多边形 |
| `displayCoordinateSystem` | 同 `coordinateSystem` |  | 显示用的坐标系 |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | 距离、面积、角度的优先显示单位 |
| `projectedCoordinateSystemMatrix` | 12 元素的 number 元组 |  | 投影坐标系用的 4×4 仿射矩阵（省略常量第 4 列的行序 12 元素） |

**`PdfPointData`**（地图的点群数据）

用于保全嵌入地图 PDF 的、带具名列（`LAT`＝纬度、`LON`＝经度、`ALT`＝高度等）的点数据表。

| 属性 | 类型・可设置的值 | 必需 | 说明 |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | 列名的数组（唯一・非空。`LAT`/`LON`/`ALT` 列必须为数值） |
| `rows` | PdfRawValueDef[][] | ✓ | 各行的值。行的长度与 `names` 一致 |

**`TransferFunctionDef`**／**`CalculatorFunctionDef`**（制版的灰阶转换函数）

在 `frame` 的 `deviceParams` 和 `softMask` 中使用、把值（0〜1）映射为另一个值的函数。表示制版中「这个浓度的油墨按这个浓度印刷」的灰阶曲线。`TransferFunctionDef` 是 `CalculatorFunctionDef`（PostScript 计算式。例: `{ expression: '{ 1 exch sub }' }`＝黑白反转）或 `PdfFunctionDef`（采样值表／指数插值／它们的组合这类 PDF 函数对象）之一，在使用处也可指定 `'Identity'`（不转换）。

**`HalftoneDef`**（制版的网点定义）

印刷机以小点（网点）的大小表现颜色的浓淡。这是对网点生成方式的指定，用于 PDF 导入的保全和制版数据制作。按 `type` 分为 5 种形式:

| 形式 | 主要属性 | 说明 |
| --- | --- | --- |
| type 1（网屏） | `frequency`（线数）✓・`angle`（角度）✓・`spotFunction`（点的形状。`'Round'` 等预定义名或计算式）✓・`accurateScreens`（要求高精度网屏构建・可选） | 以线数、角度、点形状定义网点的标准形式（`type` 可省略） |
| type 6（阈值数组） | `width`✓・`height`✓・`thresholds`（宽×高个 0〜255）✓ | 用阈值表直接定义网点 |
| type 10（带角度阈值） | `xsquare`✓・`ysquare`✓・`thresholds`✓ | 带角度单元的阈值定义 |
| type 16（16 位阈值） | `width`✓・`height`✓・`thresholds`（16 位值）✓・可选的第 2 矩形 | 高精度的阈值定义 |
| type 5（按色版的集合） | `halftones`（`{ colorant: 油墨名, halftone: 上述任一形式 }` 的数组）✓ | 给青、品红等各色版分配不同的网点 |

除 type 5 外的 4 种形式可持有可选的 `transferFunction`（`'Identity'` 或 `TransferFunctionDef`）（type 5 中由各色版内侧的半色调定义分别持有）。

## 主要 API

为了能从「想做什么」出发查到常用 API，下面逐一给出最小示例。前提是 `template`、`dataSource`、`fontMap`、`fonts` 直接沿用教程中创建的内容。

### 组装报表

#### 想从模板和数据组装报表 — `createReport()`

对模板和数据进行布局，返回以页为单位的 `RenderDocument`。表达式是可引用 `field.*`、`vars.*`、`param.*`、`PAGE_NUMBER`、`TOTAL_PAGES` 等的安全内置表达式语言，不使用 `eval` 和 `Function`。也可以选择 TypeScript 的回调表达式。

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // 已排版的页数
```

#### 想按 ID 获取、修改模板元素 — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

两个 API 返回的都是对原模板元素的引用。请在调用 `createReport()` 之前进行修改。`getElementChildren()` 返回子元素的是 `frame` 和 `table`（单元格内元素），其余元素返回空数组。探索范围的详情参见「按 ID 获取元素并在绘制前修改」。

#### 想从 `.report` 文件组装报表 — `createReportFromFile()`（Node.js）

读入 JSON 模板，以模板所在目录为基准解析图像、子报表的相对路径。

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### 想把多份报表合成一册 — `createReportBook()`

把封面、正文等多份模板连接起来，做成编有连续页码的一个 `RenderDocument`。

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### 想连接已生成的 `RenderDocument` — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

图像 ID 冲突时会自动重命名。

#### 想自动生成目录页 — `insertTableOfContents()`

从报表内的锚点（`anchorName`）收集目录条目，把目录页插入开头。

```ts
const withToc = insertTableOfContents(
  document,
  // TOC page size and margins in pt (this example: A4 portrait)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // font ID (fontMap key) used for the TOC text
  { title: '目次' },
)
```

#### 想知道既有 PDF 的页数 — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### 想把既有 PDF 作为报表元素导入 — `importPdfPage()`

详情参见**把既有 PDF 转换为报表元素（PDF 导入）**。

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### 绘制・输出

#### 想输出 PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### 想只预览一页 — `renderPage()`

以页为单位的绘制。在浏览器预览中只绘制正在显示的页面时使用。

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### 想把整份报表绘制到任意后端 — `render()`

把全部页面绘制到实现了 `RenderBackend` 接口的任意输出目标。

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### 想绘制到 HTML Canvas — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### 想输出为 SVG — `SvgBackend`

每页生成一个完整的 `<svg>` 字符串。

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // 每页一个 <svg> 字符串的数组
```

#### 想精细控制 PDF 生成 — `PdfBackend`

页面缩略图等 PDF 特有选项传给构造函数。

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` 套用于第 i 页。`thumbnailImageId`（显示在页面一览中的缩略图图像）要指定 `document.images` 中存在的图像 ID。

#### 想合并已生成的 PDF — `mergePdfFiles()`

用 Pure TypeScript 的 PDF 解析器把多个 PDF 合并为一个。

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### 处理字体

#### 想读入字体文件 — `Font.load()`

解析 TTF、OTF、TTC、OTC、WOFF、WOFF2、EOT。

```ts
const font = Font.load(fontBuffer)
```

#### 想测量文字宽度 — `TextMeasurer`

利用 `Font` 的字形缓存的高速文字测量。注册进 `fontMap` 后也用于布局。

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### 想把字符串转换为字形序列 — `font.shapeText()`

利用 OpenType/AAT（Apple 系字体的扩展规范）/Graphite（SIL 系字体的扩展规范）的信息，得到套用了字形选择、连字、位置调整的字形序列（字形号与位置、步进宽度的排列）。

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### 想在打印前检测乱码 — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### 单独使用条形码、SVG、公式、图像

#### 想单独生成条形码 — `renderBarcode()`

不经由报表元素，直接生成条形码的绘制节点。

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### 想解析并绘制 SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### 想单独排版数学公式 — `parseMathLaTeX()` / `layoutMathFormula()`

需要内置公式专用尺寸信息（OpenType MATH 表）的字体（例: STIX Two Math、Latin Modern Math）。

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// arguments: parsed formula, Font object, font ID (fontMap key), font size in pt, text color
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box is the laid-out result; template math elements run this same layout internally
```

#### 想知道图像的尺寸 — `getImageDimensions()`

支持 PNG/JPEG/WebP/AVIF。

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### 想解码 PNG — `decodePng()`

Pure TypeScript 的 PNG 解码器。

```ts
const png = decodePng(pngBytes) // { width, height, pixels }（RGBA）
```

#### 想在浏览器输出包含 WebP/AVIF 的 PDF — `prepareBrowserPdfImageResources()`

JPEG 直接收录进 PDF，PNG 由内置解码器处理。在浏览器生成包含 WebP/AVIF 的 PDF 时，`tsreport-core/browser` 只把 `RenderDocument` 实际引用的图像先用浏览器标准编解码器解码，并把结果交给 PDF 生成。未被引用的图像原样保持，不做解码。

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

在 Node.js 展开 WebP/AVIF 时，使用 `tsreport-core/node` 的 `createNodeExternalRasterImageDecoder()`。

## 资源读取的限制与图像 ID 的规则

在服务器运用或库集成中有需要时参考的详细规则。

### 限制图像・模板的读取目录

图像文件的读取可以限定在显式许可的目录之内。

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` 默认以主模板的目录为相对路径的基准，但为了向后兼容，并不隐式限制读取范围本身。指定 `resources.fileRoot` 后，同一限制会套用到图像、主模板、子报表的全部。不存在的图像按各元素 `onError` 的指定处理，指向许可目录之外的引用（包括经由符号链接）始终报错。

### 图像 ID 的规则

`RenderDocument` 的各图像以 `RenderImage.imageId`（alternate 的 `imageId` 同样）为键从 `RenderDocument.images` 查找。**使用方请把该 ID 原样用作键，不要通过路径拼接等方式重新组装键。**ID 按以下规则赋予。

- 即使读入相对路径的图像，也不会把 ID 替换为服务器的绝对路径或符号链接解析后的路径。模板中书写的引用原样保留为键（以绝对路径书写时保持该值不变）
- 符号链接解析后的实体路径仅在内部用于「是否同一文件」的判定。即使基准目录不同，指向同一实体的图像也复用相同的 ID
- 在根报表把图像交给渲染时供给的构成——直接使用 `createReport()`、目标图像也没有传给 `resources`，因此模板中书写的引用原样成为 ID、字节序列事后由 `renderToPdf(document, { images })` 供给的构成——中，子报表读入的相对路径本地图像始终被分配与主机无关的内部 ID。由于表达式和动态子报表的引用无法事先枚举，因此不依赖名称是否实际冲突或布局的顺序。这样，子报表的本地图像就不会劫持同名的渲染时供给用 ID

### 渲染时的图像供给与 alternate

alternate 在布局时无法解析的场合，保持原来的 image ID。因此 Canvas/SVG 预览不会停止，可以事后用 `renderToPdf(document, { images })` 供给字节序列。显式传入的 `images` 被合并进 `document.images`，同一 ID 以显式传入的值优先。PDF 生成时，未供给的 alternate 也只是被从替代候选中排除，主图像的绘制和整份报表不会停止。

### 图像引用的收集范围

图像引用的收集不仅覆盖普通的 `image` 元素，还以同一机制处理 alternate、组的软遮罩、填充（fill/stroke）的平铺图案及其嵌套的软遮罩。在浏览器使用 PDF 特有的页面缩略图、collection 文件夹缩略图、Web Capture 图像时，请把相同的 `catalog`・`collection`・`pageOptions` 同时传给 `prepareBrowserPdfImageResources(document, options)` 和 `renderToPdf(document, options)`（若用 primitive API，则把相同的 options 传给 `new PdfBackend(options)` 并调用 `render(document, backend)`）。这些 WebP/AVIF 同样只在 PDF 生成前按需要的量解码。

## 运行环境

- Node.js 18 以上
- ES Modules / CommonJS
- 现代浏览器
- 无运行时依赖包

WOFF2 的 Brotli 压缩、解压在 Node.js 和浏览器中都使用 tsreport-core 内置的 Pure TypeScript 实现。不需要外部包、WASM、原生库。

## 相关项目

- [tsreport-core](https://github.com/pontasan/tsreport-core)
- [tsreport-editor](https://github.com/pontasan/tsreport-editor)
- [tsreport-sdk](https://github.com/pontasan/tsreport-sdk)
- [tsreport-react](https://github.com/pontasan/tsreport-react)

## License

tsreport-core 可由使用者选择按 [MIT License](./LICENSE-MIT) 或 [Apache License 2.0](./LICENSE-APACHE) 使用（SPDX: `MIT OR Apache-2.0`）。第三方来源代码、数据的版权声明与许可条件参见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
