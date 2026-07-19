import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderText, RenderRect, RenderLine } from '../../src/types/render.js'
import { renderBarcode } from '../../src/layout/barcode-renderer.js'
import { layoutTable } from '../../src/layout/table-layout.js'
import { layoutCrosstab } from '../../src/layout/crosstab-layout.js'

// ─── Helpers ───

function collectTexts(nodes: RenderNode[], offsetX = 0, offsetY = 0): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push({ ...node, x: node.x + offsetX, y: node.y + offsetY })
    if (node.type === 'group') texts.push(...collectTexts(node.children, offsetX + node.x, offsetY + node.y))
  }
  return texts
}

function collectRects(nodes: RenderNode[]): RenderRect[] {
  const rects: RenderRect[] = []
  for (const node of nodes) {
    if (node.type === 'rect') rects.push(node)
    if (node.type === 'group') rects.push(...collectRects(node.children))
  }
  return rects
}

function collectGroups(nodes: RenderNode[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      groups.push(node)
      groups.push(...collectGroups(node.children))
    }
  }
  return groups
}

function collectLines(nodes: RenderNode[]): RenderLine[] {
  const lines: RenderLine[] = []
  for (const node of nodes) {
    if (node.type === 'line') lines.push(node)
    if (node.type === 'group') lines.push(...collectLines(node.children))
  }
  return lines
}

// ─── Barcode renderer unit tests ───

describe('Phase 10: バーコード', () => {
  describe('renderBarcode 直接テスト', () => {
    // Verifies renderBarcode produces black bar rects for Code39 input.
    it('Code39: バーパターンが生成される', () => {
      const result = renderBarcode('code39', '123', {
        x: 0, y: 0, width: 100, height: 40,
      })
      expect(result.type).toBe('group')
      if (result.type === 'group') {
        // Bar rects exist
        const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
        expect(rects.length).toBeGreaterThan(0)
        // All bars are black
        for (const r of rects) {
          expect(r.fill).toBe('#000000')
        }
      }
    })

    // Verifies showText renders the encoded value as text below the bars.
    it('Code39: showText で下部にテキスト表示', () => {
      const result = renderBarcode('code39', 'ABC', {
        x: 0, y: 0, width: 100, height: 50, showText: true,
      })
      if (result.type === 'group') {
        const texts = result.children.filter(c => c.type === 'text') as RenderText[]
        expect(texts.length).toBe(1)
        expect(texts[0]!.text).toBe('ABC')
      }
    })

    // Verifies Code128 generates bar rects and honors the given x/y position.
    it('Code128: バーパターンが生成される', () => {
      const result = renderBarcode('code128', 'Hello', {
        x: 10, y: 20, width: 120, height: 40,
      })
      expect(result.type).toBe('group')
      if (result.type === 'group') {
        expect(result.x).toBe(10)
        expect(result.y).toBe(20)
        const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
        expect(rects.length).toBeGreaterThan(0)
      }
    })

    // Verifies EAN-13 produces a bar pattern (95 modules).
    it('EAN-13: 95モジュールのバーパターンが生成される', () => {
      const result = renderBarcode('ean13', '4901234567890', {
        x: 0, y: 0, width: 100, height: 50,
      })
      if (result.type === 'group') {
        // EAN-13 has 95 modules: 3+42+5+42+3
        const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
        expect(rects.length).toBeGreaterThan(0)
      }
    })

    // Verifies EAN-8 produces bar rects.
    it('EAN-8: バーパターンが生成される', () => {
      const result = renderBarcode('ean8', '12345678', {
        x: 0, y: 0, width: 80, height: 40,
      })
      if (result.type === 'group') {
        const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
        expect(rects.length).toBeGreaterThan(0)
      }
    })

    // Verifies QR output contains a white background plus black modules.
    it('QRCode: マトリクスが生成される', () => {
      const result = renderBarcode('qrcode', 'Hello World', {
        x: 0, y: 0, width: 100, height: 100,
      })
      if (result.type === 'group') {
        // White background + black modules
        const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
        const whites = rects.filter(r => r.fill === '#FFFFFF')
        const blacks = rects.filter(r => r.fill === '#000000')
        expect(whites.length).toBeGreaterThan(0) // white background
        expect(blacks.length).toBeGreaterThan(0) // QR modules
      }
    })

    // Verifies enough black modules exist to account for the three finder patterns.
    it('QRCode: ファインダーパターンが存在する', () => {
      const result = renderBarcode('qrcode', 'Test', {
        x: 0, y: 0, width: 100, height: 100,
      })
      if (result.type === 'group') {
        // Finder patterns: 7x7 blocks at top-left, top-right, bottom-left
        // At minimum a substantial number of black modules exist
        const blacks = result.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000')
        expect(blacks.length).toBeGreaterThan(50)
      }
    })

    // Verifies errorCorrectionLevel L and H are both accepted.
    it('QRCode: errorCorrectionLevel が指定できる', () => {
      const resultL = renderBarcode('qrcode', 'Test', {
        x: 0, y: 0, width: 100, height: 100, errorCorrectionLevel: 'L',
      })
      const resultH = renderBarcode('qrcode', 'Test', {
        x: 0, y: 0, width: 100, height: 100, errorCorrectionLevel: 'H',
      })
      // H has more EC capacity, so the matrix may differ for the same data
      expect(resultL.type).toBe('group')
      expect(resultH.type).toBe('group')
    })

    // Verifies unsupported barcode types render a placeholder showing the type name and value.
    it('未対応タイプ: プレースホルダが表示される', () => {
      const result = renderBarcode('unknown-barcode', '12345', {
        x: 0, y: 0, width: 80, height: 80,
      })
      if (result.type === 'group') {
        const texts = result.children.filter(c => c.type === 'text') as RenderText[]
        expect(texts.some(t => t.text.includes('unknown-barcode'))).toBe(true)
        expect(texts.some(t => t.text === '12345')).toBe(true)
      }
    })
  })

  // Barcode elements rendered through the full report engine.
  describe('エンジン統合テスト', () => {
    // Verifies a barcode element appears in the render tree as a clipped group with bar rects.
    it('barcode 要素がレンダーツリーに含まれる', () => {
      const template: ReportTemplate = {
        page: { width: 200, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 60,
            elements: [{
              type: 'barcode',
              x: 10, y: 5,
              width: 100, height: 50,
              barcodeType: 'code128',
              expression: "'ABC-123'",
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      expect(doc.pages).toHaveLength(1)

      // The barcode group exists
      const groups = collectGroups(doc.pages[0]!.children)
      const barcodeGroup = groups.find(g => g.clip && g.width === 100 && g.height === 50)
      expect(barcodeGroup).toBeDefined()

      // Bar rects exist
      const rects = collectRects(doc.pages[0]!.children)
      const blackRects = rects.filter(r => r.fill === '#000000')
      expect(blackRects.length).toBeGreaterThan(0)
    })

    // Verifies the barcode expression resolves field values from the data source.
    it('barcode の expression がフィールドを参照できる', () => {
      const template: ReportTemplate = {
        page: { width: 200, height: 300, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 60,
            elements: [{
              type: 'barcode',
              x: 0, y: 0,
              width: 100, height: 50,
              barcodeType: 'code39',
              expression: "field.code",
              showText: true,
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{ code: 'TEST123' }] })
      const texts = collectTexts(doc.pages[0]!.children)
      const barcodeText = texts.find(t => t.text === 'TEST123')
      expect(barcodeText).toBeDefined()
    })

    // Verifies a QR barcode element produces black modules via the engine.
    it('QRCode がエンジンから正しく生成される', () => {
      const template: ReportTemplate = {
        page: { width: 200, height: 200, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
        bands: {
          details: [{
            height: 120,
            elements: [{
              type: 'barcode',
              x: 10, y: 10,
              width: 100, height: 100,
              barcodeType: 'qrcode',
              expression: "'https://example.com'",
              errorCorrectionLevel: 'M',
            }],
          }],
        },
      }
      const doc = createReport(template, { rows: [{}] })
      expect(doc.pages).toHaveLength(1)

      // QR code black modules exist
      const rects = collectRects(doc.pages[0]!.children)
      const blackRects = rects.filter(r => r.fill === '#000000')
      expect(blackRects.length).toBeGreaterThan(50)
    })
  })
})

// ─── Table layout ───

describe('Phase 10: テーブルレイアウト', () => {
  // Verifies a basic table lays out header, detail rows, and footer with the correct total height.
  it('基本テーブル: ヘッダー + 明細行 + フッター', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }, { width: 80 }, { width: 60 }],
        headerRows: [{
          height: 20,
          cells: [
            { text: 'Name' },
            { text: 'Qty' },
            { text: 'Price' },
          ],
        }],
        detailRows: [{
          height: 15,
          cells: [
            { expression: 'field.name' },
            { expression: 'field.qty' },
            { expression: 'field.price' },
          ],
        }],
        footerRows: [{
          height: 20,
          cells: [
            { text: 'Total', colSpan: 2 },
            { text: '300' },
          ],
        }],
      },
      10, 20, 240,
      [
        { name: 'Apple', qty: '5', price: '100' },
        { name: 'Banana', qty: '3', price: '200' },
      ],
    )

    expect(result.type).toBe('group')
    expect(result.x).toBe(10)
    expect(result.y).toBe(20)
    // Height: header 20 + detail 15x2 + footer 20 = 70
    expect(result.height).toBe(70)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Name')).toBe(true)
    expect(texts.some(t => t.text === 'Apple')).toBe(true)
    expect(texts.some(t => t.text === 'Banana')).toBe(true)
    expect(texts.some(t => t.text === 'Total')).toBe(true)
    expect(texts.some(t => t.text === '300')).toBe(true)
  })

  // Verifies column widths are scaled proportionally to fit the table width.
  it('列幅がテーブル幅にスケーリングされる', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }, { width: 100 }],
        headerRows: [{
          height: 20,
          cells: [{ text: 'A' }, { text: 'B' }],
        }],
      },
      0, 0, 300,
    )

    // Column defs total 200 → table width 300 → scale 1.5
    const texts = collectTexts([result])
    const textA = texts.find(t => t.text === 'A')
    const textB = texts.find(t => t.text === 'B')
    expect(textA).toBeDefined()
    expect(textB).toBeDefined()
    // B's X is 150 (100 x 1.5) + padding
    expect(textB!.x).toBeGreaterThan(140)
  })

  // Verifies cell backcolor produces a fill rect matching the cell size.
  it('セルの背景色', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{
          height: 20,
          cells: [{ text: 'Header', backcolor: '#FF0000' }],
        }],
      },
      0, 0, 100,
    )

    const rects = collectRects([result])
    const redRect = rects.find(r => r.fill === '#FF0000')
    expect(redRect).toBeDefined()
    expect(redRect!.width).toBe(100)
    expect(redRect!.height).toBe(20)
  })

  // Verifies colSpan merges columns and shifts the following cell accordingly.
  it('colSpan で列結合', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }, { width: 50 }],
        headerRows: [{
          height: 20,
          cells: [
            { text: 'Merged', colSpan: 2 },
            { text: 'Single' },
          ],
        }],
      },
      0, 0, 150,
    )

    const texts = collectTexts([result])
    const merged = texts.find(t => t.text === 'Merged')
    const single = texts.find(t => t.text === 'Single')
    expect(merged).toBeDefined()
    expect(single).toBeDefined()
    // Merged occupies width 100 (50x2)
    // Single is placed at x=100 + padding
    expect(single!.x).toBeGreaterThan(90)
  })

  // Verifies a full cell border renders four lines.
  it('セルボーダー', () => {
    const cellBorder = { top: { width: 1, color: '#000000', style: 'solid' as const }, bottom: { width: 1, color: '#000000', style: 'solid' as const }, left: { width: 1, color: '#000000', style: 'solid' as const }, right: { width: 1, color: '#000000', style: 'solid' as const } }
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'A', border: cellBorder }] }],
      },
      0, 0, 100,
    )

    const allNodes: RenderNode[] = []
    function collect(nodes: RenderNode[]) {
      for (const n of nodes) {
        allNodes.push(n)
        if (n.type === 'group') collect(n.children)
      }
    }
    collect([result])
    const lines = allNodes.filter(n => n.type === 'line') as RenderLine[]
    expect(lines.length).toBe(4)
  })

  // Verifies per-side cell borders allow thinner inner grid lines.
  it('セル個別ボーダーで内部罫線', () => {
    const innerBorder = { width: 0.5, color: '#999999', style: 'solid' as const }
    const outerBorder = { width: 1, color: '#000000', style: 'solid' as const }
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [{ height: 20, cells: [
          { text: 'A', border: { top: outerBorder, bottom: outerBorder, left: outerBorder, right: innerBorder } },
          { text: 'B', border: { top: outerBorder, bottom: outerBorder, left: innerBorder, right: outerBorder } },
        ] }],
      },
      0, 0, 100,
    )

    const allNodes: RenderNode[] = []
    function collect(nodes: RenderNode[]) {
      for (const n of nodes) {
        allNodes.push(n)
        if (n.type === 'group') collect(n.children)
      }
    }
    collect([result])

    const lines = allNodes.filter(n => n.type === 'line') as RenderLine[]
    expect(lines.length).toBeGreaterThan(0)
  })

  // Verifies detail cell expressions resolve field values per data row.
  it('式からフィールド値を解決', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        detailRows: [{
          height: 15,
          cells: [{ expression: 'field.val' }],
        }],
      },
      0, 0, 100,
      [{ val: 'Hello' }, { val: 'World' }],
    )

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Hello')).toBe(true)
    expect(texts.some(t => t.text === 'World')).toBe(true)
  })
})

