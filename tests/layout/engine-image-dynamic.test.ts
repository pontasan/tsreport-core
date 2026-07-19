import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createReport } from '../../src/layout/engine.js'
import { getImageDimensions } from '../../src/image/image-utils.js'
import { encodePngRgba } from '../../src/image/png-encoder.js'
import { renderToPdf } from '../../src/renderer/renderer.js'
import type { ReportTemplate, ImageDef, DataSource } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderImage } from '../../src/types/render.js'

// ─── Helpers ───

function collectImages(nodes: RenderNode[]): RenderImage[] {
  const images: RenderImage[] = []
  for (const node of nodes) {
    if (node.type === 'image') images.push(node)
    if (node.type === 'group') images.push(...collectImages(node.children))
  }
  return images
}

function makeTemplate(imageElem: Partial<ImageDef>, detailCount = 1): ReportTemplate {
  const details = []
  for (let i = 0; i < detailCount; i++) {
    details.push({
      height: 200,
      elements: [{
        type: 'image' as const,
        x: 10, y: 10,
        width: 100, height: 80,
        ...imageElem,
      } as ImageDef],
    })
  }
  return {
    page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: { details },
  }
}

/** Minimal valid PNG (signature + IHDR chunk) sufficient for dimension extraction */
function makePng(width: number, height: number): Uint8Array {
  // PNG header + IHDR chunk (fixed structure)
  const buf = new Uint8Array(33)
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47
  buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A
  // IHDR chunk length (13 bytes)
  buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13
  // 'IHDR'
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52
  // Width (4 bytes big-endian)
  buf[16] = (width >>> 24) & 0xFF
  buf[17] = (width >>> 16) & 0xFF
  buf[18] = (width >>> 8) & 0xFF
  buf[19] = width & 0xFF
  // Height (4 bytes big-endian)
  buf[20] = (height >>> 24) & 0xFF
  buf[21] = (height >>> 16) & 0xFF
  buf[22] = (height >>> 8) & 0xFF
  buf[23] = height & 0xFF
  // bit depth=8, color type=2 (RGB), compression=0, filter=0, interlace=0
  buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0
  // CRC (dummy, not needed for dimension extraction)
  buf[29] = 0; buf[30] = 0; buf[31] = 0; buf[32] = 0
  return buf
}

/** Minimal valid JPEG header (SOI + SOF0) sufficient for dimension extraction */
function makeJpeg(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(13)
  // SOI
  buf[0] = 0xFF; buf[1] = 0xD8
  // SOF0 marker
  buf[2] = 0xFF; buf[3] = 0xC0
  // Length (11 bytes: 2 + precision + height + width + components)
  buf[4] = 0; buf[5] = 11
  // Precision
  buf[6] = 8
  // Height (big-endian)
  buf[7] = (height >>> 8) & 0xFF
  buf[8] = height & 0xFF
  // Width (big-endian)
  buf[9] = (width >>> 8) & 0xFF
  buf[10] = width & 0xFF
  // Number of components
  buf[11] = 3
  // (component data would follow but not needed for dimension extraction)
  buf[12] = 0
  return buf
}

// ─── Tests ───

