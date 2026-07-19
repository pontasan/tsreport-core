# tsreport-core

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | 한국어 | [Tiếng Việt](./README.vi.md) | [ไทย](./README.th.md) | [Bahasa Indonesia](./README.id.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Español](./README.es.md) | [Português](./README.pt.md) | [العربية](./README.ar.md) | [עברית](./README.he.md)

**일본어·중국어·한국어부터 아랍 문자까지. 전 세계의 문자를 Pure TypeScript만으로 아름다운 PDF로 만드는 업무 문서(리포트) 엔진입니다.**

`tsreport-core`는 OpenType 폰트 해석, 문자 조판(문자를 올바른 글자 모양·너비·위치로 지면에 배치하는 처리), 밴드 방식의 리포트 레이아웃, Canvas/SVG 미리보기, PDF 생성까지를 하나의 그리기 모델로 일관되게 다룹니다. 런타임 의존 패키지는 제로. 네이티브 모듈도 WASM도 사용하지 않으며, 이 패키지 하나만으로 Node.js와 모던 브라우저 양쪽에서 동작합니다.

이 문서의 코드 샘플은 의도적으로 일본어 업무 데이터(견적서·청구서)를 사용합니다. 샘플 자체가 이 엔진의 CJK 조판 능력을 보여 주는 라이브 데모를 겸하고 있기 때문입니다.

```bash
npm install tsreport-core
```

이 README에는 첫 PDF 생성부터 전체 16가지 리포트 요소·세로쓰기·다국어 조판·폰트 임베딩과 아웃라인화·브라우저 미리보기까지, 복사해서 그대로 실행할 수 있는 샘플을 갖추어 놓았습니다. 리포트 도구가 처음이신 분은 **리포트 레이아웃의 기본** 섹션에서 개념을 익힌 뒤, 튜토리얼로 첫 PDF를 만들어 보시기 바랍니다.

## tsreport-editor로 WYSIWYG 보고서 디자인

