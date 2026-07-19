# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | Tiếng Việt | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**Từ tiếng Nhật, tiếng Trung, tiếng Hàn đến chữ Ả Rập — một engine báo cáo biến các hệ chữ viết trên thế giới thành những trang PDF đẹp, bằng TypeScript thuần.**

`tsreport-core` đảm nhận việc phân tích font OpenType, sắp chữ văn bản (sắp xếp các ký tự lên trang với đúng hình dạng glyph, độ rộng và vị trí), bố cục báo cáo dạng band, xem trước bằng Canvas/SVG và sinh PDF — tất cả thông qua một mô hình kết xuất nhất quán duy nhất. Package không có bất kỳ phụ thuộc runtime nào. Không module native, không WASM — chỉ một package này chạy được trên cả Node.js lẫn các trình duyệt hiện đại.

Các đoạn mã mẫu trong tài liệu này cố ý sử dụng dữ liệu nghiệp vụ tiếng Nhật (báo giá, hóa đơn): chúng đồng thời là màn trình diễn trực tiếp khả năng sắp chữ CJK của chính engine này.

```bash
npm install tsreport-core
```

README này chứa đầy các mẫu bạn có thể sao chép và chạy ngay, bao phủ mọi thứ từ lần sinh PDF đầu tiên đến toàn bộ 16 phần tử báo cáo, viết dọc, sắp chữ đa ngôn ngữ, nhúng font và chuyển chữ thành outline, cho tới xem trước trên trình duyệt. Nếu bạn mới làm quen với công cụ báo cáo, hãy bắt đầu từ **Kiến thức cơ bản về bố cục báo cáo** để nắm cảm giác về các khái niệm, rồi dựng PDF đầu tiên của bạn theo phần hướng dẫn.

## Thiết kế báo cáo WYSIWYG trực quan bằng tsreport-editor