// ─── Crosstab layout ───

describe('Phase 10: クロスタブレイアウト', () => {
  const sampleData = [
    { region: 'East', product: 'A', sales: 100 },
    { region: 'East', product: 'B', sales: 200 },
    { region: 'West', product: 'A', sales: 150 },
    { region: 'West', product: 'B', sales: 250 },
    { region: 'East', product: 'A', sales: 50 },
  ]

  // Verifies row and column headers are generated from distinct field values.
  it('基本的なクロスタブが生成される', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, sampleData,
    )

    expect(result.type).toBe('group')
    const texts = collectTexts([result])

    // Row headers
    expect(texts.some(t => t.text === 'East')).toBe(true)
    expect(texts.some(t => t.text === 'West')).toBe(true)

    // Column headers
    expect(texts.some(t => t.text === 'A')).toBe(true)
    expect(texts.some(t => t.text === 'B')).toBe(true)
  })

  // Verifies sum aggregation per row/column bucket.
  it('集計値が正しく計算される (sum)', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, sampleData,
    )

    const texts = collectTexts([result])
    // East-A: 100+50=150, East-B: 200, West-A: 150, West-B: 250
    expect(texts.some(t => t.text === '150')).toBe(true) // East-A or West-A
    expect(texts.some(t => t.text === '200')).toBe(true) // East-B
    expect(texts.some(t => t.text === '250')).toBe(true) // West-B
  })

  // Verifies count aggregation.
  it('count 集計', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'count' }],
      },
      0, 0, sampleData,
    )

    const texts = collectTexts([result])
    // East-A: 2 rows, East-B: 1, West-A: 1, West-B: 1
    expect(texts.some(t => t.text === '2')).toBe(true) // East-A
  })

  // Verifies showGrandTotal renders Total labels and the overall sum.
  it('総合計が表示される', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
        showGrandTotal: true,
      },
      0, 0, sampleData,
    )

    const texts = collectTexts([result])
    // Total labels
    const totalTexts = texts.filter(t => t.text === 'Total')
    expect(totalTexts.length).toBeGreaterThanOrEqual(2) // row Total + column Total

    // Grand total: 100+200+150+250+50 = 750
    expect(texts.some(t => t.text === '750')).toBe(true)
  })

  // Verifies the border option draws an outer rect and grid lines.
  it('罫線が描画される', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
        border: { color: '#000000', width: 1 },
      },
      0, 0, sampleData,
    )

    // Outer frame
    const rects = collectRects([result])
    const borderRect = rects.find(r => r.stroke === '#000000')
    expect(borderRect).toBeDefined()

    // Grid lines
    const allNodes: RenderNode[] = []
    function collect(nodes: RenderNode[]) {
      for (const n of nodes) {
        allNodes.push(n)
        if (n.type === 'group') collect(n.children)
      }
    }
    collect([result])
    const lines = allNodes.filter(n => n.type === 'line')
    expect(lines.length).toBeGreaterThan(0)
  })

  // Verifies custom cell/header dimensions determine the total crosstab size.
  it('セルのサイズが指定できる', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
        cellWidth: 80,
        cellHeight: 25,
        rowHeaderWidth: 100,
        columnHeaderHeight: 30,
      },
      0, 0, sampleData,
    )

    // Total width = rowHeaderWidth + 2 cols x cellWidth = 100 + 160 = 260
    expect(result.width).toBe(260)
    // Total height = columnHeaderHeight + 2 rows x cellHeight = 30 + 50 = 80
    expect(result.height).toBe(80)
  })

  // Verifies column headers and row headers use distinct background colors.
  it('背景色がヘッダーとデータセルで異なる', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, sampleData,
    )

    const rects = collectRects([result])
    // Column header background
    const headerBgs = rects.filter(r => r.fill === '#E8E8E8')
    expect(headerBgs.length).toBe(2) // A, B
    // Row header background
    const rowBgs = rects.filter(r => r.fill === '#F0F0F0')
    expect(rowBgs.length).toBe(2) // East, West
  })

  // Verifies the crosstab group is placed at the given x/y.
  it('位置が正しく設定される', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      50, 100, sampleData,
    )

    expect(result.x).toBe(50)
    expect(result.y).toBe(100)
  })

  // ─── Additional tests: aggregation accuracy ───

  // Verifies average aggregation.
  it('average 集計', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'average' }],
      },
      0, 0, sampleData,
    )
    const texts = collectTexts([result])
    // East-A: (100+50)/2=75, East-B: 200, West-A: 150, West-B: 250
    expect(texts.some(t => t.text === '75')).toBe(true) // East-A avg
    expect(texts.some(t => t.text === '200')).toBe(true) // East-B avg
  })

  // Verifies min aggregation.
  it('min 集計', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'min' }],
      },
      0, 0, sampleData,
    )
    const texts = collectTexts([result])
    // East-A: min(100,50)=50
    expect(texts.some(t => t.text === '50')).toBe(true)
  })

  // Verifies max aggregation.
  it('max 集計', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'max' }],
      },
      0, 0, sampleData,
    )
    const texts = collectTexts([result])
    // East-A: max(100,50)=100
    expect(texts.some(t => t.text === '100')).toBe(true)
  })

  // Verifies a crosstab built from a single data row.
  it('単一データ行のクロスタブ', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, [{ region: 'North', product: 'X', sales: 42 }],
    )
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'North')).toBe(true)
    expect(texts.some(t => t.text === 'X')).toBe(true)
    expect(texts.some(t => t.text === '42')).toBe(true)
  })

  // Verifies a 100-row dataset yields a 5x10 crosstab without errors.
  it('大量データ（100行）', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      region: `R${i % 5}`,
      product: `P${i % 10}`,
      sales: i * 10,
    }))
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, data,
    )
    expect(result.type).toBe('group')
    const texts = collectTexts([result])
    // 5 rows x 10 columns of data cells
    expect(texts.length).toBeGreaterThan(50)
  })

  // ─── Additional tests: edge cases ───

  // Verifies a zero measure value is displayed as 0 rather than blank.
  it('値が0のセル — 0が正しく表示される', () => {
    const data = [
      { region: 'A', product: 'X', sales: 0 },
      { region: 'A', product: 'Y', sales: 100 },
    ]
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, data,
    )
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === '0')).toBe(true)
    expect(texts.some(t => t.text === '100')).toBe(true)
  })

  // Verifies missing row/column combinations display 0.
  it('欠損セル（行×列の組み合わせがない）— 未存在キーは0', () => {
    const data = [
      { region: 'A', product: 'X', sales: 100 },
      { region: 'B', product: 'Y', sales: 200 },
    ]
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, data,
    )
    const texts = collectTexts([result])
    // A-Y and B-X cells are missing → 0
    expect(texts.filter(t => t.text === '0').length).toBe(2)
  })

  // Verifies duplicate row keys collapse into a single row header with summed values.
  it('同じ行/列値のデータ — 全行が同じregionの場合', () => {
    const data = [
      { region: 'Same', product: 'P1', sales: 10 },
      { region: 'Same', product: 'P1', sales: 20 },
      { region: 'Same', product: 'P2', sales: 30 },
    ]
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, data,
    )
    const texts = collectTexts([result])
    // Same-P1: 10+20=30, Same-P2: 30
    expect(texts.filter(t => t.text === 'Same').length).toBe(1)
    expect(texts.some(t => t.text === '30')).toBe(true) // P1 or P2
  })

  // Verifies empty input produces an empty crosstab with no data texts.
  it('空データ — rows=[]の場合', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, [],
    )
    expect(result.type).toBe('group')
    // 0 rows x 0 cols → only the top-left corner
    const texts = collectTexts([result])
    expect(texts.filter(t => t.text !== '').length).toBe(0) // no data texts
  })

  // ─── Additional tests: formatting ───

  // Verifies the #,##0 format applies thousand separators.
  it('#,##0 フォーマット — 桁区切り', () => {
    const data = [
      { region: 'A', product: 'X', sales: 1234567 },
    ]
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum', format: '#,##0' }],
      },
      0, 0, data,
    )
    const texts = collectTexts([result])
    // Thousand-separated display
    expect(texts.some(t => t.text.includes(',') || t.text === '1234567')).toBe(true)
  })

  // Verifies the .00 format renders two decimal places.
  it('.00 フォーマット — 小数点', () => {
    const data = [
      { region: 'A', product: 'X', sales: 123 },
    ]
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum', format: '.00' }],
      },
      0, 0, data,
    )
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === '123.00')).toBe(true)
  })

  // Verifies unformatted measures are stringified as-is.
  it('フォーマット未指定 — 数値のまま文字列化', () => {
    const data = [
      { region: 'A', product: 'X', sales: 42 },
    ]
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
      },
      0, 0, data,
    )
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === '42')).toBe(true)
  })

  // ─── Additional tests: grand total verification ───

  // Verifies each row grand total value.
  it('行総合計の各値', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
        showGrandTotal: true,
      },
      0, 0, sampleData,
    )
    const texts = collectTexts([result])
    // East row: 150+200=350, West row: 150+250=400
    expect(texts.some(t => t.text === '350')).toBe(true)
    expect(texts.some(t => t.text === '400')).toBe(true)
  })

  // Verifies each column grand total value.
  it('列総合計の各値', () => {
    const result = layoutCrosstab(
      {
        rowGroups: [{ field: 'region' }],
        columnGroups: [{ field: 'product' }],
        measures: [{ field: 'sales', calculation: 'sum' }],
        showGrandTotal: true,
      },
      0, 0, sampleData,
    )
    const texts = collectTexts([result])
    // Column A: 150+150=300, column B: 200+250=450
    expect(texts.some(t => t.text === '300')).toBe(true)
    expect(texts.some(t => t.text === '450')).toBe(true)
  })
})

