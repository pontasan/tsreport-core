/**
 * Tagged PDF / accessibility tests.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { PdfBackend } from '../../src/renderer/pdf-backend.js'
import { PdfImporter } from '../../src/pdf/pdf-page-importer.js'
import { render } from '../../src/renderer/renderer.js'
import type { RenderDocument, StructureTag } from '../../src/types/render.js'
import type { PdfRawValueDef } from '../../src/types/template.js'
import { pdfToText } from './pdf-test-utils.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font

beforeAll(() => {
  const buf = readFileSync(join(FIXTURES, 'Roboto-Regular.ttf'))
  font = Font.load(buf.buffer as ArrayBuffer)
})

function generateTaggedPdf(doc: RenderDocument): { bytes: Uint8Array; text: string } {
  const backend = new PdfBackend({ fonts: { default: font } })
  render(doc, backend)
  const bytes = backend.toUint8Array()
  return { bytes, text: pdfToText(bytes) }
}

describe('Tagged PDF 基本構造', () => {
  // Verifies that tagged=true emits /StructTreeRoot and /MarkInfo Marked=true in the Catalog.
  it('tagged=true でStructTreeRoot が Catalog に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Hello',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P' },
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/StructTreeRoot')
    expect(text).toContain('/MarkInfo << /Marked true >>')
  })

  // Verifies that no structure tree is emitted for untagged documents.
  it('tagged=false ではStructTreeRoot が含まれない', () => {
    const doc: RenderDocument = {
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'No tags',
          fontId: 'default', fontSize: 12, color: '#000000',
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).not.toContain('/StructTreeRoot')
  })

  // Verifies that the document language is written to the Catalog's /Lang entry.
  it('ドキュメント言語が Catalog の /Lang に設定される', () => {
    const doc: RenderDocument = {
      tagged: true,
      lang: 'ja',
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Test',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P' },
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/Lang (ja)')
  })
})

describe('構造要素の生成', () => {
  // Verifies that a tagged text node produces a StructElem with /S /P and an /MCID 0 marked-content ID.
  it('テキストノードに P タグが付与される', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Paragraph',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/Type /StructElem')
    expect(text).toContain('/S /P')
    expect(text).toContain('/MCID 0')
  })

  // Verifies that tagged content is wrapped in BDC/EMC marked-content operators in the content stream.
  it('コンテンツストリームに BDC/EMC が含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Tagged',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'Span' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/Span << /MCID 0 >> BDC')
    expect(text).toContain('EMC')
  })

  // Verifies container roles appear only in the structure tree while leaf roles get BDC marked content.
  it('コンテナロール (Document/Table/TR) は BDC/EMC を出力しない', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 595, height: 842,
          tag: { role: 'Document' },
          children: [{
            type: 'group', x: 0, y: 0, width: 595, height: 100,
            tag: { role: 'Table' },
            children: [{
              type: 'group', x: 0, y: 0, width: 595, height: 50,
              tag: { role: 'TR' },
              children: [{
                type: 'text', x: 10, y: 10, text: 'Cell',
                fontId: 'default', fontSize: 12, color: '#000000',
                tag: { role: 'TD' },
              }],
            }],
          }],
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    // Container roles must not emit BDC
    expect(text).not.toContain('/Document <<')
    expect(text).not.toContain('/Table <<')
    expect(text).not.toContain('/TR <<')
    // Content roles do emit BDC
    expect(text).toContain('/TD << /MCID 0 >> BDC')
    // The structure tree still contains every role
    expect(text).toContain('/S /Document')
    expect(text).toContain('/S /Table')
    expect(text).toContain('/S /TR')
    expect(text).toContain('/S /TD')
  })

  // Verifies standard PDF grouping roles stay in the structure tree without marked-content wrappers.
  it('標準グルーピングロールは BDC を出力しない', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 595, height: 842,
          tag: { role: 'Art' },
          children: [{
            type: 'group', x: 0, y: 0, width: 595, height: 100,
            tag: { role: 'Index' },
            children: [{
              type: 'text', x: 10, y: 10, text: 'Entry',
              fontId: 'default', fontSize: 12, color: '#000000',
              tag: { role: 'Reference' },
            }],
          }],
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).not.toContain('/Art <<')
    expect(text).not.toContain('/Index <<')
    expect(text).toContain('/Reference << /MCID 0 >> BDC')
    expect(text).toContain('/S /Art')
    expect(text).toContain('/S /Index')
    expect(text).toContain('/S /Reference')
  })

  // Verifies PDF 1.7 inline, ruby, warichu, and illustration roles can be emitted.
  it('標準インライン/ルビ/割注/図版ロールを出力できる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [
          {
            type: 'text', x: 72, y: 72, text: 'Quote',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'Quote' },
          },
          {
            type: 'group', x: 72, y: 100, width: 100, height: 20,
            tag: { role: 'Ruby' },
            children: [{
              type: 'text', x: 0, y: 0, text: 'base',
              fontId: 'default', fontSize: 12, color: '#000000',
              tag: { role: 'RB' },
            }, {
              type: 'text', x: 0, y: 10, text: 'ruby',
              fontId: 'default', fontSize: 8, color: '#000000',
              tag: { role: 'RT' },
            }],
          },
          {
            type: 'group', x: 72, y: 140, width: 100, height: 20,
            tag: { role: 'Warichu' },
            children: [{
              type: 'text', x: 0, y: 0, text: 'wari',
              fontId: 'default', fontSize: 8, color: '#000000',
              tag: { role: 'WT' },
            }],
          },
          {
            type: 'text', x: 72, y: 180, text: 'form field',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'Form' },
          },
        ],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/S /Quote')
    expect(text).toContain('/S /Ruby')
    expect(text).toContain('/S /RB')
    expect(text).toContain('/S /RT')
    expect(text).toContain('/S /Warichu')
    expect(text).toContain('/S /WT')
    expect(text).toContain('/S /Form')
    const imported = PdfImporter.open(bytes).importStructureTree()
    const ruby = imported.find(function (node) { return node.role === 'Ruby' })!
    const warichu = imported.find(function (node) { return node.role === 'Warichu' })!
    expect(ruby.ruby).toMatchObject({ bases: [{ role: 'RB' }], rubyTexts: [{ role: 'RT' }], punctuations: [] })
    expect(warichu.warichu).toMatchObject({ texts: [{ role: 'WT' }], punctuations: [] })
    expect(text).toContain('/Quote << /MCID 0 >> BDC')
    expect(text).toContain('/RB << /MCID 1 >> BDC')
    expect(text).toContain('/RT << /MCID 2 >> BDC')
    expect(text).toContain('/WT << /MCID 3 >> BDC')
    expect(text).toContain('/Form << /MCID 4 >> BDC')
  })

  // Verifies that Artifact-tagged content uses /Artifact BMC (excluded from the structure tree).
  it('Artifact タグは /Artifact BMC で出力される', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Page number',
          fontId: 'default', fontSize: 10, color: '#999999',
          tag: { role: 'Artifact' },
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/Artifact BMC')
    expect(text).toContain('EMC')
  })
})

describe('構造ツリーの親子関係', () => {
  // Verifies that nested tags (Sect > H1/P) all appear as structure elements under the StructTreeRoot.
  it('ネストされた構造要素の親子関係が正しい', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 595, height: 842,
          tag: { role: 'Sect' },
          children: [
            {
              type: 'text', x: 72, y: 72, text: 'Heading',
              fontId: 'default', fontSize: 16, color: '#000000',
              tag: { role: 'H1' },
            },
            {
              type: 'text', x: 72, y: 100, text: 'Body text',
              fontId: 'default', fontSize: 12, color: '#000000',
              tag: { role: 'P' },
            },
          ],
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    // StructTreeRoot exists
    expect(text).toContain('/Type /StructTreeRoot')
    // Structure elements exist
    expect(text).toContain('/S /Sect')
    expect(text).toContain('/S /H1')
    expect(text).toContain('/S /P')
  })

  // Verifies that the page dict carries a /StructParents key into the parent tree.
  it('StructParents がページ dict に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Test',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/StructParents 0')
  })

  // Verifies that a /ParentTree number tree is generated for marked-content-to-StructElem lookup.
  it('ParentTree が生成される', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'First',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P' },
        }, {
          type: 'text', x: 72, y: 100, text: 'Second',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/ParentTree')
    expect(text).toContain('/Nums')
    expect(text).toContain('/ParentTreeNextKey 1')
  })

  it('MCIDを持たないページにはStructParentsを付けない', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{ width: 100, height: 100, children: [] }, {
        width: 100, height: 100,
        children: [{ type: 'text', x: 10, y: 20, text: 'Tagged', fontId: 'default', fontSize: 10, color: '#000000', tag: { role: 'P' } }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text.match(/\/StructParents/g)).toHaveLength(1)
    expect(text).toContain('/StructParents 1')
    expect(text).toContain('/ParentTreeNextKey 2')
  })

})

describe('構造要素の属性', () => {
  // Verifies that alt text on a Figure tag is emitted as an /Alt entry.
  it('alt テキストが StructElem と BDC の両方に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 72, y: 72, width: 200, height: 200,
          tag: { role: 'Figure', alt: 'A chart showing sales data' },
          children: [{
            type: 'rect', x: 0, y: 0, width: 200, height: 200, fill: '#CCCCCC',
          }],
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/Alt (A chart showing sales data)')
  })

  // Verifies that a per-element lang attribute is written as /Lang on the StructElem.
  it('lang が StructElem に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'English text',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'Span', lang: 'en' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/Lang (en)')
  })

  // Verifies that replacement text is emitted for text extraction and assistive technology.
  it('ActualText が StructElem と BDC に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: '①',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'Span', actualText: '1' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/ActualText (1)')
    expect(text).toContain('/Span << /MCID 0 /ActualText (1) >> BDC')
  })

  // Verifies that abbreviation expansion is emitted as the PDF /E structure attribute.
  it('expandedText が /E として StructElem と BDC に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'CPU',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'Span', expandedText: 'Central Processing Unit' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/E (Central Processing Unit)')
    expect(text).toContain('/Span << /MCID 0 /E (Central Processing Unit) >> BDC')
  })

  // Verifies that a TH scope attribute maps to /Scope /Column in the StructElem attributes.
  it('TH の scope 属性が StructElem に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Name',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'TH', scope: 'column' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/Scope /Column')
  })

  // Verifies that table cell span and header association attributes are emitted on TH/TD StructElem objects.
  it('TH/TD の rowSpan colSpan headers 属性が StructElem に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 72, y: 72, width: 300, height: 80,
          tag: { role: 'Table' },
          children: [{
            type: 'group', x: 0, y: 0, width: 300, height: 40,
            tag: { role: 'TR' },
            children: [{
              type: 'text', x: 0, y: 0, text: 'Name',
              fontId: 'default', fontSize: 12, color: '#000000',
              tag: { role: 'TH', id: 'h-name', scope: 'column' },
            }],
          }, {
            type: 'group', x: 0, y: 40, width: 300, height: 40,
            tag: { role: 'TR' },
            children: [{
              type: 'text', x: 0, y: 0, text: 'Alice',
              fontId: 'default', fontSize: 12, color: '#000000',
              tag: { role: 'TD', rowSpan: 2, colSpan: 3, headers: ['h-name'] },
            }],
          }],
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/ID (h-name)')
    expect(text).toContain('/A << /O /Table /RowSpan 2 /ColSpan 3 /Headers [(h-name)] >>')
    const roots = PdfImporter.open(bytes).importStructureTree()
    const table = roots[0]!.children[1]!.children[0]!.table!
    expect(table).toMatchObject({ rowSpan: 2, colSpan: 3, headerIds: ['h-name'], headerElementIndexes: [2] })
  })

  // Verifies that PDF layout attributes are emitted under the /Layout attribute owner.
  it('Layout 属性が StructElem に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Aligned paragraph',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: {
            role: 'P',
            layout: {
              placement: 'block',
              writingMode: 'lr-tb',
              bbox: [72, 700, 240, 730],
              width: 'auto',
              height: 30,
              startIndent: 12,
              endIndent: 8,
              textIndent: 18,
              spaceBefore: 4,
              spaceAfter: 6,
              textAlign: 'justify',
              blockAlign: 'before',
              inlineAlign: 'center',
            },
          },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/A << /O /Layout /Placement /Block /WritingMode /LrTb /BBox [72 700 240 730] /Width /Auto /Height 30 /StartIndent 12 /EndIndent 8 /TextIndent 18 /SpaceBefore 4 /SpaceAfter 6 /TextAlign /Justify /BlockAlign /Before /InlineAlign /Center >>')
  })

  // Verifies that PDF list numbering attributes are emitted under the /List attribute owner.
  it('ListNumbering 属性が StructElem に含まれる', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 72, y: 72, width: 200, height: 40,
          tag: { role: 'L', listNumbering: 'lower-roman' },
          children: [{
            type: 'text', x: 0, y: 0, text: 'Item',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'LI' },
          }],
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/A << /O /List /ListNumbering /LowerRoman >>')
    expect(PdfImporter.open(bytes).importStructureTree()[0]!.list).toEqual({ numbering: 'LowerRoman' })
  })

  // Verifies that multiple structure attribute owners are emitted as the PDF /A array form.
  it('複数属性 owner は /A 配列として出力される', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Name',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: {
            role: 'TH',
            scope: 'row',
            rowSpan: 2,
            layout: { placement: 'inline', inlineAlign: 'end' },
          },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/A [<< /O /Layout /Placement /Inline /InlineAlign /End >> << /O /Table /Scope /Row /RowSpan 2 >>]')
  })
})

describe('複数ページ', () => {
  // Verifies that each page gets its own /StructParents index when tags span multiple pages.
  it('複数ページにまたがるタグ付き要素が正しく処理される', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [
        {
          width: 595, height: 842,
          children: [{
            type: 'text', x: 72, y: 72, text: 'Page 1',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'P' },
          }],
        },
        {
          width: 595, height: 842,
          children: [{
            type: 'text', x: 72, y: 72, text: 'Page 2',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'P' },
          }],
        },
      ],
    }
    const { text } = generateTaggedPdf(doc)
    // Both pages carry a StructParents entry
    expect(text).toContain('/StructParents 0')
    expect(text).toContain('/StructParents 1')
  })
})

describe('画像の構造タグ', () => {
  // Verifies that a tagged image node yields a Figure StructElem with alt text.
  it('RenderImage に Figure タグが付与される', () => {
    const doc: RenderDocument = {
      tagged: true,
      images: { 'test-img': new Uint8Array([
        // Minimal valid JPEG: SOI + APP0 (JFIF) + SOF0 + SOS + EOI
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00,
        0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7B, 0x40,
        0xFF, 0xD9,
      ]) },
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'image', x: 72, y: 72, width: 200, height: 150,
          imageId: 'test-img',
          tag: { role: 'Figure', alt: 'Test image' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/S /Figure')
    expect(text).toContain('/Alt (Test image)')
  })
})

describe('パスの構造タグ', () => {
  // Verifies that a tagged path node is wrapped in Figure BDC/EMC and appears in the structure tree.
  it('RenderPath に構造タグが付与される', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'path',
          commands: new Uint8Array([0, 1, 1, 3]),  // M, L, L, Close
          coords: new Float32Array([72, 72, 172, 72, 172, 172]),
          fill: '#FF0000',
          tag: { role: 'Figure', alt: 'Red triangle' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/S /Figure')
    expect(text).toContain('/Figure << /MCID 0')
    expect(text).toContain('EMC')
  })
})

describe('Tagged PDF 構造精緻化 (A10)', () => {
  // /T (title), /ID, /Pg on a content structure element, and StructTreeRoot /IDTree.
  it('StructElem に /T /ID /Pg を、StructTreeRoot に /IDTree を出力する', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 72, text: 'Section title',
          fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'H1', title: 'Introduction', id: 'sec-intro' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/T (Introduction)')
    expect(text).toContain('/ID (sec-intro)')
    expect(text).toMatch(/\/Pg \d+ 0 R/)
    expect(text).toContain('/IDTree ')
    expect(text).toContain('(sec-intro) ')
  })

  // Table structure element carries a /Summary describing the table.
  it('Table 構造要素に /Summary を出力する', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 400, height: 100,
          tag: { role: 'Table', summary: 'Quarterly sales figures' },
          children: [{
            type: 'text', x: 10, y: 20, text: 'Q1',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'TD' },
          }],
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/S /Table')
    expect(text).toContain('/Summary (Quarterly sales figures)')
  })
})

describe('Tagged PDF Artifact 細分 (A10)', () => {
  // Pagination header artifact carries /Type and /Subtype in its marked content.
  it('Artifact に /Type /Subtype を出力する', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'text', x: 72, y: 20, text: 'Page header',
          fontId: 'default', fontSize: 10, color: '#000000',
          tag: { role: 'Artifact', artifactType: 'Pagination', artifactSubtype: 'Header' },
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/Artifact << /Type /Pagination /Subtype /Header >> BDC')
    expect(text).toContain('EMC')
    expect(PdfImporter.open(bytes).importMarkedContentArtifacts()).toEqual([{ pageIndex: 0, type: 'Pagination', subtype: 'Header' }])
  })

  it('Artifact に /BBox /Attached を出力する', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'rect', x: 0, y: 822, width: 595, height: 20, fill: '#000000',
          tag: {
            role: 'Artifact', artifactType: 'Layout', artifactBBox: [0, 822, 595, 842],
            artifactAttached: ['Bottom', 'Left', 'Right'],
          },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/Artifact << /Type /Layout /BBox [0 822 595 842] /Attached [/Bottom /Left /Right] >> BDC')
  })

  it('extracts Artifact metadata from Form XObject content', () => {
    const { bytes } = generateTaggedPdf({
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'group', x: 10, y: 10, width: 100, height: 40,
        pdfForm: { bbox: [0, 0, 100, 40], matrix: [1, 0, 0, 1, 0, 0], invocationMatrix: [1, 0, 0, 1, 10, 10] },
        children: [{
          type: 'text', x: 0, y: 20, text: 'Repeated header', fontId: 'default', fontSize: 10, color: '#000000',
          tag: {
            role: 'Artifact', artifactType: 'Pagination', artifactSubtype: 'Header',
            actualText: 'Header', lang: 'en-US',
          },
        }],
      }] }],
    })
    expect(PdfImporter.open(bytes).importMarkedContentArtifacts()).toMatchObject([{
      pageIndex: 0, type: 'Pagination', subtype: 'Header', actualText: 'Header', lang: 'en-US',
      streamObject: { generation: 0 },
    }])
  })

  it('Artifact property combinations are validated', () => {
    const nonArtifact: RenderDocument = {
      tagged: true,
      pages: [{ width: 100, height: 100, children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, tag: { role: 'P', artifactType: 'Layout' } }] }],
    }
    expect(() => generateTaggedPdf(nonArtifact)).toThrow(/require the Artifact role/)
    const subtypeWithoutPagination: RenderDocument = {
      tagged: true,
      pages: [{ width: 100, height: 100, children: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, tag: { role: 'Artifact', artifactSubtype: 'Header' } }] }],
    }
    expect(() => generateTaggedPdf(subtypeWithoutPagination)).toThrow(/requires Type Pagination/)
  })

  // A bare artifact (no classification) still emits /Artifact BMC.
  it('分類なし Artifact は /Artifact BMC を出力する', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'rect', x: 0, y: 0, width: 595, height: 20, fill: '#eeeeee',
          tag: { role: 'Artifact' },
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/Artifact BMC')
    expect(text).not.toContain('/S /Artifact')
  })
})

describe('Tagged PDF RoleMap カスタム構造型 (A10)', () => {
  // Custom roles are mapped to standard types via /RoleMap; the mapped target
  // decides container vs content (BDC) classification.
  it('カスタムロールを /RoleMap で標準型へマップする', () => {
    const doc: RenderDocument = {
      tagged: true,
      roleMap: { Chapter: 'Sect', Callout: 'Span' },
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 400, height: 100,
          tag: { role: 'Chapter', title: 'Chapter 1' },
          children: [{
            type: 'text', x: 10, y: 20, text: 'Important',
            fontId: 'default', fontSize: 12, color: '#000000',
            tag: { role: 'Callout' },
          }],
        }],
      }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/RoleMap << /Chapter /Sect /Callout /Span >>')
    expect(text).toContain('/S /Chapter')        // custom role kept as the structure type
    expect(text).toContain('/S /Callout')
    // Chapter maps to a container (Sect) -> no content BDC; Callout maps to
    // content (Span) -> BDC in the content stream.
    expect(text).toContain('/Callout << /MCID 0 >> BDC')
    expect(text).not.toContain('/Chapter << /MCID')
    expect(() => PdfImporter.open(bytes).importPage(0)).not.toThrow()
  })

  it('resolves transitive role mappings and rejects cycles', () => {
    const doc: RenderDocument = {
      tagged: true,
      roleMap: { Chapter: 'SectionLike' as StructureTag['role'], SectionLike: 'Sect' },
      pages: [{ width: 200, height: 100, children: [{
        type: 'group', x: 0, y: 0, width: 100, height: 50, tag: { role: 'Chapter' }, children: [],
      }] }],
    }
    const { bytes, text } = generateTaggedPdf(doc)
    expect(text).toContain('/RoleMap << /Chapter /SectionLike /SectionLike /Sect >>')
    expect(PdfImporter.open(bytes).importStructureTree()[0]).toMatchObject({ role: 'Chapter', mappedRole: 'Sect' })
    expect(() => generateTaggedPdf({
      tagged: true,
      roleMap: { A: 'B' as StructureTag['role'], B: 'A' as StructureTag['role'] },
      pages: [{ width: 10, height: 10, children: [] }],
    })).toThrow(/cycle/)
  })
})

describe('Tagged PDF Link注釈のOBJR統合 (A10)', () => {
  // A Link annotation inside a Link structure element is joined to the tree via
  // an OBJR in the element's /K, with /StructParent + a ParentTree entry.
  it('Link構造要素内のリンク注釈を OBJR で構造ツリーへ統合する', () => {
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 72, y: 72, width: 200, height: 20,
          tag: { role: 'Link' },
          link: { type: 'uri', target: 'https://example.com' },
          children: [{
            type: 'text', x: 0, y: 12, text: 'Visit',
            fontId: 'default', fontSize: 12, color: '#0000ff',
            tag: { role: 'Span' },
          }],
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/S /Link')
    expect(text).toContain('/Subtype /Link')
    // OBJR reference back to the annotation object, and StructParent on the annot.
    expect(text).toContain('/Type /OBJR')
    expect(text).toMatch(/\/StructParent \d+/)
  })

  it('明示annotation subtypeをstructure ID経由でOBJRへ接続する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      annotations: [{
        subtype: 'Text', pageIndex: 0, x: 20, y: 20, width: 20, height: 20,
        contents: 'Review note', structureElementId: 'note-owner',
      }],
    })
    render({
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'Owner', fontId: 'default', fontSize: 12, color: '#000000',
        tag: { role: 'Note', id: 'note-owner' },
      }] }],
    }, backend)
    const bytes = backend.toUint8Array()
    const structure = PdfImporter.open(bytes).importStructureTree()
    expect(structure[0]!.content).toContainEqual(expect.objectContaining({
      kind: 'annotation', pageIndex: 0, annotationIndex: 0,
    }))
    expect(pdfToText(bytes)).toMatch(/\/Subtype \/Text[\s\S]*\/StructParent \d+/)
  })

  it('任意のindirect objectをstructure ID経由でOBJRへ接続する', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      structureObjects: [{
        structureElementId: 'object-owner',
        object: { kind: 'dictionary', entries: { Type: { kind: 'name', value: 'StructureObject' }, Value: 42 } },
      }],
    })
    render({
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'Owner', fontId: 'default', fontSize: 12, color: '#000000',
        tag: { role: 'P', id: 'object-owner' },
      }] }],
    }, backend)
    const bytes = backend.toUint8Array()
    expect(PdfImporter.open(bytes).importStructureTree()[0]!.content).toContainEqual(expect.objectContaining({ kind: 'object' }))
    expect(pdfToText(bytes)).toMatch(/\/Type \/StructureObject \/Value 42 \/StructParent \d+/)
  })

  it('Form XObject内のMCIDをForm StructParentsとMCR Stmへ接続する', () => {
    const { bytes, text } = generateTaggedPdf({
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'group', x: 20, y: 10, width: 100, height: 50,
        pdfForm: {
          bbox: [0, 0, 100, 50], matrix: [1, 0, 0, 1, 0, 0], invocationMatrix: [1, 0, 0, 1, 20, 10],
        },
        children: [{
          type: 'text', x: 5, y: 15, text: 'Form text', fontId: 'default', fontSize: 12, color: '#000000',
          tag: { role: 'P', id: 'form-text' },
        }],
      }] }],
    })
    expect(text).toMatch(/\/Subtype \/Form[\s\S]*\/StructParents 1/)
    expect(text).toMatch(/\/Type \/MCR \/MCID 0 \/Stm \d+ 0 R \/Pg \d+ 0 R/)
    expect(text.match(/\/StructParents/g)).toHaveLength(1)
    const content = PdfImporter.open(bytes).importStructureTree()[0]!.content[0]!
    expect(content).toMatchObject({ kind: 'mcid', pageIndex: 0, mcid: 0, streamObject: { structParents: 1 } })
  })
})

describe('Tagged PDF ClassMap 属性重複排除 (A10)', () => {
  // Two cells sharing the same layout attributes are hoisted into a /ClassMap
  // class referenced by /C instead of repeating /A inline.
  it('共有属性を /ClassMap へ集約し /C で参照する', () => {
    const cell = (x: number): RenderDocument['pages'][number]['children'][number] => ({
      type: 'text', x, y: 20, text: 'x',
      fontId: 'default', fontSize: 12, color: '#000000',
      tag: { role: 'TD', layout: { textAlign: 'center' } },
    })
    const doc: RenderDocument = {
      tagged: true,
      pages: [{
        width: 595, height: 842,
        children: [{
          type: 'group', x: 0, y: 0, width: 400, height: 40,
          tag: { role: 'Table' },
          children: [cell(10), cell(60), cell(110)],
        }],
      }],
    }
    const { text } = generateTaggedPdf(doc)
    expect(text).toContain('/ClassMap <<')
    expect(text).toMatch(/\/C0 <</)          // class definition
    expect(text).toContain('/C /C0')          // referenced by /C
    expect(text).toContain('/TextAlign /Center')
  })
})

describe('PDF 2.0 structure additions', () => {
  it('emits PDF 2.0 native standard structure types', () => {
    const roles: StructureTag['role'][] = ['Title', 'FENote', 'Sub', 'Em', 'Strong', 'Aside', 'DocumentFragment']
    const children: RenderDocument['pages'][number]['children'] = roles.map(function (role, i) {
      return {
        type: 'text', x: 10, y: 20 + i * 15, text: role,
        fontId: 'default', fontSize: 10, color: '#000000', tag: { role },
      }
    })
    const { bytes, text } = generateTaggedPdf({ tagged: true, pages: [{ width: 300, height: 200, children }] })
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    for (let i = 0; i < roles.length; i++) expect(text).toContain(`/S /${roles[i]}`)
  })

  it('accepts the complete PDF 2.0 standard structure namespace vocabulary', () => {
    const roles = [
      'Document', 'DocumentFragment', 'Part', 'Div', 'Aside', 'Caption',
      'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H12', 'P', 'Title', 'FENote',
      'L', 'LI', 'Lbl', 'LBody', 'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
      'Span', 'Sub', 'Em', 'Strong', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP',
      'Warichu', 'WT', 'WP', 'Figure', 'Formula', 'Form', 'Artifact',
    ]
    const containers = new Set(['Document', 'DocumentFragment', 'Part', 'Div', 'Aside', 'Caption', 'L', 'LI', 'Table', 'TR', 'THead', 'TBody', 'TFoot', 'Ruby', 'Warichu'])
    const children: RenderDocument['pages'][number]['children'] = roles.map(function (role, index) {
      if (containers.has(role)) {
        const semanticChildren: RenderDocument['pages'][number]['children'] = role === 'Ruby' ? [{
          type: 'text', x: 0, y: 0, text: 'base', fontId: 'default', fontSize: 2, color: '#000000', tag: { role: 'RB', namespaceIndex: 0 },
        }, {
          type: 'text', x: 0, y: 0, text: 'ruby', fontId: 'default', fontSize: 2, color: '#000000', tag: { role: 'RT', namespaceIndex: 0 },
        }] : role === 'Warichu' ? [{
          type: 'text', x: 0, y: 0, text: 'wari', fontId: 'default', fontSize: 2, color: '#000000', tag: { role: 'WT', namespaceIndex: 0 },
        }] : []
        return { type: 'group', x: 0, y: index * 3, width: 10, height: 2, tag: { role, namespaceIndex: 0 }, children: semanticChildren }
      }
      return {
        type: 'text', x: 0, y: index * 3, text: role, fontId: 'default', fontSize: 2, color: '#000000',
        tag: { role, namespaceIndex: 0, ...(role === 'Artifact' ? { artifactStructureElement: true } : {}) },
      }
    })
    const { bytes } = generateTaggedPdf({
      tagged: true,
      structureNamespaces: ['http://iso.org/pdf2/ssn'],
      pages: [{ width: 300, height: 200, children }],
    })
    expect(PdfImporter.open(bytes).importStructureTree().map(function (node) { return node.role })).toEqual(roles)
  })

  it('attaches associated files to an individual structure element', () => {
    const backend = new PdfBackend({
      fonts: { default: font },
      embeddedFiles: [{ name: 'source.xml', data: new Uint8Array([60, 47, 62]), relationship: 'Source' }],
    })
    const doc: RenderDocument = {
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'Source', fontId: 'default', fontSize: 12, color: '#000000',
        tag: { role: 'P', associatedFileIndexes: [0] },
      }] }],
    }
    render(doc, backend)
    const bytes = backend.toUint8Array()
    const text = pdfToText(bytes)
    expect(text).toMatch(/\/S \/P[\s\S]*\/AF \[\d+ 0 R\]/)
    expect(text).toContain('/AFRelationship /Source')
    const importer = PdfImporter.open(bytes)
    const structure = importer.importStructureTree()
    expect(structure[0]!.associatedFileIndexes).toEqual([0])
    expect(structure[0]!.associatedFiles).toMatchObject([{
      name: 'source.xml', relationship: 'Source', data: new Uint8Array([60, 47, 62]),
    }])

    const rewritten = new PdfBackend({ fonts: { default: font }, embeddedFiles: importer.importEmbeddedFiles() })
    render({
      tagged: true,
      pages: [{ width: 200, height: 100, children: [{
        type: 'text', x: 10, y: 20, text: 'Source', fontId: 'default', fontSize: 12, color: '#000000',
        tag: { role: structure[0]!.role as StructureTag['role'], associatedFileIndexes: structure[0]!.associatedFileIndexes },
      }] }],
    }, rewritten)
    expect(PdfImporter.open(rewritten.toUint8Array()).importStructureTree()[0]!.associatedFileIndexes).toEqual([0])
  })

  it('emits PrintField attributes', () => {
    const { text } = generateTaggedPdf({ tagged: true, pages: [{ width: 200, height: 100, children: [{
      type: 'text', x: 10, y: 20, text: 'Checked', fontId: 'default', fontSize: 12, color: '#000000',
      tag: { role: 'Form', printField: { role: 'checkBox', checked: 'on', description: 'Agreement' } },
    }] }] })
    expect(text).toContain('/O /PrintField')
    expect(text).toContain('/Role /cb')
    expect(text).toContain('/checked /on')
    expect(text).toContain('/Desc (Agreement)')
  })

  it('round-trips every standard attribute owner, standard key, revisions, streams, and user properties', () => {
    const name = (value: string) => ({ kind: 'name' as const, value })
    const string = (value: string) => ({ kind: 'string' as const, bytes: new TextEncoder().encode(value) })
    const array = (...items: PdfRawValueDef[]) => ({ kind: 'array' as const, items })
    const translationOwners = [
      'ARIA-1.1', 'CSS-1', 'CSS-2', 'CSS-3', 'HTML-3.20', 'HTML-4.01', 'HTML-5.00',
      'OEB-1.00', 'RDFa-1.10', 'RTF-1.05', 'XML-1.00',
    ] as const
    const pAttributes: NonNullable<StructureTag['attributes']> = [{
      owner: 'Layout', revision: 2,
      entries: {
        Placement: name('Block'), WritingMode: name('LrTb'), BackgroundColor: array(1, 1, 1),
        BorderColor: array(array(1, 0, 0), array(0, 1, 0), array(0, 0, 1), array(0, 0, 0)),
        BorderStyle: array(name('Solid'), name('Dashed'), name('Dotted'), name('Double')),
        BorderThickness: array(1, 2, 3, 4), Padding: 2, Color: array(0, 0, 0),
        SpaceBefore: 1, SpaceAfter: 2, StartIndent: 3, EndIndent: 4, TextIndent: 5,
        TextAlign: name('Justify'), BBox: array(0, 0, 100, 20), Width: name('Auto'), Height: 20,
        BlockAlign: name('Middle'), InlineAlign: name('Center'),
        TBorderStyle: name('Solid'), TPadding: array(1, 1, 1, 1), BaselineShift: 1,
        LineHeight: name('Normal'), TextDecorationColor: array(1, 0, 0), TextDecorationThickness: 1,
        TextDecorationType: name('Underline'), RubyAlign: name('Distribute'), RubyPosition: name('Before'),
        GlyphOrientationVertical: name('Auto'), ColumnCount: 2, ColumnGap: array(5), ColumnWidths: array(40, 40),
      },
    }]
    for (let i = 0; i < translationOwners.length; i++) {
      pAttributes.push({
        owner: translationOwners[i]!, entries: { role: string(`owner-${i}`) },
        ...(translationOwners[i] === 'CSS-3' ? { streamData: new TextEncoder().encode('attribute-stream') } : {}),
      })
    }
    const children: RenderDocument['pages'][number]['children'] = [{
      type: 'text', x: 10, y: 20, text: 'Attributes', fontId: 'default', fontSize: 10, color: '#000000',
      tag: {
        role: 'P', revision: 4, attributes: pAttributes,
        userProperties: [
          { name: 'plain', value: '日本語', formattedValue: 'display', hidden: false },
          { name: 'raw', value: { kind: 'dictionary', entries: { enabled: true, count: 3 } } },
        ],
        userPropertiesRevision: 3,
      },
    }, {
      type: 'group', x: 10, y: 35, width: 100, height: 20, children: [{
        type: 'text', x: 0, y: 10, text: 'List', fontId: 'default', fontSize: 10, color: '#000000',
        tag: {
          role: 'L', attributes: [{ owner: 'List', entries: {
            ListNumbering: name('Decimal'), ContinuedList: true, ContinuedFrom: string('prior-list'),
          } }],
        },
      }],
    }, {
      type: 'text', x: 10, y: 60, text: 'Form', fontId: 'default', fontSize: 10, color: '#000000',
      tag: { role: 'Form', attributes: [{ owner: 'PrintField', entries: {
        Role: name('cb'), checked: name('neutral'), Desc: string('Options'),
      } }] },
    }, {
      type: 'text', x: 160, y: 75, text: 'Header', fontId: 'default', fontSize: 10, color: '#000000',
      tag: { role: 'TH', id: 'h1' },
    }, {
      type: 'text', x: 10, y: 75, text: 'Cell', fontId: 'default', fontSize: 10, color: '#000000',
      tag: { role: 'TH', attributes: [{ owner: 'Table', entries: {
        RowSpan: 2, ColSpan: 3, Headers: array(string('h1')), Scope: name('Both'),
      } }] },
    }, {
      type: 'text', x: 10, y: 90, text: 'Artifact structure', fontId: 'default', fontSize: 10, color: '#000000',
      tag: { role: 'Artifact', artifactStructureElement: true, attributes: [{ owner: 'Artifact', entries: {
        Type: name('Pagination'), BBox: array(0, 0, 100, 10), Attached: array(name('Top')), Subtype: name('Header'),
      } }] },
    }]
    const { bytes, text } = generateTaggedPdf({ tagged: true, pages: [{ width: 300, height: 140, children }] })
    expect(text).toContain('/S /Artifact')
    expect(text).toContain('/O /UserProperties')
    expect(text).toMatch(/\/MarkInfo <<[^>]*\/UserProperties true/)
    expect(text).toMatch(/\/R 4/)
    const model = PdfImporter.open(bytes).importStructureModel()!
    const paragraph = model.roots.find(function (node) { return node.role === 'P' })!
    expect(paragraph.revision).toBe(4)
    expect(paragraph.attributes).toHaveLength(12)
    expect(paragraph.attributes![0]).toMatchObject({ owner: 'Layout', revision: 2 })
    expect(paragraph.attributes!.find(function (attribute) { return attribute.owner === 'CSS-3' })).toMatchObject({
      streamData: new TextEncoder().encode('attribute-stream'),
    })
    expect(paragraph.userProperties).toMatchObject([
      { name: 'plain', formattedValue: 'display', hidden: false, revision: 3 },
      { name: 'raw', value: { kind: 'dictionary', entries: { enabled: true, count: 3 } }, revision: 3 },
    ])
    expect(model.roots.find(function (node) { return node.role === 'L' })!.list).toEqual({
      numbering: 'Decimal', continuedList: true, continuedFrom: 'prior-list',
    })
    expect(model.roots.find(function (node) { return node.role === 'Artifact' })!.artifact).toEqual({
      type: 'Pagination', subtype: 'Header', bbox: [0, 0, 100, 10], attached: ['Top'],
    })
  })

  it('embeds a semantic MathML namespace tree below Formula', () => {
    const { bytes, text } = generateTaggedPdf({ tagged: true, pages: [{ width: 200, height: 100, children: [{
      type: 'text', x: 10, y: 20, text: 'x²', fontId: 'default', fontSize: 12, color: '#000000',
      tag: {
        role: 'Formula',
        mathml: {
          name: 'math', attributes: { display: 'block' },
          children: [{ name: 'msup', children: [{ name: 'mi', text: 'x', attributes: { mathvariant: 'italic' } }, { name: 'mn', text: '2' }] }],
        },
      },
    }] }] })
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-2.0')
    expect(text).toContain('/NS (http://www.w3.org/1998/Math/MathML)')
    expect(text).toContain('/S /math')
    expect(text).toContain('/S /msup')
    expect(text).toContain('/S /mi')
    expect(text).toContain('/S /mn')
    const model = PdfImporter.open(bytes).importStructureModel()!
    expect(model.parentTreeNextKey).toBe(1)
    expect(model.namespaces).toMatchObject([{
      uri: 'http://www.w3.org/1998/Math/MathML',
      entries: { Type: { kind: 'name', value: 'Namespace' } },
    }])
    expect(model.roots[0]!.mathml).toEqual({
      name: 'math', attributes: { display: 'block' }, children: [{
        name: 'msup', children: [
          { name: 'mi', text: 'x', attributes: { mathvariant: 'italic' }, children: [] },
          { name: 'mn', text: '2', children: [] },
        ],
      }],
    })
  })
})
