# tsreport-core

[English](./README.md) | 日本語 | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**日本語・中国語・韓国語からアラビア文字まで。世界中の文字を、Pure TypeScriptだけで美しいPDFにする帳票エンジンです。**

`tsreport-core`は、OpenTypeフォントの解析、文字組版（文字を正しい字形・幅・位置で紙面に並べる処理）、バンド方式の帳票レイアウト、Canvas/SVGプレビュー、PDF生成までを、一つの描画モデルで一貫して扱います。実行時の依存パッケージはゼロ。ネイティブモジュールもWASMも使わず、このパッケージ単体でNode.jsとモダンブラウザの両方で動作します。

```bash
npm install tsreport-core
```

このREADMEには、最初のPDF生成から全16帳票要素・縦書き・多言語組版・フォントの埋込みとアウトライン化・ブラウザプレビューまで、コピーしてそのまま動かせるサンプルを揃えています。帳票ツールが初めての方は[帳票レイアウトの基本](#帳票レイアウトの基本)で考え方をつかんでから、チュートリアルで最初のPDFを作ってみてください。

## tsreport-editorで帳票をWYSIWYGデザイン

[tsreport-editor](https://github.com/pontasan/tsreport-editor)は、tsreport-coreを使ったWYSIWYG帳票デザイナーです。バンドと要素を画面上で配置し、JSONテストデータを結び付け、印刷プレビューを確認し、PDFを取り込み、同じcore描画エンジンでPDFを生成できます。動画では、AIがMCP経由で帳票を編集し、完成した帳票をEditorでプレビューするまでを紹介しています。

| 英語版デモ | 日本語版デモ |
| --- | --- |
| [![英語版 tsreport-editor WYSIWYGデモ](https://img.youtube.com/vi/CHsNew6yQr4/hqdefault.jpg)](https://youtu.be/CHsNew6yQr4) | [![日本語版 tsreport-editor WYSIWYGデモ](https://img.youtube.com/vi/0I3ljxLUbys/hqdefault.jpg)](https://youtu.be/0I3ljxLUbys) |

## 世界中の文字を、一つのエンジンで正しく組む

多言語の帳票は、文字列をそのままPDFへ書き出すだけでは正しく表示できません。字形の選択、文字幅の計測、位置の調整、改行、縦書き、そしてPDFへのフォント埋込み——この一連の処理がすべて噛み合って、はじめて期待どおりの紙面になります。

`tsreport-core`は、この流れをフォントの解析からPDFの生成まで一貫して引き受けます。

- **日本語・中国語・韓国語** — 簡体字・繁体字、ハングル、句読点の扱い、縦書き用字形まで、UnicodeとOpenTypeの情報に基づいて正しく組版します
- **アラビア文字と右から左（RTL）の組版** — 文脈による字形の変化、結合・合字（複数の文字がつながって1つの字形になる現象）、Unicode双方向処理（右から左へ進む文字と数字・英字が混在するときの並び順制御）を、他の文字と同じレイアウト処理で扱います
- **複雑な文字体系** — フォント内蔵の組版ルール（OpenType Layout）による字形置換・位置調整、結合文字、異体字（同じ文字の別デザインの字形）、言語ごとの組版機能に対応します
- **縦書き** — `vertical-rl` / `vertical-lr`、縦書き用字形、縦組み用メトリクス（縦書き専用の文字送り幅などの寸法情報）、文字の回転を処理します
- **フォントの自動サブセット埋込み** — 実際に使ったグリフ（フォントに収録されている1文字分の字形データ）だけをPDFへ収録するため、閲覧側に同じフォントがなくても同じ見た目で表示されます
- **文字のアウトライン化** — 要素単位で、文字をフォントに依存しないベクターパスとして出力できます
- **システムフォント参照** — 閲覧環境のフォントを使う運用向けに、フォントを埋め込まない軽量なPDFも選べます
- **文字化けの事前検出** — `checkGlyphCoverage()`が、フォントに収録されていない文字をページ・文字単位で出力前に洗い出します

そして、この文字組版は帳票専用の高度なレイアウトエンジンと一体で動きます。文字を正しく並べる能力と、ページを正しく割り付ける能力は切り離せないからです。

- **文字量に連動するレイアウト** — 文字数に応じた行の伸長（`stretchWithOverflow`）とバンド高さの自動調整。長い品名も見切れません
- **データ量に応じた自動改ページ** — 明細があふれたら自動でページを繰り、ヘッダー・見出し行を再出力。グループ単位の小計・改ページも宣言だけで行えます
- **入れ子構造の割り付け** — 表・クロス集計・サブレポートを組み合わせた複雑な帳票も、同じレイアウトエンジンが一貫して配置します
- **WYSIWYG（プレビュー＝印刷）** — 要素は指定したpt座標どおりに固定配置され、Canvas/SVGプレビューとPDF出力が同一のレイアウト結果を共有します。画面で見たままが、そのまま紙になります

## なぜtsreport-coreなのか

tsreport-coreは、3つの問題意識から生まれたプロジェクトです。

**TypeScriptに、まともな帳票ソリューションがないこと。** 見積書や請求書を出力することはビジネスの基本なのに、TypeScript/Node.jsのエコシステムには、PDFを低レベルに描くライブラリはあっても、バンドレイアウト・自動改ページ・集計・プレビューと印字の一致までを備えた「帳票エンジン」と呼べるものがありませんでした。帳票のためだけに別言語のランタイムや外部のサーバー製品を持ち込む構成を、終わりにしたいと考えました。

**帳票は基本機能であり、誰もが無償で使えるべきだということ。** 帳票出力は一部の高価な製品だけが持つ特別な機能ではなく、業務システムの土台となる基本機能です。商用ライセンスの購入も従量課金もなしに、個人の道具から商用製品まで、誰もが同じエンジンをそのまま使えるべきです。tsreport-coreがMIT OR Apache-2.0のデュアルライセンスで全機能を公開しているのは、この考えの実装です。

**アジア圏やアラビア文字などへの多言語対応を、真正面から実装したソリューションが少ないこと。** 多くの帳票・PDF生成ツールは欧文を前提に設計されており、日本語・中国語・韓国語の組版や、右から左へ流れるアラビア文字は後付けの対応にとどまりがちです。tsreport-coreは「世界中の文字を、一つのエンジンで正しく組む」ことを最初からの設計目標に据え、フォント解析から組版・PDF埋込みまでを自前で実装しました。

この動機を、次の3つの特長として形にしています。

### レイアウトエンジンからPDF生成まで、これ1つで完結

テンプレートとデータからページを組み立てると、結果は`RenderDocument`という一つの描画モデルにまとまります。これをそのままPDFにもCanvasにもSVGにも描画できるため、画面プレビューと印刷でレイアウト処理を二重に持つ必要がなく、画面で見たとおりのPDFが得られます。バンドレイアウトを備えた帳票エンジンとPDFライブラリを別々に組み合わせる必要はありません。

### 実行時依存ゼロのPure TypeScript

フォント解析、文字組版、PDF生成、DEFLATE圧縮、暗号化、PNGデコード、バーコード生成まで、すべてPure TypeScriptで実装しています。ネイティブモジュールも外部プロセスも使わないため、どの環境でも同じように動き、帳票生成で実行されるコードの監査もこの1パッケージを読むだけで済みます。

### 帳票に必要な機能を標準装備

- タイトル、ページヘッダー、明細、グループ、サマリーなどのバンドレイアウト
- テーブル、クロス集計、サブレポート、変数、式、改ページ、目次、複数帳票の結合
- 既存PDFの取込み — PDFのページを帳票要素（`ElementDef`）・スタイル・画像・フォント情報へ変換
- Code 39/93/128、EAN、UPC、ITF、Codabar、MSI、QR Code、Data Matrix、PDF417
- SVG、グラデーション、クリッピング、透過、数式組版、画像
- PDF暗号化、PDF/A-1b・2b・3b（長期保存用の国際規格）、PDF/X-1a（印刷入稿用の国際規格）、しおり（ブックマーク）、リンク、フォーム、注釈
- TTF、OTF、TTC、OTC、WOFF、WOFF2、EOT、可変フォント（太さ・幅などを連続的に変えられるフォント）、カラーフォント

## 帳票レイアウトの基本

帳票エンジンを初めて使う方向けに、土台となる考え方を順に説明します。

### 前提: 帳票は「テンプレート」と「データ」に分けて作る

tsreport-coreでは、帳票を**テンプレート**（レイアウトの定義）と**データ**（JSON）の2つに分けて作ります。

テンプレートには実際の値を書きません。「この位置に品名を、この幅・この書式で金額を」という枠と、そこに**データのどの項目を表示するか**の参照（`field.item`＝データの`item`項目、という書き方）だけを定義します。

実際の値はJSONデータとして渡します。`rows`配列の1要素が、明細の1行分です。

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

帳票を生成すると、エンジンが`rows`を上から1行ずつたどり、1行ごとに明細のレイアウトを1回出力します。上の例なら明細は3行印字され、`field.item`はそれぞれ「りんご」「みかん」「ぶどう」に置き換わります。データが10,000行に増えても、テンプレートは1文字も変えずに10,000行の帳票になります。この「レイアウトは固定、行数はデータ次第」という分業が帳票エンジンの出発点です。

### ページは「バンド」の積み重ね

そのうえでテンプレート側では、ページを**バンド**と呼ばれる横長の領域の積み重ねとして設計します。要素のY座標を自分で計算してページに並べるのではなく、「どのバンドに何を置くか」だけを宣言すると、データの行数に応じてエンジンがページを自動で組み立てます。1ページは次のような構造になります。

```text
┌──────────────────────────┐
│ title                    │ ← 帳票の先頭に1回だけ（表題・宛先など）
├──────────────────────────┤
│ pageHeader               │ ← 毎ページの上部（社名・発行日など）
├──────────────────────────┤
│ columnHeader             │ ← 明細の見出し行（「品名・数量・金額」など）
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ rowsの1行につき1回、
│ details                  │ │ 行数のぶんだけ繰り返し
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← 明細の締め（ページ・カラムごと）
├──────────────────────────┤
│ pageFooter               │ ← 毎ページの下部（ページ番号など）
└──────────────────────────┘
```

最終ページでは、最後の`details`のあとに`summary`（帳票全体の合計など）が1回だけ出力されます。このほかに、毎ページの背景に敷かれる`background`、最終ページ専用の`lastPageFooter`、データが0行のときだけ出る`noData`があり、`bands`に定義できるバンドは全部で10種類です。

| バンド | 出力されるタイミング | 典型的な用途 |
| --- | --- | --- |
| `background` | 毎ページの背景 | 透かし、飾り枠 |
| `title` | 帳票の先頭に1回 | 表題、宛先 |
| `pageHeader` | 毎ページの上部 | 社名、発行日 |
| `columnHeader` | 明細の前（ページ・カラムごと） | 明細の見出し行 |
| `details` | データ（`rows`）の1行ごと | 明細行 |
| `columnFooter` | 明細の後（ページ・カラムごと） | 小計欄 |
| `pageFooter` | 毎ページの下部 | ページ番号 |
| `lastPageFooter` | 最終ページの下部（指定時は`pageFooter`の代わり） | 締めの文言 |
| `summary` | 全明細の後に1回 | 総合計、備考 |
| `noData` | データが0行のとき | 「該当データはありません」 |

さらに`groups`を定義すると、グループキーの値が変わる位置にグループのヘッダー・フッターが自動で挿入され、「部署ごとに小計を出して改ページする」といったレイアウトになります。

また、テンプレートの`columns`（`count`＝段数、`spacing`＝段の間隔pt）を指定すると、明細領域を新聞のように複数の縦段（**カラム**）に分けて流し込めます。既定は1カラムで、その場合、この文書で「カラムごと」とある動作は「ページごと」と同じ意味になります。また、次のカラムへ送ることを「改列」と表記します。

### 改ページは自動で行われる

明細がページに収まらなくなると、エンジンが自動でそのページを締めて（`pageFooter`を出力して）次のページを開始し、`pageHeader`と`columnHeader`をもう一度出力してから続きの明細を流し込みます。行数を数えたり、ページの残り高さを計算したりするコードは必要ありません。

制御したい場合だけ、次の手段を使います。

- `break`要素 — 任意の位置で強制的に改ページ・改列する
- バンドの`startNewPage` — そのバンドを必ず新しいページから始める
- バンドの`splitType` — 高さが足りないとき、バンドの途中でページをまたいでよいか（`stretch`）、分割せずまとめて次ページへ送るか（`prevent`）を選ぶ

### サブレポート = 帳票の中に埋め込む、もう一つの帳票

`subreport`要素は、親帳票のレイアウトの中に別の`.report`を丸ごと埋め込みます。「注文の一覧を印字し、各注文の中にその内訳を表で印字する」——このような**入れ子のデータ**を組むための仕組みです。

たとえば、親の`rows`の1行（＝注文1件）が、内訳の配列`items`を持っているとします。

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

親の`details`バンドに`subreport`要素を置き、`dataSourceExpression`で「この注文の`items`」を渡します。

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression`は名前のとおり「式」です。固定のファイル名を渡すときは、式の中の文字列リテラルとして`'...'`で囲みます（`"field.templatePath"`のように式で動的に切り替えることもできます）。

すると、**親の明細1行ごとにサブレポートが1回実行され**、渡された`items`がサブレポート側の`rows`として扱われます。サブレポート（`order-items.report`）は独立した1つのテンプレートなので、自分のバンド定義を持ち、`field.name`・`field.qty`で内訳の各行を参照します。ページ上では次のように展開されます。

```text
┌──────────────────────────────┐
│ details                      │ ← 親のrows 1行目（注文 A-001）
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← この注文のitems（2件）を渡す
│   │   details              │ │ ← items 1行目（りんご 10）
│   │   details              │ │ ← items 2行目（みかん 5）
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← 親のrows 2行目（注文 A-002）
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← この注文のitems（1件）を渡す
│   │   details              │ │ ← items 1行目（ぶどう 2）
│   └────────────────────────┘ │
└──────────────────────────────┘
```

請求書の中の内訳表、顧客ごとに繰り返す明細ブロックなど、「帳票の中の小さな帳票」を部品として切り出して再利用できます。パラメーター（見出し文字列など）を親から渡すこともできます。このあとの[全帳票要素のサンプル](#全帳票要素の実装サンプル)に、同じ構成のそのまま動く完全な例（親要素＋サブレポート側テンプレート）があります。

## `.report`とJSONデータからPDFを生成する

`.report`は、`ReportTemplate`をJSONで記述した帳票テンプレートです。中身はただのJSONなので、Gitで差分を管理でき、任意の言語やツールから生成することもできます。

最小構成は次の3ファイルです。

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

フォント2つは、日本語フォント（例: Noto Sans JP）のRegular / Boldを想定したファイル名です。手元のフォントに合わせて読み替えてください。複数の言語を1つの帳票で扱う方法は、後述の[多言語の帳票を作る](#多言語の帳票を作る)で説明します。

### 1. テンプレート`quotation.report`を書く

座標・寸法・余白・フォントサイズの単位は、すべてPDFの標準単位である**pt（ポイント、1pt = 1/72インチ ≈ 0.353mm）**です。`"size": "A4"`は595 × 842ptとして扱われ（ISO寸法210×297mmをpt換算し整数に丸めた値）、この例の余白36ptは約12.7mmです。

もう1つの前提として、`styles`の`fontFamily`はフォントファイル名ではなく、あとで実行コード側の`fontMap`・`fonts`に登録する**キー名（論理名）**です。テンプレートとコードで同じ名前（この例では`jp`・`jpBold`）を使うことで対応づけられます。

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

明細で使っている`pattern`は数値・日付の書式指定です（`#,##0`＝3桁区切り、`¥#,##0`＝円記号付き3桁区切り。詳しくは後述の「数値・日付を書式化したい」参照）。

### 2. データを`quotation.test-data.json`に用意する

`rows`の各行が明細バンドの`field.*`に、`parameters`が帳票全体の`param.*`にバインドされます。

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

バインディングの対応関係は次のとおりです。

| JSON | `.report`の式 | 用途 |
| --- | --- | --- |
| `rows[n].item` | `field.item` | 現在の明細行 |
| `parameters.title` | `param.title` | 帳票全体の引数 |
| 変数`grandTotal` | `vars.grandTotal` | 集計・カウントなどの帳票変数 |
| ページコンテキスト | `PAGE_NUMBER` / `TOTAL_PAGES` | ページ番号・総ページ数 |

### 3. `.report`を読み込んでPDFを生成する

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

`fontMap`と`fonts`に同じフォントを二重に登録しているのは、役割が違うためです。`fontMap`はレイアウト時の文字幅計測（`TextMeasurer`）に、`fonts`はPDF生成時のフォント埋込みに使われます。同じフォントを、テンプレートの`fontFamily`と同じキー名で両方に登録してください。

`createReportFromFile()`は、画像とサブレポートの相対パスをメイン`.report`のディレクトリ基準で解決します。`workingDirectory`を指定した場合は、そのディレクトリが基準です。読込み範囲を制限する場合は、`resources.fileRoot`へ許可ルートを明示してください。ルート外への相対参照と、ルート外を指すシンボリックリンクは拒否されます。

## テンプレートをTypeScriptで直接定義する

`.report`ファイルを使わずに、テンプレートをTypeScriptのオブジェクトとして書くこともできます。型チェックと補完が効くため、テンプレートをコードから生成する用途に向いています。内容はチュートリアルと同じ見積書です。座標と寸法の単位はptです。

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

### IDで要素を取得し、描画前に変更する

要素へ任意の`id`を付けると、`findElementById()`でバンドやフレームの深さにかかわらず取得できます。戻り値はコピーではなく`template`内の要素そのものなので、`createReport()`より前に変更した内容がレイアウトと描画へ反映されます。

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

`findElementById()`は通常バンド、明細バンド、グループのヘッダー／フッター、フレーム、ソフトマスク、テーブルセルを深さ優先で検索します。同じIDが複数ある場合は検索順で最初の要素を返すため、変更対象として使うIDはテンプレート内で一意にしてください。`getElementChildren()`が返す配列内の要素も元テンプレート内の参照です。

> フォントファイルはパッケージに同梱されません。用途・配布方法・埋込み可否に適したライセンスのフォントを指定してください。1つのスタイルに指定できるフォントは1つです。1つの要素の中で複数言語の文字を混在させたい場合は、それらを1本で収録したPan-CJKフォント（日中韓の文字をまとめて収録したフォント。例: Source Han Sans〔源ノ角ゴシック〕、Noto Sans CJK）が必要です。言語ごとに別フォントを使う場合は、次の「多言語の帳票を作る」のように要素を言語単位で分けてスタイルを使い分けます。

## 多言語の帳票を作る

スタイル1つにつき指定できるフォントは1つで、フォント間の自動フォールバックはありません。したがって多言語の帳票の基本形は、**言語ごとにフォントを読み込み、言語ごとの要素にそれぞれのスタイルを適用する**ことです。

次の例は、日本語と簡体字中国語を並記する見積書の抜粋です。まず言語ごとにフォントを読み込みます。

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

テンプレートでは、日本語の文言に`ja`スタイル、中国語の文言に`zh`スタイルを適用し、要素を言語単位で分けます。

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

データも言語ごとの項目で持ちます。

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

例外は、自由記述の備考のように**どの言語が入るか実行時までわからない1つの欄**です。その欄は要素を言語で分けられないため、そのスタイルにだけ、多くの文字体系を1本で収録したPan-CJKフォント（Source Han Sans〔源ノ角ゴシック〕、Noto Sans CJKなど）を割り当てるのが現実的です。どちらの方式でも、フォントの収録漏れは`checkGlyphCoverage()`が出力前に検出します。

## フォント出力方式を、文字要素ごとに選ぶ

同じ帳票内でも、本文は検索可能な埋込み文字、ロゴはアウトライン、定型文はシステムフォント参照というように、`staticText`または`textField`ごとに出力方式を指定できます。

| 方式 | 指定 | PDF上の状態 | 適した用途 |
| --- | --- | --- | --- |
| サブセット埋込み | `pdfFontMode: 'embedded'`（既定） | 使用したグリフとフォントプログラムを埋込み。文字の選択・検索が可能 | 配布、長期保存、印刷、多言語帳票 |
| アウトライン化 | `outlineText: true` | 字形をベクターパスへ変換。フォント情報を持たない | ロゴ、版下など、字形を完全に固定したい文字 |
| システムフォント参照 | `pdfFontMode: 'reference'` | フォントを埋め込まず、フォント名と文字だけを記録 | フォント環境を管理できる社内配布などでの軽量なPDF |

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

サブセット埋込みは、出力先の環境に依存せず字形を保つための推奨方式です。システムフォント参照はPDFを開く環境に互換フォントが必要であり、環境が異なると外観も変わり得ます。アウトライン化した文字は通常の文字列として選択・検索できません。

## 縦書き

スタイルに`writingMode`を指定するだけで、縦書き用の字形と、縦書き専用の寸法情報（縦組み用メトリクス＝文字の送り幅など）を使った縦組みになります。`vertical-rl`は行を右から左へ、`vertical-lr`は行を左から右へ進めます。

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

## ブラウザでPDFと同じ帳票をプレビュー

PDF用に作成した`RenderDocument`を、そのままCanvasにも描画できます。プレビューと印刷が同じレイアウト結果を共有するため、「画面と紙で見た目が違う」という問題が起こりません。pt単位の固定レイアウトと組み合わせて、WYSIWYGなプレビュー・編集体験の土台になります（フォント埋込みが既定。システムフォント参照モードだけは閲覧環境に外観が依存します）。`renderPage()`を呼ぶだけで、ページの開始・終了処理も含めて描画されます。

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

ReactでプレビューUIを組む場合は、`tsreport-react`パッケージも利用できます。

## フォントエンジンを単体で使う

帳票を作らなくても、フォント解析・シェーピング（文字列を、実際に描画する字形の並びと位置に変換する処理）・文字計測・サブセット生成の各機能を単体で利用できます。

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

## 既存PDFを帳票要素に変換する（PDF取込み）

`importPdfPage()`は、既存PDFのページを解析して、tsreport-coreの帳票要素（`ElementDef`）の配列へ変換します。単なるビューアーではなく、テキストは`staticText`、画像は`image`、図形は`path`というように、この帳票エンジンでそのまま編集・再配置できる部品として取り込みます。

紙で運用してきた帳票のPDFや他システムが出力したPDFを土台にして、データ差込み欄を足したり、レイアウトを組み替えたりする——「既存帳票の資産をテンプレート化する」ための入口です。

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: staticText / image / path などの帳票要素の配列
// page.styles:   要素が参照する文字スタイル定義
// page.images:   要素が参照する画像データ
// page.fonts:    参照されているフォントの情報
console.log(pageCount, page.width, page.height, page.elements.length)
```

取り込んだ`elements`と`styles`は、そのままテンプレートのバンドへ配置できます。暗号化PDFのパスワード指定、注釈の取込み、取り込んだ文字のアウトライン化などは`PdfImportOptions`で制御します。

## 式（Expression）を使いこなす

帳票の「動く部分」は、すべて式で書きます。`textField`の印字内容、`printWhenExpression`の印字条件、バーコードのデータ、画像のパス、サブレポートに渡すデータ——型が`Expression`のプロパティには、どこでも同じ式が書けます。

式には2つの形式があります。

- **文字列式** — `"field.price * field.quantity"`のような文字列。専用のパーサーが解釈するJavaScriptの安全なサブセットで、`eval`や`new Function`は一切使いません。テンプレートをJSON（`.report`ファイル）として保存できます
- **コールバック式** — `(field, vars, param, report) => …`のTypeScript関数。言語機能をフルに使えますが、テンプレートをJSONに保存できなくなります（TypeScriptでテンプレートを保持する前提）

まず文字列式でどこまで書けるかを押さえ、足りないときにコールバックへ進むのがおすすめです。

### 式で参照できる値

| 名前 | 内容 |
| --- | --- |
| `field.*` | 現在のデータ行。`field.customer.name`のようにネストして参照できる |
| `vars.*` | 変数（後述の`variables`で定義した集計値）。`var.*`でも同じ |
| `param.*` | 帳票全体の値。データソースの`parameters`で渡した値と、テンプレート`parameters`の`defaultValue`。サブレポートでは親から渡されたパラメーターもここに入る |
| `PAGE_NUMBER` | 現在のページ番号（1始まり） |
| `COLUMN_NUMBER` | 現在のカラム番号（1始まり） |
| `REPORT_COUNT` | 処理済みのデータ行数 |
| `TOTAL_PAGES` | 総ページ数。**そのまま参照すると「その時点までのページ数」になる**ため、最終的な総ページ数を印字するには`evaluationTime: 'report'`または`'auto'`と組み合わせる（後述） |

存在しないフィールドを参照しても例外にはならず`undefined`になります（`field.a.b`の途中が`null`でも安全に`null`が返ります）。

### 文字列式で使える構文

| 分類 | 使えるもの |
| --- | --- |
| リテラル | 数値（`1200`、`0.5`）、文字列（`'見積'`または`"見積"`。`\n`等のエスケープ対応）、`true`／`false`／`null`／`undefined` |
| テンプレートリテラル | `` `合計 ${vars.total} 円` `` — `${}`の中には完全な式が書ける |
| 算術 | `+`（数値の加算と文字列連結）、`-`、`*`、`/` |
| 比較 | `>`、`>=`、`<`、`<=`、`===`、`!==` |
| 論理 | `&&`、`\|\|`、`!`（JavaScriptと同じ短絡評価） |
| null合体 | `??` — 左辺がnull/undefinedのとき右辺を返す |
| 条件（三項） | `条件 ? 真の値 : 偽の値` |
| その他 | 単項の`-`／`+`、括弧`( )`、ドット記法のメンバーアクセス（プロパティ名は日本語も可: `field.顧客名`） |
| 組み込み関数 | `format(値, パターン)`＝書式化（後述）／`round(値, 桁数?)`＝四捨五入／`roundUp`・`roundDown`・`roundHalfEven`（銀行丸め）・`ceil`・`floor`・`trunc`（いずれも第2引数は小数桁数、省略時0）／`now()`＝現在時刻 |

**使えないもの**: `==`／`!=`（`===`／`!==`を使う）、`%`や`**`、ブラケット記法（`field['a-b']`）と配列インデックス、メソッド呼び出し（`field.name.toUpperCase()`は評価時にエラー——呼べる関数は上の組み込みだけ）、代入、関数定義、`new`、optional chaining（`?.`——そもそも途中がnullでも例外にならないため不要）。これらが必要な場合はコールバック式を使います。

この制限は安全のためのものです。文字列式は独自パーサーで解釈され、コードとして実行されることがないため、外部から受け取ったテンプレートに任意コードを仕込むことはできません。

### 計算した結果を印字したい

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

データ例:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

`¥3,960`と印字されます。

### 文字列を組み立てたい

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

テンプレートリテラルの`${}`に埋め込んだ値は文字列化されて連結されます。**nullは文字列`"null"`になる**ので、欠けている可能性のある項目には例のように`?? ''`を添えます。

### 条件で表示を切り替えたい

三項演算子で印字内容を切り替えます。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

「表示する内容を変える」のではなく「表示するかどうかを変える」場合は、全要素共通の`printWhenExpression`を使います（「条件を満たすときだけ要素を印字したい」参照）。スタイル（色や太字）を条件で変える場合は、スタイル定義の`conditionalStyles`に同じ書き方の条件式を指定します。

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### 数値・日付を書式化したい — `format`と`pattern`

`textField`は`pattern`プロパティで、式の評価結果を印字時に書式化できます。式の中で部分的に書式化したいときは組み込み関数`format(値, パターン)`を使います。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

数値パターンは`#`（桁があれば表示）と`0`（0埋め）と`,`（3桁区切り）の組み合わせで、前後に接頭辞・接尾辞を書けます。丸めは四捨五入です。

| パターン | 入力 | 出力 |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

日付パターンのトークンは`yyyy`（4桁年）、`MM`／`M`（0埋め月／月）、`dd`／`d`（0埋め日／日）、`HH`（0埋め時・24時間制）、`mm`（分）、`ss`（秒）です。値がnull/undefinedのときは空文字になります。

これで足りない書式（和暦、曜日、通貨の桁処理など）は、テンプレートの`formatters`に名前付きのTypeScript関数を登録し、`pattern`にその名前を書きます。

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// 要素側: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern`は登録済みフォーマッタ名を先に探し、無ければ組み込み書式として解釈されます。フォーマッタは関数なので、この機能を使うテンプレートはJSONではなくTypeScriptで保持します。

### 合計・平均・件数を印字したい — 変数（`variables`）

明細を跨いだ集計は、テンプレートの`variables`に定義します。変数はデータ行を処理するたびに`expression`の結果を集計へ取り込み、式からは`vars.名前`で現在値を参照できます。

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

`pageFooter`バンドに`"expression": "vars.pageTotal"`の`textField`を置けばページ小計、`summary`バンドに`"expression": "vars.grandTotal"`を置けば総合計になります。

**プロパティ一覧（`variables`の各要素）**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 変数名。式から`vars.名前`で参照する |
| `expression` | Expression | ✓ | 行ごとに評価され、結果が集計へ取り込まれる |
| `calculation` | `'sum'`＝合計 / `'average'`＝平均 / `'count'`＝件数 / `'distinctCount'`＝重複を除いた件数 / `'min'`＝最小値 / `'max'`＝最大値 / `'first'`＝最初の値 / `'nothing'`＝毎行上書き（最後の値） | ✓ | 集計方法 |
| `resetType` | `'report'`＝レポート全体で集計し続ける（リセットなし・既定） / `'page'`＝ページごとにリセット / `'column'`＝カラムごとにリセット / `'group'`＝`resetGroup`のグループごとにリセット / `'none'`＝リセットしない点は`'report'`と同じだが、遅延評価（`evaluationTime`）でも要素を配置した時点の値のまま確定する（あとから最終集計値に差し替わらない） |  | 集計のリセット単位 |
| `resetGroup` | string |  | `resetType: 'group'`のときの対象グループ名 |
| `incrementCondition` | Expression |  | 指定時、評価結果が偽の行は集計へ取り込まない（条件付き集計） |
| `initialValue` | Expression |  | 初期化・リセット時の初期値 |

`incrementCondition`を使うと「特定の区分だけ合計する」といった条件付き集計が1つの変数で書けます:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

なお、サブレポートの実行結果を親で集計したい場合は、`subreport`要素の`returnValues`が子の変数を親の`vars.*`へ書き戻します（`subreport`のプロパティ一覧参照）。

### ページ番号・総ページ数を印字したい

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

ポイントは`evaluationTime: 'auto'`です。式は通常、要素を配置した瞬間に評価されますが、その時点では最終的な総ページ数はまだ分かりません。`'auto'`を指定すると、式を静的解析して`PAGE_NUMBER`はページ確定時、`TOTAL_PAGES`はレポート完了時というように**参照ごとに正しいタイミングで評価**します。`'auto'`は式を解析する必要があるため文字列式専用です（コールバック式に指定すると例外になります）。

### 文字列式でできないことを書きたい — コールバック式

テンプレートをTypeScriptで定義しているなら、`Expression`を受け取るすべての場所に関数をそのまま書けます。引数は`(field, vars, param, report)`の4つで、`report`から`PAGE_NUMBER`等の組み込み値と`format`関数、登録済み`formatters`を参照できます。

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

メソッド呼び出し・正規表現・外部関数の利用など、TypeScriptで書けることはすべて書けます。トレードオフは2つ——テンプレートをJSONとして保存・転送できなくなること、`evaluationTime: 'auto'`が使えないこと（`'report'`等の明示指定は使えます）です。

### 式がエラーになったときの挙動

- **構文エラー・禁止構文**（メソッド呼び出し等）は、位置情報付きの`ExpressionLanguageError`をスローし、そのまま`createReport()`の呼び出し元へ伝播します。握りつぶされて空欄になることはありません
- **存在しないフィールド・変数の参照**はエラーにならず`undefined`と評価されます。`textField`では`blankWhenNull: true`を指定していれば空欄、指定がなければ文字列`null`が印字されます
- ユーザー入力の式を実行前に検証したい場合は、`validateExpressionSource(source)`が構文チェック結果（エラーまたは`null`）を返します

## 全帳票要素の実装サンプル

`ElementDef`が提供する全16要素を次に示します。すべての要素で`x`、`y`、`width`、`height`（単位はpt、1pt = 1/72インチ）を指定し、バンドまたは`frame`の`elements`へ配置します。

| したいこと | 要素 |
| --- | --- |
| 固定の文字列を印字する | `staticText` |
| データ・変数・式の結果を印字する | `textField` |
| 罫線を引く | `line` |
| 矩形・角丸の枠を描く | `rectangle` |
| 円・楕円を描く | `ellipse` |
| 任意のベクター図形を描く | `path` |
| 画像を配置する | `image` |
| 複数の要素をまとめて枠で囲む | `frame` |
| 表を印字する | `table` |
| クロス集計表を印字する | `crosstab` |
| 帳票の中に別の帳票を埋め込む | `subreport` |
| バーコード・QRコードを印字する | `barcode` |
| 数式を印字する | `math` |
| SVGを印字する | `svg` |
| 入力できるPDFフォームを作る | `formField` |
| 任意の位置で改ページ・改列する | `break` |
| 条件を満たすときだけ要素を印字する | `printWhenExpression`（全要素共通の属性） |

以下、1要素につき1つずつ、バンドの`elements`配列へそのまま置ける定義と、式を使う要素には対応するデータ例を示します。あわせて各要素の節末尾に、その要素固有のプロパティ一覧を載せています。全要素に共通するプロパティ（位置・色・印字条件など）とスタイルのプロパティは、後述の「要素プロパティリファレンス」を参照してください。

### 固定の文字列を印字したい — `staticText`

テンプレートに書いた文字列を、そのまま印字します。見出しやラベルに使います。

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | 要素種別 |
| `text` | string | ✓ | 印字する固定文字列 |
| `actualText` | string |  | 見た目の文字と、コピー・検索で取り出されるテキストが異なる場合の置換テキスト（PDFの/ActualText）。主にPDF取込みが元PDFの指定を保持するために使う |
| `hyperlink` | HyperlinkDef |  | ハイパーリンク（共通プロパティ節の**`HyperlinkDef`**参照） |
| `anchorName` | string |  | アンカー名。しおりや文書内リンク（`hyperlink`の`'localAnchor'`）の到達先として登録される |
| `bookmarkLevel` | number |  | PDFビューアのサイドバーに表示される目次（しおり）に、この要素のテキストを載せるときの階層レベル（1が最上位、1〜6） |

※ このほか全要素共通プロパティと`TextProperties`の全プロパティを指定可能。

### データや式の結果を印字したい — `textField`

`expression`の評価結果を印字します。`field.*`（データ）、`vars.*`（変数）、`param.*`（パラメーター）、`PAGE_NUMBER`などを参照でき、テンプレートリテラルで文字列を組み立てられます。式の書き方の全体は「式（Expression）を使いこなす」を参照してください。`pattern`で数値・日付の書式、`stretchWithOverflow`で文字量に応じた高さの伸長を指定します。

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

データ例:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | 要素種別 |
| `expression` | Expression | ✓ | 印字する値を返す式 |
| `pattern` | string |  | フォーマットパターン。テンプレート登録のカスタムフォーマッタ（`formatters`のパターン名）を優先し、無ければ組み込みフォーマッタで整形 |
| `blankWhenNull` | boolean |  | 式の結果がnull/undefinedのとき空文字にする（未指定時は文字列`'null'`が印字される） |
| `stretchWithOverflow` | boolean |  | 内容がheightに収まらないとき、要素の高さを内容に合わせて伸長する |
| `evaluationTime` | `'now'`＝その場で即時評価（既定） / `'band'`＝バンド確定時に評価 / `'column'`＝カラム終了時に評価 / `'page'`＝ページ終了時に評価 / `'group'`＝`evaluationGroup`のグループ確定時に評価 / `'report'`＝レポート終了時に評価（TOTAL_PAGES等が確定） / `'auto'`＝式が参照する各変数・組み込み値をそれぞれのリセットタイミングで個別に評価（文字列式のみ。コールバック式は例外を投げる） |  | 式の評価タイミング。既定以外を指定すると、配置時はいったん空のまま領域を確保し、該当タイミングの値が確定した時点で埋め込まれる。典型例: グループ合計をグループの先頭に先出しする（`'group'`）、最終的な総ページ数を印字する（`'report'`） |
| `evaluationGroup` | string |  | `evaluationTime: 'group'`のときの対象グループ名 |
| `textTruncate` | `'none'`＝収まらない行を描画しない（既定。現行実装では`'truncate'`と同一挙動） / `'truncate'`＝収まらない行を行単位で切り捨てる / `'ellipsisChar'`＝最終行の文字境界で切り詰めて`...`を付加 / `'ellipsisWord'`＝最終行の単語境界で切り詰めて`...`を付加 |  | `stretchWithOverflow`無効時に高さへ収まらないテキストの扱い。既定: `none` |
| `hyperlink` | HyperlinkDef |  | ハイパーリンク（共通プロパティ節の**`HyperlinkDef`**参照） |
| `anchorName` | string |  | アンカー名。しおりや文書内リンク（`hyperlink`の`'localAnchor'`）の到達先として登録される |
| `bookmarkLevel` | number |  | PDFビューアのサイドバーに表示される目次（しおり）に、この要素のテキストを載せるときの階層レベル（1が最上位、1〜6） |

※ このほか全要素共通プロパティと`TextProperties`の全プロパティを指定可能。`isPrintRepeatedValues: false`は本要素で有効（同一値の連続印字を抑止）。

### 罫線を引きたい — `line`

この例は高さ0の水平罫線です。`lineStyle`には`solid`のほか`dashed`などを指定できます。

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | 要素種別。線分は要素の左上`(x, y)`から右下`(x+width, y+height)`へ描画される（`height: 0`で水平線、`width: 0`で垂直線、両方非0で対角線） |
| `lineWidth` | number |  | 線幅（pt）。既定: 1 |
| `lineStyle` | `'solid'`＝実線 / `'dashed'`＝破線 / `'dotted'`＝点線 |  | 線種。既定: 実線 |
| `lineColor` | string |  | 線色。既定: 要素の`forecolor`、それも無ければ`#000000` |

### 矩形・角丸の枠を描きたい — `rectangle`

`cornerRadii`で四隅の丸みを個別に指定できます。

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

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | 要素種別 |
| `radius` | number |  | 角丸半径（pt。全角共通） |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | 角ごとの角丸半径（pt） |
| `fill` | FillDef |  | 塗り（共通プロパティ節の**`FillDef`**参照）。既定: スタイルの`backcolor`（`transparent`以外のとき） |
| `stroke` | string |  | 枠線色。既定: スタイルの`forecolor` |
| `strokeWidth` | number |  | 枠線幅（pt）。既定: 1 |

### 円・楕円を描きたい — `ellipse`

枠の幅・高さに内接する楕円を描きます。

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | 要素種別。要素の境界ボックスに内接する楕円（中心`(x+width/2, y+height/2)`、半径`width/2`×`height/2`）を描画する |
| `fill` | FillDef |  | 塗り（共通プロパティ節の**`FillDef`**参照）。未指定時は塗りなし |
| `stroke` | string |  | 枠線色。未指定時は枠線なし |
| `strokeWidth` | number |  | 枠線幅（pt）。既定: 1（`stroke`指定時） |

### 任意のベクター図形を描きたい — `path`

`d`にSVGのパス構文を、`viewBox`にその座標系を指定します。図形は要素の枠に合わせて拡縮されます。

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

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | 要素種別 |
| `d` | string | ✓ | SVGパスデータ（M/L/C/Z等）。座標は要素ローカルpt |
| `pdfSourceVector` | PdfSourceVectorDef |  | PDF取込みが、繰り返し現れる同一図形（地図記号など）を「定義1回＋配置N回」の形で保全したもの（後述の**`PdfSourceVectorDef`**参照）。指定時は`d`のパース処理を行わない。手書きテンプレートでは指定不要 |
| `affineTransform` | [number, number, number, number, number, number] |  | 描画前にパス座標を要素ローカル座標へ写すアフィン変換行列。`[a, b, c, d, e, f]`で`x' = a·x + c·y + e、y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, 幅, 高さ]`。パス座標をこの領域から要素の幅・高さへスケーリングする |
| `fill` | FillDef |  | 塗り（共通プロパティ節の**`FillDef`**参照）。未指定時は塗りなし |
| `fillRule` | `'nonzero'`（既定） / `'evenodd'` |  | 自己交差するパスや入れ子になったパスで、どこを「内側」として塗るかの判定規則。ドーナツ状に穴を抜きたい場合は`'evenodd'`が確実 |
| `fillOpacity` | number |  | 塗りの不透明度（0.0〜1.0） |
| `stroke` | FillDef |  | ストローク（単色のほかグラデーション等も指定可能）。未指定時はストロークなし |
| `strokeWidth` | number |  | ストローク幅（pt）。既定: 1（`stroke`指定時） |
| `strokeOpacity` | number |  | ストロークの不透明度（0.0〜1.0） |
| `strokeLinecap` | `'butt'`＝端で切る / `'round'`＝丸端 / `'square'`＝角端（線幅の半分だけ延長） |  | 線端形状 |
| `strokeLinejoin` | `'miter'`＝マイター（尖り） / `'round'`＝丸め / `'bevel'`＝面取り |  | 線の接合形状 |
| `strokeMiterLimit` | number |  | マイター限界値。既定: 10 |
| `strokeDasharray` | number[] |  | 破線パターン（線分と間隔の長さの配列、pt） |
| `strokeDashoffset` | number |  | 破線パターンの開始オフセット（pt） |

### 画像を配置したい — `image`

`sourceExpression`（式）または`source`（固定値）で画像を指定します。`scaleMode`で枠への収め方を、`onError`で画像が見つからないときの挙動（`error`＝エラーにする / `blank`＝空白 / `icon`＝アイコン表示）を選びます。

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

データ例:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | 要素種別 |
| `source` | string | | 固定の画像参照（画像ID）。`.report`基準の相対パス・絶対パス・URL・data URIなどをそのまま書く（IDの規則は後述の「リソース読込みの制限と画像IDの規則」参照）。`sourceExpression`が未指定または評価結果が未解決の場合に使用される |
| `sourceExpression` | Expression | | 動的な画像ソース式。結果が文字列なら画像IDとして解決され、`Uint8Array`なら画像データそのものとして扱われる |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | 画像の拡縮方法。`'clip'`＝画像を原寸のまま配置し要素枠でクリップ／`'fillFrame'`＝縦横比を無視して要素枠いっぱいに変形拡縮／`'retainShape'`＝縦横比を維持し枠内に収まる最大倍率で拡縮／`'realSize'`＝原寸配置＋枠クリップ（実装上 `'clip'` と同一処理）。既定: `'retainShape'`。なお画像サイズが取得できない場合は `'fillFrame'` と同じ挙動になる |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | 枠内での画像の水平配置（`retainShape` の余白配置、`clip`/`realSize` の切り出し位置に作用）。既定: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | 枠内での画像の垂直配置。既定: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | 画像ソース未定義・解決失敗時の挙動。`'error'`＝例外をスロー／`'blank'`＝何も描画しない／`'icon'`＝灰色の枠と×印のプレースホルダを描画。既定: `'icon'` |
| `lazy` | boolean | | 型定義のみ存在し、現行のレイアウトエンジン・レンダラー実装では参照されない（仕様未記載） |
| `rotation` | `0` \| `90` \| `180` \| `270` | | 画像の回転角（度） |
| `affineTransform` | [number, number, number, number, number, number] | | 配置を行列で直接指定する代替手段。`[a, b, c, d, e, f]`は単位正方形（0〜1）の画像を`x' = a·x + c·y + e、y' = b·x + d·y + f`で写す変換で、指定時は`scaleMode`/`hAlign`/`vAlign`/`rotation`による配置計算を行わない。主にPDF取込みが元の配置を保全するために使う |
| `opacity` | number | | 不透明度（0.0〜1.0） |
| `interpolate` | boolean | | 低解像度画像を拡大したとき、ビューアがピクセルの境界を滑らかに補間して表示する（PDFの/Interpolate）。写真では有効が、バーコードなどくっきり表示したい画像では無効が適切 |
| `alternates` | PdfImageAlternateDef[] |  | 画面表示用と印刷用で別画像を使い分けるPDFの代替画像（/Alternates）。各要素は`source`＝代替画像の参照（必須）と`defaultForPrinting`＝印刷時にこちらを使うか、の2プロパティ |
| `opi` | PdfOpiMetadataDef |  | 商業印刷で低解像度のプレースホルダ画像を出力時に高解像度画像へ差し替えるためのOPI情報。主にPDF取込みの保全用（後述の**`PdfOpiMetadataDef`**参照） |
| `measure` | PdfMeasurement |  | 図面・地図PDFでビューアの計測ツールが使う縮尺・座標系情報。主にPDF取込みの保全用（後述の**`PdfMeasurement`**参照） |
| `pointData` | PdfPointData[] |  | 地図PDFの点群データ（緯度・経度など）。主にPDF取込みの保全用（後述の**`PdfPointData`**参照） |
| `hyperlink` | HyperlinkDef | | ハイパーリンク（`type`: `'reference'`＝URL／`'localAnchor'`＝文書内アンカー／`'localPage'`＝文書内ページ／`'remoteAnchor'`・`'remotePage'`＝外部PDF内アンカー・ページ、`target`: リンク先の式、`remoteDocument?`: 外部PDFパスの式） |

### 複数の要素をまとめて枠で囲みたい — `frame`

子要素をグループ化し、`border`で枠線、`clip`ではみ出しの切抜きを指定できます。子要素の座標は`frame`の左上が原点です。

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

データ例:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | 要素種別 |
| `clip` | boolean | | 子要素をフレーム境界でクリップするか。既定: true |
| `border` | BorderDef | | 枠線（共通プロパティ節の**`BorderDef`**参照） |
| `padding` | Padding | | 内側余白（`top?`/`bottom?`/`left?`/`right?`、各pt） |
| `rotation` | number | | フレームの回転角（度、ページ座標で反時計回り） |
| `rotationOriginX` | number | | 回転原点X（フレーム相対、pt）。既定: 0 |
| `rotationOriginY` | number | | 回転原点Y（フレーム相対、pt）。既定: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Y軸が上向きのフレームローカル座標を親座標空間へ写すアフィン行列（行列の並びと意味は`image`の`affineTransform`と同じ）。主にPDF取込みが元の配置を保全するために使う |
| `pdfForm` | PdfFormXObjectDef |  | PDF取込みで、元PDFの部品（Form XObject）が持っていた座標系・メタデータを保持し再出力する（後述の**`PdfFormXObjectDef`**参照）。手書きテンプレートでは指定不要 |
| `hyperlink` | HyperlinkDef | | ハイパーリンク（image の同名プロパティと同構造） |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | SVG パス構文によるクリップパス。`d`＝パスデータ、`fillRule`＝塗り規則 |
| `transparencyGroup` | boolean | | `isolated`/`knockout`がいずれも無効でも、PDFの透明グループ境界を保持する。保持すると不透明度・ブレンドの合成結果が、フレームを1枚の絵として合成した場合と同じに保たれる（主にPDF取込みの再現用） |
| `isolated` | boolean | | 分離透明グループ（PDF /Group /I）。これ（または `knockout` / `softMask`）が設定されると、フレームは一体として合成された後に不透明度・ブレンド・マスクが適用される |
| `knockout` | boolean | | ノックアウト透明グループ（PDF /Group /K）。グループ内で重なった子要素同士は透け合わず、各位置で最前面の子要素だけが背景と合成される |
| `softMask` | FrameSoftMaskDef | | フレームを部分的に透明化するソフトマスク（下表**`FrameSoftMaskDef`**参照）。`elements`の描画結果を「透過率の地図」として使い、グラデーションで徐々に消えていくような表現ができる |
| `deviceParams` | DeviceParamsDef | | 商業印刷の製版工程向けパラメーター（下表**`DeviceParamsDef`**参照）。通常の帳票では指定不要で、主にPDF取込みが元PDFの指定を保全するために使う |
| `elements` | ElementDef[] | | フレーム内の子要素 |

**`FrameSoftMaskDef`**（`softMask`の構造）
| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | マスク種別。`'luminosity'`＝マスクの明るい部分ほどフレームが不透明になる／`'alpha'`＝マスクの不透明な部分ほどフレームが不透明になる |
| `colorSpace` | PdfProcessColorSpaceDef | | ソフトマスク透明グループのブレンド色空間 |
| `isolated` | boolean | | ソフトマスク透明グループの分離フラグ |
| `knockout` | boolean | | ソフトマスク透明グループのノックアウトフラグ |
| `backdrop` | [number, number, number] | | 輝度マスク用 /BC 背景色（DeviceRGB 0〜1）。既定: 黒 |
| `elements` | ElementDef[] | ✓ | 透明グループとして合成しマスクを定義する要素群 |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | マスク値（0..1）を再マップする /SMask /TR 転送関数 |

**`DeviceParamsDef`**（`deviceParams`の構造。商業印刷の製版向けで通常は指定不要——主にPDF取込みの保全用）
| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | /TR 転送関数。`'Identity'`／`'Default'`／全色版共通の単一関数／4色版ごとの関数配列 |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | /BG 墨生成関数（`'Default'`＝/BG2 によるデバイス既定） |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | /UCR 下色除去関数（`'Default'`＝/UCR2 によるデバイス既定） |
| `halftone` | `'Default'` \| HalftoneDef | | /HT ハーフトーン（type 1 スクリーン／type 6・10・16 閾値配列／type 5 色版別コレクション） |
| `halftoneOrigin` | [number, number] | | PDF 2.0 ハーフトーン原点（/HTO、デバイス空間ピクセル） |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | PDF 2.0 黒点補償制御（/UseBlackPtComp） |
| `flatness` | number | | 平滑化許容誤差（/FL） |
| `smoothness` | number | | シェーディング平滑度許容誤差（/SM） |
| `strokeAdjustment` | boolean | | 自動ストローク調整（/SA） |

### 表を印字したい — `table`

ヘッダー行・明細行・フッター行を持つ表です。`dataSourceExpression`で行データの配列を渡すと、明細行が配列の要素数だけ繰り返されます。

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

データ例（`items`の各要素が表の明細1行になります）:

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

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | 要素種別 |
| `columns` | TableColumnElementDef[] | ✓ | 列定義の配列。全列の`width`合計が要素の幅と異なる場合、要素幅にちょうど収まるよう全列が比例スケーリングされる |
| `headerRows` | TableRowElementDef[] |  | ヘッダー行の配列。改ページ分割時は各ページの先頭で繰り返し描画される |
| `detailRows` | TableRowElementDef[] |  | 明細行の配列。データ行1件ごとに繰り返し描画される（データ行 × detailRows の全行） |
| `footerRows` | TableRowElementDef[] |  | フッター行の配列。改ページ分割時は最終ページにのみ描画される |
| `dataSourceExpression` | Expression |  | 評価結果の配列をこのテーブルのデータ行として使用する。省略時はメインデータソースの行を使用。配列以外に評価された場合は例外を送出する |

**`TableColumnElementDef`**（`columns`の各要素＝列定義）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 列幅（pt）。全列合計が要素幅と一致しない場合は比例配分される |
| `style` | TableCellStyleDef |  | この列の既定セルスタイル。セル側で同名プロパティが指定されている場合はセル側が優先される（罫線は辺単位でマージ） |

**`TableRowElementDef`**（`headerRows`/`detailRows`/`footerRows`の各要素＝行定義）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 行高（pt）。最小値として扱われ、テキスト折り返しやセル内子要素が収まらない場合は自動拡張される（rowSpanセルの内容超過分は結合範囲の最終行が拡張される） |
| `cells` | TableCellElementDef[] | ✓ | この行のセル定義の配列。上の行の`rowSpan`により占有されている列は自動的にスキップして配置される |

**`TableCellElementDef`**（`cells`の各要素＝セル定義。下記に加えて`TableCellStyleDef`の全プロパティを直接指定可能）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `text` | string |  | セルの固定テキスト |
| `expression` | Expression |  | データバインド用の式。`field.名前`単独形式はデータ行から直接値を取得し、それ以外はエンジンの式評価で解決する。指定時は`text`より優先 |
| `colSpan` | number |  | 横方向に結合する列数。既定: 1 |
| `rowSpan` | number |  | 縦方向に結合する行数。既定: 1。セル高は結合範囲の行高の合計になる |
| `elements` | ElementDef[] |  | セル内に配置する子要素の配列。指定時は`text`/`expression`の描画より優先され、パディングを除いた領域にクリップして描画される。行高は子要素の必要高に合わせて自動拡張される |

**`TableCellStyleDef`**（セル定義および列の`style`で使用するセルスタイル）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `hAlign` | `'left'`＝左揃え / `'center'`＝中央揃え / `'right'`＝右揃え |  | 水平方向の文字揃え |
| `vAlign` | `'top'`＝上揃え / `'middle'`＝中央揃え / `'bottom'`＝下揃え |  | 垂直方向の文字揃え |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | テキスト回転（度）。既定: 0 |
| `backcolor` | string |  | セル背景色 |
| `forecolor` | string |  | 文字色。既定: `#000000` |
| `fontId` | string |  | フォントID。既定: `'default'` |
| `fontSize` | number |  | フォントサイズ（pt）。既定: 10 |
| `bold` | boolean |  | 太字 |
| `italic` | boolean |  | 斜体 |
| `underline` | boolean |  | 下線 |
| `strikethrough` | boolean |  | 取り消し線 |
| `lineSpacing` | LineSpacingDef |  | 行間設定（共通プロパティ節の**`LineSpacingDef`**参照） |
| `letterSpacing` | number |  | 字間（pt）。すべての文字の間に固定量を追加する（負値で詰める） |
| `wordSpacing` | number |  | 語間（pt。空白文字への追加幅） |
| `firstLineIndent` | number |  | 1行目のインデント（pt） |
| `leftIndent` | number |  | 左インデント（pt） |
| `rightIndent` | number |  | 右インデント（pt） |
| `wrap` | boolean |  | テキスト折り返し。既定: true |
| `shrinkToFit` | boolean |  | セルに収まるようフォントサイズを自動縮小する |
| `minFontSize` | number |  | `shrinkToFit`時の最小フォントサイズ（pt）。既定: 4 |
| `fitWidth` | boolean |  | 最長行がセル幅にちょうど収まるようフォントサイズを自動調整する（縮小・拡大の両方向）。このセルは行高の自動拡張に寄与しない |
| `outlineText` | boolean |  | テキストをアウトライン（パス）化して描画する |
| `padding` | number |  | セル内パディング（pt）。既定: 2 |
| `border` | BorderDef |  | セル単位の罫線（共通プロパティ節の**`BorderDef`**参照）。列`style`の罫線とマージされ、セル側の指定が優先される |
| `opacity` | number |  | 不透明度（0.0〜1.0）。1未満の場合セル全体が不透明度グループとして描画される |

### クロス集計表を印字したい — `crosstab`

行グループ×列グループでデータを集計します。この例は「地域×分類」で`amount`を合計し、小計と総計も出力します。

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

データ例:

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

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | 要素種別 |
| `rowGroups` | { field, headerFormat? }[] | ✓ | 行グループ定義の配列。複数指定で多階層グループになり、各階層が左から1列ずつ行ヘッダー列を占有する。外側グループのヘッダーセルは対象範囲にわたり縦結合される |
| `columnGroups` | { field, headerFormat? }[] | ✓ | 列グループ定義の配列。外側グループが上、内側グループが下に積み重なり、外側ヘッダーは対象列幅にわたり横結合される |
| `measures` | { field, calculation, format? }[] | ✓ | メジャー（集計セル）定義の配列。複数指定時はデータセル内に縦に積んで表示され、各メジャーが1スロット（最低`cellHeight`）を占有し個別に`calculation`/`format`を適用する。空配列の場合は`field: ''`・`calculation: 'sum'`の暗黙の1件として扱われる |
| `rowHeaderWidth` | number |  | 行ヘッダー幅（pt）。行グループの各階層に適用される。既定: 80 |
| `columnHeaderHeight` | number |  | 列ヘッダー高（pt）。列グループの各階層に適用される。既定: 20 |
| `cellWidth` | number |  | データセル幅（pt）。既定: 60 |
| `cellHeight` | number |  | データセル高（pt、メジャー1件分のスロット高）。テキスト折り返しに応じて自動拡張される。既定: 20 |
| `border` | { color?, width? } |  | 罫線設定（下表参照）。指定時のみ外枠・行/列の区切り線・ヘッダー階層の区切り線を描画する（結合された外側ヘッダーセルを横切らない） |
| `showSubtotals` | boolean |  | 小計の表示。既定: false。trueの場合、最内層を除く各グループのブロック末尾に「Total」ラベルの小計行/列を挿入する。小計値は生値から各メジャーの`calculation`で再集計される |
| `showGrandTotal` | boolean |  | 総計の表示。既定: false。trueの場合、末尾に「Total」ラベルの総計行/列を追加する（データ0件時は出力されない）。総計値も生値から再集計される |
| `dataSourceExpression` | Expression |  | 評価結果の配列をこのクロス集計のデータ行として使用する。省略時（または評価結果が配列でない場合）はメインデータソースの行を使用 |

**行/列グループ定義（`rowGroups`/`columnGroups`の各要素）**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `field` | string | ✓ | グループ化に使用するフィールド名。データ中の出現順にグループが並ぶ |
| `headerFormat` | string |  | ヘッダー値の表示フォーマット。値が数値の場合のみ適用される簡易書式（`'#,##0'`または`,`を含む→桁区切り表示、`'.00'`のような小数指定→その桁数で固定小数表示、それ以外→そのまま文字列化） |

**メジャー定義（`measures`の各要素）**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 集計対象のフィールド名。数値以外の値は数値変換され、変換できない場合は0として扱われる |
| `calculation` | `'sum'`＝合計 / `'count'`＝件数 / `'average'`＝平均 / `'min'`＝最小値 / `'max'`＝最大値 | ✓ | 集計方法。小計・総計も生値の集合から同じ計算方法で再集計されるため、`average`等でも正しい値になる |
| `format` | string |  | 集計値の表示フォーマット（`headerFormat`と同じ簡易書式: `'#,##0'`または`,`→桁区切り、`'.NN'`→小数NN桁固定、指定なし→そのまま文字列化） |

**罫線設定（`border`）**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `color` | string |  | 線色。既定: `#000000` |
| `width` | number |  | 外枠・ヘッダー/データ境界の線幅（pt）。既定: 0.5。内部の行/列区切り線はこの半分の線幅で描画される |

### 帳票の中に別の帳票を埋め込みたい — `subreport`

考え方は[帳票レイアウトの基本](#帳票レイアウトの基本)で説明しました。ここではそのまま動く完全な定義を示します。親の明細1行ごとにサブレポートが1回実行され、`dataSourceExpression`で渡した配列がサブレポート側の`rows`になります。

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

データ例:

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

埋め込まれる側の`subreport.report`は、独立した1つのテンプレートです。渡された`items`の各要素を通常の`field.*`として参照し、親から渡されたパラメーターを`param.*`で受け取ります。なお、サブレポートとして実行されるテンプレートでは`pageHeader`・`pageFooter`・`background`バンドは出力されません（ページ管理は親レポートが行うため）。見出しは次のように`title`バンドへ置きます。

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

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | 要素種別 |
| `templateExpression` | Expression | ✓ | 子テンプレート名を返す式。`createReportFromFile()`を使っている場合はファイルパスとして自動解決され、`createReport()`を直接使う場合はオプション`resolveSubreportTemplate`（名前と作業ディレクトリを受け取り、`{ template, workingDirectory? }`を返す関数。解決できないときは`null`を返す）で解決する |
| `dataSourceExpression` | Expression | | 子レポートのデータソース（行オブジェクトの配列）を返す式。省略時は親のデータソース行をそのまま使用。配列以外の結果は空データとして扱う |
| `parameters` | SubreportParamDef[] |  | 子レポートへ渡すパラメーター（下表**`SubreportParamDef`**参照）。`parametersMapExpression`の同名エントリより優先される |
| `parametersMapExpression` | Expression | | 子パラメーターへマージするオブジェクトを返す式（個別の `parameters` が優先） |
| `returnValues` | ReturnValueDef[] |  | 子レポートの変数値を親へ返す定義（下表**`ReturnValueDef`**参照） |
| `usingCache` | boolean | | 親レポートの1回の実行内で、テンプレート名ごとに解決済み子テンプレートをキャッシュして再利用する |
| `runToBottom` | boolean | | サブレポート内容の後、ページ／カラムの残り空間を消費する（後続要素を残り空間の下へ押し出す） |

**`SubreportParamDef`**（`parameters`の各要素＝子レポートへ渡すパラメーター）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 子レポートに渡すパラメーター名（子側では`param.名前`で参照） |
| `expression` | Expression | ✓ | パラメーター値を算出する式。親レポートの文脈で評価される |

**`ReturnValueDef`**（`returnValues`の各要素＝子レポートから親へ値を返す定義）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 親レポート側で値を受け取る変数名。この変数は親の通常の変数計算による上書きから除外される |
| `subreportVariable` | string | ✓ | 子レポート側の参照元変数名。子レポートの実行完了時にその値が親へ反映される |
| `calculation` | `'nothing'`＝子の値をそのまま代入（実行のたびに上書き） / `'count'`＝件数 / `'sum'`＝合計 / `'average'`＝平均 / `'min'`＝最小値 / `'max'`＝最大値 / `'first'`＝最初に得られた値を保持 | ✓ | 親変数への反映方法。`'nothing'`以外は、サブレポートが複数回実行される場合に横断で集計される |

### バーコード・QRコードを印字したい — `barcode`

`barcodeType`にはCode 39/93/128、EAN、UPC、ITF、Codabar、MSI、QR Code（`qrcode`）、Data Matrix、PDF417などを指定できます。`showText`で読み取り用の文字を併記します。

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

データ例:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | 要素種別 |
| `barcodeType` | string | ✓ | バーコード規格（大文字小文字は区別しない）。設定可能値: `'code39'`＝Code 39／`'code128'`＝Code 128／`'ean13'`・`'ean-13'`＝EAN-13／`'ean8'`・`'ean-8'`＝EAN-8／`'qrcode'`・`'qr'`＝QRコード／`'datamatrix'`・`'data-matrix'`＝Data Matrix／`'pdf417'`＝PDF417／`'upca'`・`'upc-a'`＝UPC-A／`'upce'`・`'upc-e'`＝UPC-E／`'itf'`・`'interleaved2of5'`＝ITF（Interleaved 2 of 5）／`'codabar'`＝Codabar（NW-7）／`'code93'`＝Code 93／`'msi'`＝MSI。上記以外の値は未対応としてプレースホルダを描画する |
| `expression` | Expression | ✓ | バーコードのデータを返す式（評価結果を文字列化して符号化する） |
| `showText` | boolean | | 1次元バーコードの下部に人間可読テキストを表示する（テキスト領域高さ10pt・フォントサイズ8pt。バー高さはその分減少）。2次元コード（QR／Data Matrix／PDF417）では使用されない |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | QRコードの誤り訂正レベル＝コードの一部が汚れ・欠損しても読み取れる復元能力。`'L'`→`'H'`の順に耐性が上がる代わりに模様が細かくなる。印刷が粗い媒体では`'Q'`か`'H'`を推奨。既定: `'M'`。QRコードのみで有効（PDF417の誤り訂正レベルはデータ長から自動選定される） |

### 数式を印字したい — `math`

LaTeX風の数式を組版します。数式の組版には、数式用の寸法情報（OpenType MATHテーブル）を内蔵した専用フォントが必要です（無料で入手できる例: STIX Two Math、Latin Modern Math。通常の本文フォントでは代用できません）。`formula`は式として評価されます（この例ではデータの`formula`項目を参照しています）。

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

データ例:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

`math`要素を使う場合は、OpenType MATHテーブルを持つフォントを`fontMap`とPDF出力用`fonts`の両方へ登録します。

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | 要素種別 |
| `formula` | Expression | ✓ | LaTeX数式文字列を返す式（固定の数式は式中の文字列リテラルとして`'...'`で囲む）。評価結果が空文字列の場合は何も描画しない |
| `mathFontFamily` | string | | 数式描画に使うフォント（fontMap に登録されたフォントID）。既定: 要素スタイルの fontFamily、それも無ければ `'default'` |
| `fontSize` | number | | フォントサイズ（pt）。既定: 要素スタイルの fontSize、それも無ければ 12 |
| `color` | string | | 文字色。既定: 要素の forecolor → スタイルの forecolor → `#000000` の順で解決 |

### SVGを印字したい — `svg`

SVG文書をそのまま帳票に描画します。`svgContent`は式として評価されます（固定のSVG文字列をデータやパラメーターで渡せます）。

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

データ例:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | 要素種別 |
| `svgContent` | Expression | ✓ | SVG マークアップ文字列を返す式。評価結果を文字列化し、要素の位置・サイズで SVG として描画する |

### 入力できるPDFフォームを作りたい — `formField`

PDFを開いた人が入力できるフォームフィールドを配置します。`fieldType`には`text`、`checkbox`、`radio`、`pushbutton`、`dropdown`、`listbox`、`signature`を指定できます。

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

データ例（フォームの初期値になります）:

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | 要素種別。対話的フォームフィールド。プレビュー系バックエンドは初期外観を描画し、PDF出力では実際に入力可能なフィールドとして出力される |
| `fieldType` | `'text'`＝テキスト入力フィールド（PDF /Tx） / `'checkbox'`＝チェックボックス（/Btn） / `'radio'`＝ラジオボタン（/Btn。`fieldName`が同じウィジェット同士が1つの排他グループを構成） / `'pushbutton'`＝プッシュボタン（/Btn。キャプション＋任意のURIアクション） / `'dropdown'`＝ドロップダウン（コンボボックス、/Ch） / `'listbox'`＝リストボックス（/Ch） / `'signature'`＝署名フィールド（/Sig） | ✓ | フィールド種別 |
| `fieldName` | string | ✓ | 完全修飾フィールド名。文書内で一意でなければならない（重複時は例外）。例外として`radio`は同名を共有することで1つの排他グループを形成する |
| `value` | Expression |  | 初期値（text: 入力値、dropdown/listbox: 選択値。`multiSelect`のlistboxは改行区切りで複数値を指定）。式評価される。`valueStream`との併用は例外 |
| `checked` | Expression |  | 初期チェック状態（checkbox/radio）。式評価される。radioではチェックされたボタンの`exportValue`がグループの選択値になる |
| `exportValue` | string |  | フォームの入力内容を送信・抽出したとき、このチェックボックス／ラジオが「ON」であることを表す値として記録される文字列（checkbox/radio）。既定: `'Yes'`。ラジオグループでは各選択肢をこの値で区別する |
| `options` | FormFieldOption[] |  | 選択肢の配列（dropdown/listbox）。下表参照 |
| `editable` | boolean |  | 選択肢に加えて自由入力を許可する（dropdownをコンボ入力可能にする） |
| `multiSelect` | boolean |  | 複数選択を許可する（listbox） |
| `caption` | string |  | ボタンのキャプション（pushbutton） |
| `action` | string |  | pushbutton押下時に開くURI |
| `multiline` | boolean |  | 複数行入力（text） |
| `readOnly` | boolean |  | 読み取り専用にする |
| `required` | boolean |  | 入力必須にする |
| `noExport` | boolean |  | フォーム送信時にこのフィールドの値をエクスポートしない |
| `password` | boolean |  | パスワード入力（text、入力文字を伏せ字表示） |
| `fileSelect` | boolean |  | ファイル選択フィールドにする（text）。`multiline`/`password`との併用は例外 |
| `doNotSpellCheck` | boolean |  | スペルチェックを無効にする（text/dropdown/listbox） |
| `doNotScroll` | boolean |  | 表示範囲を超える入力のスクロールを禁止する（text） |
| `comb` | boolean |  | 等幅の文字マス（コム）表示にする（text）。`maxLength`の指定が必須で、`multiline`/`password`/`fileSelect`との併用は例外 |
| `richText` | string |  | 対応ビューアで書式付き（太字・色など）に表示されるリッチテキスト値（PDFの/RV）。指定するとフィールドのリッチテキストフラグが立つ。`richTextStream`との併用は例外 |
| `richTextStream` | Uint8Array |  | `richText`のストリーム版。PDF取込みで元PDFの/RVがストリームだった場合のバイト保全用で、手書きテンプレートでは通常`richText`を使う。`richText`との併用は例外 |
| `defaultStyle` | string |  | リッチテキストの既定スタイル（PDFの/DS）。CSS風の書式指定文字列（例: `font: Helvetica 12pt`）で、`richText`側で指定しない部分の既定になる |
| `valueStream` | Uint8Array |  | PDF取込みの保全用。元PDFのフィールド値（/V）が文字列でなくストリームオブジェクトだった場合に、そのバイト列を無損失で再出力する。手書きテンプレートでは通常`value`を使う。`value`との併用は例外 |
| `defaultValue` | string |  | フォームリセット時に戻る既定値（/DV） |
| `sort` | boolean |  | 選択肢をソート表示する（dropdown/listbox） |
| `commitOnSelectionChange` | boolean |  | 選択変更時に値を即時確定する（dropdown/listbox） |
| `radiosInUnison` | boolean |  | 同じ`exportValue`を持つグループ内のラジオボタンを連動してON/OFFする |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | 対応するPDFビューア上で動く入力スクリプトをフィールドに付与する。K＝入力のたび（例: 数字以外を除去）、F＝表示整形（例: 小数2桁で表示）、V＝値検証（例: 負数を拒否）、C＝再計算（例: 他フィールドの値から自動計算）。中身は通常`subtype: 'JavaScript'`の`PdfActionDef`（後述）。コアエンジンはスクリプトをPDFへ埋め込むだけで実行しない。radioグループでは全ウィジェットが同一の定義でなければ例外 |
| `calculationOrder` | number |  | `'C'`（再計算）アクションを持つフィールドが複数あるとき、ビューアがどの順番で再計算するか（PDFの/CO）。0以上の整数の昇順。重複・負値・非整数は例外 |
| `maxLength` | number |  | 最大入力文字数（text） |
| `borderColor` | string |  | 枠線色（`#RRGGBB`）。省略時は枠線なし。radioは円形、それ以外は矩形の枠として線幅1ptで描画される |
| `backgroundColor` | string |  | 背景色（`#RRGGBB`）。省略時は透明。radioは円形、それ以外は矩形で塗られる |

**`FormFieldOption`**（`options`の各要素＝選択肢定義）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `value` | string | ✓ | フィールドの値（/V）に格納されるエクスポート値 |
| `label` | string |  | 表示ラベル。既定: `value`と同じ |

※ このほか全要素共通プロパティと`TextProperties`の全プロパティを指定可能（入力テキストのフォント・配置等に適用される）。

### 任意の位置で改ページ・改列したい — `break`

明細の流れの途中で、強制的にページ（`"breakType": "page"`）または列（`"column"`）を切り替えます。バンド直下に置き、`frame`の中には置けません。

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**プロパティ一覧**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | 要素種別 |
| `breakType` | `'page'` \| `'column'` | ✓ | 改ページ種別。要素の y 位置でバンドを分割し、`'page'`＝次ページへ送る／`'column'`＝複数カラム構成（テンプレートの`columns.count`が2以上。「帳票レイアウトの基本」参照）かつ最終カラム以外のとき次カラムへ送る（それ以外の場合は改ページとして動作） |

### 条件を満たすときだけ要素を印字したい — `printWhenExpression`

`printWhenExpression`は特定の要素の種類ではなく、**全要素に共通の属性**です。式がtruthyに評価された行でだけ、その要素を印字します。次の例は、`urgent`が`true`の明細行にだけ「※ 至急」を印字します。

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

データ例（1行目にだけ印字されます）:

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

バンドにも同名の`printWhenExpression`を指定でき、バンドごと出力を抑制できます（例: 備考バンドを`param.showNotes`のときだけ出す）。テンプレートをTypeScriptで定義する場合は、要素の`onBeforeRender`コールバックでさらに細かく制御できます——`null`を返せばその要素の印字をスキップ、`ElementDef`を返せば文字列・寸法・色などの属性をその場で上書きして印字します。

## 要素プロパティリファレンス

各要素のサンプルに付けた「プロパティ一覧」は、その要素だけが持つプロパティです。加えてどの要素にも、位置・サイズ・印字条件・色などの共通プロパティを指定できます。ここでは全要素に共通するプロパティと、テンプレートの`styles`で定義するスタイルのプロパティをまとめます。

### 全要素に共通のプロパティ

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | string |  | `findElementById()`で描画前に要素を取得・変更するための識別子。印字内容そのものには影響しない。変更対象に使うIDはテンプレート内で一意にする（重複時は検索順で最初の要素が返る） |
| `x` | number | ✓ | 親バンド／コンテナ内のX座標（pt） |
| `y` | number | ✓ | 親バンド／コンテナ内のY座標（pt） |
| `width` | number | ✓ | 幅（pt） |
| `height` | number | ✓ | 高さ（pt） |
| `style` | string |  | 適用するスタイル名（`styles`で定義した`StyleDef`の`name`を参照。未指定時は`isDefault`のスタイルが適用される） |
| `positionType` | `'float'`＝自要素より上にある要素の伸長量ぶん下方向へ移動する / `'fixRelativeToTop'`＝バンド上端からの位置を固定（既定） / `'fixRelativeToBottom'`＝バンド下端からの距離を維持（バンド伸長量ぶん下へ移動） |  | バンドが伸長したときの位置決めルール。既定: `fixRelativeToTop` |
| `stretchType` | `'noStretch'`＝伸長しない（既定） / `'containerHeight'`＝要素の高さをバンドの実効高さに一致させる / `'containerBottom'`＝要素の下端をバンドの実効下端まで伸長する（高さのみ変更） |  | バンドが伸長したときの要素の伸長ルール。既定: `noStretch` |
| `printWhenExpression` | Expression \| null |  | 評価結果が偽の場合、この要素を印字しない |
| `onBeforeRender` | OnBeforeRenderCallback |  | レンダリング直前に呼ばれるコールバック `(elem, field, vars, param, report) => ElementDef \| null`。`null`を返すと印字スキップ（`printWhenExpression`の上位互換）、`ElementDef`を返すとその定義で描画（任意属性の動的上書き）。評価順序: `onBeforeRender` → `printWhenExpression`（上書き後の定義に対して評価） → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | 要素が印字されなかったとき、その要素が占める垂直帯に他の印字要素が重なっていなければ帯を除去し、下の要素を上へ詰めてバンドを縮める |
| `isPrintRepeatedValues` | boolean |  | `false`を指定すると、直前と同じ値（textField）の場合は印字を抑止する（抑止時、`isRemoveLineWhenBlank`が真なら高さ0として扱う） |
| `isPrintWhenDetailOverflows` | boolean |  | バンドがオーバーフローした各ページ／カラムのセグメントに、この要素を再印字する |
| `mode` | `'opaque'`＝`backcolor`で背景を塗る / `'transparent'`＝背景を塗らない |  | 表示モード。既定: `transparent`（要素→スタイルの順に解決） |
| `forecolor` | string |  | 前景色（`#RRGGBB`または`#RRGGBBAA`） |
| `backcolor` | string |  | 背景色（`mode`が`opaque`のとき描画される） |
| `border` | BorderDef |  | 枠線（後述の**`BorderDef`**参照）。line/rectangle/ellipse/path要素では枠線は描画されない（スタイル由来・要素直指定とも。これらの要素は自前の`stroke`等で線を指定する） |
| `padding` | Padding |  | パディング（後述の**`Padding`**参照） |
| `blendMode` | BlendModeDef |  | この要素の色を、すでに描かれている下の内容とどう合成するか（後述の**`BlendModeDef`**参照）。典型例: 印影・スタンプ画像に`'multiply'`を指定すると、下の文字を隠さず透かした状態で重なる |
| `overprintFill` | boolean |  | 商業印刷の製版向け。塗り（文字・図形の面）を、下にある色版を消さずに重ねて刷る（オーバープリント）指定 |
| `overprintStroke` | boolean |  | 商業印刷の製版向け。線（ストローク）のオーバープリント指定 |
| `overprintMode` | 0 \| 1 |  | `overprintFill`/`overprintStroke`を有効にしたときの挙動の選択（PDF /OPM）。`0`＝すべての色成分で下の色を上書き（既定） / `1`＝値が0の色成分は下の色を残す |
| `renderingIntent` | `'AbsoluteColorimetric'`＝測色的に忠実 / `'RelativeColorimetric'`＝白点を合わせて忠実 / `'Saturation'`＝鮮やかさ優先 / `'Perceptual'`＝見た目の自然さ優先 |  | 出力機器の色域に収まらない色をどう変換するかの優先方針（PDFレンダリングインテント）。商業印刷・カラーマネジメント向けで、通常は指定不要 |
| `alphaIsShape` | boolean |  | PDF透明合成の細部制御（不透明度・マスクを「形状」として解釈する /AIS）。通常は指定不要で、主にPDF取込みの忠実な再出力に使われる |
| `textKnockout` | boolean |  | 半透明の文字同士が重なったとき、同じテキスト内では重なりを二重合成しない（PDF /TK）。既定: `true`。通常は指定不要 |
| `optionalContent` | OptionalContentDef |  | この要素をPDFの「レイヤー」に載せる。ビューアのレイヤーパネルから表示/非表示・印刷の有無を切り替えられる（例: 透かしを画面では表示し印刷では消す）。後述の**`OptionalContentDef`**参照 |
| `opacity` | number |  | 要素の不透明度（0.0〜1.0）。子要素を持つ場合はグループとして合成後に適用 |

**`BlendModeDef`**（`blendMode`に指定できる合成モード）

要素は通常、下にある描画結果を上塗りします（`'normal'`）。ブレンドモードを指定すると、上下の色を計算で合成します。帳票では、印影・社印を文字の上に重ねる（`'multiply'`）、暗い背景に白抜き風の効果を出す（`'screen'`）といった使い方が典型です。

| 定数 | 効果 |
| --- | --- |
| `'normal'` | 合成せず上の色で描く（既定相当） |
| `'multiply'` | 乗算。重なりは必ず暗くなる。印影・スタンプ・蛍光マーカー風の重ね塗りに |
| `'screen'` | 反転乗算。重なりは必ず明るくなる |
| `'overlay'` | 下地が暗ければ乗算・明るければ反転乗算。コントラストが強調される |
| `'darken'` | 上下の暗い方の色を採用 |
| `'lighten'` | 上下の明るい方の色を採用 |
| `'color-dodge'` | 上の色に応じて下地を明るく飛ばす |
| `'color-burn'` | 上の色に応じて下地を焼き込んで暗くする |
| `'hard-light'` | 上の色の明暗で乗算／反転乗算を切り替える（強い照明効果） |
| `'soft-light'` | `'hard-light'`の弱い版（柔らかい照明効果） |
| `'difference'` | 上下の色の差の絶対値 |
| `'exclusion'` | `'difference'`の低コントラスト版 |
| `'hue'` | 上の色相＋下の彩度・輝度 |
| `'saturation'` | 上の彩度＋下の色相・輝度 |
| `'color'` | 上の色相・彩度＋下の輝度（モノクロ下地への着色に） |
| `'luminosity'` | 上の輝度＋下の色相・彩度 |

**`Expression`**（詳細は「式（Expression）を使いこなす」参照）
| 形式 | 説明 |
| --- | --- |
| string | 式ミニ言語。例: `'field.customer.name'`、`'field.price * field.quantity'`、`` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``、`'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | TypeScript関数 `(field, vars, param, report) => unknown`。`report`（ReportContext）は `PAGE_NUMBER`（現在ページ番号・1始まり）、`COLUMN_NUMBER`（現在カラム番号・1始まり）、`REPORT_COUNT`（処理済みレコード数）、`TOTAL_PAGES`（総ページ数。evaluationTime=reportで確定）、`RETURN_VALUE`（型定義上は存在するが現行実装では常にundefined——サブレポートの戻り値は`vars.*`で受け取る）、`format`（組み込みフォーマット関数）、`formatters`（テンプレート登録のカスタムフォーマッタ）を持つ |

**`BorderDef`**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `width` | number |  | 線幅（pt）。全辺共通の既定値 |
| `color` | string |  | 線色。全辺共通の既定値 |
| `style` | `'solid'`＝実線 / `'dashed'`＝破線 / `'dotted'`＝点線 |  | 線種。全辺共通の既定値 |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | 辺ごとの個別指定（後述の**`BorderSideDef`**参照）。全辺共通の指定より優先され、`null`でその辺を非表示にする |

**`BorderSideDef`**（`BorderDef`の`top`/`bottom`/`left`/`right`で使用）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 線幅（pt） |
| `color` | string | ✓ | 線色 |
| `style` | `'solid'`＝実線 / `'dashed'`＝破線 / `'dotted'`＝点線 | ✓ | 線種 |

**`Padding`**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | 各辺のパディング（pt） |

**`HyperlinkDef`**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'reference'`＝外部URL / `'localAnchor'`＝同一文書内のアンカーへ / `'localPage'`＝同一文書内のページ番号へ / `'remoteAnchor'`＝別PDF文書のアンカーへ / `'remotePage'`＝別PDF文書のページへ | ✓ | リンク種別 |
| `target` | Expression | ✓ | リンク先（URL、アンカー名、またはページ番号の式） |
| `remoteDocument` | Expression |  | リモートPDFファイルパス（remotePage / remoteAnchor用） |

**`TextProperties`**（staticText / textField / formField が持つテキスト・段落プロパティ）
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `markup` | `'none'`＝プレーンテキスト / `'styled'`＝スタイル付きマークアップ（`<style forecolor=... isBold=...>`、`<b>`/`<i>`/`<u>`等） / `'html'`＝HTMLサブセット（`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`） |  | マークアップ種別 |
| `hAlign` | `'left'`＝左揃え / `'center'`＝中央揃え / `'right'`＝右揃え / `'justify'`＝両端揃え |  | 水平方向の配置 |
| `vAlign` | `'top'`＝上揃え / `'middle'`＝中央揃え / `'bottom'`＝下揃え |  | 垂直方向の配置 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | テキスト回転（度） |
| `lineSpacing` | LineSpacingDef |  | 行間設定（後述の**`LineSpacingDef`**参照） |
| `letterSpacing` | number |  | 字間（pt）。すべての文字の間に固定量を追加する（負値で詰める） |
| `tracking` | number |  | 字間調整の一種。`letterSpacing`が固定量を一律に足すのに対し、こちらはフォント自身が内蔵する字間調整表（AAT `trak`テーブル）を使い、フォントサイズに応じた設計値で字間を加減する。数値は調整表の「トラック値」で、0＝標準、負＝詰める、正＝広げる（中間値は補間）。`trak`テーブルを持たないフォントでは効果なし |
| `wordSpacing` | number |  | 語間（pt。空白文字への追加幅） |
| `horizontalScale` | number |  | 文字の字形を横方向に伸縮する倍率（1未満＝幅を詰める長体、1超＝幅を広げる平体）。伸縮後の幅で折り返し・行送りが計算される。既定: 1 |
| `baselineOffset` | number |  | ベースライン（文字が乗る基準線）の位置を要素上端からのptで明示する。通常は自動計算されるため指定不要（主にPDF取込みが元の文字位置を再現するために設定する） |
| `firstLineIndent` | number |  | 1行目のインデント（pt） |
| `leftIndent` | number |  | 左インデント（pt） |
| `rightIndent` | number |  | 右インデント（pt） |
| `padding` | Padding |  | パディング |
| `direction` | `'ltr'`＝左→右 / `'rtl'`＝右→左 / `'auto'`＝内容から自動判定（双方向テキスト解析） |  | テキストの方向 |
| `openTypeScript` | string |  | 文字列を字形に変換（シェーピング）する際、フォントのどの文字体系向けルールを使うかを指定するOpenTypeタグ（例: `'latn'`＝ラテン文字、`'arab'`＝アラビア文字）。通常は指定不要（文字内容から自動で処理される） |
| `openTypeLanguage` | string |  | 同じ文字体系でも言語によって字形を変えるフォントで、言語を明示するOpenTypeタグ。通常は指定不要 |
| `openTypeFeatures` | Record<string, number> |  | フォントが内蔵する字形切替機能（フィーチャ）のON/OFF。例: `{ "palt": 1 }`＝和文の字間を詰める、`{ "liga": 0 }`＝合字を無効化、`{ "zero": 1 }`＝スラッシュ付きゼロ。値は0＝無効／1＝有効、字形選択型のフィーチャでは1始まりの代替字形番号 |
| `shrinkToFit` | boolean |  | 自動縮小: 要素の幅・高さに収まるようフォントサイズを縮小する |
| `minFontSize` | number |  | `shrinkToFit`時の最小フォントサイズ（pt）。既定: 4 |
| `fitWidth` | boolean |  | 最長行が要素の内容幅にちょうど収まるようフォントサイズを自動調整する（縮小・拡大の両方向） |
| `outlineText` | boolean |  | テキストをアウトライン化（パス変換）する。既定: `false` |
| `pdfFontMode` | `'embedded'`＝フォントプログラムを埋め込む / `'reference'`＝埋め込まずシステムフォント参照を出力 |  | PDFフォントプログラムの扱い |
| `textPaintMode` | `'fill'`＝塗り / `'stroke'`＝縁取りのみ / `'fillStroke'`＝塗り＋縁取り |  | PDF取込みで保持されるテキスト描画セマンティクス。既定: `fill` |
| `textStrokeColor` | string |  | stroke / fillStroke時のストローク色 |
| `textStrokeWidth` | number |  | テキストのアウトライン線幅（pt） |
| `tabStops` | TabStopDef[] |  | タブストップ定義（後述の**`TabStopDef`**参照） |
| `tabStopWidth` | number |  | 既定のタブ間隔（pt）。未指定時は40pt |
| `wrap` | boolean |  | テキストの折り返し。既定: `true`（undefinedは折り返し有効） |

**`LineSpacingDef`**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'single'`＝1行 / `'1.5'`＝1.5行 / `'double'`＝2行 / `'proportional'`＝倍率指定 / `'fixed'`＝固定値 / `'minimum'`＝最小値 | ✓ | 行間の種別 |
| `value` | number |  | fixed / minimum / proportional のときの値 |

**`TabStopDef`**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `position` | number | ✓ | タブ位置（pt） |
| `alignment` | `'left'` / `'center'` / `'right'` |  | タブ揃え。既定: `left` |

**`FillDef`**（`path`の塗り（`fill`）・ストローク（`stroke`）と、`rectangle`/`ellipse`の塗り（`fill`）に指定可能な型の合併。`rectangle`/`ellipse`の`stroke`は単色文字列のみ）
| 形式 | 説明 |
| --- | --- |
| string | 単色（`#RRGGBB`または`#RRGGBBAA`） |
| PdfSpecialColorDef | 特色（Separation／DeviceN）。金・銀・コーポレートカラーなど特定インキの色指定（後述の表参照） |
| LinearGradientDef | 線形グラデーション——2点を結ぶ軸に沿って色を変化させる（後述の表参照） |
| RadialGradientDef | 円形グラデーション——中心から外側へ色を変化させる（後述の表参照） |
| MeshGradientDef | メッシュグラデーション——自由な形状に沿って色を変化させる（後述の表参照） |
| TilingPatternDef | タイリングパターン——小さな絵柄を敷き詰めて塗る（後述の表参照） |
| FunctionShadingDef | 関数シェーディング——座標から色を計算式で決める（後述の表参照） |

**`GradientStopDef`**（グラデーションの色の切替点。各グラデーションの`stops`で使用）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `offset` | number | ✓ | グラデーション軸に沿った位置。0〜1の比率（0＝開始点、1＝終了点） |
| `color` | string | ✓ | この位置の色（`#RRGGBB`） |
| `opacity` | number |  | この位置の不透明度（0〜1）。既定: 1 |

**`LinearGradientDef`**（線形グラデーション——2点を結ぶ軸に沿って色を変化させる塗り）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | 線形グラデーションであることを示す判別子 |
| `x1` | number |  | 開始点のX座標。**要素境界ボックスの幅に対する比率**（0＝左端、1＝右端）。既定: 0 |
| `y1` | number |  | 開始点のY座標。**要素境界ボックスの高さに対する比率**（0＝上端、1＝下端）。既定: 0 |
| `x2` | number |  | 終了点のX座標（幅に対する比率）。既定: 1（既定値のままなら左→右の水平グラデーション） |
| `y2` | number |  | 終了点のY座標（高さに対する比率）。既定: 0 |
| `stops` | GradientStopDef[] | ✓ | 色の切替点の配列（上表参照） |
| `spreadMethod` | `'pad'`＝端の色で埋める / `'reflect'`＝反転しながら繰り返す / `'repeat'`＝そのまま繰り返す |  | グラデーション範囲の外側の塗り方。既定: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | PDF取込みしたグラデーションを無損失で再出力するための保全メタデータ。手書きテンプレートでは指定不要 |

**`RadialGradientDef`**（円形グラデーション——中心から外側へ色を変化させる塗り）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | 円形グラデーションであることを示す判別子 |
| `cx` | number |  | 外円の中心X座標（要素境界ボックスの幅に対する比率）。既定: 0.5 |
| `cy` | number |  | 外円の中心Y座標（高さに対する比率）。既定: 0.5 |
| `r` | number |  | 外円の半径。**幅・高さの大きい方に対する比率**。既定: 0.5 |
| `fx` | number |  | 焦点（グラデーションが始まる点）のX座標（幅に対する比率）。既定: `cx` |
| `fy` | number |  | 焦点のY座標（高さに対する比率）。既定: `cy` |
| `fr` | number |  | 焦点円の半径（幅・高さの大きい方に対する比率）。既定: 0 |
| `stops` | GradientStopDef[] | ✓ | 色の切替点の配列 |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | 範囲外の塗り方（`LinearGradientDef`と同じ）。既定: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | PDF取込みの無損失再出力用メタデータ。手書きテンプレートでは指定不要 |

**`MeshGradientDef`**（メッシュグラデーション——格子や三角形の頂点ごとに色を与え、自由な形状に沿って色を変化させる塗り）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | メッシュグラデーションであることを示す判別子 |
| `patches` | MeshPatchDef[] |  | 曲面パッチの配列。各パッチは`points`（4×4の制御点網をx,y順の32数値で表現。**座標は要素ローカルのpt**）と`colors`（4隅の色）を持つ |
| `triangles` | MeshTriangleDef[] |  | グラデーション三角形の配列。各三角形は`points`（x0,y0,x1,y1,x2,y2。要素ローカルpt）と`colors`（3頂点の色）を持ち、頂点間で色が補間される |
| `lattice` | MeshLatticeDef |  | 格子形式のメッシュ。`columns`（1行あたりの頂点数、2以上）、`points`（頂点座標の並び。要素ローカルpt）、`colors`（頂点ごとの色、`points`と同順）を持つ |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | PDF取込みしたネイティブメッシュデータのコンパクト表現。手書きテンプレートでは指定不要 |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | 同上のグラデーション三角形版 |
| `pdfShading` | PdfMeshShadingDef |  | PDF取込みの無損失再出力用メタデータ。手書きテンプレートでは指定不要 |

**`TilingPatternDef`**（タイリングパターン——小さな絵柄を敷き詰めて塗る。網掛け・市松模様・ロゴの繰り返しなどに）

表中の「パターン空間」は、パターン専用の座標系です。`matrix`を指定しなければ、要素ローカルのpt座標と一致します。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | タイリングパターンであることを示す判別子 |
| `bbox` | [number, number, number, number] | ✓ | 1枚分の絵柄（パターンセル）の境界ボックス（パターン空間の座標） |
| `xStep` | number | ✓ | セルの水平方向の繰り返し間隔（パターン空間） |
| `yStep` | number | ✓ | セルの垂直方向の繰り返し間隔（パターン空間） |
| `graphics` | TileGraphicDef[] | ✓ | セル内に描くグラフィックの配列。`kind`で判別: `'path'`（SVGパスデータ＋塗り・線）／`'image'`（画像リソースIDを`source`で参照）／`'text'`（フォント・サイズ・色指定のテキスト）／`'group'`（変換・クリップ・不透明度等を伴う入れ子グループ）。座標はいずれもパターン空間 |
| `tilingType` | 1＝一定間隔（描画装置に合わせセルをわずかに歪めてよい） \| 2＝歪みなし（間隔がわずかに変動しうる） \| 3＝一定間隔かつ高速タイリング |  | 敷き詰めの精度モード。既定: 1 |
| `paintType` | `'colored'`＝パターン自身が色を持つ / `'uncolored'`＝使用側の`color`で単色着色する |  | 色の持ち方。既定: `'colored'` |
| `color` | string |  | `'uncolored'`パターン使用時の着色色 |
| `matrix` | [number, number, number, number, number, number] |  | パターン空間から要素ローカル空間へのアフィン変換行列。既定: 単位行列 |

**`FunctionShadingDef`**（関数シェーディング——座標(x, y)から色を計算式で決める塗り。主にPDF取込みで現れる）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | 関数シェーディングであることを示す判別子。`expression`を持つ計算式形式と`sampled`を持つサンプル形式の2変種がある |
| `domain` | [number, number, number, number] | ✓ | `[x0, x1, y0, y1]`の入力領域 |
| `expression` | string | ✓（計算式形式のみ） | PostScript計算式（PDF FunctionType 4）。x, yを受け取りr, g, bを返す。例: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓（サンプル形式のみ） | サンプル済み関数データ（PDF FunctionType 0）。`size`（サンプル格子の寸法）、`bitsPerSample`（1/2/4/8/12/16/24/32）、`range`（出力レンジ）、`samples`（格子点ごとのサンプル値）、任意の`encode`／`decode`を持つ |
| `matrix` | [number, number, number, number, number, number] |  | 入力領域から**要素ローカルpt**への写像行列。既定: 単位行列 |
| `background` | [number, number, number] |  | 領域外の背景色（DeviceRGB成分、0〜1） |
| `bbox` | [number, number, number, number] |  | 描画を制限する境界ボックス |
| `antiAlias` | boolean |  | アンチエイリアスのヒント |
| `paintOperator` | `'pattern'`＝パターンとして塗る（既定） / `'sh'`＝現在のクリップ下で直接描画 |  | PDF出力時の描画方式 |

**`PdfSpecialColorDef`**（特色塗り——金・銀・コーポレートカラーなど、通常のCMYK掛け合わせでは再現できない特定インキで刷るための色指定）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | 特色塗りであることを示す判別子 |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | 特色の色空間。単一インキは`kind: 'separation'`で、`name`（インキ名）・`alternate`（特色インキ非対応の環境で代わりに使うプロセス色空間・下表参照）・`tintTransform`（濃度→代替色の変換をPDF関数で指定。例: `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }`＝濃度0で白・1で青）を持つ。複数インキは`kind: 'deviceN'`で、`names`（インキ名の配列）・`alternate`・`tintTransform`・`subtype`（`'DeviceN'`＝標準／`'NChannel'`＝インキごとの属性情報を追加できる拡張形式）・`colorants`（各インキ名→単一インキ定義の対応表）・`process`・`mixingHints`を持つ |
| `components` | number[] | ✓ | 各インキの濃度値（0〜1） |
| `displayColor` | string | ✓ | 特色インキを持たない画面表示・プレビューで代わりに使う色 |

**`PdfProcessColorSpaceDef`**（プロセス色空間＝CMYKなど標準インキの掛け合わせで表す「通常の色」の色空間。特色の`alternate`やソフトマスクの`colorSpace`で使用し、`kind`で判別する）

| バリアント（`kind`） | 追加プロパティ | 説明 |
| --- | --- | --- |
| `'gray'` | なし | グレースケール（DeviceGray） |
| `'rgb'` | なし | RGB（DeviceRGB） |
| `'cmyk'` | なし | CMYK（DeviceCMYK） |
| `'calgray'` | `whitePoint`・`blackPoint`・`gamma`（すべて必須） | 測色的に校正されたグレー（CalGray） |
| `'calrgb'` | `whitePoint`・`blackPoint`・`gamma`（成分別）・`matrix`（3×3）（すべて必須） | 測色的に校正されたRGB（CalRGB） |
| `'lab'` | `whitePoint`・`blackPoint`・`range`（すべて必須） | L\*a\*b\*色空間 |
| `'icc'` | `components`（1\|3\|4）・`range`・`profile`（ICCプロファイルのバイト列）（すべて必須） | ICCプロファイルに基づく色空間 |

`whitePoint`／`blackPoint`はCIE XYZ色空間の`[x, y, z]`配列で指定します。

### バンド（`bands`）とグループ（`groups`）のプロパティ

テンプレートの`bands`に指定する10種類のバンド（「ページは「バンド」の積み重ね」参照）は、いずれも次の`BandDef`で定義します（`details`のみ`BandDef`の配列）。

**`BandDef`**

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `height` | number | ✓ | バンドの最小高さ（pt）。要素の伸長に応じて高くなる |
| `elements` | ElementDef[] |  | バンドに配置する要素 |
| `startNewPage` | boolean |  | このバンドを必ず新しいページから始める |
| `spacingBefore` | number |  | バンドの前の空き（pt） |
| `spacingAfter` | number |  | バンドの後の空き（pt） |
| `splitType` | `'stretch'`＝ページに収まる分まで印字し、残りを次ページへ続ける（既定） / `'prevent'`＝分割せず、バンド全体を次ページへ送る（新しいページにも収まらない場合は分割される） / `'immediate'`＝要素の途中でも現在位置で即座に分割する |  | ページ境界でバンドが収まらないときの分割方法 |
| `printWhenExpression` | Expression \| null |  | 評価結果が偽のとき、このバンドを出力しない |

**`GroupDef`**（`groups`の各要素）

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | グループ名。変数の`resetGroup`やtextFieldの`evaluationGroup`から参照される |
| `expression` | Expression | ✓ | グループ判定キー。行ごとに評価され、値が変わった位置で前のグループを閉じて新しいグループを開始する |
| `header` | BandDef |  | グループの先頭に出力するバンド |
| `footer` | BandDef |  | グループの末尾に出力するバンド |
| `keepTogether` | boolean |  | グループ全体が残り空間に収まらないとき、新しいページになら収まる場合に改ページしてから開始する |
| `minHeightToStartNewPage` | number |  | ページの残り高さがこの値（pt）未満なら、グループを新しいページから始める |
| `reprintHeaderOnEachPage` | boolean |  | グループが複数ページにまたがるとき、続きの各ページでヘッダーを再印字する |
| `resetPageNumber` | boolean |  | グループ開始時に`PAGE_NUMBER`を1へリセットする |
| `startNewPage` | boolean |  | 各グループを新しいページから始める |
| `startNewColumn` | boolean |  | 各グループを新しいカラムから始める |
| `footerPosition` | `'normal'`＝明細の直後に出力（既定） / `'stackAtBottom'`＝ページ下部に寄せて積む / `'forceAtBottom'`＝常にページ最下部に置き、間の残り空間を消費する / `'collateAtBottom'`＝他のグループのフッターが下部寄せのときだけ一緒に下部へ並ぶ（単独では`'normal'`と同じ） |  | グループフッターの縦位置 |

### スタイル（`styles`）で指定できるプロパティ

テンプレートの`styles`配列で定義し、要素の`style`プロパティから`name`で参照します。フォント・文字揃え・色など文字まわりの指定は、主にスタイルで行います。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | スタイル名（要素の`style`から参照） |
| `parentStyle` | string |  | 親スタイル名。親のプロパティを継承し、自身の指定で上書きする（循環参照は無視） |
| `isDefault` | boolean |  | `true`のスタイルは、`style`未指定の要素に既定として適用される |
| `fontFamily` | string |  | フォントファミリー。既定: `'default'` |
| `fontSize` | number |  | フォントサイズ（pt）。既定: 10 |
| `bold` | boolean |  | 太字。既定: `false` |
| `italic` | boolean |  | 斜体。既定: `false` |
| `underline` | boolean |  | 下線。既定: `false` |
| `strikethrough` | boolean |  | 取り消し線。既定: `false` |
| `forecolor` | string |  | 前景色（`#RRGGBB`または`#RRGGBBAA`）。既定: `#000000` |
| `backcolor` | string |  | 背景色。既定: `transparent` |
| `hAlign` | `'left'`＝左揃え / `'center'`＝中央揃え / `'right'`＝右揃え / `'justify'`＝両端揃え |  | 水平方向の配置。既定: `left` |
| `vAlign` | `'top'`＝上揃え / `'middle'`＝中央揃え / `'bottom'`＝下揃え |  | 垂直方向の配置。既定: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | テキスト回転（度） |
| `padding` | Padding |  | パディング |
| `border` | BorderDef |  | 枠線 |
| `mode` | `'opaque'`＝`backcolor`で背景を塗る / `'transparent'`＝背景を塗らない |  | 表示モード |
| `opacity` | number |  | 不透明度（0.0〜1.0） |
| `variation` | Record<string, number> |  | Variable Fontの軸値（例: `{ wght: 700, wdth: 75 }`） |
| `writingMode` | `'horizontal-tb'`＝横書き / `'vertical-rl'`＝縦書き・右から左へ行送り / `'vertical-lr'`＝縦書き・左から右へ行送り |  | 書字方向 |
| `conditionalStyles` | ConditionalStyleDef[] |  | 条件付きスタイル（下表参照）。条件成立時に該当プロパティを上書きする |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | テキストの方向（ltr＝左→右 / rtl＝右→左 / auto＝内容から自動判定） |
| `openTypeScript` | string |  | 文字列を字形に変換（シェーピング）する際、フォントのどの文字体系向けルールを使うかを指定するOpenTypeタグ（例: `'latn'`＝ラテン文字、`'arab'`＝アラビア文字）。通常は指定不要（文字内容から自動で処理される） |
| `openTypeLanguage` | string |  | 同じ文字体系でも言語によって字形を変えるフォントで、言語を明示するOpenTypeタグ。通常は指定不要 |
| `openTypeFeatures` | Record<string, number> |  | フォントが内蔵する字形切替機能（フィーチャ）のON/OFF。例: `{ "palt": 1 }`＝和文の字間を詰める、`{ "liga": 0 }`＝合字を無効化、`{ "zero": 1 }`＝スラッシュ付きゼロ。値は0＝無効／1＝有効、字形選択型のフィーチャでは1始まりの代替字形番号 |

**`ConditionalStyleDef`**
| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | 適用条件。真のとき以下のプロパティで上書きする |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | StyleDefの同名プロパティと同型 |  | 条件成立時に上書きされる値（意味はStyleDefの各プロパティと同じ） |
| `underline` / `strikethrough` / `vAlign` / `opacity` | StyleDefの同名プロパティと同型 |  | 型定義上は宣言されているが、現行実装では条件成立時の上書きが適用されない |

### PDF取込み・高度なPDF機能の型

ここに挙げる型は、(1) 既存PDFを取り込んだ結果を1バイトも損なわずに再出力するための「保全用」と、(2) PDFのレイヤー・フォームスクリプト・商業印刷の製版指定といった高度な機能を使うためのものです。通常の帳票を手書きするときに指定することはほとんどありません。「PDF取込みで設定される」とある型は、`importPdfPage()`が生成した要素に含まれて現れます。

**`OptionalContentDef`**（PDFのレイヤー機能）

PDFには、内容を「レイヤー」（オプショナルコンテンツグループ、OCG）に載せて、ビューアのレイヤーパネルから表示/非表示・印刷する/しないを切り替えられる機能があります。要素の`optionalContent`にこれを指定すると、その要素がレイヤーに載ります。例: 「社外秘」の透かしをレイヤーにして、印刷時だけ出す。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | ビューアのレイヤーパネルに表示されるレイヤー名 |
| `visible` | boolean |  | 画面表示の初期状態。既定: true |
| `print` | boolean |  | 印刷の初期状態。既定: `visible`に従う |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | PDF取込みで設定される。元PDFのレイヤー定義（OCG）や、複数レイヤーの組み合わせで可視性を決めるメンバーシップ定義（OCMD）の保全。メンバーシップは`groups`（対象レイヤー）と`policy`（`'AllOn'`＝全てONのとき可視 / `'AnyOn'`＝いずれかON / `'AnyOff'`＝いずれかOFF / `'AllOff'`＝全てOFF）、任意の可視性論理式`expression`を持つ |
| `properties` | PdfOptionalContentPropertiesDef |  | PDF取込みで設定される。文書全体のレイヤー構成（全レイヤーの一覧、既定構成、レイヤーパネルの表示順ツリー、排他選択グループ、ロック等）の保全 |

**`PdfRawValueDef`**（PDFの「生値」）

保全用のプロパティの多くは、PDF内部のデータを解釈せずそのまま持ち運ぶために「生値」で保持します。生値は次の形のJavaScript値です: `null`・真偽値・数値はそのまま、PDFの名前は`{ kind: 'name', value: 'DeviceRGB' }`、文字列は`{ kind: 'string', bytes: Uint8Array }`、配列は`{ kind: 'array', items: [...] }`、辞書は`{ kind: 'dictionary', entries: { ... } }`、ストリームは`{ kind: 'stream', entries: { ... }, data: Uint8Array }`。

**`PdfActionDef`**（PDFビューアが実行するアクション）

フォームフィールドの`additionalActions`などで使う、「ビューアに何をさせるか」の定義です。中身はシリアライズ・取込みされるだけで、**コアエンジンが実行することはありません**（実行するのは対応するPDFビューア）。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | アクションの種類。`'JavaScript'`＝スクリプト実行（フォームの入力整形・検証・自動計算はこれ）／`'GoTo'`＝文書内移動／`'GoToR'`＝別文書へ移動／`'GoToE'`＝埋め込み文書へ移動／`'URI'`＝URLを開く／`'Launch'`＝アプリ・ファイル起動／`'Named'`＝定義済み命令（次ページ等）／`'SubmitForm'`＝フォーム送信／`'ResetForm'`＝フォームリセット／`'ImportData'`＝データ取込み／`'Hide'`＝注釈の表示切替／`'SetOCGState'`＝レイヤー表示切替／`'Thread'`・`'Sound'`・`'Movie'`・`'Rendition'`・`'Trans'`・`'GoTo3DView'`・`'RichMediaExecute'`・`'GoToDp'`＝その他のPDF標準アクション |
| `entries` | Record<string, PdfRawValueDef> | ✓ | 種類ごとの設定値を生値（上記**`PdfRawValueDef`**）のまま保持する辞書。例: `'JavaScript'`なら`{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | `'GoTo'`系の移動先。名前付き（`{ kind: 'named', name, representation: 'name' \| 'string' }`）または明示指定（対象ページ＋表示倍率の合わせ方） |
| `structureDestination` | PdfStructureDestinationDef |  | 文書構造要素を基準にした移動先（PDF 2.0） |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | メディア系アクションが対象とする注釈の指定 |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | `'SetOCGState'`で切り替えるレイヤーと操作（`'ON'`／`'OFF'`／`'Toggle'`）の並び |
| `fieldTargets` | PdfActionFieldTargetsDef |  | `'Hide'`／`'SubmitForm'`／`'ResetForm'`が対象とするフィールド名の指定 |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | `'GoToE'`の埋め込みファイル指定（再帰構造） |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | `'Launch'`のプラットフォーム別パラメーター。保持のみで実行されない |
| `articleTarget` | PdfArticleActionTargetDef |  | `'Thread'`の記事スレッド指定 |
| `documentPartIndex` | number |  | `'GoToDp'`の移動先ドキュメントパート番号 |
| `richMediaInstanceIndex` | number |  | リッチメディアのインスタンス番号 |
| `next` | PdfActionDef \| PdfActionDef[] |  | 続けて実行するアクション（連鎖） |

**`PdfFormXObjectDef`**（取り込んだPDF部品のメタデータ保全）

PDF内部では、繰り返し使う描画内容を「Form XObject」という部品にまとめられます。PDF取込みはこの部品を`frame`要素に変換し、部品が持っていた座標系・メタデータをこの型で保持して、再出力時に復元します。手書きテンプレートでは指定不要です。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | 部品の境界ボックス（/BBox） |
| `matrix` | [number, number, number, number, number, number] | ✓ | 部品座標系の変換行列（/Matrix） |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | 元PDFでこの部品が描かれたときに有効だった座標変換 |
| `formType` | 1 |  | 部品の形式番号（PDF仕様上1のみ） |
| `group` | Record<string, PdfRawValueDef> |  | 透明グループ辞書の生値保持 |
| `reference` | Record<string, PdfRawValueDef> |  | 外部PDF参照辞書の生値保持 |
| `metadata` | PdfRawValueDefのストリーム形（`kind: 'stream'`） |  | メタデータストリームの保持 |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | 作成アプリ固有データ（/PieceInfo）の保持 |
| `lastModified` | PdfRawValueDef |  | 最終更新日時の保持 |
| `structParent` / `structParents` | number |  | タグ付きPDF（読み上げ順などの文書構造）との対応キーの保持 |
| `opi` | PdfOpiMetadataDef |  | OPI情報の保持（下表参照） |
| `name` | string |  | 部品名 |
| `measure` | PdfMeasurement |  | 計測情報の保持（下表参照） |
| `pointData` | PdfPointData[] |  | 点群データの保持（下表参照） |

**`PdfSourceVectorDef`**（取り込んだ繰り返し図形の共有定義）

地図の記号のように同じ図形が大量に繰り返されるPDFを取り込むと、図形の輪郭データを「定義1回＋配置N回」の形で保全します。`path`要素の`pdfSourceVector`に現れ、指定時は`d`のパース処理を行いません。手書きテンプレートでは指定不要です。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | 再利用される図形定義の配列。各定義は`commands`（0＝始点移動〔座標2個〕、1＝直線〔2個〕、2＝3次ベジェ曲線〔6個〕、3＝パスを閉じる〔0個〕）と`coords`（コマンド順の座標平坦配列）を持つ |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | 定義の配置の配列。各配置は`definitionIndex`（定義番号）と`matrix`（6要素アフィン行列）を持つ |

**`PdfOpiMetadataDef`**（商業印刷の画像差し替え情報）

OPI（Open Prepress Interface）は、編集中は軽い低解像度画像を置いておき、印刷所の出力時に高解像度画像へ差し替える商業印刷の仕組みです。取り込んだPDFがこの指定を持っていた場合に保全します。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | OPIのバージョン |
| `entries` | Record<string, PdfRawValueDef> | ✓ | OPI辞書の中身をPDF生値のまま保持（差し替え元ファイル名・切り抜き範囲など） |

**`PdfMeasurement`**（図面・地図の計測情報）

図面PDFや地図PDFでは、ビューアの計測ツールが「紙の上の1cmは実物の1mに相当する」といった縮尺で距離・面積を測れます。その縮尺・座標系情報の保全用の型で、直交座標形式（`kind: 'rectilinear'`）と地理空間形式（`kind: 'geospatial'`）があります。

| プロパティ（`'rectilinear'`） | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | 直交座標計測の判別子 |
| `scaleRatio` | string | ✓ | 縮尺の表示テキスト（例: `'1in = 1ft'`） |
| `x` / `y` | PdfNumberFormat[] | ✓（`y`は任意） | X／Y方向の数値表示形式の連鎖（単位ラベル・換算係数・小数/分数表示など）。`y`省略時は`x`を使用 |
| `distance` / `area` | PdfNumberFormat[] | ✓ | 距離／面積の数値表示形式 |
| `angle` / `slope` | PdfNumberFormat[] |  | 角度／勾配の数値表示形式 |
| `origin` | [number, number] |  | 計測原点 |
| `yToX` | number |  | Y→X単位の換算係数 |

| プロパティ（`'geospatial'`） | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | 地理空間計測の判別子 |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | 測地座標系。EPSGコードまたはWKT文字列のいずれか必須 |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | 測地座標の制御点と、それに対応する画像・部品内のローカル制御点（同数） |
| `dimension` | 2 \| 3 |  | 座標の次元。既定: 2 |
| `bounds` | [number, number][] |  | 計測可能領域の多角形 |
| `displayCoordinateSystem` | 同`coordinateSystem` |  | 表示用の座標系 |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | 距離・面積・角度の優先表示単位 |
| `projectedCoordinateSystemMatrix` | 12要素のnumberタプル |  | 投影座標系用の4×4アフィン行列（定数の第4列を省略した行順12要素） |

**`PdfPointData`**（地図の点群データ）

地図PDFに埋め込まれる、名前付きの列（`LAT`＝緯度、`LON`＝経度、`ALT`＝高度など）を持つ点データ表の保全用です。

| プロパティ | 型・設定可能な値 | 必須 | 説明 |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | 列名の配列（一意・非空。`LAT`/`LON`/`ALT`列は数値必須） |
| `rows` | PdfRawValueDef[][] | ✓ | 各行の値。行の長さは`names`と一致 |

**`TransferFunctionDef`**／**`CalculatorFunctionDef`**（製版の階調変換関数）

`frame`の`deviceParams`や`softMask`で使う、値（0〜1）を別の値へ写す関数です。製版で「この濃度のインキはこの濃度で刷る」という階調カーブを表します。`TransferFunctionDef`は`CalculatorFunctionDef`（PostScript計算式。例: `{ expression: '{ 1 exch sub }' }`＝白黒反転）または`PdfFunctionDef`（サンプル値の表／指数補間／それらの結合、というPDFの関数オブジェクト）のいずれかで、使用箇所では`'Identity'`（変換なし）も指定できます。

**`HalftoneDef`**（製版の網点定義）

印刷機は色の濃淡を小さな点（網点）の大きさで表現します。その網点の作り方の指定で、PDF取込みの保全と製版データ作成に使います。`type`で5形式に分かれます:

| 形式 | 主なプロパティ | 説明 |
| --- | --- | --- |
| type 1（スクリーン） | `frequency`（線数）✓・`angle`（角度）✓・`spotFunction`（点の形。`'Round'`等の定義済み名または計算式）✓・`accurateScreens`（高精度スクリーン構築を要求・任意） | 線数・角度・点形状で網点を定義する標準形式（`type`は省略可） |
| type 6（閾値配列） | `width`✓・`height`✓・`thresholds`（幅×高さ個の0〜255）✓ | 閾値の表で網点を直接定義 |
| type 10（角度付き閾値） | `xsquare`✓・`ysquare`✓・`thresholds`✓ | 角度付きセルの閾値定義 |
| type 16（16ビット閾値） | `width`✓・`height`✓・`thresholds`（16ビット値）✓・任意の第2矩形 | 高精度の閾値定義 |
| type 5（色版別コレクション） | `halftones`（`{ colorant: インキ名, halftone: 上記いずれかの形式 }`の配列）✓ | シアン・マゼンタ等の色版ごとに別の網点を割り当てる |

type 5を除く4形式は、任意の`transferFunction`（`'Identity'`または`TransferFunctionDef`）を持てます（type 5では色版ごとの内側のハーフトーン定義がそれぞれ持ちます）。

## 主要API

よく使うAPIを、「何をしたいか」から引けるように1つずつ最小サンプル付きで示します。`template`・`dataSource`・`fontMap`・`fonts`は、チュートリアルで作ったものをそのまま使う前提です。

### 帳票を組み立てる

#### テンプレートとデータから帳票を組み立てたい — `createReport()`

テンプレートとデータをレイアウトし、ページ単位の`RenderDocument`を返します。式は`field.*`、`vars.*`、`param.*`、`PAGE_NUMBER`、`TOTAL_PAGES`などを参照できる安全な組込み式言語で、`eval`や`Function`は使用しません。TypeScriptのコールバック式も選択できます。

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // レイアウト済みのページ数
```

#### IDでテンプレート要素を取得・変更したい — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

どちらのAPIも元テンプレートの要素参照を返します。変更は`createReport()`を呼ぶ前に行ってください。`getElementChildren()`が子要素を返すのは`frame`と`table`（セル内要素）で、それ以外の要素では空配列です。探索範囲の詳細は「IDで要素を取得し、描画前に変更する」を参照してください。

#### `.report`ファイルから帳票を組み立てたい — `createReportFromFile()`（Node.js）

JSONテンプレートを読み込み、画像・サブレポートの相対パスをテンプレートのディレクトリ基準で解決します。

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### 複数の帳票を1冊にまとめたい — `createReportBook()`

表紙・本文など複数のテンプレートを連結し、通しページ番号を振った1つの`RenderDocument`にします。

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### 作成済みの`RenderDocument`同士を連結したい — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

画像IDが衝突した場合は自動でリネームされます。

#### 目次ページを自動で作りたい — `insertTableOfContents()`

帳票内のアンカー（`anchorName`）から目次エントリを収集し、目次ページを先頭へ挿入します。

```ts
const withToc = insertTableOfContents(
  document,
  // TOC page size and margins in pt (this example: A4 portrait)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // font ID (fontMap key) used for the TOC text
  { title: '目次' },
)
```

#### 既存PDFのページ数を知りたい — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### 既存PDFを帳票要素として取り込みたい — `importPdfPage()`

詳細は[既存PDFを帳票要素に変換する](#既存pdfを帳票要素に変換するpdf取込み)を参照してください。

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### 描画・出力する

#### PDFを出力したい — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### 1ページだけプレビューしたい — `renderPage()`

ページ単位の描画です。ブラウザプレビューで表示中のページだけを描くときに使います。

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### 帳票全体を任意のバックエンドへ描画したい — `render()`

`RenderBackend`インターフェースを実装した任意の出力先へ、全ページを描画します。

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### HTML Canvasへ描画したい — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### SVGとして出力したい — `SvgBackend`

1ページにつき1つの完結した`<svg>`文字列を生成します。

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // ページごとの<svg>文字列の配列
```

#### PDF生成を細かく制御したい — `PdfBackend`

ページサムネイルなどのPDF固有オプションはコンストラクタへ渡します。

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]`はi番目のページに適用されます。`thumbnailImageId`（ページ一覧に表示されるサムネイル画像）には、`document.images`に存在する画像IDを指定します。

#### 出来上がったPDF同士を結合したい — `mergePdfFiles()`

Pure TypeScriptのPDFパーサーで複数のPDFを1つに結合します。

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### フォントを扱う

#### フォントファイルを読み込みたい — `Font.load()`

TTF、OTF、TTC、OTC、WOFF、WOFF2、EOTを解析します。

```ts
const font = Font.load(fontBuffer)
```

#### 文字の幅を測りたい — `TextMeasurer`

`Font`のグリフキャッシュを利用した高速な文字計測です。`fontMap`に登録してレイアウトにも使われます。

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### 文字列をグリフ列へ変換したい — `font.shapeText()`

OpenType/AAT（Apple系フォントの拡張仕様）/Graphite（SIL系フォントの拡張仕様）の情報を使って、字形選択・合字・位置調整を適用したグリフ列（グリフ番号と位置・送り幅の並び）を得ます。

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### 印字前に文字化けを検出したい — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### バーコード・SVG・数式・画像を単体で使う

#### バーコードを単体で生成したい — `renderBarcode()`

帳票要素を経由せずに、バーコードの描画ノードを直接生成します。

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### SVGを解析して描画したい — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### 数式を単体で組版したい — `parseMathLaTeX()` / `layoutMathFormula()`

数式用の寸法情報（OpenType MATHテーブル）を内蔵したフォントが必要です（例: STIX Two Math、Latin Modern Math）。

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// arguments: parsed formula, Font object, font ID (fontMap key), font size in pt, text color
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box is the laid-out result; template math elements run this same layout internally
```

#### 画像の寸法を知りたい — `getImageDimensions()`

PNG/JPEG/WebP/AVIFに対応します。

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### PNGをデコードしたい — `decodePng()`

Pure TypeScriptのPNGデコーダーです。

```ts
const png = decodePng(pngBytes) // { width, height, pixels }（RGBA）
```

#### ブラウザでWebP/AVIFを含むPDFを出力したい — `prepareBrowserPdfImageResources()`

JPEGはPDFへ直接収録され、PNGは内蔵デコーダーで処理されます。ブラウザでWebP/AVIFを含むPDFを生成する場合は、`tsreport-core/browser`が`RenderDocument`から実際に参照されている画像だけをブラウザ標準のコーデックで先にデコードし、その結果をPDF生成へ渡します。参照されていない画像はそのまま保持され、デコードされません。

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

Node.jsでWebP/AVIFを展開する場合は、`tsreport-core/node`の`createNodeExternalRasterImageDecoder()`を使用します。

## リソース読込みの制限と画像IDの規則

サーバー運用やライブラリ組込みで必要になったときに参照する詳細規則です。

### 画像・テンプレートの読込みディレクトリを制限する

画像ファイルの読込みは、明示的に許可したディレクトリの中に限定できます。

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()`は、既定でメインテンプレートのディレクトリを相対パスの基準にしますが、後方互換のため読込み範囲そのものは暗黙には制限しません。`resources.fileRoot`を指定すると、画像・メインテンプレート・サブレポートのすべてに同じ制限が適用されます。存在しない画像は各要素の`onError`の指定に従って処理され、許可ディレクトリの外を指す参照（シンボリックリンク経由を含む）は常にエラーになります。

### 画像IDの規則

`RenderDocument`の各画像は、`RenderImage.imageId`（alternateの`imageId`も同様）をキーとして`RenderDocument.images`から引きます。**利用側はこのIDをそのままキーとして使い、パス結合などでキーを組み立て直さないでください。**IDは次の規則で付与されます。

- 相対パスの画像を読み込んでも、IDをサーバーの絶対パスやシンボリックリンク解決後のパスに置き換えません。テンプレートに書いた参照がそのままキーに残ります（絶対パスで書いた場合はその値のまま）
- シンボリックリンク解決後の実体パスは、内部で「同じファイルかどうか」の判定にだけ使います。基準ディレクトリが違っても、同じ実体を指す画像には同じIDを再利用します
- ルート帳票が画像をレンダー時供給に回す構成——`createReport()`を直接使い、対象画像を`resources`にも渡していないため、テンプレートに書いた参照がそのままIDになり、バイト列を後から`renderToPdf(document, { images })`で供給する構成——では、サブレポートが読み込んだ相対パスのローカル画像に、常にホスト非依存の内部IDを割り当てます。式や動的サブレポートの参照は事前に列挙できないため、名前が実際に衝突したかどうかやレイアウトの順序には依存させません。これにより、サブレポートのローカル画像が同名のレンダー時供給用IDを乗っ取ることはありません

### レンダー時の画像供給とalternate

alternateがレイアウト時に解決できなかった場合は、元のimage IDを保持します。そのためCanvas/SVGプレビューは止まらず、`renderToPdf(document, { images })`で後からバイト列を供給できます。明示的に渡した`images`は`document.images`にマージされ、同じIDでは明示的に渡した値が優先されます。PDF生成時も、未供給のalternateは代替候補から除外されるだけで、主画像の描画や帳票全体は停止しません。

### 画像参照の収集範囲

画像参照の収集は、通常の`image`要素だけでなく、alternate、グループのソフトマスク、塗り（fill/stroke）のタイルパターンとその入れ子のソフトマスクまで、すべて同じ仕組みで扱われます。ブラウザでPDF固有のページサムネイル・collectionフォルダーサムネイル・Web Capture画像を使う場合は、同じ`catalog`・`collection`・`pageOptions`を`prepareBrowserPdfImageResources(document, options)`と`renderToPdf(document, options)`の両方へ渡してください（primitive APIなら同じoptionsを`new PdfBackend(options)`へ渡して`render(document, backend)`を呼びます）。これらのWebP/AVIFも、PDF生成前に必要な分だけデコードされます。

## 実行環境

- Node.js 18以上
- ES Modules / CommonJS
- モダンブラウザ
- 実行時依存パッケージなし

WOFF2のBrotli圧縮・展開は、Node.jsとブラウザのどちらでもtsreport-core内蔵のPure TypeScript実装を使用します。外部パッケージ、WASM、ネイティブライブラリは必要ありません。

## 関連プロジェクト

- [tsreport-core](https://github.com/pontasan/tsreport-core)
- [tsreport-editor](https://github.com/pontasan/tsreport-editor)
- [tsreport-sdk](https://github.com/pontasan/tsreport-sdk)
- [tsreport-react](https://github.com/pontasan/tsreport-react)

## License

tsreport-coreは、利用者の選択により[MIT License](./LICENSE-MIT)または[Apache License 2.0](./LICENSE-APACHE)で利用できます（SPDX: `MIT OR Apache-2.0`）。第三者由来コード・データの著作権表示とライセンス条件は[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)を参照してください。
