import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, ImageDef } from '../../src/types/template.js'
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

function makeTemplate(imageElem: Partial<ImageDef>): ReportTemplate {
  return {
    page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    bands: {
      details: [{
        height: 200,
        elements: [{
          type: 'image',
          x: 10, y: 10,
          width: 100, height: 80,
          source: 'test-img',
          ...imageElem,
        } as ImageDef],
      }],
    },
  }
}

// ─── Tests ───

// Image scaling (Phase 7): scaleMode variants, alignment, and onError handling.
describe('Phase 7: 画像スケーリング', () => {
  // Fallback behavior when no intrinsic image size (imageSizes) is provided.
  describe('imageSizes なし（フォールバック）', () => {
    // Verifies the element box is used as-is when the intrinsic image size is unknown.
    it('画像サイズ不明の場合、要素サイズをそのまま使用', () => {
      const doc = createReport(makeTemplate({}), { rows: [{}] })
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.x).toBe(10)
      expect(images[0]!.y).toBe(10)
      expect(images[0]!.width).toBe(100)
      expect(images[0]!.height).toBe(80)
    })
  })

  describe('fillFrame', () => {
    // Verifies fillFrame stretches the image to the element size, ignoring aspect ratio.
    it('要素サイズに引き伸ばし（アスペクト比無視）', () => {
      const doc = createReport(
        makeTemplate({ scaleMode: 'fillFrame' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 300 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.width).toBe(100)
      expect(images[0]!.height).toBe(80)
    })
  })

  describe('retainShape', () => {
    // Verifies a landscape image keeps its aspect ratio and fits inside the element.
    it('横長画像がアスペクト比を維持して要素内に収まる', () => {
      // Image 200x100 → element 100x80
      // scaleX = 100/200 = 0.5, scaleY = 80/100 = 0.8
      // min(0.5, 0.8) = 0.5 → drawW=100, drawH=50
      const doc = createReport(
        makeTemplate({ scaleMode: 'retainShape' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 100 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1)
      expect(images[0]!.width).toBe(100)
      expect(images[0]!.height).toBe(50)
      // Default hAlign=left, vAlign=top → x=10, y=10
      expect(images[0]!.x).toBe(10)
      expect(images[0]!.y).toBe(10)
    })

    // Verifies a portrait image keeps its aspect ratio and fits inside the element.
    it('縦長画像がアスペクト比を維持して要素内に収まる', () => {
      // Image 100x200 → element 100x80
      // scaleX = 100/100 = 1.0, scaleY = 80/200 = 0.4
      // min(1.0, 0.4) = 0.4 → drawW=40, drawH=80
      const doc = createReport(
        makeTemplate({ scaleMode: 'retainShape' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 100, height: 200 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images[0]!.width).toBe(40)
      expect(images[0]!.height).toBe(80)
    })

    // Verifies horizontal centering of the scaled image inside the element.
    it('hAlign=center で水平方向に中央配置', () => {
      // Image 200x100 → drawW=100, drawH=50
      // center: x = 10 + (100-100)/2 = 10
      const doc = createReport(
        makeTemplate({ scaleMode: 'retainShape', hAlign: 'center' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 100 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images[0]!.x).toBe(10) // (100-100)/2 = 0 offset
    })

    // Verifies right alignment of the scaled image inside the element.
    it('hAlign=right で右寄せ', () => {
      // Image 100x200 → drawW=40, drawH=80
      // right: x = 10 + (100 - 40) = 70
      const doc = createReport(
        makeTemplate({ scaleMode: 'retainShape', hAlign: 'right' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 100, height: 200 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images[0]!.x).toBe(70)
    })

    // Verifies vertical centering of the scaled image inside the element.
    it('vAlign=middle で垂直方向に中央配置', () => {
      // Image 200x100 → drawW=100, drawH=50
      // middle: y = 10 + (80 - 50) / 2 = 25
      const doc = createReport(
        makeTemplate({ scaleMode: 'retainShape', vAlign: 'middle' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 100 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images[0]!.y).toBe(25)
    })

    // Verifies bottom alignment of the scaled image inside the element.
    it('vAlign=bottom で下寄せ', () => {
      // Image 200x100 → drawW=100, drawH=50
      // bottom: y = 10 + (80 - 50) = 40
      const doc = createReport(
        makeTemplate({ scaleMode: 'retainShape', vAlign: 'bottom' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 100 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images[0]!.y).toBe(40)
    })
  })

  describe('clip', () => {
    // Verifies clip mode keeps the original image size wrapped in a clipping group of element size.
    it('画像をそのまま配置しクリッピンググループで包む', () => {
      const doc = createReport(
        makeTemplate({ scaleMode: 'clip' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 150 } } },
      )
      const page = doc.pages[0]!
      // In clip mode the image is wrapped in a group
      const groups = collectGroups(page.children)
      const clipGroup = groups.find(g => g.clip && g.children.some(c => c.type === 'image'))
      expect(clipGroup).toBeDefined()
      expect(clipGroup!.width).toBe(100) // element width
      expect(clipGroup!.height).toBe(80) // element height

      // The inner image keeps its original size
      const images = collectImages(page.children)
      expect(images[0]!.width).toBe(200)
      expect(images[0]!.height).toBe(150)
    })

    // Verifies clip mode centers an oversized image horizontally (negative offset).
    it('clip + hAlign=center', () => {
      const doc = createReport(
        makeTemplate({ scaleMode: 'clip', hAlign: 'center' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 150 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      // center: imgX = (100 - 200) / 2 = -50
      expect(images[0]!.x).toBe(-50)
    })

    // Verifies clip mode aligns an oversized image to the bottom (negative offset).
    it('clip + vAlign=bottom', () => {
      const doc = createReport(
        makeTemplate({ scaleMode: 'clip', vAlign: 'bottom' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 150 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      // bottom: imgY = (80 - 150) = -70
      expect(images[0]!.y).toBe(-70)
    })
  })

  describe('realSize', () => {
    // Verifies realSize behaves like clip: clipping group plus original image size.
    it('clip と同じ動作（クリッピンググループ + 元サイズ）', () => {
      const doc = createReport(
        makeTemplate({ scaleMode: 'realSize' }),
        { rows: [{}], imageSizes: { 'test-img': { width: 50, height: 40 } } },
      )
      const page = doc.pages[0]!
      const groups = collectGroups(page.children)
      const clipGroup = groups.find(g => g.clip && g.children.some(c => c.type === 'image'))
      expect(clipGroup).toBeDefined()

      const images = collectImages(page.children)
      expect(images[0]!.width).toBe(50)
      expect(images[0]!.height).toBe(40)
    })
  })

  describe('onError', () => {
    // Verifies onError=blank renders nothing when the image is missing.
    it('onError=blank で画像がない場合は何も描画しない', () => {
      const doc = createReport(
        makeTemplate({ onError: 'blank' }),
        { rows: [{}], images: {} }, // images map provided but empty
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(0)
    })

    // Verifies onError=error throws when the image is missing.
    it('onError=error で画像がない場合はエラー', () => {
      expect(() => {
        createReport(
          makeTemplate({ onError: 'error' }),
          { rows: [{}], images: {} },
        )
      }).toThrow('Image not found: test-img')
    })

    // Verifies onError=icon renders a placeholder (rect + lines) when the image is missing.
    it('onError=icon で画像がない場合はプレースホルダ', () => {
      const doc = createReport(
        makeTemplate({ onError: 'icon' }),
        { rows: [{}], images: {} },
      )
      const page = doc.pages[0]!
      // A placeholder (X mark) is rendered
      const images = collectImages(page.children)
      expect(images).toHaveLength(0) // no RenderImage

      // Instead there is a group composed of rect and line nodes
      const groups = collectGroups(page.children)
      const iconGroup = groups.find(g =>
        g.children.some(c => c.type === 'rect') &&
        g.children.some(c => c.type === 'line')
      )
      expect(iconGroup).toBeDefined()
    })

    // Verifies onError is not applied when no images map is provided at all.
    it('images マップが未指定の場合は onError を適用しない', () => {
      // No error check when the images map itself is undefined
      const doc = createReport(
        makeTemplate({ onError: 'error' }),
        { rows: [{}] }, // images not provided
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images).toHaveLength(1) // image node is generated as usual
    })
  })

  describe('デフォルト scaleMode', () => {
    // Verifies the default scaleMode is retainShape when unspecified.
    it('scaleMode 未指定は retainShape', () => {
      // Image 200x100 → element 100x80
      // retainShape: scale = 0.5, drawW=100, drawH=50
      const doc = createReport(
        makeTemplate({}),
        { rows: [{}], imageSizes: { 'test-img': { width: 200, height: 100 } } },
      )
      const images = collectImages(doc.pages[0]!.children)
      expect(images[0]!.width).toBe(100)
      expect(images[0]!.height).toBe(50)
    })
  })
})