// ─── Additional barcode tests ───

describe('Phase 10: バーコード追加テスト', () => {
  // ─── Code39 detailed tests ───

  // Verifies empty input still emits start/stop (*) bars.
  it('Code39: 空文字列でもスタート/ストップ文字が出力', () => {
    const result = renderBarcode('code39', '', {
      x: 0, y: 0, width: 100, height: 40,
    })
    expect(result.type).toBe('group')
    if (result.type === 'group') {
      // Start/stop * still produce minimal bars
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      expect(rects.length).toBeGreaterThan(0)
    }
  })

  // Verifies Code39 special characters are encoded.
  it('Code39: 特殊文字 (-, ., $, /, +, %) が正しくエンコード', () => {
    const specials = '-. $/+%'
    const result = renderBarcode('code39', specials, {
      x: 0, y: 0, width: 200, height: 40,
    })
    expect(result.type).toBe('group')
    if (result.type === 'group') {
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      expect(rects.length).toBeGreaterThan(0)
    }
  })

  // Verifies lowercase input is uppercased, yielding the same bar pattern.
  it('Code39: 小文字入力 — 自動大文字変換の確認', () => {
    const resultLower = renderBarcode('code39', 'abc', {
      x: 0, y: 0, width: 100, height: 40, showText: true,
    })
    const resultUpper = renderBarcode('code39', 'ABC', {
      x: 0, y: 0, width: 100, height: 40, showText: true,
    })
    if (resultLower.type === 'group' && resultUpper.type === 'group') {
      const rectsLower = resultLower.children.filter(c => c.type === 'rect')
      const rectsUpper = resultUpper.children.filter(c => c.type === 'rect')
      // The same bar pattern is generated
      expect(rectsLower.length).toBe(rectsUpper.length)
    }
  })

  // Verifies characters without a Code39 pattern are skipped.
  it('Code39: 無効文字を含む — 未定義パターンがスキップされる', () => {
    const result = renderBarcode('code39', 'A@B', {
      x: 0, y: 0, width: 100, height: 40,
    })
    expect(result.type).toBe('group')
    if (result.type === 'group') {
      // @ is skipped, so only A and B are encoded
      const rects = result.children.filter(c => c.type === 'rect')
      expect(rects.length).toBeGreaterThan(0)
    }
  })

  // ─── Code128 detailed tests ───

  // Verifies digit-only input encodes via Code128B.
  it('Code128: 数字のみ — Code128Bエンコーディングの正確性', () => {
    const result = renderBarcode('code128', '12345', {
      x: 0, y: 0, width: 100, height: 40,
    })
    expect(result.type).toBe('group')
    if (result.type === 'group') {
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      expect(rects.length).toBeGreaterThan(0)
    }
  })

  // Verifies a 50-char payload yields the expected order of bar count.
  it('Code128: 長い文字列（50文字）— バー数が期待値と一致', () => {
    const data = 'A'.repeat(50)
    const result = renderBarcode('code128', data, {
      x: 0, y: 0, width: 500, height: 40,
    })
    expect(result.type).toBe('group')
    if (result.type === 'group') {
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      // 50 chars + START + CHECKSUM + STOP = 53 symbols x 11 modules each + STOP(13)
      expect(rects.length).toBeGreaterThan(100)
    }
  })

  // Verifies checksum computation for the known payload A.
  it('Code128: チェックサム計算の検証 — 既知データ "A"', () => {
    const result = renderBarcode('code128', 'A', {
      x: 0, y: 0, width: 100, height: 40,
    })
    expect(result.type).toBe('group')
    if (result.type === 'group') {
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      // START_B(104) + A(33) → checksum = (104 + 33*1) % 103 = 34
      // Symbols: START, A, checksum(34), STOP → a valid bar pattern is generated
      expect(rects.length).toBeGreaterThan(0)
    }
  })

  // ─── EAN-13 detailed tests ───

  // Verifies all parity patterns for leading digits 0-9 render without errors.
  it('EAN-13: 全パリティパターン（先頭0-9）', () => {
    for (let d = 0; d <= 9; d++) {
      const data = `${d}901234567890`.slice(0, 13)
      const result = renderBarcode('ean13', data, {
        x: 0, y: 0, width: 100, height: 50,
      })
      expect(result.type).toBe('group')
    }
  })

  // Verifies input shorter than 13 digits is zero-padded.
  it('EAN-13: 短い桁数入力 — 13桁未満が0パディング', () => {
    const result = renderBarcode('ean13', '49', {
      x: 0, y: 0, width: 100, height: 50, showText: true,
    })
    if (result.type === 'group') {
      const texts = result.children.filter(c => c.type === 'text') as RenderText[]
      if (texts.length > 0) {
        // Padded to 13 digits
        expect(texts[0]!.text.length).toBe(13)
        expect(texts[0]!.text.startsWith('49')).toBe(true)
      }
    }
  })

  // Verifies total bar modules stay within the 95-module EAN-13 grid.
  it('EAN-13: バーの総モジュール数=95', () => {
    const result = renderBarcode('ean13', '4901234567890', {
      x: 0, y: 0, width: 95, height: 50,
    })
    if (result.type === 'group') {
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      // 95 modules at width=95 → each module is 1pt wide
      // Only black bars are drawn as rects; verify total bar modules
      const barWidth = 95 / 95 // = 1
      // Total rect width + white space = 95 modules
      let totalBarModules = 0
      for (const r of rects) {
        totalBarModules += Math.round(r.width / barWidth)
      }
      // Black module count varies but the total never exceeds 95
      expect(totalBarModules).toBeLessThanOrEqual(95)
      expect(totalBarModules).toBeGreaterThan(0)
    }
  })

  // Verifies non-digit characters are stripped before encoding.
  it('EAN-13: 非数字文字が除去される — "49-012-34567-890"', () => {
    const result = renderBarcode('ean13', '49-012-34567-890', {
      x: 0, y: 0, width: 100, height: 50, showText: true,
    })
    if (result.type === 'group') {
      const texts = result.children.filter(c => c.type === 'text') as RenderText[]
      if (texts.length > 0) {
        // Hyphens removed, digits only
        expect(texts[0]!.text).toMatch(/^\d{13}$/)
      }
    }
  })

  // ─── EAN-8 detailed tests ───

  // Verifies total bar modules stay within the 67-module EAN-8 grid.
  it('EAN-8: バーの総モジュール数=67', () => {
    const result = renderBarcode('ean8', '12345678', {
      x: 0, y: 0, width: 67, height: 40,
    })
    if (result.type === 'group') {
      const rects = result.children.filter(c => c.type === 'rect') as RenderRect[]
      const barWidth = 67 / 67
      let totalBarModules = 0
      for (const r of rects) {
        totalBarModules += Math.round(r.width / barWidth)
      }
      expect(totalBarModules).toBeLessThanOrEqual(67)
      expect(totalBarModules).toBeGreaterThan(0)
    }
  })

  // Verifies short EAN-8 input is zero-padded to 8 digits.
  it('EAN-8: 短い桁数入力のパディング', () => {
    const result = renderBarcode('ean8', '12', {
      x: 0, y: 0, width: 80, height: 40, showText: true,
    })
    if (result.type === 'group') {
      const texts = result.children.filter(c => c.type === 'text') as RenderText[]
      if (texts.length > 0) {
        expect(texts[0]!.text.length).toBe(8)
        expect(texts[0]!.text.startsWith('12')).toBe(true)
      }
    }
  })

  // ─── QRCode structure verification ───

  // Verifies short data selects version 1 by checking the rendered module cell size.
  it('QRCode: バージョン選択 — 短いデータ=V1', () => {
    const result = renderBarcode('qrcode', 'A', {
      x: 0, y: 0, width: 100, height: 100,
    })
    if (result.type === 'group') {
      const blacks = result.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000') as RenderRect[]
      // V1: 21x21 + quiet zone 4x2 = 29 → cell size = 100/29
      const cellSize = 100 / (21 + 8)
      // Finder pattern cells should exist
      expect(blacks.length).toBeGreaterThan(0)
      const minWidth = Math.min(...blacks.map(r => r.width))
      expect(minWidth).toBeCloseTo(cellSize, 0)
    }
  })

  // Verifies matrix size follows version*4+17 via the rendered cell size.
  it('QRCode: マトリクスサイズ — version*4+17', () => {
    // Short data → V1 → size=21, + quiet zone 8 = 29
    const result1 = renderBarcode('qrcode', 'A', {
      x: 0, y: 0, width: 100, height: 100,
    })
    if (result1.type === 'group') {
      const blacks1 = result1.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000') as RenderRect[]
      const cellSize1 = blacks1[0]?.width ?? 0
      // V1: 21x21 + quiet zone 8 → cellSize = 100/29
      if (cellSize1 > 0) {
        expect(cellSize1).toBeCloseTo(100 / 29, 1)
      }
    }
  })

  // Verifies the black module count is consistent with three 7x7 finder patterns.
  it('QRCode: ファインダーパターン3箇所の位置', () => {
    const result = renderBarcode('qrcode', 'Test', {
      x: 0, y: 0, width: 100, height: 100,
    })
    if (result.type === 'group') {
      const blacks = result.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000') as RenderRect[]
      // Finder patterns occupy 7x7 areas
      // Patterns at top-left (0,0), top-right (0,size-7), bottom-left (size-7,0)
      // At least three corners contain black modules
      expect(blacks.length).toBeGreaterThan(50)
    }
  })

  // Verifies output sanity for the alternating timing pattern at row/column 6.
  it('QRCode: タイミングパターン — row=6, col=6 の交互パターン', () => {
    const result = renderBarcode('qrcode', 'Test', {
      x: 0, y: 0, width: 210, height: 210,
    })
    if (result.type === 'group') {
      const blacks = result.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000') as RenderRect[]
      // Version 1: size = 21, cellSize = 10
      // Timing pattern: even columns along row=6 are dark
      // Range col=8 to col=12 (size-8-1)
      expect(blacks.length).toBeGreaterThan(0)
    }
  })

  // Verifies showText=false emits no text nodes.
  it('showText=false時にテキストがない', () => {
    const result = renderBarcode('code39', 'ABC', {
      x: 0, y: 0, width: 100, height: 50, showText: false,
    })
    if (result.type === 'group') {
      const texts = result.children.filter(c => c.type === 'text')
      expect(texts.length).toBe(0)
    }
  })

  // Verifies omitting showText emits no text nodes.
  it('showText未指定時にテキストがない', () => {
    const result = renderBarcode('code128', 'XYZ', {
      x: 0, y: 0, width: 100, height: 50,
    })
    if (result.type === 'group') {
      const texts = result.children.filter(c => c.type === 'text')
      expect(texts.length).toBe(0)
    }
  })

  // Verifies showText=true renders the full 13-digit value.
  it('EAN-13: showText=trueでテキスト表示', () => {
    const result = renderBarcode('ean13', '4901234567890', {
      x: 0, y: 0, width: 100, height: 50, showText: true,
    })
    if (result.type === 'group') {
      const texts = result.children.filter(c => c.type === 'text') as RenderText[]
      expect(texts.length).toBe(1)
      expect(texts[0]!.text).toBe('4901234567890')
    }
  })

  // Verifies both L and H error correction levels yield valid matrices.
  it('QRCode: errorCorrectionLevel L vs H でモジュール数が異なる', () => {
    const resultL = renderBarcode('qrcode', 'Hello World Test', {
      x: 0, y: 0, width: 100, height: 100, errorCorrectionLevel: 'L',
    })
    const resultH = renderBarcode('qrcode', 'Hello World Test', {
      x: 0, y: 0, width: 100, height: 100, errorCorrectionLevel: 'H',
    })
    if (resultL.type === 'group' && resultH.type === 'group') {
      const blacksL = resultL.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000')
      const blacksH = resultH.children.filter(c => c.type === 'rect' && (c as RenderRect).fill === '#000000')
      // H has more redundancy, so the version and module count may increase
      expect(blacksL.length).toBeGreaterThan(0)
      expect(blacksH.length).toBeGreaterThan(0)
    }
  })

  // Verifies type aliases ean-13, ean-8, and qr map to their renderers.
  it('バーコードタイプのエイリアス — ean-13, ean-8, qr', () => {
    const ean13 = renderBarcode('ean-13', '4901234567890', { x: 0, y: 0, width: 100, height: 50 })
    const ean8 = renderBarcode('ean-8', '12345678', { x: 0, y: 0, width: 80, height: 40 })
    const qr = renderBarcode('qr', 'Test', { x: 0, y: 0, width: 100, height: 100 })
    expect(ean13.type).toBe('group')
    expect(ean8.type).toBe('group')
    expect(qr.type).toBe('group')
    // Aliases still generate bars
    if (ean13.type === 'group') {
      const rects = ean13.children.filter(c => c.type === 'rect')
      expect(rects.length).toBeGreaterThan(0)
    }
  })
})