[tsreport-editor](https://github.com/pontasan/tsreport-editor)는 tsreport-core를 기반으로 만든 WYSIWYG 보고서 디자이너입니다. 화면에서 밴드와 요소를 배치하고, JSON 테스트 데이터를 연결하고, 인쇄 미리보기를 확인하고, PDF를 가져오며, 동일한 core 렌더링 엔진으로 PDF를 생성할 수 있습니다. 아래 동영상은 AI가 MCP를 통해 보고서를 편집하고 Editor에서 완성된 미리보기를 여는 과정을 보여 줍니다.

| 영어 데모 | 일본어 데모 |
| --- | --- |
| [![영어판 tsreport-editor WYSIWYG 데모](https://img.youtube.com/vi/CHsNew6yQr4/hqdefault.jpg)](https://youtu.be/CHsNew6yQr4) | [![일본어판 tsreport-editor WYSIWYG 데모](https://img.youtube.com/vi/0I3ljxLUbys/hqdefault.jpg)](https://youtu.be/0I3ljxLUbys) |

## 전 세계의 문자를 하나의 엔진으로 올바르게 조판합니다

다국어 리포트는 문자열을 그대로 PDF에 써 넣는 것만으로는 올바르게 표시되지 않습니다. 글자 모양의 선택, 문자 너비의 계측, 위치 조정, 줄바꿈, 세로쓰기, 그리고 PDF로의 폰트 임베딩——이 일련의 처리가 모두 맞물려야 비로소 기대한 대로의 지면이 됩니다.

`tsreport-core`는 이 흐름을 폰트 해석부터 PDF 생성까지 일관되게 맡아 처리합니다.

- **일본어·중국어·한국어** — 간체자·번체자, 한글, 구두점 처리, 세로쓰기용 글자 모양까지 Unicode와 OpenType 정보에 기반해 올바르게 조판합니다
- **아랍 문자와 오른쪽에서 왼쪽(RTL) 조판** — 문맥에 따른 글자 모양 변화, 결합·합자(여러 문자가 이어져 하나의 글자 모양이 되는 현상), Unicode 양방향 처리(오른쪽에서 왼쪽으로 진행하는 문자와 숫자·로마자가 섞일 때의 배열 순서 제어)를 다른 문자와 동일한 레이아웃 처리로 다룹니다
- **복잡한 문자 체계** — 폰트에 내장된 조판 규칙(OpenType Layout)에 의한 글자 모양 치환·위치 조정, 결합 문자, 이체자(같은 문자의 다른 디자인 글자 모양), 언어별 조판 기능에 대응합니다
- **세로쓰기** — `vertical-rl` / `vertical-lr`, 세로쓰기용 글자 모양, 세로짜기용 메트릭(세로쓰기 전용 글자 보내기 폭 등의 치수 정보), 문자 회전을 처리합니다
- **폰트 자동 서브셋 임베딩** — 실제로 사용한 글리프(폰트에 수록된 한 글자분의 모양 데이터)만을 PDF에 수록하므로, 보는 쪽에 같은 폰트가 없어도 같은 모습으로 표시됩니다
- **문자 아웃라인화** — 요소 단위로, 문자를 폰트에 의존하지 않는 벡터 패스로 출력할 수 있습니다
- **시스템 폰트 참조** — 열람 환경의 폰트를 사용하는 운용을 위해, 폰트를 임베드하지 않는 가벼운 PDF도 선택할 수 있습니다
- **깨진 문자의 사전 감지** — `checkGlyphCoverage()`가 폰트에 수록되지 않은 문자를 페이지·문자 단위로 출력 전에 찾아냅니다

그리고 이 문자 조판은 리포트 전용 고급 레이아웃 엔진과 한 몸으로 동작합니다. 문자를 올바르게 배치하는 능력과 페이지를 올바르게 할당하는 능력은 떼어 놓을 수 없기 때문입니다.

- **문자량에 연동하는 레이아웃** — 문자 수에 따른 행 늘이기(`stretchWithOverflow`)와 밴드 높이 자동 조정. 긴 품명도 잘리지 않습니다
- **데이터 양에 따른 자동 페이지 나눔** — 명세가 넘치면 자동으로 페이지를 넘기고 헤더·제목 행을 다시 출력합니다. 그룹 단위의 소계·페이지 나눔도 선언만으로 할 수 있습니다
- **중첩 구조의 배치** — 표·크로스 집계·서브리포트를 조합한 복잡한 리포트도 같은 레이아웃 엔진이 일관되게 배치합니다
- **WYSIWYG(미리보기=인쇄)** — 요소는 지정한 pt 좌표 그대로 고정 배치되며, Canvas/SVG 미리보기와 PDF 출력이 동일한 레이아웃 결과를 공유합니다. 화면에서 본 그대로가 그대로 종이가 됩니다

## 왜 tsreport-core인가

tsreport-core는 세 가지 문제의식에서 태어난 프로젝트입니다.

**TypeScript에 제대로 된 리포트 솔루션이 없다는 것.** 견적서나 청구서를 출력하는 일은 비즈니스의 기본인데도, TypeScript/Node.js 생태계에는 PDF를 저수준으로 그리는 라이브러리는 있어도 밴드 레이아웃·자동 페이지 나눔·집계·미리보기와 인쇄의 일치까지 갖춘 "리포트 엔진"이라 부를 만한 것이 없었습니다. 리포트만을 위해 다른 언어의 런타임이나 외부 서버 제품을 도입하는 구성을 끝내고 싶었습니다.

**리포트는 기본 기능이며 누구나 무상으로 사용할 수 있어야 한다는 것.** 리포트 출력은 일부 고가 제품만이 가진 특별한 기능이 아니라 업무 시스템의 토대가 되는 기본 기능입니다. 상용 라이선스 구매도 종량 과금도 없이, 개인의 도구부터 상용 제품까지 누구나 같은 엔진을 그대로 사용할 수 있어야 합니다. tsreport-core가 MIT OR Apache-2.0 듀얼 라이선스로 전체 기능을 공개하고 있는 것은 이 생각의 구현입니다.

**아시아권이나 아랍 문자 등의 다국어 지원을 정면으로 구현한 솔루션이 적다는 것.** 많은 리포트·PDF 생성 도구는 서구권 문자를 전제로 설계되어 있어, 일본어·중국어·한국어 조판이나 오른쪽에서 왼쪽으로 흐르는 아랍 문자는 나중에 덧붙인 대응에 그치기 쉽습니다. tsreport-core는 "전 세계의 문자를 하나의 엔진으로 올바르게 조판한다"를 처음부터의 설계 목표로 삼아, 폰트 해석부터 조판·PDF 임베딩까지 자체적으로 구현했습니다.

이 동기를 다음 세 가지 특장점으로 구체화했습니다.

### 레이아웃 엔진부터 PDF 생성까지 이것 하나로 완결

템플릿과 데이터로 페이지를 조립하면 결과는 `RenderDocument`라는 하나의 그리기 모델로 정리됩니다. 이것을 그대로 PDF에도 Canvas에도 SVG에도 그릴 수 있으므로, 화면 미리보기와 인쇄에서 레이아웃 처리를 이중으로 가질 필요가 없고, 화면에서 본 그대로의 PDF를 얻을 수 있습니다. 밴드 레이아웃을 갖춘 리포트 엔진과 PDF 라이브러리를 따로따로 조합할 필요는 없습니다.

### 런타임 의존 제로의 Pure TypeScript

폰트 해석, 문자 조판, PDF 생성, DEFLATE 압축, 암호화, PNG 디코드, 바코드 생성까지 모두 Pure TypeScript로 구현했습니다. 네이티브 모듈도 외부 프로세스도 사용하지 않으므로 어떤 환경에서도 동일하게 동작하며, 리포트 생성에서 실행되는 코드의 감사도 이 패키지 하나만 읽으면 끝납니다.

### 리포트에 필요한 기능을 표준 탑재

- 타이틀, 페이지 헤더, 명세, 그룹, 서머리 등의 밴드 레이아웃
- 테이블, 크로스 집계, 서브리포트, 변수, 표현식, 페이지 나눔, 목차, 여러 리포트의 결합
- 기존 PDF 가져오기 — PDF 페이지를 리포트 요소(`ElementDef`)·스타일·이미지·폰트 정보로 변환
- Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code, Data Matrix, PDF417
- SVG, 그라디언트, 클리핑, 투명도, 수식 조판, 이미지
- PDF 암호화, PDF/A-1b·2b·3b(장기 보존용 국제 규격), PDF/X-1a(인쇄 입고용 국제 규격), 책갈피(북마크), 링크, 폼, 주석
- TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT, 가변 폰트(굵기·너비 등을 연속적으로 바꿀 수 있는 폰트), 컬러 폰트

## 리포트 레이아웃의 기본

리포트 엔진을 처음 사용하는 분을 위해, 토대가 되는 개념을 순서대로 설명합니다.

### 전제: 리포트는 "템플릿"과 "데이터"로 나누어 만듭니다

tsreport-core에서는 리포트를 **템플릿**(레이아웃 정의)과 **데이터**(JSON)의 둘로 나누어 만듭니다.

템플릿에는 실제 값을 쓰지 않습니다. "이 위치에 품명을, 이 너비·이 서식으로 금액을"이라는 틀과, 거기에 **데이터의 어느 항목을 표시할지**에 대한 참조(`field.item`=데이터의 `item` 항목, 이라는 표기)만을 정의합니다.

실제 값은 JSON 데이터로 전달합니다. `rows` 배열의 요소 하나가 명세 한 행분입니다.

```json
{
  "rows": [
    { "item": "りんご", "amount": 100 },
    { "item": "みかん", "amount": 80 },
    { "item": "ぶどう", "amount": 300 }
  ]
}
```

리포트를 생성하면 엔진이 `rows`를 위에서부터 한 행씩 따라가며, 한 행마다 명세 레이아웃을 한 번 출력합니다. 위의 예라면 명세는 3행 인쇄되고 `field.item`은 각각 "りんご", "みかん", "ぶどう"로 치환됩니다. 데이터가 10,000행으로 늘어나도 템플릿은 한 글자도 바꾸지 않고 10,000행의 리포트가 됩니다. 이 "레이아웃은 고정, 행 수는 데이터에 달려 있다"는 분업이 리포트 엔진의 출발점입니다.

### 페이지는 "밴드"를 쌓아 올린 것

그 위에서 템플릿 쪽에서는 페이지를 **밴드**라 불리는 가로로 긴 영역을 쌓아 올린 것으로 설계합니다. 요소의 Y 좌표를 직접 계산해 페이지에 배치하는 것이 아니라, "어느 밴드에 무엇을 놓을지"만 선언하면 데이터의 행 수에 따라 엔진이 페이지를 자동으로 조립합니다. 한 페이지는 다음과 같은 구조가 됩니다.

```text
┌──────────────────────────┐
│ title                    │ ← 리포트의 첫머리에 1회만(표제·수신처 등)
├──────────────────────────┤
│ pageHeader               │ ← 매 페이지의 상단(회사명·발행일 등)
├──────────────────────────┤
│ columnHeader             │ ← 명세의 제목 행(「品名・数量・金額」 등)
├──────────────────────────┤
│ details                  │ ┐
│ details                  │ │ rows의 1행마다 1회,
│ details                  │ │ 행 수만큼 반복
│   :                      │ ┘
├──────────────────────────┤
│ columnFooter             │ ← 명세의 마무리(페이지·칼럼마다)
├──────────────────────────┤
│ pageFooter               │ ← 매 페이지의 하단(페이지 번호 등)
└──────────────────────────┘
```

마지막 페이지에서는 마지막 `details` 뒤에 `summary`(리포트 전체의 합계 등)가 한 번만 출력됩니다. 이 밖에 매 페이지의 배경에 깔리는 `background`, 마지막 페이지 전용의 `lastPageFooter`, 데이터가 0행일 때만 나오는 `noData`가 있으며, `bands`에 정의할 수 있는 밴드는 모두 10종류입니다.

| 밴드 | 출력되는 시점 | 전형적인 용도 |
| --- | --- | --- |
| `background` | 매 페이지의 배경 | 워터마크, 장식 테두리 |
| `title` | 리포트의 첫머리에 1회 | 표제, 수신처 |
| `pageHeader` | 매 페이지의 상단 | 회사명, 발행일 |
| `columnHeader` | 명세의 앞(페이지·칼럼마다) | 명세의 제목 행 |
| `details` | 데이터(`rows`)의 1행마다 | 명세 행 |
| `columnFooter` | 명세의 뒤(페이지·칼럼마다) | 소계란 |
| `pageFooter` | 매 페이지의 하단 | 페이지 번호 |
| `lastPageFooter` | 마지막 페이지의 하단(지정 시 `pageFooter` 대신) | 마무리 문구 |
| `summary` | 전체 명세의 뒤에 1회 | 총합계, 비고 |
| `noData` | 데이터가 0행일 때 | "해당 데이터가 없습니다" |

나아가 `groups`를 정의하면 그룹 키의 값이 바뀌는 위치에 그룹의 헤더·푸터가 자동으로 삽입되어, "부서마다 소계를 내고 페이지를 나눈다" 같은 레이아웃이 됩니다.

또한 템플릿의 `columns`(`count`=단 수, `spacing`=단 간격 pt)를 지정하면 명세 영역을 신문처럼 여러 개의 세로 단(**칼럼**)으로 나누어 흘려 넣을 수 있습니다. 기본은 1칼럼이며, 그 경우 이 문서에서 "칼럼마다"라고 되어 있는 동작은 "페이지마다"와 같은 의미가 됩니다. 또, 다음 칼럼으로 넘기는 것을 "칼럼 나눔"이라 표기합니다.

### 페이지 나눔은 자동으로 이루어집니다

명세가 페이지에 다 들어가지 않게 되면 엔진이 자동으로 그 페이지를 마감하고(`pageFooter`를 출력하고) 다음 페이지를 시작하며, `pageHeader`와 `columnHeader`를 한 번 더 출력한 뒤 이어지는 명세를 흘려 넣습니다. 행 수를 세거나 페이지의 남은 높이를 계산하는 코드는 필요 없습니다.

제어하고 싶을 때만 다음 수단을 사용합니다.

- `break` 요소 — 임의의 위치에서 강제로 페이지 나눔·칼럼 나눔을 합니다
- 밴드의 `startNewPage` — 그 밴드를 반드시 새 페이지부터 시작합니다
- 밴드의 `splitType` — 높이가 부족할 때 밴드 도중에 페이지를 걸쳐도 되는지(`stretch`), 분할하지 않고 통째로 다음 페이지로 보낼지(`prevent`)를 선택합니다

### 서브리포트 = 리포트 안에 끼워 넣는 또 하나의 리포트

`subreport` 요소는 부모 리포트의 레이아웃 안에 다른 `.report`를 통째로 끼워 넣습니다. "주문 목록을 인쇄하고, 각 주문 안에 그 내역을 표로 인쇄한다"——이러한 **중첩 데이터**를 조판하기 위한 구조입니다.

예를 들어 부모의 `rows` 한 행(=주문 1건)이 내역의 배열 `items`를 가지고 있다고 합시다.

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

부모의 `details` 밴드에 `subreport` 요소를 놓고, `dataSourceExpression`으로 "이 주문의 `items`"를 전달합니다.

```json
{
  "type": "subreport",
  "x": 20, "y": 24, "width": 300, "height": 40,
  "templateExpression": "'order-items.report'",
  "dataSourceExpression": "field.items"
}
```

`templateExpression`은 이름 그대로 "표현식"입니다. 고정된 파일 이름을 전달할 때는 표현식 안의 문자열 리터럴로서 `'...'`로 감쌉니다(`"field.templatePath"`처럼 표현식으로 동적으로 전환할 수도 있습니다).

그러면 **부모의 명세 1행마다 서브리포트가 1회 실행되고**, 전달된 `items`가 서브리포트 쪽의 `rows`로 취급됩니다. 서브리포트(`order-items.report`)는 독립된 하나의 템플릿이므로 자신의 밴드 정의를 가지며, `field.name`·`field.qty`로 내역의 각 행을 참조합니다. 페이지 위에서는 다음과 같이 전개됩니다.

```text
┌──────────────────────────────┐
│ details                      │ ← 부모의 rows 1행째(주문 A-001)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← 이 주문의 items(2건)를 전달
│   │   details              │ │ ← items 1행째(りんご 10)
│   │   details              │ │ ← items 2행째(みかん 5)
│   └────────────────────────┘ │
├──────────────────────────────┤
│ details                      │ ← 부모의 rows 2행째(주문 A-002)
│   ┌────────────────────────┐ │
│   │ subreport              │ │ ← 이 주문의 items(1건)를 전달
│   │   details              │ │ ← items 1행째(ぶどう 2)
│   └────────────────────────┘ │
└──────────────────────────────┘
```

청구서 안의 내역 표, 고객마다 반복되는 명세 블록 등 "리포트 안의 작은 리포트"를 부품으로 잘라 내어 재사용할 수 있습니다. 파라미터(제목 문자열 등)를 부모로부터 전달할 수도 있습니다. 이 뒤의 **전체 리포트 요소의 구현 샘플** 섹션에, 같은 구성으로 그대로 동작하는 완전한 예(부모 요소+서브리포트 쪽 템플릿)가 있습니다.

## `.report`와 JSON 데이터로 PDF를 생성하기

`.report`는 `ReportTemplate`을 JSON으로 기술한 리포트 템플릿입니다. 내용물은 그냥 JSON이므로 Git으로 차이를 관리할 수 있고, 임의의 언어나 도구에서 생성할 수도 있습니다.

최소 구성은 다음 3개 파일입니다.

```text
reports/
├── quotation.report
├── quotation.test-data.json
└── fonts/
    ├── NotoSansJP-Regular.otf
    └── NotoSansJP-Bold.otf
print-report.mjs
```

폰트 2개는 일본어 폰트(예: Noto Sans JP)의 Regular / Bold를 상정한 파일 이름입니다. 가지고 계신 폰트에 맞추어 바꿔 읽어 주십시오. 여러 언어를 하나의 리포트에서 다루는 방법은 뒤에 나오는 **다국어 리포트 만들기** 섹션에서 설명합니다.

### 1. 템플릿 `quotation.report`를 작성하기

좌표·치수·여백·폰트 크기의 단위는 모두 PDF의 표준 단위인 **pt(포인트, 1pt = 1/72인치 ≈ 0.353mm)**입니다. `"size": "A4"`는 595 × 842pt로 취급되며(ISO 치수 210×297mm를 pt로 환산해 정수로 반올림한 값), 이 예의 여백 36pt는 약 12.7mm입니다.

또 하나의 전제로, `styles`의 `fontFamily`는 폰트 파일 이름이 아니라 나중에 실행 코드 쪽의 `fontMap`·`fonts`에 등록할 **키 이름(논리명)**입니다. 템플릿과 코드에서 같은 이름(이 예에서는 `jp`·`jpBold`)을 사용함으로써 대응됩니다.

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

명세에서 사용하고 있는 `pattern`은 숫자·날짜의 서식 지정입니다(`#,##0`=3자리 구분, `¥#,##0`=엔 기호가 붙은 3자리 구분. 자세한 내용은 뒤에 나오는 "숫자·날짜를 서식화하고 싶다" 참조).

### 2. 데이터를 `quotation.test-data.json`에 준비하기

`rows`의 각 행이 명세 밴드의 `field.*`에, `parameters`가 리포트 전체의 `param.*`에 바인딩됩니다.

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

바인딩의 대응 관계는 다음과 같습니다.

| JSON | `.report`의 표현식 | 용도 |
| --- | --- | --- |
| `rows[n].item` | `field.item` | 현재의 명세 행 |
| `parameters.title` | `param.title` | 리포트 전체의 인수 |
| 변수 `grandTotal` | `vars.grandTotal` | 집계·카운트 등의 리포트 변수 |
| 페이지 컨텍스트 | `PAGE_NUMBER` / `TOTAL_PAGES` | 페이지 번호·총 페이지 수 |

### 3. `.report`를 읽어 들여 PDF를 생성하기

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

`fontMap`과 `fonts`에 같은 폰트를 이중으로 등록하는 것은 역할이 다르기 때문입니다. `fontMap`은 레이아웃 시의 문자 너비 계측(`TextMeasurer`)에, `fonts`는 PDF 생성 시의 폰트 임베딩에 사용됩니다. 같은 폰트를, 템플릿의 `fontFamily`와 같은 키 이름으로 양쪽에 등록해 주십시오.

`createReportFromFile()`은 이미지와 서브리포트의 상대 경로를 메인 `.report`의 디렉터리 기준으로 해석합니다. `workingDirectory`를 지정한 경우는 그 디렉터리가 기준입니다. 읽기 범위를 제한하려면 `resources.fileRoot`에 허가할 루트를 명시해 주십시오. 루트 밖으로의 상대 참조와 루트 밖을 가리키는 심볼릭 링크는 거부됩니다.

## 템플릿을 TypeScript로 직접 정의하기

`.report` 파일을 사용하지 않고 템플릿을 TypeScript 객체로 작성할 수도 있습니다. 타입 검사와 자동 완성이 동작하므로, 템플릿을 코드에서 생성하는 용도에 적합합니다. 내용은 튜토리얼과 같은 견적서입니다. 좌표와 치수의 단위는 pt입니다.

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

### ID로 요소를 가져와 그리기 전에 변경하기

요소에 임의의 `id`를 붙이면 `findElementById()`로 밴드나 프레임의 깊이에 관계없이 가져올 수 있습니다. 반환값은 복사본이 아니라 `template` 안의 요소 그 자체이므로, `createReport()`보다 앞에서 변경한 내용이 레이아웃과 그리기에 반영됩니다.

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

`findElementById()`는 일반 밴드, 명세 밴드, 그룹의 헤더/푸터, 프레임, 소프트 마스크, 테이블 셀을 깊이 우선으로 검색합니다. 같은 ID가 여러 개 있는 경우는 검색 순서상 첫 번째 요소를 반환하므로, 변경 대상으로 사용하는 ID는 템플릿 안에서 유일하게 해 주십시오. `getElementChildren()`이 반환하는 배열 안의 요소도 원본 템플릿 안의 참조입니다.

> 폰트 파일은 패키지에 동봉되지 않습니다. 용도·배포 방법·임베드 가능 여부에 적합한 라이선스의 폰트를 지정해 주십시오. 하나의 스타일에 지정할 수 있는 폰트는 하나입니다. 하나의 요소 안에서 여러 언어의 문자를 혼재시키고 싶은 경우는, 그것들을 한 벌로 수록한 Pan-CJK 폰트(한중일 문자를 한꺼번에 수록한 폰트. 예: Source Han Sans〔본고딕〕, Noto Sans CJK)가 필요합니다. 언어마다 다른 폰트를 사용하는 경우는, 다음의 "다국어 리포트 만들기"처럼 요소를 언어 단위로 나누어 스타일을 구분해 사용합니다.

## 다국어 리포트 만들기

스타일 하나에 지정할 수 있는 폰트는 하나이며, 폰트 간의 자동 폴백은 없습니다. 따라서 다국어 리포트의 기본형은 **언어마다 폰트를 읽어 들이고, 언어별 요소에 각각의 스타일을 적용하는** 것입니다.

다음 예는 일본어와 간체 중국어를 병기하는 견적서의 발췌입니다. 먼저 언어마다 폰트를 읽어 들입니다.

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

템플릿에서는 일본어 문구에 `ja` 스타일, 중국어 문구에 `zh` 스타일을 적용하여 요소를 언어 단위로 나눕니다.

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

데이터도 언어별 항목으로 가집니다.

```json
{
  "rows": [
    { "nameJa": "高耐久ボールベアリング", "nameZh": "高耐久滚珠轴承" },
    { "nameJa": "産業用制御モジュール", "nameZh": "工业控制模块" }
  ]
}
```

예외는, 자유 기술 비고란처럼 **어느 언어가 들어올지 실행 시까지 알 수 없는 하나의 칸**입니다. 그 칸은 요소를 언어로 나눌 수 없으므로, 그 스타일에만 많은 문자 체계를 한 벌로 수록한 Pan-CJK 폰트(Source Han Sans〔본고딕〕, Noto Sans CJK 등)를 할당하는 것이 현실적입니다. 어느 방식이든 폰트의 수록 누락은 `checkGlyphCoverage()`가 출력 전에 감지합니다.

## 폰트 출력 방식을 문자 요소마다 선택하기

같은 리포트 안에서도 본문은 검색 가능한 임베드 문자, 로고는 아웃라인, 정형 문구는 시스템 폰트 참조라는 식으로, `staticText` 또는 `textField`마다 출력 방식을 지정할 수 있습니다.

| 방식 | 지정 | PDF 위의 상태 | 적합한 용도 |
| --- | --- | --- | --- |
| 서브셋 임베딩 | `pdfFontMode: 'embedded'`(기본) | 사용한 글리프와 폰트 프로그램을 임베드. 문자의 선택·검색이 가능 | 배포, 장기 보존, 인쇄, 다국어 리포트 |
| 아웃라인화 | `outlineText: true` | 글자 모양을 벡터 패스로 변환. 폰트 정보를 갖지 않음 | 로고, 판하 등, 글자 모양을 완전히 고정하고 싶은 문자 |
| 시스템 폰트 참조 | `pdfFontMode: 'reference'` | 폰트를 임베드하지 않고 폰트 이름과 문자만 기록 | 폰트 환경을 관리할 수 있는 사내 배포 등에서의 가벼운 PDF |

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

서브셋 임베딩은 출력 대상 환경에 의존하지 않고 글자 모양을 유지하기 위한 권장 방식입니다. 시스템 폰트 참조는 PDF를 여는 환경에 호환 폰트가 필요하며, 환경이 다르면 외관도 달라질 수 있습니다. 아웃라인화한 문자는 일반 문자열로 선택·검색할 수 없습니다.

## 세로쓰기

스타일에 `writingMode`를 지정하기만 하면 세로쓰기용 글자 모양과 세로쓰기 전용 치수 정보(세로짜기용 메트릭=글자의 보내기 폭 등)를 사용한 세로짜기가 됩니다. `vertical-rl`은 행을 오른쪽에서 왼쪽으로, `vertical-lr`은 행을 왼쪽에서 오른쪽으로 진행합니다.

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

## 브라우저에서 PDF와 같은 리포트를 미리보기

PDF용으로 작성한 `RenderDocument`를 그대로 Canvas에도 그릴 수 있습니다. 미리보기와 인쇄가 같은 레이아웃 결과를 공유하므로 "화면과 종이에서 겉모습이 다르다"는 문제가 일어나지 않습니다. pt 단위의 고정 레이아웃과 결합하여 WYSIWYG한 미리보기·편집 체험의 토대가 됩니다(폰트 임베딩이 기본. 시스템 폰트 참조 모드만은 열람 환경에 외관이 의존합니다). `renderPage()`를 호출하기만 하면 페이지의 시작·종료 처리를 포함해 그려집니다.

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

React로 미리보기 UI를 구성하는 경우는 `tsreport-react` 패키지도 이용할 수 있습니다.

## 폰트 엔진을 단독으로 사용하기

리포트를 만들지 않아도 폰트 해석·셰이핑(문자열을, 실제로 그릴 글자 모양의 나열과 위치로 변환하는 처리)·문자 계측·서브셋 생성의 각 기능을 단독으로 이용할 수 있습니다.

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

## 기존 PDF를 리포트 요소로 변환하기(PDF 가져오기)

`importPdfPage()`는 기존 PDF의 페이지를 해석하여 tsreport-core의 리포트 요소(`ElementDef`) 배열로 변환합니다. 단순한 뷰어가 아니라, 텍스트는 `staticText`, 이미지는 `image`, 도형은 `path`라는 식으로, 이 리포트 엔진에서 그대로 편집·재배치할 수 있는 부품으로 가져옵니다.

종이로 운용해 온 리포트의 PDF나 다른 시스템이 출력한 PDF를 토대로 하여 데이터 채우기 칸을 더하거나 레이아웃을 재구성하는——"기존 리포트 자산을 템플릿화하기" 위한 입구입니다.

```ts
import { readFileSync } from 'node:fs'
import { getPdfPageCount, importPdfPage } from 'tsreport-core'

const bytes = readFileSync('./existing-form.pdf')

const pageCount = getPdfPageCount(bytes)
const page = importPdfPage(bytes, 0)

// page.elements: staticText / image / path 등의 리포트 요소 배열
// page.styles:   요소가 참조하는 문자 스타일 정의
// page.images:   요소가 참조하는 이미지 데이터
// page.fonts:    참조되고 있는 폰트 정보
console.log(pageCount, page.width, page.height, page.elements.length)
```

가져온 `elements`와 `styles`는 그대로 템플릿의 밴드에 배치할 수 있습니다. 암호화 PDF의 비밀번호 지정, 주석 가져오기, 가져온 문자의 아웃라인화 등은 `PdfImportOptions`로 제어합니다.

## 표현식(Expression)을 활용하기

리포트의 "움직이는 부분"은 모두 표현식으로 작성합니다. `textField`의 인쇄 내용, `printWhenExpression`의 인쇄 조건, 바코드의 데이터, 이미지의 경로, 서브리포트에 전달하는 데이터——타입이 `Expression`인 프로퍼티에는 어디서든 같은 표현식을 쓸 수 있습니다.

표현식에는 두 가지 형식이 있습니다.

- **문자열 표현식** — `"field.price * field.quantity"` 같은 문자열. 전용 파서가 해석하는 JavaScript의 안전한 서브셋으로, `eval`이나 `new Function`은 일절 사용하지 않습니다. 템플릿을 JSON(`.report` 파일)으로 저장할 수 있습니다
- **콜백 표현식** — `(field, vars, param, report) => …` 형태의 TypeScript 함수. 언어 기능을 전부 사용할 수 있지만, 템플릿을 JSON에 저장할 수 없게 됩니다(TypeScript로 템플릿을 유지하는 전제)

먼저 문자열 표현식으로 어디까지 쓸 수 있는지를 파악하고, 부족할 때 콜백으로 넘어가는 것을 권장합니다.

### 표현식에서 참조할 수 있는 값

| 이름 | 내용 |
| --- | --- |
| `field.*` | 현재의 데이터 행. `field.customer.name`처럼 중첩하여 참조할 수 있음 |
| `vars.*` | 변수(뒤에 나오는 `variables`로 정의한 집계값). `var.*`로도 동일 |
| `param.*` | 리포트 전체의 값. 데이터 소스의 `parameters`로 전달한 값과 템플릿 `parameters`의 `defaultValue`. 서브리포트에서는 부모로부터 전달된 파라미터도 여기에 들어감 |
| `PAGE_NUMBER` | 현재의 페이지 번호(1부터 시작) |
| `COLUMN_NUMBER` | 현재의 칼럼 번호(1부터 시작) |
| `REPORT_COUNT` | 처리 완료된 데이터 행 수 |
| `TOTAL_PAGES` | 총 페이지 수. **그대로 참조하면 "그 시점까지의 페이지 수"가 되므로**, 최종적인 총 페이지 수를 인쇄하려면 `evaluationTime: 'report'` 또는 `'auto'`와 조합(후술) |

존재하지 않는 필드를 참조해도 예외가 되지 않고 `undefined`가 됩니다(`field.a.b`의 중간이 `null`이어도 안전하게 `null`이 반환됩니다).

### 문자열 표현식에서 사용할 수 있는 구문

| 분류 | 사용할 수 있는 것 |
| --- | --- |
| 리터럴 | 숫자(`1200`, `0.5`), 문자열(`'見積'` 또는 `"見積"`. `\n` 등의 이스케이프 대응), `true`／`false`／`null`／`undefined` |
| 템플릿 리터럴 | `` `合計 ${vars.total} 円` `` — `${}` 안에는 완전한 표현식을 쓸 수 있음 |
| 산술 | `+`(숫자의 덧셈과 문자열 연결), `-`, `*`, `/` |
| 비교 | `>`, `>=`, `<`, `<=`, `===`, `!==` |
| 논리 | `&&`, `\|\|`, `!`(JavaScript와 같은 단락 평가) |
| null 병합 | `??` — 왼쪽이 null/undefined일 때 오른쪽을 반환 |
| 조건(삼항) | `조건 ? 참일 때의 값 : 거짓일 때의 값` |
| 기타 | 단항 `-`／`+`, 괄호 `( )`, 점 표기법 멤버 액세스(프로퍼티 이름은 일본어 등도 가능: `field.顧客名`) |
| 내장 함수 | `format(값, 패턴)`=서식화(후술)／`round(값, 자릿수?)`=반올림／`roundUp`·`roundDown`·`roundHalfEven`(은행가 반올림)·`ceil`·`floor`·`trunc`(모두 두 번째 인수는 소수 자릿수, 생략 시 0)／`now()`=현재 시각 |

**사용할 수 없는 것**: `==`／`!=`(`===`／`!==`를 사용), `%`나 `**`, 브래킷 표기법(`field['a-b']`)과 배열 인덱스, 메서드 호출(`field.name.toUpperCase()`는 평가 시에 에러——호출할 수 있는 함수는 위의 내장 함수뿐), 대입, 함수 정의, `new`, 옵셔널 체이닝(`?.`——애초에 중간이 null이어도 예외가 되지 않으므로 불필요). 이것들이 필요한 경우는 콜백 표현식을 사용합니다.

이 제한은 안전을 위한 것입니다. 문자열 표현식은 자체 파서로 해석되어 코드로서 실행되는 일이 없으므로, 외부에서 받은 템플릿에 임의의 코드를 심을 수 없습니다.

### 계산한 결과를 인쇄하고 싶다

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 120, "height": 20,
  "expression": "round(field.price * field.quantity * (1 + field.taxRate), 0)",
  "pattern": "¥#,##0",
  "style": "amount"
}
```

데이터 예:

```json
{ "rows": [{ "price": 1200, "quantity": 3, "taxRate": 0.1 }] }
```

`¥3,960`이라고 인쇄됩니다.

### 문자열을 조립하고 싶다

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`${field.familyName} ${field.givenName ?? ''} 様`",
  "style": "body"
}
```

템플릿 리터럴의 `${}`에 끼워 넣은 값은 문자열화되어 연결됩니다. **null은 문자열 `"null"`이 되므로**, 빠져 있을 가능성이 있는 항목에는 예처럼 `?? ''`를 곁들입니다.

### 조건으로 표시를 전환하고 싶다

삼항 연산자로 인쇄 내용을 전환합니다.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 80, "height": 20,
  "expression": "field.stock > 0 ? '在庫あり' : '取り寄せ'",
  "style": "body"
}
```

"표시할 내용을 바꾸는" 것이 아니라 "표시할지 여부를 바꾸는" 경우는 전체 요소 공통의 `printWhenExpression`을 사용합니다("조건을 만족할 때만 요소를 인쇄하고 싶다" 참조). 스타일(색이나 굵게)을 조건에 따라 바꾸는 경우는 스타일 정의의 `conditionalStyles`에 같은 서법의 조건식을 지정합니다.

```json
{
  "name": "amount",
  "fontFamily": "jp", "fontSize": 10, "hAlign": "right",
  "conditionalStyles": [
    { "condition": "field.amount < 0", "forecolor": "#CC0000" }
  ]
}
```

### 숫자·날짜를 서식화하고 싶다 — `format`과 `pattern`

`textField`는 `pattern` 프로퍼티로 표현식의 평가 결과를 인쇄 시에 서식화할 수 있습니다. 표현식 안에서 부분적으로 서식화하고 싶을 때는 내장 함수 `format(값, 패턴)`을 사용합니다.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 300, "height": 20,
  "expression": "`発行日: ${format(now(), 'yyyy年M月d日')}`",
  "style": "body"
}
```

숫자 패턴은 `#`(자릿수가 있으면 표시)과 `0`(0 채움)과 `,`(3자리 구분)의 조합으로, 앞뒤에 접두사·접미사를 쓸 수 있습니다. 반올림 방식은 사사오입입니다.

| 패턴 | 입력 | 출력 |
| --- | --- | --- |
| `#,##0` | 1234567.8 | `1,234,568` |
| `#,##0.00` | 1234.5 | `1,234.50` |
| `¥#,##0` | 1980 | `¥1,980` |
| `0000` | 42 | `0042` |

날짜 패턴의 토큰은 `yyyy`(4자리 연도), `MM`／`M`(0 채움 월／월), `dd`／`d`(0 채움 일／일), `HH`(0 채움 시·24시간제), `mm`(분), `ss`(초)입니다. 값이 null/undefined일 때는 빈 문자열이 됩니다.

이것으로 부족한 서식(일본 연호, 요일, 통화의 자릿수 처리 등)은 템플릿의 `formatters`에 이름 있는 TypeScript 함수를 등록하고 `pattern`에 그 이름을 씁니다.

```ts
const template = {
  // ...
  formatters: {
    wareki: (value) => new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { dateStyle: 'long' }).format(value as Date),
  },
}
// 요소 쪽: { type: 'textField', expression: 'field.issuedAt', pattern: 'wareki', ... }
```

`pattern`은 등록된 포매터 이름을 먼저 찾고, 없으면 내장 서식으로 해석됩니다. 포매터는 함수이므로, 이 기능을 사용하는 템플릿은 JSON이 아니라 TypeScript로 유지합니다.

### 합계·평균·건수를 인쇄하고 싶다 — 변수(`variables`)

명세를 넘나드는 집계는 템플릿의 `variables`에 정의합니다. 변수는 데이터 행을 처리할 때마다 `expression`의 결과를 집계에 반영하며, 표현식에서는 `vars.이름`으로 현재 값을 참조할 수 있습니다.

```json
{
  "variables": [
    { "name": "pageTotal", "expression": "field.amount", "calculation": "sum", "resetType": "page" },
    { "name": "grandTotal", "expression": "field.amount", "calculation": "sum" }
  ]
}
```

`pageFooter` 밴드에 `"expression": "vars.pageTotal"`의 `textField`를 놓으면 페이지 소계, `summary` 밴드에 `"expression": "vars.grandTotal"`을 놓으면 총합계가 됩니다.

**프로퍼티 일람(`variables`의 각 요소)**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 변수 이름. 표현식에서 `vars.이름`으로 참조 |
| `expression` | Expression | ✓ | 행마다 평가되어 결과가 집계에 반영됨 |
| `calculation` | `'sum'`=합계 / `'average'`=평균 / `'count'`=건수 / `'distinctCount'`=중복을 제외한 건수 / `'min'`=최솟값 / `'max'`=최댓값 / `'first'`=첫 번째 값 / `'nothing'`=매 행 덮어쓰기(마지막 값) | ✓ | 집계 방법 |
| `resetType` | `'report'`=리포트 전체에서 계속 집계(리셋 없음·기본) / `'page'`=페이지마다 리셋 / `'column'`=칼럼마다 리셋 / `'group'`=`resetGroup`의 그룹마다 리셋 / `'none'`=리셋하지 않는 점은 `'report'`와 같지만, 지연 평가(`evaluationTime`)에서도 요소를 배치한 시점의 값 그대로 확정됨(나중에 최종 집계값으로 바뀌지 않음) |  | 집계의 리셋 단위 |
| `resetGroup` | string |  | `resetType: 'group'`일 때의 대상 그룹 이름 |
| `incrementCondition` | Expression |  | 지정 시, 평가 결과가 거짓인 행은 집계에 반영하지 않음(조건부 집계) |
| `initialValue` | Expression |  | 초기화·리셋 시의 초깃값 |

`incrementCondition`을 사용하면 "특정 구분만 합계한다" 같은 조건부 집계를 하나의 변수로 쓸 수 있습니다:

```json
{ "name": "urgentCount", "expression": "field.id", "calculation": "count", "incrementCondition": "field.urgent" }
```

참고로, 서브리포트의 실행 결과를 부모에서 집계하고 싶은 경우는 `subreport` 요소의 `returnValues`가 자식의 변수를 부모의 `vars.*`로 되돌려 씁니다(`subreport`의 프로퍼티 일람 참조).

### 페이지 번호·총 페이지 수를 인쇄하고 싶다

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

포인트는 `evaluationTime: 'auto'`입니다. 표현식은 보통 요소를 배치한 순간에 평가되지만, 그 시점에서는 최종적인 총 페이지 수를 아직 알 수 없습니다. `'auto'`를 지정하면 표현식을 정적 해석하여 `PAGE_NUMBER`는 페이지 확정 시, `TOTAL_PAGES`는 리포트 완료 시라는 식으로 **참조마다 올바른 타이밍에 평가**합니다. `'auto'`는 표현식을 해석할 필요가 있으므로 문자열 표현식 전용입니다(콜백 표현식에 지정하면 예외가 됩니다).

### 문자열 표현식으로 할 수 없는 것을 쓰고 싶다 — 콜백 표현식

템플릿을 TypeScript로 정의하고 있다면 `Expression`을 받는 모든 곳에 함수를 그대로 쓸 수 있습니다. 인수는 `(field, vars, param, report)`의 4개로, `report`에서 `PAGE_NUMBER` 등의 내장값과 `format` 함수, 등록된 `formatters`를 참조할 수 있습니다.

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

메서드 호출·정규 표현식·외부 함수의 이용 등 TypeScript로 쓸 수 있는 것은 모두 쓸 수 있습니다. 트레이드오프는 두 가지——템플릿을 JSON으로 저장·전송할 수 없게 되는 것, `evaluationTime: 'auto'`를 사용할 수 없는 것(`'report'` 등의 명시 지정은 사용할 수 있습니다)입니다.

### 표현식이 에러가 되었을 때의 동작

- **구문 에러·금지 구문**(메서드 호출 등)은 위치 정보가 붙은 `ExpressionLanguageError`를 스로우하며, 그대로 `createReport()`의 호출자에게 전파됩니다. 뭉개져서 빈칸이 되는 일은 없습니다
- **존재하지 않는 필드·변수의 참조**는 에러가 되지 않고 `undefined`로 평가됩니다. `textField`에서는 `blankWhenNull: true`를 지정했다면 빈칸, 지정이 없으면 문자열 `null`이 인쇄됩니다
- 사용자 입력의 표현식을 실행 전에 검증하고 싶은 경우는 `validateExpressionSource(source)`가 구문 검사 결과(에러 또는 `null`)를 반환합니다

## 전체 리포트 요소의 구현 샘플

`ElementDef`가 제공하는 전체 16개 요소를 다음에 보입니다. 모든 요소에서 `x`, `y`, `width`, `height`(단위는 pt, 1pt = 1/72인치)를 지정하고 밴드 또는 `frame`의 `elements`에 배치합니다.

| 하고 싶은 것 | 요소 |
| --- | --- |
| 고정된 문자열을 인쇄한다 | `staticText` |
| 데이터·변수·표현식의 결과를 인쇄한다 | `textField` |
| 괘선을 긋는다 | `line` |
| 사각형·둥근 모서리 테두리를 그린다 | `rectangle` |
| 원·타원을 그린다 | `ellipse` |
| 임의의 벡터 도형을 그린다 | `path` |
| 이미지를 배치한다 | `image` |
| 여러 요소를 묶어 테두리로 감싼다 | `frame` |
| 표를 인쇄한다 | `table` |
| 크로스 집계표를 인쇄한다 | `crosstab` |
| 리포트 안에 다른 리포트를 끼워 넣는다 | `subreport` |
| 바코드·QR 코드를 인쇄한다 | `barcode` |
| 수식을 인쇄한다 | `math` |
| SVG를 인쇄한다 | `svg` |
| 입력할 수 있는 PDF 폼을 만든다 | `formField` |
| 임의의 위치에서 페이지 나눔·칼럼 나눔을 한다 | `break` |
| 조건을 만족할 때만 요소를 인쇄한다 | `printWhenExpression`(전체 요소 공통의 속성) |

이하, 요소 하나마다 하나씩, 밴드의 `elements` 배열에 그대로 놓을 수 있는 정의와, 표현식을 사용하는 요소에는 대응하는 데이터 예를 보입니다. 아울러 각 요소의 절 말미에 그 요소 고유의 프로퍼티 일람을 실었습니다. 전체 요소에 공통되는 프로퍼티(위치·색·인쇄 조건 등)와 스타일의 프로퍼티는 뒤에 나오는 "요소 프로퍼티 레퍼런스"를 참조해 주십시오.

### 고정된 문자열을 인쇄하고 싶다 — `staticText`

템플릿에 쓴 문자열을 그대로 인쇄합니다. 제목이나 라벨에 사용합니다.

```json
{
  "type": "staticText",
  "x": 0, "y": 0, "width": 150, "height": 24,
  "text": "固定テキスト",
  "style": "body"
}
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'staticText'` | ✓ | 요소 종별 |
| `text` | string | ✓ | 인쇄할 고정 문자열 |
| `actualText` | string |  | 겉모습의 문자와, 복사·검색으로 추출되는 텍스트가 다른 경우의 치환 텍스트(PDF의 /ActualText). 주로 PDF 가져오기가 원본 PDF의 지정을 유지하기 위해 사용 |
| `hyperlink` | HyperlinkDef |  | 하이퍼링크(공통 프로퍼티 절의 **`HyperlinkDef`** 참조) |
| `anchorName` | string |  | 앵커 이름. 책갈피나 문서 내 링크(`hyperlink`의 `'localAnchor'`)의 도달 지점으로 등록됨 |
| `bookmarkLevel` | number |  | PDF 뷰어의 사이드바에 표시되는 목차(책갈피)에 이 요소의 텍스트를 올릴 때의 계층 레벨(1이 최상위, 1〜6) |

※ 이 밖에 전체 요소 공통 프로퍼티와 `TextProperties`의 전체 프로퍼티를 지정 가능.

### 데이터나 표현식의 결과를 인쇄하고 싶다 — `textField`

`expression`의 평가 결과를 인쇄합니다. `field.*`(데이터), `vars.*`(변수), `param.*`(파라미터), `PAGE_NUMBER` 등을 참조할 수 있고, 템플릿 리터럴로 문자열을 조립할 수 있습니다. 표현식 작성법의 전체는 "표현식(Expression)을 활용하기"를 참조해 주십시오. `pattern`으로 숫자·날짜의 서식을, `stretchWithOverflow`로 문자량에 따른 높이의 늘어남을 지정합니다.

```json
{
  "type": "textField",
  "x": 0, "y": 0, "width": 350, "height": 24,
  "expression": "`${field.customer} 様`",
  "style": "body",
  "stretchWithOverflow": true
}
```

데이터 예:

```json
{ "rows": [{ "customer": "サンプル商事" }] }
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'textField'` | ✓ | 요소 종별 |
| `expression` | Expression | ✓ | 인쇄할 값을 반환하는 표현식 |
| `pattern` | string |  | 포맷 패턴. 템플릿에 등록된 커스텀 포매터(`formatters`의 패턴 이름)를 우선하고, 없으면 내장 포매터로 정형 |
| `blankWhenNull` | boolean |  | 표현식의 결과가 null/undefined일 때 빈 문자열로 함(미지정 시는 문자열 `'null'`이 인쇄됨) |
| `stretchWithOverflow` | boolean |  | 내용이 height에 다 들어가지 않을 때 요소의 높이를 내용에 맞추어 늘림 |
| `evaluationTime` | `'now'`=그 자리에서 즉시 평가(기본) / `'band'`=밴드 확정 시에 평가 / `'column'`=칼럼 종료 시에 평가 / `'page'`=페이지 종료 시에 평가 / `'group'`=`evaluationGroup`의 그룹 확정 시에 평가 / `'report'`=리포트 종료 시에 평가(TOTAL_PAGES 등이 확정) / `'auto'`=표현식이 참조하는 각 변수·내장값을 각각의 리셋 타이밍에 개별적으로 평가(문자열 표현식만. 콜백 표현식은 예외를 던짐) |  | 표현식의 평가 타이밍. 기본 이외를 지정하면 배치 시에는 일단 빈 채로 영역을 확보하고, 해당 타이밍의 값이 확정된 시점에 채워 넣어짐. 전형적인 예: 그룹 합계를 그룹의 선두에 미리 내보내기(`'group'`), 최종적인 총 페이지 수를 인쇄(`'report'`) |
| `evaluationGroup` | string |  | `evaluationTime: 'group'`일 때의 대상 그룹 이름 |
| `textTruncate` | `'none'`=다 들어가지 않는 행을 그리지 않음(기본. 현행 구현에서는 `'truncate'`와 동일 동작) / `'truncate'`=다 들어가지 않는 행을 행 단위로 잘라 버림 / `'ellipsisChar'`=마지막 행의 문자 경계에서 잘라내고 `...`를 부가 / `'ellipsisWord'`=마지막 행의 단어 경계에서 잘라내고 `...`를 부가 |  | `stretchWithOverflow` 비활성 시 높이에 다 들어가지 않는 텍스트의 취급. 기본: `none` |
| `hyperlink` | HyperlinkDef |  | 하이퍼링크(공통 프로퍼티 절의 **`HyperlinkDef`** 참조) |
| `anchorName` | string |  | 앵커 이름. 책갈피나 문서 내 링크(`hyperlink`의 `'localAnchor'`)의 도달 지점으로 등록됨 |
| `bookmarkLevel` | number |  | PDF 뷰어의 사이드바에 표시되는 목차(책갈피)에 이 요소의 텍스트를 올릴 때의 계층 레벨(1이 최상위, 1〜6) |

※ 이 밖에 전체 요소 공통 프로퍼티와 `TextProperties`의 전체 프로퍼티를 지정 가능. `isPrintRepeatedValues: false`는 이 요소에서 유효(동일 값의 연속 인쇄를 억제).

### 괘선을 긋고 싶다 — `line`

이 예는 높이 0의 수평 괘선입니다. `lineStyle`에는 `solid` 외에 `dashed` 등을 지정할 수 있습니다.

```json
{
  "type": "line",
  "x": 0, "y": 0, "width": 350, "height": 0,
  "lineWidth": 1,
  "lineStyle": "dashed",
  "lineColor": "#4B5563"
}
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'line'` | ✓ | 요소 종별. 선분은 요소의 왼쪽 위 `(x, y)`에서 오른쪽 아래 `(x+width, y+height)`로 그려짐(`height: 0`으로 수평선, `width: 0`으로 수직선, 양쪽 다 0이 아니면 대각선) |
| `lineWidth` | number |  | 선 너비(pt). 기본: 1 |
| `lineStyle` | `'solid'`=실선 / `'dashed'`=파선 / `'dotted'`=점선 |  | 선 종류. 기본: 실선 |
| `lineColor` | string |  | 선 색. 기본: 요소의 `forecolor`, 그것도 없으면 `#000000` |

### 사각형·둥근 모서리 테두리를 그리고 싶다 — `rectangle`

`cornerRadii`로 네 모서리의 둥글기를 개별적으로 지정할 수 있습니다.

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

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'rectangle'` | ✓ | 요소 종별 |
| `radius` | number |  | 둥근 모서리 반지름(pt. 네 모서리 공통) |
| `cornerRadii` | { topLeft?, topRight?, bottomRight?, bottomLeft?: number } |  | 모서리별 둥근 모서리 반지름(pt) |
| `fill` | FillDef |  | 채우기(공통 프로퍼티 절의 **`FillDef`** 참조). 기본: 스타일의 `backcolor`(`transparent` 이외일 때) |
| `stroke` | string |  | 테두리 색. 기본: 스타일의 `forecolor` |
| `strokeWidth` | number |  | 테두리 너비(pt). 기본: 1 |

### 원·타원을 그리고 싶다 — `ellipse`

틀의 너비·높이에 내접하는 타원을 그립니다.

```json
{
  "type": "ellipse",
  "x": 0, "y": 0, "width": 80, "height": 60,
  "fill": "#FCE7F3",
  "stroke": "#BE185D",
  "strokeWidth": 1
}
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'ellipse'` | ✓ | 요소 종별. 요소의 경계 박스에 내접하는 타원(중심 `(x+width/2, y+height/2)`, 반지름 `width/2`×`height/2`)을 그림 |
| `fill` | FillDef |  | 채우기(공통 프로퍼티 절의 **`FillDef`** 참조). 미지정 시는 채우기 없음 |
| `stroke` | string |  | 테두리 색. 미지정 시는 테두리 없음 |
| `strokeWidth` | number |  | 테두리 너비(pt). 기본: 1(`stroke` 지정 시) |

### 임의의 벡터 도형을 그리고 싶다 — `path`

`d`에 SVG의 패스 구문을, `viewBox`에 그 좌표계를 지정합니다. 도형은 요소의 틀에 맞추어 확대·축소됩니다.

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

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'path'` | ✓ | 요소 종별 |
| `d` | string | ✓ | SVG 패스 데이터(M/L/C/Z 등). 좌표는 요소 로컬 pt |
| `pdfSourceVector` | PdfSourceVectorDef |  | PDF 가져오기가, 반복해서 나타나는 동일 도형(지도 기호 등)을 "정의 1회+배치 N회"의 형태로 보전한 것(뒤에 나오는 **`PdfSourceVectorDef`** 참조). 지정 시는 `d`의 파싱 처리를 하지 않음. 손으로 쓰는 템플릿에서는 지정 불필요 |
| `affineTransform` | [number, number, number, number, number, number] |  | 그리기 전에 패스 좌표를 요소 로컬 좌표로 옮기는 아핀 변환 행렬. `[a, b, c, d, e, f]`로 `x' = a·x + c·y + e, y' = b·x + d·y + f` |
| `viewBox` | [number, number, number, number] |  | `[minX, minY, 너비, 높이]`. 패스 좌표를 이 영역에서 요소의 너비·높이로 스케일링 |
| `fill` | FillDef |  | 채우기(공통 프로퍼티 절의 **`FillDef`** 참조). 미지정 시는 채우기 없음 |
| `fillRule` | `'nonzero'`(기본) / `'evenodd'` |  | 자기 교차하는 패스나 중첩된 패스에서 어디를 "안쪽"으로 하여 채울지의 판정 규칙. 도넛 모양으로 구멍을 뚫고 싶은 경우는 `'evenodd'`가 확실 |
| `fillOpacity` | number |  | 채우기의 불투명도(0.0〜1.0) |
| `stroke` | FillDef |  | 스트로크(단색 외에 그라디언트 등도 지정 가능). 미지정 시는 스트로크 없음 |
| `strokeWidth` | number |  | 스트로크 너비(pt). 기본: 1(`stroke` 지정 시) |
| `strokeOpacity` | number |  | 스트로크의 불투명도(0.0〜1.0) |
| `strokeLinecap` | `'butt'`=끝에서 자름 / `'round'`=둥근 끝 / `'square'`=사각 끝(선 너비의 절반만큼 연장) |  | 선 끝 형상 |
| `strokeLinejoin` | `'miter'`=마이터(뾰족함) / `'round'`=둥글림 / `'bevel'`=모따기 |  | 선의 접합 형상 |
| `strokeMiterLimit` | number |  | 마이터 한계값. 기본: 10 |
| `strokeDasharray` | number[] |  | 파선 패턴(선분과 간격의 길이 배열, pt) |
| `strokeDashoffset` | number |  | 파선 패턴의 시작 오프셋(pt) |

### 이미지를 배치하고 싶다 — `image`

`sourceExpression`(표현식) 또는 `source`(고정값)로 이미지를 지정합니다. `scaleMode`로 틀에 담는 방식을, `onError`로 이미지를 찾을 수 없을 때의 동작(`error`=에러로 함 / `blank`=공백 / `icon`=아이콘 표시)을 선택합니다.

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

데이터 예:

```json
{ "rows": [{ "logoPath": "assets/logo.png" }] }
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'image'` | ✓ | 요소 종별 |
| `source` | string | | 고정된 이미지 참조(이미지 ID). `.report` 기준의 상대 경로·절대 경로·URL·data URI 등을 그대로 씀(ID의 규칙은 뒤에 나오는 "리소스 읽기의 제한과 이미지 ID의 규칙" 참조). `sourceExpression`이 미지정이거나 평가 결과가 미해결인 경우에 사용됨 |
| `sourceExpression` | Expression | | 동적인 이미지 소스 표현식. 결과가 문자열이면 이미지 ID로 해석되고, `Uint8Array`이면 이미지 데이터 그 자체로 취급됨 |
| `scaleMode` | `'clip'` \| `'fillFrame'` \| `'retainShape'` \| `'realSize'` | | 이미지의 확대·축소 방법. `'clip'`=이미지를 원본 크기 그대로 배치하고 요소 틀로 클립／`'fillFrame'`=가로세로 비율을 무시하고 요소 틀 가득 변형 확대·축소／`'retainShape'`=가로세로 비율을 유지하며 틀 안에 들어가는 최대 배율로 확대·축소／`'realSize'`=원본 크기 배치+틀 클립(구현상 `'clip'`과 동일 처리). 기본: `'retainShape'`. 참고로 이미지 크기를 얻을 수 없는 경우는 `'fillFrame'`과 같은 동작이 됨 |
| `hAlign` | `'left'` \| `'center'` \| `'right'` | | 틀 안에서의 이미지의 수평 배치(`retainShape`의 여백 배치, `clip`/`realSize`의 잘라내기 위치에 작용). 기본: `'left'` |
| `vAlign` | `'top'` \| `'middle'` \| `'bottom'` | | 틀 안에서의 이미지의 수직 배치. 기본: `'top'` |
| `onError` | `'error'` \| `'blank'` \| `'icon'` | | 이미지 소스 미정의·해석 실패 시의 동작. `'error'`=예외를 스로우／`'blank'`=아무것도 그리지 않음／`'icon'`=회색 틀과 × 표시의 플레이스홀더를 그림. 기본: `'icon'` |
| `lazy` | boolean | | 타입 정의만 존재하며 현행 레이아웃 엔진·렌더러 구현에서는 참조되지 않음(사양 미기재) |
| `rotation` | `0` \| `90` \| `180` \| `270` | | 이미지의 회전각(도) |
| `affineTransform` | [number, number, number, number, number, number] | | 배치를 행렬로 직접 지정하는 대체 수단. `[a, b, c, d, e, f]`는 단위 정사각형(0〜1)의 이미지를 `x' = a·x + c·y + e, y' = b·x + d·y + f`로 옮기는 변환으로, 지정 시는 `scaleMode`/`hAlign`/`vAlign`/`rotation`에 의한 배치 계산을 하지 않음. 주로 PDF 가져오기가 원래의 배치를 보전하기 위해 사용 |
| `opacity` | number | | 불투명도(0.0〜1.0) |
| `interpolate` | boolean | | 저해상도 이미지를 확대했을 때 뷰어가 픽셀의 경계를 매끄럽게 보간하여 표시(PDF의 /Interpolate). 사진에서는 유효가, 바코드 등 뚜렷하게 표시하고 싶은 이미지에서는 무효가 적절 |
| `alternates` | PdfImageAlternateDef[] |  | 화면 표시용과 인쇄용으로 다른 이미지를 구분해 사용하는 PDF의 대체 이미지(/Alternates). 각 요소는 `source`=대체 이미지의 참조(필수)와 `defaultForPrinting`=인쇄 시 이쪽을 사용할지, 의 2개 프로퍼티 |
| `opi` | PdfOpiMetadataDef |  | 상업 인쇄에서 저해상도 플레이스홀더 이미지를 출력 시에 고해상도 이미지로 교체하기 위한 OPI 정보. 주로 PDF 가져오기의 보전용(뒤에 나오는 **`PdfOpiMetadataDef`** 참조) |
| `measure` | PdfMeasurement |  | 도면·지도 PDF에서 뷰어의 계측 도구가 사용하는 축척·좌표계 정보. 주로 PDF 가져오기의 보전용(뒤에 나오는 **`PdfMeasurement`** 참조) |
| `pointData` | PdfPointData[] |  | 지도 PDF의 점군 데이터(위도·경도 등). 주로 PDF 가져오기의 보전용(뒤에 나오는 **`PdfPointData`** 참조) |
| `hyperlink` | HyperlinkDef | | 하이퍼링크(`type`: `'reference'`=URL／`'localAnchor'`=문서 내 앵커／`'localPage'`=문서 내 페이지／`'remoteAnchor'`·`'remotePage'`=외부 PDF 내 앵커·페이지, `target`: 링크 대상의 표현식, `remoteDocument?`: 외부 PDF 경로의 표현식) |

### 여러 요소를 묶어 테두리로 감싸고 싶다 — `frame`

자식 요소를 그룹화하고 `border`로 테두리, `clip`으로 삐져나온 부분의 잘라내기를 지정할 수 있습니다. 자식 요소의 좌표는 `frame`의 왼쪽 위가 원점입니다.

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

데이터 예:

```json
{ "rows": [{ "note": "frameの子要素に表示する備考です" }] }
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'frame'` | ✓ | 요소 종별 |
| `clip` | boolean | | 자식 요소를 프레임 경계에서 클립할지. 기본: true |
| `border` | BorderDef | | 테두리(공통 프로퍼티 절의 **`BorderDef`** 참조) |
| `padding` | Padding | | 안쪽 여백(`top?`/`bottom?`/`left?`/`right?`, 각 pt) |
| `rotation` | number | | 프레임의 회전각(도, 페이지 좌표에서 반시계 방향) |
| `rotationOriginX` | number | | 회전 원점 X(프레임 상대, pt). 기본: 0 |
| `rotationOriginY` | number | | 회전 원점 Y(프레임 상대, pt). 기본: 0 |
| `affineTransform` | [number, number, number, number, number, number] | | Y축이 위를 향하는 프레임 로컬 좌표를 부모 좌표 공간으로 옮기는 아핀 행렬(행렬의 배열과 의미는 `image`의 `affineTransform`과 동일). 주로 PDF 가져오기가 원래의 배치를 보전하기 위해 사용 |
| `pdfForm` | PdfFormXObjectDef |  | PDF 가져오기에서, 원본 PDF의 부품(Form XObject)이 가지고 있던 좌표계·메타데이터를 유지하여 재출력(뒤에 나오는 **`PdfFormXObjectDef`** 참조). 손으로 쓰는 템플릿에서는 지정 불필요 |
| `hyperlink` | HyperlinkDef | | 하이퍼링크(image의 동명 프로퍼티와 동일 구조) |
| `clipPath` | { d: string, fillRule?: `'nonzero'` \| `'evenodd'` } | | SVG 패스 구문에 의한 클립 패스. `d`=패스 데이터, `fillRule`=채우기 규칙 |
| `transparencyGroup` | boolean | | `isolated`/`knockout`이 모두 무효여도 PDF의 투명 그룹 경계를 유지. 유지하면 불투명도·블렌드의 합성 결과가, 프레임을 한 장의 그림으로 합성한 경우와 동일하게 유지됨(주로 PDF 가져오기의 재현용) |
| `isolated` | boolean | | 분리 투명 그룹(PDF /Group /I). 이것(또는 `knockout` / `softMask`)이 설정되면 프레임은 일체로 합성된 뒤에 불투명도·블렌드·마스크가 적용됨 |
| `knockout` | boolean | | 녹아웃 투명 그룹(PDF /Group /K). 그룹 안에서 겹친 자식 요소끼리는 서로 비치지 않고, 각 위치에서 최전면의 자식 요소만이 배경과 합성됨 |
| `softMask` | FrameSoftMaskDef | | 프레임을 부분적으로 투명화하는 소프트 마스크(아래 표 **`FrameSoftMaskDef`** 참조). `elements`의 그리기 결과를 "투과율의 지도"로 사용하여, 그라디언트로 서서히 사라져 가는 듯한 표현이 가능 |
| `deviceParams` | DeviceParamsDef | | 상업 인쇄의 제판 공정용 파라미터(아래 표 **`DeviceParamsDef`** 참조). 일반적인 리포트에서는 지정 불필요하며, 주로 PDF 가져오기가 원본 PDF의 지정을 보전하기 위해 사용 |
| `elements` | ElementDef[] | | 프레임 안의 자식 요소 |

**`FrameSoftMaskDef`**(`softMask`의 구조)
| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'luminosity'` \| `'alpha'` | ✓ | 마스크 종별. `'luminosity'`=마스크의 밝은 부분일수록 프레임이 불투명해짐／`'alpha'`=마스크의 불투명한 부분일수록 프레임이 불투명해짐 |
| `colorSpace` | PdfProcessColorSpaceDef | | 소프트 마스크 투명 그룹의 블렌드 색 공간 |
| `isolated` | boolean | | 소프트 마스크 투명 그룹의 분리 플래그 |
| `knockout` | boolean | | 소프트 마스크 투명 그룹의 녹아웃 플래그 |
| `backdrop` | [number, number, number] | | 휘도 마스크용 /BC 배경색(DeviceRGB 0〜1). 기본: 검정 |
| `elements` | ElementDef[] | ✓ | 투명 그룹으로 합성하여 마스크를 정의하는 요소군 |
| `transferFunction` | `'Identity'` \| TransferFunctionDef | | 마스크 값(0..1)을 재매핑하는 /SMask /TR 전송 함수 |

**`DeviceParamsDef`**(`deviceParams`의 구조. 상업 인쇄의 제판용으로 보통은 지정 불필요——주로 PDF 가져오기의 보전용)
| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `transferFunction` | `'Identity'` \| `'Default'` \| TransferFunctionDef \| TransferFunctionDef[] | | /TR 전송 함수. `'Identity'`／`'Default'`／전체 색판 공통의 단일 함수／4색판별 함수 배열 |
| `blackGeneration` | `'Default'` \| CalculatorFunctionDef | | /BG 먹 생성 함수(`'Default'`=/BG2에 의한 디바이스 기본) |
| `undercolorRemoval` | `'Default'` \| CalculatorFunctionDef | | /UCR 하색 제거 함수(`'Default'`=/UCR2에 의한 디바이스 기본) |
| `halftone` | `'Default'` \| HalftoneDef | | /HT 하프톤(type 1 스크린／type 6·10·16 임곗값 배열／type 5 색판별 컬렉션) |
| `halftoneOrigin` | [number, number] | | PDF 2.0 하프톤 원점(/HTO, 디바이스 공간 픽셀) |
| `useBlackPointCompensation` | `'on'` \| `'off'` \| `'default'` | | PDF 2.0 흑점 보상 제어(/UseBlackPtComp) |
| `flatness` | number | | 평활화 허용 오차(/FL) |
| `smoothness` | number | | 셰이딩 평활도 허용 오차(/SM) |
| `strokeAdjustment` | boolean | | 자동 스트로크 조정(/SA) |

### 표를 인쇄하고 싶다 — `table`

헤더 행·명세 행·푸터 행을 가지는 표입니다. `dataSourceExpression`으로 행 데이터의 배열을 전달하면 명세 행이 배열의 요소 수만큼 반복됩니다.

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

데이터 예(`items`의 각 요소가 표의 명세 1행이 됩니다):

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

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'table'` | ✓ | 요소 종별 |
| `columns` | TableColumnElementDef[] | ✓ | 열 정의의 배열. 전체 열의 `width` 합계가 요소의 너비와 다른 경우, 요소 너비에 딱 맞도록 전체 열이 비례 스케일링됨 |
| `headerRows` | TableRowElementDef[] |  | 헤더 행의 배열. 페이지 나눔 분할 시는 각 페이지의 선두에서 반복해 그려짐 |
| `detailRows` | TableRowElementDef[] |  | 명세 행의 배열. 데이터 행 1건마다 반복해 그려짐(데이터 행 × detailRows의 전체 행) |
| `footerRows` | TableRowElementDef[] |  | 푸터 행의 배열. 페이지 나눔 분할 시는 마지막 페이지에만 그려짐 |
| `dataSourceExpression` | Expression |  | 평가 결과의 배열을 이 테이블의 데이터 행으로 사용. 생략 시는 메인 데이터 소스의 행을 사용. 배열 이외로 평가된 경우는 예외를 송출 |

**`TableColumnElementDef`**(`columns`의 각 요소=열 정의)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 열 너비(pt). 전체 열 합계가 요소 너비와 일치하지 않는 경우는 비례 배분됨 |
| `style` | TableCellStyleDef |  | 이 열의 기본 셀 스타일. 셀 쪽에서 동명의 프로퍼티가 지정된 경우는 셀 쪽이 우선됨(괘선은 변 단위로 병합) |

**`TableRowElementDef`**(`headerRows`/`detailRows`/`footerRows`의 각 요소=행 정의)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 행 높이(pt). 최솟값으로 취급되며, 텍스트 줄바꿈이나 셀 내 자식 요소가 다 들어가지 않는 경우는 자동 확장됨(rowSpan 셀의 내용 초과분은 결합 범위의 마지막 행이 확장됨) |
| `cells` | TableCellElementDef[] | ✓ | 이 행의 셀 정의의 배열. 위 행의 `rowSpan`에 의해 점유되어 있는 열은 자동으로 건너뛰고 배치됨 |

**`TableCellElementDef`**(`cells`의 각 요소=셀 정의. 아래에 더해 `TableCellStyleDef`의 전체 프로퍼티를 직접 지정 가능)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `text` | string |  | 셀의 고정 텍스트 |
| `expression` | Expression |  | 데이터 바인딩용의 표현식. `field.이름` 단독 형식은 데이터 행에서 직접 값을 취득하고, 그 이외는 엔진의 표현식 평가로 해결. 지정 시는 `text`보다 우선 |
| `colSpan` | number |  | 가로 방향으로 결합할 열 수. 기본: 1 |
| `rowSpan` | number |  | 세로 방향으로 결합할 행 수. 기본: 1. 셀 높이는 결합 범위의 행 높이 합계가 됨 |
| `elements` | ElementDef[] |  | 셀 안에 배치할 자식 요소의 배열. 지정 시는 `text`/`expression`의 그리기보다 우선되며, 패딩을 제외한 영역에 클립하여 그려짐. 행 높이는 자식 요소의 필요 높이에 맞추어 자동 확장됨 |

**`TableCellStyleDef`**(셀 정의 및 열의 `style`에서 사용하는 셀 스타일)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `hAlign` | `'left'`=왼쪽 정렬 / `'center'`=가운데 정렬 / `'right'`=오른쪽 정렬 |  | 수평 방향의 문자 정렬 |
| `vAlign` | `'top'`=위 정렬 / `'middle'`=가운데 정렬 / `'bottom'`=아래 정렬 |  | 수직 방향의 문자 정렬 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 텍스트 회전(도). 기본: 0 |
| `backcolor` | string |  | 셀 배경색 |
| `forecolor` | string |  | 문자 색. 기본: `#000000` |
| `fontId` | string |  | 폰트 ID. 기본: `'default'` |
| `fontSize` | number |  | 폰트 크기(pt). 기본: 10 |
| `bold` | boolean |  | 굵게 |
| `italic` | boolean |  | 기울임 |
| `underline` | boolean |  | 밑줄 |
| `strikethrough` | boolean |  | 취소선 |
| `lineSpacing` | LineSpacingDef |  | 행간 설정(공통 프로퍼티 절의 **`LineSpacingDef`** 참조) |
| `letterSpacing` | number |  | 자간(pt). 모든 문자 사이에 고정량을 추가(음수로 좁힘) |
| `wordSpacing` | number |  | 어간(pt. 공백 문자에 추가되는 너비) |
| `firstLineIndent` | number |  | 1행째의 들여쓰기(pt) |
| `leftIndent` | number |  | 왼쪽 들여쓰기(pt) |
| `rightIndent` | number |  | 오른쪽 들여쓰기(pt) |
| `wrap` | boolean |  | 텍스트 줄바꿈. 기본: true |
| `shrinkToFit` | boolean |  | 셀에 들어가도록 폰트 크기를 자동 축소 |
| `minFontSize` | number |  | `shrinkToFit` 시의 최소 폰트 크기(pt). 기본: 4 |
| `fitWidth` | boolean |  | 가장 긴 행이 셀 너비에 딱 들어가도록 폰트 크기를 자동 조정(축소·확대의 양방향). 이 셀은 행 높이의 자동 확장에 기여하지 않음 |
| `outlineText` | boolean |  | 텍스트를 아웃라인(패스)화하여 그림 |
| `padding` | number |  | 셀 내 패딩(pt). 기본: 2 |
| `border` | BorderDef |  | 셀 단위의 괘선(공통 프로퍼티 절의 **`BorderDef`** 참조). 열 `style`의 괘선과 병합되며 셀 쪽의 지정이 우선됨 |
| `opacity` | number |  | 불투명도(0.0〜1.0). 1 미만인 경우 셀 전체가 불투명도 그룹으로 그려짐 |

### 크로스 집계표를 인쇄하고 싶다 — `crosstab`

행 그룹×열 그룹으로 데이터를 집계합니다. 이 예는 "지역×분류"로 `amount`를 합계하고, 소계와 총계도 출력합니다.

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

데이터 예:

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

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'crosstab'` | ✓ | 요소 종별 |
| `rowGroups` | { field, headerFormat? }[] | ✓ | 행 그룹 정의의 배열. 여러 개 지정하면 다계층 그룹이 되며, 각 계층이 왼쪽부터 1열씩 행 헤더 열을 점유. 바깥쪽 그룹의 헤더 셀은 대상 범위에 걸쳐 세로 결합됨 |
| `columnGroups` | { field, headerFormat? }[] | ✓ | 열 그룹 정의의 배열. 바깥쪽 그룹이 위, 안쪽 그룹이 아래로 쌓이며, 바깥쪽 헤더는 대상 열 너비에 걸쳐 가로 결합됨 |
| `measures` | { field, calculation, format? }[] | ✓ | 메저(집계 셀) 정의의 배열. 여러 개 지정 시는 데이터 셀 안에 세로로 쌓아 표시되고, 각 메저가 1슬롯(최저 `cellHeight`)을 점유하며 개별적으로 `calculation`/`format`을 적용. 빈 배열의 경우는 `field: ''`·`calculation: 'sum'`의 암묵적 1건으로 취급됨 |
| `rowHeaderWidth` | number |  | 행 헤더 너비(pt). 행 그룹의 각 계층에 적용됨. 기본: 80 |
| `columnHeaderHeight` | number |  | 열 헤더 높이(pt). 열 그룹의 각 계층에 적용됨. 기본: 20 |
| `cellWidth` | number |  | 데이터 셀 너비(pt). 기본: 60 |
| `cellHeight` | number |  | 데이터 셀 높이(pt, 메저 1건분의 슬롯 높이). 텍스트 줄바꿈에 따라 자동 확장됨. 기본: 20 |
| `border` | { color?, width? } |  | 괘선 설정(아래 표 참조). 지정 시에만 바깥 테두리·행/열 구분선·헤더 계층의 구분선을 그림(결합된 바깥쪽 헤더 셀을 가로지르지 않음) |
| `showSubtotals` | boolean |  | 소계의 표시. 기본: false. true인 경우, 최내층을 제외한 각 그룹의 블록 말미에 "Total" 라벨의 소계 행/열을 삽입. 소계값은 원시값으로부터 각 메저의 `calculation`으로 재집계됨 |
| `showGrandTotal` | boolean |  | 총계의 표시. 기본: false. true인 경우, 말미에 "Total" 라벨의 총계 행/열을 추가(데이터 0건 시는 출력되지 않음). 총계값도 원시값으로부터 재집계됨 |
| `dataSourceExpression` | Expression |  | 평가 결과의 배열을 이 크로스 집계의 데이터 행으로 사용. 생략 시(또는 평가 결과가 배열이 아닌 경우)는 메인 데이터 소스의 행을 사용 |

**행/열 그룹 정의(`rowGroups`/`columnGroups`의 각 요소)**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 그룹화에 사용할 필드 이름. 데이터 안의 출현 순으로 그룹이 나열됨 |
| `headerFormat` | string |  | 헤더 값의 표시 포맷. 값이 숫자인 경우에만 적용되는 간이 서식(`'#,##0'` 또는 `,`를 포함→자릿수 구분 표시, `'.00'` 같은 소수 지정→그 자릿수로 고정 소수 표시, 그 이외→그대로 문자열화) |

**메저 정의(`measures`의 각 요소)**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `field` | string | ✓ | 집계 대상의 필드 이름. 숫자 이외의 값은 숫자 변환되며, 변환할 수 없는 경우는 0으로 취급됨 |
| `calculation` | `'sum'`=합계 / `'count'`=건수 / `'average'`=평균 / `'min'`=최솟값 / `'max'`=최댓값 | ✓ | 집계 방법. 소계·총계도 원시값의 집합으로부터 같은 계산 방법으로 재집계되므로 `average` 등에서도 올바른 값이 됨 |
| `format` | string |  | 집계값의 표시 포맷(`headerFormat`과 같은 간이 서식: `'#,##0'` 또는 `,`→자릿수 구분, `'.NN'`→소수 NN자리 고정, 지정 없음→그대로 문자열화) |

**괘선 설정(`border`)**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `color` | string |  | 선 색. 기본: `#000000` |
| `width` | number |  | 바깥 테두리·헤더/데이터 경계의 선 너비(pt). 기본: 0.5. 내부의 행/열 구분선은 이것의 절반 선 너비로 그려짐 |

### 리포트 안에 다른 리포트를 끼워 넣고 싶다 — `subreport`

개념은 **리포트 레이아웃의 기본** 섹션에서 설명했습니다. 여기서는 그대로 동작하는 완전한 정의를 보입니다. 부모의 명세 1행마다 서브리포트가 1회 실행되고, `dataSourceExpression`으로 전달한 배열이 서브리포트 쪽의 `rows`가 됩니다.

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

데이터 예:

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

끼워 넣어지는 쪽의 `subreport.report`는 독립된 하나의 템플릿입니다. 전달된 `items`의 각 요소를 일반적인 `field.*`로 참조하고, 부모로부터 전달된 파라미터를 `param.*`으로 받습니다. 참고로 서브리포트로 실행되는 템플릿에서는 `pageHeader`·`pageFooter`·`background` 밴드는 출력되지 않습니다(페이지 관리는 부모 리포트가 하기 때문). 제목은 다음과 같이 `title` 밴드에 놓습니다.

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

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'subreport'` | ✓ | 요소 종별 |
| `templateExpression` | Expression | ✓ | 자식 템플릿 이름을 반환하는 표현식. `createReportFromFile()`을 사용하고 있는 경우는 파일 경로로 자동 해석되고, `createReport()`를 직접 사용하는 경우는 옵션 `resolveSubreportTemplate`(이름과 작업 디렉터리를 받아 `{ template, workingDirectory? }`를 반환하는 함수. 해석할 수 없을 때는 `null`을 반환)로 해석 |
| `dataSourceExpression` | Expression | | 자식 리포트의 데이터 소스(행 객체의 배열)를 반환하는 표현식. 생략 시는 부모의 데이터 소스 행을 그대로 사용. 배열 이외의 결과는 빈 데이터로 취급 |
| `parameters` | SubreportParamDef[] |  | 자식 리포트에 전달할 파라미터(아래 표 **`SubreportParamDef`** 참조). `parametersMapExpression`의 동명 엔트리보다 우선됨 |
| `parametersMapExpression` | Expression | | 자식 파라미터에 병합할 객체를 반환하는 표현식(개별 `parameters`가 우선) |
| `returnValues` | ReturnValueDef[] |  | 자식 리포트의 변수 값을 부모에게 반환하는 정의(아래 표 **`ReturnValueDef`** 참조) |
| `usingCache` | boolean | | 부모 리포트의 1회 실행 안에서, 템플릿 이름마다 해석 완료된 자식 템플릿을 캐시하여 재사용 |
| `runToBottom` | boolean | | 서브리포트 내용의 뒤, 페이지/칼럼의 남은 공간을 소비(후속 요소를 남은 공간의 아래로 밀어냄) |

**`SubreportParamDef`**(`parameters`의 각 요소=자식 리포트에 전달할 파라미터)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 자식 리포트에 전달할 파라미터 이름(자식 쪽에서는 `param.이름`으로 참조) |
| `expression` | Expression | ✓ | 파라미터 값을 산출하는 표현식. 부모 리포트의 문맥에서 평가됨 |

**`ReturnValueDef`**(`returnValues`의 각 요소=자식 리포트에서 부모에게 값을 반환하는 정의)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 부모 리포트 쪽에서 값을 받을 변수 이름. 이 변수는 부모의 일반적인 변수 계산에 의한 덮어쓰기에서 제외됨 |
| `subreportVariable` | string | ✓ | 자식 리포트 쪽의 참조 원본 변수 이름. 자식 리포트의 실행 완료 시에 그 값이 부모에게 반영됨 |
| `calculation` | `'nothing'`=자식의 값을 그대로 대입(실행할 때마다 덮어씀) / `'count'`=건수 / `'sum'`=합계 / `'average'`=평균 / `'min'`=최솟값 / `'max'`=최댓값 / `'first'`=처음 얻어진 값을 유지 | ✓ | 부모 변수로의 반영 방법. `'nothing'` 이외는 서브리포트가 여러 번 실행되는 경우에 횡단으로 집계됨 |

### 바코드·QR 코드를 인쇄하고 싶다 — `barcode`

`barcodeType`에는 Code 39/93/128, EAN, UPC, ITF, Codabar, MSI, QR Code(`qrcode`), Data Matrix, PDF417 등을 지정할 수 있습니다. `showText`로 읽기용 문자를 병기합니다.

```json
{
  "type": "barcode",
  "x": 0, "y": 0, "width": 180, "height": 64,
  "barcodeType": "code128",
  "expression": "field.code",
  "showText": true
}
```

데이터 예:

```json
{ "rows": [{ "code": "TSR-2026-0001" }] }
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'barcode'` | ✓ | 요소 종별 |
| `barcodeType` | string | ✓ | 바코드 규격(대문자·소문자는 구별하지 않음). 설정 가능 값: `'code39'`=Code 39／`'code128'`=Code 128／`'ean13'`·`'ean-13'`=EAN-13／`'ean8'`·`'ean-8'`=EAN-8／`'qrcode'`·`'qr'`=QR 코드／`'datamatrix'`·`'data-matrix'`=Data Matrix／`'pdf417'`=PDF417／`'upca'`·`'upc-a'`=UPC-A／`'upce'`·`'upc-e'`=UPC-E／`'itf'`·`'interleaved2of5'`=ITF(Interleaved 2 of 5)／`'codabar'`=Codabar(NW-7)／`'code93'`=Code 93／`'msi'`=MSI. 위 이외의 값은 미대응으로 하여 플레이스홀더를 그림 |
| `expression` | Expression | ✓ | 바코드의 데이터를 반환하는 표현식(평가 결과를 문자열화하여 부호화) |
| `showText` | boolean | | 1차원 바코드의 하부에 사람이 읽을 수 있는 텍스트를 표시(텍스트 영역 높이 10pt·폰트 크기 8pt. 바의 높이는 그만큼 감소). 2차원 코드(QR／Data Matrix／PDF417)에서는 사용되지 않음 |
| `errorCorrectionLevel` | `'L'` \| `'M'` \| `'Q'` \| `'H'` | | QR 코드의 오류 정정 레벨=코드의 일부가 더러워지거나 결손되어도 읽을 수 있는 복원 능력. `'L'`→`'H'`의 순으로 내성이 올라가는 대신 무늬가 세밀해짐. 인쇄가 거친 매체에서는 `'Q'`나 `'H'`를 권장. 기본: `'M'`. QR 코드에서만 유효(PDF417의 오류 정정 레벨은 데이터 길이로부터 자동 선정됨) |

### 수식을 인쇄하고 싶다 — `math`

LaTeX풍의 수식을 조판합니다. 수식의 조판에는 수식용 치수 정보(OpenType MATH 테이블)를 내장한 전용 폰트가 필요합니다(무료로 입수할 수 있는 예: STIX Two Math, Latin Modern Math. 일반적인 본문 폰트로는 대용할 수 없습니다). `formula`는 표현식으로 평가됩니다(이 예에서는 데이터의 `formula` 항목을 참조하고 있습니다).

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

데이터 예:

```json
{ "rows": [{ "formula": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }] }
```

`math` 요소를 사용하는 경우는 OpenType MATH 테이블을 가진 폰트를 `fontMap`과 PDF 출력용 `fonts`의 양쪽에 등록합니다.

```js
const math = loadFont('./reports/fonts/MathFont.otf')
fontMap.set('math', new TextMeasurer(math))
fonts.math = math
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'math'` | ✓ | 요소 종별 |
| `formula` | Expression | ✓ | LaTeX 수식 문자열을 반환하는 표현식(고정된 수식은 표현식 안의 문자열 리터럴로서 `'...'`로 감쌈). 평가 결과가 빈 문자열인 경우는 아무것도 그리지 않음 |
| `mathFontFamily` | string | | 수식 그리기에 사용할 폰트(fontMap에 등록된 폰트 ID). 기본: 요소 스타일의 fontFamily, 그것도 없으면 `'default'` |
| `fontSize` | number | | 폰트 크기(pt). 기본: 요소 스타일의 fontSize, 그것도 없으면 12 |
| `color` | string | | 문자 색. 기본: 요소의 forecolor → 스타일의 forecolor → `#000000`의 순으로 해석 |

### SVG를 인쇄하고 싶다 — `svg`

SVG 문서를 그대로 리포트에 그립니다. `svgContent`는 표현식으로 평가됩니다(고정된 SVG 문자열을 데이터나 파라미터로 전달할 수 있습니다).

```json
{
  "type": "svg",
  "x": 0, "y": 0, "width": 200, "height": 60,
  "svgContent": "field.svgMarkup"
}
```

데이터 예:

```json
{
  "rows": [
    {
      "svgMarkup": "<svg viewBox=\"0 0 200 60\"><defs><linearGradient id=\"g\"><stop stop-color=\"#2563eb\"/><stop offset=\"1\" stop-color=\"#7c3aed\"/></linearGradient></defs><rect width=\"200\" height=\"60\" rx=\"8\" fill=\"url(#g)\"/></svg>"
    }
  ]
}
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'svg'` | ✓ | 요소 종별 |
| `svgContent` | Expression | ✓ | SVG 마크업 문자열을 반환하는 표현식. 평가 결과를 문자열화하고 요소의 위치·크기로 SVG로서 그림 |

### 입력할 수 있는 PDF 폼을 만들고 싶다 — `formField`

PDF를 연 사람이 입력할 수 있는 폼 필드를 배치합니다. `fieldType`에는 `text`, `checkbox`, `radio`, `pushbutton`, `dropdown`, `listbox`, `signature`를 지정할 수 있습니다.

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

데이터 예(폼의 초깃값이 됩니다):

```json
{ "rows": [{ "contact": "帳票担当者" }] }
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'formField'` | ✓ | 요소 종별. 대화형 폼 필드. 미리보기 계열 백엔드는 초기 외관을 그리고, PDF 출력에서는 실제로 입력 가능한 필드로 출력됨 |
| `fieldType` | `'text'`=텍스트 입력 필드(PDF /Tx) / `'checkbox'`=체크박스(/Btn) / `'radio'`=라디오 버튼(/Btn. `fieldName`이 같은 위젯끼리 하나의 배타 그룹을 구성) / `'pushbutton'`=푸시 버튼(/Btn. 캡션+임의의 URI 액션) / `'dropdown'`=드롭다운(콤보 박스, /Ch) / `'listbox'`=리스트 박스(/Ch) / `'signature'`=서명 필드(/Sig) | ✓ | 필드 종별 |
| `fieldName` | string | ✓ | 완전 수식 필드 이름. 문서 안에서 유일해야 함(중복 시는 예외). 예외적으로 `radio`는 같은 이름을 공유함으로써 하나의 배타 그룹을 형성 |
| `value` | Expression |  | 초깃값(text: 입력값, dropdown/listbox: 선택값. `multiSelect`의 listbox는 줄바꿈 구분으로 여러 값을 지정). 표현식 평가됨. `valueStream`과의 병용은 예외 |
| `checked` | Expression |  | 초기 체크 상태(checkbox/radio). 표현식 평가됨. radio에서는 체크된 버튼의 `exportValue`가 그룹의 선택값이 됨 |
| `exportValue` | string |  | 폼의 입력 내용을 송신·추출했을 때 이 체크박스/라디오가 "ON"임을 나타내는 값으로 기록되는 문자열(checkbox/radio). 기본: `'Yes'`. 라디오 그룹에서는 각 선택지를 이 값으로 구별 |
| `options` | FormFieldOption[] |  | 선택지의 배열(dropdown/listbox). 아래 표 참조 |
| `editable` | boolean |  | 선택지에 더해 자유 입력을 허용(dropdown을 콤보 입력 가능하게 함) |
| `multiSelect` | boolean |  | 복수 선택을 허용(listbox) |
| `caption` | string |  | 버튼의 캡션(pushbutton) |
| `action` | string |  | pushbutton을 눌렀을 때 열 URI |
| `multiline` | boolean |  | 여러 행 입력(text) |
| `readOnly` | boolean |  | 읽기 전용으로 함 |
| `required` | boolean |  | 입력 필수로 함 |
| `noExport` | boolean |  | 폼 송신 시 이 필드의 값을 내보내지 않음 |
| `password` | boolean |  | 비밀번호 입력(text, 입력 문자를 숨김 표시) |
| `fileSelect` | boolean |  | 파일 선택 필드로 함(text). `multiline`/`password`와의 병용은 예외 |
| `doNotSpellCheck` | boolean |  | 맞춤법 검사를 무효로 함(text/dropdown/listbox) |
| `doNotScroll` | boolean |  | 표시 범위를 넘는 입력의 스크롤을 금지(text) |
| `comb` | boolean |  | 균등 폭의 문자 칸(콤) 표시로 함(text). `maxLength`의 지정이 필수이며, `multiline`/`password`/`fileSelect`와의 병용은 예외 |
| `richText` | string |  | 대응 뷰어에서 서식 포함(굵게·색 등)으로 표시되는 리치 텍스트 값(PDF의 /RV). 지정하면 필드의 리치 텍스트 플래그가 섬. `richTextStream`과의 병용은 예외 |
| `richTextStream` | Uint8Array |  | `richText`의 스트림판. PDF 가져오기에서 원본 PDF의 /RV가 스트림이었던 경우의 바이트 보전용으로, 손으로 쓰는 템플릿에서는 보통 `richText`를 사용. `richText`와의 병용은 예외 |
| `defaultStyle` | string |  | 리치 텍스트의 기본 스타일(PDF의 /DS). CSS풍의 서식 지정 문자열(예: `font: Helvetica 12pt`)로, `richText` 쪽에서 지정하지 않은 부분의 기본이 됨 |
| `valueStream` | Uint8Array |  | PDF 가져오기의 보전용. 원본 PDF의 필드 값(/V)이 문자열이 아니라 스트림 객체였던 경우에 그 바이트 열을 무손실로 재출력. 손으로 쓰는 템플릿에서는 보통 `value`를 사용. `value`와의 병용은 예외 |
| `defaultValue` | string |  | 폼 리셋 시에 돌아갈 기본값(/DV) |
| `sort` | boolean |  | 선택지를 정렬하여 표시(dropdown/listbox) |
| `commitOnSelectionChange` | boolean |  | 선택 변경 시에 값을 즉시 확정(dropdown/listbox) |
| `radiosInUnison` | boolean |  | 같은 `exportValue`를 가진 그룹 내의 라디오 버튼을 연동하여 ON/OFF |
| `additionalActions` | Partial<Record<'K' \| 'F' \| 'V' \| 'C', PdfActionDef>> |  | 대응하는 PDF 뷰어 위에서 동작하는 입력 스크립트를 필드에 부여. K=입력할 때마다(예: 숫자 이외를 제거), F=표시 정형(예: 소수 2자리로 표시), V=값 검증(예: 음수를 거부), C=재계산(예: 다른 필드의 값으로 자동 계산). 내용물은 보통 `subtype: 'JavaScript'`의 `PdfActionDef`(후술). 코어 엔진은 스크립트를 PDF에 끼워 넣기만 하고 실행하지 않음. radio 그룹에서는 전체 위젯이 동일한 정의가 아니면 예외 |
| `calculationOrder` | number |  | `'C'`(재계산) 액션을 가진 필드가 여러 개 있을 때 뷰어가 어느 순서로 재계산할지(PDF의 /CO). 0 이상 정수의 오름차순. 중복·음수·비정수는 예외 |
| `maxLength` | number |  | 최대 입력 문자 수(text) |
| `borderColor` | string |  | 테두리 색(`#RRGGBB`). 생략 시는 테두리 없음. radio는 원형, 그 이외는 사각형의 테두리로 선 너비 1pt로 그려짐 |
| `backgroundColor` | string |  | 배경색(`#RRGGBB`). 생략 시는 투명. radio는 원형, 그 이외는 사각형으로 채워짐 |

**`FormFieldOption`**(`options`의 각 요소=선택지 정의)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `value` | string | ✓ | 필드의 값(/V)에 저장되는 내보내기 값 |
| `label` | string |  | 표시 라벨. 기본: `value`와 동일 |

※ 이 밖에 전체 요소 공통 프로퍼티와 `TextProperties`의 전체 프로퍼티를 지정 가능(입력 텍스트의 폰트·배치 등에 적용됨).

### 임의의 위치에서 페이지 나눔·칼럼 나눔을 하고 싶다 — `break`

명세의 흐름 도중에 강제로 페이지(`"breakType": "page"`) 또는 열(`"column"`)을 전환합니다. 밴드 바로 아래에 놓으며, `frame` 안에는 놓을 수 없습니다.

```json
{
  "type": "break",
  "x": 0, "y": 0, "width": 0, "height": 0,
  "breakType": "page"
}
```

**프로퍼티 일람**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'break'` | ✓ | 요소 종별 |
| `breakType` | `'page'` \| `'column'` | ✓ | 페이지 나눔 종별. 요소의 y 위치에서 밴드를 분할하며, `'page'`=다음 페이지로 보냄／`'column'`=여러 칼럼 구성(템플릿의 `columns.count`가 2 이상. "리포트 레이아웃의 기본" 참조)이면서 마지막 칼럼이 아닐 때 다음 칼럼으로 보냄(그 이외의 경우는 페이지 나눔으로 동작) |

### 조건을 만족할 때만 요소를 인쇄하고 싶다 — `printWhenExpression`

`printWhenExpression`은 특정 요소의 종류가 아니라 **전체 요소에 공통되는 속성**입니다. 표현식이 truthy로 평가된 행에서만 그 요소를 인쇄합니다. 다음 예는 `urgent`가 `true`인 명세 행에만 「※ 至急」를 인쇄합니다.

```json
{
  "type": "staticText",
  "x": 360, "y": 0, "width": 60, "height": 20,
  "text": "※ 至急",
  "style": "body",
  "printWhenExpression": "field.urgent"
}
```

데이터 예(1행째에만 인쇄됩니다):

```json
{
  "rows": [
    { "item": "部品A", "urgent": true },
    { "item": "部品B", "urgent": false }
  ]
}
```

밴드에도 동명의 `printWhenExpression`을 지정할 수 있어, 밴드째로 출력을 억제할 수 있습니다(예: 비고 밴드를 `param.showNotes`일 때만 내보냄). 템플릿을 TypeScript로 정의하는 경우는 요소의 `onBeforeRender` 콜백으로 더욱 세밀하게 제어할 수 있습니다——`null`을 반환하면 그 요소의 인쇄를 건너뛰고, `ElementDef`를 반환하면 문자열·치수·색 등의 속성을 그 자리에서 덮어써 인쇄합니다.

## 요소 프로퍼티 레퍼런스

각 요소의 샘플에 붙인 "프로퍼티 일람"은 그 요소만이 가지는 프로퍼티입니다. 더해서 어느 요소에든 위치·크기·인쇄 조건·색 등의 공통 프로퍼티를 지정할 수 있습니다. 여기서는 전체 요소에 공통되는 프로퍼티와, 템플릿의 `styles`로 정의하는 스타일의 프로퍼티를 정리합니다.

### 전체 요소에 공통되는 프로퍼티

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id` | string |  | `findElementById()`로 그리기 전에 요소를 취득·변경하기 위한 식별자. 인쇄 내용 그 자체에는 영향을 주지 않음. 변경 대상으로 사용하는 ID는 템플릿 안에서 유일하게 함(중복 시는 검색 순서상 첫 번째 요소가 반환됨) |
| `x` | number | ✓ | 부모 밴드/컨테이너 안의 X 좌표(pt) |
| `y` | number | ✓ | 부모 밴드/컨테이너 안의 Y 좌표(pt) |
| `width` | number | ✓ | 너비(pt) |
| `height` | number | ✓ | 높이(pt) |
| `style` | string |  | 적용할 스타일 이름(`styles`로 정의한 `StyleDef`의 `name`을 참조. 미지정 시는 `isDefault`인 스타일이 적용됨) |
| `positionType` | `'float'`=자기 요소보다 위에 있는 요소의 늘어난 양만큼 아래 방향으로 이동 / `'fixRelativeToTop'`=밴드 상단으로부터의 위치를 고정(기본) / `'fixRelativeToBottom'`=밴드 하단으로부터의 거리를 유지(밴드가 늘어난 양만큼 아래로 이동) |  | 밴드가 늘어났을 때의 위치 결정 규칙. 기본: `fixRelativeToTop` |
| `stretchType` | `'noStretch'`=늘이지 않음(기본) / `'containerHeight'`=요소의 높이를 밴드의 실효 높이에 일치시킴 / `'containerBottom'`=요소의 하단을 밴드의 실효 하단까지 늘임(높이만 변경) |  | 밴드가 늘어났을 때의 요소의 늘이기 규칙. 기본: `noStretch` |
| `printWhenExpression` | Expression \| null |  | 평가 결과가 거짓인 경우, 이 요소를 인쇄하지 않음 |
| `onBeforeRender` | OnBeforeRenderCallback |  | 렌더링 직전에 호출되는 콜백 `(elem, field, vars, param, report) => ElementDef \| null`. `null`을 반환하면 인쇄 건너뛰기(`printWhenExpression`의 상위 호환), `ElementDef`를 반환하면 그 정의로 그리기(임의 속성의 동적 덮어쓰기). 평가 순서: `onBeforeRender` → `printWhenExpression`(덮어쓴 후의 정의에 대해 평가) → `conditionalStyles` |
| `isRemoveLineWhenBlank` | boolean |  | 요소가 인쇄되지 않았을 때, 그 요소가 점유하는 수직 띠에 다른 인쇄 요소가 겹치지 않으면 띠를 제거하고 아래 요소를 위로 당겨 밴드를 줄임 |
| `isPrintRepeatedValues` | boolean |  | `false`를 지정하면 직전과 같은 값(textField)인 경우 인쇄를 억제(억제 시 `isRemoveLineWhenBlank`가 참이면 높이 0으로 취급) |
| `isPrintWhenDetailOverflows` | boolean |  | 밴드가 오버플로한 각 페이지/칼럼의 세그먼트에 이 요소를 다시 인쇄 |
| `mode` | `'opaque'`=`backcolor`로 배경을 칠함 / `'transparent'`=배경을 칠하지 않음 |  | 표시 모드. 기본: `transparent`(요소→스타일의 순으로 해석) |
| `forecolor` | string |  | 전경색(`#RRGGBB` 또는 `#RRGGBBAA`) |
| `backcolor` | string |  | 배경색(`mode`가 `opaque`일 때 그려짐) |
| `border` | BorderDef |  | 테두리(뒤에 나오는 **`BorderDef`** 참조). line/rectangle/ellipse/path 요소에서는 테두리가 그려지지 않음(스타일 유래·요소 직접 지정 모두. 이들 요소는 자체의 `stroke` 등으로 선을 지정) |
| `padding` | Padding |  | 패딩(뒤에 나오는 **`Padding`** 참조) |
| `blendMode` | BlendModeDef |  | 이 요소의 색을, 이미 그려져 있는 아래의 내용과 어떻게 합성할지(뒤에 나오는 **`BlendModeDef`** 참조). 전형적인 예: 인영·스탬프 이미지에 `'multiply'`를 지정하면 아래의 문자를 가리지 않고 비친 상태로 겹쳐짐 |
| `overprintFill` | boolean |  | 상업 인쇄의 제판용. 채우기(문자·도형의 면)를, 아래에 있는 색판을 지우지 않고 겹쳐서 인쇄(오버프린트)하는 지정 |
| `overprintStroke` | boolean |  | 상업 인쇄의 제판용. 선(스트로크)의 오버프린트 지정 |
| `overprintMode` | 0 \| 1 |  | `overprintFill`/`overprintStroke`를 유효로 했을 때의 동작 선택(PDF /OPM). `0`=모든 색 성분에서 아래의 색을 덮어씀(기본) / `1`=값이 0인 색 성분은 아래의 색을 남김 |
| `renderingIntent` | `'AbsoluteColorimetric'`=측색적으로 충실 / `'RelativeColorimetric'`=백색점을 맞추어 충실 / `'Saturation'`=선명함 우선 / `'Perceptual'`=겉보기의 자연스러움 우선 |  | 출력 기기의 색 영역에 들어가지 않는 색을 어떻게 변환할지의 우선 방침(PDF 렌더링 인텐트). 상업 인쇄·컬러 매니지먼트용으로, 보통은 지정 불필요 |
| `alphaIsShape` | boolean |  | PDF 투명 합성의 세부 제어(불투명도·마스크를 "형상"으로 해석하는 /AIS). 보통은 지정 불필요하며, 주로 PDF 가져오기의 충실한 재출력에 사용됨 |
| `textKnockout` | boolean |  | 반투명 문자끼리 겹쳤을 때 같은 텍스트 안에서는 겹침을 이중 합성하지 않음(PDF /TK). 기본: `true`. 보통은 지정 불필요 |
| `optionalContent` | OptionalContentDef |  | 이 요소를 PDF의 "레이어"에 올림. 뷰어의 레이어 패널에서 표시/비표시·인쇄 유무를 전환할 수 있음(예: 워터마크를 화면에서는 표시하고 인쇄에서는 지움). 뒤에 나오는 **`OptionalContentDef`** 참조 |
| `opacity` | number |  | 요소의 불투명도(0.0〜1.0). 자식 요소를 가지는 경우는 그룹으로 합성 후에 적용 |

**`BlendModeDef`**(`blendMode`에 지정할 수 있는 합성 모드)

요소는 보통 아래에 있는 그리기 결과 위에 덧칠합니다(`'normal'`). 블렌드 모드를 지정하면 위아래의 색을 계산으로 합성합니다. 리포트에서는 인영·회사 도장을 문자 위에 겹치기(`'multiply'`), 어두운 배경에 흰색 빼기풍의 효과 내기(`'screen'`) 같은 사용법이 전형적입니다.

| 상수 | 효과 |
| --- | --- |
| `'normal'` | 합성하지 않고 위의 색으로 그림(기본 상당) |
| `'multiply'` | 곱셈. 겹침은 반드시 어두워짐. 인영·스탬프·형광 마커풍의 겹쳐 칠하기에 |
| `'screen'` | 반전 곱셈. 겹침은 반드시 밝아짐 |
| `'overlay'` | 바탕이 어두우면 곱셈·밝으면 반전 곱셈. 콘트라스트가 강조됨 |
| `'darken'` | 위아래의 어두운 쪽의 색을 채용 |
| `'lighten'` | 위아래의 밝은 쪽의 색을 채용 |
| `'color-dodge'` | 위의 색에 따라 바탕을 밝게 날림 |
| `'color-burn'` | 위의 색에 따라 바탕을 태워 어둡게 함 |
| `'hard-light'` | 위의 색의 명암으로 곱셈/반전 곱셈을 전환(강한 조명 효과) |
| `'soft-light'` | `'hard-light'`의 약한 판(부드러운 조명 효과) |
| `'difference'` | 위아래의 색의 차의 절댓값 |
| `'exclusion'` | `'difference'`의 저 콘트라스트판 |
| `'hue'` | 위의 색상+아래의 채도·휘도 |
| `'saturation'` | 위의 채도+아래의 색상·휘도 |
| `'color'` | 위의 색상·채도+아래의 휘도(모노크롬 바탕에 대한 착색에) |
| `'luminosity'` | 위의 휘도+아래의 색상·채도 |

**`Expression`**(자세한 내용은 "표현식(Expression)을 활용하기" 참조)
| 형식 | 설명 |
| --- | --- |
| string | 표현식 미니 언어. 예: `'field.customer.name'`, `'field.price * field.quantity'`, `` '`Page ${PAGE_NUMBER} / ${TOTAL_PAGES}`' ``, `'field.amount > 0 ? "OK" : "NG"'` |
| ExpressionCallback | TypeScript 함수 `(field, vars, param, report) => unknown`. `report`(ReportContext)는 `PAGE_NUMBER`(현재 페이지 번호·1부터 시작), `COLUMN_NUMBER`(현재 칼럼 번호·1부터 시작), `REPORT_COUNT`(처리 완료 레코드 수), `TOTAL_PAGES`(총 페이지 수. evaluationTime=report에서 확정), `RETURN_VALUE`(타입 정의상은 존재하지만 현행 구현에서는 항상 undefined——서브리포트의 반환값은 `vars.*`로 받음), `format`(내장 포맷 함수), `formatters`(템플릿에 등록된 커스텀 포매터)를 가짐 |

**`BorderDef`**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `width` | number |  | 선 너비(pt). 전체 변 공통의 기본값 |
| `color` | string |  | 선 색. 전체 변 공통의 기본값 |
| `style` | `'solid'`=실선 / `'dashed'`=파선 / `'dotted'`=점선 |  | 선 종류. 전체 변 공통의 기본값 |
| `top` / `bottom` / `left` / `right` | BorderSideDef \| null |  | 변별 개별 지정(뒤에 나오는 **`BorderSideDef`** 참조). 전체 변 공통의 지정보다 우선되며, `null`로 그 변을 비표시로 함 |

**`BorderSideDef`**(`BorderDef`의 `top`/`bottom`/`left`/`right`에서 사용)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `width` | number | ✓ | 선 너비(pt) |
| `color` | string | ✓ | 선 색 |
| `style` | `'solid'`=실선 / `'dashed'`=파선 / `'dotted'`=점선 | ✓ | 선 종류 |

**`Padding`**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `top` / `bottom` / `left` / `right` | number |  | 각 변의 패딩(pt) |

**`HyperlinkDef`**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'reference'`=외부 URL / `'localAnchor'`=동일 문서 내의 앵커로 / `'localPage'`=동일 문서 내의 페이지 번호로 / `'remoteAnchor'`=다른 PDF 문서의 앵커로 / `'remotePage'`=다른 PDF 문서의 페이지로 | ✓ | 링크 종별 |
| `target` | Expression | ✓ | 링크 대상(URL, 앵커 이름, 또는 페이지 번호의 표현식) |
| `remoteDocument` | Expression |  | 리모트 PDF 파일 경로(remotePage / remoteAnchor용) |

**`TextProperties`**(staticText / textField / formField가 가지는 텍스트·단락 프로퍼티)
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `markup` | `'none'`=플레인 텍스트 / `'styled'`=스타일 포함 마크업(`<style forecolor=... isBold=...>`, `<b>`/`<i>`/`<u>` 등) / `'html'`=HTML 서브셋(`<b>`/`<i>`/`<u>`/`<s>`/`<font>`/`<br>`/`<sup>`/`<sub>`) |  | 마크업 종별 |
| `hAlign` | `'left'`=왼쪽 정렬 / `'center'`=가운데 정렬 / `'right'`=오른쪽 정렬 / `'justify'`=양끝 정렬 |  | 수평 방향의 배치 |
| `vAlign` | `'top'`=위 정렬 / `'middle'`=가운데 정렬 / `'bottom'`=아래 정렬 |  | 수직 방향의 배치 |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 텍스트 회전(도) |
| `lineSpacing` | LineSpacingDef |  | 행간 설정(뒤에 나오는 **`LineSpacingDef`** 참조) |
| `letterSpacing` | number |  | 자간(pt). 모든 문자 사이에 고정량을 추가(음수로 좁힘) |
| `tracking` | number |  | 자간 조정의 일종. `letterSpacing`이 고정량을 일률적으로 더하는 데 비해, 이쪽은 폰트 자신이 내장하는 자간 조정표(AAT `trak` 테이블)를 사용해 폰트 크기에 따른 설계값으로 자간을 가감함. 숫자는 조정표의 "트랙 값"으로, 0=표준, 음수=좁힘, 양수=넓힘(중간값은 보간). `trak` 테이블을 갖지 않는 폰트에서는 효과 없음 |
| `wordSpacing` | number |  | 어간(pt. 공백 문자에 추가되는 너비) |
| `horizontalScale` | number |  | 문자의 글자 모양을 가로 방향으로 신축하는 배율(1 미만=너비를 좁히는 장체, 1 초과=너비를 넓히는 평체). 신축 후의 너비로 줄바꿈·행 보내기가 계산됨. 기본: 1 |
| `baselineOffset` | number |  | 베이스라인(문자가 올라가는 기준선)의 위치를 요소 상단으로부터의 pt로 명시. 보통은 자동 계산되므로 지정 불필요(주로 PDF 가져오기가 원래의 문자 위치를 재현하기 위해 설정) |
| `firstLineIndent` | number |  | 1행째의 들여쓰기(pt) |
| `leftIndent` | number |  | 왼쪽 들여쓰기(pt) |
| `rightIndent` | number |  | 오른쪽 들여쓰기(pt) |
| `padding` | Padding |  | 패딩 |
| `direction` | `'ltr'`=왼쪽→오른쪽 / `'rtl'`=오른쪽→왼쪽 / `'auto'`=내용으로부터 자동 판정(양방향 텍스트 해석) |  | 텍스트의 방향 |
| `openTypeScript` | string |  | 문자열을 글자 모양으로 변환(셰이핑)할 때 폰트의 어느 문자 체계용 규칙을 사용할지를 지정하는 OpenType 태그(예: `'latn'`=라틴 문자, `'arab'`=아랍 문자). 보통은 지정 불필요(문자 내용으로부터 자동으로 처리됨) |
| `openTypeLanguage` | string |  | 같은 문자 체계라도 언어에 따라 글자 모양을 바꾸는 폰트에서 언어를 명시하는 OpenType 태그. 보통은 지정 불필요 |
| `openTypeFeatures` | Record<string, number> |  | 폰트가 내장하는 글자 모양 전환 기능(피처)의 ON/OFF. 예: `{ "palt": 1 }`=일본어 문장의 자간을 좁힘, `{ "liga": 0 }`=합자를 무효화, `{ "zero": 1 }`=슬래시 붙은 제로. 값은 0=무효／1=유효, 글자 모양 선택형 피처에서는 1부터 시작하는 대체 글자 모양 번호 |
| `shrinkToFit` | boolean |  | 자동 축소: 요소의 너비·높이에 들어가도록 폰트 크기를 축소 |
| `minFontSize` | number |  | `shrinkToFit` 시의 최소 폰트 크기(pt). 기본: 4 |
| `fitWidth` | boolean |  | 가장 긴 행이 요소의 내용 너비에 딱 들어가도록 폰트 크기를 자동 조정(축소·확대의 양방향) |
| `outlineText` | boolean |  | 텍스트를 아웃라인화(패스 변환). 기본: `false` |
| `pdfFontMode` | `'embedded'`=폰트 프로그램을 임베드 / `'reference'`=임베드하지 않고 시스템 폰트 참조를 출력 |  | PDF 폰트 프로그램의 취급 |
| `textPaintMode` | `'fill'`=채우기 / `'stroke'`=테두리 선만 / `'fillStroke'`=채우기+테두리 선 |  | PDF 가져오기에서 유지되는 텍스트 그리기 시맨틱스. 기본: `fill` |
| `textStrokeColor` | string |  | stroke / fillStroke 시의 스트로크 색 |
| `textStrokeWidth` | number |  | 텍스트의 아웃라인 선 너비(pt) |
| `tabStops` | TabStopDef[] |  | 탭 스톱 정의(뒤에 나오는 **`TabStopDef`** 참조) |
| `tabStopWidth` | number |  | 기본 탭 간격(pt). 미지정 시는 40pt |
| `wrap` | boolean |  | 텍스트의 줄바꿈. 기본: `true`(undefined는 줄바꿈 유효) |

**`LineSpacingDef`**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'single'`=1행 / `'1.5'`=1.5행 / `'double'`=2행 / `'proportional'`=배율 지정 / `'fixed'`=고정값 / `'minimum'`=최솟값 | ✓ | 행간의 종별 |
| `value` | number |  | fixed / minimum / proportional일 때의 값 |

**`TabStopDef`**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `position` | number | ✓ | 탭 위치(pt) |
| `alignment` | `'left'` / `'center'` / `'right'` |  | 탭 정렬. 기본: `left` |

**`FillDef`**(`path`의 채우기(`fill`)·스트로크(`stroke`)와, `rectangle`/`ellipse`의 채우기(`fill`)에 지정 가능한 타입의 합집합. `rectangle`/`ellipse`의 `stroke`는 단색 문자열만)
| 형식 | 설명 |
| --- | --- |
| string | 단색(`#RRGGBB` 또는 `#RRGGBBAA`) |
| PdfSpecialColorDef | 별색(Separation／DeviceN). 금·은·기업 컬러 등 특정 잉크의 색 지정(뒤에 나오는 표 참조) |
| LinearGradientDef | 선형 그라디언트——2점을 잇는 축을 따라 색을 변화시킴(뒤에 나오는 표 참조) |
| RadialGradientDef | 원형 그라디언트——중심에서 바깥쪽으로 색을 변화시킴(뒤에 나오는 표 참조) |
| MeshGradientDef | 메시 그라디언트——자유로운 형상을 따라 색을 변화시킴(뒤에 나오는 표 참조) |
| TilingPatternDef | 타일링 패턴——작은 그림 무늬를 깔아 채움(뒤에 나오는 표 참조) |
| FunctionShadingDef | 함수 셰이딩——좌표로부터 색을 계산식으로 결정(뒤에 나오는 표 참조) |

**`GradientStopDef`**(그라디언트의 색 전환점. 각 그라디언트의 `stops`에서 사용)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `offset` | number | ✓ | 그라디언트 축을 따른 위치. 0〜1의 비율(0=시작점, 1=종료점) |
| `color` | string | ✓ | 이 위치의 색(`#RRGGBB`) |
| `opacity` | number |  | 이 위치의 불투명도(0〜1). 기본: 1 |

**`LinearGradientDef`**(선형 그라디언트——2점을 잇는 축을 따라 색을 변화시키는 채우기)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'linearGradient'` | ✓ | 선형 그라디언트임을 나타내는 판별자 |
| `x1` | number |  | 시작점의 X 좌표. **요소 경계 박스의 너비에 대한 비율**(0=왼쪽 끝, 1=오른쪽 끝). 기본: 0 |
| `y1` | number |  | 시작점의 Y 좌표. **요소 경계 박스의 높이에 대한 비율**(0=위쪽 끝, 1=아래쪽 끝). 기본: 0 |
| `x2` | number |  | 종료점의 X 좌표(너비에 대한 비율). 기본: 1(기본값 그대로라면 왼쪽→오른쪽의 수평 그라디언트) |
| `y2` | number |  | 종료점의 Y 좌표(높이에 대한 비율). 기본: 0 |
| `stops` | GradientStopDef[] | ✓ | 색 전환점의 배열(위 표 참조) |
| `spreadMethod` | `'pad'`=끝의 색으로 채움 / `'reflect'`=반전하면서 반복 / `'repeat'`=그대로 반복 |  | 그라디언트 범위 바깥쪽의 칠하는 방법. 기본: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | PDF 가져오기한 그라디언트를 무손실로 재출력하기 위한 보전 메타데이터. 손으로 쓰는 템플릿에서는 지정 불필요 |

**`RadialGradientDef`**(원형 그라디언트——중심에서 바깥쪽으로 색을 변화시키는 채우기)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'radialGradient'` | ✓ | 원형 그라디언트임을 나타내는 판별자 |
| `cx` | number |  | 바깥 원의 중심 X 좌표(요소 경계 박스의 너비에 대한 비율). 기본: 0.5 |
| `cy` | number |  | 바깥 원의 중심 Y 좌표(높이에 대한 비율). 기본: 0.5 |
| `r` | number |  | 바깥 원의 반지름. **너비·높이의 큰 쪽에 대한 비율**. 기본: 0.5 |
| `fx` | number |  | 초점(그라디언트가 시작되는 점)의 X 좌표(너비에 대한 비율). 기본: `cx` |
| `fy` | number |  | 초점의 Y 좌표(높이에 대한 비율). 기본: `cy` |
| `fr` | number |  | 초점 원의 반지름(너비·높이의 큰 쪽에 대한 비율). 기본: 0 |
| `stops` | GradientStopDef[] | ✓ | 색 전환점의 배열 |
| `spreadMethod` | `'pad'` / `'reflect'` / `'repeat'` |  | 범위 밖의 칠하는 방법(`LinearGradientDef`와 동일). 기본: `'pad'` |
| `pdfShading` | PdfAxialRadialShadingDef |  | PDF 가져오기의 무손실 재출력용 메타데이터. 손으로 쓰는 템플릿에서는 지정 불필요 |

**`MeshGradientDef`**(메시 그라디언트——격자나 삼각형의 정점마다 색을 주어, 자유로운 형상을 따라 색을 변화시키는 채우기)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'meshGradient'` | ✓ | 메시 그라디언트임을 나타내는 판별자 |
| `patches` | MeshPatchDef[] |  | 곡면 패치의 배열. 각 패치는 `points`(4×4의 제어점 망을 x,y 순의 32개 숫자로 표현. **좌표는 요소 로컬의 pt**)와 `colors`(네 모서리의 색)를 가짐 |
| `triangles` | MeshTriangleDef[] |  | 그라디언트 삼각형의 배열. 각 삼각형은 `points`(x0,y0,x1,y1,x2,y2. 요소 로컬 pt)와 `colors`(3정점의 색)를 가지며, 정점 사이에서 색이 보간됨 |
| `lattice` | MeshLatticeDef |  | 격자 형식의 메시. `columns`(1행당 정점 수, 2 이상), `points`(정점 좌표의 나열. 요소 로컬 pt), `colors`(정점별 색, `points`와 같은 순서)를 가짐 |
| `packedPatches` | { points: Float32Array, colors: Uint32Array } |  | PDF 가져오기한 네이티브 메시 데이터의 컴팩트 표현. 손으로 쓰는 템플릿에서는 지정 불필요 |
| `packedTriangles` | { points: Float32Array, colors: Uint32Array } |  | 위와 같음의 그라디언트 삼각형판 |
| `pdfShading` | PdfMeshShadingDef |  | PDF 가져오기의 무손실 재출력용 메타데이터. 손으로 쓰는 템플릿에서는 지정 불필요 |

**`TilingPatternDef`**(타일링 패턴——작은 그림 무늬를 깔아 채움. 음영·바둑판 무늬·로고의 반복 등에)

표 안의 "패턴 공간"은 패턴 전용의 좌표계입니다. `matrix`를 지정하지 않으면 요소 로컬의 pt 좌표와 일치합니다.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'tilingPattern'` | ✓ | 타일링 패턴임을 나타내는 판별자 |
| `bbox` | [number, number, number, number] | ✓ | 한 장분의 그림 무늬(패턴 셀)의 경계 박스(패턴 공간의 좌표) |
| `xStep` | number | ✓ | 셀의 수평 방향 반복 간격(패턴 공간) |
| `yStep` | number | ✓ | 셀의 수직 방향 반복 간격(패턴 공간) |
| `graphics` | TileGraphicDef[] | ✓ | 셀 안에 그릴 그래픽의 배열. `kind`로 판별: `'path'`(SVG 패스 데이터+채우기·선)／`'image'`(이미지 리소스 ID를 `source`로 참조)／`'text'`(폰트·크기·색 지정의 텍스트)／`'group'`(변환·클립·불투명도 등을 동반하는 중첩 그룹). 좌표는 모두 패턴 공간 |
| `tilingType` | 1=일정 간격(그리기 장치에 맞추어 셀을 약간 왜곡해도 됨) \| 2=왜곡 없음(간격이 약간 변동할 수 있음) \| 3=일정 간격이면서 고속 타일링 |  | 깔기의 정밀도 모드. 기본: 1 |
| `paintType` | `'colored'`=패턴 자신이 색을 가짐 / `'uncolored'`=사용하는 쪽의 `color`로 단색 착색 |  | 색을 가지는 방식. 기본: `'colored'` |
| `color` | string |  | `'uncolored'` 패턴 사용 시의 착색 색 |
| `matrix` | [number, number, number, number, number, number] |  | 패턴 공간에서 요소 로컬 공간으로의 아핀 변환 행렬. 기본: 단위 행렬 |

**`FunctionShadingDef`**(함수 셰이딩——좌표 (x, y)로부터 색을 계산식으로 결정하는 채우기. 주로 PDF 가져오기에서 나타남)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'functionShading'` | ✓ | 함수 셰이딩임을 나타내는 판별자. `expression`을 가지는 계산식 형식과 `sampled`를 가지는 샘플 형식의 2가지 변종이 있음 |
| `domain` | [number, number, number, number] | ✓ | `[x0, x1, y0, y1]`의 입력 영역 |
| `expression` | string | ✓(계산식 형식만) | PostScript 계산식(PDF FunctionType 4). x, y를 받아 r, g, b를 반환. 예: `'{ 2 copy add 2 div }'` |
| `sampled` | SampledFunctionDef | ✓(샘플 형식만) | 샘플링 완료 함수 데이터(PDF FunctionType 0). `size`(샘플 격자의 치수), `bitsPerSample`(1/2/4/8/12/16/24/32), `range`(출력 범위), `samples`(격자점별 샘플 값), 임의의 `encode`／`decode`를 가짐 |
| `matrix` | [number, number, number, number, number, number] |  | 입력 영역에서 **요소 로컬 pt**로의 사상 행렬. 기본: 단위 행렬 |
| `background` | [number, number, number] |  | 영역 밖의 배경색(DeviceRGB 성분, 0〜1) |
| `bbox` | [number, number, number, number] |  | 그리기를 제한하는 경계 박스 |
| `antiAlias` | boolean |  | 안티에일리어스의 힌트 |
| `paintOperator` | `'pattern'`=패턴으로 칠함(기본) / `'sh'`=현재의 클립 아래에서 직접 그림 |  | PDF 출력 시의 그리기 방식 |

**`PdfSpecialColorDef`**(별색 채우기——금·은·기업 컬러 등, 일반적인 CMYK 조합으로는 재현할 수 없는 특정 잉크로 인쇄하기 위한 색 지정)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | `'pdfSpecialColor'` | ✓ | 별색 채우기임을 나타내는 판별자 |
| `colorSpace` | PdfSeparationColorSpaceDef \| PdfDeviceNColorSpaceDef | ✓ | 별색의 색 공간. 단일 잉크는 `kind: 'separation'`으로, `name`(잉크 이름)·`alternate`(별색 잉크 미대응 환경에서 대신 사용할 프로세스 색 공간·아래 표 참조)·`tintTransform`(농도→대체 색의 변환을 PDF 함수로 지정. 예: `{ functionType: 2, domain: [0, 1], c0: [1, 1, 1], c1: [0, 0.2, 0.6], exponent: 1 }`=농도 0에서 흰색·1에서 파란색)을 가짐. 여러 잉크는 `kind: 'deviceN'`으로, `names`(잉크 이름의 배열)·`alternate`·`tintTransform`·`subtype`(`'DeviceN'`=표준／`'NChannel'`=잉크별 속성 정보를 추가할 수 있는 확장 형식)·`colorants`(각 잉크 이름→단일 잉크 정의의 대응표)·`process`·`mixingHints`를 가짐 |
| `components` | number[] | ✓ | 각 잉크의 농도 값(0〜1) |
| `displayColor` | string | ✓ | 별색 잉크를 갖지 않는 화면 표시·미리보기에서 대신 사용할 색 |

**`PdfProcessColorSpaceDef`**(프로세스 색 공간=CMYK 등 표준 잉크의 조합으로 나타내는 "일반적인 색"의 색 공간. 별색의 `alternate`나 소프트 마스크의 `colorSpace`에서 사용하며 `kind`로 판별)

| 배리언트(`kind`) | 추가 프로퍼티 | 설명 |
| --- | --- | --- |
| `'gray'` | 없음 | 그레이스케일(DeviceGray) |
| `'rgb'` | 없음 | RGB(DeviceRGB) |
| `'cmyk'` | 없음 | CMYK(DeviceCMYK) |
| `'calgray'` | `whitePoint`·`blackPoint`·`gamma`(모두 필수) | 측색적으로 교정된 그레이(CalGray) |
| `'calrgb'` | `whitePoint`·`blackPoint`·`gamma`(성분별)·`matrix`(3×3)(모두 필수) | 측색적으로 교정된 RGB(CalRGB) |
| `'lab'` | `whitePoint`·`blackPoint`·`range`(모두 필수) | L\*a\*b\* 색 공간 |
| `'icc'` | `components`(1\|3\|4)·`range`·`profile`(ICC 프로파일의 바이트 열)(모두 필수) | ICC 프로파일에 기반한 색 공간 |

`whitePoint`／`blackPoint`는 CIE XYZ 색 공간의 `[x, y, z]` 배열로 지정합니다.

### 밴드(`bands`)와 그룹(`groups`)의 프로퍼티

템플릿의 `bands`에 지정하는 10종류의 밴드("페이지는 "밴드"를 쌓아 올린 것" 참조)는 모두 다음의 `BandDef`로 정의합니다(`details`만 `BandDef`의 배열).

**`BandDef`**

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `height` | number | ✓ | 밴드의 최소 높이(pt). 요소의 늘어남에 따라 높아짐 |
| `elements` | ElementDef[] |  | 밴드에 배치할 요소 |
| `startNewPage` | boolean |  | 이 밴드를 반드시 새 페이지부터 시작 |
| `spacingBefore` | number |  | 밴드 앞의 여백(pt) |
| `spacingAfter` | number |  | 밴드 뒤의 여백(pt) |
| `splitType` | `'stretch'`=페이지에 들어가는 분량까지 인쇄하고 나머지를 다음 페이지로 잇기(기본) / `'prevent'`=분할하지 않고 밴드 전체를 다음 페이지로 보냄(새 페이지에도 들어가지 않는 경우는 분할됨) / `'immediate'`=요소의 도중이라도 현재 위치에서 즉시 분할 |  | 페이지 경계에서 밴드가 다 들어가지 않을 때의 분할 방법 |
| `printWhenExpression` | Expression \| null |  | 평가 결과가 거짓일 때 이 밴드를 출력하지 않음 |

**`GroupDef`**(`groups`의 각 요소)

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 그룹 이름. 변수의 `resetGroup`이나 textField의 `evaluationGroup`에서 참조됨 |
| `expression` | Expression | ✓ | 그룹 판정 키. 행마다 평가되어 값이 바뀐 위치에서 이전 그룹을 닫고 새 그룹을 시작 |
| `header` | BandDef |  | 그룹의 선두에 출력할 밴드 |
| `footer` | BandDef |  | 그룹의 말미에 출력할 밴드 |
| `keepTogether` | boolean |  | 그룹 전체가 남은 공간에 들어가지 않을 때, 새 페이지에는 들어가는 경우 페이지를 나눈 뒤에 시작 |
| `minHeightToStartNewPage` | number |  | 페이지의 남은 높이가 이 값(pt) 미만이면 그룹을 새 페이지부터 시작 |
| `reprintHeaderOnEachPage` | boolean |  | 그룹이 여러 페이지에 걸칠 때 이어지는 각 페이지에서 헤더를 다시 인쇄 |
| `resetPageNumber` | boolean |  | 그룹 시작 시에 `PAGE_NUMBER`를 1로 리셋 |
| `startNewPage` | boolean |  | 각 그룹을 새 페이지부터 시작 |
| `startNewColumn` | boolean |  | 각 그룹을 새 칼럼부터 시작 |
| `footerPosition` | `'normal'`=명세의 바로 뒤에 출력(기본) / `'stackAtBottom'`=페이지 하부에 붙여 쌓음 / `'forceAtBottom'`=항상 페이지 최하부에 놓고 사이의 남은 공간을 소비 / `'collateAtBottom'`=다른 그룹의 푸터가 하부 붙이기일 때만 함께 하부에 나란히 놓임(단독으로는 `'normal'`과 동일) |  | 그룹 푸터의 세로 위치 |

### 스타일(`styles`)로 지정할 수 있는 프로퍼티

템플릿의 `styles` 배열로 정의하고, 요소의 `style` 프로퍼티에서 `name`으로 참조합니다. 폰트·문자 정렬·색 등 문자 주변의 지정은 주로 스타일로 합니다.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 스타일 이름(요소의 `style`에서 참조) |
| `parentStyle` | string |  | 부모 스타일 이름. 부모의 프로퍼티를 상속하고 자신의 지정으로 덮어씀(순환 참조는 무시) |
| `isDefault` | boolean |  | `true`인 스타일은 `style` 미지정의 요소에 기본으로 적용됨 |
| `fontFamily` | string |  | 폰트 패밀리. 기본: `'default'` |
| `fontSize` | number |  | 폰트 크기(pt). 기본: 10 |
| `bold` | boolean |  | 굵게. 기본: `false` |
| `italic` | boolean |  | 기울임. 기본: `false` |
| `underline` | boolean |  | 밑줄. 기본: `false` |
| `strikethrough` | boolean |  | 취소선. 기본: `false` |
| `forecolor` | string |  | 전경색(`#RRGGBB` 또는 `#RRGGBBAA`). 기본: `#000000` |
| `backcolor` | string |  | 배경색. 기본: `transparent` |
| `hAlign` | `'left'`=왼쪽 정렬 / `'center'`=가운데 정렬 / `'right'`=오른쪽 정렬 / `'justify'`=양끝 정렬 |  | 수평 방향의 배치. 기본: `left` |
| `vAlign` | `'top'`=위 정렬 / `'middle'`=가운데 정렬 / `'bottom'`=아래 정렬 |  | 수직 방향의 배치. 기본: `top` |
| `rotation` | 0 \| 90 \| 180 \| 270 |  | 텍스트 회전(도) |
| `padding` | Padding |  | 패딩 |
| `border` | BorderDef |  | 테두리 |
| `mode` | `'opaque'`=`backcolor`로 배경을 칠함 / `'transparent'`=배경을 칠하지 않음 |  | 표시 모드 |
| `opacity` | number |  | 불투명도(0.0〜1.0) |
| `variation` | Record<string, number> |  | Variable Font의 축 값(예: `{ wght: 700, wdth: 75 }`) |
| `writingMode` | `'horizontal-tb'`=가로쓰기 / `'vertical-rl'`=세로쓰기·오른쪽에서 왼쪽으로 행 보내기 / `'vertical-lr'`=세로쓰기·왼쪽에서 오른쪽으로 행 보내기 |  | 쓰기 방향 |
| `conditionalStyles` | ConditionalStyleDef[] |  | 조건부 스타일(아래 표 참조). 조건 성립 시에 해당 프로퍼티를 덮어씀 |
| `direction` | `'ltr'` / `'rtl'` / `'auto'` |  | 텍스트의 방향(ltr=왼쪽→오른쪽 / rtl=오른쪽→왼쪽 / auto=내용으로부터 자동 판정) |
| `openTypeScript` | string |  | 문자열을 글자 모양으로 변환(셰이핑)할 때 폰트의 어느 문자 체계용 규칙을 사용할지를 지정하는 OpenType 태그(예: `'latn'`=라틴 문자, `'arab'`=아랍 문자). 보통은 지정 불필요(문자 내용으로부터 자동으로 처리됨) |
| `openTypeLanguage` | string |  | 같은 문자 체계라도 언어에 따라 글자 모양을 바꾸는 폰트에서 언어를 명시하는 OpenType 태그. 보통은 지정 불필요 |
| `openTypeFeatures` | Record<string, number> |  | 폰트가 내장하는 글자 모양 전환 기능(피처)의 ON/OFF. 예: `{ "palt": 1 }`=일본어 문장의 자간을 좁힘, `{ "liga": 0 }`=합자를 무효화, `{ "zero": 1 }`=슬래시 붙은 제로. 값은 0=무효／1=유효, 글자 모양 선택형 피처에서는 1부터 시작하는 대체 글자 모양 번호 |

**`ConditionalStyleDef`**
| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `condition` | Expression | ✓ | 적용 조건. 참일 때 아래의 프로퍼티로 덮어씀 |
| `fontFamily` / `fontSize` / `bold` / `italic` / `forecolor` / `backcolor` / `hAlign` / `openTypeScript` / `openTypeLanguage` / `openTypeFeatures` | StyleDef의 동명 프로퍼티와 동형 |  | 조건 성립 시에 덮어써지는 값(의미는 StyleDef의 각 프로퍼티와 동일) |
| `underline` / `strikethrough` / `vAlign` / `opacity` | StyleDef의 동명 프로퍼티와 동형 |  | 타입 정의상은 선언되어 있지만, 현행 구현에서는 조건 성립 시의 덮어쓰기가 적용되지 않음 |

### PDF 가져오기·고급 PDF 기능의 타입

여기에 드는 타입은 (1) 기존 PDF를 가져온 결과를 1바이트도 손상시키지 않고 재출력하기 위한 "보전용"과, (2) PDF의 레이어·폼 스크립트·상업 인쇄의 제판 지정 같은 고급 기능을 사용하기 위한 것입니다. 일반적인 리포트를 손으로 쓸 때 지정하는 일은 거의 없습니다. "PDF 가져오기에서 설정된다"고 되어 있는 타입은 `importPdfPage()`가 생성한 요소에 포함되어 나타납니다.

**`OptionalContentDef`**(PDF의 레이어 기능)

PDF에는 내용을 "레이어"(옵셔널 콘텐츠 그룹, OCG)에 올려, 뷰어의 레이어 패널에서 표시/비표시·인쇄한다/안 한다를 전환할 수 있는 기능이 있습니다. 요소의 `optionalContent`에 이것을 지정하면 그 요소가 레이어에 올라갑니다. 예: "사외비" 워터마크를 레이어로 하여 인쇄 시에만 내보냄.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 뷰어의 레이어 패널에 표시되는 레이어 이름 |
| `visible` | boolean |  | 화면 표시의 초기 상태. 기본: true |
| `print` | boolean |  | 인쇄의 초기 상태. 기본: `visible`을 따름 |
| `membership` | PdfOptionalContentGroupDef \| PdfOptionalContentMembershipDef |  | PDF 가져오기에서 설정됨. 원본 PDF의 레이어 정의(OCG)나, 여러 레이어의 조합으로 가시성을 결정하는 멤버십 정의(OCMD)의 보전. 멤버십은 `groups`(대상 레이어)와 `policy`(`'AllOn'`=모두 ON일 때 가시 / `'AnyOn'`=어느 하나 ON / `'AnyOff'`=어느 하나 OFF / `'AllOff'`=모두 OFF), 임의의 가시성 논리식 `expression`을 가짐 |
| `properties` | PdfOptionalContentPropertiesDef |  | PDF 가져오기에서 설정됨. 문서 전체의 레이어 구성(전체 레이어의 일람, 기본 구성, 레이어 패널의 표시 순서 트리, 배타 선택 그룹, 잠금 등)의 보전 |

**`PdfRawValueDef`**(PDF의 "원시값")

보전용 프로퍼티의 다수는 PDF 내부의 데이터를 해석하지 않고 그대로 나르기 위해 "원시값"으로 유지합니다. 원시값은 다음 형태의 JavaScript 값입니다: `null`·진위값·숫자는 그대로, PDF의 이름은 `{ kind: 'name', value: 'DeviceRGB' }`, 문자열은 `{ kind: 'string', bytes: Uint8Array }`, 배열은 `{ kind: 'array', items: [...] }`, 사전은 `{ kind: 'dictionary', entries: { ... } }`, 스트림은 `{ kind: 'stream', entries: { ... }, data: Uint8Array }`.

**`PdfActionDef`**(PDF 뷰어가 실행하는 액션)

폼 필드의 `additionalActions` 등에서 사용하는, "뷰어에게 무엇을 시킬지"의 정의입니다. 내용물은 직렬화·가져오기될 뿐이며, **코어 엔진이 실행하는 일은 없습니다**(실행하는 것은 대응하는 PDF 뷰어).

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `subtype` | string | ✓ | 액션의 종류. `'JavaScript'`=스크립트 실행(폼의 입력 정형·검증·자동 계산은 이것)／`'GoTo'`=문서 내 이동／`'GoToR'`=다른 문서로 이동／`'GoToE'`=임베드 문서로 이동／`'URI'`=URL을 엶／`'Launch'`=앱·파일 기동／`'Named'`=정의된 명령(다음 페이지 등)／`'SubmitForm'`=폼 송신／`'ResetForm'`=폼 리셋／`'ImportData'`=데이터 가져오기／`'Hide'`=주석의 표시 전환／`'SetOCGState'`=레이어 표시 전환／`'Thread'`·`'Sound'`·`'Movie'`·`'Rendition'`·`'Trans'`·`'GoTo3DView'`·`'RichMediaExecute'`·`'GoToDp'`=기타 PDF 표준 액션 |
| `entries` | Record<string, PdfRawValueDef> | ✓ | 종류별 설정값을 원시값(위의 **`PdfRawValueDef`**) 그대로 유지하는 사전. 예: `'JavaScript'`라면 `{ JS: { kind: 'string', bytes: new TextEncoder().encode('AFNumber_Format(2, 0, 0, 0, "¥", true);') } }` |
| `destination` | PdfDestinationDef |  | `'GoTo'`계의 이동 대상. 이름 있는 지정(`{ kind: 'named', name, representation: 'name' \| 'string' }`) 또는 명시 지정(대상 페이지+표시 배율을 맞추는 방법) |
| `structureDestination` | PdfStructureDestinationDef |  | 문서 구조 요소를 기준으로 한 이동 대상(PDF 2.0) |
| `annotationTarget` | PdfActionAnnotationTargetDef |  | 미디어계 액션이 대상으로 하는 주석의 지정 |
| `optionalContentState` | PdfOptionalContentStateDef[] |  | `'SetOCGState'`로 전환할 레이어와 조작(`'ON'`／`'OFF'`／`'Toggle'`)의 나열 |
| `fieldTargets` | PdfActionFieldTargetsDef |  | `'Hide'`／`'SubmitForm'`／`'ResetForm'`이 대상으로 하는 필드 이름의 지정 |
| `embeddedTarget` | PdfEmbeddedTargetDef |  | `'GoToE'`의 임베드 파일 지정(재귀 구조) |
| `launchParameters` | PdfLaunchPlatformParametersDef |  | `'Launch'`의 플랫폼별 파라미터. 유지만 되며 실행되지 않음 |
| `articleTarget` | PdfArticleActionTargetDef |  | `'Thread'`의 기사 스레드 지정 |
| `documentPartIndex` | number |  | `'GoToDp'`의 이동 대상 도큐먼트 파트 번호 |
| `richMediaInstanceIndex` | number |  | 리치 미디어의 인스턴스 번호 |
| `next` | PdfActionDef \| PdfActionDef[] |  | 이어서 실행할 액션(연쇄) |

**`PdfFormXObjectDef`**(가져온 PDF 부품의 메타데이터 보전)

PDF 내부에서는 반복해 사용하는 그리기 내용을 "Form XObject"라는 부품으로 정리할 수 있습니다. PDF 가져오기는 이 부품을 `frame` 요소로 변환하고, 부품이 가지고 있던 좌표계·메타데이터를 이 타입으로 유지하여 재출력 시에 복원합니다. 손으로 쓰는 템플릿에서는 지정 불필요합니다.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `bbox` | [number, number, number, number] | ✓ | 부품의 경계 박스(/BBox) |
| `matrix` | [number, number, number, number, number, number] | ✓ | 부품 좌표계의 변환 행렬(/Matrix) |
| `invocationMatrix` | [number, number, number, number, number, number] | ✓ | 원본 PDF에서 이 부품이 그려졌을 때 유효했던 좌표 변환 |
| `formType` | 1 |  | 부품의 형식 번호(PDF 사양상 1만) |
| `group` | Record<string, PdfRawValueDef> |  | 투명 그룹 사전의 원시값 유지 |
| `reference` | Record<string, PdfRawValueDef> |  | 외부 PDF 참조 사전의 원시값 유지 |
| `metadata` | PdfRawValueDef의 스트림형(`kind: 'stream'`) |  | 메타데이터 스트림의 유지 |
| `pieceInfo` | Record<string, PdfRawValueDef> |  | 작성 앱 고유 데이터(/PieceInfo)의 유지 |
| `lastModified` | PdfRawValueDef |  | 최종 갱신 일시의 유지 |
| `structParent` / `structParents` | number |  | 태그 붙은 PDF(읽기 순서 등의 문서 구조)와의 대응 키의 유지 |
| `opi` | PdfOpiMetadataDef |  | OPI 정보의 유지(아래 표 참조) |
| `name` | string |  | 부품 이름 |
| `measure` | PdfMeasurement |  | 계측 정보의 유지(아래 표 참조) |
| `pointData` | PdfPointData[] |  | 점군 데이터의 유지(아래 표 참조) |

**`PdfSourceVectorDef`**(가져온 반복 도형의 공유 정의)

지도의 기호처럼 같은 도형이 대량으로 반복되는 PDF를 가져오면 도형의 윤곽 데이터를 "정의 1회+배치 N회"의 형태로 보전합니다. `path` 요소의 `pdfSourceVector`에 나타나며, 지정 시는 `d`의 파싱 처리를 하지 않습니다. 손으로 쓰는 템플릿에서는 지정 불필요합니다.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `definitions` | PdfSourceVectorDefinitionDef[] | ✓ | 재이용되는 도형 정의의 배열. 각 정의는 `commands`(0=시작점 이동〔좌표 2개〕, 1=직선〔2개〕, 2=3차 베지에 곡선〔6개〕, 3=패스를 닫음〔0개〕)와 `coords`(커맨드 순의 좌표 평탄 배열)를 가짐 |
| `instances` | PdfSourceVectorInstanceDef[] | ✓ | 정의의 배치의 배열. 각 배치는 `definitionIndex`(정의 번호)와 `matrix`(6요소 아핀 행렬)를 가짐 |

**`PdfOpiMetadataDef`**(상업 인쇄의 이미지 교체 정보)

OPI(Open Prepress Interface)는 편집 중에는 가벼운 저해상도 이미지를 놓아 두고, 인쇄소의 출력 시에 고해상도 이미지로 교체하는 상업 인쇄의 구조입니다. 가져온 PDF가 이 지정을 가지고 있던 경우에 보전합니다.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `version` | `'1.3'` \| `'2.0'` | ✓ | OPI의 버전 |
| `entries` | Record<string, PdfRawValueDef> | ✓ | OPI 사전의 내용물을 PDF 원시값 그대로 유지(교체 원본 파일 이름·잘라내기 범위 등) |

**`PdfMeasurement`**(도면·지도의 계측 정보)

도면 PDF나 지도 PDF에서는 뷰어의 계측 도구가 "종이 위의 1cm는 실물의 1m에 해당한다" 같은 축척으로 거리·면적을 잴 수 있습니다. 그 축척·좌표계 정보의 보전용 타입으로, 직교 좌표 형식(`kind: 'rectilinear'`)과 지리 공간 형식(`kind: 'geospatial'`)이 있습니다.

| 프로퍼티(`'rectilinear'`) | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `kind` | `'rectilinear'` | ✓ | 직교 좌표 계측의 판별자 |
| `scaleRatio` | string | ✓ | 축척의 표시 텍스트(예: `'1in = 1ft'`) |
| `x` / `y` | PdfNumberFormat[] | ✓(`y`는 임의) | X／Y 방향의 숫자 표시 형식의 연쇄(단위 라벨·환산 계수·소수/분수 표시 등). `y` 생략 시는 `x`를 사용 |
| `distance` / `area` | PdfNumberFormat[] | ✓ | 거리／면적의 숫자 표시 형식 |
| `angle` / `slope` | PdfNumberFormat[] |  | 각도／기울기의 숫자 표시 형식 |
| `origin` | [number, number] |  | 계측 원점 |
| `yToX` | number |  | Y→X 단위의 환산 계수 |

| 프로퍼티(`'geospatial'`) | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `kind` | `'geospatial'` | ✓ | 지리 공간 계측의 판별자 |
| `coordinateSystem` | { kind: 'geographic' \| 'projected', epsg?, wkt? } | ✓ | 측지 좌표계. EPSG 코드 또는 WKT 문자열의 어느 하나 필수 |
| `geographicPoints` / `localPoints` | PdfMeasurementPoint[] | ✓ | 측지 좌표의 제어점과, 그에 대응하는 이미지·부품 내의 로컬 제어점(같은 수) |
| `dimension` | 2 \| 3 |  | 좌표의 차원. 기본: 2 |
| `bounds` | [number, number][] |  | 계측 가능 영역의 다각형 |
| `displayCoordinateSystem` | `coordinateSystem`과 동일 |  | 표시용의 좌표계 |
| `preferredDisplayUnits` | PdfPreferredDisplayUnits |  | 거리·면적·각도의 우선 표시 단위 |
| `projectedCoordinateSystemMatrix` | 12요소의 number 튜플 |  | 투영 좌표계용의 4×4 아핀 행렬(상수의 제4열을 생략한 행 순서 12요소) |

**`PdfPointData`**(지도의 점군 데이터)

지도 PDF에 끼워 넣어지는, 이름 있는 열(`LAT`=위도, `LON`=경도, `ALT`=고도 등)을 가진 점 데이터 표의 보전용입니다.

| 프로퍼티 | 타입·설정 가능한 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| `names` | string[] | ✓ | 열 이름의 배열(유일·비어 있지 않음. `LAT`/`LON`/`ALT` 열은 숫자 필수) |
| `rows` | PdfRawValueDef[][] | ✓ | 각 행의 값. 행의 길이는 `names`와 일치 |

**`TransferFunctionDef`**／**`CalculatorFunctionDef`**(제판의 계조 변환 함수)

`frame`의 `deviceParams`나 `softMask`에서 사용하는, 값(0〜1)을 다른 값으로 옮기는 함수입니다. 제판에서 "이 농도의 잉크는 이 농도로 인쇄한다"는 계조 커브를 나타냅니다. `TransferFunctionDef`는 `CalculatorFunctionDef`(PostScript 계산식. 예: `{ expression: '{ 1 exch sub }' }`=흑백 반전) 또는 `PdfFunctionDef`(샘플 값의 표／지수 보간／그것들의 결합, 이라는 PDF의 함수 객체)의 어느 하나이며, 사용 위치에서는 `'Identity'`(변환 없음)도 지정할 수 있습니다.

**`HalftoneDef`**(제판의 망점 정의)

인쇄기는 색의 농담을 작은 점(망점)의 크기로 표현합니다. 그 망점을 만드는 방법의 지정으로, PDF 가져오기의 보전과 제판 데이터 작성에 사용합니다. `type`으로 5가지 형식으로 나뉩니다:

| 형식 | 주요 프로퍼티 | 설명 |
| --- | --- | --- |
| type 1(스크린) | `frequency`(선수)✓·`angle`(각도)✓·`spotFunction`(점의 형태. `'Round'` 등의 정의된 이름 또는 계산식)✓·`accurateScreens`(고정밀 스크린 구축을 요구·임의) | 선수·각도·점 형상으로 망점을 정의하는 표준 형식(`type`은 생략 가능) |
| type 6(임곗값 배열) | `width`✓·`height`✓·`thresholds`(너비×높이 개의 0〜255)✓ | 임곗값의 표로 망점을 직접 정의 |
| type 10(각도 붙은 임곗값) | `xsquare`✓·`ysquare`✓·`thresholds`✓ | 각도 붙은 셀의 임곗값 정의 |
| type 16(16비트 임곗값) | `width`✓·`height`✓·`thresholds`(16비트 값)✓·임의의 제2 사각형 | 고정밀의 임곗값 정의 |
| type 5(색판별 컬렉션) | `halftones`(`{ colorant: 잉크 이름, halftone: 위의 어느 하나의 형식 }`의 배열)✓ | 시안·마젠타 등의 색판마다 다른 망점을 할당 |

type 5를 제외한 4형식은 임의의 `transferFunction`(`'Identity'` 또는 `TransferFunctionDef`)을 가질 수 있습니다(type 5에서는 색판별의 안쪽 하프톤 정의가 각각 가집니다).

## 주요 API

자주 사용하는 API를 "무엇을 하고 싶은가"에서 찾을 수 있도록 하나씩 최소 샘플과 함께 보입니다. `template`·`dataSource`·`fontMap`·`fonts`는 튜토리얼에서 만든 것을 그대로 사용하는 전제입니다.

### 리포트를 조립하기

#### 템플릿과 데이터로 리포트를 조립하고 싶다 — `createReport()`

템플릿과 데이터를 레이아웃하고, 페이지 단위의 `RenderDocument`를 반환합니다. 표현식은 `field.*`, `vars.*`, `param.*`, `PAGE_NUMBER`, `TOTAL_PAGES` 등을 참조할 수 있는 안전한 내장 표현식 언어로, `eval`이나 `Function`은 사용하지 않습니다. TypeScript의 콜백 표현식도 선택할 수 있습니다.

```ts
const document = createReport(template, dataSource, { fontMap })
console.log(document.pages.length) // 레이아웃 완료된 페이지 수
```

#### ID로 템플릿 요소를 취득·변경하고 싶다 — `findElementById()` / `getElementChildren()`

```ts
const element = findElementById(template, 'customer-name')
if (element?.type === 'staticText') element.text = '変更後の文字列'

const parent = findElementById(template, 'customer-block')
const children = parent === undefined ? [] : getElementChildren(parent)
```

어느 API든 원본 템플릿의 요소 참조를 반환합니다. 변경은 `createReport()`를 호출하기 전에 해 주십시오. `getElementChildren()`이 자식 요소를 반환하는 것은 `frame`과 `table`(셀 내 요소)이며, 그 이외의 요소에서는 빈 배열입니다. 탐색 범위의 자세한 내용은 "ID로 요소를 가져와 그리기 전에 변경하기"를 참조해 주십시오.

#### `.report` 파일로 리포트를 조립하고 싶다 — `createReportFromFile()`(Node.js)

JSON 템플릿을 읽어 들이고, 이미지·서브리포트의 상대 경로를 템플릿의 디렉터리 기준으로 해석합니다.

```ts
const document = createReportFromFile('./reports/quotation.report', dataSource, { fontMap })
```

#### 여러 리포트를 한 권으로 묶고 싶다 — `createReportBook()`

표지·본문 등 여러 템플릿을 연결하고, 통합 페이지 번호를 매긴 하나의 `RenderDocument`로 만듭니다.

```ts
const book = createReportBook(
  [
    { template: coverTemplate, data: { rows: [] } },
    { template: detailTemplate, data: dataSource },
  ],
  { continuousPageNumbers: true },
)
```

#### 작성 완료된 `RenderDocument`끼리 연결하고 싶다 — `combineReports()`

```ts
const merged = combineReports([documentA, documentB])
```

이미지 ID가 충돌한 경우는 자동으로 이름이 바뀝니다.

#### 목차 페이지를 자동으로 만들고 싶다 — `insertTableOfContents()`

리포트 안의 앵커(`anchorName`)로부터 목차 엔트리를 수집하고, 목차 페이지를 선두에 삽입합니다.

```ts
const withToc = insertTableOfContents(
  document,
  // TOC page size and margins in pt (this example: A4 portrait)
  { width: 595, height: 842, marginTop: 36, marginBottom: 36 },
  'default', // font ID (fontMap key) used for the TOC text
  { title: '目次' },
)
```

#### 기존 PDF의 페이지 수를 알고 싶다 — `getPdfPageCount()`

```ts
const pageCount = getPdfPageCount(pdfBytes)
```

#### 기존 PDF를 리포트 요소로 가져오고 싶다 — `importPdfPage()`

자세한 내용은 **기존 PDF를 리포트 요소로 변환하기(PDF 가져오기)** 섹션을 참조해 주십시오.

```ts
const page = importPdfPage(pdfBytes, 0)
console.log(page.elements.length, page.styles, Object.keys(page.images))
```

### 그리기·출력하기

#### PDF를 출력하고 싶다 — `renderToPdf()`

```ts
const pdf = renderToPdf(document, { fonts, metadata: { title: '御見積書' } })
writeFileSync('./quotation.pdf', pdf)
```

#### 한 페이지만 미리보기하고 싶다 — `renderPage()`

페이지 단위의 그리기입니다. 브라우저 미리보기에서 표시 중인 페이지만을 그릴 때 사용합니다.

```ts
const context = canvas.getContext('2d')!
renderPage(document.pages[0], new CanvasBackend(context, { fonts }))
```

#### 리포트 전체를 임의의 백엔드에 그리고 싶다 — `render()`

`RenderBackend` 인터페이스를 구현한 임의의 출력 대상에 전체 페이지를 그립니다.

```ts
const backend = new PdfBackend({ fonts })
render(document, backend)
const pdf = backend.toUint8Array()
```

#### HTML Canvas에 그리고 싶다 — `CanvasBackend`

```ts
const backend = new CanvasBackend(context, {
  scale: 1.5,
  devicePixelRatio: window.devicePixelRatio,
  fonts,
})
renderPage(document.pages[0], backend)
```

#### SVG로 출력하고 싶다 — `SvgBackend`

한 페이지당 하나의 완결된 `<svg>` 문자열을 생성합니다.

```ts
const backend = new SvgBackend({ fonts })
render(document, backend)
const svgPages = backend.getPages() // 페이지별 <svg> 문자열의 배열
```

#### PDF 생성을 세밀하게 제어하고 싶다 — `PdfBackend`

페이지 섬네일 등의 PDF 고유 옵션은 생성자에 전달합니다.

```ts
const backend = new PdfBackend({ fonts, pageOptions: [{ thumbnailImageId: 'thumb.png' }] })
render(document, backend)
const pdf = backend.toUint8Array()
```

`pageOptions[i]`는 i번째 페이지에 적용됩니다. `thumbnailImageId`(페이지 일람에 표시되는 섬네일 이미지)에는 `document.images`에 존재하는 이미지 ID를 지정합니다.

#### 완성된 PDF끼리 결합하고 싶다 — `mergePdfFiles()`

Pure TypeScript의 PDF 파서로 여러 PDF를 하나로 결합합니다.

```ts
const merged = mergePdfFiles([pdfBytesA, pdfBytesB])
```

### 폰트를 다루기

#### 폰트 파일을 읽어 들이고 싶다 — `Font.load()`

TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT를 해석합니다.

```ts
const font = Font.load(fontBuffer)
```

#### 문자의 너비를 재고 싶다 — `TextMeasurer`

`Font`의 글리프 캐시를 이용한 고속의 문자 계측입니다. `fontMap`에 등록하여 레이아웃에도 사용됩니다.

```ts
const measurer = new TextMeasurer(font)
const measurement = measurer.measure('御見積書', 12)
console.log(measurement.width)
```

#### 문자열을 글리프 열로 변환하고 싶다 — `font.shapeText()`

OpenType/AAT(Apple계 폰트의 확장 사양)/Graphite(SIL계 폰트의 확장 사양)의 정보를 사용하여, 글자 모양 선택·합자·위치 조정을 적용한 글리프 열(글리프 번호와 위치·보내기 폭의 나열)을 얻습니다.

```ts
const shaped = font.shapeText('「縦書き。」', { direction: 'vertical' })
```

#### 인쇄 전에 깨진 문자를 감지하고 싶다 — `checkGlyphCoverage()`

```ts
const issues = checkGlyphCoverage(document, fonts)
if (issues.length > 0) {
  throw new Error(`Missing glyphs: ${JSON.stringify(issues)}`)
}
```

### 바코드·SVG·수식·이미지를 단독으로 사용하기

#### 바코드를 단독으로 생성하고 싶다 — `renderBarcode()`

리포트 요소를 경유하지 않고 바코드의 그리기 노드를 직접 생성합니다.

```ts
const qr = renderBarcode('qrcode', 'https://example.com', {
  x: 0, y: 0, width: 120, height: 120,
})
```

#### SVG를 해석하여 그리고 싶다 — `parseSvg()` / `renderSvg()`

```ts
const svgDocument = parseSvg('<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20"/></svg>')
renderSvg(svgDocument, backend, 0, 0, 200, 120)
```

#### 수식을 단독으로 조판하고 싶다 — `parseMathLaTeX()` / `layoutMathFormula()`

수식용 치수 정보(OpenType MATH 테이블)를 내장한 폰트가 필요합니다(예: STIX Two Math, Latin Modern Math).

```ts
const ast = parseMathLaTeX('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
// arguments: parsed formula, Font object, font ID (fontMap key), font size in pt, text color
const box = layoutMathFormula(ast, mathFont, 'math', 18, '#111827')
// box is the laid-out result; template math elements run this same layout internally
```

#### 이미지의 치수를 알고 싶다 — `getImageDimensions()`

PNG/JPEG/WebP/AVIF에 대응합니다.

```ts
const size = getImageDimensions(imageBytes) // { width, height } | null
```

#### PNG를 디코드하고 싶다 — `decodePng()`

Pure TypeScript의 PNG 디코더입니다.

```ts
const png = decodePng(pngBytes) // { width, height, pixels }（RGBA）
```

#### 브라우저에서 WebP/AVIF를 포함하는 PDF를 출력하고 싶다 — `prepareBrowserPdfImageResources()`

JPEG는 PDF에 직접 수록되고, PNG는 내장 디코더로 처리됩니다. 브라우저에서 WebP/AVIF를 포함하는 PDF를 생성하는 경우는 `tsreport-core/browser`가 `RenderDocument`에서 실제로 참조되고 있는 이미지만을 브라우저 표준 코덱으로 먼저 디코드하고, 그 결과를 PDF 생성에 전달합니다. 참조되지 않는 이미지는 그대로 유지되며 디코드되지 않습니다.

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

Node.js에서 WebP/AVIF를 전개하는 경우는 `tsreport-core/node`의 `createNodeExternalRasterImageDecoder()`를 사용합니다.

## 리소스 읽기의 제한과 이미지 ID의 규칙

서버 운용이나 라이브러리 편입에서 필요해졌을 때 참조하는 상세 규칙입니다.

### 이미지·템플릿의 읽기 디렉터리를 제한하기

이미지 파일의 읽기는 명시적으로 허가한 디렉터리 안으로 한정할 수 있습니다.

```ts
const document = createReport(template, dataSource, {
  fontMap,
  resources: { fileRoot: '/srv/report-assets' },
})
```

`createReportFromFile()`은 기본으로 메인 템플릿의 디렉터리를 상대 경로의 기준으로 하지만, 하위 호환을 위해 읽기 범위 그 자체는 암묵적으로 제한하지 않습니다. `resources.fileRoot`를 지정하면 이미지·메인 템플릿·서브리포트의 전부에 같은 제한이 적용됩니다. 존재하지 않는 이미지는 각 요소의 `onError` 지정에 따라 처리되며, 허가 디렉터리의 밖을 가리키는 참조(심볼릭 링크 경유를 포함)는 항상 에러가 됩니다.

### 이미지 ID의 규칙

`RenderDocument`의 각 이미지는 `RenderImage.imageId`(alternate의 `imageId`도 마찬가지)를 키로 하여 `RenderDocument.images`에서 찾습니다. **이용하는 쪽은 이 ID를 그대로 키로 사용하고, 경로 결합 등으로 키를 다시 조립하지 마십시오.** ID는 다음 규칙으로 부여됩니다.

- 상대 경로의 이미지를 읽어 들여도 ID를 서버의 절대 경로나 심볼릭 링크 해석 후의 경로로 바꾸지 않습니다. 템플릿에 쓴 참조가 그대로 키에 남습니다(절대 경로로 쓴 경우는 그 값 그대로)
- 심볼릭 링크 해석 후의 실체 경로는 내부에서 "같은 파일인지 아닌지"의 판정에만 사용합니다. 기준 디렉터리가 달라도 같은 실체를 가리키는 이미지에는 같은 ID를 재이용합니다
- 루트 리포트가 이미지를 렌더 시 공급으로 돌리는 구성——`createReport()`를 직접 사용하고 대상 이미지를 `resources`에도 전달하지 않기 때문에, 템플릿에 쓴 참조가 그대로 ID가 되고 바이트 열을 나중에 `renderToPdf(document, { images })`로 공급하는 구성——에서는, 서브리포트가 읽어 들인 상대 경로의 로컬 이미지에 항상 호스트 비의존의 내부 ID를 할당합니다. 표현식이나 동적 서브리포트의 참조는 사전에 열거할 수 없으므로, 이름이 실제로 충돌했는지 여부나 레이아웃의 순서에는 의존시키지 않습니다. 이로써 서브리포트의 로컬 이미지가 동명의 렌더 시 공급용 ID를 가로채는 일은 없습니다

### 렌더 시의 이미지 공급과 alternate

alternate가 레이아웃 시에 해결되지 않았던 경우는 원래의 image ID를 유지합니다. 그 때문에 Canvas/SVG 미리보기는 멈추지 않고, `renderToPdf(document, { images })`로 나중에 바이트 열을 공급할 수 있습니다. 명시적으로 전달한 `images`는 `document.images`에 병합되며, 같은 ID에서는 명시적으로 전달한 값이 우선됩니다. PDF 생성 시에도 미공급의 alternate는 대체 후보에서 제외될 뿐이며, 주 이미지의 그리기나 리포트 전체는 정지하지 않습니다.

### 이미지 참조의 수집 범위

이미지 참조의 수집은 일반적인 `image` 요소뿐 아니라 alternate, 그룹의 소프트 마스크, 채우기(fill/stroke)의 타일 패턴과 그 중첩된 소프트 마스크까지 모두 같은 구조로 다루어집니다. 브라우저에서 PDF 고유의 페이지 섬네일·collection 폴더 섬네일·Web Capture 이미지를 사용하는 경우는, 같은 `catalog`·`collection`·`pageOptions`를 `prepareBrowserPdfImageResources(document, options)`와 `renderToPdf(document, options)`의 양쪽에 전달해 주십시오(primitive API라면 같은 options를 `new PdfBackend(options)`에 전달하고 `render(document, backend)`를 호출합니다). 이들 WebP/AVIF도 PDF 생성 전에 필요한 분량만 디코드됩니다.

## 실행 환경

- Node.js 18 이상
- ES Modules / CommonJS
- 모던 브라우저
- 런타임 의존 패키지 없음

WOFF2의 Brotli 압축·전개는 Node.js와 브라우저의 어느 쪽에서도 tsreport-core 내장의 Pure TypeScript 구현을 사용합니다. 외부 패키지, WASM, 네이티브 라이브러리는 필요 없습니다.

## 관련 프로젝트

- [tsreport-core](https://github.com/pontasan/tsreport-core)
- [tsreport-editor](https://github.com/pontasan/tsreport-editor)
- [tsreport-sdk](https://github.com/pontasan/tsreport-sdk)
- [tsreport-react](https://github.com/pontasan/tsreport-react)

## License

tsreport-core는 이용자의 선택에 따라 [MIT License](./LICENSE-MIT) 또는 [Apache License 2.0](./LICENSE-APACHE)으로 이용할 수 있습니다(SPDX: `MIT OR Apache-2.0`). 제3자 유래 코드·데이터의 저작권 표시와 라이선스 조건은 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 참조해 주십시오.
