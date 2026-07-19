# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | Bahasa Indonesia | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**Dari bahasa Jepang, Tionghoa, dan Korea hingga aksara Arab — mesin laporan yang mengubah sistem tulisan dunia menjadi PDF yang indah, dalam TypeScript murni.**

`tsreport-core` menangani parsing font OpenType, penataan huruf teks (menempatkan karakter pada halaman dengan bentuk glif, lebar, dan posisi yang benar), tata letak laporan berbasis band, pratinjau Canvas/SVG, dan pembuatan PDF — semuanya melalui satu model rendering yang konsisten. Paket ini tidak memiliki dependensi runtime sama sekali. Tanpa modul native dan tanpa WASM, satu paket ini berjalan baik di Node.js maupun browser modern.

Contoh kode dalam dokumen ini sengaja menggunakan data bisnis Jepang (penawaran harga, faktur): contoh-contoh tersebut sekaligus menjadi demonstrasi langsung kemampuan penataan huruf CJK mesin ini.

```bash
npm install tsreport-core
```

README ini penuh dengan contoh yang dapat Anda salin dan jalankan apa adanya, mencakup segalanya mulai dari pembuatan PDF pertama Anda hingga seluruh 16 elemen laporan, penulisan vertikal, penataan huruf multibahasa, penyematan font dan konversi teks menjadi outline, serta pratinjau di browser. Jika perkakas laporan masih baru bagi Anda, mulailah dari **Dasar-dasar tata letak laporan** untuk memahami konsep-konsepnya, lalu buat PDF pertama Anda dengan tutorialnya.

## Mendesain laporan WYSIWYG secara visual dengan tsreport-editor