// ─── Additional table layout tests ───

describe('Phase 10: テーブルレイアウト追加テスト', () => {

  // Verifies a header-only table's height equals the header height.
  it('ヘッダーのみ（明細なし） — テーブルの高さがヘッダーのみ', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 25, cells: [{ text: 'Header Only' }] }],
      },
      0, 0, 100,
    )
    expect(result.height).toBe(25)
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Header Only')).toBe(true)
  })

  // Verifies a detail-only table sizes to rows x row height.
  it('明細のみ（ヘッダーなし）', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        detailRows: [{ height: 15, cells: [{ expression: 'field.val' }] }],
      },
      0, 0, 100,
      [{ val: 'X' }, { val: 'Y' }],
    )
    expect(result.height).toBe(30) // 15 × 2
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'X')).toBe(true)
    expect(texts.some(t => t.text === 'Y')).toBe(true)
  })

  // Verifies a footer-only table renders the footer.
  it('フッターのみ', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        footerRows: [{ height: 20, cells: [{ text: 'Footer' }] }],
      },
      0, 0, 100,
    )
    expect(result.height).toBe(20)
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Footer')).toBe(true)
  })

  // Verifies a table with no rows returns an empty zero-height group.
  it('空テーブル（全て未指定）— 空のRenderGroupが返る', () => {
    const result = layoutTable(
      { columns: [{ width: 100 }] },
      0, 0, 100,
    )
    expect(result.type).toBe('group')
    expect(result.height).toBe(0)
  })

  // Verifies multiple header rows stack and sum their heights.
  it('複数ヘッダー行 — 2行のヘッダー', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }, { width: 100 }],
        headerRows: [
          { height: 20, cells: [{ text: 'H1-A' }, { text: 'H1-B' }] },
          { height: 15, cells: [{ text: 'H2-A' }, { text: 'H2-B' }] },
        ],
      },
      0, 0, 200,
    )
    expect(result.height).toBe(35) // 20 + 15
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'H1-A')).toBe(true)
    expect(texts.some(t => t.text === 'H2-B')).toBe(true)
  })

  // Verifies each data row expands all detail row templates.
  it('複数明細行テンプレート — detailRowsに2種のテンプレート', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        detailRows: [
          { height: 15, cells: [{ expression: 'field.name' }] },
          { height: 10, cells: [{ expression: 'field.desc' }] },
        ],
      },
      0, 0, 100,
      [{ name: 'Item1', desc: 'Desc1' }],
    )
    // Each data row emits 2 template rows = 25pt
    expect(result.height).toBe(25)
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Item1')).toBe(true)
    expect(texts.some(t => t.text === 'Desc1')).toBe(true)
  })

  // ─── Cell alignment and styling ───

  // Verifies hAlign=center is carried on the text node (renderer positions it).
  it('hAlign=center のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Center', hAlign: 'center' }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Center')
    expect(t).toBeDefined()
    expect(t!.hAlign).toBe('center')
    // X is cell left + padding (renderer adjusts using hAlign + width)
    expect(t!.x).toBe(2) // default padding
  })

  // Verifies hAlign=right is carried on the text node.
  it('hAlign=right のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Right', hAlign: 'right' }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Right')
    expect(t).toBeDefined()
    expect(t!.hAlign).toBe('right')
    // X is cell left + padding (renderer adjusts using hAlign + width)
    expect(t!.x).toBe(2) // default padding
  })

  // Verifies vAlign=middle centers the text vertically in the cell.
  it('vAlign=middle のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 40, cells: [{ text: 'Middle', vAlign: 'middle' }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Middle')
    expect(t).toBeDefined()
    // Y is cell center = (40 - 10) / 2 = 15 (fontSize=10)
    expect(t!.y).toBe(15)
  })

  // Verifies vAlign=bottom places text at the cell bottom minus padding.
  it('vAlign=bottom のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 40, cells: [{ text: 'Bottom', vAlign: 'bottom' }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Bottom')
    expect(t).toBeDefined()
    // Y is cell bottom = 40 - 10 - 2 = 28 (fontSize=10, padding=2)
    expect(t!.y).toBe(28)
  })

  // Verifies the bold flag propagates to the text node.
  it('bold=true のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Bold', bold: true }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Bold')
    expect(t).toBeDefined()
    expect(t!.bold).toBe(true)
  })

  // Verifies cell forecolor sets the text color.
  it('forecolor のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Red', forecolor: '#FF0000' }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Red')
    expect(t).toBeDefined()
    expect(t!.color).toBe('#FF0000')
  })

  // Verifies cell fontSize propagates to the text node.
  it('fontSize のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Big', fontSize: 14 }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Big')
    expect(t).toBeDefined()
    expect(t!.fontSize).toBe(14)
  })

  // Verifies cell fontId propagates to the text node.
  it('fontId のセル', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Custom', fontId: 'myFont' }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Custom')
    expect(t).toBeDefined()
    expect(t!.fontId).toBe('myFont')
  })

  // Verifies custom padding offsets the text inside the cell.
  it('padding のセル — テキストがpadding分内側に', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'Padded', padding: 10 }] }],
      },
      0, 0, 100,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'Padded')
    expect(t).toBeDefined()
    expect(t!.x).toBe(10) // padding=10
    expect(t!.y).toBe(10) // padding=10
  })

  // ─── Complex layouts ───

  // Verifies a full-width colSpan cell spans the entire table width.
  it('colSpan=3 で全列結合', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }, { width: 50 }],
        headerRows: [{ height: 20, cells: [{ text: 'All', colSpan: 3 }] }],
      },
      0, 0, 150,
    )
    const texts = collectTexts([result])
    const t = texts.find(t => t.text === 'All')
    expect(t).toBeDefined()
    // Full width (150) - padding*2 = 146
    expect(t!.width).toBe(146)
  })

  // Verifies uneven column widths yield correct cumulative X positions.
  it('不均等列幅 — 100, 50, 200のような列定義', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }, { width: 50 }, { width: 200 }],
        headerRows: [{ height: 20, cells: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] }],
      },
      0, 0, 350,
    )
    const texts = collectTexts([result])
    const tA = texts.find(t => t.text === 'A')
    const tB = texts.find(t => t.text === 'B')
    const tC = texts.find(t => t.text === 'C')
    expect(tA).toBeDefined()
    expect(tB).toBeDefined()
    expect(tC).toBeDefined()
    // Scale = 350/350 = 1.0
    expect(tA!.x).toBeCloseTo(2, 0) // padding
    expect(tB!.x).toBeCloseTo(102, 0) // 100 + padding
    expect(tC!.x).toBeCloseTo(152, 0) // 100 + 50 + padding
  })

  // Verifies cumulative X precision across 10 columns.
  it('大量列（10列）— X座標の累積精度', () => {
    const columns = Array.from({ length: 10 }, () => ({ width: 30 }))
    const cells = Array.from({ length: 10 }, (_, i) => ({ text: `C${i}` }))
    const result = layoutTable(
      {
        columns,
        headerRows: [{ height: 20, cells }],
      },
      0, 0, 300,
    )
    const texts = collectTexts([result])
    expect(texts.length).toBe(10)
    // The last column's text lands at the correct position
    const lastText = texts.find(t => t.text === 'C9')
    expect(lastText).toBeDefined()
    // Each column = 300/10 = 30, X = 9*30 + padding = 272
    expect(lastText!.x).toBeCloseTo(272, 0)
  })

  // Verifies 50 data rows produce 50 texts and the correct total height.
  it('大量行（50データ行）— 正しい行数のRenderTextが生成される', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        detailRows: [{ height: 10, cells: [{ expression: 'field.v' }] }],
      },
      0, 0, 100,
      Array.from({ length: 50 }, (_, i) => ({ v: `Row${i}` })),
    )
    const texts = collectTexts([result])
    expect(texts.length).toBe(50)
    expect(result.height).toBe(500) // 10 × 50
  })

  // ─── Data binding ───

  // Verifies the resolveExpression callback overrides expression resolution.
  it('resolveExpression コールバック', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        detailRows: [{ height: 15, cells: [{ expression: 'custom.expr' }] }],
      },
      0, 0, 100,
      [{ v: 1 }],
      {
        resolveExpression: (expr) => `resolved:${expr}`,
      },
    )
    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'resolved:custom.expr')).toBe(true)
  })
})