[tsreport-editor](https://github.com/pontasan/tsreport-editor) là trình thiết kế báo cáo WYSIWYG được xây dựng trên tsreport-core. Bạn có thể sắp xếp band và phần tử trực quan, liên kết dữ liệu kiểm thử JSON, kiểm tra bản xem trước khi in, nhập PDF và tạo PDF bằng cùng một engine kết xuất core. Các video cho thấy AI chỉnh sửa báo cáo qua MCP rồi mở bản xem trước hoàn chỉnh trong Editor.

| Demo tiếng Anh | Demo tiếng Nhật |
| --- | --- |
| [![Demo WYSIWYG tsreport-editor bằng tiếng Anh](https://img.youtube.com/vi/CHsNew6yQr4/hqdefault.jpg)](https://youtu.be/CHsNew6yQr4) | [![Demo WYSIWYG tsreport-editor bằng tiếng Nhật](https://img.youtube.com/vi/0I3ljxLUbys/hqdefault.jpg)](https://youtu.be/0I3ljxLUbys) |

## Sắp chữ đúng cho các hệ chữ viết trên thế giới, chỉ bằng một engine

Một báo cáo đa ngôn ngữ không thể hiển thị đúng nếu chỉ đơn giản ghi chuỗi ký tự thẳng vào PDF. Chọn glyph, đo độ rộng ký tự, định vị, ngắt dòng, viết dọc, rồi nhúng font vào PDF — chỉ khi toàn bộ chuỗi xử lý này ăn khớp với nhau, bạn mới nhận được trang giấy như mong đợi.

`tsreport-core` gánh trọn dòng chảy này, từ phân tích font cho đến sinh PDF.

- **Tiếng Nhật, tiếng Trung, tiếng Hàn** — chữ Trung giản thể và phồn thể, Hangul, xử lý dấu câu và glyph dành cho viết dọc đều được sắp chữ chính xác dựa trên dữ liệu Unicode và OpenType
- **Chữ Ả Rập và sắp chữ phải-sang-trái (RTL)** — biến hình glyph theo ngữ cảnh, nối chữ và chữ ghép (ligature — nhiều ký tự hợp nhất thành một hình glyph), cùng xử lý hai chiều Unicode (kiểm soát thứ tự khi văn bản phải-sang-trái trộn lẫn với chữ số và chữ Latin) đều đi qua cùng một pipeline bố cục như mọi hệ chữ khác
- **Các hệ chữ viết phức tạp** — hỗ trợ thay thế và định vị glyph theo quy tắc sắp chữ tích hợp trong font (OpenType Layout), ký tự kết hợp, biến thể glyph (các thiết kế khác nhau của cùng một ký tự) và các tính năng sắp chữ theo từng ngôn ngữ
- **Viết dọc** — xử lý `vertical-rl` / `vertical-lr`, glyph dành cho viết dọc, số đo dọc (dữ liệu kích thước như độ rộng tiến riêng cho văn bản dọc) và xoay ký tự
- **Tự động nhúng subset font** — chỉ những glyph thực sự được dùng (dữ liệu hình dạng theo từng ký tự lưu trong font) mới được nhúng vào PDF, nên tài liệu hiển thị y hệt ngay cả trên máy không cài font đó
- **Chuyển chữ thành outline** — theo từng phần tử, văn bản có thể được xuất thành đường path vector không phụ thuộc font
- **Tham chiếu font hệ thống** — với các quy trình dựa vào font của trình xem, bạn cũng có thể tạo PDF gọn nhẹ không nhúng font
- **Phát hiện lỗi hiển thị ký tự trước khi nó xảy ra** — `checkGlyphCoverage()` chỉ ra các ký tự thiếu trong font, theo từng trang và từng ký tự, trước khi xuất

Và phần sắp chữ này hoạt động như một thể thống nhất với engine bố cục được xây riêng cho báo cáo — bởi năng lực đặt ký tự chính xác và năng lực phân trang chính xác không thể tách rời nhau.

- **Bố cục phản ứng theo lượng văn bản** — dòng giãn ra theo lượng chữ (`stretchWithOverflow`) và chiều cao band tự động điều chỉnh. Tên sản phẩm dài không bao giờ bị cắt cụt
- **Tự động ngắt trang theo lượng dữ liệu** — khi các dòng chi tiết tràn trang, engine mở trang mới và tự phát lại header cùng dòng tiêu đề. Tính tổng con theo nhóm và ngắt trang theo nhóm chỉ cần một khai báo
- **Bố cục lồng nhau** — ngay cả các báo cáo phức tạp kết hợp bảng, bảng chéo (crosstab) và báo cáo con cũng được đặt chỗ nhất quán bởi cùng một engine bố cục
- **WYSIWYG (xem trước = bản in)** — phần tử được cố định đúng tại tọa độ pt bạn chỉ định, và bản xem trước Canvas/SVG dùng chung kết quả bố cục y hệt với đầu ra PDF. Những gì bạn thấy trên màn hình chính là những gì in ra giấy

## Vì sao chọn tsreport-core

tsreport-core ra đời từ ba trăn trở.

**TypeScript chưa có một giải pháp báo cáo nghiêm túc.** Xuất báo giá và hóa đơn là nhu cầu nghiệp vụ cơ bản, vậy mà hệ sinh thái TypeScript/Node.js — dù có thư viện vẽ PDF cấp thấp — lại không có thứ gì xứng danh "engine báo cáo": bố cục band, ngắt trang tự động, tính gộp, và sự trung thực giữa xem trước với bản in trong một package. Chúng tôi muốn chấm dứt cảnh phải kéo thêm một runtime ngôn ngữ khác hay một sản phẩm máy chủ bên ngoài chỉ để in báo cáo.

**Báo cáo là năng lực nền tảng, và mọi người phải được dùng miễn phí.** Xuất báo cáo không phải tính năng cao cấp dành riêng cho vài sản phẩm đắt tiền; nó là một phần nền móng của mọi hệ thống nghiệp vụ. Không giấy phép thương mại phải mua, không phí theo mức sử dụng — mọi người, từ công cụ cá nhân đến sản phẩm thương mại, đều dùng được cùng một engine nguyên trạng. tsreport-core công bố toàn bộ tính năng dưới giấy phép kép MIT OR Apache-2.0 như hiện thân của niềm tin này.

**Hiếm giải pháp nào đối mặt trực diện với hỗ trợ đa ngôn ngữ — chữ Á Đông, chữ Ả Rập và hơn thế.** Phần lớn công cụ báo cáo và PDF được thiết kế quanh văn bản Latin, xem việc sắp chữ Nhật, Trung, Hàn hay chữ Ả Rập phải-sang-trái như chuyện tính sau. tsreport-core đặt "sắp chữ đúng cho các hệ chữ viết trên thế giới, chỉ bằng một engine" làm mục tiêu thiết kế ngay từ ngày đầu, tự triển khai mọi thứ từ phân tích font đến sắp chữ và nhúng vào PDF.

Những động lực đó kết tinh thành ba thế mạnh.

### Từ engine bố cục đến sinh PDF, trọn vẹn trong một package

Khi các trang được dựng lên từ template và dữ liệu, kết quả được ghi lại trong một mô hình kết xuất duy nhất gọi là `RenderDocument`. Cùng mô hình đó có thể kết xuất ra PDF, Canvas hoặc SVG, nên không cần duy trì hai bộ logic bố cục trùng lặp cho xem trước trên màn hình và bản in — PDF trông y hệt những gì bạn đã thấy trên màn hình. Không cần nối ghép một engine báo cáo bố cục band với một thư viện PDF.

### TypeScript thuần, không phụ thuộc runtime

Phân tích font, sắp chữ, sinh PDF, nén DEFLATE, mã hóa, giải mã PNG và sinh mã vạch đều được triển khai bằng TypeScript thuần. Không module native, không tiến trình ngoài, nó hành xử giống hệt nhau trong mọi môi trường, và việc kiểm toán mã chạy trong lúc sinh báo cáo chỉ là đọc đúng một package này.

### Mọi thứ một báo cáo cần, đã có sẵn

- Bố cục band với title, page header, detail, group, summary và nhiều hơn nữa
- Bảng, bảng chéo (crosstab), báo cáo con, biến, biểu thức, ngắt trang, mục lục, gộp nhiều báo cáo
- Nhập PDF có sẵn — chuyển các trang PDF thành phần tử báo cáo (`ElementDef`), style, hình ảnh và thông tin font
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, gradient, cắt xén (clipping), độ trong suốt, sắp chữ công thức toán, hình ảnh
- Mã hóa PDF, PDF/A-1b, 2b, 3b (chuẩn quốc tế cho lưu trữ dài hạn), PDF/X-1a (chuẩn quốc tế cho nộp bản in), dấu trang (bookmark), liên kết, biểu mẫu, chú thích
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, font biến thiên (variable font — font có trọng lượng, độ rộng và các trục khác thay đổi liên tục) và font màu

## Kiến thức cơ bản về bố cục báo cáo

Dành cho bạn đọc mới với engine báo cáo, phần này lần lượt đi qua các khái niệm nền tảng.

### Tiền đề: báo cáo được dựng từ "template" cộng "dữ liệu"

Trong tsreport-core, một báo cáo được dựng từ hai phần: **template** (định nghĩa bố cục) và **dữ liệu** (JSON).

Template không chứa giá trị thực nào. Nó chỉ định nghĩa các khung — "tên hàng nằm ở đây; số tiền nằm kia, với độ rộng này và định dạng này" — cùng tham chiếu tới **trường dữ liệu nào sẽ hiển thị** ở mỗi khung (viết là `field.item`, nghĩa là trường `item` của dữ liệu).

Giá trị thực được truyền vào dưới dạng dữ liệu JSON. Mỗi phần tử của mảng `rows` là một dòng chi tiết.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

Khi báo cáo được sinh, engine duyệt `rows` từ trên xuống dưới, phát bố cục chi tiết một lần cho mỗi dòng. Trong ví dụ trên, ba dòng chi tiết được in ra, và `field.item` lần lượt trở thành りんご, みかん, ぶどう. Nếu dữ liệu tăng lên 10.000 dòng, báo cáo dài ra 10.000 dòng mà không phải sửa một ký tự nào của template. Sự phân công này — bố cục cố định, số dòng theo dữ liệu — là điểm xuất phát của mọi engine báo cáo.

### Một trang là một chồng các "band"

Về phía template, bạn thiết kế trang như một chồng các dải ngang gọi là **band**. Thay vì tự tính tọa độ Y và đặt phần tử lên trang, bạn chỉ khai báo "band nào chứa gì", và engine tự động lắp ráp các trang theo số dòng dữ liệu. Một trang có cấu trúc như sau.

```text
┌──────────────────────────┐
│ title                    │ ← một lần ở đầu báo cáo (tiêu đề, nơi nhận, …)
├──────────────────────────┤
│ pageHeader               │ ← đầu mỗi trang (tên công ty, ngày phát hành, …)
├──────────────────────────┤
│ columnHeader             │ ← dòng tiêu đề cho các dòng chi tiết (tên hàng, số lượng, thành tiền, …)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ một lần cho mỗi dòng của rows,
│ details                  │ │ lặp lại theo đúng số dòng hiện có
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← khép lại các dòng chi tiết (theo trang/cột)
├──────────────────────────┤
│ pageFooter               │ ← cuối mỗi trang (số trang, …)
└──────────────────────────┘
```

Trên trang cuối, sau dòng `details` cuối cùng, `summary` (tổng cộng của toàn báo cáo, v.v.) được xuất đúng một lần. Ngoài các band trên còn có `background`, trải dưới mọi trang; `lastPageFooter`, chỉ dùng cho trang cuối; và `noData`, chỉ xuất hiện khi dữ liệu không có dòng nào — tổng cộng mười loại band có thể định nghĩa trong `bands`.

| Band | Thời điểm xuất | Công dụng điển hình |
| --- | --- | --- |
| `background` | Nền của mọi trang | Hình mờ, viền trang trí |
| `title` | Một lần ở đầu báo cáo | Tiêu đề, nơi nhận |
| `pageHeader` | Đầu mỗi trang | Tên công ty, ngày phát hành |
| `columnHeader` | Trước các dòng chi tiết (theo trang/cột) | Dòng tiêu đề chi tiết |
| `details` | Một lần cho mỗi dòng dữ liệu (`rows`) | Các dòng chi tiết |
| `columnFooter` | Sau các dòng chi tiết (theo trang/cột) | Vùng tổng con |
| `pageFooter` | Cuối mỗi trang | Số trang |
| `lastPageFooter` | Cuối trang cuối cùng (thay thế `pageFooter` khi được chỉ định) | Lời kết |
| `summary` | Một lần sau toàn bộ dòng chi tiết | Tổng cộng, ghi chú |
| `noData` | Khi dữ liệu không có dòng nào | "Không có dữ liệu phù hợp" |

Nếu bạn định nghĩa thêm `groups`, header và footer của nhóm được tự động chèn vào bất cứ nơi nào khóa nhóm thay đổi, cho bạn những bố cục kiểu "tổng con theo từng phòng ban, rồi sang trang mới."

Bạn cũng có thể chỉ định `columns` trong template (`count` = số cột, `spacing` = khoảng cách giữa các cột theo pt) để rót vùng chi tiết vào nhiều **cột** dọc theo kiểu báo chí. Mặc định là một cột; khi đó, bất cứ chỗ nào trong tài liệu này ghi "theo cột" đều đồng nghĩa với "theo trang". Việc chuyển sang cột kế tiếp được gọi là "ngắt cột".

### Ngắt trang diễn ra tự động

Khi các dòng chi tiết không còn chỗ trên trang, engine tự động đóng trang đó (xuất `pageFooter`), mở trang kế tiếp, xuất lại `pageHeader` và `columnHeader`, rồi tiếp tục rót các dòng chi tiết còn lại. Bạn không bao giờ phải đếm dòng hay tính chiều cao còn thừa của trang.

Chỉ khi muốn tự kiểm soát, bạn mới cần đến những thứ sau.

- Phần tử `break` — buộc ngắt trang hoặc ngắt cột tại vị trí bất kỳ
- `startNewPage` của band — luôn bắt đầu band đó trên trang mới
- `splitType` của band — khi không đủ chiều cao, chọn cho phép band vắt ngang qua trang giữa chừng (`stretch`) hay phải dời nguyên vẹn sang trang sau (`prevent`)

### Báo cáo con = một báo cáo khác nhúng bên trong báo cáo

Phần tử `subreport` nhúng nguyên một file `.report` riêng biệt vào bố cục của báo cáo cha. "In danh sách đơn hàng, và bên trong mỗi đơn in các dòng hàng của nó thành bảng" — đây là cơ chế để bố trí **dữ liệu lồng nhau** như vậy.

Giả sử mỗi dòng trong `rows` của cha (một đơn hàng) mang theo mảng `items` chứa các dòng hàng.

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

Đặt một phần tử `subreport` vào band `details` của cha và truyền "mảng `items` của đơn hàng này" qua `dataSourceExpression`.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression`, đúng như tên gọi, là một biểu thức. Để truyền tên file cố định, hãy bọc nó trong `'...'` như một chuỗi hằng bên trong biểu thức (bạn cũng có thể chuyển đổi động bằng biểu thức như `"field.templatePath"`).

Báo cáo con khi đó **chạy một lần cho mỗi dòng chi tiết của cha**, và mảng `items` được truyền vào được xem như `rows` của chính báo cáo con. Báo cáo con (`order-items.report`) tự thân là một template độc lập: nó có định nghĩa band riêng và tham chiếu từng dòng hàng qua `field.name` và `field.qty`. Trên trang giấy, nó trải ra như sau.

```text
┌──────────────────────────────┐
│ details                      │ ← rows của cha, dòng 1 (đơn hàng A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← nhận items của đơn hàng này (2 dòng)
│   │   details              │ │ ← items dòng 1 (りんご 10)
│   │   details              │ │ ← items dòng 2 (みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← rows của cha, dòng 2 (đơn hàng A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← nhận items của đơn hàng này (1 dòng)
│   │   details              │ │ ← items dòng 1 (ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

Bảng dòng hàng bên trong hóa đơn, khối chi tiết lặp lại theo từng khách hàng — những "báo cáo nhỏ bên trong báo cáo" như vậy có thể được tách thành component và tái sử dụng. Tham số (chuỗi tiêu đề, v.v.) cũng có thể truyền xuống từ cha. Phần **Mẫu chạy được cho từng phần tử** ở phía sau chứa một ví dụ hoàn chỉnh, chạy ngay được của đúng cấu hình này (phần tử phía cha cộng với template phía báo cáo con).

## Sinh PDF từ file `.report` và dữ liệu JSON

File `.report` là template báo cáo: một `ReportTemplate` viết dưới dạng JSON. Vì là JSON thuần, bạn có thể theo dõi diff trong Git và sinh nó từ bất kỳ ngôn ngữ hay công cụ nào.

Cấu hình tối thiểu gồm ba file sau.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

Hai tên file font giả định hai trọng lượng Regular / Bold của một font tiếng Nhật (ví dụ Noto Sans JP). Hãy thay bằng font bạn có sẵn. Việc xử lý nhiều ngôn ngữ trong một báo cáo được trình bày ở phần **Xây dựng báo cáo đa ngôn ngữ** phía sau.

### 1. Viết template, `quotation.report`

Tọa độ, kích thước, lề và cỡ chữ đều tính bằng **pt (point, 1pt = 1/72 inch ≈ 0,353mm)**, đơn vị chuẩn của PDF. `"size": "A4"` được xem là 595 × 842pt (kích thước ISO 210×297mm quy đổi sang pt và làm tròn thành số nguyên), và lề 36pt trong ví dụ này vào khoảng 12,7mm.

Thêm một tiền đề nữa: `fontFamily` trong `styles` không phải tên file font mà là **khóa (tên logic)** bạn sẽ đăng ký sau đó trong `fontMap` và `fonts` của mã runtime. Dùng cùng tên trong template và trong mã (`jp` và `jpBold` ở ví dụ này) chính là sợi dây kết nối chúng.

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

`pattern` dùng trong các dòng chi tiết là chỉ định định dạng số/ngày tháng (`#,##0` = dấu phân cách hàng nghìn, `¥#,##0` = dấu phân cách hàng nghìn kèm ký hiệu yên; xem chi tiết ở phần "Định dạng số và ngày tháng" phía sau trong tài liệu này).

### 2. Chuẩn bị dữ liệu, `quotation.test-data.json`

Mỗi dòng trong `rows` được gắn với `field.*` trong band chi tiết, còn `parameters` được gắn với `param.*` cho toàn báo cáo.

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

Các mối gắn kết ánh xạ như sau.

| JSON | Biểu thức trong `.report` | Mục đích |
| --- | --- | --- |
| `rows[n].item` | `field.item` | Dòng chi tiết hiện tại |
| `parameters.title` | `param.title` | Đối số cho toàn báo cáo |
| Biến `grandTotal` | `vars.grandTotal` | Biến báo cáo cho tổng, đếm, v.v. |
| Ngữ cảnh trang | `PAGE_NUMBER` / `TOTAL_PAGES` | Số trang, tổng số trang |

### 3. Nạp `.report` và sinh PDF

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
  // Buffer của Node.js có thể chia sẻ vùng nhớ chung lớn hơn; hãy truyền cho Font.load
  // một ArrayBuffer được cắt đúng bằng số byte của file này
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

Cùng một bộ font được đăng ký hai lần, ở cả `fontMap` lẫn `fonts`, vì hai bên đảm nhận vai trò khác nhau: `fontMap` dùng để đo độ rộng ký tự lúc bố cục (`TextMeasurer`), còn `fonts` dùng để nhúng font lúc sinh PDF. Hãy đăng ký cùng font vào cả hai, dưới đúng tên khóa trùng với `fontFamily` của template.

`createReportFromFile()` phân giải đường dẫn tương đối của hình ảnh và báo cáo con dựa trên thư mục chứa file `.report` chính. Nếu bạn chỉ định `workingDirectory`, thư mục đó sẽ trở thành gốc thay thế. Để giới hạn những gì được phép đọc, hãy khai báo tường minh gốc cho phép trong `resources.fileRoot`; các tham chiếu tương đối thoát ra ngoài gốc, và các liên kết tượng trưng (symbolic link) trỏ ra ngoài, đều bị từ chối.

## Định nghĩa template trực tiếp bằng TypeScript

Thay vì dùng file `.report`, bạn có thể viết template như một object TypeScript. Với kiểm tra kiểu và gợi ý mã trong tầm tay, cách này hợp với việc sinh template từ mã. Nội dung vẫn là bản báo giá như trong phần hướng dẫn. Tọa độ và kích thước tính bằng pt.

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

### Tra cứu phần tử theo ID và chỉnh sửa trước khi kết xuất

Gán cho phần tử một `id` tùy ý và bạn có thể lấy nó ra bằng `findElementById()`, bất kể nó nằm sâu đến đâu trong các band hay frame. Giá trị trả về không phải bản sao mà chính là phần tử bên trong `template`, nên mọi thay đổi thực hiện trước `createReport()` đều được phản ánh vào bố cục và kết xuất.

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

`findElementById()` tìm kiếm theo chiều sâu qua các band thường, band chi tiết, header/footer của nhóm, frame, soft mask và các ô của bảng. Khi cùng một ID xuất hiện nhiều lần, hàm trả về phần tử đầu tiên theo thứ tự tìm kiếm, nên hãy giữ ID bạn định chỉnh sửa là duy nhất trong template. Các phần tử trong mảng mà `getElementChildren()` trả về cũng là tham chiếu vào template gốc.

> File font không được đóng gói kèm package. Hãy chọn font có giấy phép phù hợp với mục đích sử dụng, cách phân phối và quyền nhúng của bạn. Một style chỉ nêu được đúng một font. Để trộn ký tự của nhiều ngôn ngữ trong cùng một phần tử, bạn cần một font Pan-CJK bao phủ tất cả trong một file (font gộp chung ký tự Nhật, Trung, Hàn; ví dụ Source Han Sans, Noto Sans CJK). Để dùng font riêng cho từng ngôn ngữ, hãy tách phần tử theo ngôn ngữ và chuyển đổi style, như ở phần kế tiếp, "Xây dựng báo cáo đa ngôn ngữ."

## Xây dựng báo cáo đa ngôn ngữ

Mỗi style chỉ nêu được đúng một font, và không có cơ chế dự phòng (fallback) tự động giữa các font. Do đó, khuôn mẫu cơ bản cho báo cáo đa ngôn ngữ là **nạp font theo từng ngôn ngữ và áp style của ngôn ngữ đó cho các phần tử thuộc ngôn ngữ đó**.

Trích đoạn sau lấy từ một bản báo giá trình bày tiếng Nhật và tiếng Trung giản thể song song. Trước hết, nạp font cho từng ngôn ngữ.

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

Trong template, áp style `ja` cho câu chữ tiếng Nhật và style `zh` cho câu chữ tiếng Trung, tách phần tử theo ngôn ngữ.

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

Dữ liệu cũng mang một trường cho mỗi ngôn ngữ.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

Ngoại lệ là **một trường đơn lẻ mà ngôn ngữ chỉ được biết lúc runtime**, chẳng hạn ô ghi chú tự do. Vì trường đó không thể tách thành phần tử theo từng ngôn ngữ, câu trả lời thực dụng là gán — riêng cho style đó — một font Pan-CJK bao phủ nhiều hệ chữ trong một file (Source Han Sans, Noto Sans CJK, v.v.). Dù cách nào, `checkGlyphCoverage()` cũng phát hiện mọi lỗ hổng độ phủ font trước khi xuất.

## Chọn chế độ xuất font theo từng phần tử văn bản

Ngay trong một báo cáo, bạn có thể chỉ định chế độ xuất cho từng `staticText` hay `textField`: văn bản nhúng tìm kiếm được cho phần thân, outline cho logo, tham chiếu font hệ thống cho phần khuôn mẫu.

| Chế độ | Cách chỉ định | Trạng thái trong PDF | Phù hợp với |
| --- | --- | --- | --- |
| Nhúng subset | `pdfFontMode: 'embedded'` (mặc định) | Nhúng các glyph được dùng cùng chương trình font. Văn bản chọn và tìm kiếm được | Phân phối, lưu trữ dài hạn, in ấn, báo cáo đa ngôn ngữ |
| Chuyển thành outline | `outlineText: true` | Chuyển hình dạng glyph thành đường path vector. Không mang thông tin font | Logo, bản in mẫu chốt — văn bản cần đóng băng hình dạng chính xác |
| Tham chiếu font hệ thống | `pdfFontMode: 'reference'` | Không nhúng font; chỉ ghi tên font và các ký tự | PDF gọn nhẹ lưu hành nội bộ, nơi môi trường font được kiểm soát |

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

Nhúng subset là chế độ được khuyến nghị để giữ nguyên hình dạng glyph bất kể môi trường đích. Tham chiếu font hệ thống đòi hỏi nơi mở PDF phải có font tương thích, và hình thức hiển thị có thể khác nhau giữa các môi trường. Văn bản đã chuyển thành outline không thể chọn hay tìm kiếm như văn bản thường.

## Viết dọc

Chỉ cần chỉ định `writingMode` trên style, văn bản sẽ được sắp dọc bằng glyph dành cho viết dọc và dữ liệu kích thước riêng cho chiều dọc (số đo dọc — độ rộng tiến, v.v.). `vertical-rl` xếp dòng từ phải sang trái; `vertical-lr` xếp dòng từ trái sang phải.

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

## Xem trước đúng y báo cáo đó trên trình duyệt

`RenderDocument` bạn đã dựng cho PDF cũng có thể kết xuất thẳng lên Canvas. Xem trước và bản in dùng chung một kết quả bố cục, nên chuyện "màn hình và giấy trông khác nhau" đơn giản là không thể xảy ra. Kết hợp với bố cục cố định theo pt, đây là nền móng cho trải nghiệm xem trước và chỉnh sửa WYSIWYG (nhúng font là mặc định; chỉ chế độ tham chiếu font hệ thống mới phụ thuộc môi trường xem về hình thức hiển thị). Một lần gọi `renderPage()` vẽ trọn trang, bao gồm cả khởi tạo và dọn dẹp trang.

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
  scale: 1.5, // tỉ lệ hiển thị: 1.0 vẽ 1pt thành 1px
  devicePixelRatio: window.devicePixelRatio, // giữ chữ và nét kẻ sắc nét trên màn hình DPI cao
  fonts: { default: jpFont, jp: jpFont, jpBold: jpBoldFont },
}))
```

Nếu bạn xây dựng UI xem trước bằng React, package `tsreport-react` cũng đã sẵn sàng.

## Dùng riêng engine font

Ngay cả khi không dựng báo cáo, bạn vẫn có thể dùng riêng từng năng lực: phân tích font, shaping (chuyển một chuỗi thành dãy glyph thực sự được vẽ cùng vị trí của chúng), đo văn bản và sinh subset.

```ts
import { Font, TextMeasurer } from 'tsreport-core'

const fontBuffer = await fetch('/fonts/NotoSansJP-Regular.otf').then(response => response.arrayBuffer())
const font = Font.load(fontBuffer)
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12) // measurement.width: độ rộng chuỗi theo pt ở cỡ 12pt
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' }) // ID glyph và vị trí sau shaping
const glyph = font.getGlyph(font.getGlyphId('請'.codePointAt(0)!)) // glyph.outline: dữ liệu đường Bezier

console.log(measurement.width, shaped, glyph.outline)
```

## Chuyển PDF có sẵn thành phần tử báo cáo (nhập PDF)

`importPdfPage()` phân tích một trang của PDF có sẵn và chuyển nó thành mảng phần tử báo cáo (`ElementDef`) của tsreport-core. Đây không phải trình xem đơn thuần: văn bản vào dưới dạng `staticText`, hình ảnh dưới dạng `image`, hình vẽ dưới dạng `path` — những component bạn có thể chỉnh sửa và sắp xếp lại trực tiếp trong engine báo cáo này.

Hãy lấy file PDF của mẫu biểu bạn vẫn dùng trên giấy, hoặc PDF do hệ thống khác tạo ra, và dùng làm nền — thêm các trường trộn dữ liệu, xáo lại bố cục. Đây là cửa ngõ để **biến tài sản báo cáo sẵn có thành template**.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: mảng phần tử báo cáo (staticText / image / path, …)
// page.styles:   định nghĩa style văn bản mà các phần tử tham chiếu
// page.images:   dữ liệu hình ảnh mà các phần tử tham chiếu
// page.fonts:    thông tin về các font được tham chiếu
console.log(pageCount, page.width, page.height, page.elements.length)
```

`elements` và `styles` nhập vào có thể đặt thẳng vào các band của template. Mật khẩu cho PDF mã hóa, nhập chú thích, chuyển văn bản nhập vào thành outline, và nhiều thứ khác được điều khiển qua `PdfImportOptions`.
## Làm chủ biểu thức

Mọi thứ "động" trong báo cáo đều được viết bằng biểu thức: nội dung mà `textField` in ra, điều kiện in trong `printWhenExpression`, dữ liệu mã vạch, đường dẫn hình ảnh, dữ liệu truyền cho báo cáo con — mọi thuộc tính có kiểu `Expression` đều chấp nhận cùng một ngôn ngữ biểu thức.

Biểu thức có hai dạng.

- **Biểu thức chuỗi** — các chuỗi như `"field.price * field.quantity"`. Chúng là tập con an toàn của JavaScript, được thông dịch bởi parser chuyên dụng; `eval` và `new Function` không bao giờ được dùng. Template vẫn lưu được dưới dạng JSON (file `.report`)
- **Biểu thức callback** — hàm TypeScript dạng `(field, vars, param, report) => …`. Bạn có toàn bộ sức mạnh của ngôn ngữ, nhưng template không còn lưu được thành JSON (dạng này giả định bạn giữ template bằng TypeScript)

Chúng tôi khuyên trước hết hãy xem biểu thức chuỗi đưa bạn đi xa đến đâu, và chỉ chuyển sang callback khi chúng không đủ.

### Các giá trị tham chiếu được trong biểu thức

| Tên | Mô tả |
| --- | --- |
| `field.*` | Dòng dữ liệu hiện tại. Hỗ trợ truy cập lồng nhau như `field.customer.name` |
| `vars.*` | Biến (giá trị tính gộp định nghĩa trong `variables`, mô tả phía sau). `var.*` hoạt động tương tự |
| `param.*` | Giá trị toàn báo cáo: giá trị truyền qua `parameters` của nguồn dữ liệu và các `defaultValue` trong `parameters` của template. Trong báo cáo con, tham số truyền từ cha cũng xuất hiện ở đây |
| `PAGE_NUMBER` | Số trang hiện tại (bắt đầu từ 1) |
| `COLUMN_NUMBER` | Số cột hiện tại (bắt đầu từ 1) |
| `REPORT_COUNT` | Số dòng dữ liệu đã xử lý |
| `TOTAL_PAGES` | Tổng số trang. **Tham chiếu nguyên trạng sẽ cho "số trang tính đến hiện tại"**, nên để in tổng số trang cuối cùng, hãy kết hợp với `evaluationTime: 'report'` hoặc `'auto'` (mô tả phía sau) |

Tham chiếu một trường không tồn tại không ném lỗi; nó được đánh giá thành `undefined` (ngay cả khi phần giữa của `field.a.b` là `null`, biểu thức vẫn trả về `null` an toàn).

### Cú pháp dùng được trong biểu thức chuỗi

| Nhóm | Dùng được |
| --- | --- |
| Literal | số (`1200`, `0.5`), chuỗi (`'見積'` hoặc `"見積"`, với escape như `\n`), `true` / `false` / `null` / `undefined` |
| Template literal | `` `合計 ${vars.total} 円` `` — bên trong `${}` có thể là một biểu thức đầy đủ |
| Số học | `+` (cộng số và nối chuỗi), `-`, `*`, `/` |
| So sánh | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| Logic | `&&`, `\|\|`, `!` (đánh giá ngắn mạch, như JavaScript) |
| Hợp nhất null | `??` — trả về vế phải khi vế trái là null/undefined |
| Điều kiện (ba ngôi) | `condition ? valueIfTrue : valueIfFalse` |
| Khác | `-` / `+` một ngôi, ngoặc đơn `( )`, truy cập thành viên bằng dấu chấm (tên thuộc tính có thể là tiếng Nhật: `field.顧客名`) |
| Hàm dựng sẵn | `format(value, pattern)` = định dạng (mô tả phía sau) / `round(value, digits?)` = làm tròn nửa lên / `roundUp`, `roundDown`, `roundHalfEven` (làm tròn kiểu ngân hàng), `ceil`, `floor`, `trunc` (với mỗi hàm, đối số thứ hai là số chữ số thập phân, mặc định 0 khi bỏ trống) / `now()` = thời gian hiện tại |

**Không dùng được**: `==` / `!=` (hãy dùng `===` / `!==`), `%` và `**`, ký pháp ngoặc vuông (`field['a-b']`) và chỉ mục mảng, gọi phương thức (`field.name.toUpperCase()` thất bại lúc đánh giá — các hàm gọi được chỉ là những hàm dựng sẵn ở trên), phép gán, định nghĩa hàm, `new`, optional chaining (`?.` — dù sao cũng không cần, vì null ở giữa không bao giờ ném lỗi). Khi cần bất kỳ thứ nào trong số này, hãy dùng biểu thức callback.

Các giới hạn này tồn tại vì an toàn. Biểu thức chuỗi được thông dịch bởi parser chuyên dụng và không bao giờ chạy như mã, nên template nhận từ bên ngoài không thể tuồn mã tùy ý vào.

### In kết quả tính toán

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

Dữ liệu mẫu:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

Kết quả in ra là `¥3,960`.

### Ghép chuỗi

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

Giá trị nhúng trong `${}` của template literal được chuyển thành chuỗi rồi nối lại. **null trở thành chuỗi `"null"`**, nên hãy thêm `?? ''` vào các giá trị có thể vắng mặt, như trong ví dụ.

### Chuyển nội dung theo điều kiện

Dùng toán tử ba ngôi để chuyển đổi thứ được in.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

Khi bạn muốn thay đổi *có hiển thị hay không* thay vì *hiển thị cái gì*, hãy dùng `printWhenExpression` chung của mọi phần tử (xem "In phần tử chỉ khi thỏa điều kiện"). Để chuyển đổi kiểu dáng (màu sắc, in đậm) theo điều kiện, hãy chỉ định biểu thức điều kiện cùng dạng trong `conditionalStyles` của định nghĩa style.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### Định dạng số và ngày tháng — `format` và `pattern`

`textField` có thể định dạng kết quả biểu thức lúc in qua thuộc tính `pattern`. Để định dạng một phần giá trị bên trong biểu thức, hãy dùng hàm dựng sẵn `format(value, pattern)`.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

Mẫu định dạng số kết hợp `#` (hiện chữ số nếu có), `0` (đệm số không) và `,` (dấu phân cách hàng nghìn), và có thể mang tiền tố lẫn hậu tố. Làm tròn theo kiểu nửa lên.

| Mẫu | Đầu vào | Đầu ra |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

Các token của mẫu ngày tháng là `yyyy` (năm 4 chữ số), `MM` / `M` (tháng có đệm không / tháng), `dd` / `d` (ngày có đệm không / ngày), `HH` (giờ có đệm không, đồng hồ 24 giờ), `mm` (phút) và `ss` (giây). Giá trị null/undefined cho ra chuỗi rỗng.

Với các định dạng ngoài phạm vi này (niên hiệu Nhật, tên thứ trong tuần, xử lý chữ số tiền tệ, v.v.), hãy đăng ký các hàm TypeScript có tên trong `formatters` của template và ghi tên đó vào `pattern`.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// Phía phần tử: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern` trước tiên tìm formatter đã đăng ký mang tên đó, và được hiểu là định dạng dựng sẵn nếu không tìm thấy. Formatter là hàm, nên template dùng tính năng này được giữ bằng TypeScript thay vì JSON.

### In tổng, trung bình, số đếm — biến (`variables`)

Việc tính gộp trải qua nhiều dòng chi tiết được định nghĩa trong `variables` của template. Mỗi lần một dòng dữ liệu được xử lý, biến nạp kết quả của `expression` vào phép gộp của nó, và các biểu thức có thể tham chiếu giá trị hiện tại qua `vars.name`.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

Đặt một `textField` với `"expression": "vars.pageTotal"` vào band `pageFooter` để có tổng con theo trang, và một `textField` với `"expression": "vars.grandTotal"` vào band `summary` để có tổng cộng.

**Danh sách thuộc tính (mỗi mục của `variables`)**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `name` | string | ✓ | Tên biến, tham chiếu từ biểu thức qua `vars.name` |
| `expression` | Expression | ✓ | Được đánh giá cho từng dòng; kết quả được nạp vào phép gộp |
| `calculation` | `'sum'` = tổng / `'average'` = trung bình / `'count'` = đếm / `'distinctCount'` = đếm giá trị khác nhau / `'min'` = nhỏ nhất / `'max'` = lớn nhất / `'first'` = giá trị đầu tiên / `'nothing'` = ghi đè mỗi dòng (giá trị cuối) | ✓ | Phương pháp tính gộp |
| `resetType` | `'report'` = gộp liên tục trên toàn báo cáo (không reset; mặc định) / `'page'` = reset theo trang / `'column'` = reset theo cột / `'group'` = reset theo nhóm nêu trong `resetGroup` / `'none'` = không bao giờ reset, giống `'report'`, nhưng dưới đánh giá trễ (`evaluationTime`) giá trị được giữ cố định tại thời điểm phần tử được đặt (không bị thay bằng kết quả gộp cuối cùng về sau) |  | Phạm vi reset của phép gộp |
| `resetGroup` | string |  | Tên nhóm đích khi `resetType: 'group'` |
| `incrementCondition` | Expression |  | Khi được đặt, các dòng có kết quả đánh giá falsy sẽ không được nạp vào phép gộp (tính gộp có điều kiện) |
| `initialValue` | Expression |  | Giá trị khởi tạo lúc bắt đầu và ở mỗi lần reset |

Với `incrementCondition`, phép gộp có điều kiện kiểu "chỉ cộng một danh mục nhất định" gói gọn trong một biến duy nhất:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

Để gộp kết quả chạy báo cáo con vào phía cha, hãy dùng `returnValues` của phần tử `subreport`, cơ chế ghi ngược các biến của con vào `vars.*` của cha (xem danh sách thuộc tính của `subreport`).

### In số trang và tổng số trang

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

Mấu chốt là `evaluationTime: 'auto'`. Biểu thức bình thường được đánh giá ngay khoảnh khắc phần tử được đặt, nhưng lúc đó tổng số trang cuối cùng chưa được biết. Với `'auto'`, biểu thức được phân tích tĩnh và **mỗi tham chiếu được đánh giá tại đúng thời điểm của riêng nó** — `PAGE_NUMBER` khi trang được chốt, `TOTAL_PAGES` khi báo cáo hoàn tất. Vì `'auto'` cần phân tích biểu thức, nó chỉ dùng được cho biểu thức chuỗi (chỉ định trên biểu thức callback sẽ ném lỗi).

### Vượt ra ngoài biểu thức chuỗi — biểu thức callback

Nếu template được định nghĩa bằng TypeScript, bạn có thể viết hàm trực tiếp ở bất cứ đâu chấp nhận `Expression`. Hàm nhận bốn đối số, `(field, vars, param, report)`; qua `report` bạn với tới được các giá trị dựng sẵn như `PAGE_NUMBER`, hàm `format` và các `formatters` đã đăng ký.

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

Gọi phương thức, biểu thức chính quy, hàm bên ngoài — bất cứ thứ gì viết được bằng TypeScript đều dùng được. Có hai đánh đổi: template không còn lưu hay truyền tải được dưới dạng JSON, và `evaluationTime: 'auto'` không khả dụng (các giá trị tường minh như `'report'` vẫn hoạt động).

### Điều gì xảy ra khi biểu thức thất bại

- **Lỗi cú pháp và cấu trúc bị cấm** (gọi phương thức, v.v.) ném `ExpressionLanguageError` kèm thông tin vị trí, lan truyền nguyên trạng tới nơi gọi `createReport()`. Nó không bao giờ bị nuốt thành ô trống
- **Tham chiếu tới trường hoặc biến không tồn tại** không phải lỗi; chúng được đánh giá thành `undefined`. Trong `textField`, chuỗi rỗng được in khi đặt `blankWhenNull: true`; nếu không, chuỗi `null` được in
- Để kiểm tra biểu thức do người dùng cung cấp trước khi chạy, `validateExpressionSource(source)` trả về kết quả kiểm tra cú pháp (một lỗi, hoặc `null`)

## Mẫu chạy được cho từng phần tử

Đây là toàn bộ 16 phần tử mà `ElementDef` cung cấp. Mọi phần tử đều nhận `x`, `y`, `width`, `height` (theo pt, 1pt = 1/72 inch) và được đặt vào `elements` của một band hoặc một `frame`.

| Điều bạn muốn làm | Phần tử |
| --- | --- |
| In văn bản cố định | `staticText` |
| In dữ liệu, biến hoặc kết quả biểu thức | `textField` |
| Vẽ đường kẻ | `line` |
| Vẽ hình chữ nhật hoặc hộp bo góc | `rectangle` |
| Vẽ hình tròn hoặc elip | `ellipse` |
| Vẽ hình vector tùy ý | `path` |
| Đặt hình ảnh | `image` |
| Gom nhiều phần tử trong một khung viền | `frame` |
| In bảng | `table` |
| In bảng chéo (crosstab) | `crosstab` |
| Nhúng một báo cáo vào báo cáo khác | `subreport` |
| In mã vạch hoặc mã QR | `barcode` |
| In công thức toán học | `math` |
| In SVG | `svg` |
| Tạo biểu mẫu PDF điền được | `formField` |
| Buộc ngắt trang hoặc ngắt cột ở vị trí bất kỳ | `break` |
| In phần tử chỉ khi thỏa điều kiện | `printWhenExpression` (thuộc tính chung của mọi phần tử) |

Dưới đây, mỗi phần tử có một định nghĩa bạn có thể thả thẳng vào mảng `elements` của band, kèm dữ liệu mẫu cho các phần tử dùng biểu thức. Cuối mỗi mục là danh sách thuộc tính riêng của phần tử đó. Về các thuộc tính chung của mọi phần tử (vị trí, màu sắc, điều kiện in, v.v.) và các thuộc tính style, xem "Tham chiếu thuộc tính phần tử" phía dưới.

### In văn bản cố định — `staticText`

In một chuỗi viết sẵn trong template, đúng nguyên văn. Dùng cho tiêu đề mục và nhãn.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | Loại phần tử |
| `text` | string | ✓ | Chuỗi cố định cần in |
| `actualText` | string |  | Văn bản thay thế cho trường hợp ký tự hiển thị khác với văn bản thu được khi sao chép và tìm kiếm (PDF /ActualText). Chủ yếu dùng bởi tính năng nhập PDF để bảo toàn thiết lập của PDF gốc |
| `hyperlink` | HyperlinkDef |  | Siêu liên kết (xem **`HyperlinkDef`** ở phần thuộc tính chung) |
| `anchorName` | string |  | Tên anchor. Được đăng ký làm đích cho dấu trang và liên kết trong tài liệu (`hyperlink` loại `'localAnchor'`) |
| `bookmarkLevel` | number |  | Cấp phân cấp (1 = cấp cao nhất, 1–6) để liệt kê văn bản của phần tử này trong mục lục (dấu trang) hiển thị ở thanh bên của trình xem PDF |

Lưu ý: ngoài ra, mọi thuộc tính chung của phần tử và mọi thuộc tính `TextProperties` đều có thể chỉ định.

### In dữ liệu và kết quả biểu thức — `textField`

In kết quả đánh giá của `expression`. Nó có thể tham chiếu `field.*` (dữ liệu), `vars.*` (biến), `param.*` (tham số), `PAGE_NUMBER` và hơn thế, còn template literal cho phép ghép chuỗi. Về toàn bộ ngôn ngữ biểu thức, xem "Làm chủ biểu thức". Dùng `pattern` cho định dạng số/ngày tháng và `stretchWithOverflow` để chiều cao giãn theo lượng chữ.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

Dữ liệu mẫu:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | Loại phần tử |
| `expression` | Expression | ✓ | Biểu thức trả về giá trị cần in |
| `pattern` | string |  | Mẫu định dạng. Formatter tùy chỉnh đăng ký trên template (tên trong `formatters`) được ưu tiên; nếu không, giá trị được định dạng bằng formatter dựng sẵn |
| `blankWhenNull` | boolean |  | In chuỗi rỗng khi kết quả biểu thức là null/undefined (không đặt thì chuỗi `'null'` được in) |
| `stretchWithOverflow` | boolean |  | Khi nội dung không vừa trong height, giãn chiều cao phần tử cho vừa nội dung |
| `evaluationTime` | `'now'` = đánh giá ngay tại chỗ (mặc định) / `'band'` = đánh giá khi band được chốt / `'column'` = đánh giá lúc kết thúc cột / `'page'` = đánh giá lúc kết thúc trang / `'group'` = đánh giá khi nhóm nêu trong `evaluationGroup` đóng lại / `'report'` = đánh giá lúc kết thúc báo cáo (TOTAL_PAGES v.v. đã chốt) / `'auto'` = đánh giá từng biến và giá trị dựng sẵn mà biểu thức tham chiếu, riêng lẻ theo đúng thời điểm reset của nó (chỉ biểu thức chuỗi; biểu thức callback ném lỗi) |  | Thời điểm biểu thức được đánh giá. Với bất kỳ giá trị nào khác mặc định, vùng in được giữ chỗ trống lúc đặt và điền vào khi giá trị được chốt ở thời điểm tương ứng. Cách dùng điển hình: hiện tổng của nhóm trước phần thân nhóm (`'group'`), in tổng số trang cuối cùng (`'report'`) |
| `evaluationGroup` | string |  | Tên nhóm đích khi `evaluationTime: 'group'` |
| `textTruncate` | `'none'` = các dòng không vừa sẽ không được vẽ (mặc định; giống hệt `'truncate'` trong hiện thực hiện tại) / `'truncate'` = cắt bỏ văn bản không vừa theo từng dòng / `'ellipsisChar'` = cắt dòng cuối tại ranh giới ký tự và thêm `...` / `'ellipsisWord'` = cắt dòng cuối tại ranh giới từ và thêm `...` |  | Cách xử lý văn bản không vừa chiều cao khi `stretchWithOverflow` tắt. Mặc định: `none` |
| `hyperlink` | HyperlinkDef |  | Siêu liên kết (xem **`HyperlinkDef`** ở phần thuộc tính chung) |
| `anchorName` | string |  | Tên anchor. Được đăng ký làm đích cho dấu trang và liên kết trong tài liệu (`hyperlink` loại `'localAnchor'`) |
| `bookmarkLevel` | number |  | Cấp phân cấp (1 = cấp cao nhất, 1–6) để liệt kê văn bản của phần tử này trong mục lục (dấu trang) hiển thị ở thanh bên của trình xem PDF |

Lưu ý: ngoài ra, mọi thuộc tính chung của phần tử và mọi thuộc tính `TextProperties` đều có thể chỉ định. `isPrintRepeatedValues: false` được phần tử này tôn trọng (bỏ in các giá trị giống nhau liên tiếp).

### Vẽ đường kẻ — `line`

Ví dụ này là đường ngang với chiều cao 0. `lineStyle` chấp nhận `dashed` và các kiểu khác ngoài `solid`.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | Loại phần tử. Đoạn thẳng được vẽ từ góc trên-trái `(x, y)` của phần tử đến góc dưới-phải `(x+width, y+height)` (`height: 0` cho đường ngang, `width: 0` cho đường dọc, cả hai khác 0 cho đường chéo) |
| `lineWidth` | number |  | Độ rộng nét (pt). Mặc định: 1 |
| `lineStyle` | `'solid'` = nét liền / `'dashed'` = nét đứt / `'dotted'` = nét chấm |  | Kiểu nét. Mặc định: solid |
| `lineColor` | string |  | Màu nét. Mặc định: `forecolor` của phần tử, hoặc `#000000` nếu cũng không có |

### Vẽ hình chữ nhật hoặc hộp bo góc — `rectangle`

`cornerRadii` cho phép bo tròn từng góc riêng biệt.

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

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | Loại phần tử |
| `radius` | number |  | Bán kính bo góc (pt, chung cho mọi góc) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | Bán kính theo từng góc (pt) |
| `fill` | FillDef |  | Tô màu (xem **`FillDef`** ở phần thuộc tính chung). Mặc định: `backcolor` của style (khi nó không phải `transparent`) |
| `stroke` | string |  | Màu viền. Mặc định: `forecolor` của style |
| `strokeWidth` | number |  | Độ rộng viền (pt). Mặc định: 1 |

### Vẽ hình tròn hoặc elip — `ellipse`

Vẽ elip nội tiếp trong chiều rộng và chiều cao của phần tử.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | Loại phần tử. Vẽ elip nội tiếp trong hộp bao của phần tử (tâm `(x+width/2, y+height/2)`, bán kính `width/2` × `height/2`) |
| `fill` | FillDef |  | Tô màu (xem **`FillDef`** ở phần thuộc tính chung). Không tô khi bỏ trống |
| `stroke` | string |  | Màu viền. Không viền khi bỏ trống |
| `strokeWidth` | number |  | Độ rộng viền (pt). Mặc định: 1 (khi `stroke` được đặt) |

### Vẽ hình vector tùy ý — `path`

Đặt cú pháp path SVG vào `d` và hệ tọa độ của nó vào `viewBox`. Hình được co giãn cho vừa khung phần tử.

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

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | Loại phần tử |
| `d` | string | ✓ | Dữ liệu path SVG (M/L/C/Z, v.v.). Tọa độ là pt cục bộ của phần tử |
| `pdfSourceVector` | PdfSourceVectorDef |  | Do tính năng nhập PDF sinh ra để bảo toàn hình lặp lại nhiều lần (ký hiệu bản đồ, v.v.) dưới dạng "một định nghĩa + N lần đặt" (xem **`PdfSourceVectorDef`** phía sau). Khi được đặt, `d` không được phân tích. Không cần trong template viết tay |
| `affineTransform` | [number, number, number, number, number, number] |  | Ma trận biến đổi affine ánh xạ tọa độ path vào tọa độ cục bộ của phần tử trước khi vẽ. `[a, b, c, d, e, f]` cho `x' = a·x + c·y + e`, `y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, width, height]`. Tọa độ path được co giãn từ vùng này sang chiều rộng và chiều cao của phần tử |
| `fill` | FillDef |  | Tô màu (xem **`FillDef`** ở phần thuộc tính chung). Không tô khi bỏ trống |
| `fillRule` | `'nonzero'` (mặc định) / `'evenodd'` |  | Quy tắc quyết định vùng nào được tính là "bên trong" với path tự cắt hoặc lồng nhau. Để đục lỗ kiểu bánh donut, `'evenodd'` là lựa chọn chắc chắn |
| `fillOpacity` | number |  | Độ mờ của tô màu (0.0–1.0) |
| `stroke` | FillDef |  | Nét vẽ (màu đơn sắc lẫn gradient và hơn thế). Không vẽ nét khi bỏ trống |
| `strokeWidth` | number |  | Độ rộng nét (pt). Mặc định: 1 (khi `stroke` được đặt) |
| `strokeOpacity` | number |  | Độ mờ của nét (0.0–1.0) |
| `strokeLinecap` | `'butt'` = cắt ngay đầu mút / `'round'` = đầu tròn / `'square'` = đầu vuông (kéo dài thêm nửa độ rộng nét) |  | Hình dạng đầu mút nét |
| `strokeLinejoin` | `'miter'` = góc nhọn (miter) / `'round'` = bo tròn / `'bevel'` = vát cạnh |  | Hình dạng chỗ nối nét |
| `strokeMiterLimit` | number |  | Giới hạn miter. Mặc định: 10 |
| `strokeDasharray` | number[] |  | Mẫu nét đứt (mảng độ dài đoạn và khoảng hở, pt) |
| `strokeDashoffset` | number |  | Độ lệch bắt đầu trong mẫu nét đứt (pt) |

### Đặt hình ảnh — `image`

Chỉ định hình ảnh bằng `sourceExpression` (biểu thức) hoặc `source` (giá trị cố định). `scaleMode` điều khiển cách hình khớp vào khung, và `onError` chọn hành vi khi không tìm thấy hình (`error` = báo lỗi / `blank` = để trống / `icon` = hiện biểu tượng).

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

Dữ liệu mẫu:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | Loại phần tử |
| `source` | string | | Tham chiếu hình cố định (ID hình ảnh). Ghi nguyên trạng đường dẫn tương đối so với file `.report`, đường dẫn tuyệt đối, URL, data URI, v.v. (về quy tắc ID, xem "Hạn chế nạp tài nguyên và quy tắc ID hình ảnh" phía sau). Được dùng khi `sourceExpression` vắng mặt hoặc kết quả của nó không phân giải được |
| `sourceExpression` | Expression | | Biểu thức nguồn hình động. Kết quả chuỗi được phân giải như ID hình ảnh; kết quả `Uint8Array` được xem là chính dữ liệu hình |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | Cách co giãn hình. `'clip'` = đặt hình ở kích thước tự nhiên và cắt theo khung phần tử / `'fillFrame'` = kéo giãn lấp đầy khung, bỏ qua tỉ lệ khung hình / `'retainShape'` = giữ tỉ lệ và co giãn tới kích thước lớn nhất vừa trong khung / `'realSize'` = kích thước tự nhiên cộng cắt theo khung (hiện thực giống hệt `'clip'`). Mặc định: `'retainShape'`. Khi không xác định được kích thước hình, hành xử như `'fillFrame'` |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | Vị trí ngang của hình trong khung (ảnh hưởng cách đặt lề với `retainShape` và vị trí cắt với `clip`/`realSize`). Mặc định: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | Vị trí dọc của hình trong khung. Mặc định: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | Hành vi khi nguồn hình không xác định hoặc phân giải thất bại. `'error'` = ném ngoại lệ / `'blank'` = không vẽ gì / `'icon'` = vẽ hộp giữ chỗ màu xám với dấu ×. Mặc định: `'icon'` |
| `lazy` | boolean | | Chỉ tồn tại trong định nghĩa kiểu; engine bố cục và các renderer hiện tại không tham chiếu (không thuộc phạm vi đặc tả) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | Góc xoay hình (độ) |
| `affineTransform` | [number, number, number, number, number, number] | | Cách chỉ định vị trí trực tiếp bằng ma trận. `[a, b, c, d, e, f]` là phép biến đổi ánh xạ hình vuông đơn vị (0–1) của hình qua `x' = a·x + c·y + e`, `y' = b·x + d·y + f`; khi được đặt, phép tính vị trí từ `scaleMode`/`hAlign`/`vAlign`/`rotation` bị bỏ qua. Chủ yếu dùng bởi tính năng nhập PDF để bảo toàn vị trí gốc |
| `opacity` | number | | Độ mờ (0.0–1.0) |
| `interpolate` | boolean | | Yêu cầu trình xem làm mượt ranh giới pixel khi hình độ phân giải thấp bị phóng to (PDF /Interpolate). Bật cho ảnh chụp; tắt với hình cần giữ sắc nét như mã vạch |
| `alternates` | PdfImageAlternateDef[] |  | Hình thay thế PDF (/Alternates) để dùng hình khác nhau trên màn hình và khi in. Mỗi mục có hai thuộc tính: `source` = tham chiếu tới hình thay thế (bắt buộc) và `defaultForPrinting` = hình này có được dùng khi in hay không |
| `opi` | PdfOpiMetadataDef |  | Thông tin OPI cho in ấn thương mại, nơi hình giữ chỗ độ phân giải thấp được hoán đổi thành hình độ phân giải cao lúc xuất. Chủ yếu để bảo toàn khi nhập PDF (xem **`PdfOpiMetadataDef`** phía sau) |
| `measure` | PdfMeasurement |  | Thông tin tỉ lệ và hệ tọa độ mà công cụ đo của trình xem dùng trong PDF bản vẽ và bản đồ. Chủ yếu để bảo toàn khi nhập PDF (xem **`PdfMeasurement`** phía sau) |
| `pointData` | PdfPointData[] |  | Dữ liệu điểm (vĩ độ/kinh độ, v.v.) trong PDF bản đồ. Chủ yếu để bảo toàn khi nhập PDF (xem **`PdfPointData`** phía sau) |
| `hyperlink` | HyperlinkDef | | Siêu liên kết (`type`: `'reference'` = URL / `'localAnchor'` = anchor trong tài liệu / `'localPage'` = trang trong tài liệu / `'remoteAnchor'`, `'remotePage'` = anchor/trang trong PDF bên ngoài; `target`: biểu thức cho đích liên kết; `remoteDocument?`: biểu thức cho đường dẫn PDF bên ngoài) |

### Gom nhiều phần tử trong một khung viền — `frame`

Gom các phần tử con lại; `border` vẽ viền và `clip` cắt phần tràn ra. Tọa độ của phần tử con lấy góc trên-trái của frame làm gốc.

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

Dữ liệu mẫu:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | Loại phần tử |
| `clip` | boolean | | Có cắt phần tử con tại ranh giới frame hay không. Mặc định: true |
| `border` | BorderDef | | Viền (xem **`BorderDef`** ở phần thuộc tính chung) |
| `padding` | Padding | | Đệm trong (`top?`/`bottom?`/`left?`/`right?`, mỗi giá trị theo pt) |
| `rotation` | number | | Góc xoay frame (độ, ngược chiều kim đồng hồ trong tọa độ trang) |
| `rotationOriginX` | number | | Gốc xoay X (tương đối frame, pt). Mặc định: 0 |
| `rotationOriginY` | number | | Gốc xoay Y (tương đối frame, pt). Mặc định: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Ma trận affine ánh xạ tọa độ cục bộ của frame (trục Y hướng lên) vào không gian tọa độ cha (bố cục và ý nghĩa ma trận như `affineTransform` của `image`). Chủ yếu dùng bởi tính năng nhập PDF để bảo toàn vị trí gốc |
| `pdfForm` | PdfFormXObjectDef |  | Khi nhập PDF, giữ lại và phát lại hệ tọa độ cùng metadata mà một component (Form XObject) của PDF nguồn mang theo (xem **`PdfFormXObjectDef`** phía sau). Không cần trong template viết tay |
| `hyperlink` | HyperlinkDef | | Siêu liên kết (cấu trúc giống thuộc tính cùng tên của `image`) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | Đường cắt theo cú pháp path SVG. `d` = dữ liệu path, `fillRule` = quy tắc tô |
| `transparencyGroup` | boolean | | Giữ ranh giới nhóm trong suốt của PDF ngay cả khi cả `isolated` lẫn `knockout` đều không bật. Việc giữ này bảo đảm kết quả phối hợp của độ mờ và hòa trộn vẫn như thể frame được phối như một hình phẳng duy nhất (chủ yếu vì độ trung thực khi nhập PDF) |
| `isolated` | boolean | | Nhóm trong suốt cô lập (PDF /Group /I). Khi thuộc tính này (hoặc `knockout` / `softMask`) được đặt, frame được phối như một khối trước khi áp dụng độ mờ, hòa trộn và mặt nạ |
| `knockout` | boolean | | Nhóm trong suốt knockout (PDF /Group /K). Các phần tử con chồng lấn trong nhóm không xuyên thấu lẫn nhau; tại mỗi vị trí chỉ phần tử con trên cùng được phối với nền |
| `softMask` | FrameSoftMaskDef | | Mặt nạ mềm làm frame trong suốt một phần (xem **`FrameSoftMaskDef`** ở bảng dưới). Dùng kết quả kết xuất của `elements` bên trong nó như "bản đồ độ trong suốt", cho phép hiệu ứng như mờ dần theo gradient |
| `deviceParams` | DeviceParamsDef | | Tham số cho giai đoạn chế bản của in ấn thương mại (xem **`DeviceParamsDef`** ở bảng dưới). Không cần cho báo cáo thông thường; chủ yếu dùng bởi tính năng nhập PDF để bảo toàn thiết lập của PDF nguồn |
| `elements` | ElementDef[] | | Các phần tử con bên trong frame |

**`FrameSoftMaskDef`** (cấu trúc của `softMask`)
| Trường | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | Loại mặt nạ. `'luminosity'` = vùng mặt nạ càng sáng, frame càng đục / `'alpha'` = vùng mặt nạ càng đục, frame càng đục |
| `colorSpace` | PdfProcessColorSpaceDef | | Không gian màu hòa trộn của nhóm trong suốt mặt nạ mềm |
| `isolated` | boolean | | Cờ cô lập của nhóm trong suốt mặt nạ mềm |
| `knockout` | boolean | | Cờ knockout của nhóm trong suốt mặt nạ mềm |
| `backdrop` | [number, number, number] | | Màu nền /BC cho mặt nạ luminosity (DeviceRGB 0–1). Mặc định: đen |
| `elements` | ElementDef[] | ✓ | Các phần tử được phối thành nhóm trong suốt để định nghĩa mặt nạ |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | Hàm truyền /SMask /TR ánh xạ lại giá trị mặt nạ (0..1) |

**`DeviceParamsDef`** (cấu trúc của `deviceParams`. Dành cho chế bản in thương mại, bình thường không cần — chủ yếu để bảo toàn khi nhập PDF)
| Trường | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | Hàm truyền /TR: `'Identity'` / `'Default'` / một hàm dùng chung cho mọi bản màu / mảng hàm, mỗi hàm cho một bản của bốn màu |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | Hàm sinh đen /BG (`'Default'` = mặc định thiết bị qua /BG2) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | Hàm loại màu nền /UCR (`'Default'` = mặc định thiết bị qua /UCR2) |
| `halftone` | `'Default'` \| HalftoneDef | | Tram /HT (screen loại 1 / mảng ngưỡng loại 6, 10, 16 / tập hợp theo từng chất màu loại 5) |
| `halftoneOrigin` | [number, number] | | Gốc tram PDF 2.0 (/HTO, pixel không gian thiết bị) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | Điều khiển bù điểm đen PDF 2.0 (/UseBlackPtComp) |
| `flatness` | number | | Dung sai độ phẳng (/FL) |
| `smoothness` | number | | Dung sai độ mượt của shading (/SM) |
| `strokeAdjustment` | boolean | | Tự động hiệu chỉnh nét (/SA) |

### In bảng — `table`

Bảng với các dòng header, dòng chi tiết và dòng footer. Truyền mảng dữ liệu dòng qua `dataSourceExpression`, và các dòng chi tiết lặp lại một lần cho mỗi phần tử của mảng.

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

Dữ liệu mẫu (mỗi phần tử của `items` trở thành một dòng chi tiết của bảng):

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

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | Loại phần tử |
| `columns` | TableColumnElementDef[] | ✓ | Mảng định nghĩa cột. Nếu tổng `width` của mọi cột khác với chiều rộng phần tử, tất cả cột được co giãn theo tỉ lệ để khớp đúng chiều rộng phần tử |
| `headerRows` | TableRowElementDef[] |  | Mảng dòng header. Khi bảng tách qua nhiều trang, chúng được vẽ lại ở đầu mỗi trang |
| `detailRows` | TableRowElementDef[] |  | Mảng dòng chi tiết. Được vẽ lặp lại, một lần cho mỗi dòng dữ liệu (số dòng dữ liệu × toàn bộ dòng trong detailRows) |
| `footerRows` | TableRowElementDef[] |  | Mảng dòng footer. Khi bảng tách qua nhiều trang, chỉ vẽ ở trang cuối |
| `dataSourceExpression` | Expression |  | Dùng mảng mà biểu thức đánh giá ra làm các dòng dữ liệu của bảng này. Khi bỏ trống, dùng `rows` của nguồn dữ liệu chính. Ném ngoại lệ khi kết quả không phải mảng |

**`TableColumnElementDef`** (mỗi mục của `columns` = một định nghĩa cột)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `width` | number | ✓ | Chiều rộng cột (pt). Nếu tổng của mọi cột không khớp chiều rộng phần tử, các chiều rộng được phân bổ theo tỉ lệ |
| `style` | TableCellStyleDef |  | Style ô mặc định cho cột này. Khi một ô chỉ định thuộc tính cùng tên, thiết lập của ô thắng (viền được gộp theo từng cạnh) |

**`TableRowElementDef`** (mỗi mục của `headerRows`/`detailRows`/`footerRows` = một định nghĩa dòng)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `height` | number | ✓ | Chiều cao dòng (pt). Được xem là mức tối thiểu: dòng tự giãn khi văn bản xuống dòng hoặc phần tử con trong ô không vừa (với ô rowSpan, phần nội dung tràn làm giãn dòng cuối của vùng gộp) |
| `cells` | TableCellElementDef[] | ✓ | Mảng định nghĩa ô của dòng này. Các cột bị chiếm bởi `rowSpan` từ dòng phía trên được tự động bỏ qua khi xếp chỗ |

**`TableCellElementDef`** (mỗi mục của `cells` = một định nghĩa ô. Ngoài các mục sau, mọi thuộc tính `TableCellStyleDef` đều có thể chỉ định trực tiếp)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `text` | string |  | Văn bản ô cố định |
| `expression` | Expression |  | Biểu thức gắn dữ liệu. Dạng trần `field.name` đọc giá trị trực tiếp từ dòng dữ liệu; các dạng khác được phân giải qua bộ đánh giá biểu thức của engine. Ưu tiên hơn `text` khi được chỉ định |
| `colSpan` | number |  | Số cột gộp theo chiều ngang. Mặc định: 1 |
| `rowSpan` | number |  | Số dòng gộp theo chiều dọc. Mặc định: 1. Chiều cao ô là tổng chiều cao các dòng trong vùng gộp |
| `elements` | ElementDef[] |  | Mảng phần tử con đặt trong ô. Khi được chỉ định, nó ưu tiên hơn kết xuất `text`/`expression` và được vẽ cắt theo vùng trừ đi padding. Chiều cao dòng tự giãn theo chiều cao các phần tử con cần |

**`TableCellStyleDef`** (style ô dùng trong định nghĩa ô và `style` của cột)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `hAlign` | `'left'` = canh trái / `'center'` = canh giữa / `'right'` = canh phải |  | Canh chữ theo chiều ngang |
| `vAlign` | `'top'` = canh trên / `'middle'` = canh giữa / `'bottom'` = canh dưới |  | Canh chữ theo chiều dọc |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Xoay chữ (độ). Mặc định: 0 |
| `backcolor` | string |  | Màu nền ô |
| `forecolor` | string |  | Màu chữ. Mặc định: `#000000` |
| `fontId` | string |  | ID font. Mặc định: `'default'` |
| `fontSize` | number |  | Cỡ chữ (pt). Mặc định: 10 |
| `bold` | boolean |  | In đậm |
| `italic` | boolean |  | In nghiêng |
| `underline` | boolean |  | Gạch chân |
| `strikethrough` | boolean |  | Gạch ngang chữ |
| `lineSpacing` | LineSpacingDef |  | Thiết lập giãn dòng (xem **`LineSpacingDef`** ở phần thuộc tính chung) |
| `letterSpacing` | number |  | Giãn cách ký tự (pt). Thêm một lượng cố định giữa mọi ký tự (giá trị âm để thu hẹp) |
| `wordSpacing` | number |  | Giãn cách từ (pt; độ rộng thêm vào các ký tự khoảng trắng) |
| `firstLineIndent` | number |  | Thụt đầu dòng đầu tiên (pt) |
| `leftIndent` | number |  | Thụt lề trái (pt) |
| `rightIndent` | number |  | Thụt lề phải (pt) |
| `wrap` | boolean |  | Xuống dòng tự động. Mặc định: true |
| `shrinkToFit` | boolean |  | Tự động thu nhỏ cỡ chữ cho vừa ô |
| `minFontSize` | number |  | Cỡ chữ tối thiểu (pt) khi `shrinkToFit`. Mặc định: 4 |
| `fitWidth` | boolean |  | Tự động điều chỉnh cỡ chữ (theo cả hai chiều, thu nhỏ và phóng to) sao cho dòng dài nhất vừa khít chiều rộng ô. Ô như vậy không tham gia vào việc tự giãn chiều cao dòng |
| `outlineText` | boolean |  | Vẽ chữ đã chuyển thành outline (path) |
| `padding` | number |  | Đệm ô (pt). Mặc định: 2 |
| `border` | BorderDef |  | Viền theo từng ô (xem **`BorderDef`** ở phần thuộc tính chung). Được gộp với viền của `style` cột; thiết lập của ô thắng |
| `opacity` | number |  | Độ mờ (0.0–1.0). Dưới 1, cả ô được vẽ như một nhóm độ mờ |

### In bảng chéo — `crosstab`

Tính gộp dữ liệu theo nhóm dòng × nhóm cột. Ví dụ này cộng `amount` theo vùng × danh mục, đồng thời xuất tổng con và tổng cộng.

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

Dữ liệu mẫu:

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

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | Loại phần tử |
| `rowGroups` | { field, headerFormat? }[] | ✓ | Mảng định nghĩa nhóm dòng. Nhiều mục tạo thành các cấp nhóm lồng nhau, mỗi cấp chiếm một cột header dòng tính từ trái. Ô header của nhóm ngoài được gộp dọc theo phạm vi của nó |
| `columnGroups` | { field, headerFormat? }[] | ✓ | Mảng định nghĩa nhóm cột. Nhóm ngoài xếp phía trên và nhóm trong phía dưới; header nhóm ngoài được gộp ngang theo bề rộng các cột của nó |
| `measures` | { field, calculation, format? }[] | ✓ | Mảng định nghĩa measure (ô tính gộp). Với nhiều mục, chúng xếp chồng dọc trong mỗi ô dữ liệu, mỗi mục chiếm một khe (tối thiểu `cellHeight`) và áp dụng `calculation`/`format` riêng. Mảng rỗng được xem như một measure ngầm định duy nhất với `field: ''` và `calculation: 'sum'` |
| `rowHeaderWidth` | number |  | Chiều rộng header dòng (pt), áp cho từng cấp của nhóm dòng. Mặc định: 80 |
| `columnHeaderHeight` | number |  | Chiều cao header cột (pt), áp cho từng cấp của nhóm cột. Mặc định: 20 |
| `cellWidth` | number |  | Chiều rộng ô dữ liệu (pt). Mặc định: 60 |
| `cellHeight` | number |  | Chiều cao ô dữ liệu (pt; chiều cao khe cho một measure). Tự giãn khi chữ xuống dòng. Mặc định: 20 |
| `border` | { color?, width? } |  | Thiết lập đường kẻ (xem bảng dưới). Chỉ khi được chỉ định, khung ngoài, đường phân cách dòng/cột và đường phân cách giữa các cấp header mới được vẽ (chúng không bao giờ cắt ngang một ô header ngoài đã gộp) |
| `showSubtotals` | boolean |  | Hiện tổng con. Mặc định: false. Khi true, dòng/cột tổng con gắn nhãn "Total" được chèn vào cuối khối của mỗi nhóm, trừ cấp trong cùng. Giá trị tổng con được tính gộp lại từ giá trị thô bằng `calculation` của từng measure |
| `showGrandTotal` | boolean |  | Hiện tổng cộng. Mặc định: false. Khi true, dòng/cột tổng cộng gắn nhãn "Total" được thêm vào cuối (không phát khi số dòng dữ liệu bằng 0). Giá trị tổng cộng cũng được tính gộp lại từ giá trị thô |
| `dataSourceExpression` | Expression |  | Dùng mảng mà biểu thức đánh giá ra làm dòng dữ liệu của bảng chéo này. Khi bỏ trống (hoặc khi kết quả không phải mảng), dùng `rows` của nguồn dữ liệu chính |

**Định nghĩa nhóm dòng/cột (mỗi mục của `rowGroups`/`columnGroups`)**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `field` | string | ✓ | Tên trường để gộp nhóm. Các nhóm xuất hiện theo thứ tự lần đầu gặp trong dữ liệu |
| `headerFormat` | string |  | Định dạng hiển thị cho giá trị header. Định dạng đơn giản chỉ áp dụng khi giá trị là số (`'#,##0'` hoặc bất kỳ chuỗi chứa `,` → phân cách hàng nghìn; chỉ định thập phân như `'.00'` → số thập phân cố định ở độ chính xác đó; các trường hợp khác → chuyển thành chuỗi thuần) |

**Định nghĩa measure (mỗi mục của `measures`)**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `field` | string | ✓ | Tên trường cần gộp. Giá trị không phải số được chuyển sang số; giá trị không chuyển được tính là 0 |
| `calculation` | `'sum'` = tổng / `'count'` = đếm / `'average'` = trung bình / `'min'` = nhỏ nhất / `'max'` = lớn nhất | ✓ | Phương pháp tính gộp. Tổng con và tổng cộng cũng được tính gộp lại từ tập giá trị thô bằng cùng phương pháp, nên cả `average` và các phép tương tự đều cho kết quả đúng |
| `format` | string |  | Định dạng hiển thị cho giá trị gộp (cùng định dạng đơn giản như `headerFormat`: `'#,##0'` hoặc `,` → phân cách hàng nghìn, `'.NN'` → NN số thập phân cố định, không có → chuyển thành chuỗi thuần) |

**Thiết lập đường kẻ (`border`)**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `color` | string |  | Màu nét. Mặc định: `#000000` |
| `width` | number |  | Độ rộng nét (pt) của khung ngoài và ranh giới header/dữ liệu. Mặc định: 0.5. Đường phân cách dòng/cột bên trong được vẽ bằng nửa độ rộng này |

### Nhúng một báo cáo vào báo cáo khác — `subreport`

Ý tưởng đã được giải thích ở **Kiến thức cơ bản về bố cục báo cáo**. Đây là một định nghĩa hoàn chỉnh chạy được nguyên trạng. Báo cáo con chạy một lần cho mỗi dòng chi tiết của cha, và mảng truyền qua `dataSourceExpression` trở thành `rows` của báo cáo con.

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

Dữ liệu mẫu:

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

File `subreport.report` được nhúng tự thân là một template độc lập. Nó tham chiếu từng phần tử của mảng `items` nhận được như các giá trị `field.*` thông thường và nhận tham số truyền từ cha qua `param.*`. Lưu ý rằng template chạy dưới dạng báo cáo con không xuất các band `pageHeader`, `pageFooter`, `background` của nó (quản lý trang là việc của báo cáo cha). Tiêu đề mục đặt vào band `title`, như thế này:

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

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | Loại phần tử |
| `templateExpression` | Expression | ✓ | Biểu thức trả về tên template con. Khi dùng `createReportFromFile()`, nó được tự động phân giải như đường dẫn file; khi gọi `createReport()` trực tiếp, hãy phân giải bằng tùy chọn `resolveSubreportTemplate` (một hàm nhận tên và thư mục làm việc, trả về `{ template, workingDirectory? }`, hoặc `null` khi không phân giải được) |
| `dataSourceExpression` | Expression | | Biểu thức trả về nguồn dữ liệu của báo cáo con (mảng các object dòng). Khi bỏ trống, các dòng nguồn dữ liệu của cha được dùng nguyên trạng. Kết quả không phải mảng được xem là dữ liệu rỗng |
| `parameters` | SubreportParamDef[] |  | Tham số truyền cho báo cáo con (xem **`SubreportParamDef`** ở bảng dưới). Chúng ưu tiên hơn các mục cùng tên từ `parametersMapExpression` |
| `parametersMapExpression` | Expression | | Biểu thức trả về object được trộn vào tham số của con (các `parameters` riêng lẻ thắng) |
| `returnValues` | ReturnValueDef[] |  | Định nghĩa trả giá trị biến của báo cáo con về cha (xem **`ReturnValueDef`** ở bảng dưới) |
| `usingCache` | boolean | | Trong một lần chạy của báo cáo cha, cache và tái sử dụng template con đã phân giải theo tên template |
| `runToBottom` | boolean | | Sau nội dung báo cáo con, chiếm nốt phần không gian còn lại của trang/cột (đẩy các phần tử tiếp theo xuống dưới phần không gian còn lại) |

**`SubreportParamDef`** (mỗi mục của `parameters` = một tham số truyền cho báo cáo con)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `name` | string | ✓ | Tên tham số truyền cho báo cáo con (phía con tham chiếu qua `param.name`) |
| `expression` | Expression | ✓ | Biểu thức tính giá trị tham số. Được đánh giá trong ngữ cảnh của báo cáo cha |

**`ReturnValueDef`** (mỗi mục của `returnValues` = một định nghĩa trả giá trị từ con về cha)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `name` | string | ✓ | Tên biến nhận giá trị ở phía cha. Biến này được loại khỏi việc bị phép tính biến thông thường của cha ghi đè |
| `subreportVariable` | string | ✓ | Tên biến nguồn ở phía con. Khi báo cáo con chạy xong, giá trị của nó được truyền về cha |
| `calculation` | `'nothing'` = gán nguyên trạng giá trị của con (ghi đè mỗi lần chạy) / `'count'` = đếm / `'sum'` = tổng / `'average'` = trung bình / `'min'` = nhỏ nhất / `'max'` = lớn nhất / `'first'` = giữ giá trị đầu tiên nhận được | ✓ | Cách giá trị được gấp vào biến của cha. Mọi lựa chọn ngoài `'nothing'` đều gộp qua các lần chạy khi báo cáo con chạy nhiều lần |

### In mã vạch và mã QR — `barcode`

`barcodeType` chấp nhận Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code (`qrcode`), Data Matrix, PDF417 và hơn thế. `showText` thêm dòng chữ đọc được để đối chiếu khi quét.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

Dữ liệu mẫu:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | Loại phần tử |
| `barcodeType` | string | ✓ | Hệ mã vạch (không phân biệt hoa thường). Giá trị cho phép: `'code39'` = Code 39 / `'code128'` = Code 128 / `'ean13'`, `'ean-13'` = EAN-13 / `'ean8'`, `'ean-8'` = EAN-8 / `'qrcode'`, `'qr'` = QR Code / `'datamatrix'`, `'data-matrix'` = Data Matrix / `'pdf417'` = PDF417 / `'upca'`, `'upc-a'` = UPC-A / `'upce'`, `'upc-e'` = UPC-E / `'itf'`, `'interleaved2of5'` = ITF (Interleaved 2 of 5) / `'codabar'` = Codabar (NW-7) / `'code93'` = Code 93 / `'msi'` = MSI. Giá trị khác không được hỗ trợ và sẽ vẽ hình giữ chỗ |
| `expression` | Expression | ✓ | Biểu thức trả về dữ liệu mã vạch (kết quả đánh giá được chuyển thành chuỗi rồi mã hóa) |
| `showText` | boolean | | Hiện dòng chữ đọc được bên dưới mã vạch một chiều (vùng chữ cao 10pt, cỡ chữ 8pt; chiều cao vạch giảm đi tương ứng). Không dùng cho mã hai chiều (QR / Data Matrix / PDF417) |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | Mức sửa lỗi của QR Code — khả năng vẫn đọc được ngay cả khi một phần mã bị nhòe hay mất. Độ bền tăng dần từ `'L'` đến `'H'`, đổi lại hoa văn mịn hơn. `'Q'` hoặc `'H'` được khuyến nghị cho vật liệu in thô. Mặc định: `'M'`. Chỉ có hiệu lực với QR Code (mức sửa lỗi của PDF417 được chọn tự động theo độ dài dữ liệu) |

### In công thức toán học — `math`

Sắp chữ công thức kiểu LaTeX. Sắp chữ toán học đòi hỏi font chuyên dụng mang số đo riêng cho toán (bảng MATH của OpenType); các ví dụ miễn phí gồm STIX Two Math và Latin Modern Math. Font chữ thân bài thông thường không thay thế được. `formula` được đánh giá như biểu thức (ví dụ này tham chiếu trường `formula` của dữ liệu).

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

Dữ liệu mẫu:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

Khi dùng phần tử `math`, hãy đăng ký font có bảng MATH của OpenType vào cả `fontMap` lẫn `fonts` cho xuất PDF.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | Loại phần tử |
| `formula` | Expression | ✓ | Biểu thức trả về chuỗi công thức LaTeX (bọc công thức cố định trong `'...'` như chuỗi hằng bên trong biểu thức). Không vẽ gì khi kết quả là chuỗi rỗng |
| `mathFontFamily` | string | | Font dùng cho kết xuất toán học (ID font đã đăng ký trong fontMap). Mặc định: fontFamily của style phần tử, hoặc `'default'` nếu cũng không có |
| `fontSize` | number | | Cỡ chữ (pt). Mặc định: fontSize của style phần tử, hoặc 12 nếu cũng không có |
| `color` | string | | Màu chữ. Mặc định: phân giải theo thứ tự — forecolor của phần tử → forecolor của style → `#000000` |

### In SVG — `svg`

Kết xuất một tài liệu SVG trực tiếp vào báo cáo. `svgContent` được đánh giá như biểu thức (chuỗi SVG cố định có thể cấp qua dữ liệu hoặc tham số).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

Dữ liệu mẫu:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | Loại phần tử |
| `svgContent` | Expression | ✓ | Biểu thức trả về chuỗi markup SVG. Kết quả được chuyển thành chuỗi và kết xuất như SVG tại vị trí và kích thước của phần tử |

### Tạo biểu mẫu PDF điền được — `formField`

Đặt các trường biểu mẫu mà người mở PDF có thể điền. `fieldType` chấp nhận `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox` và `signature`.

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

Dữ liệu mẫu (trở thành giá trị ban đầu của biểu mẫu):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | Loại phần tử. Trường biểu mẫu tương tác. Backend xem trước vẽ diện mạo ban đầu của nó, và đầu ra PDF phát nó thành trường thực sự điền được |
| `fieldType` | `'text'` = ô nhập văn bản (PDF /Tx) / `'checkbox'` = ô đánh dấu (/Btn) / `'radio'` = nút chọn (/Btn; các widget cùng `fieldName` tạo thành một nhóm loại trừ lẫn nhau) / `'pushbutton'` = nút bấm (/Btn; nhãn kèm hành động URI tùy chọn) / `'dropdown'` = danh sách thả xuống (combo box, /Ch) / `'listbox'` = hộp danh sách (/Ch) / `'signature'` = trường chữ ký (/Sig) | ✓ | Loại trường |
| `fieldName` | string | ✓ | Tên trường đầy đủ. Phải duy nhất trong tài liệu (trùng sẽ ném lỗi). Ngoại lệ là `radio`, nơi việc dùng chung tên tạo thành một nhóm loại trừ lẫn nhau |
| `value` | Expression |  | Giá trị ban đầu (text: giá trị nhập; dropdown/listbox: giá trị được chọn; với listbox `multiSelect`, chỉ định nhiều giá trị ngăn cách bằng xuống dòng). Được đánh giá như biểu thức. Kết hợp với `valueStream` sẽ ném lỗi |
| `checked` | Expression |  | Trạng thái đánh dấu ban đầu (checkbox/radio). Được đánh giá như biểu thức. Với radio, `exportValue` của nút được đánh dấu trở thành giá trị được chọn của nhóm |
| `exportValue` | string |  | Chuỗi được ghi làm giá trị mang nghĩa checkbox/radio này đang "bật" khi dữ liệu biểu mẫu được gửi hoặc trích xuất (checkbox/radio). Mặc định: `'Yes'`. Trong nhóm radio, giá trị này phân biệt các lựa chọn riêng lẻ |
| `options` | FormFieldOption[] |  | Mảng lựa chọn (dropdown/listbox). Xem bảng dưới |
| `editable` | boolean |  | Cho phép nhập tự do bên cạnh các lựa chọn (biến dropdown thành kiểu combo gõ được) |
| `multiSelect` | boolean |  | Cho phép chọn nhiều (listbox) |
| `caption` | string |  | Nhãn nút (pushbutton) |
| `action` | string |  | URI được mở khi nhấn pushbutton |
| `multiline` | boolean |  | Nhập nhiều dòng (text) |
| `readOnly` | boolean |  | Đặt trường chỉ đọc |
| `required` | boolean |  | Đặt trường bắt buộc |
| `noExport` | boolean |  | Không xuất giá trị trường này khi gửi biểu mẫu |
| `password` | boolean |  | Nhập mật khẩu (text; ký tự gõ vào bị che) |
| `fileSelect` | boolean |  | Biến thành trường chọn file (text). Kết hợp với `multiline`/`password` sẽ ném lỗi |
| `doNotSpellCheck` | boolean |  | Tắt kiểm tra chính tả (text/dropdown/listbox) |
| `doNotScroll` | boolean |  | Không cho cuộn khi nhập vượt quá vùng hiển thị (text) |
| `comb` | boolean |  | Hiển thị thành các ô ký tự cách đều (comb) (text). Phải chỉ định `maxLength`; kết hợp với `multiline`/`password`/`fileSelect` sẽ ném lỗi |
| `richText` | string |  | Giá trị rich text (PDF /RV) hiển thị có định dạng (đậm, màu, v.v.) trong các trình xem hỗ trợ. Đặt nó sẽ bật cờ rich text của trường. Kết hợp với `richTextStream` sẽ ném lỗi |
| `richTextStream` | Uint8Array |  | Dạng stream của `richText`. Để bảo toàn theo từng byte khi /RV của PDF nguồn là stream trong lúc nhập PDF; template viết tay bình thường dùng `richText`. Kết hợp với `richText` sẽ ném lỗi |
| `defaultStyle` | string |  | Style mặc định cho rich text (PDF /DS). Chuỗi định dạng kiểu CSS (ví dụ `font: Helvetica 12pt`) cung cấp mặc định cho những gì `richText` không chỉ định |
| `valueStream` | Uint8Array |  | Để bảo toàn khi nhập PDF. Khi giá trị trường (/V) của PDF nguồn là object stream thay vì chuỗi, phát lại các byte đó không mất mát. Template viết tay bình thường dùng `value`. Kết hợp với `value` sẽ ném lỗi |
| `defaultValue` | string |  | Giá trị mặc định mà trường trở về khi reset biểu mẫu (/DV) |
| `sort` | boolean |  | Hiển thị các lựa chọn đã sắp xếp (dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | Chốt giá trị ngay khi lựa chọn thay đổi (dropdown/listbox) |
| `radiosInUnison` | boolean |  | Bật/tắt đồng loạt các nút radio trong nhóm có cùng `exportValue` |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | Gắn vào trường các script nhập liệu chạy trong trình xem PDF. K = mỗi lần gõ phím (ví dụ loại bỏ ký tự không phải số), F = định dạng hiển thị (ví dụ hiện hai chữ số thập phân), V = kiểm tra giá trị (ví dụ từ chối số âm), C = tính lại (ví dụ tự động tính từ giá trị các trường khác). Nội dung thường là `PdfActionDef` (mô tả phía sau) với `subtype: 'JavaScript'`. Engine lõi chỉ nhúng script vào PDF và không bao giờ thực thi chúng. Với nhóm radio, mọi widget phải mang định nghĩa giống hệt nhau, nếu không sẽ ném ngoại lệ |
| `calculationOrder` | number |  | Khi nhiều trường có hành động `'C'` (tính lại), thứ tự trình xem tính lại chúng (PDF /CO). Thứ tự tăng dần của số nguyên ≥ 0. Trùng lặp, giá trị âm và số không nguyên sẽ ném lỗi |
| `maxLength` | number |  | Độ dài nhập tối đa (text) |
| `borderColor` | string |  | Màu viền (`#RRGGBB`). Không viền khi bỏ trống. Vẽ thành đường bao 1pt — hình tròn cho radio, chữ nhật cho các loại khác |
| `backgroundColor` | string |  | Màu nền (`#RRGGBB`). Trong suốt khi bỏ trống. Tô hình tròn cho radio, chữ nhật cho các loại khác |

**`FormFieldOption`** (mỗi mục của `options` = một định nghĩa lựa chọn)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `value` | string | ✓ | Giá trị xuất được lưu vào giá trị trường (/V) |
| `label` | string |  | Nhãn hiển thị. Mặc định: giống `value` |

Lưu ý: ngoài ra, mọi thuộc tính chung của phần tử và mọi thuộc tính `TextProperties` đều có thể chỉ định (áp dụng cho font, canh lề, v.v. của văn bản nhập).

### Buộc ngắt trang hoặc ngắt cột ở vị trí bất kỳ — `break`

Buộc chuyển sang trang kế tiếp (`"breakType": "page"`) hoặc cột kế tiếp (`"column"`) giữa dòng chảy chi tiết. Đặt trực tiếp trong band; không thể nằm trong `frame`.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**Danh sách thuộc tính**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | Loại phần tử |
| `breakType` | `'page'` \| `'column'` | ✓ | Loại ngắt. Tách band tại vị trí y của phần tử; `'page'` = tiếp tục ở trang kế tiếp / `'column'` = tiếp tục ở cột kế tiếp khi bố cục nhiều cột (`columns.count` của template từ 2 trở lên; xem **Kiến thức cơ bản về bố cục báo cáo**) và đây không phải cột cuối (nếu không, nó hoạt động như ngắt trang) |

### In phần tử chỉ khi thỏa điều kiện — `printWhenExpression`

`printWhenExpression` không phải một loại phần tử riêng mà là **thuộc tính chung của mọi phần tử**. Phần tử chỉ được in trên những dòng mà biểu thức đánh giá ra truthy. Ví dụ sau chỉ in "※ 至急" (khẩn cấp) trên các dòng chi tiết có `urgent` là `true`.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

Dữ liệu mẫu (chỉ in cho dòng đầu tiên):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

Band cũng chấp nhận `printWhenExpression` cùng tên, cho phép chặn xuất cả band (ví dụ chỉ phát band ghi chú khi `param.showNotes` được đặt). Khi template được định nghĩa bằng TypeScript, callback `onBeforeRender` của phần tử cho mức kiểm soát tinh hơn nữa — trả về `null` để bỏ in phần tử, hoặc trả về một `ElementDef` để in với các thuộc tính như văn bản, kích thước, màu sắc được ghi đè ngay tại chỗ.
## Tham chiếu thuộc tính phần tử

"Danh sách thuộc tính" đính kèm mỗi ví dụ phần tử chỉ bao gồm các thuộc tính riêng của phần tử đó. Ngoài ra, mọi phần tử còn nhận các thuộc tính chung về vị trí, kích thước, điều kiện in, màu sắc và hơn thế. Phần này tổng hợp các thuộc tính chung cho mọi phần tử cùng các thuộc tính của style được định nghĩa trong `styles` của template.

### Thuộc tính chung cho mọi phần tử

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `id` | string |  | Định danh dùng để tra cứu và chỉnh sửa phần tử trước khi kết xuất bằng `findElementById()`. Không ảnh hưởng tới nội dung được in. Hãy giữ các ID dùng làm mục tiêu chỉnh sửa là duy nhất trong template (khi trùng lặp, phần tử đầu tiên theo thứ tự tìm kiếm sẽ được trả về) |
| `x` | number | ✓ | Tọa độ X trong band/container cha (pt) |
| `y` | number | ✓ | Tọa độ Y trong band/container cha (pt) |
| `width` | number | ✓ | Chiều rộng (pt) |
| `height` | number | ✓ | Chiều cao (pt) |
| `style` | string |  | Tên style được áp dụng (tham chiếu `name` của một `StyleDef` được định nghĩa trong `styles`; khi không chỉ định, style `isDefault` sẽ được áp dụng) |
| `positionType` | `'float'` = dịch xuống theo lượng giãn của các phần tử phía trên / `'fixRelativeToTop'` = cố định vị trí tính từ mép trên của band (mặc định) / `'fixRelativeToBottom'` = giữ khoảng cách tới mép dưới của band (dịch xuống theo lượng giãn của band) |  | Quy tắc định vị khi band giãn ra. Mặc định: `fixRelativeToTop` |
| `stretchType` | `'noStretch'` = không giãn (mặc định) / `'containerHeight'` = làm chiều cao phần tử khớp chiều cao hữu hiệu của band / `'containerBottom'` = giãn mép dưới phần tử tới mép dưới hữu hiệu của band (chỉ thay đổi chiều cao) |  | Quy tắc giãn của phần tử khi band giãn ra. Mặc định: `noStretch` |
| `printWhenExpression` | Expression \| null |  | Khi kết quả đánh giá là falsy, phần tử này không được in |
| `onBeforeRender` | OnBeforeRenderCallback |  | Callback được gọi ngay trước khi kết xuất: `(elem, field, vars, param, report) => ElementDef \| null`. Trả về `null` sẽ bỏ in (một tập cha của `printWhenExpression`); trả về một `ElementDef` sẽ kết xuất theo định nghĩa đó (ghi đè động bất kỳ thuộc tính nào). Thứ tự đánh giá: `onBeforeRender` → `printWhenExpression` (đánh giá trên định nghĩa đã ghi đè) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | Khi phần tử không được in, nếu không có phần tử được in nào khác chồng lên dải dọc mà phần tử chiếm giữ, sẽ loại bỏ dải đó và kéo các phần tử bên dưới lên trên, làm band co lại |
| `isPrintRepeatedValues` | boolean |  | Khi đặt là `false`, việc in bị chặn nếu giá trị (textField) giống giá trị trước đó (trong lúc bị chặn, phần tử được coi như chiều cao 0 nếu `isRemoveLineWhenBlank` là truthy) |
| `isPrintWhenDetailOverflows` | boolean |  | In lại phần tử này trên mỗi đoạn trang/cột mà band tràn sang |
| `mode` | `'opaque'` = tô nền bằng `backcolor` / `'transparent'` = không tô nền |  | Chế độ hiển thị. Mặc định: `transparent` (phân giải ưu tiên phần tử, rồi tới style) |
| `forecolor` | string |  | Màu tiền cảnh (`#RRGGBB` hoặc `#RRGGBBAA`) |
| `backcolor` | string |  | Màu nền (được vẽ khi `mode` là `opaque`) |
| `border` | BorderDef |  | Viền (xem **`BorderDef`** bên dưới). Với các phần tử line/rectangle/ellipse/path thì viền không được vẽ (bất kể nó đến từ style hay được chỉ định trực tiếp trên phần tử; các phần tử này chỉ định đường nét qua `stroke` và các thuộc tính tương tự của riêng chúng) |
| `padding` | Padding |  | Đệm (xem **`Padding`** bên dưới) |
| `blendMode` | BlendModeDef |  | Cách màu của phần tử này được hợp thành với nội dung đã vẽ bên dưới (xem **`BlendModeDef`** bên dưới). Ví dụ điển hình: chỉ định `'multiply'` trên ảnh con dấu để phủ lên bán trong suốt mà không che mất chữ bên dưới |
| `overprintFill` | boolean |  | Dành cho chế bản in thương mại. Chỉ định in đè cho phần tô (mặt chữ và hình khối): chúng được in chồng lên các bản màu bên dưới mà không đục bỏ chúng |
| `overprintStroke` | boolean |  | Dành cho chế bản in thương mại. Thiết lập in đè cho đường nét (stroke) |
| `overprintMode` | 0 \| 1 |  | Chọn hành vi khi `overprintFill`/`overprintStroke` được bật (PDF /OPM). `0` = mọi thành phần màu ghi đè màu bên dưới (mặc định) / `1` = các thành phần màu có giá trị 0 giữ nguyên màu bên dưới |
| `renderingIntent` | `'AbsoluteColorimetric'` = trung thực về trắc quang / `'RelativeColorimetric'` = trung thực sau khi khớp điểm trắng / `'Saturation'` = ưu tiên độ rực rỡ / `'Perceptual'` = ưu tiên vẻ ngoài tự nhiên |  | Chính sách ưu tiên khi chuyển đổi các màu không nằm trong gam màu của thiết bị xuất (rendering intent của PDF). Dành cho in thương mại và quản lý màu; bình thường không cần chỉ định |
| `alphaIsShape` | boolean |  | Kiểm soát tinh vi việc hợp thành trong suốt của PDF (diễn giải độ mờ đục và mặt nạ như "shape"; /AIS). Bình thường không cần chỉ định; chủ yếu dùng để tái xuất trung thực các PDF đã nhập |
| `textKnockout` | boolean |  | Khi các ký tự bán trong suốt chồng nhau, tránh hợp thành hai lần tại phần chồng lấn trong cùng một khối văn bản (PDF /TK). Mặc định: `true`. Bình thường không cần chỉ định |
| `optionalContent` | OptionalContentDef |  | Đặt phần tử này lên một "lớp" của PDF. Có thể bật/tắt hiển thị và in từ bảng lớp của trình xem (ví dụ hiện hình mờ trên màn hình nhưng bỏ đi khi in). Xem **`OptionalContentDef`** bên dưới |
| `opacity` | number |  | Độ mờ đục của phần tử (0.0–1.0). Với các phần tử có con, được áp dụng sau khi hợp thành chúng thành một nhóm |

**`BlendModeDef`** (các chế độ hòa trộn có thể chỉ định cho `blendMode`)

Phần tử bình thường phủ đè lên bất cứ thứ gì đã vẽ bên dưới (`'normal'`). Chỉ định một chế độ hòa trộn sẽ kết hợp màu trên và màu dưới bằng phép tính. Trong báo cáo nghiệp vụ, các cách dùng điển hình là phủ con dấu cá nhân hoặc công ty lên trên văn bản (`'multiply'`) và tạo hiệu ứng giống chữ trắng đục trên nền tối (`'screen'`).

| Hằng | Hiệu ứng |
| --- | --- |
| `'normal'` | Tô bằng màu trên mà không hòa trộn (tương đương mặc định) |
| `'multiply'` | Nhân. Phần chồng lấn luôn tối đi. Dành cho con dấu, dấu mộc và các lớp phủ kiểu bút dạ quang |
| `'screen'` | Nhân nghịch đảo. Phần chồng lấn luôn sáng lên |
| `'overlay'` | Nhân ở chỗ nền tối, nhân nghịch đảo ở chỗ nền sáng. Nhấn mạnh độ tương phản |
| `'darken'` | Lấy màu tối hơn trong hai màu |
| `'lighten'` | Lấy màu sáng hơn trong hai màu |
| `'color-dodge'` | Làm sáng (cháy sáng) nền theo màu trên |
| `'color-burn'` | Làm cháy tối nền theo màu trên |
| `'hard-light'` | Chuyển giữa nhân và nhân nghịch đảo dựa trên độ sáng của màu trên (hiệu ứng chiếu sáng mạnh) |
| `'soft-light'` | Phiên bản yếu hơn của `'hard-light'` (hiệu ứng chiếu sáng dịu) |
| `'difference'` | Giá trị tuyệt đối của hiệu giữa hai màu |
| `'exclusion'` | Phiên bản tương phản thấp hơn của `'difference'` |
| `'hue'` | Sắc độ của trên + độ bão hòa và độ chói của dưới |
| `'saturation'` | Độ bão hòa của trên + sắc độ và độ chói của dưới |
| `'color'` | Sắc độ và độ bão hòa của trên + độ chói của dưới (để nhuộm màu một nền đơn sắc) |
| `'luminosity'` | Độ chói của trên + sắc độ và độ bão hòa của dưới |

**`Expression`** (xem "Làm chủ biểu thức" để biết chi tiết)
| Dạng | Mô tả |
| --- | --- |
| string | Ngôn ngữ nhỏ cho biểu thức. Ví dụ: `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | Một hàm TypeScript `(field, vars, param, report) => unknown`. `report` (ReportContext) cung cấp `PAGE_NUMBER` (số trang hiện tại, bắt đầu từ 1), `COLUMN_NUMBER` (số cột hiện tại, bắt đầu từ 1), `REPORT_COUNT` (số bản ghi đã xử lý), `TOTAL_PAGES` (tổng số trang; được chốt với evaluationTime=report), `RETURN_VALUE` (có trong định nghĩa kiểu nhưng luôn undefined trong hiện thực hiện tại — giá trị trả về của subreport được nhận qua `vars.*`), `format` (các hàm định dạng dựng sẵn), và `formatters` (các bộ định dạng tùy chỉnh đăng ký trên template) |

**`BorderDef`**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `width` | number |  | Độ rộng nét (pt). Mặc định dùng chung cho mọi cạnh |
| `color` | string |  | Màu nét. Mặc định dùng chung cho mọi cạnh |
| `style` | `'solid'` = nét liền / `'dashed'` = nét đứt / `'dotted'` = nét chấm |  | Kiểu nét. Mặc định dùng chung cho mọi cạnh |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | Thiết lập theo từng cạnh (xem **`BorderSideDef`** bên dưới). Chúng thắng thiết lập chung cho mọi cạnh; `null` sẽ ẩn cạnh đó |

**`BorderSideDef`** (dùng trong `top`/`bottom`/`left`/`right` của `BorderDef`)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `width` | number | ✓ | Độ rộng nét (pt) |
| `color` | string | ✓ | Màu nét |
| `style` | `'solid'` = nét liền / `'dashed'` = nét đứt / `'dotted'` = nét chấm | ✓ | Kiểu nét |

**`Padding`**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | Đệm ở mỗi cạnh (pt) |

**`HyperlinkDef`**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'reference'` = URL bên ngoài / `'localAnchor'` = tới một neo trong cùng tài liệu / `'localPage'` = tới một số trang trong cùng tài liệu / `'remoteAnchor'` = tới một neo trong tài liệu PDF khác / `'remotePage'` = tới một trang trong tài liệu PDF khác | ✓ | Loại liên kết |
| `target` | Expression | ✓ | Đích liên kết (một URL, một tên neo, hoặc một biểu thức số trang) |
| `remoteDocument` | Expression |  | Đường dẫn tệp PDF từ xa (cho remotePage / remoteAnchor) |

**`TextProperties`** (thuộc tính văn bản và đoạn văn của staticText / textField / formField)
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `markup` | `'none'` = văn bản thuần / `'styled'` = markup có style (`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>`, v.v.) / `'html'` = tập con HTML (`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | Loại markup |
| `hAlign` | `'left'` = canh trái / `'center'` = canh giữa / `'right'` = canh phải / `'justify'` = canh đều |  | Canh lề ngang |
| `vAlign` | `'top'` = canh trên / `'middle'` = canh giữa / `'bottom'` = canh dưới |  | Canh lề dọc |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Xoay văn bản (độ) |
| `lineSpacing` | LineSpacingDef |  | Thiết lập khoảng cách dòng (xem **`LineSpacingDef`** bên dưới) |
| `letterSpacing` | number |  | Khoảng cách chữ (pt). Thêm một lượng cố định giữa mọi ký tự (giá trị âm sẽ siết lại) |
| `tracking` | number |  | Một dạng điều chỉnh khoảng cách chữ khác. Trong khi `letterSpacing` thêm một lượng cố định đồng đều, cách này dùng bảng điều chỉnh khoảng cách được dựng sẵn trong chính font (bảng AAT `trak`) để siết hoặc nới khoảng cách theo các giá trị thiết kế phụ thuộc cỡ chữ. Con số là "track value" của bảng: 0 = bình thường, âm = siết hơn, dương = nới rộng (các giá trị trung gian được nội suy). Không có tác dụng với font không có bảng `trak` |
| `wordSpacing` | number |  | Khoảng cách từ (pt; chiều rộng thêm vào cho ký tự khoảng trắng) |
| `horizontalScale` | number |  | Hệ số tỉ lệ kéo giãn hình dạng glyph theo chiều ngang (dưới 1 = nén lại, thu hẹp chiều rộng; trên 1 = giãn ra, nới rộng). Việc ngắt dòng và bước tiến dòng được tính từ các chiều rộng đã co giãn. Mặc định: 1 |
| `baselineOffset` | number |  | Đặt tường minh vị trí đường cơ sở (đường tham chiếu mà các ký tự đứng lên) theo pt tính từ mép trên phần tử. Bình thường được tính tự động nên không cần chỉ định (chủ yếu do quá trình nhập PDF đặt để tái hiện vị trí văn bản gốc) |
| `firstLineIndent` | number |  | Thụt lề dòng đầu (pt) |
| `leftIndent` | number |  | Thụt lề trái (pt) |
| `rightIndent` | number |  | Thụt lề phải (pt) |
| `padding` | Padding |  | Đệm |
| `direction` | `'ltr'` = trái sang phải / `'rtl'` = phải sang trái / `'auto'` = tự phát hiện từ nội dung (phân tích văn bản hai chiều) |  | Hướng văn bản |
| `openTypeScript` | string |  | Thẻ OpenType chỉ định quy tắc của hệ chữ viết nào trong font được dùng khi chuyển văn bản thành hình dạng glyph (shaping) (ví dụ `'latn'` = chữ Latinh, `'arab'` = chữ Ả Rập). Bình thường không cần chỉ định (được xử lý tự động từ nội dung văn bản) |
| `openTypeLanguage` | string |  | Thẻ OpenType làm rõ ngôn ngữ cho các font thay đổi hình dạng glyph theo ngôn ngữ trong cùng một hệ chữ viết. Bình thường không cần chỉ định |
| `openTypeFeatures` | Record<string, number> |  | Bật hoặc tắt các tính năng chuyển đổi glyph dựng sẵn của font. Ví dụ: `{ "palt": 1 }` = siết khoảng cách chữ tiếng Nhật, `{ "liga": 0 }` = tắt hợp tự, `{ "zero": 1 }` = số 0 có gạch chéo. Giá trị: 0 = tắt / 1 = bật; với các tính năng chọn glyph, là số thứ tự glyph thay thế bắt đầu từ 1 |
| `shrinkToFit` | boolean |  | Tự thu nhỏ: giảm cỡ chữ để văn bản vừa trong chiều rộng và chiều cao của phần tử |
| `minFontSize` | number |  | Cỡ chữ tối thiểu (pt) cho `shrinkToFit`. Mặc định: 4 |
| `fitWidth` | boolean |  | Tự động điều chỉnh cỡ chữ sao cho dòng dài nhất vừa khít chiều rộng nội dung của phần tử (theo cả hai hướng, thu nhỏ và phóng to) |
| `outlineText` | boolean |  | Chuyển văn bản thành đường nét (path). Mặc định: `false` |
| `pdfFontMode` | `'embedded'` = nhúng chương trình font / `'reference'` = xuất tham chiếu font hệ thống mà không nhúng |  | Cách xử lý chương trình font trong PDF |
| `textPaintMode` | `'fill'` = tô / `'stroke'` = chỉ đường viền / `'fillStroke'` = tô + đường viền |  | Ngữ nghĩa tô vẽ văn bản được bảo toàn qua quá trình nhập PDF. Mặc định: `fill` |
| `textStrokeColor` | string |  | Màu nét cho stroke / fillStroke |
| `textStrokeWidth` | number |  | Độ rộng nét viền của văn bản (pt) |
| `tabStops` | TabStopDef[] |  | Định nghĩa các điểm dừng tab (xem **`TabStopDef`** bên dưới) |
| `tabStopWidth` | number |  | Khoảng cách tab mặc định (pt). 40pt khi không chỉ định |
| `wrap` | boolean |  | Ngắt dòng văn bản. Mặc định: `true` (undefined nghĩa là ngắt dòng được bật) |

**`LineSpacingDef`**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'single'` = một dòng / `'1.5'` = 1,5 dòng / `'double'` = gấp đôi / `'proportional'` = theo tỉ lệ / `'fixed'` = giá trị cố định / `'minimum'` = giá trị tối thiểu | ✓ | Loại khoảng cách dòng |
| `value` | number |  | Giá trị cho fixed / minimum / proportional |

**`TabStopDef`**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `position` | number | ✓ | Vị trí tab (pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | Canh lề tab. Mặc định: `left` |

**`FillDef`** (hợp của các kiểu được chấp nhận bởi phần tô (`fill`) và nét (`stroke`) của `path` cùng phần tô (`fill`) của `rectangle`/`ellipse`. `stroke` của `rectangle`/`ellipse` chỉ nhận chuỗi màu đơn sắc)
| Dạng | Mô tả |
| --- | --- |
| string | Màu đơn sắc (`#RRGGBB` hoặc `#RRGGBBAA`) |
| PdfSpecialColorDef | Màu pha (Separation/DeviceN). Chỉ định màu cho các loại mực đặc biệt như vàng kim, bạc, hoặc màu thương hiệu (xem bảng bên dưới) |
| LinearGradientDef | Gradient tuyến tính — màu biến đổi dọc theo trục nối hai điểm (xem bảng bên dưới) |
| RadialGradientDef | Gradient tỏa tròn — màu biến đổi từ tâm ra ngoài (xem bảng bên dưới) |
| MeshGradientDef | Gradient lưới — màu biến đổi dọc theo các hình dạng tự do (xem bảng bên dưới) |
| TilingPatternDef | Hoa văn lát — tô bằng cách lát một họa tiết nhỏ (xem bảng bên dưới) |
| FunctionShadingDef | Tô theo hàm — màu được tính từ tọa độ bằng một công thức (xem bảng bên dưới) |

**`GradientStopDef`** (các mốc màu của gradient; dùng trong `stops` của mỗi gradient)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `offset` | number | ✓ | Vị trí dọc theo trục gradient, theo tỉ lệ từ 0 đến 1 (0 = điểm đầu, 1 = điểm cuối) |
| `color` | string | ✓ | Màu tại vị trí này (`#RRGGBB`) |
| `opacity` | number |  | Độ mờ đục tại vị trí này (0–1). Mặc định: 1 |

**`LinearGradientDef`** (gradient tuyến tính — phần tô có màu biến đổi dọc theo trục nối hai điểm)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | Bộ phân biệt chỉ ra gradient tuyến tính |
| `x1` | number |  | Tọa độ X của điểm đầu, **theo tỉ lệ so với chiều rộng khung bao của phần tử** (0 = mép trái, 1 = mép phải). Mặc định: 0 |
| `y1` | number |  | Tọa độ Y của điểm đầu, **theo tỉ lệ so với chiều cao khung bao của phần tử** (0 = mép trên, 1 = mép dưới). Mặc định: 0 |
| `x2` | number |  | Tọa độ X của điểm cuối (tỉ lệ so với chiều rộng). Mặc định: 1 (giữ nguyên mặc định sẽ cho gradient ngang từ trái sang phải) |
| `y2` | number |  | Tọa độ Y của điểm cuối (tỉ lệ so với chiều cao). Mặc định: 0 |
| `stops` | GradientStopDef[] | ✓ | Mảng các mốc màu (xem bảng phía trên) |
| `spreadMethod` | `'pad'` = tô bằng màu ở hai đầu / `'reflect'` = lặp lại theo kiểu phản chiếu / `'repeat'` = lặp lại nguyên trạng |  | Cách tô bên ngoài phạm vi gradient. Mặc định: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Siêu dữ liệu bảo toàn để tái xuất không mất mát gradient của PDF đã nhập. Không cần chỉ định trong template viết tay |

**`RadialGradientDef`** (gradient tỏa tròn — phần tô có màu biến đổi từ tâm ra ngoài)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | Bộ phân biệt chỉ ra gradient tỏa tròn |
| `cx` | number |  | Tọa độ X của tâm đường tròn ngoài (tỉ lệ so với chiều rộng khung bao của phần tử). Mặc định: 0.5 |
| `cy` | number |  | Tọa độ Y của tâm đường tròn ngoài (tỉ lệ so với chiều cao). Mặc định: 0.5 |
| `r` | number |  | Bán kính đường tròn ngoài, **theo tỉ lệ so với giá trị lớn hơn giữa chiều rộng và chiều cao**. Mặc định: 0.5 |
| `fx` | number |  | Tọa độ X của tiêu điểm (nơi gradient bắt đầu) (tỉ lệ so với chiều rộng). Mặc định: `cx` |
| `fy` | number |  | Tọa độ Y của tiêu điểm (tỉ lệ so với chiều cao). Mặc định: `cy` |
| `fr` | number |  | Bán kính đường tròn tiêu điểm (tỉ lệ so với giá trị lớn hơn giữa chiều rộng và chiều cao). Mặc định: 0 |
| `stops` | GradientStopDef[] | ✓ | Mảng các mốc màu |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | Cách tô bên ngoài phạm vi (giống `LinearGradientDef`). Mặc định: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | Siêu dữ liệu để tái xuất không mất mát khi nhập PDF. Không cần chỉ định trong template viết tay |

**`MeshGradientDef`** (gradient lưới — phần tô gán màu cho các đỉnh của lưới ô hoặc tam giác và biến đổi màu dọc theo các hình dạng tự do)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | Bộ phân biệt chỉ ra gradient lưới |
| `patches` | MeshPatchDef[] |  | Mảng các mảnh mặt. Mỗi mảnh có `points` (lưới điểm điều khiển 4×4 biểu diễn bằng 32 số theo thứ tự x,y; **tọa độ theo pt cục bộ của phần tử**) và `colors` (màu của 4 góc) |
| `triangles` | MeshTriangleDef[] |  | Mảng các tam giác gradient. Mỗi tam giác có `points` (x0,y0,x1,y1,x2,y2; pt cục bộ của phần tử) và `colors` (màu của 3 đỉnh); màu được nội suy giữa các đỉnh |
| `lattice` | MeshLatticeDef |  | Lưới dạng ô. Có `columns` (số đỉnh trên mỗi hàng, từ 2 trở lên), `points` (dãy tọa độ đỉnh; pt cục bộ của phần tử), và `colors` (một màu cho mỗi đỉnh, cùng thứ tự với `points`) |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | Biểu diễn gọn của dữ liệu lưới nguyên bản nhập từ PDF. Không cần chỉ định trong template viết tay |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | Như trên, dành cho tam giác gradient |
| `pdfShading` | PdfMeshShadingDef |  | Siêu dữ liệu để tái xuất không mất mát khi nhập PDF. Không cần chỉ định trong template viết tay |

**`TilingPatternDef`** (hoa văn lát — tô bằng cách lát một họa tiết nhỏ; dùng cho gạch chéo, ô cờ, logo lặp lại và tương tự)

"Không gian hoa văn" trong bảng là hệ tọa độ riêng của hoa văn. Nếu không chỉ định `matrix`, nó trùng với hệ tọa độ pt cục bộ của phần tử.

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | Bộ phân biệt chỉ ra hoa văn lát |
| `bbox` | [number, number, number, number] | ✓ | Khung bao của một họa tiết (ô hoa văn), theo tọa độ không gian hoa văn |
| `xStep` | number | ✓ | Khoảng lặp ngang của ô (không gian hoa văn) |
| `yStep` | number | ✓ | Khoảng lặp dọc của ô (không gian hoa văn) |
| `graphics` | TileGraphicDef[] | ✓ | Mảng các đồ họa được vẽ bên trong ô, phân biệt bằng `kind`: `'path'` (dữ liệu path SVG + fill/stroke) / `'image'` (tham chiếu ID tài nguyên ảnh qua `source`) / `'text'` (văn bản kèm font, cỡ và màu) / `'group'` (nhóm lồng nhau có transform, clip, opacity, v.v.). Mọi tọa độ đều theo không gian hoa văn |
| `tilingType` | 1 = khoảng cách không đổi (ô có thể bị méo nhẹ cho hợp thiết bị xuất) \| 2 = không méo (khoảng cách có thể thay đổi nhẹ) \| 3 = khoảng cách không đổi kèm lát nhanh |  | Chế độ độ chính xác khi lát. Mặc định: 1 |
| `paintType` | `'colored'` = hoa văn tự mang màu của nó / `'uncolored'` = được nhuộm thành một màu duy nhất bằng `color` của bên sử dụng |  | Cách mang màu. Mặc định: `'colored'` |
| `color` | string |  | Màu nhuộm khi dùng hoa văn `'uncolored'` |
| `matrix` | [number, number, number, number, number, number] |  | Ma trận biến đổi affine từ không gian hoa văn sang không gian cục bộ của phần tử. Mặc định: ma trận đơn vị |

**`FunctionShadingDef`** (tô theo hàm — phần tô có màu được tính bằng công thức từ tọa độ (x, y); chủ yếu xuất hiện khi nhập PDF)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | Bộ phân biệt chỉ ra tô theo hàm. Có hai biến thể: dạng công thức với `expression` và dạng lấy mẫu với `sampled` |
| `domain` | [number, number, number, number] | ✓ | Miền đầu vào `[x0, x1, y0, y1]` |
| `expression` | string | ✓ (chỉ dạng công thức) | Biểu thức máy tính PostScript (PDF FunctionType 4). Nhận x, y và trả về r, g, b. Ví dụ: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓ (chỉ dạng lấy mẫu) | Dữ liệu hàm lấy mẫu (PDF FunctionType 0). Có `size` (kích thước lưới mẫu), `bitsPerSample` (1/2/4/8/12/16/24/32), `range` (phạm vi đầu ra), `samples` (giá trị mẫu tại mỗi điểm lưới), và tùy chọn `encode`/`decode` |
| `matrix` | [number, number, number, number, number, number] |  | Ma trận ánh xạ từ miền đầu vào sang **pt cục bộ của phần tử**. Mặc định: ma trận đơn vị |
| `background` | [number, number, number] |  | Màu nền bên ngoài miền (thành phần DeviceRGB, 0–1) |
| `bbox` | [number, number, number, number] |  | Khung bao giới hạn vùng tô |
| `antiAlias` | boolean |  | Gợi ý khử răng cưa |
| `paintOperator` | `'pattern'` = được tô như một hoa văn (mặc định) / `'sh'` = vẽ trực tiếp dưới vùng cắt hiện tại |  | Phương pháp tô khi xuất PDF |

**`PdfSpecialColorDef`** (tô bằng màu pha — chỉ định màu để in bằng các loại mực đặc biệt, như vàng kim, bạc hay màu thương hiệu, mà việc pha CMYK thông thường không tái hiện được)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | Bộ phân biệt chỉ ra phần tô bằng màu pha |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | Không gian màu của màu pha. Một loại mực đơn lẻ dùng `kind: 'separation'` với `name` (tên mực), `alternate` (không gian màu quy trình được dùng thay thế trong môi trường không có mực pha; xem bảng bên dưới), và `tintTransform` (chỉ định phép chuyển từ sắc độ sang màu thay thế dưới dạng một hàm PDF, ví dụ `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }` = trắng ở sắc độ 0 và xanh lam ở 1). Nhiều loại mực dùng `kind: 'deviceN'` với `names` (mảng tên mực), `alternate`, `tintTransform`, `subtype` (`'DeviceN'` = chuẩn / `'NChannel'` = dạng mở rộng có thể mang thông tin thuộc tính theo từng mực), `colorants` (ánh xạ từ mỗi tên mực tới định nghĩa mực đơn), `process`, và `mixingHints` |
| `components` | number[] | ✓ | Giá trị sắc độ của mỗi loại mực (0–1) |
| `displayColor` | string | ✓ | Màu được dùng thay thế khi hiển thị trên màn hình và xem trước, những nơi không có mực pha |

**`PdfProcessColorSpaceDef`** (không gian màu quy trình — không gian màu của "các màu thông thường" được biểu diễn bằng cách pha các loại mực tiêu chuẩn như CMYK. Dùng trong `alternate` của màu pha và `colorSpace` của mặt nạ mềm, phân biệt bằng `kind`)

| Biến thể (`kind`) | Thuộc tính bổ sung | Mô tả |
| --- | --- | --- |
| `'gray'` | Không có | Thang xám (DeviceGray) |
| `'rgb'` | Không có | RGB (DeviceRGB) |
| `'cmyk'` | Không có | CMYK (DeviceCMYK) |
| `'calgray'` | `whitePoint`, `blackPoint`, `gamma` (đều bắt buộc) | Xám đã hiệu chuẩn trắc quang (CalGray) |
| `'calrgb'` | `whitePoint`, `blackPoint`, `gamma` (theo từng thành phần), `matrix` (3×3) (đều bắt buộc) | RGB đã hiệu chuẩn trắc quang (CalRGB) |
| `'lab'` | `whitePoint`, `blackPoint`, `range` (đều bắt buộc) | Không gian màu L\*a\*b\* |
| `'icc'` | `components` (1\|3\|4), `range`, `profile` (byte của hồ sơ ICC) (đều bắt buộc) | Không gian màu dựa trên một hồ sơ ICC |

`whitePoint`/`blackPoint` được chỉ định dưới dạng mảng `[x, y, z]` trong không gian màu CIE XYZ.

### Thuộc tính của band (`bands`) và nhóm (`groups`)

Mười loại band được chỉ định trong `bands` của template (xem "Một trang là một chồng các "band"") đều được định nghĩa bằng `BandDef` sau đây (chỉ riêng `details` là một mảng `BandDef`).

**`BandDef`**

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `height` | number | ✓ | Chiều cao tối thiểu của band (pt). Tăng lên khi các phần tử giãn ra |
| `elements` | ElementDef[] |  | Các phần tử đặt trên band |
| `startNewPage` | boolean |  | Luôn bắt đầu band này ở một trang mới |
| `spacingBefore` | number |  | Khoảng trống trước band (pt) |
| `spacingAfter` | number |  | Khoảng trống sau band (pt) |
| `splitType` | `'stretch'` = in phần vừa với trang và tiếp tục phần còn lại ở trang kế tiếp (mặc định) / `'prevent'` = không tách; đẩy cả band sang trang kế tiếp (vẫn bị tách nếu cũng không vừa với trang mới) / `'immediate'` = tách ngay tại vị trí hiện tại, kể cả ở giữa một phần tử |  | Cách band được tách khi không vừa tại ranh giới trang |
| `printWhenExpression` | Expression \| null |  | Khi kết quả đánh giá là falsy, band này không được xuất |

**`GroupDef`** (mỗi mục của `groups`)

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `name` | string | ✓ | Tên nhóm. Được tham chiếu từ `resetGroup` của biến và `evaluationGroup` của textField |
| `expression` | Expression | ✓ | Khóa nhóm. Được đánh giá cho mỗi dòng; bất cứ chỗ nào giá trị thay đổi, nhóm trước đó sẽ đóng lại và một nhóm mới bắt đầu |
| `header` | BandDef |  | Band được xuất ở đầu nhóm |
| `footer` | BandDef |  | Band được xuất ở cuối nhóm |
| `keepTogether` | boolean |  | Khi cả nhóm không vừa với khoảng trống còn lại nhưng sẽ vừa với một trang mới, sẽ bắt đầu nhóm sau một lần ngắt trang |
| `minHeightToStartNewPage` | number |  | Bắt đầu nhóm ở trang mới khi chiều cao còn lại của trang nhỏ hơn giá trị này (pt) |
| `reprintHeaderOnEachPage` | boolean |  | Khi nhóm trải dài nhiều trang, in lại phần đầu nhóm trên mỗi trang tiếp nối |
| `resetPageNumber` | boolean |  | Đặt lại `PAGE_NUMBER` về 1 khi nhóm bắt đầu |
| `startNewPage` | boolean |  | Bắt đầu mỗi nhóm ở một trang mới |
| `startNewColumn` | boolean |  | Bắt đầu mỗi nhóm ở một cột mới |
| `footerPosition` | `'normal'` = xuất ngay sau các dòng chi tiết (mặc định) / `'stackAtBottom'` = xếp chồng về phía đáy trang / `'forceAtBottom'` = luôn đặt ở tận đáy trang, chiếm hết khoảng trống ở giữa / `'collateAtBottom'` = chỉ xếp thẳng hàng ở đáy khi phần chân của một nhóm khác cũng canh đáy (tự thân thì giống `'normal'`) |  | Vị trí dọc của phần chân nhóm |

### Thuộc tính dùng được trong style (`styles`)

Style được định nghĩa trong mảng `styles` của template và được tham chiếu bằng `name` từ thuộc tính `style` của phần tử. Font, canh lề văn bản, màu sắc và các thiết lập liên quan tới văn bản khác chủ yếu được đặt qua style.

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `name` | string | ✓ | Tên style (được tham chiếu từ `style` của các phần tử) |
| `parentStyle` | string |  | Tên style cha. Kế thừa các thuộc tính của cha và ghi đè bằng thiết lập của chính nó (tham chiếu vòng bị bỏ qua) |
| `isDefault` | boolean |  | Style có giá trị `true` được áp dụng làm mặc định cho các phần tử không có `style` |
| `fontFamily` | string |  | Họ font. Mặc định: `'default'` |
| `fontSize` | number |  | Cỡ chữ (pt). Mặc định: 10 |
| `bold` | boolean |  | Đậm. Mặc định: `false` |
| `italic` | boolean |  | Nghiêng. Mặc định: `false` |
| `underline` | boolean |  | Gạch chân. Mặc định: `false` |
| `strikethrough` | boolean |  | Gạch ngang. Mặc định: `false` |
| `forecolor` | string |  | Màu tiền cảnh (`#RRGGBB` hoặc `#RRGGBBAA`). Mặc định: `#000000` |
| `backcolor` | string |  | Màu nền. Mặc định: `transparent` |
| `hAlign` | `'left'` = canh trái / `'center'` = canh giữa / `'right'` = canh phải / `'justify'` = canh đều |  | Canh lề ngang. Mặc định: `left` |
| `vAlign` | `'top'` = canh trên / `'middle'` = canh giữa / `'bottom'` = canh dưới |  | Canh lề dọc. Mặc định: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | Xoay văn bản (độ) |
| `padding` | Padding |  | Đệm |
| `border` | BorderDef |  | Viền |
| `mode` | `'opaque'` = tô nền bằng `backcolor` / `'transparent'` = không tô nền |  | Chế độ hiển thị |
| `opacity` | number |  | Độ mờ đục (0.0–1.0) |
| `variation` | Record<string, number> |  | Giá trị các trục của font biến thiên (ví dụ `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'` = viết ngang / `'vertical-rl'` = viết dọc với các dòng tiến từ phải sang trái / `'vertical-lr'` = viết dọc với các dòng tiến từ trái sang phải |  | Hướng viết |
| `conditionalStyles` | ConditionalStyleDef[] |  | Style theo điều kiện (xem bảng bên dưới). Khi điều kiện thỏa, các thuộc tính tương ứng sẽ được ghi đè |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | Hướng văn bản (ltr = trái sang phải / rtl = phải sang trái / auto = tự phát hiện từ nội dung) |
| `openTypeScript` | string |  | Thẻ OpenType chỉ định quy tắc của hệ chữ viết nào trong font được dùng khi chuyển văn bản thành hình dạng glyph (shaping) (ví dụ `'latn'` = chữ Latinh, `'arab'` = chữ Ả Rập). Bình thường không cần chỉ định (được xử lý tự động từ nội dung văn bản) |
| `openTypeLanguage` | string |  | Thẻ OpenType làm rõ ngôn ngữ cho các font thay đổi hình dạng glyph theo ngôn ngữ trong cùng một hệ chữ viết. Bình thường không cần chỉ định |
| `openTypeFeatures` | Record<string, number> |  | Bật hoặc tắt các tính năng chuyển đổi glyph dựng sẵn của font. Ví dụ: `{ "palt": 1 }` = siết khoảng cách chữ tiếng Nhật, `{ "liga": 0 }` = tắt hợp tự, `{ "zero": 1 }` = số 0 có gạch chéo. Giá trị: 0 = tắt / 1 = bật; với các tính năng chọn glyph, là số thứ tự glyph thay thế bắt đầu từ 1 |

**`ConditionalStyleDef`**
| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | Điều kiện áp dụng. Khi truthy, các thuộc tính bên dưới sẽ ghi đè style |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | Cùng kiểu với các thuộc tính StyleDef trùng tên |  | Các giá trị được ghi đè khi điều kiện thỏa (ý nghĩa giống các thuộc tính StyleDef tương ứng) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | Cùng kiểu với các thuộc tính StyleDef trùng tên |  | Được khai báo trong định nghĩa kiểu, nhưng hiện thực hiện tại không áp dụng phần ghi đè của chúng khi điều kiện thỏa |

### Các kiểu dành cho nhập PDF và tính năng PDF nâng cao

Các kiểu liệt kê ở đây phục vụ hai mục đích: (1) các kiểu "bảo toàn" để tái xuất một PDF đã nhập mà không mất một byte nào, và (2) các kiểu để dùng những tính năng nâng cao như lớp PDF, script biểu mẫu, và thiết lập chế bản in thương mại. Bạn gần như sẽ không bao giờ chỉ định chúng khi viết tay một báo cáo thông thường. Các kiểu được mô tả là "được đặt bởi quá trình nhập PDF" xuất hiện bên trong các phần tử do `importPdfPage()` sinh ra.

**`OptionalContentDef`** (tính năng lớp của PDF)

PDF có thể đặt nội dung lên các "lớp" (optional content group, OCG), mà việc hiển thị và in có thể bật/tắt từ bảng lớp của trình xem. Chỉ định điều này trong `optionalContent` của phần tử sẽ đặt phần tử đó lên một lớp. Ví dụ: đặt hình mờ "Mật" lên một lớp chỉ xuất hiện khi in.

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `name` | string | ✓ | Tên lớp hiển thị trong bảng lớp của trình xem |
| `visible` | boolean |  | Trạng thái hiển thị ban đầu trên màn hình. Mặc định: true |
| `print` | boolean |  | Trạng thái in ban đầu. Mặc định: theo `visible` |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | Được đặt bởi quá trình nhập PDF. Bảo toàn định nghĩa lớp (OCG) của PDF nguồn hoặc một định nghĩa thành viên (OCMD) quyết định việc hiển thị từ tổ hợp nhiều lớp. Một định nghĩa thành viên có `groups` (các lớp đích), `policy` (`'AllOn'` = hiện khi tất cả đều bật / `'AnyOn'` = khi có bất kỳ lớp nào bật / `'AnyOff'` = khi có bất kỳ lớp nào tắt / `'AllOff'` = khi tất cả đều tắt), và một biểu thức logic hiển thị tùy chọn `expression` |
| `properties` | PdfOptionalContentPropertiesDef |  | Được đặt bởi quá trình nhập PDF. Bảo toàn cấu hình lớp toàn tài liệu (danh sách mọi lớp, cấu hình mặc định, cây thứ tự hiển thị của bảng lớp, các nhóm chọn loại trừ lẫn nhau, khóa, v.v.) |

**`PdfRawValueDef`** ("giá trị thô" của PDF)

Nhiều thuộc tính bảo toàn mang dữ liệu nội bộ PDF dưới dạng "giá trị thô", không diễn giải. Một giá trị thô là một giá trị JavaScript có hình dạng sau: `null`, boolean và số giữ nguyên; một tên PDF là `{ kind: 'name', value: 'DeviceRGB' }`; một chuỗi là `{ kind: 'string', bytes: Uint8Array }`; một mảng là `{ kind: 'array', items: [...] }`; một từ điển là `{ kind: 'dictionary', entries: { ... } }`; một stream là `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`** (các hành động do trình xem PDF thực thi)

Được dùng trong `additionalActions` của trường biểu mẫu và các nơi khác, kiểu này định nghĩa "trình xem nên làm gì". Nội dung chỉ được tuần tự hóa và nhập vào — **engine lõi không bao giờ thực thi chúng** (việc thực thi do trình xem có hỗ trợ đảm nhận).

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | Loại hành động. `'JavaScript'` = chạy một script (việc định dạng, kiểm tra hợp lệ và tính toán tự động cho ô nhập biểu mẫu dùng loại này) / `'GoTo'` = tới một đích trong tài liệu / `'GoToR'` = tới một tài liệu khác / `'GoToE'` = tới một tài liệu nhúng / `'URI'` = mở một URL / `'Launch'` = khởi chạy một ứng dụng hoặc tệp / `'Named'` = lệnh định sẵn (trang kế tiếp, v.v.) / `'SubmitForm'` = gửi biểu mẫu / `'ResetForm'` = đặt lại biểu mẫu / `'ImportData'` = nhập dữ liệu / `'Hide'` = bật/tắt hiển thị chú thích / `'SetOCGState'` = bật/tắt hiển thị lớp / `'Thread'`, `'Sound'`, `'Movie'`, `'Rendition'`, `'Trans'`, `'GoTo3DView'`, `'RichMediaExecute'`, `'GoToDp'` = các hành động PDF tiêu chuẩn khác |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Từ điển giữ thiết lập của từng loại hành động dưới dạng giá trị thô (xem **`PdfRawValueDef`** phía trên). Ví dụ: với `'JavaScript'`, `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | Đích cho họ `'GoTo'`. Hoặc dạng có tên (`{ kind: 'named', name, representation: 'name' \| 'string' }`) hoặc dạng tường minh (trang đích + cách khớp khung nhìn) |
| `structureDestination` | PdfStructureDestinationDef |  | Đích dựa trên một phần tử cấu trúc tài liệu (PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | Chỉ định chú thích mà các hành động đa phương tiện nhắm tới |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | Dãy các lớp và thao tác (`'ON'` / `'OFF'` / `'Toggle'`) được chuyển đổi bởi `'SetOCGState'` |
| `fieldTargets` | PdfActionFieldTargetsDef |  | Chỉ định tên các trường mà `'Hide'` / `'SubmitForm'` / `'ResetForm'` nhắm tới |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | Chỉ định tệp nhúng cho `'GoToE'` (cấu trúc đệ quy) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | Tham số riêng theo nền tảng cho `'Launch'`. Chỉ được bảo toàn, không bao giờ thực thi |
| `articleTarget` | PdfArticleActionTargetDef |  | Chỉ định luồng bài viết cho `'Thread'` |
| `documentPartIndex` | number |  | Số thứ tự phần tài liệu đích cho `'GoToDp'` |
| `richMediaInstanceIndex` | number |  | Số thứ tự thể hiện rich media |
| `next` | PdfActionDef \| PdfActionDef[] |  | Hành động sẽ thực thi tiếp theo (nối chuỗi) |

**`PdfFormXObjectDef`** (bảo toàn siêu dữ liệu cho các thành phần PDF đã nhập)

Bên trong một PDF, nội dung vẽ được dùng lặp lại có thể được đóng gói thành các thành phần gọi là "Form XObject". Quá trình nhập PDF chuyển một thành phần như vậy thành phần tử `frame` và giữ hệ tọa độ cùng siêu dữ liệu của thành phần trong kiểu này để có thể khôi phục khi tái xuất. Không cần chỉ định trong template viết tay.

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | Khung bao của thành phần (/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | Ma trận biến đổi của hệ tọa độ thành phần (/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | Phép biến đổi tọa độ đang có hiệu lực khi thành phần này được vẽ trong PDF nguồn |
| `formType` | 1 |  | Số hiệu loại form của thành phần (đặc tả PDF chỉ định nghĩa 1) |
| `group` | Record<string, PdfRawValueDef> |  | Bảo toàn dạng giá trị thô của từ điển nhóm trong suốt |
| `reference` | Record<string, PdfRawValueDef> |  | Bảo toàn dạng giá trị thô của từ điển tham chiếu PDF ngoài |
| `metadata` | Dạng stream của PdfRawValueDef (`kind: 'stream'`) |  | Bảo toàn stream siêu dữ liệu |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | Bảo toàn dữ liệu riêng của ứng dụng tạo lập (/PieceInfo) |
| `lastModified` | PdfRawValueDef |  | Bảo toàn dấu thời gian sửa đổi lần cuối |
| `structParent` / `structParents` | number |  | Bảo toàn các khóa tương ứng vào PDF có gắn thẻ (cấu trúc tài liệu như thứ tự đọc) |
| `opi` | PdfOpiMetadataDef |  | Bảo toàn thông tin OPI (xem bảng bên dưới) |
| `name` | string |  | Tên thành phần |
| `measure` | PdfMeasurement |  | Bảo toàn thông tin đo đạc (xem bảng bên dưới) |
| `pointData` | PdfPointData[] |  | Bảo toàn dữ liệu đám mây điểm (xem bảng bên dưới) |

**`PdfSourceVectorDef`** (định nghĩa dùng chung của các hình lặp lại đã nhập)

Khi nhập một PDF trong đó cùng một hình lặp lại với số lượng lớn — như các ký hiệu bản đồ — dữ liệu đường bao của hình được bảo toàn dưới dạng "một định nghĩa + N lần đặt". Nó xuất hiện trong `pdfSourceVector` của phần tử `path`; khi được chỉ định, `d` sẽ không được phân tích. Không cần chỉ định trong template viết tay.

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | Mảng các định nghĩa hình có thể tái sử dụng. Mỗi định nghĩa có `commands` (0 = di chuyển tới điểm đầu [2 tọa độ], 1 = đường thẳng [2], 2 = đường cong Bezier bậc ba [6], 3 = đóng path [0]) và `coords` (mảng tọa độ được làm phẳng theo thứ tự lệnh) |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | Mảng các lần đặt của định nghĩa. Mỗi lần đặt có `definitionIndex` (số hiệu định nghĩa) và `matrix` (ma trận affine 6 phần tử) |

**`PdfOpiMetadataDef`** (thông tin thay thế ảnh cho in thương mại)

OPI (Open Prepress Interface) là một cơ chế in thương mại trong đó ảnh nhẹ, độ phân giải thấp được dùng lúc biên tập rồi hoán đổi bằng ảnh độ phân giải cao khi nhà in xuất bản in. Được bảo toàn khi PDF đã nhập mang chỉ định này.

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | Phiên bản OPI |
| `entries` | Record<string, PdfRawValueDef> | ✓ | Giữ nội dung của từ điển OPI dưới dạng giá trị thô PDF (tên tệp nguồn để thay thế, vùng cắt, v.v.) |

**`PdfMeasurement`** (thông tin đo đạc cho bản vẽ và bản đồ)

Trong các PDF bản vẽ và bản đồ, công cụ đo của trình xem có thể đo khoảng cách và diện tích theo một tỉ lệ như "1 cm trên giấy tương ứng 1 m ngoài thực tế". Kiểu này bảo toàn tỉ lệ đó cùng thông tin hệ tọa độ, và có dạng thẳng góc (`kind: 'rectilinear'`) và dạng địa không gian (`kind: 'geospatial'`).

| Thuộc tính (`'rectilinear'`) | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | Bộ phân biệt cho phép đo thẳng góc |
| `scaleRatio` | string | ✓ | Văn bản hiển thị của tỉ lệ (ví dụ `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓ (`y` là tùy chọn) | Chuỗi các định dạng hiển thị số cho hướng X/Y (nhãn đơn vị, hệ số quy đổi, hiển thị thập phân/phân số, v.v.). Khi bỏ qua `y`, `x` sẽ được dùng |
| `distance` / `area` | PdfNumberFormat[] | ✓ | Định dạng hiển thị số cho khoảng cách/diện tích |
| `angle` / `slope` | PdfNumberFormat[] |  | Định dạng hiển thị số cho góc/độ dốc |
| `origin` | [number, number] |  | Gốc đo đạc |
| `yToX` | number |  | Hệ số quy đổi từ đơn vị Y sang X |

| Thuộc tính (`'geospatial'`) | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | Bộ phân biệt cho phép đo địa không gian |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | Hệ tọa độ trắc địa. Cần có hoặc một mã EPSG hoặc một chuỗi WKT |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | Các điểm khống chế theo tọa độ trắc địa và các điểm khống chế cục bộ tương ứng bên trong ảnh hoặc thành phần (cùng số lượng) |
| `dimension` | 2 \| 3 |  | Số chiều tọa độ. Mặc định: 2 |
| `bounds` | [number, number][] |  | Đa giác của vùng đo được |
| `displayCoordinateSystem` | Giống `coordinateSystem` |  | Hệ tọa độ dùng để hiển thị |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | Đơn vị hiển thị ưu tiên cho khoảng cách, diện tích và góc |
| `projectedCoordinateSystemMatrix` | Bộ 12 số |  | Ma trận affine 4×4 cho hệ tọa độ chiếu (12 phần tử theo thứ tự hàng, bỏ qua cột thứ tư hằng số) |

**`PdfPointData`** (dữ liệu đám mây điểm của bản đồ)

Dùng để bảo toàn các bảng dữ liệu điểm nhúng trong PDF bản đồ, với các cột được đặt tên như `LAT` (vĩ độ), `LON` (kinh độ) và `ALT` (cao độ).

| Thuộc tính | Kiểu / giá trị cho phép | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | Mảng tên cột (duy nhất và không rỗng; các cột `LAT`/`LON`/`ALT` phải là số) |
| `rows` | PdfRawValueDef[][] | ✓ | Giá trị của mỗi hàng. Độ dài hàng khớp với `names` |

**`TransferFunctionDef`** / **`CalculatorFunctionDef`** (hàm chuyển tông cho chế bản)

Các hàm dùng trong `deviceParams` và `softMask` của `frame`, ánh xạ một giá trị (0–1) sang một giá trị khác. Trong chế bản, chúng biểu diễn các đường cong tông màu — "mực ở mật độ này được in ở mật độ kia". Một `TransferFunctionDef` hoặc là một `CalculatorFunctionDef` (biểu thức máy tính PostScript, ví dụ `{ expression: '{ 1 exch sub }' }` = đảo đen trắng) hoặc là một `PdfFunctionDef` (một đối tượng hàm PDF: bảng các giá trị lấy mẫu, nội suy lũy thừa, hoặc tổ hợp của chúng); ở nơi nó được dùng, cũng có thể chỉ định `'Identity'` (không biến đổi).

**`HalftoneDef`** (định nghĩa nửa tông cho chế bản)

Máy in biểu diễn sự chuyển sắc bằng kích thước của các chấm nhỏ (điểm nửa tông). Kiểu này chỉ định cách các chấm đó được dựng nên, và được dùng cho việc bảo toàn khi nhập PDF cũng như cho việc tạo dữ liệu chế bản. `type` phân biệt năm dạng:

| Dạng | Thuộc tính chính | Mô tả |
| --- | --- | --- |
| type 1 (screen) | `frequency` (tần số tram) ✓, `angle` (góc) ✓, `spotFunction` (hình dạng chấm; một tên định sẵn như `'Round'` hoặc một biểu thức máy tính) ✓, `accurateScreens` (yêu cầu dựng tram độ chính xác cao; tùy chọn) | Dạng chuẩn định nghĩa nửa tông bằng tần số tram, góc và hình dạng chấm (có thể bỏ qua `type`) |
| type 6 (mảng ngưỡng) | `width` ✓, `height` ✓, `thresholds` (width × height giá trị, 0–255) ✓ | Định nghĩa nửa tông trực tiếp bằng một bảng ngưỡng |
| type 10 (ngưỡng nghiêng) | `xsquare` ✓, `ysquare` ✓, `thresholds` ✓ | Định nghĩa ngưỡng với các ô nghiêng góc |
| type 16 (ngưỡng 16-bit) | `width` ✓, `height` ✓, `thresholds` (giá trị 16-bit) ✓, hình chữ nhật thứ hai tùy chọn | Định nghĩa ngưỡng độ chính xác cao |
| type 5 (tập hợp theo từng bản) | `halftones` (mảng các `{ colorant: tên mực, halftone: bất kỳ dạng nào ở trên }`) ✓ | Gán một nửa tông khác nhau cho mỗi bản màu, chẳng hạn lục lam và đỏ tươi |

Bốn dạng ngoài type 5 có thể mang một `transferFunction` tùy chọn (`'Identity'` hoặc một `TransferFunctionDef`) (với type 5, mỗi định nghĩa nửa tông bên trong theo từng bản tự mang cái của riêng nó).

## API lõi

Các API được dùng nhiều nhất, liệt kê từng mục kèm một ví dụ tối thiểu để bạn tra cứu theo "điều bạn muốn làm". `template`, `dataSource`, `fontMap` và `fonts` được giả định đúng là những thứ đã dựng trong phần hướng dẫn.

### Dựng báo cáo

#### Dựng báo cáo từ template và dữ liệu — `createReport()`

Bố cục template cùng dữ liệu và trả về một `RenderDocument` theo trang. Biểu thức dùng một ngôn ngữ biểu thức dựng sẵn an toàn, có thể tham chiếu `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` và hơn thế — không dùng `eval` hay `Function`. Các biểu thức callback TypeScript cũng là một lựa chọn.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // số trang đã bố cục
```

#### Tra cứu và chỉnh sửa phần tử template theo ID — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

Cả hai API đều trả về tham chiếu tới phần tử của template gốc. Hãy thực hiện thay đổi trước khi gọi `createReport()`. `getElementChildren()` chỉ trả về phần tử con cho `frame` và `table` (các phần tử trong ô); với các phần tử khác nó trả về mảng rỗng. Chi tiết về phạm vi tìm kiếm, xem "Tra cứu phần tử theo ID và chỉnh sửa trước khi kết xuất".

#### Dựng báo cáo từ một tệp `.report` — `createReportFromFile()` (Node.js)

Đọc một template JSON và phân giải các đường dẫn tương đối của hình ảnh và subreport theo thư mục của template.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### Gộp nhiều báo cáo thành một tập — `createReportBook()`

Nối nhiều template — bìa, phần thân, v.v. — thành một `RenderDocument` duy nhất với số trang liên tục.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### Nối các `RenderDocument` đã dựng sẵn — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

Các ID hình ảnh bị trùng sẽ được đổi tên tự động.

#### Tự động sinh trang mục lục — `insertTableOfContents()`

Thu thập các mục lục từ các neo (`anchorName`) trong báo cáo và chèn các trang mục lục lên đầu.

```ts
const withToc = insertTableOfContents(
  document,
  // kích thước trang và lề của mục lục theo pt (ví dụ này: A4 dọc)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // ID font (khóa của fontMap) dùng cho văn bản mục lục
  { title: '目次' },
)
```

#### Lấy số trang của một PDF có sẵn — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### Nhập một PDF có sẵn thành phần tử báo cáo — `importPdfPage()`

Chi tiết xem **Chuyển PDF có sẵn thành phần tử báo cáo (nhập PDF)**.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### Kết xuất và xuất bản

#### Xuất PDF — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### Xem trước một trang đơn — `renderPage()`

Kết xuất theo từng trang. Dùng nó để chỉ vẽ trang đang hiển thị trong bản xem trước trên trình duyệt.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### Kết xuất toàn bộ báo cáo tới backend bất kỳ — `render()`

Kết xuất mọi trang tới bất kỳ đích xuất nào hiện thực giao diện `RenderBackend`.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### Vẽ lên HTML Canvas — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### Xuất SVG — `SvgBackend`

Sinh một chuỗi `<svg>` khép kín cho mỗi trang.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // mảng chuỗi <svg>, mỗi trang một chuỗi
```

#### Kiểm soát chi tiết việc sinh PDF — `PdfBackend`

Các tùy chọn riêng của PDF như ảnh thu nhỏ của trang được truyền vào hàm khởi tạo.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]` áp dụng cho trang thứ i. Với `thumbnailImageId` (ảnh thu nhỏ hiển thị trong danh sách trang), hãy chỉ định một ID hình ảnh tồn tại trong `document.images`.

#### Trộn các PDF đã hoàn thiện — `mergePdfFiles()`

Trộn nhiều PDF thành một bằng bộ phân tích PDF thuần TypeScript.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### Làm việc với font

#### Nạp một tệp font — `Font.load()`

Phân tích TTF, OTF, TTC, OTC, WOFF, WOFF2 và EOT.

```ts
const font = Font.load(fontBuffer)
```

#### Đo chiều rộng văn bản — `TextMeasurer`

Đo văn bản nhanh nhờ bộ nhớ đệm glyph của `Font`. Khi được đăng ký trong `fontMap`, nó cũng được dùng cho việc bố cục.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### Chuyển một chuỗi thành dãy glyph — `font.shapeText()`

Dùng thông tin OpenType / AAT (đặc tả mở rộng của các font dòng Apple) / Graphite (đặc tả mở rộng của các font dòng SIL) để thu được một dãy glyph (số hiệu glyph kèm vị trí và bước tiến) đã áp dụng việc chọn glyph, hợp tự và điều chỉnh vị trí.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### Phát hiện glyph thiếu trước khi in — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### Dùng riêng mã vạch, SVG, công thức toán học và hình ảnh

#### Sinh mã vạch độc lập — `renderBarcode()`

Sinh trực tiếp các nút vẽ mã vạch mà không thông qua một phần tử báo cáo.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### Phân tích và kết xuất SVG — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### Sắp chữ công thức toán học độc lập — `parseMathLaTeX()` / `layoutMathFormula()`

Cần một font có chứa thông tin kích thước dành cho công thức toán học (bảng OpenType MATH) — ví dụ STIX Two Math hoặc Latin Modern Math.

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// tham số: công thức đã phân tích, đối tượng Font, ID font (khóa của fontMap), cỡ chữ theo pt, màu chữ
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box là kết quả đã bố cục; phần tử math trong template chạy chính phép bố cục này bên trong
```

#### Lấy kích thước hình ảnh — `getImageDimensions()`

Hỗ trợ PNG/JPEG/WebP/AVIF.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### Giải mã PNG — `decodePng()`

Một bộ giải mã PNG thuần TypeScript.

```ts
const png = decodePng(pngBytes) // { width, height, pixels } (RGBA)
```

#### Xuất PDF chứa WebP/AVIF trên trình duyệt — `prepareBrowserPdfImageResources()`

JPEG được lưu thẳng vào PDF, còn PNG do bộ giải mã dựng sẵn xử lý. Khi sinh một PDF chứa WebP/AVIF trên trình duyệt, `tsreport-core/browser` trước tiên chỉ giải mã những hình ảnh thực sự được `RenderDocument` tham chiếu bằng các codec chuẩn của trình duyệt, rồi chuyển kết quả cho quá trình sinh PDF. Hình ảnh không được tham chiếu vẫn giữ nguyên và không bị giải mã.

```ts
import { prepareBrowserPdfImageResources, renderToPdf } from 'tsreport-core/browser'

// suppliedImages: byte hình ảnh được cung cấp lúc kết xuất; catalog: thiết lập catalog
// tài liệu PDF; collection: thiết lập portfolio PDF — bỏ qua bất kỳ mục nào bạn không dùng
const pageOptions = [{ thumbnailImageId: 'page-1-thumbnail.webp' }]
const preparationOptions = { images: suppliedImages, catalog, collection, pageOptions }
const { images, rasterImageDecoder } = await prepareBrowserPdfImageResources(document, preparationOptions)
const pdf = renderToPdf({ ...document, images }, {
  fonts, images, rasterImageDecoder, catalog, collection, pageOptions,
})
```

Để giải mã WebP/AVIF trong Node.js, hãy dùng `createNodeExternalRasterImageDecoder()` từ `tsreport-core/node`.

## Hạn chế khi nạp tài nguyên và quy tắc ID hình ảnh

Các quy tắc chi tiết cần tham khảo khi chúng trở nên liên quan tới việc vận hành máy chủ hoặc nhúng thư viện.

### Giới hạn thư mục được phép nạp hình ảnh và template

Việc nạp tệp hình ảnh có thể bị giới hạn trong các thư mục được cho phép tường minh.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()` mặc định phân giải các đường dẫn tương đối theo thư mục của template chính, nhưng để tương thích ngược, bản thân nó không ngầm giới hạn phạm vi nạp. Khi `resources.fileRoot` được chỉ định, cùng một hạn chế được áp dụng như nhau cho hình ảnh, template chính và các subreport. Hình ảnh thiếu được xử lý theo thiết lập `onError` của từng phần tử, còn các tham chiếu trỏ ra ngoài thư mục được phép (kể cả qua liên kết tượng trưng) luôn dẫn tới lỗi.

### Quy tắc ID hình ảnh

Mỗi hình ảnh của một `RenderDocument` được tra cứu từ `RenderDocument.images` bằng khóa `RenderImage.imageId` (tương tự với `imageId` của một ảnh thay thế). **Bên sử dụng phải dùng ID này làm khóa đúng nguyên trạng và không được lắp ghép lại khóa bằng cách nối đường dẫn hay tương tự.** ID được gán theo các quy tắc sau.

- Nạp một hình ảnh qua đường dẫn tương đối sẽ không thay ID bằng đường dẫn tuyệt đối trên máy chủ hay đường dẫn đã phân giải liên kết tượng trưng. Tham chiếu đúng như đã viết trong template vẫn là khóa (nếu viết dưới dạng đường dẫn tuyệt đối, giá trị đó được giữ nguyên)
- Đường dẫn vật lý đã phân giải liên kết tượng trưng chỉ được dùng nội bộ để quyết định xem hai tham chiếu có phải cùng một tệp hay không. Ngay cả khi thư mục gốc khác nhau, các hình ảnh trỏ tới cùng một tệp vật lý vẫn dùng lại cùng một ID
- Trong các cấu hình mà báo cáo gốc hoãn hình ảnh sang việc cung cấp lúc kết xuất — dùng trực tiếp `createReport()` mà cũng không truyền hình ảnh đang xét qua `resources`, khiến tham chiếu viết trong template trở thành ID nguyên trạng và các byte được cung cấp sau qua `renderToPdf(document, { images })` — thì các hình ảnh cục bộ theo đường dẫn tương đối do subreport nạp luôn được gán ID nội bộ độc lập với máy chủ. Vì các tham chiếu trong biểu thức và các subreport động không thể liệt kê trước, điều này không phụ thuộc vào việc một cái tên có thực sự trùng hay không, cũng không phụ thuộc thứ tự bố cục. Nhờ đó, hình ảnh cục bộ của một subreport không bao giờ có thể chiếm đoạt một ID cung cấp lúc kết xuất cùng tên

### Cung cấp hình ảnh lúc kết xuất và ảnh thay thế

Khi một ảnh thay thế không thể phân giải được lúc bố cục, ID hình ảnh gốc vẫn được giữ. Nhờ vậy các bản xem trước Canvas/SVG không bị dừng, và các byte có thể được cung cấp sau qua `renderToPdf(document, { images })`. `images` được truyền tường minh sẽ được trộn vào `document.images`, với giá trị truyền tường minh thắng thế cho cùng một ID. Ngay cả trong lúc sinh PDF, các ảnh thay thế chưa được cung cấp chỉ đơn thuần bị loại khỏi danh sách ứng viên thay thế — cả việc kết xuất hình ảnh chính lẫn toàn bộ báo cáo đều không bị dừng.

### Phạm vi thu thập tham chiếu hình ảnh

Việc thu thập tham chiếu hình ảnh xử lý không chỉ các phần tử `image` thông thường mà cả ảnh thay thế, mặt nạ mềm của nhóm, và các hoa văn lát của phần tô (fill/stroke) cùng với các mặt nạ mềm lồng bên trong chúng, tất cả qua cùng một cơ chế. Khi dùng ảnh thu nhỏ trang riêng của PDF, ảnh thu nhỏ thư mục bộ sưu tập, hay hình ảnh Web Capture trên trình duyệt, hãy truyền cùng `catalog`, `collection` và `pageOptions` cho cả `prepareBrowserPdfImageResources(document, options)` lẫn `renderToPdf(document, options)` (với API nguyên thủy, hãy truyền cùng bộ tùy chọn cho `new PdfBackend(options)` rồi gọi `render(document, backend)`). Những hình ảnh WebP/AVIF này cũng chỉ được giải mã khi cần thiết trước lúc sinh PDF.

## Yêu cầu môi trường chạy

- Node.js 18 trở lên
- ES Modules / CommonJS
- Các trình duyệt hiện đại
- Không có package phụ thuộc lúc chạy

Việc nén và giải nén Brotli cho WOFF2 dùng hiện thực thuần TypeScript được tích hợp sẵn trong tsreport-core trên cả Node.js lẫn trình duyệt. Không cần package ngoài, WASM hay thư viện native.

## Các dự án liên quan

- [tsreport-core](https://github.com/pontasan/tsreport-core)
- [tsreport-editor](https://github.com/pontasan/tsreport-editor)
- [tsreport-sdk](https://github.com/pontasan/tsreport-sdk)
- [tsreport-react](https://github.com/pontasan/tsreport-react)

## Giấy phép

tsreport-core được cung cấp, tùy bạn chọn, theo [Giấy phép MIT](./LICENSE-MIT) hoặc [Giấy phép Apache 2.0](./LICENSE-APACHE) (SPDX: `MIT OR Apache-2.0`). Về thông báo bản quyền và điều khoản giấy phép của mã nguồn và dữ liệu của bên thứ ba, xem [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