// Dynamic image source resolution: sourceExpression, resolvers, format sniffing, and fallbacks.
describe('画像ソース動的解決', () => {
  it('affineTransform を RenderImage に保持する', () => {
    const png = makePng(200, 100)
    const matrix: [number, number, number, number, number, number] = [20, -5, 4, -10, 10, 80]
    const template = makeTemplate({
      source: 'logo',
      scaleMode: 'fillFrame',
      affineTransform: matrix,
    })
    const doc = createReport(template, { rows: [{}] }, {
      resources: { images: { logo: png } },
    })
    const images = collectImages(doc.pages[0]!.children)
    expect(images).toHaveLength(1)
    expect(images[0]!.affineTransform).toEqual(matrix)
  })

  it('blendMode を RenderImage に保持する', () => {
    const png = makePng(200, 100)
    const template = makeTemplate({
      source: 'logo',
      scaleMode: 'fillFrame',
      blendMode: 'multiply',
    })
    const doc = createReport(template, { rows: [{}] }, {
      resources: { images: { logo: png } },
    })
    const images = collectImages(doc.pages[0]!.children)
    expect(images).toHaveLength(1)
    expect(images[0]!.blendMode).toBe('multiply')
  })

  it('overprint を RenderImage に保持する', () => {
    const png = makePng(200, 100)
    const template = makeTemplate({
      source: 'logo',
      scaleMode: 'fillFrame',
      overprintFill: true,
      overprintMode: 1,
    })
    const doc = createReport(template, { rows: [{}] }, {
      resources: { images: { logo: png } },
    })
    const images = collectImages(doc.pages[0]!.children)
    expect(images).toHaveLength(1)
    expect(images[0]!.overprintFill).toBe(true)
    expect(images[0]!.overprintMode).toBe(1)
  })

  describe('sourceExpression で静的キー', () => {
    // Verifies that a sourceExpression returning a key resolves against the resources.images map.
    it('Expression が images 内のキーを返す', () => {
      const png = makePng(200, 100)
      const template = makeTemplate({
        sourceExpression: 'field.imgKey',
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{ imgKey: 'logo' }] }, {
        resources: {
          images: { logo: png },
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe('logo')
    })
  })

  describe('行ごとに異なるキー', () => {
    // Verifies that each detail row can resolve to a different image via a field-based sourceExpression.
    it('detail の各行で違う画像', () => {
      const png1 = makePng(100, 100)
      const png2 = makePng(200, 200)
      const template = makeTemplate({
        sourceExpression: 'field.img',
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{ img: 'a' }, { img: 'b' }] }, {
        resources: {
          images: { a: png1, b: png2 },
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(2)
      expect(images[0]!.imageId).toBe('a')
      expect(images[1]!.imageId).toBe('b')
    })
  })

  describe('Uint8Array 直接返却', () => {
    // Verifies that a callback returning raw PNG bytes gets a generated id and is merged into doc.images.
    it('コールバックが PNG バイナリを返す', () => {
      const png = makePng(150, 75)
      const template = makeTemplate({
        sourceExpression: () => png,
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toMatch(/^__dyn_/)
      // The runtime image has been merged into the document
      expect(doc.images).toBeDefined()
      expect(doc.images![images[0]!.imageId]).toBe(png)
    })
  })

  describe('data URI 返却', () => {
    // Verifies that a data URI string returned by sourceExpression is used as both id and resource.
    it('sourceExpression が data URI 文字列を返す', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgo='
      const template = makeTemplate({
        sourceExpression: () => dataUri,
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe(dataUri)
      expect(doc.images![dataUri]).toBe(dataUri)
    })
  })

  describe('imageResolver', () => {
    // Verifies that an unknown key is resolved through resolveImage and its bytes merged into doc.images.
    it('未知キー → resolver が Uint8Array を返す', () => {
      const png = makePng(80, 60)
      const template = makeTemplate({
        source: 'external-img',
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          resolveImage: (ref) => ref === 'external-img' ? png : null,
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe('external-img')
      expect(doc.images!['external-img']).toBe(png)
    })

    // Verifies that onError=icon renders an error icon group when the resolver returns null.
    it('resolver が null → onError=icon', () => {
      const template = makeTemplate({
        source: 'missing',
        onError: 'icon',
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          resolveImage: () => null,
        },
      })
      // icon mode draws an error icon (a group with lines)
      const page = doc.pages[0]!
      const groups = page.children.filter(n => n.type === 'group') as RenderGroup[]
      // The error icon (cross-mark group) has been drawn
      expect(groups.length).toBeGreaterThan(0)
    })

    // Verifies that onError=blank renders nothing when the resolver returns null.
    it('resolver が null → onError=blank → null', () => {
      const template = makeTemplate({
        source: 'missing',
        onError: 'blank',
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          resolveImage: () => null,
        },
      })
      // blank -> no image node
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(0)
    })

    // Verifies that onError=error throws when the resolver returns null.
    it('resolver が null → onError=error → throw', () => {
      const template = makeTemplate({
        source: 'missing',
        onError: 'error',
        scaleMode: 'fillFrame',
      })
      expect(() => createReport(template, { rows: [{}] }, {
        resources: {
          resolveImage: () => null,
        },
      })).toThrow('Image not found: missing')
    })
  })

  describe('JPEG 自動寸法検出', () => {
    // Verifies that retainShape uses JPEG intrinsic dimensions to preserve the aspect ratio.
    it('retainShape + imageSizes なし → 正しいアスペクト比', () => {
      const jpeg = makeJpeg(200, 100)
      const template = makeTemplate({
        source: 'photo',
        scaleMode: 'retainShape',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          images: { photo: jpeg },
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      // 200x100 -> elem 100x80 -> scale min(100/200, 80/100) = 0.5
      // drawW=100, drawH=50
      expect(images[0]!.width).toBe(100)
      expect(images[0]!.height).toBe(50)
    })
  })

  describe('PNG 自動寸法検出', () => {
    // Verifies that retainShape uses PNG intrinsic dimensions to preserve the aspect ratio.
    it('retainShape + imageSizes なし → 正しいアスペクト比', () => {
      const png = makePng(300, 150)
      const template = makeTemplate({
        source: 'chart',
        scaleMode: 'retainShape',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          images: { chart: png },
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      // 300x150 -> elem 100x80 -> scale min(100/300=0.333, 80/150=0.533) = 0.333
      // drawW=100, drawH=50
      expect(images[0]!.width).toBeCloseTo(100, 5)
      expect(images[0]!.height).toBeCloseTo(50, 5)
    })
  })

  describe('source フォールバック', () => {
    // Verifies that the static source is used when sourceExpression evaluates to null.
    it('sourceExpression が null → source 使用', () => {
      const png = makePng(50, 50)
      const template = makeTemplate({
        source: 'fallback-img',
        sourceExpression: () => null,
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          images: { 'fallback-img': png },
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe('fallback-img')
    })

    // Verifies that the static source is used when sourceExpression evaluates to undefined.
    it('sourceExpression が undefined → source 使用', () => {
      const png = makePng(50, 50)
      const template = makeTemplate({
        source: 'fallback-img',
        sourceExpression: () => undefined,
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, { rows: [{}] }, {
        resources: {
          images: { 'fallback-img': png },
        },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe('fallback-img')
    })
  })

  // Built-in source resolution for explicitly authorized files and inline/URL schemes.
  describe('組み込みリソース解決', () => {
    // Verifies backward-compatible local-file loading when confinement is not requested.
    it('fileRoot 未指定時もローカルファイルを読み込む', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-'))
      try {
        const filePath = join(dir, 'private.png')
        writeFileSync(filePath, makePng(300, 150))
        const template = makeTemplate({ source: filePath, scaleMode: 'retainShape' })
        const doc = createReport(template, { rows: [{}] })
        expect(doc.images?.[filePath]).toBeInstanceOf(Uint8Array)
        expect(collectImages(doc.pages[0]!.children).map(image => image.imageId)).toEqual([filePath])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('存在しないローカル画像は onError=blank を適用する', () => {
      const template = makeTemplate({ source: 'missing.png', onError: 'blank' })
      const doc = createReport(template, { rows: [{}] }, { workingDirectory: tmpdir() })
      expect(collectImages(doc.pages[0]!.children)).toHaveLength(0)
    })

    it('存在しないローカル画像は onError=error を適用する', () => {
      const template = makeTemplate({ source: 'missing.png', onError: 'error' })
      expect(() => createReport(template, { rows: [{}] }, { workingDirectory: tmpdir() }))
        .toThrow('Image not found: missing.png')
    })

    it('不正な file URL はクラッシュせず onError を適用する', () => {
      const template = makeTemplate({ source: 'file:///%E0%A4%A', onError: 'blank' })
      const doc = createReport(template, { rows: [{}] })
      expect(collectImages(doc.pages[0]!.children)).toHaveLength(0)
    })

    // Verifies that a plain path is loaded only from the authorized root.
    it('fileRoot 配下のファイルパスを解決する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-'))
      try {
        const png = makePng(300, 150)
        const filePath = join(dir, 'logo.png')
        writeFileSync(filePath, png)

        const template = makeTemplate({
          source: filePath,
          scaleMode: 'retainShape',
        })
        const doc = createReport(template, { rows: [{}] }, { resources: { fileRoot: dir } })
        const images = collectImages(doc.pages[0]!.children)
        expect(images).toHaveLength(1)
        expect(images[0]!.imageId).toBe(filePath)
        expect(images[0]!.width).toBeCloseTo(100, 5)
        expect(images[0]!.height).toBeCloseTo(50, 5)
        expect(doc.images?.[filePath]).toBeInstanceOf(Uint8Array)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('fileRoot 外への相対パスを拒否する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-'))
      try {
        const root = join(dir, 'root')
        mkdirSync(root)
        const outside = join(dir, 'private.png')
        writeFileSync(outside, makePng(300, 150))
        const template = makeTemplate({ source: '../private.png', scaleMode: 'retainShape' })
        expect(() => createReport(template, { rows: [{}] }, {
          workingDirectory: root,
          resources: { fileRoot: root },
        })).toThrow('path is outside the authorized root')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('fileRoot 内のシンボリックリンク経由で外部ファイルを読まない', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-img-'))
      try {
        const root = join(dir, 'root')
        const outside = join(dir, 'outside.png')
        const link = join(root, 'linked.png')
        mkdirSync(root)
        writeFileSync(outside, makePng(89, 47))
        symlinkSync(outside, link)
        const template = makeTemplate({ source: 'linked.png' })
        expect(() => createReport(template, { rows: [{}] }, {
          workingDirectory: root,
          resources: { fileRoot: root },
        })).toThrow('path is outside the authorized root')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('シンボリックリンク表記の fileRoot と正規化済み workingDirectory を同一ルートとして扱う', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-img-root-'))
      try {
        const canonicalRoot = join(dir, 'canonical')
        const linkedRoot = join(dir, 'linked')
        mkdirSync(canonicalRoot)
        symlinkSync(canonicalRoot, linkedRoot)
        const filePath = join(canonicalRoot, 'logo.png')
        writeFileSync(filePath, makePng(200, 100))

        const doc = createReport(makeTemplate({ source: 'logo.png' }), { rows: [{}] }, {
          workingDirectory: canonicalRoot,
          resources: { fileRoot: linkedRoot },
        })
        expect(doc.images?.['logo.png']).toBeInstanceOf(Uint8Array)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('シンボリックリンク表記の workingDirectory配下の欠損画像へ onErrorを適用する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-img-root-'))
      try {
        const canonicalRoot = join(dir, 'canonical')
        const linkedRoot = join(dir, 'linked')
        mkdirSync(canonicalRoot)
        symlinkSync(canonicalRoot, linkedRoot)
        const doc = createReport(makeTemplate({ source: 'missing.png', onError: 'blank' }), { rows: [{}] }, {
          workingDirectory: linkedRoot,
          resources: { fileRoot: canonicalRoot },
        })
        expect(collectImages(doc.pages[0]!.children)).toHaveLength(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('コロンを含むPOSIX絶対パスを画像として解決する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-colon-'))
      try {
        const timestampDirectory = join(dir, '2026-07-18T12:30:00')
        const filePath = join(timestampDirectory, 'logo.png')
        mkdirSync(timestampDirectory)
        writeFileSync(filePath, makePng(200, 100))
        const doc = createReport(makeTemplate({ source: filePath }), { rows: [{}] }, {
          resources: { fileRoot: dir },
        })
        expect(doc.images?.[filePath]).toBeInstanceOf(Uint8Array)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('存在しない fileRoot を設定エラーとして明示する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-img-root-'))
      try {
        const missingRoot = join(dir, 'missing')
        expect(() => createReport(makeTemplate({ source: 'logo.png' }), { rows: [{}] }, {
          workingDirectory: missingRoot,
          resources: { fileRoot: missingRoot },
        })).toThrow(`invalid authorized file root "${missingRoot}": filesystem error ENOENT`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('ローカル画像参照がなくても存在しない fileRoot を即時検証する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-img-root-'))
      try {
        const missingRoot = join(dir, 'missing')
        const template: ReportTemplate = {
          page: { width: 100, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
          bands: { details: [{ height: 20, elements: [] }] },
        }
        expect(() => createReport(template, { rows: [{}] }, { resources: { fileRoot: missingRoot } }))
          .toThrow(`invalid authorized file root "${missingRoot}": filesystem error ENOENT`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('ディレクトリを画像として指定した場合は onError=blank を適用する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-dir-'))
      try {
        mkdirSync(join(dir, 'not-an-image'))
        const doc = createReport(makeTemplate({ source: 'not-an-image', onError: 'blank' }), { rows: [{}] }, {
          workingDirectory: dir,
        })
        expect(collectImages(doc.pages[0]!.children)).toHaveLength(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    // Verifies that relative paths are resolved against workingDirectory when it is specified.
    it('workingDirectory 指定時は相対パスをそのディレクトリ基準で解決する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-'))
      try {
        const png = makePng(300, 150)
        const filePath = join(dir, 'logo.png')
        writeFileSync(filePath, png)

        const template = makeTemplate({
          source: 'logo.png',
          scaleMode: 'retainShape',
        })
        const doc = createReport(template, { rows: [{}] }, {
          workingDirectory: dir,
        })
        const images = collectImages(doc.pages[0]!.children)
        expect(images).toHaveLength(1)
        expect(images[0]!.imageId).toBe('logo.png')
        expect(images[0]!.width).toBeCloseTo(100, 5)
        expect(images[0]!.height).toBeCloseTo(50, 5)
        expect(doc.images?.['logo.png']).toBeInstanceOf(Uint8Array)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('ローカルalternateをメイン画像と同じ公開キー契約でPDFへ接続する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-alternate-'))
      try {
        writeFileSync(join(dir, 'main.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
        writeFileSync(join(dir, 'alternate.png'), encodePngRgba(1, 1, Uint8Array.from([40, 50, 60, 255])))
        const template = makeTemplate({
          source: 'main.png',
          scaleMode: 'fillFrame',
          alternates: [{ source: 'alternate.png' }],
        })
        const doc = createReport(template, { rows: [{}] }, { workingDirectory: dir })
        const images = collectImages(doc.pages[0]!.children)
        expect(images).toHaveLength(1)
        expect(images[0]!.imageId).toBe('main.png')
        expect(images[0]!.alternates).toEqual([{ imageId: 'alternate.png', defaultForPrinting: undefined }])
        expect(Object.keys(doc.images ?? {})).toEqual(['main.png', 'alternate.png'])
        const pdf = renderToPdf(doc, { fonts: {}, images: doc.images })
        expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.7')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('欠損alternateをlayoutで失敗させずレンダー時供給用IDとして保持する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-alternate-passthrough-'))
      try {
        const main = encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255]))
        const alternate = encodePngRgba(1, 1, Uint8Array.from([40, 50, 60, 255]))
        writeFileSync(join(dir, 'main.png'), main)
        const template = makeTemplate({
          source: 'main.png',
          scaleMode: 'fillFrame',
          onError: 'blank',
          alternates: [{ source: 'alternate.png' }],
        })
        const doc = createReport(template, { rows: [{}] }, { workingDirectory: dir })
        const image = collectImages(doc.pages[0]!.children)[0]!
        expect(image.imageId).toBe('main.png')
        expect(image.alternates).toEqual([{ imageId: 'alternate.png', defaultForPrinting: undefined }])
        expect(doc.images?.['alternate.png']).toBeUndefined()
        const pdf = renderToPdf(doc, {
          fonts: {},
          images: { ...doc.images, 'alternate.png': alternate },
        })
        expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.7')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('静的alternateの解決結果を行間で共有する', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-alternate-cache-'))
      try {
        writeFileSync(join(dir, 'main.png'), encodePngRgba(1, 1, Uint8Array.from([10, 20, 30, 255])))
        writeFileSync(join(dir, 'alternate.png'), encodePngRgba(1, 1, Uint8Array.from([40, 50, 60, 255])))
        const template = makeTemplate({
          source: 'main.png',
          scaleMode: 'fillFrame',
          alternates: [{ source: 'alternate.png' }],
        })
        const doc = createReport(template, { rows: [{}, {}, {}] }, { workingDirectory: dir })
        const images = collectImages(doc.pages[0]!.children)
        expect(images).toHaveLength(3)
        expect(images[1]!.alternates).toBe(images[0]!.alternates)
        expect(images[2]!.alternates).toBe(images[0]!.alternates)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('workingDirectory 未指定時は相対的な画像IDをディスクから読まない', () => {
      const template = makeTemplate({ source: 'package.json', scaleMode: 'fillFrame' })
      const doc = createReport(template, { rows: [{}] })
      expect(doc.images).toBeUndefined()
      expect(collectImages(doc.pages[0]!.children).map(image => image.imageId)).toEqual(['package.json'])
    })

    it('スラッシュを含む画像IDもレンダー時供給用にpassthroughする', () => {
      const template = makeTemplate({ source: 'assets/logo.png', scaleMode: 'fillFrame' })
      const doc = createReport(template, { rows: [{}] })
      expect(doc.images).toBeUndefined()
      expect(collectImages(doc.pages[0]!.children).map(image => image.imageId)).toEqual(['assets/logo.png'])
    })

    // Verifies that a file:// URL is resolved through the filesystem.
    it('resolves file URL sources through the filesystem', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tsreport-image-'))
      try {
        const png = makePng(200, 100)
        const filePath = join(dir, 'photo.png')
        writeFileSync(filePath, png)
        const fileUrl = pathToFileURL(filePath).href

        const template = makeTemplate({
          source: fileUrl,
          scaleMode: 'retainShape',
        })
        const doc = createReport(template, { rows: [{}] }, { resources: { fileRoot: dir } })
        const images = collectImages(doc.pages[0]!.children)
        expect(images).toHaveLength(1)
        expect(images[0]!.imageId).toBe(fileUrl)
        expect(images[0]!.width).toBe(100)
        expect(images[0]!.height).toBe(50)
        expect(doc.images?.[fileUrl]).toBeInstanceOf(Uint8Array)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    // Verifies that a data:// scheme is normalized to a standard data: URI resource.
    it('normalizes data scheme sources to standard data URI resources', () => {
      const png = makePng(300, 150)
      const base64 = Buffer.from(png).toString('base64')
      const dataScheme = `data://image/png;base64,${base64}`

      const template = makeTemplate({
        source: dataScheme,
        scaleMode: 'retainShape',
      })
      const doc = createReport(template, { rows: [{}] })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe(dataScheme)
      expect(images[0]!.width).toBeCloseTo(100, 5)
      expect(images[0]!.height).toBeCloseTo(50, 5)
      expect(doc.images?.[dataScheme]).toBe(`data:image/png;base64,${base64}`)
    })

    // Verifies that https and blob references are kept as URL resources without fetching.
    it('https/blob を URL リソースとして保持する', () => {
      const template = makeTemplate({
        sourceExpression: 'field.ref',
        scaleMode: 'fillFrame',
      })
      const httpsRef = 'https://example.com/logo.png'
      const blobRef = 'blob:https://example.com/3e4f'
      const doc = createReport(template, {
        rows: [{ ref: httpsRef }, { ref: blobRef }],
      })

      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(2)
      expect(doc.images?.[httpsRef]).toBe(httpsRef)
      expect(doc.images?.[blobRef]).toBe(blobRef)
    })
  })

  describe('後方互換', () => {
    // Verifies that a static source without sourceExpression keeps the legacy resolution behavior.
    it('source のみ (sourceExpression なし) → 既存動作', () => {
      const png = makePng(100, 100)
      const template = makeTemplate({
        source: 'test-img',
        scaleMode: 'fillFrame',
      })
      const doc = createReport(template, {
        rows: [{}],
        images: { 'test-img': png },
      })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.imageId).toBe('test-img')
      expect(images[0]!.width).toBe(100)
      expect(images[0]!.height).toBe(80)
    })

    // Verifies that a key missing from the images map falls back to the default onError=icon rendering.
    it('images マップに存在しない → onError=icon (デフォルト)', () => {
      const template = makeTemplate({
        source: 'nonexistent',
      })
      const doc = createReport(template, {
        rows: [{}],
        images: { other: makePng(10, 10) },
      })
      // An error icon group is rendered
      const page = doc.pages[0]!
      expect(page.children.length).toBeGreaterThan(0)
      const images = collectImages(page.children)
      expect(images).toHaveLength(0)
    })
  })
})

describe('getImageDimensions', () => {
  // Verifies that PNG dimensions are parsed from the IHDR chunk.
  it('PNG の寸法を正しく検出', () => {
    const png = makePng(640, 480)
    const dims = getImageDimensions(png)
    expect(dims).toEqual({ width: 640, height: 480 })
  })

  // Verifies that JPEG dimensions are parsed from the SOF0 marker.
  it('JPEG の寸法を正しく検出', () => {
    const jpeg = makeJpeg(1024, 768)
    const dims = getImageDimensions(jpeg)
    expect(dims).toEqual({ width: 1024, height: 768 })
  })

  // Verifies that an unrecognized format returns null.
  it('不明形式は null', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
    expect(getImageDimensions(data)).toBeNull()
  })

  // Verifies that data too short to contain a header returns null.
  it('短すぎるデータは null', () => {
    const data = new Uint8Array([0x89, 0x50])
    expect(getImageDimensions(data)).toBeNull()
  })
})