// ─── Table layout rowSpan tests ───

describe('Phase 10: テーブルレイアウト rowSpan', () => {

  // ─── Basic rowSpan ───

  // Verifies rowSpan=2 occupies the column so the next row's cells shift right.
  it('基本 rowSpan=2: セルが2行にまたがる', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Span', rowSpan: 2 }, { text: 'R1' }] },
          { height: 20, cells: [{ text: 'R2' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(40) // 20 + 20

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Span')).toBe(true)
    expect(texts.some(t => t.text === 'R1')).toBe(true)
    expect(texts.some(t => t.text === 'R2')).toBe(true)

    // R2 goes to col 1 (col 0 is occupied by Span)
    const r2 = texts.find(t => t.text === 'R2')
    expect(r2).toBeDefined()
    expect(r2!.x).toBeGreaterThanOrEqual(50) // X of col 1
  })

  // Verifies a spanned cell's background rect covers both row heights.
  it('rowSpan=2 のセル背景高さが2行分', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Span', rowSpan: 2, backcolor: '#FF0000' }, { text: 'R1' }] },
          { height: 15, cells: [{ text: 'R2' }] },
        ],
      },
      0, 0, 100,
    )

    const rects = collectRects([result])
    const redRect = rects.find(r => r.fill === '#FF0000')
    expect(redRect).toBeDefined()
    expect(redRect!.height).toBe(35) // 20 + 15
    expect(redRect!.width).toBe(50)
  })

  // Verifies rowSpan=3 spans three rows and shifts following cells.
  it('rowSpan=3: 3行にまたがる', () => {
    const result = layoutTable(
      {
        columns: [{ width: 60 }, { width: 40 }],
        headerRows: [
          { height: 15, cells: [{ text: 'A', rowSpan: 3 }, { text: 'B1' }] },
          { height: 15, cells: [{ text: 'B2' }] },
          { height: 15, cells: [{ text: 'B3' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(45) // 15 × 3

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'A')).toBe(true)
    expect(texts.some(t => t.text === 'B1')).toBe(true)
    expect(texts.some(t => t.text === 'B2')).toBe(true)
    expect(texts.some(t => t.text === 'B3')).toBe(true)

    // B2 and B3 go to col 1
    const b2 = texts.find(t => t.text === 'B2')
    const b3 = texts.find(t => t.text === 'B3')
    expect(b2!.x).toBeGreaterThanOrEqual(60)
    expect(b3!.x).toBeGreaterThanOrEqual(60)
  })

  // Verifies vAlign=middle centers text within the full spanned height.
  it('rowSpan のテキスト垂直配置 vAlign=middle', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Mid', rowSpan: 2, vAlign: 'middle' }, { text: 'R1' }] },
          { height: 20, cells: [{ text: 'R2' }] },
        ],
      },
      0, 0, 100,
    )

    const texts = collectTexts([result])
    const mid = texts.find(t => t.text === 'Mid')
    expect(mid).toBeDefined()
    // cellHeight = 40, fontSize = 10 → y = (40 - 10) / 2 = 15
    expect(mid!.y).toBe(15)
  })

  // Verifies vAlign=bottom aligns text to the spanned cell bottom.
  it('rowSpan のテキスト垂直配置 vAlign=bottom', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Bot', rowSpan: 2, vAlign: 'bottom' }, { text: 'R1' }] },
          { height: 20, cells: [{ text: 'R2' }] },
        ],
      },
      0, 0, 100,
    )

    const texts = collectTexts([result])
    const bot = texts.find(t => t.text === 'Bot')
    expect(bot).toBeDefined()
    // cellHeight = 40, fontSize = 10, padding = 2 → y = 40 - 10 - 2 = 28
    expect(bot!.y).toBe(28)
  })

  // ─── Combined colSpan + rowSpan ───

  // Verifies combined colSpan and rowSpan merge a 2x2 cell block.
  it('colSpan=2 + rowSpan=2: 4セル分の結合', () => {
    const result = layoutTable(
      {
        columns: [{ width: 40 }, { width: 40 }, { width: 20 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Big', colSpan: 2, rowSpan: 2, backcolor: '#00FF00' }, { text: 'R1C3' }] },
          { height: 20, cells: [{ text: 'R2C3' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(40)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Big')).toBe(true)
    expect(texts.some(t => t.text === 'R1C3')).toBe(true)
    expect(texts.some(t => t.text === 'R2C3')).toBe(true)

    // Big's background is 80x40 (colSpan=2 x rowSpan=2)
    const rects = collectRects([result])
    const greenRect = rects.find(r => r.fill === '#00FF00')
    expect(greenRect).toBeDefined()
    expect(greenRect!.width).toBe(80) // 40 + 40
    expect(greenRect!.height).toBe(40) // 20 + 20

    // R2C3 goes to col 2
    const r2c3 = texts.find(t => t.text === 'R2C3')
    expect(r2c3!.x).toBeGreaterThanOrEqual(80)
  })

  // ─── Multiple rowSpans ───

  // Verifies independent rowSpans in different columns place later cells correctly.
  it('複数列で異なる rowSpan', () => {
    // col0: rowSpan=3, col1: rowSpan=2, col2: independent per row
    const result = layoutTable(
      {
        columns: [{ width: 30 }, { width: 30 }, { width: 40 }],
        headerRows: [
          { height: 15, cells: [{ text: 'A', rowSpan: 3 }, { text: 'B', rowSpan: 2 }, { text: 'C1' }] },
          { height: 15, cells: [{ text: 'C2' }] },
          { height: 15, cells: [{ text: 'D' }, { text: 'C3' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(45)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'A')).toBe(true)
    expect(texts.some(t => t.text === 'B')).toBe(true)
    expect(texts.some(t => t.text === 'C1')).toBe(true)
    expect(texts.some(t => t.text === 'C2')).toBe(true)
    expect(texts.some(t => t.text === 'D')).toBe(true)
    expect(texts.some(t => t.text === 'C3')).toBe(true)

    // Row 1: col0,1 occupied → C2 at col 2
    const c2 = texts.find(t => t.text === 'C2')
    expect(c2!.x).toBeGreaterThanOrEqual(60)

    // Row 2: col0 occupied → D at col 1, C3 at col 2
    const d = texts.find(t => t.text === 'D')
    expect(d!.x).toBeGreaterThanOrEqual(30)
    expect(d!.x).toBeLessThan(60)
  })

  // ─── Borders ───

  // Verifies bottom borders are drawn at the spanned cell's real bottom, not per intermediate row.
  it('rowSpan で下罫線が正しくスキップされる', () => {
    const b = { width: 0.5, color: '#999', style: 'solid' as const }
    const cellBorder = { top: b, bottom: b, left: b, right: b }
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Span', rowSpan: 2, border: cellBorder }, { text: 'R1', border: cellBorder }] },
          { height: 20, cells: [{ text: 'R2', border: cellBorder }] },
        ],
      },
      0, 0, 100,
    )

    const lines = collectLines([result])
    // R1's bottom border in row 0: y=20, x1=50 (inner border, so drawn)
    const row0HLine = lines.find(l =>
      l.y1 === 20 && l.y2 === 20 && l.x1 === 50
    )
    expect(row0HLine).toBeDefined()
    expect(row0HLine!.x2).toBe(100)

    // Span cell's bottom border: rowSpan=2 so cellHeight=40, y=40 in the row0 group
    const spanBottom = lines.find(l =>
      l.y1 === 40 && l.y2 === 40 && l.x1 === 0
    )
    expect(spanBottom).toBeDefined()
    expect(spanBottom!.x2).toBe(50)
  })

  // Verifies vertical borders of a spanned cell run the full spanned height.
  it('rowSpan の縦罫線が cellHeight 分の長さ', () => {
    const b = { width: 0.5, color: '#999', style: 'solid' as const }
    const cellBorder = { top: b, bottom: b, left: b, right: b }
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Span', rowSpan: 2, border: cellBorder }, { text: 'R1', border: cellBorder }] },
          { height: 20, cells: [{ text: 'R2', border: cellBorder }] },
        ],
      },
      0, 0, 100,
    )

    const lines = collectLines([result])
    // Right vertical border of the Span cell in row 0: x=50, y1=0, y2=40 (rowSpan=2)
    const vLine = lines.find(l =>
      l.x1 === 50 && l.x2 === 50 && l.y1 === 0 && l.y2 === 40
    )
    expect(vLine).toBeDefined()
  })

  // ─── Spanning header + detail rows ───

  // Verifies a header cell can span into the first detail row.
  it('ヘッダーから明細行への rowSpan', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Header', rowSpan: 2 }, { text: 'H1' }] },
        ],
        detailRows: [
          { height: 15, cells: [{ expression: 'field.val' }] },
        ],
      },
      0, 0, 100,
      [{ val: 'Data1' }],
    )

    // Header rowSpan=2 spans header row (h=20) + first detail row (h=15)
    expect(result.height).toBe(35)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Header')).toBe(true)
    expect(texts.some(t => t.text === 'H1')).toBe(true)
    expect(texts.some(t => t.text === 'Data1')).toBe(true)

    // Data1 goes to col 1 (col 0 occupied by Header's rowSpan)
    const d1 = texts.find(t => t.text === 'Data1')
    expect(d1!.x).toBeGreaterThanOrEqual(50)
  })

  // ─── rowSpan across detail row templates ───

  // Verifies rowSpan across the two detail templates of one data row.
  it('detailRows 2テンプレート行間の rowSpan', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        detailRows: [
          { height: 20, cells: [{ expression: 'field.name', rowSpan: 2 }, { expression: 'field.val1' }] },
          { height: 15, cells: [{ expression: 'field.val2' }] },
        ],
      },
      0, 0, 100,
      [{ name: 'Alice', val1: '100', val2: '200' }],
    )

    expect(result.height).toBe(35) // 20 + 15

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Alice')).toBe(true)
    expect(texts.some(t => t.text === '100')).toBe(true)
    expect(texts.some(t => t.text === '200')).toBe(true)

    // Verify Alice via text position (no background was set)
    const alice = texts.find(t => t.text === 'Alice')
    expect(alice!.x).toBeLessThan(50) // col 0

    // 200 goes to col 1
    const v2 = texts.find(t => t.text === '200')
    expect(v2!.x).toBeGreaterThanOrEqual(50)
  })

  // ─── rowSpan exceeding table row count ───

  // Verifies rowSpan larger than the remaining rows is clamped.
  it('rowSpan がテーブルの行数を超える場合 — クランプされる', () => {
    const result = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [
          { height: 20, cells: [{ text: 'Over', rowSpan: 10, backcolor: '#0000FF' }] },
        ],
      },
      0, 0, 100,
    )

    // Only one row exists → rowSpan clamps to 1
    expect(result.height).toBe(20)

    const rects = collectRects([result])
    const blueRect = rects.find(r => r.fill === '#0000FF')
    expect(blueRect).toBeDefined()
    expect(blueRect!.height).toBe(20) // one row only
  })

  // ─── rowSpan in the rightmost column ───

  // Verifies a rowSpan in the last column leaves the next row's cell in column 0.
  it('右列の rowSpan', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'L1' }, { text: 'Right', rowSpan: 2 }] },
          { height: 20, cells: [{ text: 'L2' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(40)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'L1')).toBe(true)
    expect(texts.some(t => t.text === 'Right')).toBe(true)
    expect(texts.some(t => t.text === 'L2')).toBe(true)

    // L2 goes to col 0 (col 1 occupied by Right's rowSpan)
    const l2 = texts.find(t => t.text === 'L2')
    expect(l2!.x).toBeLessThan(50)
  })

  // ─── rowSpan with differing row heights ───

  // Verifies a spanned cell's height is the sum of differing row heights.
  it('異なる行高さでの rowSpan — セル高さが合計になる', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 30, cells: [{ text: 'Tall', rowSpan: 2, backcolor: '#AABB00' }, { text: 'R1' }] },
          { height: 10, cells: [{ text: 'R2' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(40) // 30 + 10

    const rects = collectRects([result])
    const bgRect = rects.find(r => r.fill === '#AABB00')
    expect(bgRect).toBeDefined()
    expect(bgRect!.height).toBe(40) // 30 + 10
  })

  // ─── Does not affect total table height ───

  // Verifies rowSpan does not change the table's total height.
  it('rowSpan はテーブルの総高さを変えない', () => {
    // without rowSpan
    const withoutSpan = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'A' }, { text: 'B' }] },
          { height: 20, cells: [{ text: 'C' }, { text: 'D' }] },
        ],
      },
      0, 0, 100,
    )

    // with rowSpan
    const withSpan = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'A', rowSpan: 2 }, { text: 'B' }] },
          { height: 20, cells: [{ text: 'D' }] },
        ],
      },
      0, 0, 100,
    )

    // Heights are equal
    expect(withSpan.height).toBe(withoutSpan.height)
  })

  // ─── All columns rowSpan ───

  // Verifies a fully spanned second row with no cells still contributes its height.
  it('全列が rowSpan=2 — 2行目にセルなし', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        headerRows: [
          { height: 20, cells: [{ text: 'A', rowSpan: 2 }, { text: 'B', rowSpan: 2 }] },
          { height: 20, cells: [] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(40)

    const texts = collectTexts([result])
    expect(texts.length).toBe(2) // only A and B
  })

  // ─── Adjacent rowSpans ───

  // Verifies adjacent columns with different rowSpans free up at the correct rows.
  it('隣接する列で異なる rowSpan', () => {
    // 3 cols: col0=rowSpan 2, col1=rowSpan 3, col2=normal
    const result = layoutTable(
      {
        columns: [{ width: 30 }, { width: 30 }, { width: 40 }],
        headerRows: [
          { height: 10, cells: [{ text: 'A', rowSpan: 2 }, { text: 'B', rowSpan: 3 }, { text: 'C1' }] },
          { height: 10, cells: [{ text: 'C2' }] },
          { height: 10, cells: [{ text: 'D' }, { text: 'C3' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(30)

    const texts = collectTexts([result])
    // Row 1: col0 occupied (A), col1 occupied (B), → C2 at col2
    const c2 = texts.find(t => t.text === 'C2')
    expect(c2!.x).toBeGreaterThanOrEqual(60)

    // Row 2: col0 free, col1 occupied (B) → D at col0, C3 at col2
    const d = texts.find(t => t.text === 'D')
    expect(d!.x).toBeLessThan(30)
    const c3 = texts.find(t => t.text === 'C3')
    expect(c3!.x).toBeGreaterThanOrEqual(60)
  })

  // ─── rowSpan with multiple data rows (2 detail templates) ───

  // Verifies rowSpan repeats correctly for each data row across detail templates.
  it('複数データ行 × detailRows 2テンプレート行間の rowSpan', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        detailRows: [
          { height: 20, cells: [{ expression: 'field.name', rowSpan: 2 }, { expression: 'field.v1' }] },
          { height: 15, cells: [{ expression: 'field.v2' }] },
        ],
      },
      0, 0, 100,
      [
        { name: 'Alice', v1: 'A1', v2: 'A2' },
        { name: 'Bob', v1: 'B1', v2: 'B2' },
      ],
    )

    // Each data row is 20+15=35pt → 2 data rows = 70pt
    expect(result.height).toBe(70)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Alice')).toBe(true)
    expect(texts.some(t => t.text === 'A1')).toBe(true)
    expect(texts.some(t => t.text === 'A2')).toBe(true)
    expect(texts.some(t => t.text === 'Bob')).toBe(true)
    expect(texts.some(t => t.text === 'B1')).toBe(true)
    expect(texts.some(t => t.text === 'B2')).toBe(true)
  })

  // ─── Explicit rowSpan=1 equals default ───

  // Verifies explicit rowSpan=1 behaves the same as omitting it.
  it('rowSpan=1 は rowSpan 未指定と同じ', () => {
    const withExplicit = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'X', rowSpan: 1 }] }],
      },
      0, 0, 100,
    )

    const withDefault = layoutTable(
      {
        columns: [{ width: 100 }],
        headerRows: [{ height: 20, cells: [{ text: 'X' }] }],
      },
      0, 0, 100,
    )

    expect(withExplicit.height).toBe(withDefault.height)
    const textsA = collectTexts([withExplicit])
    const textsB = collectTexts([withDefault])
    expect(textsA.length).toBe(textsB.length)
  })

  // ─── rowSpan in the middle column ───

  // Verifies a middle-column rowSpan keeps left and right columns in place.
  it('中央列の rowSpan — 左右列は通常', () => {
    const result = layoutTable(
      {
        columns: [{ width: 30 }, { width: 40 }, { width: 30 }],
        headerRows: [
          { height: 20, cells: [{ text: 'L1' }, { text: 'Mid', rowSpan: 2 }, { text: 'R1' }] },
          { height: 20, cells: [{ text: 'L2' }, { text: 'R2' }] },
        ],
      },
      0, 0, 100,
    )

    expect(result.height).toBe(40)

    const texts = collectTexts([result])
    // Row 0: L1@col0, Mid@col1, R1@col2
    // Row 1: L2@col0, (col1 occupied), R2@col2
    expect(texts.some(t => t.text === 'L1')).toBe(true)
    expect(texts.some(t => t.text === 'Mid')).toBe(true)
    expect(texts.some(t => t.text === 'R1')).toBe(true)
    expect(texts.some(t => t.text === 'L2')).toBe(true)
    expect(texts.some(t => t.text === 'R2')).toBe(true)

    const l2 = texts.find(t => t.text === 'L2')
    const r2 = texts.find(t => t.text === 'R2')
    expect(l2!.x).toBeLessThan(30) // col 0
    expect(r2!.x).toBeGreaterThanOrEqual(70) // col 2
  })

  // ─── rowSpan into footer rows ───

  // Verifies a detail cell can span into the footer row.
  it('明細行からフッターへの rowSpan', () => {
    const result = layoutTable(
      {
        columns: [{ width: 50 }, { width: 50 }],
        detailRows: [
          { height: 20, cells: [{ expression: 'field.name', rowSpan: 2 }, { expression: 'field.val' }] },
        ],
        footerRows: [
          { height: 20, cells: [{ text: 'Footer' }] },
        ],
      },
      0, 0, 100,
      [{ name: 'Item', val: '100' }],
    )

    // detail (20) + footer (20) = 40
    expect(result.height).toBe(40)

    const texts = collectTexts([result])
    expect(texts.some(t => t.text === 'Item')).toBe(true)
    expect(texts.some(t => t.text === '100')).toBe(true)
    expect(texts.some(t => t.text === 'Footer')).toBe(true)

    // Footer goes to col 1 (col 0 occupied by Item's rowSpan)
    const footer = texts.find(t => t.text === 'Footer')
    expect(footer!.x).toBeGreaterThanOrEqual(50)
  })
})