[tsreport-editor](https://github.com/pontasan/tsreport-editor) adalah desainer laporan WYSIWYG yang dibangun di atas tsreport-core. Anda dapat menata band dan elemen secara visual, mengikat data uji JSON, memeriksa pratinjau cetak, mengimpor PDF, dan menghasilkan PDF dengan mesin rendering core yang sama. Video berikut menunjukkan AI mengedit laporan melalui MCP lalu membuka pratinjau akhirnya di Editor.

| Demo bahasa Inggris | Demo bahasa Jepang |
| --- | --- |
| [![Demo WYSIWYG tsreport-editor bahasa Inggris](https://img.youtube.com/vi/CHsNew6yQr4/hqdefault.jpg)](https://youtu.be/CHsNew6yQr4) | [![Demo WYSIWYG tsreport-editor bahasa Jepang](https://img.youtube.com/vi/0I3ljxLUbys/hqdefault.jpg)](https://youtu.be/0I3ljxLUbys) |

## Menata huruf sistem tulisan dunia dengan benar, dengan satu mesin

Laporan multibahasa tidak dapat ditampilkan dengan benar hanya dengan menulis string langsung ke dalam PDF. Pemilihan glif, pengukuran lebar karakter, penempatan posisi, pemenggalan baris, penulisan vertikal, dan penyematan font ke dalam PDF — hanya ketika seluruh rangkaian pemrosesan ini bekerja saling terkait, Anda mendapatkan halaman yang diharapkan.

`tsreport-core` menangani seluruh alur ini, dari parsing font hingga pembuatan PDF.

- **Jepang, Tionghoa, dan Korea** — Tionghoa Sederhana dan Tradisional, Hangul, penanganan tanda baca, dan glif penulisan vertikal semuanya ditata dengan benar berdasarkan data Unicode dan OpenType
- **Aksara Arab dan penataan kanan-ke-kiri (RTL)** — shaping glif kontekstual, penyambungan dan ligatur (beberapa karakter yang melebur menjadi satu bentuk glif), serta pemrosesan dua arah Unicode (kontrol urutan saat teks kanan-ke-kiri bercampur dengan angka dan huruf Latin) ditangani oleh pipeline tata letak yang sama dengan semua aksara lainnya
- **Sistem tulisan kompleks** — substitusi dan penempatan glif yang digerakkan oleh aturan penataan huruf bawaan font (OpenType Layout), karakter penggabung, varian glif (desain alternatif dari karakter yang sama), dan fitur penataan huruf per bahasa didukung
- **Penulisan vertikal** — menangani `vertical-rl` / `vertical-lr`, glif penulisan vertikal, metrik vertikal (data dimensi seperti advance width khusus teks vertikal), dan rotasi karakter
- **Penyematan subset font otomatis** — hanya glif yang benar-benar digunakan (data bentuk per karakter yang tersimpan dalam font) yang disematkan ke dalam PDF, sehingga dokumen tampak sama bahkan di mesin yang tidak memasang font tersebut
- **Konversi teks menjadi outline** — per elemen, teks dapat dikeluarkan sebagai path vektor yang tidak bergantung pada font
- **Referensi font sistem** — untuk alur kerja yang mengandalkan font milik penampil (viewer), Anda juga dapat menghasilkan PDF ringan tanpa font tersemat
- **Mendeteksi teks rusak sebelum terjadi** — `checkGlyphCoverage()` menandai karakter yang tidak ada dalam font, per halaman dan per karakter, sebelum output

Dan penataan huruf teks ini bekerja sebagai satu kesatuan dengan mesin tata letak yang dibangun khusus untuk laporan — karena kemampuan menata karakter dengan benar dan kemampuan memecah halaman dengan benar tidak dapat dipisahkan.

- **Tata letak yang merespons volume teks** — baris memanjang mengikuti banyaknya teks (`stretchWithOverflow`) dan tinggi band menyesuaikan secara otomatis. Nama produk yang panjang tidak akan pernah terpotong
- **Pemisah halaman otomatis yang digerakkan oleh volume data** — saat baris rincian meluap, mesin memulai halaman baru dan mengeluarkan kembali header serta baris judul secara otomatis. Subtotal per grup dan pemisah halaman cukup dengan sebuah deklarasi
- **Tata letak bersarang** — bahkan laporan kompleks yang menggabungkan tabel, tabulasi silang (crosstab), dan subreport ditempatkan secara konsisten oleh mesin tata letak yang sama
- **WYSIWYG (pratinjau = cetak)** — elemen ditetapkan tepat pada koordinat pt yang Anda tentukan, dan pratinjau Canvas/SVG berbagi hasil tata letak yang identik dengan output PDF. Apa yang Anda lihat di layar adalah apa yang Anda dapatkan di kertas

## Mengapa tsreport-core

tsreport-core lahir dari tiga keprihatinan.

**TypeScript tidak memiliki solusi pelaporan yang serius.** Membuat penawaran harga dan faktur adalah kebutuhan bisnis dasar, namun ekosistem TypeScript/Node.js — meskipun memiliki pustaka untuk menggambar PDF tingkat rendah — tidak memiliki apa pun yang layak disebut "mesin laporan": tata letak band, pemisah halaman otomatis, agregasi, dan kesetiaan pratinjau-terhadap-cetak dalam satu paket. Kami ingin mengakhiri praktik menyeret runtime bahasa lain atau produk server eksternal hanya demi laporan.

**Pelaporan adalah kemampuan fundamental, dan semua orang harus dapat menggunakannya secara gratis.** Output laporan bukanlah fitur premium yang hanya ada pada segelintir produk mahal; ia adalah bagian dari fondasi setiap sistem bisnis. Tanpa lisensi komersial yang harus dibeli dan tanpa biaya berbasis pemakaian, semua orang — dari perkakas pribadi hingga produk komersial — harus dapat menggunakan mesin yang sama apa adanya. tsreport-core menerbitkan seluruh fiturnya di bawah lisensi ganda MIT OR Apache-2.0 sebagai perwujudan keyakinan ini.

**Sedikit sekali solusi yang menangani dukungan multibahasa — aksara Asia, aksara Arab, dan lainnya — secara sungguh-sungguh.** Sebagian besar perkakas pelaporan dan PDF dirancang di sekitar teks Latin, memperlakukan penataan huruf Jepang, Tionghoa, dan Korea atau aksara Arab kanan-ke-kiri sebagai urusan belakangan. tsreport-core menjadikan "menata huruf sistem tulisan dunia dengan benar, dengan satu mesin" sebagai tujuan desain sejak hari pertama, mengimplementasikan segalanya dari parsing font hingga penataan huruf dan penyematan PDF secara mandiri.

Motivasi-motivasi ini mewujud dalam tiga kekuatan.

### Dari mesin tata letak hingga pembuatan PDF, lengkap dalam satu paket

Saat halaman dirakit dari template dan data, hasilnya ditangkap dalam satu model rendering bernama `RenderDocument`. Model yang sama dapat dirender ke PDF, Canvas, atau SVG, sehingga tidak perlu memelihara logika tata letak ganda untuk pratinjau layar dan cetak — PDF terlihat persis seperti yang Anda lihat di layar. Tidak perlu merangkai mesin laporan tata letak band dengan pustaka PDF secara terpisah.

### TypeScript murni tanpa dependensi runtime

Parsing font, penataan huruf teks, pembuatan PDF, kompresi DEFLATE, enkripsi, dekode PNG, dan pembuatan barcode semuanya diimplementasikan dalam TypeScript murni. Tanpa modul native dan tanpa proses eksternal, perilakunya identik di setiap lingkungan, dan mengaudit kode yang berjalan selama pembuatan laporan berarti cukup membaca satu paket ini saja.

### Semua yang dibutuhkan laporan, sudah tersedia bawaan

- Tata letak band dengan title, page header, detail, group, summary, dan lainnya
- Tabel, tabulasi silang, subreport, variabel, ekspresi, pemisah halaman, daftar isi, penggabungan beberapa laporan
- Impor PDF yang sudah ada — mengonversi halaman PDF menjadi elemen laporan (`ElementDef`), gaya, gambar, dan informasi font
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, gradien, clipping, transparansi, penataan huruf matematika, gambar
- Enkripsi PDF, PDF/A-1b, 2b, dan 3b (standar internasional untuk pengarsipan jangka panjang), PDF/X-1a (standar internasional untuk penyerahan berkas cetak), bookmark, tautan, formulir, anotasi
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, font variabel (font yang bobot, lebar, dan sumbu lainnya berubah secara kontinu), dan font warna

## Dasar-dasar tata letak laporan

Bagi pembaca yang baru mengenal mesin laporan, bagian ini membahas konsep-konsep dasarnya secara berurutan.

### Premis: laporan dibangun dari "template" plus "data"

Dalam tsreport-core, laporan dibangun dari dua bagian: **template** (definisi tata letak) dan **data** (JSON).

Template tidak berisi nilai aktual. Ia hanya mendefinisikan bingkai-bingkainya — "nama barang di sini; nilainya di sana, dengan lebar dan format ini" — serta referensi ke **field data mana yang akan ditampilkan** pada masing-masing bingkai (ditulis sebagai `field.item`, artinya field `item` dari data).

Nilai aktual diberikan sebagai data JSON. Setiap elemen array `rows` adalah satu baris rincian.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

Saat laporan dibuat, mesin menelusuri `rows` dari atas ke bawah, mengeluarkan tata letak rincian satu kali per baris. Pada contoh di atas, tiga baris rincian dicetak, dan `field.item` menghasilkan りんご, みかん, dan ぶどう secara bergiliran. Jika data bertambah menjadi 10.000 baris, laporan menjadi sepanjang 10.000 baris tanpa mengubah satu karakter pun pada template. Pembagian tugas ini — tata letak tetap, jumlah baris mengikuti data — adalah titik awal dari setiap mesin laporan.

### Halaman adalah tumpukan "band"

Di sisi template, Anda kemudian mendesain halaman sebagai tumpukan strip horizontal yang disebut **band**. Alih-alih menghitung koordinat Y sendiri dan menempatkan elemen di halaman, Anda cukup mendeklarasikan "band mana yang memuat apa," dan mesin merakit halaman secara otomatis sesuai jumlah baris data. Satu halaman memiliki struktur berikut.

```text
┌──────────────────────────┐
│ title                    │ ← satu kali di awal laporan (judul, penerima, …)
├──────────────────────────┤
│ pageHeader               │ ← bagian atas setiap halaman (nama perusahaan, tanggal terbit, …)
├──────────────────────────┤
│ columnHeader             │ ← baris judul untuk baris rincian (barang, kuantitas, nilai, …)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ satu kali per baris dari rows,
│ details                  │ │ diulang sebanyak jumlah barisnya
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← menutup baris rincian (per halaman/kolom)
├──────────────────────────┤
│ pageFooter               │ ← bagian bawah setiap halaman (nomor halaman, …)
└──────────────────────────┘
```

Pada halaman terakhir, setelah `details` yang terakhir, `summary` (total keseluruhan laporan dan sejenisnya) dikeluarkan tepat satu kali. Selain itu ada `background`, yang diletakkan di bawah setiap halaman; `lastPageFooter`, yang hanya dipakai pada halaman terakhir; dan `noData`, yang muncul hanya saat data berjumlah nol baris — total sepuluh jenis band dapat didefinisikan dalam `bands`.

| Band | Kapan dikeluarkan | Penggunaan umum |
| --- | --- | --- |
| `background` | Latar belakang setiap halaman | Tanda air (watermark), bingkai dekoratif |
| `title` | Satu kali di awal laporan | Judul, penerima |
| `pageHeader` | Bagian atas setiap halaman | Nama perusahaan, tanggal terbit |
| `columnHeader` | Sebelum baris rincian (per halaman/kolom) | Baris judul rincian |
| `details` | Satu kali per baris data (`rows`) | Baris rincian |
| `columnFooter` | Setelah baris rincian (per halaman/kolom) | Area subtotal |
| `pageFooter` | Bagian bawah setiap halaman | Nomor halaman |
| `lastPageFooter` | Bagian bawah halaman terakhir (menggantikan `pageFooter` bila ditentukan) | Kata penutup |
| `summary` | Satu kali setelah semua baris rincian | Total keseluruhan, catatan |
| `noData` | Saat data berjumlah nol baris | "Tidak ada data yang cocok" |

Jika Anda juga mendefinisikan `groups`, header dan footer grup disisipkan secara otomatis di mana pun kunci grup berubah, memberikan tata letak seperti "subtotal per departemen, lalu mulai halaman baru."

Anda juga dapat menentukan `columns` pada template (`count` = jumlah kolom, `spacing` = jarak antarkolom dalam pt) untuk mengalirkan area rincian ke dalam beberapa **kolom** vertikal, bergaya koran. Default-nya satu kolom; dalam hal itu, segala yang disebut "per kolom" dalam dokumen ini berarti sama dengan "per halaman." Berpindah ke kolom berikutnya disebut "pemisah kolom" (column break).

### Pemisah halaman terjadi secara otomatis

Saat baris rincian tidak lagi muat pada halaman, mesin secara otomatis menutup halaman itu (mengeluarkan `pageFooter`), memulai halaman berikutnya, mengeluarkan `pageHeader` dan `columnHeader` lagi, lalu melanjutkan mengalirkan sisa baris rincian. Anda tidak pernah perlu menghitung baris atau menghitung sisa tinggi halaman.

Hanya saat Anda ingin mengendalikannya sendiri, gunakan yang berikut.

- Elemen `break` — memaksa pemisah halaman atau pemisah kolom di posisi mana pun
- `startNewPage` pada band — selalu memulai band tersebut pada halaman baru
- `splitType` pada band — saat tinggi tidak mencukupi, pilih apakah band boleh terbelah melintasi halaman di tengah jalan (`stretch`) atau harus dipindahkan utuh ke halaman berikutnya (`prevent`)

### Subreport = laporan lain yang disematkan di dalam laporan

Elemen `subreport` menyematkan sebuah `.report` terpisah secara utuh di dalam tata letak laporan induk. "Cetak daftar pesanan, dan di dalam setiap pesanan cetak item barisnya sebagai tabel" — inilah mekanisme untuk menata **data bersarang** seperti itu.

Misalkan setiap baris `rows` induk (satu pesanan) membawa array `items` berisi item-item barisnya.

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

Tempatkan elemen `subreport` pada band `details` induk dan berikan "`items` milik pesanan ini" melalui `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression`, sesuai namanya, adalah sebuah ekspresi. Untuk memberikan nama file tetap, bungkus dengan `'...'` sebagai literal string di dalam ekspresi (Anda juga dapat menggantinya secara dinamis dengan ekspresi seperti `"field.templatePath"`).

Subreport kemudian **berjalan satu kali untuk setiap baris rincian induk**, dan `items` yang diberikan diperlakukan sebagai `rows` milik subreport itu sendiri. Subreport (`order-items.report`) adalah template independen sepenuhnya: ia memiliki definisi band sendiri dan merujuk tiap item baris melalui `field.name` dan `field.qty`. Di halaman, ia terbentang seperti ini.

```text
┌──────────────────────────────┐
│ details                      │ ← rows induk, baris 1 (pesanan A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← menerima items pesanan ini (2 baris)
│   │   details              │ │ ← items baris 1 (りんご 10)
│   │   details              │ │ ← items baris 2 (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← rows induk, baris 2 (pesanan A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← menerima items pesanan ini (1 baris)
│   │   details              │ │ ← items baris 1 (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

Tabel item baris di dalam faktur, blok rincian yang diulang per pelanggan — "laporan-laporan kecil di dalam laporan" dapat dipisahkan sebagai komponen dan digunakan kembali. Parameter (string judul dan sejenisnya) juga dapat diturunkan dari induk. Bagian **Contoh siap jalan untuk setiap elemen** nanti berisi contoh lengkap yang siap dijalankan untuk persis susunan ini (elemen di sisi induk plus template di sisi subreport).

## Membuat PDF dari file `.report` dan data JSON

File `.report` adalah template laporan: sebuah `ReportTemplate` yang ditulis sebagai JSON. Karena berupa JSON biasa, Anda dapat melacak diff-nya di Git dan menghasilkannya dari bahasa atau perkakas mana pun.

Penyiapan minimalnya adalah tiga file berikut.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

Kedua nama file font mengasumsikan bobot Regular / Bold dari sebuah font Jepang (mis. Noto Sans JP). Gantilah dengan font yang Anda miliki. Penanganan beberapa bahasa dalam satu laporan dibahas nanti di **Membangun laporan multibahasa**.

### 1. Tulis template-nya, `quotation.report`

Koordinat, dimensi, margin, dan ukuran font semuanya dalam **pt (point, 1pt = 1/72 inci ≈ 0.353mm)**, satuan standar PDF. `"size": "A4"` diperlakukan sebagai 595 × 842pt (dimensi ISO 210×297mm yang dikonversi ke pt dan dibulatkan ke bilangan bulat), dan margin 36pt pada contoh ini sekitar 12.7mm.

Satu premis lagi: `fontFamily` dalam `styles` bukanlah nama file font, melainkan sebuah **kunci (nama logis)** yang nanti Anda daftarkan pada `fontMap` dan `fonts` di kode runtime. Menggunakan nama yang sama pada template dan kode (`jp` dan `jpBold` pada contoh ini) adalah pengikat keduanya.

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

`pattern` yang digunakan pada baris rincian adalah penentu format angka/tanggal (`#,##0` = pemisah ribuan, `¥#,##0` = pemisah ribuan dengan tanda yen; lihat "Memformat angka dan tanggal" nanti dalam dokumen ini untuk perinciannya).

### 2. Siapkan datanya, `quotation.test-data.json`

Setiap baris dalam `rows` diikat ke `field.*` pada band rincian, dan `parameters` diikat ke `param.*` untuk seluruh laporan.

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

Pemetaan pengikatannya sebagai berikut.

| JSON | Ekspresi dalam `.report` | Kegunaan |
| --- | --- | --- |
| `rows[n].item` | `field.item` | Baris rincian saat ini |
| `parameters.title` | `param.title` | Argumen untuk seluruh laporan |
| Variabel `grandTotal` | `vars.grandTotal` | Variabel laporan untuk jumlah, cacah, dsb. |
| Konteks halaman | `PAGE_NUMBER` / `TOTAL_PAGES` | Nomor halaman, jumlah total halaman |

### 3. Muat `.report` dan buat PDF-nya

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
  // Buffer Node.js dapat berbagi pool memori yang lebih besar; berikan ke Font.load
  // sebuah ArrayBuffer yang dipotong tepat sebatas byte file ini
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

Font yang sama didaftarkan dua kali, baik di `fontMap` maupun `fonts`, karena keduanya memainkan peran yang berbeda: `fontMap` digunakan untuk pengukuran lebar karakter pada saat tata letak (`TextMeasurer`), sedangkan `fonts` digunakan untuk penyematan font pada saat pembuatan PDF. Daftarkan font yang sama di keduanya, dengan nama kunci yang sama dengan `fontFamily` pada template.

`createReportFromFile()` menyelesaikan path relatif untuk gambar dan subreport terhadap direktori `.report` utama. Jika Anda menentukan `workingDirectory`, direktori itulah yang menjadi basisnya. Untuk membatasi apa yang boleh dibaca, deklarasikan root yang diizinkan secara eksplisit di `resources.fileRoot`; referensi relatif yang keluar dari root tersebut, dan symbolic link yang menunjuk ke luar root, akan ditolak.

## Mendefinisikan template langsung di TypeScript

Alih-alih menggunakan file `.report`, Anda dapat menulis template sebagai objek TypeScript. Dengan pemeriksaan tipe dan pelengkapan otomatis di ujung jari, cara ini cocok untuk menghasilkan template dari kode. Isinya adalah penawaran harga yang sama dengan tutorial. Koordinat dan dimensi dalam pt.

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

### Mencari elemen berdasarkan ID dan mengubahnya sebelum rendering

Berikan `id` sembarang pada sebuah elemen, maka Anda dapat mengambilnya dengan `findElementById()`, seberapa dalam pun ia berada di dalam band atau frame. Nilai kembaliannya bukan salinan, melainkan elemen di dalam `template` itu sendiri, sehingga perubahan apa pun yang dilakukan sebelum `createReport()` tercermin pada tata letak dan rendering.

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

`findElementById()` mencari band biasa, band rincian, header/footer grup, frame, soft mask, dan sel tabel secara depth-first. Jika ID yang sama muncul lebih dari sekali, ia mengembalikan elemen pertama dalam urutan pencarian, jadi jagalah agar ID yang hendak Anda ubah tetap unik di dalam template. Elemen-elemen dalam array yang dikembalikan `getElementChildren()` juga merupakan referensi ke template aslinya.

> File font tidak dibundel bersama paket. Pilih font yang lisensinya sesuai dengan kasus penggunaan, cara distribusi, dan izin penyematan Anda. Satu gaya hanya dapat menyebut satu font. Untuk mencampur karakter beberapa bahasa dalam satu elemen, Anda memerlukan font Pan-CJK yang mencakup semuanya dalam satu file (font yang membundel karakter Jepang, Tionghoa, dan Korea; mis. Source Han Sans, Noto Sans CJK). Untuk menggunakan font terpisah per bahasa, pisahkan elemen per bahasa dan ganti gayanya, seperti pada bagian berikutnya, "Membangun laporan multibahasa."

## Membangun laporan multibahasa

Setiap gaya hanya dapat menyebut tepat satu font, dan tidak ada fallback otomatis antarfont. Pola dasar laporan multibahasa dengan demikian adalah **memuat satu font per bahasa dan menerapkan gaya bahasa tersebut pada elemen-elemen bahasa itu**.

Cuplikan berikut berasal dari penawaran harga yang menampilkan bahasa Jepang dan Tionghoa Sederhana berdampingan. Pertama, muat font untuk masing-masing bahasa.

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

Pada template, terapkan gaya `ja` pada teks bahasa Jepang dan gaya `zh` pada teks bahasa Tionghoa, dengan memisahkan elemen per bahasa.

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

Datanya pun membawa satu field per bahasa.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

Pengecualiannya adalah **satu field yang bahasanya tidak diketahui sampai runtime**, seperti kotak keterangan bebas. Karena field semacam itu tidak dapat dipecah menjadi elemen per bahasa, jawaban praktisnya adalah menetapkan — hanya untuk gaya itu — sebuah font Pan-CJK yang mencakup banyak sistem tulisan dalam satu file (Source Han Sans, Noto Sans CJK, dan sejenisnya). Bagaimanapun juga, `checkGlyphCoverage()` mendeteksi setiap celah cakupan font sebelum output.

## Memilih mode output font per elemen teks

Bahkan dalam satu laporan, Anda dapat menentukan mode output per `staticText` atau `textField`: teks tersemat yang dapat dicari untuk isi utama, outline untuk logo, referensi font sistem untuk teks baku.

| Mode | Cara menentukan | Keadaan dalam PDF | Cocok untuk |
| --- | --- | --- | --- |
| Penyematan subset | `pdfFontMode: 'embedded'` (default) | Menyematkan glif yang digunakan plus program font. Teks dapat dipilih dan dicari | Distribusi, pengarsipan jangka panjang, pencetakan, laporan multibahasa |
| Konversi menjadi outline | `outlineText: true` | Mengonversi bentuk glif menjadi path vektor. Tidak membawa informasi font | Logo, materi siap cetak — teks yang bentuknya harus dibekukan persis |
| Referensi font sistem | `pdfFontMode: 'reference'` | Tidak menyematkan font; hanya mencatat nama font dan karakternya | PDF ringan untuk distribusi internal di mana lingkungan font terkendali |

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

Penyematan subset adalah mode yang direkomendasikan untuk mempertahankan bentuk glif terlepas dari lingkungan tujuan. Referensi font sistem memerlukan font yang kompatibel di mana pun PDF dibuka, dan tampilannya dapat berbeda dari satu lingkungan ke lingkungan lain. Teks yang dikonversi menjadi outline tidak dapat dipilih atau dicari sebagai teks biasa.

## Penulisan vertikal

Cukup tentukan `writingMode` pada sebuah gaya, maka teks ditata secara vertikal menggunakan glif penulisan vertikal dan data dimensi khusus vertikal (metrik vertikal — advance width dan sejenisnya). `vertical-rl` memajukan baris dari kanan ke kiri; `vertical-lr` memajukannya dari kiri ke kanan.

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

## Mempratinjau laporan yang persis sama di browser

`RenderDocument` yang Anda bangun untuk PDF juga dapat langsung dirender ke Canvas. Pratinjau dan cetak berbagi hasil tata letak yang sama, sehingga "layar dan kertas tampak berbeda" sama sekali tidak mungkin terjadi. Dikombinasikan dengan tata letak berbasis pt yang tetap, inilah fondasi pengalaman pratinjau dan penyuntingan WYSIWYG (penyematan font adalah default; hanya mode referensi font sistem yang tampilannya bergantung pada lingkungan penampil). Satu panggilan `renderPage()` menggambar halaman, termasuk penyiapan dan pembersihan halaman.

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
  scale: 1.5, // skala tampilan: 1.0 menggambar 1pt sebagai 1px
  devicePixelRatio: window.devicePixelRatio, // menjaga teks dan garis tetap tajam pada layar DPI tinggi
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

Jika Anda membangun UI pratinjau di React, tersedia juga paket `tsreport-react`.

## Menggunakan mesin font secara mandiri

Bahkan tanpa membangun laporan, Anda dapat menggunakan tiap kemampuan secara mandiri: parsing font, shaping (mengonversi string menjadi urutan dan posisi glif yang benar-benar digambar), pengukuran teks, dan pembuatan subset.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: lebar string dalam pt pada ukuran 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // ID glif dan posisinya setelah shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: data path Bezier

console.log(measurement.width, shaped, glyph.outline)
```

## Mengonversi PDF yang sudah ada menjadi elemen laporan (impor PDF)

`importPdfPage()` mem-parsing satu halaman dari PDF yang sudah ada dan mengonversinya menjadi array elemen laporan tsreport-core (`ElementDef`). Ini bukan sekadar penampil: teks masuk sebagai `staticText`, gambar sebagai `image`, bentuk sebagai `path` — komponen yang dapat Anda sunting dan susun ulang langsung di mesin laporan ini.

Ambil PDF formulir yang selama ini Anda jalankan di atas kertas, atau PDF yang dihasilkan sistem lain, dan gunakan sebagai basis — menambahkan field penggabungan data, menata ulang tata letaknya. Inilah pintu masuk untuk **mengubah aset laporan yang sudah ada menjadi template**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: array elemen laporan (staticText / image / path, …)
// page.styles:   definisi gaya teks yang dirujuk oleh elemen
// page.images:   data gambar yang dirujuk oleh elemen
// page.fonts:    informasi tentang font yang dirujuk
console.log(pageCount, page.width, page.height, page.elements.length)
```

`elements` dan `styles` hasil impor dapat langsung ditempatkan ke dalam band template. Kata sandi untuk PDF terenkripsi, impor anotasi, konversi teks hasil impor menjadi outline, dan lainnya dikendalikan melalui `PdfImportOptions`.
## Menguasai ekspresi

Segala yang "dinamis" dalam laporan ditulis sebagai ekspresi: konten yang dicetak `textField`, kondisi cetak di `printWhenExpression`, data barcode, path gambar, data yang diberikan ke subreport — setiap properti bertipe `Expression` menerima bahasa ekspresi yang sama.

Ekspresi hadir dalam dua bentuk.

- **Ekspresi string** — string seperti `"field.price * field.quantity"`. Ini adalah subset aman dari JavaScript yang ditafsirkan oleh parser khusus; `eval` dan `new Function` tidak pernah digunakan. Template tetap dapat disimpan sebagai JSON (file `.report`)
- **Ekspresi callback** — fungsi TypeScript berbentuk `(field, vars, param, report) => …`. Anda mendapatkan seluruh kekuatan bahasanya, tetapi template tidak lagi dapat disimpan sebagai JSON (ini mengasumsikan Anda menyimpan template dalam TypeScript)

Kami menyarankan untuk melihat dulu sejauh mana ekspresi string dapat mencukupi kebutuhan Anda, dan beralih ke callback hanya saat tidak memadai.

### Nilai yang dapat dirujuk dalam ekspresi

| Nama | Deskripsi |
| --- | --- |
| `field.*` | Baris data saat ini. Akses bersarang seperti `field.customer.name` didukung |
| `vars.*` | Variabel (nilai agregat yang didefinisikan dalam `variables`, dijelaskan di bawah). `var.*` bekerja sama |
| `param.*` | Nilai untuk seluruh laporan: nilai yang diberikan lewat `parameters` sumber data dan `defaultValue` dari `parameters` template. Dalam subreport, parameter yang diberikan dari induk juga muncul di sini |
| `PAGE_NUMBER` | Nomor halaman saat ini (berbasis 1) |
| `COLUMN_NUMBER` | Nomor kolom saat ini (berbasis 1) |
| `REPORT_COUNT` | Jumlah baris data yang telah diproses |
| `TOTAL_PAGES` | Jumlah total halaman. **Jika dirujuk apa adanya, hasilnya adalah "jumlah halaman sejauh ini"**, jadi untuk mencetak jumlah total halaman final, kombinasikan dengan `evaluationTime: 'report'` atau `'auto'` (dijelaskan di bawah) |

Merujuk field yang tidak ada tidak melempar error; ia dievaluasi menjadi `undefined` (bahkan saat bagian tengah dari `field.a.b` bernilai `null`, ia dengan aman mengembalikan `null`).

### Sintaks yang tersedia dalam ekspresi string

| Kategori | Yang tersedia |
| --- | --- |
| Literal | angka (`1200`, `0.5`), string (`'見積'` atau `"見積"`, dengan escape seperti `\n`), `true` / `false` / `null` / `undefined` |
| Template literal | `` `合計 ${vars.total} 円` `` — ekspresi penuh boleh muncul di dalam `${}` |
| Aritmetika | `+` (penjumlahan numerik dan penyambungan string), `-`, `*`, `/` |
| Perbandingan | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| Logika | `&&`, `\|\|`, `!` (evaluasi hubung singkat, seperti pada JavaScript) |
| Nullish coalescing | `??` — mengembalikan sisi kanan saat sisi kiri null/undefined |
| Kondisional (ternary) | `condition ? valueIfTrue : valueIfFalse` |
| Lainnya | unary `-` / `+`, tanda kurung `( )`, akses anggota dengan notasi titik (nama properti boleh berbahasa Jepang: `field.顧客名`) |
| Fungsi bawaan | `format(value, pattern)` = pemformatan (dijelaskan di bawah) / `round(value, digits?)` = pembulatan setengah ke atas / `roundUp`, `roundDown`, `roundHalfEven` (pembulatan banker), `ceil`, `floor`, `trunc` (untuk masing-masing, argumen kedua adalah jumlah tempat desimal, 0 jika dihilangkan) / `now()` = waktu saat ini |

**Tidak tersedia**: `==` / `!=` (gunakan `===` / `!==`), `%` dan `**`, notasi bracket (`field['a-b']`) dan pengindeksan array, pemanggilan metode (`field.name.toUpperCase()` gagal saat evaluasi — satu-satunya fungsi yang dapat dipanggil adalah fungsi bawaan di atas), penugasan (assignment), definisi fungsi, `new`, optional chaining (`?.` — lagipula tidak diperlukan, karena null di tengah rantai tidak pernah melempar error). Saat Anda memerlukan salah satunya, gunakan ekspresi callback.

Pembatasan ini ada demi keamanan. Ekspresi string ditafsirkan oleh parser khusus dan tidak pernah dieksekusi sebagai kode, sehingga template yang diterima dari pihak luar tidak dapat menyelundupkan kode sembarangan.

### Mencetak hasil perhitungan

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

Data contoh:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

Ini mencetak `¥3,960`.

### Membangun string

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

Nilai yang disematkan dalam `${}` milik template literal diubah menjadi string lalu disambung. **null menjadi string `"null"`**, jadi tambahkan `?? ''` pada nilai yang mungkin kosong, seperti pada contoh.

### Mengganti konten berdasarkan kondisi

Gunakan operator ternary untuk mengganti apa yang dicetak.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

Saat yang ingin Anda ubah adalah *apakah* sesuatu ditampilkan, bukan *apa* yang ditampilkan, gunakan `printWhenExpression` yang berlaku umum untuk semua elemen (lihat "Mencetak elemen hanya saat kondisi terpenuhi"). Untuk mengganti gaya (warna, tebal) berdasarkan kondisi, tentukan ekspresi kondisi berbentuk sama pada `conditionalStyles` di definisi gaya.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### Memformat angka dan tanggal — `format` dan `pattern`

`textField` dapat memformat hasil ekspresi pada saat cetak melalui properti `pattern`. Untuk memformat sebagian nilai di dalam ekspresi, gunakan fungsi bawaan `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

Pola angka menggabungkan `#` (tampilkan digit jika ada), `0` (isi dengan nol), dan `,` (pemisah ribuan), serta boleh membawa prefiks dan sufiks. Pembulatannya setengah ke atas (half-up).

| Pola | Input | Output |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

Token pola tanggal adalah `yyyy` (tahun 4 digit), `MM` / `M` (bulan dengan nol di depan / bulan), `dd` / `d` (hari dengan nol di depan / hari), `HH` (jam dengan nol di depan, format 24 jam), `mm` (menit), dan `ss` (detik). Nilai null/undefined menghasilkan string kosong.

Untuk format di luar ini (tanggal era Jepang, nama hari, penanganan digit mata uang, dan sebagainya), daftarkan fungsi TypeScript bernama pada `formatters` milik template dan tulis namanya di `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// Di sisi elemen: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` pertama-tama mencari formatter terdaftar dengan nama itu, dan ditafsirkan sebagai format bawaan jika tidak ditemukan. Formatter adalah fungsi, sehingga template yang memakai fitur ini disimpan dalam TypeScript, bukan JSON.

### Mencetak total, rata-rata, dan cacah — variabel (`variables`)

Agregasi yang melintasi baris-baris rincian didefinisikan dalam `variables` pada template. Setiap kali satu baris data diproses, variabel memasukkan hasil `expression`-nya ke dalam agregatnya, dan ekspresi dapat merujuk nilai saat ini sebagai `vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

Tempatkan `textField` dengan `"expression": "vars.pageTotal"` pada band `pageFooter` untuk subtotal halaman, dan satu lagi dengan `"expression": "vars.grandTotal"` pada band `summary` untuk total keseluruhan.

**Daftar properti (setiap entri `variables`)**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nama variabel, dirujuk dari ekspresi sebagai `vars.name` |
| `expression` | Expression | ✓ | Dievaluasi untuk setiap baris; hasilnya dimasukkan ke dalam agregat |
| `calculation` | `'sum'` = total / `'average'` = rata-rata / `'count'` = cacah / `'distinctCount'` = cacah nilai unik / `'min'` = minimum / `'max'` = maksimum / `'first'` = nilai pertama / `'nothing'` = ditimpa setiap baris (nilai terakhir) | ✓ | Metode agregasi |
| `resetType` | `'report'` = terus mengagregasi sepanjang seluruh laporan (tanpa reset; default) / `'page'` = reset per halaman / `'column'` = reset per kolom / `'group'` = reset per grup yang disebut di `resetGroup` / `'none'` = tidak pernah reset, seperti `'report'`, tetapi di bawah evaluasi tertunda (`evaluationTime`) nilainya tetap terpaku pada saat elemen ditempatkan (tidak digantikan kemudian oleh agregat final) |  | Lingkup reset agregasi |
| `resetGroup` | string |  | Nama grup target saat `resetType: 'group'` |
| `incrementCondition` | Expression |  | Jika diatur, baris yang hasil evaluasinya falsy tidak dimasukkan ke dalam agregat (agregasi bersyarat) |
| `initialValue` | Expression |  | Nilai awal pada inisialisasi dan pada setiap reset |

Dengan `incrementCondition`, agregasi bersyarat seperti "jumlahkan hanya kategori tertentu" cukup dengan satu variabel:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

Untuk mengagregasi hasil eksekusi subreport di induknya, gunakan `returnValues` milik elemen `subreport`, yang menulis balik variabel anak ke `vars.*` induk (lihat daftar properti `subreport`).

### Mencetak nomor halaman dan jumlah total halaman

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

Kuncinya adalah `evaluationTime: 'auto'`. Ekspresi biasanya dievaluasi pada saat elemen ditempatkan, tetapi pada titik itu jumlah total halaman final belum diketahui. Dengan `'auto'`, ekspresi dianalisis secara statis dan **setiap rujukan dievaluasi pada waktunya masing-masing yang tepat** — `PAGE_NUMBER` saat halaman difinalkan, `TOTAL_PAGES` saat laporan selesai. Karena `'auto'` perlu menganalisis ekspresi, ia hanya tersedia untuk ekspresi string (menentukannya pada ekspresi callback melempar error).

### Melampaui ekspresi string — ekspresi callback

Jika template Anda didefinisikan dalam TypeScript, Anda dapat menulis fungsi langsung di mana pun `Expression` diterima. Ia menerima empat argumen, `(field, vars, param, report)`; melalui `report` Anda dapat menjangkau nilai bawaan seperti `PAGE_NUMBER`, fungsi `format`, dan `formatters` yang terdaftar.

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

Pemanggilan metode, ekspresi reguler, fungsi eksternal — apa pun yang dapat Anda tulis dalam TypeScript tersedia. Ada dua kompromi: template tidak lagi dapat disimpan atau dipindahkan sebagai JSON, dan `evaluationTime: 'auto'` tidak tersedia (nilai eksplisit seperti `'report'` tetap berfungsi).

### Apa yang terjadi saat ekspresi gagal

- **Kesalahan sintaks dan konstruksi terlarang** (pemanggilan metode, dll.) melempar `ExpressionLanguageError` dengan informasi posisi, yang merambat apa adanya ke pemanggil `createReport()`. Ia tidak pernah ditelan menjadi sel kosong
- **Rujukan ke field atau variabel yang tidak ada** bukan error; keduanya dievaluasi menjadi `undefined`. Pada `textField`, string kosong dicetak saat `blankWhenNull: true` diatur; tanpa itu, yang dicetak adalah string `null`
- Untuk memvalidasi ekspresi yang dipasok pengguna sebelum dieksekusi, `validateExpressionSource(source)` mengembalikan hasil pemeriksaan sintaks (sebuah error, atau `null`)

## Contoh siap jalan untuk setiap elemen

Berikut ke-16 elemen yang disediakan `ElementDef`. Setiap elemen menerima `x`, `y`, `width`, dan `height` (dalam pt, 1pt = 1/72 inci) dan ditempatkan ke dalam `elements` milik sebuah band atau sebuah `frame`.

| Yang ingin Anda lakukan | Elemen |
| --- | --- |
| Mencetak teks tetap | `staticText` |
| Mencetak data, variabel, atau hasil ekspresi | `textField` |
| Menggambar garis | `line` |
| Menggambar persegi panjang atau kotak bersudut bulat | `rectangle` |
| Menggambar lingkaran atau elips | `ellipse` |
| Menggambar bentuk vektor sembarang | `path` |
| Menempatkan gambar | `image` |
| Mengelompokkan beberapa elemen di dalam bingkai | `frame` |
| Mencetak tabel | `table` |
| Mencetak tabulasi silang | `crosstab` |
| Menyematkan satu laporan di dalam laporan lain | `subreport` |
| Mencetak barcode atau QR code | `barcode` |
| Mencetak rumus matematika | `math` |
| Mencetak SVG | `svg` |
| Membuat formulir PDF yang dapat diisi | `formField` |
| Memaksa pemisah halaman atau kolom di mana pun | `break` |
| Mencetak elemen hanya saat kondisi terpenuhi | `printWhenExpression` (atribut yang berlaku umum untuk semua elemen) |

Di bawah ini, setiap elemen mendapat satu definisi yang dapat langsung Anda masukkan ke dalam array `elements` sebuah band, plus data contoh untuk elemen yang menggunakan ekspresi. Di akhir bagian tiap elemen terdapat daftar properti yang khusus untuk elemen tersebut. Untuk properti yang berlaku umum bagi semua elemen (posisi, warna, kondisi cetak, dan sebagainya) dan properti gaya, lihat "Referensi properti elemen" di bawah.

### Mencetak teks tetap — `staticText`

Mencetak string yang ditulis dalam template, persis apa adanya. Gunakan untuk judul dan label.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | Tipe elemen |
| `text` | string | ✓ | String tetap yang dicetak |
| `actualText` | string |  | Teks pengganti untuk saat karakter yang terlihat berbeda dari teks yang diperoleh lewat salin dan pencarian (PDF /ActualText). Terutama digunakan oleh impor PDF untuk mempertahankan pengaturan PDF sumber |
| `hyperlink` | HyperlinkDef |  | Hyperlink (lihat **`HyperlinkDef`** di bagian properti umum) |
| `anchorName` | string |  | Nama anchor. Didaftarkan sebagai tujuan untuk bookmark dan tautan dalam dokumen (`hyperlink` bertipe `'localAnchor'`) |
| `bookmarkLevel` | number |  | Tingkat hierarki (1 = tingkat teratas, 1–6) untuk mencantumkan teks elemen ini dalam daftar isi (bookmark) yang ditampilkan di bilah samping penampil PDF |

Catatan: sebagai tambahan, semua properti umum elemen dan setiap properti `TextProperties` dapat ditentukan.

### Mencetak data dan hasil ekspresi — `textField`

Mencetak hasil evaluasi `expression`. Ia dapat merujuk `field.*` (data), `vars.*` (variabel), `param.*` (parameter), `PAGE_NUMBER`, dan lainnya, dan template literal memungkinkan Anda membangun string. Untuk bahasa ekspresi selengkapnya, lihat "Menguasai ekspresi". Gunakan `pattern` untuk pemformatan angka/tanggal dan `stretchWithOverflow` agar tinggi bertambah mengikuti banyaknya teks.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

Data contoh:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | Tipe elemen |
| `expression` | Expression | ✓ | Ekspresi yang mengembalikan nilai untuk dicetak |
| `pattern` | string |  | Pola format. Formatter kustom yang terdaftar pada template (nama pada `formatters`) diprioritaskan; jika tidak ada, nilai diformat dengan formatter bawaan |
| `blankWhenNull` | boolean |  | Cetak string kosong saat hasil ekspresi null/undefined (tanpa ini, string `'null'` yang dicetak) |
| `stretchWithOverflow` | boolean |  | Saat konten tidak muat dalam height, panjangkan tinggi elemen agar sesuai dengan kontennya |
| `evaluationTime` | `'now'` = evaluasi segera di tempat (default) / `'band'` = evaluasi saat band difinalkan / `'column'` = evaluasi di akhir kolom / `'page'` = evaluasi di akhir halaman / `'group'` = evaluasi saat grup yang disebut di `evaluationGroup` ditutup / `'report'` = evaluasi di akhir laporan (TOTAL_PAGES dll. sudah final) / `'auto'` = evaluasi setiap variabel dan nilai bawaan yang dirujuk ekspresi secara individual pada waktu reset-nya masing-masing (hanya ekspresi string; ekspresi callback melempar error) |  | Kapan ekspresi dievaluasi. Dengan nilai apa pun selain default, area terlebih dahulu dipesan kosong saat penempatan dan diisi begitu nilainya final pada waktu yang bersangkutan. Penggunaan umum: menampilkan total grup mendahului grupnya (`'group'`), mencetak jumlah total halaman final (`'report'`) |
| `evaluationGroup` | string |  | Nama grup target saat `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = baris yang tidak muat tidak digambar (default; identik dengan `'truncate'` pada implementasi saat ini) / `'truncate'` = potong teks yang tidak muat baris demi baris / `'ellipsisChar'` = pangkas baris terakhir pada batas karakter dan tambahkan `...` / `'ellipsisWord'` = pangkas baris terakhir pada batas kata dan tambahkan `...` |  | Penanganan teks yang tidak muat pada tingginya saat `stretchWithOverflow` nonaktif. Default: `none` |
| `hyperlink` | HyperlinkDef |  | Hyperlink (lihat **`HyperlinkDef`** di bagian properti umum) |
| `anchorName` | string |  | Nama anchor. Didaftarkan sebagai tujuan untuk bookmark dan tautan dalam dokumen (`hyperlink` bertipe `'localAnchor'`) |
| `bookmarkLevel` | number |  | Tingkat hierarki (1 = tingkat teratas, 1–6) untuk mencantumkan teks elemen ini dalam daftar isi (bookmark) yang ditampilkan di bilah samping penampil PDF |

Catatan: sebagai tambahan, semua properti umum elemen dan setiap properti `TextProperties` dapat ditentukan. `isPrintRepeatedValues: false` dihormati oleh elemen ini (menekan pencetakan nilai identik yang berurutan).

### Menggambar garis — `line`

Contoh ini adalah garis horizontal dengan tinggi 0. `lineStyle` menerima `dashed` dan lainnya selain `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | Tipe elemen. Ruas garis digambar dari kiri-atas elemen `(x, y)` ke kanan-bawahnya `(x+width, y+height)` (`height: 0` menghasilkan garis horizontal, `width: 0` garis vertikal, keduanya bukan nol garis diagonal) |
| `lineWidth` | number |  | Lebar garis (pt). Default: 1 |
| `lineStyle` | `'solid'` = utuh / `'dashed'` = putus-putus / `'dotted'` = titik-titik |  | Gaya garis. Default: solid |
| `lineColor` | string |  | Warna garis. Default: `forecolor` milik elemen, atau `#000000` jika itu pun tidak ada |

### Menggambar persegi panjang atau kotak bersudut bulat — `rectangle`

`cornerRadii` memungkinkan Anda membulatkan tiap sudut secara individual.

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

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | Tipe elemen |
| `radius` | number |  | Radius sudut (pt, berlaku untuk semua sudut) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | Radius per sudut (pt) |
| `fill` | FillDef |  | Isian (lihat **`FillDef`** di bagian properti umum). Default: `backcolor` milik gaya (bila bukan `transparent`) |
| `stroke` | string |  | Warna garis tepi. Default: `forecolor` milik gaya |
| `strokeWidth` | number |  | Lebar garis tepi (pt). Default: 1 |

### Menggambar lingkaran atau elips — `ellipse`

Menggambar elips yang terpatri di dalam lebar dan tinggi elemen.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | Tipe elemen. Menggambar elips yang terpatri dalam kotak pembatas elemen (pusat `(x+width/2, y+height/2)`, radius `width/2` × `height/2`) |
| `fill` | FillDef |  | Isian (lihat **`FillDef`** di bagian properti umum). Tanpa isian jika dihilangkan |
| `stroke` | string |  | Warna garis tepi. Tanpa garis tepi jika dihilangkan |
| `strokeWidth` | number |  | Lebar garis tepi (pt). Default: 1 (saat `stroke` diatur) |

### Menggambar bentuk vektor sembarang — `path`

Tuliskan sintaks path SVG di `d` dan sistem koordinatnya di `viewBox`. Bentuk diskalakan agar pas dengan bingkai elemen.

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

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | Tipe elemen |
| `d` | string | ✓ | Data path SVG (M/L/C/Z dsb.). Koordinat adalah pt lokal elemen |
| `pdfSourceVector` | PdfSourceVectorDef |  | Dihasilkan oleh impor PDF untuk mempertahankan bentuk yang muncul berulang kali (simbol peta, dsb.) sebagai "satu definisi + N penempatan" (lihat **`PdfSourceVectorDef`** nanti). Saat diatur, `d` tidak di-parse. Tidak diperlukan pada template yang ditulis tangan |
| `affineTransform` | [number, number, number, number, number, number] |  | Matriks transformasi affine yang memetakan koordinat path ke koordinat lokal elemen sebelum digambar. `[a, b, c, d, e, f]` memberikan `x' = a·x + c·y + e`, `y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. Koordinat path diskalakan dari wilayah ini ke lebar dan tinggi elemen |
| `fill` | FillDef |  | Isian (lihat **`FillDef`** di bagian properti umum). Tanpa isian jika dihilangkan |
| `fillRule` | `'nonzero'` (default) / `'evenodd'` |  | Aturan yang menentukan wilayah mana yang dihitung sebagai "bagian dalam" untuk path yang berpotongan sendiri atau bersarang. Untuk melubangi bentuk seperti donat, `'evenodd'` adalah pilihan yang andal |
| `fillOpacity` | number |  | Opasitas isian (0.0–1.0) |
| `stroke` | FillDef |  | Goresan (warna solid maupun gradien dan lainnya). Tanpa goresan jika dihilangkan |
| `strokeWidth` | number |  | Lebar goresan (pt). Default: 1 (saat `stroke` diatur) |
| `strokeOpacity` | number |  | Opasitas goresan (0.0–1.0) |
| `strokeLinecap` | `'butt'` = terpotong di ujung / `'round'` = ujung membulat / `'square'` = ujung persegi (diperpanjang setengah lebar garis) |  | Bentuk ujung garis |
| `strokeLinejoin` | `'miter'` = miter (runcing) / `'round'` = membulat / `'bevel'` = terpotong miring |  | Bentuk sambungan garis |
| `strokeMiterLimit` | number |  | Batas miter. Default: 10 |
| `strokeDasharray` | number[] |  | Pola putus-putus (array panjang goresan dan celah, pt) |
| `strokeDashoffset` | number |  | Offset awal ke dalam pola putus-putus (pt) |

### Menempatkan gambar — `image`

Tentukan gambar dengan `sourceExpression` (sebuah ekspresi) atau `source` (nilai tetap). `scaleMode` mengendalikan bagaimana gambar mengisi bingkai, dan `onError` memilih perilaku saat gambar tidak dapat ditemukan (`error` = lempar error / `blank` = biarkan kosong / `icon` = tampilkan ikon).

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

Data contoh:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | Tipe elemen |
| `source` | string | | Rujukan gambar tetap (ID gambar). Tulis path relatif terhadap file `.report`, path absolut, URL, data URI, dsb. apa adanya (untuk aturan ID, lihat "Pembatasan pemuatan sumber daya dan aturan ID gambar" nanti). Digunakan saat `sourceExpression` tidak ada atau hasilnya tidak dapat diselesaikan |
| `sourceExpression` | Expression | | Ekspresi sumber gambar dinamis. Hasil berupa string diselesaikan sebagai ID gambar; hasil berupa `Uint8Array` diperlakukan sebagai data gambar itu sendiri |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | Cara gambar diskalakan. `'clip'` = tempatkan gambar pada ukuran aslinya dan potong pada bingkai elemen / `'fillFrame'` = regangkan hingga memenuhi bingkai, mengabaikan rasio aspek / `'retainShape'` = pertahankan rasio aspek dan skala ke ukuran terbesar yang muat dalam bingkai / `'realSize'` = ukuran asli plus pemotongan bingkai (implementasinya identik dengan `'clip'`). Default: `'retainShape'`. Saat ukuran gambar tidak dapat ditentukan, ia berperilaku seperti `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | Penempatan horizontal gambar di dalam bingkai (memengaruhi penempatan margin pada `retainShape` dan posisi pemotongan pada `clip`/`realSize`). Default: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | Penempatan vertikal gambar di dalam bingkai. Default: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | Perilaku saat sumber gambar tidak terdefinisi atau gagal diselesaikan. `'error'` = lempar exception / `'blank'` = tidak menggambar apa pun / `'icon'` = gambar kotak placeholder abu-abu dengan tanda ×. Default: `'icon'` |
| `lazy` | boolean | | Hanya ada dalam definisi tipe; tidak dirujuk oleh implementasi mesin tata letak maupun renderer saat ini (tidak dicakup oleh spesifikasi) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | Sudut rotasi gambar (derajat) |
| `affineTransform` | [number, number, number, number, number, number] | | Cara alternatif untuk menentukan penempatan langsung sebagai matriks. `[a, b, c, d, e, f]` adalah transformasi yang memetakan gambar persegi-satuan (0–1) melalui `x' = a·x + c·y + e`, `y' = b·x + d·y + f`; saat diatur, perhitungan penempatan dari `scaleMode`/`hAlign`/`vAlign`/`rotation` dilewati. Terutama digunakan oleh impor PDF untuk mempertahankan penempatan aslinya |
| `opacity` | number | | Opasitas (0.0–1.0) |
| `interpolate` | boolean | | Meminta penampil menghaluskan batas piksel saat gambar beresolusi rendah diperbesar (PDF /Interpolate). Aktifkan untuk foto; nonaktifkan untuk gambar yang harus tetap tajam, seperti barcode |
| `alternates` | PdfImageAlternateDef[] |  | Gambar alternatif PDF (/Alternates) untuk menggunakan gambar berbeda di layar dan saat dicetak. Setiap entri memiliki dua properti: `source` = rujukan ke gambar alternatif (wajib) dan `defaultForPrinting` = apakah gambar ini digunakan saat mencetak |
| `opi` | PdfOpiMetadataDef |  | Informasi OPI untuk percetakan komersial, di mana gambar placeholder beresolusi rendah ditukar dengan gambar beresolusi tinggi pada saat output. Terutama untuk pelestarian hasil impor PDF (lihat **`PdfOpiMetadataDef`** nanti) |
| `measure` | PdfMeasurement |  | Informasi skala dan sistem koordinat yang digunakan alat ukur penampil pada PDF gambar teknik dan peta. Terutama untuk pelestarian hasil impor PDF (lihat **`PdfMeasurement`** nanti) |
| `pointData` | PdfPointData[] |  | Data titik (lintang/bujur, dsb.) pada PDF peta. Terutama untuk pelestarian hasil impor PDF (lihat **`PdfPointData`** nanti) |
| `hyperlink` | HyperlinkDef | | Hyperlink (`type`: `'reference'` = URL / `'localAnchor'` = anchor dalam dokumen / `'localPage'` = halaman dalam dokumen / `'remoteAnchor'`, `'remotePage'` = anchor/halaman di dalam PDF eksternal; `target`: ekspresi tujuan tautan; `remoteDocument?`: ekspresi path PDF eksternal) |

### Mengelompokkan beberapa elemen di dalam bingkai — `frame`

Mengelompokkan elemen anak; `border` menggambar garis tepi dan `clip` memotong bagian yang meluap. Koordinat elemen anak menggunakan sudut kiri-atas frame sebagai titik asalnya.

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

Data contoh:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | Tipe elemen |
| `clip` | boolean | | Apakah anak dipotong pada batas frame. Default: true |
| `border` | BorderDef | | Garis tepi (lihat **`BorderDef`** di bagian properti umum) |
| `padding` | Padding | | Padding dalam (`top?`/`bottom?`/`left?`/`right?`, masing-masing dalam pt) |
| `rotation` | number | | Sudut rotasi frame (derajat, berlawanan arah jarum jam dalam koordinat halaman) |
| `rotationOriginX` | number | | Titik asal rotasi X (relatif terhadap frame, pt). Default: 0 |
| `rotationOriginY` | number | | Titik asal rotasi Y (relatif terhadap frame, pt). Default: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Matriks affine yang memetakan koordinat lokal frame (Y mengarah ke atas) ke ruang koordinat induk (tata letak dan makna matriks seperti pada `affineTransform` milik `image`). Terutama digunakan oleh impor PDF untuk mempertahankan penempatan aslinya |
| `pdfForm` | PdfFormXObjectDef |  | Pada impor PDF, mempertahankan dan mengeluarkan kembali sistem koordinat serta metadata yang dibawa oleh komponen (Form XObject) dari PDF sumber (lihat **`PdfFormXObjectDef`** nanti). Tidak diperlukan pada template yang ditulis tangan |
| `hyperlink` | HyperlinkDef | | Hyperlink (struktur sama dengan properti bernama sama pada `image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | Path pemotong dalam sintaks path SVG. `d` = data path, `fillRule` = aturan isian |
| `transparencyGroup` | boolean | | Mempertahankan batas grup transparansi PDF bahkan saat `isolated` maupun `knockout` tidak diaktifkan. Mempertahankannya memastikan hasil komposit dari opasitas dan blending tetap sama seolah-olah frame dikomposit sebagai satu gambar yang diratakan (terutama untuk kesetiaan hasil impor PDF) |
| `isolated` | boolean | | Grup transparansi terisolasi (PDF /Group /I). Saat ini (atau `knockout` / `softMask`) diatur, frame dikomposit sebagai satu kesatuan sebelum opasitas, blending, dan mask diterapkan |
| `knockout` | boolean | | Grup transparansi knockout (PDF /Group /K). Anak-anak yang tumpang tindih dalam grup tidak saling tembus pandang; pada tiap posisi hanya anak paling atas yang dikomposit dengan latar |
| `softMask` | FrameSoftMaskDef | | Soft mask yang membuat frame transparan sebagian (lihat **`FrameSoftMaskDef`** pada tabel di bawah). Menggunakan hasil rendering `elements`-nya sebagai "peta transparansi", memungkinkan efek seperti memudar bertahap mengikuti gradien |
| `deviceParams` | DeviceParamsDef | | Parameter untuk tahap pracetak percetakan komersial (lihat **`DeviceParamsDef`** pada tabel di bawah). Tidak diperlukan untuk laporan biasa; terutama digunakan oleh impor PDF untuk mempertahankan pengaturan PDF sumber |
| `elements` | ElementDef[] | | Elemen anak di dalam frame |

**`FrameSoftMaskDef`** (struktur `softMask`)
| Field | Tipe | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | Tipe mask. `'luminosity'` = makin terang suatu area mask, makin buram frame-nya / `'alpha'` = makin buram suatu area mask, makin buram frame-nya |
| `colorSpace` | PdfProcessColorSpaceDef | | Ruang warna blending dari grup transparansi soft mask |
| `isolated` | boolean | | Flag isolasi grup transparansi soft mask |
| `knockout` | boolean | | Flag knockout grup transparansi soft mask |
| `backdrop` | [number, number, number] | | Warna latar /BC untuk mask luminositas (DeviceRGB 0–1). Default: hitam |
| `elements` | ElementDef[] | ✓ | Elemen yang dikomposit sebagai grup transparansi untuk mendefinisikan mask |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | Fungsi transfer /SMask /TR yang memetakan ulang nilai mask (0..1) |

**`DeviceParamsDef`** (struktur `deviceParams`. Untuk pracetak percetakan komersial dan biasanya tidak diperlukan — terutama untuk pelestarian hasil impor PDF)
| Field | Tipe | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | Fungsi transfer /TR: `'Identity'` / `'Default'` / satu fungsi yang dipakai bersama semua pelat warna / array fungsi, satu per pelat dari keempat warna |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | Fungsi pembangkitan hitam /BG (`'Default'` = default perangkat via /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | Fungsi penghilangan warna dasar /UCR (`'Default'` = default perangkat via /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | Halftone /HT (screen tipe 1 / array ambang tipe 6, 10, 16 / koleksi per pewarna tipe 5) |
| `halftoneOrigin` | [number, number] | | Titik asal halftone PDF 2.0 (/HTO, piksel ruang perangkat) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | Kontrol kompensasi titik hitam PDF 2.0 (/UseBlackPtComp) |
| `flatness` | number | | Toleransi kerataan (/FL) |
| `smoothness` | number | | Toleransi kehalusan shading (/SM) |
| `strokeAdjustment` | boolean | | Penyesuaian goresan otomatis (/SA) |

### Mencetak tabel — `table`

Tabel dengan baris header, baris rincian, dan baris footer. Berikan array data baris melalui `dataSourceExpression`, dan baris rincian berulang satu kali per elemen array.

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

Data contoh (setiap elemen `items` menjadi satu baris rincian tabel):

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

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | Tipe elemen |
| `columns` | TableColumnElementDef[] | ✓ | Array definisi kolom. Jika jumlah seluruh `width` kolom berbeda dari lebar elemen, semua kolom diskalakan secara proporsional agar pas persis dengan lebar elemen |
| `headerRows` | TableRowElementDef[] |  | Array baris header. Saat tabel terbelah melintasi halaman, baris-baris ini digambar lagi di bagian atas setiap halaman |
| `detailRows` | TableRowElementDef[] |  | Array baris rincian. Digambar berulang, satu kali per baris data (baris data × seluruh baris dalam detailRows) |
| `footerRows` | TableRowElementDef[] |  | Array baris footer. Saat tabel terbelah melintasi halaman, hanya digambar pada halaman terakhir |
| `dataSourceExpression` | Expression |  | Menggunakan array hasil evaluasi ekspresi sebagai baris data tabel ini. Jika dihilangkan, baris sumber data utama yang digunakan. Melempar exception jika hasilnya bukan array |

**`TableColumnElementDef`** (setiap entri `columns` = definisi kolom)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `width` | number | ✓ | Lebar kolom (pt). Jika total seluruh kolom tidak sama dengan lebar elemen, lebar didistribusikan secara proporsional |
| `style` | TableCellStyleDef |  | Gaya sel default untuk kolom ini. Saat sebuah sel menentukan properti dengan nama sama, pengaturan sel yang menang (garis tepi digabung sisi demi sisi) |

**`TableRowElementDef`** (setiap entri `headerRows`/`detailRows`/`footerRows` = definisi baris)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `height` | number | ✓ | Tinggi baris (pt). Diperlakukan sebagai minimum: baris memanjang otomatis saat teks yang terlipat atau elemen anak dalam sel tidak muat (untuk sel rowSpan, luapan konten memanjangkan baris terakhir dari rentang gabungan) |
| `cells` | TableCellElementDef[] | ✓ | Array definisi sel untuk baris ini. Kolom yang ditempati `rowSpan` dari baris di atasnya dilewati otomatis saat penempatan |

**`TableCellElementDef`** (setiap entri `cells` = definisi sel. Selain yang berikut, setiap properti `TableCellStyleDef` dapat ditentukan langsung)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `text` | string |  | Teks sel tetap |
| `expression` | Expression |  | Ekspresi pengikatan data. Bentuk polos `field.name` membaca nilai langsung dari baris data; selain itu diselesaikan lewat evaluasi ekspresi mesin. Diprioritaskan di atas `text` bila ditentukan |
| `colSpan` | number |  | Jumlah kolom yang digabung secara horizontal. Default: 1 |
| `rowSpan` | number |  | Jumlah baris yang digabung secara vertikal. Default: 1. Tinggi sel adalah jumlah tinggi baris sepanjang rentang gabungan |
| `elements` | ElementDef[] |  | Array elemen anak yang ditempatkan di dalam sel. Saat ditentukan, ia diprioritaskan di atas rendering `text`/`expression` dan digambar terpotong pada area dikurangi padding. Tinggi baris memanjang otomatis mengikuti tinggi yang dibutuhkan anak |

**`TableCellStyleDef`** (gaya sel yang dipakai pada definisi sel dan `style` milik kolom)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = rata kiri / `'center'` = tengah / `'right'` = rata kanan |  | Perataan teks horizontal |
| `vAlign` | `'top'` = rata atas / `'middle'` = tengah / `'bottom'` = rata bawah |  | Perataan teks vertikal |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotasi teks (derajat). Default: 0 |
| `backcolor` | string |  | Warna latar sel |
| `forecolor` | string |  | Warna teks. Default: `#000000` |
| `fontId` | string |  | ID font. Default: `'default'` |
| `fontSize` | number |  | Ukuran font (pt). Default: 10 |
| `bold` | boolean |  | Tebal |
| `italic` | boolean |  | Miring |
| `underline` | boolean |  | Garis bawah |
| `strikethrough` | boolean |  | Coret |
| `lineSpacing` | LineSpacingDef |  | Pengaturan jarak baris (lihat **`LineSpacingDef`** di bagian properti umum) |
| `letterSpacing` | number |  | Jarak antarhuruf (pt). Menambahkan jarak tetap di antara semua karakter (nilai negatif merapatkan) |
| `wordSpacing` | number |  | Jarak antarkata (pt; lebar ekstra yang ditambahkan pada karakter spasi) |
| `firstLineIndent` | number |  | Indentasi baris pertama (pt) |
| `leftIndent` | number |  | Indentasi kiri (pt) |
| `rightIndent` | number |  | Indentasi kanan (pt) |
| `wrap` | boolean |  | Pelipatan teks. Default: true |
| `shrinkToFit` | boolean |  | Otomatis mengecilkan ukuran font agar teks muat dalam sel |
| `minFontSize` | number |  | Ukuran font minimum (pt) di bawah `shrinkToFit`. Default: 4 |
| `fitWidth` | boolean |  | Otomatis menyesuaikan ukuran font (dua arah, mengecilkan dan membesarkan) agar baris terpanjang pas persis dengan lebar sel. Sel semacam ini tidak ikut memicu pemanjangan otomatis tinggi baris |
| `outlineText` | boolean |  | Gambar teks setelah dikonversi menjadi outline (path) |
| `padding` | number |  | Padding sel (pt). Default: 2 |
| `border` | BorderDef |  | Garis tepi per sel (lihat **`BorderDef`** di bagian properti umum). Digabung dengan garis tepi `style` milik kolom; pengaturan sel yang menang |
| `opacity` | number |  | Opasitas (0.0–1.0). Di bawah 1, seluruh sel digambar sebagai grup opasitas |

### Mencetak tabulasi silang — `crosstab`

Mengagregasi data berdasarkan grup baris × grup kolom. Contoh ini menjumlahkan `amount` per wilayah × kategori dan juga mengeluarkan subtotal serta total keseluruhan.

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

Data contoh:

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

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | Tipe elemen |
| `rowGroups` | { field, headerFormat? }[] | ✓ | Array definisi grup baris. Beberapa entri membentuk tingkat grup bersarang, tiap tingkat menempati satu kolom header baris dari kiri. Sel header grup luar digabung secara vertikal sepanjang rentangnya |
| `columnGroups` | { field, headerFormat? }[] | ✓ | Array definisi grup kolom. Grup luar bertumpuk di atas dan grup dalam di bawahnya; header luar digabung secara horizontal selebar kolom-kolomnya |
| `measures` | { field, calculation, format? }[] | ✓ | Array definisi measure (sel agregat). Dengan beberapa entri, mereka ditumpuk vertikal di dalam tiap sel data, masing-masing mengambil satu slot (minimal `cellHeight`) dan menerapkan `calculation`/`format`-nya sendiri. Array kosong diperlakukan sebagai satu measure implisit dengan `field: ''` dan `calculation: 'sum'` |
| `rowHeaderWidth` | number |  | Lebar header baris (pt), diterapkan pada tiap tingkat grup baris. Default: 80 |
| `columnHeaderHeight` | number |  | Tinggi header kolom (pt), diterapkan pada tiap tingkat grup kolom. Default: 20 |
| `cellWidth` | number |  | Lebar sel data (pt). Default: 60 |
| `cellHeight` | number |  | Tinggi sel data (pt; tinggi slot untuk satu measure). Memanjang otomatis dengan pelipatan teks. Default: 20 |
| `border` | { color?, width? } |  | Pengaturan garis (lihat tabel di bawah). Hanya bila ditentukan, bingkai luar, pemisah baris/kolom, dan pemisah antar tingkat header digambar (tidak pernah menembus sel header luar yang digabung) |
| `showSubtotals` | boolean |  | Tampilkan subtotal. Default: false. Bila true, baris/kolom subtotal berlabel "Total" disisipkan di akhir blok tiap grup, kecuali untuk tingkat terdalam. Nilai subtotal diagregasi ulang dari nilai mentah menggunakan `calculation` tiap measure |
| `showGrandTotal` | boolean |  | Tampilkan total keseluruhan. Default: false. Bila true, baris/kolom total keseluruhan berlabel "Total" ditambahkan di akhir (tidak dikeluarkan saat baris data nol). Nilai total keseluruhan juga diagregasi ulang dari nilai mentah |
| `dataSourceExpression` | Expression |  | Menggunakan array hasil evaluasi ekspresi sebagai baris data tabulasi silang ini. Jika dihilangkan (atau hasilnya bukan array), baris sumber data utama yang digunakan |

**Definisi grup baris/kolom (setiap entri `rowGroups`/`columnGroups`)**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nama field yang menjadi dasar pengelompokan. Grup muncul sesuai urutan kemunculan pertamanya dalam data |
| `headerFormat` | string |  | Format tampilan untuk nilai header. Format sederhana yang hanya diterapkan saat nilainya numerik (`'#,##0'` atau apa pun yang mengandung `,` → pemisah ribuan; spesifikasi desimal seperti `'.00'` → desimal tetap pada presisi itu; selain itu → konversi string biasa) |

**Definisi measure (setiap entri `measures`)**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `field` | string | ✓ | Nama field yang diagregasi. Nilai non-numerik dikonversi ke angka; nilai yang tidak dapat dikonversi dihitung sebagai 0 |
| `calculation` | `'sum'` = total / `'count'` = cacah / `'average'` = rata-rata / `'min'` = minimum / `'max'` = maksimum | ✓ | Metode agregasi. Subtotal dan total keseluruhan juga diagregasi ulang dari himpunan nilai mentah dengan metode yang sama, sehingga bahkan `average` dan sejenisnya pun hasilnya benar |
| `format` | string |  | Format tampilan untuk nilai agregat (format sederhana yang sama dengan `headerFormat`: `'#,##0'` atau `,` → pemisah ribuan, `'.NN'` → NN desimal tetap, tanpa apa pun → konversi string biasa) |

**Pengaturan garis (`border`)**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `color` | string |  | Warna garis. Default: `#000000` |
| `width` | number |  | Lebar garis (pt) untuk bingkai luar dan batas header/data. Default: 0.5. Pemisah baris/kolom interior digambar dengan setengah lebar ini |

### Menyematkan satu laporan di dalam laporan lain — `subreport`

Gagasannya sudah dijelaskan di **Dasar-dasar tata letak laporan**. Berikut definisi lengkap yang berfungsi apa adanya. Subreport berjalan satu kali per baris rincian induk, dan array yang diberikan melalui `dataSourceExpression` menjadi `rows` milik subreport.

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

Data contoh:

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

`subreport.report` yang disematkan adalah template independen sepenuhnya. Ia merujuk setiap elemen dari `items` yang diterima sebagai nilai `field.*` biasa dan menerima parameter yang diberikan induk melalui `param.*`. Perhatikan bahwa template yang dieksekusi sebagai subreport tidak mengeluarkan band `pageHeader`, `pageFooter`, maupun `background`-nya (pengelolaan halaman adalah tugas laporan induk). Judul ditempatkan di band `title`, seperti ini:

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

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | Tipe elemen |
| `templateExpression` | Expression | ✓ | Ekspresi yang mengembalikan nama template anak. Saat menggunakan `createReportFromFile()`, ia diselesaikan otomatis sebagai path file; saat memanggil `createReport()` langsung, selesaikan dengan opsi `resolveSubreportTemplate` (fungsi yang menerima nama dan direktori kerja lalu mengembalikan `{ template, workingDirectory? }`, atau `null` bila tidak dapat menyelesaikan) |
| `dataSourceExpression` | Expression | | Ekspresi yang mengembalikan sumber data laporan anak (array objek baris). Jika dihilangkan, baris sumber data induk digunakan apa adanya. Hasil non-array diperlakukan sebagai data kosong |
| `parameters` | SubreportParamDef[] |  | Parameter yang diberikan ke laporan anak (lihat **`SubreportParamDef`** pada tabel di bawah). Mereka diprioritaskan di atas entri bernama sama dari `parametersMapExpression` |
| `parametersMapExpression` | Expression | | Ekspresi yang mengembalikan objek yang digabungkan ke parameter anak (entri `parameters` individual menang) |
| `returnValues` | ReturnValueDef[] |  | Definisi yang mengembalikan nilai variabel laporan anak ke induk (lihat **`ReturnValueDef`** pada tabel di bawah) |
| `usingCache` | boolean | | Dalam satu eksekusi laporan induk, meng-cache dan menggunakan kembali template anak yang telah diselesaikan per nama template |
| `runToBottom` | boolean | | Setelah konten subreport, konsumsi sisa ruang halaman/kolom (mendorong elemen berikutnya ke bawah sisa ruang tersebut) |

**`SubreportParamDef`** (setiap entri `parameters` = parameter yang diberikan ke laporan anak)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nama parameter yang diberikan ke laporan anak (dirujuk di sisi anak sebagai `param.name`) |
| `expression` | Expression | ✓ | Ekspresi yang menghitung nilai parameter. Dievaluasi dalam konteks laporan induk |

**`ReturnValueDef`** (setiap entri `returnValues` = definisi pengembalian nilai dari anak ke induk)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nama variabel yang menerima nilai di sisi induk. Variabel ini dikecualikan dari penimpaan oleh perhitungan variabel normal milik induk |
| `subreportVariable` | string | ✓ | Nama variabel sumber di sisi anak. Saat laporan anak selesai berjalan, nilainya dipropagasikan ke induk |
| `calculation` | `'nothing'` = tetapkan nilai anak apa adanya (ditimpa pada setiap eksekusi) / `'count'` = cacah / `'sum'` = total / `'average'` = rata-rata / `'min'` = minimum / `'max'` = maksimum / `'first'` = pertahankan nilai pertama yang diperoleh | ✓ | Cara nilai dilipat ke dalam variabel induk. Selain `'nothing'`, semuanya mengagregasi lintas eksekusi saat subreport berjalan beberapa kali |

### Mencetak barcode dan QR code — `barcode`

`barcodeType` menerima Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code (`qrcode`), Data Matrix, PDF417, dan lainnya. `showText` menambahkan teks yang terbaca manusia sebagai referensi pemindaian.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

Data contoh:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | Tipe elemen |
| `barcodeType` | string | ✓ | Simbologi barcode (tidak peka huruf besar/kecil). Nilai yang diizinkan: `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. Nilai lain apa pun tidak didukung dan menggambar placeholder |
| `expression` | Expression | ✓ | Ekspresi yang mengembalikan data barcode (hasil evaluasi diubah menjadi string lalu dikodekan) |
| `showText` | boolean | | Tampilkan teks yang terbaca manusia di bawah barcode satu dimensi (tinggi area teks 10pt, ukuran font 8pt; tinggi batang menyusut sebesar itu). Tidak digunakan untuk kode dua dimensi (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | Tingkat koreksi kesalahan QR Code — kemampuan untuk tetap terbaca bahkan saat sebagian kode tercoreng atau hilang. Ketahanan naik dari `'L'` ke `'H'`, dengan imbalan pola yang lebih halus. `'Q'` atau `'H'` disarankan untuk media cetak kasar. Default: `'M'`. Hanya efektif untuk QR Code (tingkat koreksi kesalahan PDF417 dipilih otomatis dari panjang data) |

### Mencetak rumus matematika — `math`

Menata rumus bergaya LaTeX. Penataan huruf matematika memerlukan font khusus yang membawa metrik khusus matematika (tabel OpenType MATH); contoh yang tersedia bebas antara lain STIX Two Math dan Latin Modern Math. Font teks biasa tidak dapat menggantikannya. `formula` dievaluasi sebagai ekspresi (contoh ini merujuk field `formula` dari data).

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

Data contoh:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

Saat menggunakan elemen `math`, daftarkan font yang memiliki tabel OpenType MATH baik di `fontMap` maupun di `fonts` untuk output PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | Tipe elemen |
| `formula` | Expression | ✓ | Ekspresi yang mengembalikan string rumus LaTeX (bungkus rumus tetap dengan `'...'` sebagai literal string di dalam ekspresi). Tidak ada yang digambar saat hasilnya string kosong |
| `mathFontFamily` | string | | Font yang digunakan untuk rendering matematika (ID font yang terdaftar di fontMap). Default: fontFamily dari gaya elemen, atau `'default'` jika itu pun tidak ada |
| `fontSize` | number | | Ukuran font (pt). Default: fontSize dari gaya elemen, atau 12 jika itu pun tidak ada |
| `color` | string | | Warna teks. Default: diselesaikan berurutan — forecolor elemen → forecolor gaya → `#000000` |

### Mencetak SVG — `svg`

Merender dokumen SVG langsung ke dalam laporan. `svgContent` dievaluasi sebagai ekspresi (string SVG tetap dapat diberikan lewat data atau parameter).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

Data contoh:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | Tipe elemen |
| `svgContent` | Expression | ✓ | Ekspresi yang mengembalikan string markup SVG. Hasilnya diubah menjadi string dan dirender sebagai SVG pada posisi dan ukuran elemen |

### Membuat formulir PDF yang dapat diisi — `formField`

Menempatkan field formulir yang dapat diisi oleh siapa pun yang membuka PDF-nya. `fieldType` menerima `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox`, dan `signature`.

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

Data contoh (menjadi nilai awal formulir):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | Tipe elemen. Field formulir interaktif. Backend pratinjau menggambar tampilan awalnya, dan output PDF mengeluarkannya sebagai field yang benar-benar dapat diisi |
| `fieldType` | `'text'` = field input teks (PDF /Tx) / `'checkbox'` = kotak centang (/Btn) / `'radio'` = tombol radio (/Btn; widget yang berbagi `fieldName` yang sama membentuk satu grup yang saling eksklusif) / `'pushbutton'` = tombol tekan (/Btn; keterangan plus aksi URI opsional) / `'dropdown'` = drop-down (combo box, /Ch) / `'listbox'` = list box (/Ch) / `'signature'` = field tanda tangan (/Sig) | ✓ | Tipe field |
| `fieldName` | string | ✓ | Nama field yang sepenuhnya terkualifikasi. Harus unik dalam dokumen (duplikat melempar error). Pengecualiannya adalah `radio`, di mana berbagi nama yang sama membentuk satu grup yang saling eksklusif |
| `value` | Expression |  | Nilai awal (text: nilai input; dropdown/listbox: nilai yang dipilih; untuk listbox `multiSelect`, tentukan beberapa nilai dipisahkan baris baru). Dievaluasi sebagai ekspresi. Menggabungkannya dengan `valueStream` melempar error |
| `checked` | Expression |  | Keadaan tercentang awal (checkbox/radio). Dievaluasi sebagai ekspresi. Untuk radio, `exportValue` milik tombol yang tercentang menjadi nilai terpilih grup |
| `exportValue` | string |  | String yang dicatat sebagai nilai yang berarti checkbox/radio ini "on" saat input formulir dikirim atau diekstrak (checkbox/radio). Default: `'Yes'`. Dalam grup radio, nilai ini membedakan tiap opsi |
| `options` | FormFieldOption[] |  | Array opsi (dropdown/listbox). Lihat tabel di bawah |
| `editable` | boolean |  | Izinkan input bebas selain opsi yang ada (membuat dropdown menerima pengetikan bergaya combo) |
| `multiSelect` | boolean |  | Izinkan pilihan ganda (listbox) |
| `caption` | string |  | Keterangan tombol (pushbutton) |
| `action` | string |  | URI yang dibuka saat pushbutton ditekan |
| `multiline` | boolean |  | Input multibaris (text) |
| `readOnly` | boolean |  | Jadikan field hanya-baca |
| `required` | boolean |  | Jadikan field wajib diisi |
| `noExport` | boolean |  | Jangan ekspor nilai field ini saat formulir dikirim |
| `password` | boolean |  | Input kata sandi (text; karakter yang diketik disamarkan) |
| `fileSelect` | boolean |  | Jadikan field pemilihan file (text). Menggabungkannya dengan `multiline`/`password` melempar error |
| `doNotSpellCheck` | boolean |  | Nonaktifkan pemeriksaan ejaan (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | Larang penggulungan untuk input yang melebihi area yang terlihat (text) |
| `comb` | boolean |  | Tampilkan sebagai kotak-kotak karakter berjarak sama (comb) (text). `maxLength` harus ditentukan; menggabungkannya dengan `multiline`/`password`/`fileSelect` melempar error |
| `richText` | string |  | Nilai rich-text (PDF /RV) yang ditampilkan dengan pemformatan (tebal, warna, dsb.) pada penampil yang mendukung. Mengaturnya menaikkan flag rich-text milik field. Menggabungkannya dengan `richTextStream` melempar error |
| `richTextStream` | Uint8Array |  | Bentuk stream dari `richText`. Untuk pelestarian tingkat byte saat /RV pada PDF sumber berupa stream selama impor PDF; template yang ditulis tangan biasanya menggunakan `richText`. Menggabungkannya dengan `richText` melempar error |
| `defaultStyle` | string |  | Gaya default untuk rich text (PDF /DS). String format mirip CSS (mis. `font: Helvetica 12pt`) yang memberikan default untuk apa pun yang tidak ditentukan `richText` |
| `valueStream` | Uint8Array |  | Untuk pelestarian hasil impor PDF. Saat nilai field PDF sumber (/V) berupa objek stream alih-alih string, mengeluarkan kembali byte tersebut tanpa kehilangan. Template yang ditulis tangan biasanya menggunakan `value`. Menggabungkannya dengan `value` melempar error |
| `defaultValue` | string |  | Nilai default yang dikembalikan field saat formulir direset (/DV) |
| `sort` | boolean |  | Tampilkan opsi dalam keadaan terurut (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | Langsung kunci nilai begitu pilihan berubah (dropdown/listbox) |
| `radiosInUnison` | boolean |  | Nyalakan dan matikan secara serempak tombol radio dalam satu grup yang berbagi `exportValue` yang sama |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | Melekatkan skrip input pada field yang dijalankan di penampil PDF. K = pada tiap ketukan tombol (mis. buang karakter non-digit), F = pemformatan tampilan (mis. tampilkan dua desimal), V = validasi nilai (mis. tolak angka negatif), C = perhitungan ulang (mis. hitung otomatis dari nilai field lain). Isinya biasanya sebuah `PdfActionDef` (dijelaskan nanti) dengan `subtype: 'JavaScript'`. Mesin inti hanya menyematkan skrip ke dalam PDF dan tidak pernah mengeksekusinya. Untuk grup radio, semua widget harus membawa definisi yang identik atau exception dilempar |
| `calculationOrder` | number |  | Saat beberapa field memiliki aksi `'C'` (perhitungan ulang), urutan penampil menghitung ulangnya (PDF /CO). Urutan menaik dari bilangan bulat ≥ 0. Duplikat, nilai negatif, dan non-bilangan-bulat melempar error |
| `maxLength` | number |  | Panjang input maksimum (text) |
| `borderColor` | string |  | Warna garis tepi (`#RRGGBB`). Tanpa garis tepi jika dihilangkan. Digambar sebagai garis luar 1pt — melingkar untuk radio, persegi untuk lainnya |
| `backgroundColor` | string |  | Warna latar (`#RRGGBB`). Transparan jika dihilangkan. Diisi sebagai lingkaran untuk radio, persegi untuk lainnya |

**`FormFieldOption`** (setiap entri `options` = definisi opsi)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `value` | string | ✓ | Nilai ekspor yang disimpan dalam nilai field (/V) |
| `label` | string |  | Label tampilan. Default: sama dengan `value` |

Catatan: sebagai tambahan, semua properti umum elemen dan setiap properti `TextProperties` dapat ditentukan (diterapkan pada font, perataan, dsb. dari teks input).

### Memaksa pemisah halaman atau kolom di mana pun — `break`

Memaksa perpindahan ke halaman berikutnya (`"breakType": "page"`) atau kolom berikutnya (`"column"`) di tengah aliran rincian. Tempatkan langsung dalam band; ia tidak dapat berada di dalam `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**Daftar properti**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | Tipe elemen |
| `breakType` | `'page'` \| `'column'` | ✓ | Tipe pemisah. Membelah band pada posisi y elemen; `'page'` = lanjutkan di halaman berikutnya / `'column'` = lanjutkan di kolom berikutnya saat tata letak multikolom (`columns.count` template bernilai 2 atau lebih; lihat **Dasar-dasar tata letak laporan**) dan ini bukan kolom terakhir (jika tidak, ia bertindak sebagai pemisah halaman) |

### Mencetak elemen hanya saat kondisi terpenuhi — `printWhenExpression`

`printWhenExpression` bukanlah tipe elemen tersendiri melainkan **atribut yang berlaku umum untuk semua elemen**. Elemen hanya dicetak pada baris di mana ekspresi dievaluasi truthy. Contoh berikut mencetak "※ 至急" (mendesak) hanya pada baris rincian yang `urgent`-nya `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

Data contoh (dicetak hanya untuk baris pertama):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

Band juga menerima `printWhenExpression` dengan nama yang sama, menekan output seluruh band (mis. keluarkan band keterangan hanya saat `param.showNotes` diatur). Saat template didefinisikan dalam TypeScript, callback `onBeforeRender` milik elemen memberi kendali yang lebih halus lagi — kembalikan `null` untuk melewati pencetakan elemen, atau kembalikan `ElementDef` untuk mencetak dengan atribut seperti teks, dimensi, dan warna yang ditimpa di tempat.
## Referensi properti elemen

"Daftar properti" yang menyertai contoh setiap elemen hanya mencakup properti yang khusus bagi elemen tersebut. Sebagai tambahan, setiap elemen menerima properti umum untuk posisi, ukuran, kondisi pencetakan, warna, dan lainnya. Bagian ini merangkum properti yang umum untuk semua elemen serta properti dari style yang didefinisikan dalam `styles` milik template.

### Properti yang umum untuk semua elemen

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `id` | string |  | Pengenal untuk mencari dan mengubah elemen sebelum dirender dengan `findElementById()`. Tidak memengaruhi konten yang dicetak itu sendiri. Jaga agar ID yang dipakai sebagai target perubahan bersifat unik dalam template (jika duplikat, elemen pertama dalam urutan pencarian yang dikembalikan) |
| `x` | number | ✓ | Koordinat X dalam band/kontainer induk (pt) |
| `y` | number | ✓ | Koordinat Y dalam band/kontainer induk (pt) |
| `width` | number | ✓ | Lebar (pt) |
| `height` | number | ✓ | Tinggi (pt) |
| `style` | string |  | Nama style yang diterapkan (merujuk `name` dari sebuah `StyleDef` yang didefinisikan dalam `styles`; jika tidak ditentukan, style `isDefault` yang diterapkan) |
| `positionType` | `'float'` = bergeser ke bawah sebanyak peregangan elemen di atasnya / `'fixRelativeToTop'` = mengunci posisi dari tepi atas band (default) / `'fixRelativeToBottom'` = mempertahankan jarak dari tepi bawah band (bergeser ke bawah sebanyak peregangan band) |  | Aturan penempatan saat band meregang. Default: `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = tidak meregang (default) / `'containerHeight'` = menyamakan tinggi elemen dengan tinggi efektif band / `'containerBottom'` = meregangkan tepi bawah elemen hingga tepi bawah efektif band (hanya mengubah tinggi) |  | Aturan peregangan elemen saat band meregang. Default: `noStretch` |
| `printWhenExpression` | Expression \| null |  | Saat hasil evaluasi falsy, elemen ini tidak dicetak |
| `onBeforeRender` | OnBeforeRenderCallback |  | Callback yang dipanggil tepat sebelum rendering: `(elem, field, vars, param, report) => ElementDef \| null`. Mengembalikan `null` akan melewati pencetakan (superset dari `printWhenExpression`); mengembalikan `ElementDef` merender dengan definisi tersebut (menimpa atribut apa pun secara dinamis). Urutan evaluasi: `onBeforeRender` → `printWhenExpression` (dievaluasi terhadap definisi yang telah ditimpa) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | Saat elemen tidak dicetak, jika tidak ada elemen tercetak lain yang bertumpang tindih dengan pita vertikal yang ditempati elemen tersebut, pita itu dihapus dan elemen di bawahnya ditarik ke atas, sehingga band menyusut |
| `isPrintRepeatedValues` | boolean |  | Saat diatur `false`, pencetakan ditekan jika nilainya (textField) sama dengan nilai sebelumnya (selama ditekan, elemen diperlakukan bertinggi 0 jika `isRemoveLineWhenBlank` bernilai truthy) |
| `isPrintWhenDetailOverflows` | boolean |  | Mencetak ulang elemen ini pada setiap segmen halaman/kolom tempat band meluap |
| `mode` | `'opaque'` = mengisi latar belakang dengan `backcolor` / `'transparent'` = tidak mengisi latar belakang |  | Mode tampilan. Default: `transparent` (diselesaikan dari elemen terlebih dahulu, lalu style) |
| `forecolor` | string |  | Warna latar depan (`#RRGGBB` atau `#RRGGBBAA`) |
| `backcolor` | string |  | Warna latar belakang (digambar saat `mode` bernilai `opaque`) |
| `border` | BorderDef |  | Garis tepi (lihat **`BorderDef`** di bawah). Untuk elemen line/rectangle/ellipse/path, garis tepi tidak digambar (baik berasal dari style maupun ditentukan langsung pada elemen; elemen-elemen ini menentukan garis melalui `stroke` dan properti serupa miliknya sendiri) |
| `padding` | Padding |  | Padding (lihat **`Padding`** di bawah) |
| `blendMode` | BlendModeDef |  | Cara warna elemen ini dikomposisikan dengan konten yang sudah digambar di bawahnya (lihat **`BlendModeDef`** di bawah). Contoh umum: menentukan `'multiply'` pada gambar stempel atau segel akan menumpangkannya secara tembus pandang tanpa menutupi teks di bawahnya |
| `overprintFill` | boolean |  | Untuk prapencetakan pada percetakan komersial. Menentukan overprint bagi isian (bidang teks dan bentuk): dicetak di atas pelat warna di bawahnya tanpa melubanginya |
| `overprintStroke` | boolean |  | Untuk prapencetakan pada percetakan komersial. Pengaturan overprint untuk garis (stroke) |
| `overprintMode` | 0 \| 1 |  | Memilih perilaku saat `overprintFill`/`overprintStroke` diaktifkan (PDF /OPM). `0` = setiap komponen warna menimpa warna di bawahnya (default) / `1` = komponen warna bernilai 0 membiarkan warna di bawahnya tetap utuh |
| `renderingIntent` | `'AbsoluteColorimetric'` = setia secara kolorimetrik / `'RelativeColorimetric'` = setia setelah menyelaraskan titik putih / `'Saturation'` = mengutamakan kecerahan warna / `'Perceptual'` = mengutamakan tampilan yang alami |  | Kebijakan prioritas untuk mengonversi warna yang tidak muat dalam gamut perangkat keluaran (rendering intent PDF). Ditujukan untuk percetakan komersial dan manajemen warna; biasanya tidak perlu ditentukan |
| `alphaIsShape` | boolean |  | Kendali halus atas komposisi transparansi PDF (menafsirkan opasitas dan mask sebagai "shape"; /AIS). Biasanya tidak perlu ditentukan; terutama dipakai untuk mengeluarkan ulang PDF hasil impor secara setia |
| `textKnockout` | boolean |  | Saat karakter tembus pandang saling bertumpang tindih, menghindari komposisi ganda pada bagian tumpang tindih di dalam teks yang sama (PDF /TK). Default: `true`. Biasanya tidak perlu ditentukan |
| `optionalContent` | OptionalContentDef |  | Menempatkan elemen ini pada sebuah "lapisan" PDF. Visibilitas dan pencetakan dapat dialihkan dari panel lapisan pada penampil (mis. menampilkan watermark di layar tetapi menghilangkannya saat dicetak). Lihat **`OptionalContentDef`** di bawah |
| `opacity` | number |  | Opasitas elemen (0.0–1.0). Untuk elemen yang memiliki anak, diterapkan setelah mengomposisikannya sebagai satu grup |

**`BlendModeDef`** (mode blend yang dapat ditentukan untuk `blendMode`)

Elemen biasanya menimpa apa pun yang telah digambar di bawahnya (`'normal'`). Menentukan mode blend akan menggabungkan warna atas dan bawah secara komputasional. Dalam laporan bisnis, penggunaan umumnya adalah menumpangkan stempel pribadi atau perusahaan di atas teks (`'multiply'`) dan menghasilkan efek mirip white-knockout pada latar gelap (`'screen'`).

| Konstanta | Efek |
| --- | --- |
| `'normal'` | Menggambar dengan warna atas tanpa pembauran (setara dengan default) |
| `'multiply'` | Perkalian. Bagian yang bertumpang tindih selalu menjadi lebih gelap. Untuk stempel, segel, dan tumpangan bergaya stabilo |
| `'screen'` | Perkalian terbalik. Bagian yang bertumpang tindih selalu menjadi lebih terang |
| `'overlay'` | Mengalikan di area dasar yang gelap, melakukan screen di area yang terang. Menonjolkan kontras |
| `'darken'` | Mengambil warna yang lebih gelap di antara keduanya |
| `'lighten'` | Mengambil warna yang lebih terang di antara keduanya |
| `'color-dodge'` | Mencerahkan (memutihkan) warna dasar sesuai warna atas |
| `'color-burn'` | Menggelapkan warna dasar sesuai warna atas |
| `'hard-light'` | Beralih antara perkalian dan perkalian terbalik berdasarkan tingkat terang warna atas (efek pencahayaan kuat) |
| `'soft-light'` | Versi yang lebih lembut dari `'hard-light'` (efek pencahayaan lembut) |
| `'difference'` | Nilai mutlak dari selisih kedua warna |
| `'exclusion'` | Versi berkontras lebih rendah dari `'difference'` |
| `'hue'` | Rona atas + saturasi dan luminositas bawah |
| `'saturation'` | Saturasi atas + rona dan luminositas bawah |
| `'color'` | Rona dan saturasi atas + luminositas bawah (untuk mewarnai dasar monokrom) |
| `'luminosity'` | Luminositas atas + rona dan saturasi bawah |

**`Expression`** (lihat "Menguasai ekspresi" untuk detailnya)
| Bentuk | Deskripsi |
| --- | --- |
| string | Bahasa mini ekspresi. Contoh: `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | Sebuah fungsi TypeScript `(field, vars, param, report) => unknown`. `report` (ReportContext) menyediakan `PAGE_NUMBER` (nomor halaman saat ini, berbasis 1), `COLUMN_NUMBER` (nomor kolom saat ini, berbasis 1), `REPORT_COUNT` (jumlah record yang telah diproses), `TOTAL_PAGES` (jumlah total halaman; difinalkan dengan evaluationTime=report), `RETURN_VALUE` (ada dalam definisi tipe tetapi selalu undefined pada implementasi saat ini — nilai kembalian subreport diterima melalui `vars.*`), `format` (fungsi pemformatan bawaan), dan `formatters` (formatter kustom yang terdaftar pada template) |

**`BorderDef`**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `width` | number |  | Lebar garis (pt). Default yang dipakai bersama oleh semua sisi |
| `color` | string |  | Warna garis. Default yang dipakai bersama oleh semua sisi |
| `style` | `'solid'` = garis padat / `'dashed'` = garis putus-putus / `'dotted'` = garis titik-titik |  | Gaya garis. Default yang dipakai bersama oleh semua sisi |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | Pengaturan per sisi (lihat **`BorderSideDef`** di bawah). Pengaturan ini lebih diutamakan daripada pengaturan semua sisi; `null` menyembunyikan sisi tersebut |

**`BorderSideDef`** (dipakai dalam `top`/`bottom`/`left`/`right` milik `BorderDef`)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `width` | number | ✓ | Lebar garis (pt) |
| `color` | string | ✓ | Warna garis |
| `style` | `'solid'` = garis padat / `'dashed'` = garis putus-putus / `'dotted'` = garis titik-titik | ✓ | Gaya garis |

**`Padding`**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | Padding pada setiap sisi (pt) |

**`HyperlinkDef`**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'reference'` = URL eksternal / `'localAnchor'` = ke sebuah anchor dalam dokumen yang sama / `'localPage'` = ke sebuah nomor halaman dalam dokumen yang sama / `'remoteAnchor'` = ke sebuah anchor dalam dokumen PDF lain / `'remotePage'` = ke sebuah halaman dalam dokumen PDF lain | ✓ | Tipe tautan |
| `target` | Expression | ✓ | Tujuan tautan (sebuah URL, nama anchor, atau ekspresi nomor halaman) |
| `remoteDocument` | Expression |  | Path berkas PDF jarak jauh (untuk remotePage / remoteAnchor) |

**`TextProperties`** (properti teks dan paragraf dari staticText / textField / formField)
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `markup` | `'none'` = teks polos / `'styled'` = markup bergaya (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>`, dsb.) / `'html'` = subset HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | Tipe markup |
| `hAlign` | `'left'` = rata kiri / `'center'` = rata tengah / `'right'` = rata kanan / `'justify'` = rata kiri-kanan |  | Perataan horizontal |
| `vAlign` | `'top'` = rata atas / `'middle'` = rata tengah / `'bottom'` = rata bawah |  | Perataan vertikal |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotasi teks (derajat) |
| `lineSpacing` | LineSpacingDef |  | Pengaturan jarak antarbaris (lihat **`LineSpacingDef`** di bawah) |
| `letterSpacing` | number |  | Jarak antarhuruf (pt). Menambahkan jumlah tetap di antara semua karakter (nilai negatif merapatkan) |
| `tracking` | number |  | Jenis penyesuaian jarak antarhuruf yang lain. Jika `letterSpacing` menambahkan jumlah tetap secara seragam, properti ini memakai tabel penyesuaian jarak yang tertanam dalam font itu sendiri (tabel AAT `trak`) untuk merapatkan atau merenggangkan jarak dengan nilai desain yang bergantung pada ukuran font. Angkanya adalah "track value" pada tabel: 0 = normal, negatif = lebih rapat, positif = lebih renggang (nilai antara diinterpolasi). Tidak berpengaruh pada font tanpa tabel `trak` |
| `wordSpacing` | number |  | Jarak antarkata (pt; lebar tambahan yang diberikan pada karakter spasi) |
| `horizontalScale` | number |  | Faktor skala yang meregangkan bentuk glif secara horizontal (di bawah 1 = memampat, mempersempit lebar; di atas 1 = memuai, melebarkannya). Pembungkusan baris dan langkah baris dihitung dari lebar yang telah diskalakan. Default: 1 |
| `baselineOffset` | number |  | Menetapkan posisi baseline (garis acuan tempat karakter berpijak) secara eksplisit dalam pt dari tepi atas elemen. Biasanya dihitung otomatis sehingga tidak perlu ditentukan (terutama diatur oleh impor PDF untuk mereproduksi posisi teks aslinya) |
| `firstLineIndent` | number |  | Indentasi baris pertama (pt) |
| `leftIndent` | number |  | Indentasi kiri (pt) |
| `rightIndent` | number |  | Indentasi kanan (pt) |
| `padding` | Padding |  | Padding |
| `direction` | `'ltr'` = kiri ke kanan / `'rtl'` = kanan ke kiri / `'auto'` = dideteksi otomatis dari kontennya (analisis teks dwiarah) |  | Arah teks |
| `openTypeScript` | string |  | Tag OpenType yang menentukan aturan sistem penulisan mana dalam font yang dipakai saat mengonversi teks menjadi bentuk glif (shaping) (mis. `'latn'` = aksara Latin, `'arab'` = aksara Arab). Biasanya tidak perlu ditentukan (ditangani otomatis dari konten teks) |
| `openTypeLanguage` | string |  | Tag OpenType yang menegaskan bahasa secara eksplisit bagi font yang memvariasikan bentuk glif menurut bahasa dalam sistem penulisan yang sama. Biasanya tidak perlu ditentukan |
| `openTypeFeatures` | Record<string, number> |  | Mengaktifkan atau menonaktifkan fitur pengalihan glif bawaan font. Contoh: `{ "palt": 1 }` = merapatkan jarak antarhuruf Jepang, `{ "liga": 0 }` = menonaktifkan ligatur, `{ "zero": 1 }` = angka nol bergaris miring. Nilai: 0 = mati / 1 = hidup; untuk fitur pemilihan glif, nomor glif alternatif berbasis 1 |
| `shrinkToFit` | boolean |  | Perkecil otomatis: mengurangi ukuran font agar teks muat dalam lebar dan tinggi elemen |
| `minFontSize` | number |  | Ukuran font minimum (pt) untuk `shrinkToFit`. Default: 4 |
| `fitWidth` | boolean |  | Menyesuaikan ukuran font secara otomatis agar baris terpanjang tepat memenuhi lebar konten elemen (ke dua arah, memperkecil maupun memperbesar) |
| `outlineText` | boolean |  | Mengonversi teks menjadi outline (path). Default: `false` |
| `pdfFontMode` | `'embedded'` = menyematkan program font / `'reference'` = mengeluarkan rujukan font sistem tanpa menyematkan |  | Cara program font PDF ditangani |
| `textPaintMode` | `'fill'` = isian / `'stroke'` = hanya outline / `'fillStroke'` = isian + outline |  | Semantik penggambaran teks yang dipertahankan melalui impor PDF. Default: `fill` |
| `textStrokeColor` | string |  | Warna stroke untuk stroke / fillStroke |
| `textStrokeWidth` | number |  | Lebar stroke outline untuk teks (pt) |
| `tabStops` | TabStopDef[] |  | Definisi tab stop (lihat **`TabStopDef`** di bawah) |
| `tabStopWidth` | number |  | Interval tab default (pt). 40pt jika tidak ditentukan |
| `wrap` | boolean |  | Pembungkusan teks. Default: `true` (undefined berarti pembungkusan aktif) |

**`LineSpacingDef`**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'single'` = satu baris / `'1.5'` = 1,5 baris / `'double'` = dua kali / `'proportional'` = rasio / `'fixed'` = nilai tetap / `'minimum'` = nilai minimum | ✓ | Tipe jarak antarbaris |
| `value` | number |  | Nilai untuk fixed / minimum / proportional |

**`TabStopDef`**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `position` | number | ✓ | Posisi tab (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | Perataan tab. Default: `left` |

**`FillDef`** (gabungan tipe yang diterima oleh isian (`fill`) dan stroke (`stroke`) milik `path` serta oleh isian (`fill`) milik `rectangle`/`ellipse`. `stroke` milik `rectangle`/`ellipse` hanya menerima string warna padat)
| Bentuk | Deskripsi |
| --- | --- |
| string | Warna padat (`#RRGGBB` atau `#RRGGBBAA`) |
| PdfSpecialColorDef | Warna khusus (Separation/DeviceN). Penentuan warna untuk tinta tertentu seperti emas, perak, atau warna korporat (lihat tabel di bawah) |
| LinearGradientDef | Gradien linear — warna berubah sepanjang sumbu yang menghubungkan dua titik (lihat tabel di bawah) |
| RadialGradientDef | Gradien radial — warna berubah ke luar dari sebuah pusat (lihat tabel di bawah) |
| MeshGradientDef | Gradien mesh — warna berubah mengikuti bentuk bebas (lihat tabel di bawah) |
| TilingPatternDef | Pola ubin — mengisi dengan menyusun motif kecil berulang (lihat tabel di bawah) |
| FunctionShadingDef | Shading fungsi — warna dihitung dari koordinat melalui sebuah rumus (lihat tabel di bawah) |

**`GradientStopDef`** (color stop dari sebuah gradien; dipakai dalam `stops` milik setiap gradien)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `offset` | number | ✓ | Posisi sepanjang sumbu gradien, sebagai rasio dari 0 hingga 1 (0 = titik awal, 1 = titik akhir) |
| `color` | string | ✓ | Warna pada posisi ini (`#RRGGBB`) |
| `opacity` | number |  | Opasitas pada posisi ini (0–1). Default: 1 |

**`LinearGradientDef`** (gradien linear — isian yang warnanya berubah sepanjang sumbu yang menghubungkan dua titik)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | Pembeda yang menandakan gradien linear |
| `x1` | number |  | Koordinat X titik awal, **sebagai rasio terhadap lebar kotak pembatas elemen** (0 = tepi kiri, 1 = tepi kanan). Default: 0 |
| `y1` | number |  | Koordinat Y titik awal, **sebagai rasio terhadap tinggi kotak pembatas elemen** (0 = tepi atas, 1 = tepi bawah). Default: 0 |
| `x2` | number |  | Koordinat X titik akhir (rasio terhadap lebar). Default: 1 (dengan default apa adanya, menghasilkan gradien horizontal dari kiri ke kanan) |
| `y2` | number |  | Koordinat Y titik akhir (rasio terhadap tinggi). Default: 0 |
| `stops` | GradientStopDef[] | ✓ | Larik color stop (lihat tabel di atas) |
| `spreadMethod` | `'pad'` = mengisi dengan warna tepi / `'reflect'` = mengulang sambil mencerminkan / `'repeat'` = mengulang apa adanya |  | Cara menggambar di luar rentang gradien. Default: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadata pelestarian untuk mengeluarkan ulang gradien PDF hasil impor tanpa kehilangan data. Tidak perlu ditentukan pada template yang ditulis tangan |

**`RadialGradientDef`** (gradien radial — isian yang warnanya berubah ke luar dari sebuah pusat)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | Pembeda yang menandakan gradien radial |
| `cx` | number |  | Koordinat X pusat lingkaran luar (rasio terhadap lebar kotak pembatas elemen). Default: 0.5 |
| `cy` | number |  | Koordinat Y pusat lingkaran luar (rasio terhadap tinggi). Default: 0.5 |
| `r` | number |  | Jari-jari lingkaran luar, **sebagai rasio terhadap nilai yang lebih besar antara lebar dan tinggi**. Default: 0.5 |
| `fx` | number |  | Koordinat X titik fokus (tempat gradien bermula) (rasio terhadap lebar). Default: `cx` |
| `fy` | number |  | Koordinat Y titik fokus (rasio terhadap tinggi). Default: `cy` |
| `fr` | number |  | Jari-jari lingkaran fokus (rasio terhadap nilai yang lebih besar antara lebar dan tinggi). Default: 0 |
| `stops` | GradientStopDef[] | ✓ | Larik color stop |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | Cara menggambar di luar rentang (sama seperti `LinearGradientDef`). Default: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Metadata untuk mengeluarkan ulang impor PDF tanpa kehilangan data. Tidak perlu ditentukan pada template yang ditulis tangan |

**`MeshGradientDef`** (gradien mesh — isian yang memberikan warna pada titik-titik sudut kisi atau segitiga dan memvariasikan warna mengikuti bentuk bebas)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | Pembeda yang menandakan gradien mesh |
| `patches` | MeshPatchDef[] |  | Larik patch permukaan. Setiap patch memiliki `points` (mesh titik kendali 4×4 yang dinyatakan sebagai 32 angka dalam urutan x,y; **koordinat bersifat lokal terhadap elemen dalam pt**) dan `colors` (warna dari 4 sudutnya) |
| `triangles` | MeshTriangleDef[] |  | Larik segitiga gradien. Setiap segitiga memiliki `points` (x0,y0,x1,y1,x2,y2; pt lokal elemen) dan `colors` (warna dari 3 titik sudutnya); warna diinterpolasi di antara titik-titik sudut |
| `lattice` | MeshLatticeDef |  | Mesh berbentuk kisi. Memiliki `columns` (jumlah titik sudut per baris, 2 atau lebih), `points` (urutan koordinat titik sudut; pt lokal elemen), dan `colors` (satu warna per titik sudut, dalam urutan yang sama dengan `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | Representasi ringkas dari data mesh asli yang diimpor dari sebuah PDF. Tidak perlu ditentukan pada template yang ditulis tangan |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | Sama seperti di atas, untuk segitiga gradien |
| `pdfShading` | PdfMeshShadingDef |  | Metadata untuk mengeluarkan ulang impor PDF tanpa kehilangan data. Tidak perlu ditentukan pada template yang ditulis tangan |

**`TilingPatternDef`** (pola ubin — mengisi dengan menyusun motif kecil berulang; untuk arsiran, papan catur, logo berulang, dan sejenisnya)

"Ruang pola" dalam tabel adalah sistem koordinat milik pola itu sendiri. Jika `matrix` tidak ditentukan, ruang itu berimpit dengan koordinat pt lokal elemen.

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | Pembeda yang menandakan pola ubin |
| `bbox` | [number, number, number, number] | ✓ | Kotak pembatas satu motif (sel pola), dalam koordinat ruang pola |
| `xStep` | number | ✓ | Interval pengulangan sel secara horizontal (ruang pola) |
| `yStep` | number | ✓ | Interval pengulangan sel secara vertikal (ruang pola) |
| `graphics` | TileGraphicDef[] | ✓ | Larik grafik yang digambar di dalam sel, dibedakan oleh `kind`: `'path'` (data path SVG + fill/stroke) / `'image'` (merujuk ID sumber daya gambar melalui `source`) / `'text'` (teks dengan font, ukuran, dan warna) / `'group'` (grup bersarang dengan transform, clip, opasitas, dsb.). Semua koordinat berada dalam ruang pola |
| `tilingType` | 1 = jarak konstan (sel boleh sedikit terdistorsi agar sesuai perangkat keluaran) \| 2 = tanpa distorsi (jarak boleh sedikit bervariasi) \| 3 = jarak konstan dengan penyusunan ubin yang cepat |  | Mode ketelitian penyusunan ubin. Default: 1 |
| `paintType` | `'colored'` = pola membawa warnanya sendiri / `'uncolored'` = diwarnai sebagai satu warna dengan `color` milik pemakainya |  | Cara warna dibawa. Default: `'colored'` |
| `color` | string |  | Warna pewarna saat memakai pola `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | Matriks transformasi afin dari ruang pola ke ruang lokal elemen. Default: matriks identitas |

**`FunctionShadingDef`** (shading fungsi — isian yang warnanya dihitung oleh sebuah rumus dari koordinat (x, y); terutama muncul pada impor PDF)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | Pembeda yang menandakan shading fungsi. Ada dua varian: bentuk rumus dengan `expression` dan bentuk tersampel dengan `sampled` |
| `domain` | [number, number, number, number] | ✓ | Domain masukan `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (hanya bentuk rumus) | Ekspresi kalkulator PostScript (PDF FunctionType 4). Menerima x, y dan mengembalikan r, g, b. Contoh: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (hanya bentuk tersampel) | Data fungsi tersampel (PDF FunctionType 0). Memiliki `size` (dimensi kisi sampel), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (rentang keluaran), `samples` (nilai sampel per titik kisi), serta `encode`/`decode` yang opsional |
| `matrix` | [number, number, number, number, number, number] |  | Matriks pemetaan dari domain masukan ke **pt lokal elemen**. Default: matriks identitas |
| `background` | [number, number, number] |  | Warna latar belakang di luar domain (komponen DeviceRGB, 0–1) |
| `bbox` | [number, number, number, number] |  | Kotak pembatas yang membatasi penggambaran |
| `antiAlias` | boolean |  | Petunjuk anti-aliasing |
| `paintOperator` | `'pattern'` = digambar sebagai pola (default) / `'sh'` = digambar langsung di bawah clip saat ini |  | Metode penggambaran untuk keluaran PDF |

**`PdfSpecialColorDef`** (isian warna khusus — penentuan warna untuk pencetakan dengan tinta tertentu, seperti emas, perak, atau warna korporat, yang tidak dapat direproduksi oleh pencampuran CMYK biasa)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | Pembeda yang menandakan isian warna khusus |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | Ruang warna dari warna khusus tersebut. Tinta tunggal memakai `kind: 'separation'` dengan `name` (nama tinta), `alternate` (ruang warna proses yang dipakai sebagai gantinya di lingkungan tanpa tinta khusus; lihat tabel di bawah), dan `tintTransform` (menentukan konversi tint ke warna alternatif sebagai fungsi PDF, mis. `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = putih pada tint 0 dan biru pada 1). Beberapa tinta memakai `kind: 'deviceN'` dengan `names` (larik nama tinta), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = standar / `'NChannel'` = bentuk diperluas yang dapat membawa informasi atribut per tinta), `colorants` (peta dari setiap nama tinta ke definisi tinta tunggal), `process`, dan `mixingHints` |
| `components` | number[] | ✓ | Nilai tint setiap tinta (0–1) |
| `displayColor` | string | ✓ | Warna yang dipakai sebagai gantinya untuk tampilan di layar dan pratinjau, yang tidak memiliki tinta khusus |

**`PdfProcessColorSpaceDef`** (ruang warna proses — ruang warna dari "warna biasa" yang dinyatakan dengan mencampur tinta standar seperti CMYK. Dipakai dalam `alternate` milik warna khusus dan `colorSpace` milik soft mask, dibedakan oleh `kind`)

| Varian (`kind`) | Properti tambahan | Deskripsi |
| --- | --- | --- |
| `'gray'` | Tidak ada | Skala abu-abu (DeviceGray) |
| `'rgb'` | Tidak ada | RGB (DeviceRGB) |
| `'cmyk'` | Tidak ada | CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (semuanya wajib) | Abu-abu terkalibrasi secara kolorimetrik (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (per komponen), `matrix` (3×3) (semuanya wajib) | RGB terkalibrasi secara kolorimetrik (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (semuanya wajib) | Ruang warna L\*a\*b\* |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (byte profil ICC) (semuanya wajib) | Ruang warna berbasis profil ICC |

`whitePoint`/`blackPoint` ditentukan sebagai larik `[x, y, z]` dalam ruang warna CIE XYZ.

### Properti band (`bands`) dan grup (`groups`)

Kesepuluh jenis band yang ditentukan dalam `bands` milik template (lihat "Halaman adalah tumpukan "band"") semuanya didefinisikan dengan `BandDef` berikut (hanya `details` yang berupa larik `BandDef`).

**`BandDef`**

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `height` | number | ✓ | Tinggi minimum band (pt). Bertambah seiring elemen meregang |
| `elements` | ElementDef[] |  | Elemen yang ditempatkan pada band |
| `startNewPage` | boolean |  | Selalu memulai band ini pada halaman baru |
| `spacingBefore` | number |  | Jarak sebelum band (pt) |
| `spacingAfter` | number |  | Jarak sesudah band (pt) |
| `splitType` | `'stretch'` = mencetak sebanyak yang muat pada halaman dan melanjutkan sisanya pada halaman berikutnya (default) / `'prevent'` = tidak membelah; mengirim seluruh band ke halaman berikutnya (band tetap dibelah jika tidak muat juga pada halaman baru) / `'immediate'` = membelah segera pada posisi saat ini, bahkan di tengah-tengah sebuah elemen |  | Cara band dibelah saat tidak muat pada batas halaman |
| `printWhenExpression` | Expression \| null |  | Saat hasil evaluasi falsy, band ini tidak dikeluarkan |

**`GroupDef`** (setiap entri `groups`)

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nama grup. Dirujuk dari `resetGroup` milik variabel dan `evaluationGroup` milik textField |
| `expression` | Expression | ✓ | Kunci grup. Dievaluasi untuk setiap baris; di mana pun nilainya berubah, grup sebelumnya ditutup dan grup baru dimulai |
| `header` | BandDef |  | Band yang dikeluarkan pada awal grup |
| `footer` | BandDef |  | Band yang dikeluarkan pada akhir grup |
| `keepTogether` | boolean |  | Saat seluruh grup tidak muat pada ruang yang tersisa tetapi akan muat pada halaman baru, memulainya setelah pemisah halaman |
| `minHeightToStartNewPage` | number |  | Memulai grup pada halaman baru saat tinggi sisa halaman kurang dari nilai ini (pt) |
| `reprintHeaderOnEachPage` | boolean |  | Saat grup terbentang melintasi beberapa halaman, mencetak ulang header pada setiap halaman lanjutan |
| `resetPageNumber` | boolean |  | Mengatur ulang `PAGE_NUMBER` menjadi 1 saat grup dimulai |
| `startNewPage` | boolean |  | Memulai setiap grup pada halaman baru |
| `startNewColumn` | boolean |  | Memulai setiap grup pada kolom baru |
| `footerPosition` | `'normal'` = dikeluarkan tepat setelah baris rincian (default) / `'stackAtBottom'` = ditumpuk ke arah bagian bawah halaman / `'forceAtBottom'` = selalu diletakkan paling bawah pada halaman, memakai habis ruang sisa di antaranya / `'collateAtBottom'` = berbaris di bagian bawah hanya saat footer grup lain juga dirata-bawahkan (sama seperti `'normal'` jika berdiri sendiri) |  | Posisi vertikal footer grup |

### Properti yang tersedia dalam style (`styles`)

Style didefinisikan dalam larik `styles` milik template dan dirujuk berdasarkan `name` dari properti `style` milik elemen. Font, perataan teks, warna, dan pengaturan lain yang terkait teks terutama dilakukan melalui style.

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nama style (dirujuk dari `style` milik elemen) |
| `parentStyle` | string |  | Nama style induk. Mewarisi properti induk dan menimpanya dengan pengaturannya sendiri (rujukan melingkar diabaikan) |
| `isDefault` | boolean |  | Style dengan nilai `true` diterapkan sebagai default pada elemen tanpa `style` |
| `fontFamily` | string |  | Keluarga font. Default: `'default'` |
| `fontSize` | number |  | Ukuran font (pt). Default: 10 |
| `bold` | boolean |  | Tebal. Default: `false` |
| `italic` | boolean |  | Miring. Default: `false` |
| `underline` | boolean |  | Garis bawah. Default: `false` |
| `strikethrough` | boolean |  | Coretan. Default: `false` |
| `forecolor` | string |  | Warna latar depan (`#RRGGBB` atau `#RRGGBBAA`). Default: `#000000` |
| `backcolor` | string |  | Warna latar belakang. Default: `transparent` |
| `hAlign` | `'left'` = rata kiri / `'center'` = rata tengah / `'right'` = rata kanan / `'justify'` = rata kiri-kanan |  | Perataan horizontal. Default: `left` |
| `vAlign` | `'top'` = rata atas / `'middle'` = rata tengah / `'bottom'` = rata bawah |  | Perataan vertikal. Default: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Rotasi teks (derajat) |
| `padding` | Padding |  | Padding |
| `border` | BorderDef |  | Garis tepi |
| `mode` | `'opaque'` = mengisi latar belakang dengan `backcolor` / `'transparent'` = tidak mengisi latar belakang |  | Mode tampilan |
| `opacity` | number |  | Opasitas (0.0–1.0) |
| `variation` | Record<string, number> |  | Nilai sumbu font variabel (mis. `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = penulisan horizontal / `'vertical-rl'` = penulisan vertikal dengan baris bergerak dari kanan ke kiri / `'vertical-lr'` = penulisan vertikal dengan baris bergerak dari kiri ke kanan |  | Arah penulisan |
| `conditionalStyles` | ConditionalStyleDef[] |  | Style bersyarat (lihat tabel di bawah). Saat sebuah kondisi terpenuhi, properti yang bersesuaian ditimpa |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | Arah teks (ltr = kiri ke kanan / rtl = kanan ke kiri / auto = dideteksi otomatis dari kontennya) |
| `openTypeScript` | string |  | Tag OpenType yang menentukan aturan sistem penulisan mana dalam font yang dipakai saat mengonversi teks menjadi bentuk glif (shaping) (mis. `'latn'` = aksara Latin, `'arab'` = aksara Arab). Biasanya tidak perlu ditentukan (ditangani otomatis dari konten teks) |
| `openTypeLanguage` | string |  | Tag OpenType yang menegaskan bahasa secara eksplisit bagi font yang memvariasikan bentuk glif menurut bahasa dalam sistem penulisan yang sama. Biasanya tidak perlu ditentukan |
| `openTypeFeatures` | Record<string, number> |  | Mengaktifkan atau menonaktifkan fitur pengalihan glif bawaan font. Contoh: `{ "palt": 1 }` = merapatkan jarak antarhuruf Jepang, `{ "liga": 0 }` = menonaktifkan ligatur, `{ "zero": 1 }` = angka nol bergaris miring. Nilai: 0 = mati / 1 = hidup; untuk fitur pemilihan glif, nomor glif alternatif berbasis 1 |

**`ConditionalStyleDef`**
| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | Kondisi penerapan. Saat truthy, properti di bawah menimpa style |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | Tipe yang sama dengan properti StyleDef bernama sama |  | Nilai yang ditimpa saat kondisi terpenuhi (maknanya sama dengan properti StyleDef yang bersesuaian) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | Tipe yang sama dengan properti StyleDef bernama sama |  | Dideklarasikan dalam definisi tipe, tetapi implementasi saat ini tidak menerapkan penimpaannya saat kondisi terpenuhi |

### Tipe untuk impor PDF dan fitur PDF tingkat lanjut

Tipe yang tercantum di sini memiliki dua tujuan: (1) tipe "pelestarian" untuk mengeluarkan ulang PDF hasil impor tanpa kehilangan satu byte pun, dan (2) tipe untuk memakai fitur tingkat lanjut seperti lapisan PDF, skrip formulir, dan pengaturan prapencetakan percetakan komersial. Anda hampir tidak akan pernah menentukannya saat menulis laporan biasa secara manual. Tipe yang dijelaskan sebagai "diatur oleh impor PDF" muncul di dalam elemen yang dihasilkan oleh `importPdfPage()`.

**`OptionalContentDef`** (fitur lapisan PDF)

PDF dapat menempatkan konten pada "lapisan" (optional content group, OCG), yang visibilitas dan pencetakannya dapat dialihkan dari panel lapisan pada penampil. Menentukan ini dalam `optionalContent` milik sebuah elemen akan menempatkan elemen tersebut pada sebuah lapisan. Contoh: meletakkan watermark "Confidential" pada lapisan yang hanya muncul saat dicetak.

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `name` | string | ✓ | Nama lapisan yang ditampilkan pada panel lapisan penampil |
| `visible` | boolean |  | Visibilitas awal di layar. Default: true |
| `print` | boolean |  | Status cetak awal. Default: mengikuti `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | Diatur oleh impor PDF. Melestarikan definisi lapisan (OCG) dari PDF sumber atau definisi keanggotaan (OCMD) yang menentukan visibilitas dari kombinasi beberapa lapisan. Sebuah keanggotaan memiliki `groups` (lapisan sasaran), `policy` (`'AllOn'` = terlihat saat semuanya menyala / `'AnyOn'` = saat ada yang menyala / `'AnyOff'` = saat ada yang mati / `'AllOff'` = saat semuanya mati), dan ekspresi logika visibilitas `expression` yang opsional |
| `properties` | PdfOptionalContentPropertiesDef |  | Diatur oleh impor PDF. Melestarikan konfigurasi lapisan tingkat dokumen (daftar semua lapisan, konfigurasi default, pohon urutan tampilan pada panel lapisan, grup pemilihan yang saling eksklusif, penguncian, dsb.) |

**`PdfRawValueDef`** ("nilai mentah" PDF)

Banyak properti pelestarian membawa data internal PDF sebagai "nilai mentah", tanpa menafsirkannya. Nilai mentah adalah nilai JavaScript dengan bentuk berikut: `null`, boolean, dan angka apa adanya; sebuah nama PDF adalah `{ kind: 'name', value: 'DeviceRGB' }`; sebuah string adalah `{ kind: 'string', bytes: Uint8Array }`; sebuah larik adalah `{ kind: 'array', items: [...] }`; sebuah kamus adalah `{ kind: 'dictionary', entries: { ... } }`; sebuah stream adalah `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (aksi yang dijalankan oleh penampil PDF)

Dipakai dalam `additionalActions` milik field formulir dan tempat lain, tipe ini mendefinisikan "apa yang harus dilakukan penampil". Isinya hanya diserialkan dan diimpor — **mesin inti tidak pernah menjalankannya** (eksekusi dilakukan oleh penampil yang mendukungnya).

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | Tipe aksi. `'JavaScript'` = menjalankan skrip (pemformatan masukan formulir, validasi, dan penghitungan otomatis memakai ini) / `'GoTo'` = menuju sebuah tujuan di dalam dokumen / `'GoToR'` = menuju dokumen lain / `'GoToE'` = menuju dokumen tersemat / `'URI'` = membuka sebuah URL / `'Launch'` = menjalankan aplikasi atau berkas / `'Named'` = perintah terdefinisi (halaman berikutnya, dsb.) / `'SubmitForm'` = mengirim formulir / `'ResetForm'` = mengatur ulang formulir / `'ImportData'` = mengimpor data / `'Hide'` = mengalihkan visibilitas anotasi / `'SetOCGState'` = mengalihkan visibilitas lapisan / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = aksi PDF standar lainnya |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Kamus yang menyimpan pengaturan setiap tipe aksi sebagai nilai mentah (lihat **`PdfRawValueDef`** di atas). Contoh: untuk `'JavaScript'`, `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | Tujuan untuk keluarga `'GoTo'`. Berupa bernama (`{ kind: 'named', name, representation: 'name' \| 'string' }`) atau eksplisit (halaman sasaran + cara tampilan disesuaikan) |
| `structureDestination` | PdfStructureDestinationDef |  | Tujuan berbasis elemen struktur dokumen (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | Menentukan anotasi yang menjadi sasaran aksi media |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | Urutan lapisan dan operasi (`'ON'` / `'OFF'` / `'Toggle'`) yang dialihkan oleh `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | Menentukan nama field yang menjadi sasaran `'Hide'` / `'SubmitForm'` / `'ResetForm'` |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | Penentuan berkas tersemat untuk `'GoToE'` (struktur rekursif) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | Parameter khusus platform untuk `'Launch'`. Hanya dilestarikan, tidak pernah dijalankan |
| `articleTarget` | PdfArticleActionTargetDef |  | Penentuan utas artikel untuk `'Thread'` |
| `documentPartIndex` | number |  | Nomor bagian dokumen tujuan untuk `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | Nomor instans rich media |
| `next` | PdfActionDef \| PdfActionDef[] |  | Aksi yang dijalankan berikutnya (perangkaian) |

**`PdfFormXObjectDef`** (pelestarian metadata untuk komponen PDF hasil impor)

Di dalam sebuah PDF, konten gambar yang dipakai berulang kali dapat dipaketkan menjadi komponen bernama "Form XObject". Impor PDF mengonversi komponen semacam itu menjadi elemen `frame` dan menyimpan sistem koordinat serta metadata komponen tersebut dalam tipe ini agar dapat dipulihkan saat dikeluarkan ulang. Tidak perlu ditentukan pada template yang ditulis tangan.

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | Kotak pembatas komponen (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | Matriks transformasi sistem koordinat komponen (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | Transformasi koordinat yang berlaku saat komponen ini digambar dalam PDF sumber |
| `formType` | 1 |  | Nomor tipe form komponen (spesifikasi PDF hanya mendefinisikan 1) |
| `group` | Record<string, PdfRawValueDef> |  | Pelestarian nilai mentah dari kamus grup transparansi |
| `reference` | Record<string, PdfRawValueDef> |  | Pelestarian nilai mentah dari kamus rujukan PDF eksternal |
| `metadata` | Bentuk stream dari PdfRawValueDef (`kind: 'stream'`) |  | Melestarikan stream metadata |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | Melestarikan data khusus aplikasi pembuat (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | Melestarikan stempel waktu terakhir diubah |
| `structParent` / `structParents` | number |  | Melestarikan kunci korespondensi ke PDF bertag (struktur dokumen seperti urutan baca) |
| `opi` | PdfOpiMetadataDef |  | Melestarikan informasi OPI (lihat tabel di bawah) |
| `name` | string |  | Nama komponen |
| `measure` | PdfMeasurement |  | Melestarikan informasi pengukuran (lihat tabel di bawah) |
| `pointData` | PdfPointData[] |  | Melestarikan data awan titik (lihat tabel di bawah) |

**`PdfSourceVectorDef`** (definisi bersama bentuk berulang hasil impor)

Saat mengimpor sebuah PDF yang di dalamnya bentuk yang sama berulang dalam jumlah besar — seperti simbol peta — data outline bentuk tersebut dilestarikan dalam wujud "satu definisi + N penempatan". Ini muncul dalam `pdfSourceVector` milik elemen `path`; saat ditentukan, tidak ada penguraian `d` yang dilakukan. Tidak perlu ditentukan pada template yang ditulis tangan.

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | Larik definisi bentuk yang dapat dipakai ulang. Setiap definisi memiliki `commands` (0 = pindah ke titik awal [2 koordinat], 1 = garis lurus [2], 2 = kurva Bezier kubik [6], 3 = menutup path [0]) dan `coords` (larik koordinat yang diratakan dalam urutan perintah) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | Larik penempatan dari definisi-definisi tersebut. Setiap penempatan memiliki `definitionIndex` (nomor definisi) dan `matrix` (matriks afin 6 elemen) |

**`PdfOpiMetadataDef`** (informasi penggantian gambar untuk percetakan komersial)

OPI (Open Prepress Interface) adalah mekanisme percetakan komersial yang menggunakan gambar ringan beresolusi rendah selama penyuntingan dan menukarnya dengan gambar beresolusi tinggi saat percetakan menghasilkan keluarannya. Dilestarikan saat PDF hasil impor membawa spesifikasi ini.

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | Versi OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Menyimpan isi kamus OPI sebagai nilai mentah PDF (nama berkas sumber untuk penggantian, area pemangkasan, dsb.) |

**`PdfMeasurement`** (informasi pengukuran untuk gambar teknik dan peta)

Pada PDF gambar teknik dan peta, perkakas pengukuran penampil dapat mengukur jarak dan luas pada skala seperti "1 cm di kertas setara dengan 1 m di dunia nyata". Tipe ini melestarikan informasi skala dan sistem koordinat tersebut, serta hadir dalam bentuk rektilinear (`kind: 'rectilinear'`) dan bentuk geospasial (`kind: 'geospatial'`).

| Properti (`'rectilinear'`) | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | Pembeda untuk pengukuran rektilinear |
| `scaleRatio` | string | ✓ | Teks tampilan skala (mis. `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` bersifat opsional) | Rangkaian format tampilan angka untuk arah X/Y (label satuan, faktor konversi, tampilan desimal/pecahan, dsb.). Saat `y` dihilangkan, `x` yang dipakai |
| `distance` / `area` | PdfNumberFormat[] | ✓ | Format tampilan angka untuk jarak/luas |
| `angle` / `slope` | PdfNumberFormat[] |  | Format tampilan angka untuk sudut/kemiringan |
| `origin` | [number, number] |  | Titik asal pengukuran |
| `yToX` | number |  | Faktor konversi dari satuan Y ke X |

| Properti (`'geospatial'`) | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | Pembeda untuk pengukuran geospasial |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | Sistem koordinat geodetik. Diperlukan salah satu dari kode EPSG atau string WKT |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | Titik kendali dalam koordinat geodetik dan titik kendali lokal yang bersesuaian di dalam gambar atau komponen (jumlahnya sama) |
| `dimension` | 2 \| 3 |  | Dimensi koordinat. Default: 2 |
| `bounds` | [number, number][] |  | Poligon area yang dapat diukur |
| `displayCoordinateSystem` | Sama seperti `coordinateSystem` |  | Sistem koordinat untuk tampilan |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | Satuan tampilan yang disukai untuk jarak, luas, dan sudut |
| `projectedCoordinateSystemMatrix` | Tuple angka 12 elemen |  | Matriks afin 4×4 untuk sistem koordinat terproyeksi (12 elemen dalam urutan baris, dengan kolom keempat yang konstan dihilangkan) |

**`PdfPointData`** (data awan titik peta)

Untuk melestarikan tabel data titik yang tersemat dalam PDF peta, dengan kolom bernama seperti `LAT` (lintang), `LON` (bujur), dan `ALT` (ketinggian).

| Properti | Tipe / nilai yang diizinkan | Wajib | Deskripsi |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | Larik nama kolom (unik dan tidak kosong; kolom `LAT`/`LON`/`ALT` harus berupa angka) |
| `rows` | PdfRawValueDef[][] | ✓ | Nilai setiap baris. Panjang baris sesuai dengan `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (fungsi transfer nada untuk prapencetakan)

Fungsi yang dipakai dalam `deviceParams` dan `softMask` milik `frame` yang memetakan sebuah nilai (0–1) ke nilai lain. Dalam prapencetakan, fungsi ini menyatakan kurva nada — "tinta dengan kerapatan sekian dicetak pada kerapatan sekian". Sebuah `TransferFunctionDef` berupa `CalculatorFunctionDef` (sebuah ekspresi kalkulator PostScript, mis. `{ expression: '{ 1 exch sub }' }` = membalik hitam dan putih) atau `PdfFunctionDef` (sebuah objek fungsi PDF: tabel nilai tersampel, interpolasi eksponensial, atau kombinasi keduanya); di tempat ia dipakai, `'Identity'` (tanpa transformasi) juga dapat ditentukan.

**`HalftoneDef`** (definisi halftone untuk prapencetakan)

Mesin cetak menyatakan gradasi nada dengan ukuran titik-titik kecil (titik halftone). Ini menentukan bagaimana titik-titik tersebut disusun, dan dipakai untuk pelestarian impor PDF serta untuk membuat data prapencetakan. `type` membedakan lima bentuk:

| Bentuk | Properti utama | Deskripsi |
| --- | --- | --- |
| type 1 (screen) | `frequency` (kerapatan raster) ✓, `angle` (sudut) ✓, `spotFunction` (bentuk titik; sebuah nama terdefinisi seperti `'Round'` atau sebuah ekspresi kalkulator) ✓, `accurateScreens` (meminta penyusunan screen berketelitian tinggi; opsional) | Bentuk standar yang mendefinisikan halftone melalui kerapatan raster, sudut, dan bentuk titik (`type` boleh dihilangkan) |
| type 6 (larik ambang) | `width` ✓, `height` ✓, `thresholds` (width × height nilai, 0–255) ✓ | Mendefinisikan halftone secara langsung dengan tabel ambang |
| type 10 (ambang bersudut) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | Definisi ambang dengan sel bersudut |
| type 16 (ambang 16-bit) | `width` ✓, `height` ✓, `thresholds` (nilai 16-bit) ✓, persegi panjang kedua yang opsional | Definisi ambang berketelitian tinggi |
| type 5 (koleksi per pelat) | `halftones` (larik dari `{ colorant: nama tinta, halftone: salah satu bentuk di atas }`) ✓ | Menetapkan halftone yang berbeda untuk setiap pelat warna, seperti cyan dan magenta |

Keempat bentuk selain type 5 dapat membawa `transferFunction` yang opsional (`'Identity'` atau sebuah `TransferFunctionDef`) (untuk type 5, setiap definisi halftone internal per pelat membawanya masing-masing).

## API inti

API yang paling sering dipakai, dicantumkan satu per satu dengan contoh minimal agar Anda dapat mencarinya berdasarkan "apa yang ingin Anda lakukan". `template`, `dataSource`, `fontMap`, dan `fonts` diasumsikan persis seperti yang dibangun dalam tutorial.

### Membangun laporan

#### Membangun laporan dari template dan data — `createReport()`

Menata letak template dan data lalu mengembalikan sebuah `RenderDocument` yang berorientasi halaman. Ekspresi memakai bahasa ekspresi bawaan yang aman dan dapat merujuk `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES`, dan lainnya — tanpa `eval` maupun `Function`. Ekspresi callback TypeScript juga merupakan sebuah pilihan.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // jumlah halaman yang telah ditata letak
```

#### Mencari dan mengubah elemen template berdasarkan ID — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

Kedua API mengembalikan referensi ke elemen dari template aslinya. Lakukan perubahan Anda sebelum memanggil `createReport()`. `getElementChildren()` hanya mengembalikan elemen anak untuk `frame` dan `table` (elemen di dalam sel); untuk elemen lain ia mengembalikan larik kosong. Untuk detail tentang cakupan pencarian, lihat "Mencari elemen berdasarkan ID dan mengubahnya sebelum rendering".

#### Membangun laporan dari sebuah berkas `.report` — `createReportFromFile()` (Node.js)

Membaca template JSON dan menyelesaikan path relatif untuk gambar dan subreport terhadap direktori template.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### Menggabungkan beberapa laporan menjadi satu jilid — `createReportBook()`

Menyambung beberapa template — sampul, isi, dan seterusnya — menjadi satu `RenderDocument` dengan penomoran halaman yang berkelanjutan.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### Menyambung `RenderDocument` yang sudah dibangun — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

ID gambar yang bertabrakan diganti namanya secara otomatis.

#### Menghasilkan halaman daftar isi secara otomatis — `insertTableOfContents()`

Mengumpulkan entri daftar isi dari anchor (`anchorName`) dalam laporan dan menyisipkan halaman daftar isi di bagian depan.

```ts
const withToc = insertTableOfContents(
  document,
  // Ukuran halaman dan margin daftar isi dalam pt (contoh ini: A4 potret)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // ID font (kunci fontMap) yang dipakai untuk teks daftar isi
  { title: '目次' },
)
```

#### Mendapatkan jumlah halaman sebuah PDF yang sudah ada — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### Mengimpor PDF yang sudah ada sebagai elemen laporan — `importPdfPage()`

Untuk detailnya, lihat **Mengonversi PDF yang sudah ada menjadi elemen laporan (impor PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### Rendering dan keluaran

#### Mengeluarkan PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### Mempratinjau satu halaman — `renderPage()`

Rendering per halaman. Gunakan untuk menggambar hanya halaman yang sedang ditampilkan dalam pratinjau di browser.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### Merender seluruh laporan ke backend mana pun — `render()`

Merender semua halaman ke target keluaran mana pun yang mengimplementasikan antarmuka `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### Menggambar ke HTML Canvas — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### Mengeluarkan SVG — `SvgBackend`

Menghasilkan satu string `<svg>` mandiri per halaman.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // larik string <svg>, satu per halaman
```

#### Kendali halus atas pembuatan PDF — `PdfBackend`

Opsi khusus PDF seperti thumbnail halaman diberikan ke konstruktor.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` berlaku untuk halaman ke-i. Untuk `thumbnailImageId` (gambar thumbnail yang ditampilkan dalam daftar halaman), tentukan ID gambar yang ada dalam `document.images`.

#### Menggabungkan PDF yang sudah jadi — `mergePdfFiles()`

Menggabungkan beberapa PDF menjadi satu dengan parser PDF pure TypeScript.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### Bekerja dengan font

#### Memuat berkas font — `Font.load()`

Mengurai TTF, OTF, TTC, OTC, WOFF, WOFF2, dan EOT.

```ts
const font = Font.load(fontBuffer)
```

#### Mengukur lebar teks — `TextMeasurer`

Pengukuran teks yang cepat dengan dukungan cache glif milik `Font`. Terdaftar dalam `fontMap`, ia juga dipakai untuk tata letak.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### Mengonversi string menjadi urutan glif — `font.shapeText()`

Memakai informasi OpenType / AAT (spesifikasi perluasan pada font turunan Apple) / Graphite (spesifikasi perluasan pada font turunan SIL) untuk memperoleh urutan glif (nomor glif beserta posisi dan langkahnya) dengan pemilihan glif, ligatur, dan penyesuaian penempatan yang telah diterapkan.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### Mendeteksi glif yang hilang sebelum mencetak — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### Memakai barcode, SVG, rumus matematika, dan gambar secara mandiri

#### Menghasilkan barcode secara mandiri — `renderBarcode()`

Menghasilkan node gambar barcode secara langsung, tanpa melalui elemen laporan.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### Mengurai dan merender SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### Menata rumus matematika secara mandiri — `parseMathLaTeX()` / `layoutMathFormula()`

Membutuhkan font yang menyertakan informasi dimensi untuk rumus matematika (tabel MATH OpenType) — misalnya STIX Two Math atau Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// argumen: rumus hasil penguraian, objek Font, ID font (kunci fontMap), ukuran font dalam pt, warna teks
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box adalah hasil tata letaknya; elemen math pada template menjalankan tata letak yang sama ini secara internal
```

#### Mendapatkan dimensi gambar — `getImageDimensions()`

Mendukung PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### Mendekode PNG — `decodePng()`

Sebuah dekoder PNG pure TypeScript.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### Mengeluarkan PDF yang memuat WebP/AVIF di browser — `prepareBrowserPdfImageResources()`

JPEG disimpan langsung ke dalam PDF, dan PNG ditangani oleh dekoder bawaan. Saat menghasilkan PDF yang memuat WebP/AVIF di browser, `tsreport-core/browser` terlebih dahulu mendekode hanya gambar yang benar-benar dirujuk oleh `RenderDocument` menggunakan codec standar browser, lalu meneruskan hasilnya ke pembuatan PDF. Gambar yang tidak dirujuk dibiarkan apa adanya dan tidak didekode.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: byte gambar yang disediakan saat rendering; catalog: pengaturan katalog
// dokumen PDF; collection: pengaturan portofolio PDF — hilangkan mana pun yang tidak Anda pakai
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

Untuk mendekode WebP/AVIF di Node.js, gunakan `createNodeExternalRasterImageDecoder()` dari `tsreport-core/node`.

## Pembatasan pemuatan sumber daya dan aturan ID gambar

Aturan rinci yang perlu dirujuk saat menjadi relevan bagi pengoperasian server atau penyematan pustaka.

### Membatasi direktori tempat gambar dan template dimuat

Pemuatan berkas gambar dapat dibatasi pada direktori yang diizinkan secara eksplisit.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` secara default menyelesaikan path relatif terhadap direktori template utama, tetapi demi kompatibilitas mundur ia tidak membatasi cakupan pemuatannya sendiri secara implisit. Saat `resources.fileRoot` ditentukan, pembatasan yang sama berlaku bagi gambar, template utama, dan subreport secara setara. Gambar yang hilang ditangani sesuai pengaturan `onError` masing-masing elemen, dan rujukan yang menunjuk ke luar direktori yang diizinkan (termasuk melalui symbolic link) selalu menghasilkan error.

### Aturan ID gambar

Setiap gambar milik `RenderDocument` dicari dari `RenderDocument.images` dengan `RenderImage.imageId` (demikian pula `imageId` milik sebuah alternate) sebagai kuncinya. **Pemakai harus memakai ID ini sebagai kunci persis apa adanya dan tidak boleh menyusun ulang kunci melalui penggabungan path atau sejenisnya.** ID ditetapkan menurut aturan berikut.

- Memuat gambar melalui path relatif tidak menggantikan ID dengan path absolut server maupun path hasil penyelesaian symlink. Rujukan sebagaimana tertulis dalam template tetap menjadi kuncinya (jika ditulis sebagai path absolut, nilai tersebut dipertahankan apa adanya)
- Path fisik hasil penyelesaian symlink dipakai secara internal hanya untuk memutuskan apakah dua rujukan merupakan berkas yang sama. Bahkan saat direktori dasarnya berbeda, gambar yang menunjuk ke berkas fisik yang sama memakai ulang ID yang sama
- Pada konfigurasi ketika laporan akar menangguhkan sebuah gambar untuk disediakan saat rendering — memakai `createReport()` secara langsung tanpa melewatkan gambar bersangkutan melalui `resources` juga, sehingga rujukan yang tertulis dalam template menjadi ID apa adanya dan byte-nya disediakan belakangan melalui `renderToPdf(document, { images })` — gambar lokal berpath relatif yang dimuat oleh subreport selalu diberi ID internal yang tidak bergantung pada host. Karena rujukan dalam ekspresi dan subreport dinamis tidak dapat dienumerasi di muka, hal ini tidak bergantung pada apakah sebuah nama benar-benar bertabrakan maupun pada urutan tata letaknya. Akibatnya, gambar lokal milik subreport tidak akan pernah dapat membajak ID penyediaan-saat-rendering yang bernama sama

### Penyediaan gambar saat rendering dan alternate

Saat sebuah alternate tidak dapat diselesaikan pada waktu tata letak, ID gambar aslinya dipertahankan. Karena itu pratinjau Canvas/SVG tidak berhenti, dan byte-nya dapat disediakan belakangan melalui `renderToPdf(document, { images })`. `images` yang dilewatkan secara eksplisit digabungkan ke dalam `document.images`, dengan nilai yang dilewatkan secara eksplisit lebih diutamakan untuk ID yang sama. Selama pembuatan PDF pun, alternate yang tidak disediakan sekadar dikecualikan dari kandidat alternate — baik rendering gambar utamanya maupun laporan secara keseluruhan tidak berhenti.

### Cakupan pengumpulan rujukan gambar

Pengumpulan rujukan gambar menangani bukan hanya elemen `image` biasa, melainkan juga alternate, soft mask grup, dan pola ubin dari isian (fill/stroke) beserta soft mask bersarangnya, semuanya melalui mekanisme yang sama. Saat memakai thumbnail halaman khusus PDF, thumbnail folder koleksi, atau gambar Web Capture di browser, lewatkan `catalog`, `collection`, dan `pageOptions` yang sama ke `prepareBrowserPdfImageResources(document, options)` maupun `renderToPdf(document, options)` (dengan API primitif, lewatkan opsi yang sama ke `new PdfBackend(options)` lalu panggil `render(document, backend)`). Gambar WebP/AVIF ini pun hanya didekode seperlunya sebelum pembuatan PDF.

## Persyaratan runtime

- Node.js 18 atau yang lebih baru
- ES Modules / CommonJS
- Browser modern
- Tanpa paket dependensi runtime

Kompresi dan dekompresi Brotli WOFF2 memakai implementasi pure TypeScript yang tertanam dalam tsreport-core, baik di Node.js maupun browser. Tidak diperlukan paket eksternal, WASM, maupun pustaka native.

## Proyek terkait

- [tsreport-core](https://github.com/pontasan/tsreport-core)
- [tsreport-editor](https://github.com/pontasan/tsreport-editor)
- [tsreport-sdk](https://github.com/pontasan/tsreport-sdk)
- [tsreport-react](https://github.com/pontasan/tsreport-react)

## Lisensi

tsreport-core tersedia, sesuai pilihan Anda, di bawah [MIT License](./LICENSE-MIT) atau [Apache License 2.0](./LICENSE-APACHE) (SPDX: `MIT OR Apache-2.0`). Untuk pemberitahuan hak cipta dan ketentuan lisensi kode serta data pihak ketiga, lihat [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
