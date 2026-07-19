import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { CanvasBackend, CanvasRenderCache } from '../src/renderer/canvas-backend.js'
import { PdfBackend } from '../src/renderer/pdf-backend.js'
import { render, renderPage } from '../src/renderer/renderer.js'
import { Font } from '../src/font.js'
import { shapeGlyphRun } from '../src/measure/glyph-run.js'
import type { RenderNode, RenderPage } from '../src/types/render.js'

interface BenchmarkContext {
  canvas: { width: number, height: number, style: { width: string, height: string } }
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  globalCompositeOperation: string
  font: string
  textBaseline: string
  operationCount: number
  save(): void
  restore(): void
  setTransform(): void
  transform(): void
  translate(): void
  rotate(): void
  beginPath(): void
  closePath(): void
  moveTo(): void
  lineTo(): void
  bezierCurveTo(): void
  rect(): void
  ellipse(): void
  roundRect(): void
  arcTo(): void
  clip(): void
  fill(): void
  stroke(): void
  fillRect(): void
  fillText(): void
  strokeText(): void
  drawImage(): void
  scale(): void
  setLineDash(): void
  measureText(text: string): { width: number }
  getTransform(): { a: number, b: number, c: number, d: number, e: number, f: number }
}

function countOperation(this: BenchmarkContext): void {
  this.operationCount++
}

function measureText(text: string): { width: number } {
  return { width: text.length * 6 }
}

function createContext(): BenchmarkContext {
  return {
    canvas: { width: 0, height: 0, style: { width: '', height: '' } },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textBaseline: 'alphabetic',
    operationCount: 0,
    save: countOperation,
    restore: countOperation,
    setTransform: countOperation,
    transform: countOperation,
    translate: countOperation,
    rotate: countOperation,
    beginPath: countOperation,
    closePath: countOperation,
    moveTo: countOperation,
    lineTo: countOperation,
    bezierCurveTo: countOperation,
    rect: countOperation,
    ellipse: countOperation,
    roundRect: countOperation,
    arcTo: countOperation,
    clip: countOperation,
    fill: countOperation,
    stroke: countOperation,
    fillRect: countOperation,
    fillText: countOperation,
    strokeText: countOperation,
    drawImage: countOperation,
    scale: countOperation,
    setLineDash: countOperation,
    measureText,
    getTransform: function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
  }
}

function createPage(groupCount: number, nodesPerGroup: number): { page: RenderPage, nodeCount: number } {
  const children: RenderNode[] = []
  let nodeCount = 0
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupChildren: RenderNode[] = []
    for (let nodeIndex = 0; nodeIndex < nodesPerGroup; nodeIndex++) {
      const x = (nodeIndex % 10) * 42
      const y = Math.floor(nodeIndex / 10) * 18
      switch (nodeIndex % 4) {
        case 0:
          groupChildren.push({ type: 'rect', x, y, width: 40, height: 16, fill: '#f4f6f8', stroke: '#334455', strokeWidth: 0.5 })
          break
        case 1:
          groupChildren.push({ type: 'text', x: x + 2, y: y + 2, text: 'Account 12345', fontId: 'sans-serif', fontSize: 9, color: '#112233' })
          break
        case 2:
          groupChildren.push({ type: 'ellipse', cx: x + 20, cy: y + 8, rx: 18, ry: 7, fill: '#ddeeff', stroke: '#225588', strokeWidth: 0.5 })
          break
        default:
          groupChildren.push({ type: 'line', x1: x, y1: y + 8, x2: x + 40, y2: y + 8, lineWidth: 0.5, color: '#667788' })
          break
      }
      nodeCount++
    }
    children.push({
      type: 'group',
      x: 24,
      y: 24 + groupIndex * 40,
      width: 500,
      height: 40,
      children: groupChildren,
    })
    nodeCount++
  }
  return { page: { width: 595, height: 842, children }, nodeCount }
}

function median(values: number[]): number {
  const sorted = values.slice().sort(function (a, b) { return a - b })
  return sorted[Math.floor(sorted.length / 2)]!
}

const firstArgument = process.argv[2]
const legacyArguments = firstArgument === undefined || /^\d+$/.test(firstArgument)
const mode = legacyArguments ? 'common' : firstArgument
const argumentOffset = legacyArguments ? 2 : 3
const groupCount = Number(process.argv[argumentOffset] ?? 120)
const nodesPerGroup = Number(process.argv[argumentOffset + 1] ?? 24)
const iterations = Number(process.argv[argumentOffset + 2] ?? (mode.startsWith('pdf') ? 5 : 25))
const samples = Number(process.argv[argumentOffset + 3] ?? 9)

function measure(name: string, nodeCount: number, operation: () => void): void {
  for (let warmup = 0; warmup < 10; warmup++) operation()
  const timings: number[] = []
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now()
    for (let iteration = 0; iteration < iterations; iteration++) operation()
    timings.push(performance.now() - start)
  }
  const elapsedMs = median(timings)
  const renderedNodes = nodeCount * iterations
  console.log(JSON.stringify({
    mode: name,
    iterations,
    samples,
    renderedNodes,
    medianMs: Number(elapsedMs.toFixed(3)),
    nodesPerSecond: Math.round(renderedNodes / (elapsedMs / 1000)),
  }))
}

function cssPage(count: number): RenderPage {
  const children: RenderNode[] = []
  for (let i = 0; i < count; i++) {
    children.push({
      type: 'text', x: 20, y: 20 + (i % 70) * 11, text: 'Account 12345',
      fontId: 'sans-serif', fontSize: 9, color: '#112233', width: 200,
      hAlign: 'center', underline: true, strikethrough: true,
    })
  }
  return { width: 595, height: 842, children }
}

if (mode === 'pdf-heavy') {
  const children: RenderNode[] = []
  const count = groupCount * nodesPerGroup
  for (let i = 0; i < count; i++) {
    const x = (i % 90) * 6
    const y = Math.floor(i / 90) * 9
    children.push({
      type: 'path',
      commands: new Uint8Array([0, 1, 1, 1, 3]),
      coords: new Float32Array([x, y, x + 4.25, y, x + 4.25, y + 6.5, x, y + 6.5]),
      fill: i % 2 === 0 ? '#333333' : '#eeeeee',
    })
  }
  const page: RenderPage = { width: 595, height: 842, children }
  const sizeBackend = new PdfBackend({})
  render({ pages: [page] }, sizeBackend)
  console.log(JSON.stringify({ mode: 'pdf-heavy-size', outputBytes: sizeBackend.toUint8Array().length }))
  measure('pdf-heavy', count, function () {
    const backend = new PdfBackend({})
    render({ pages: [page] }, backend)
    backend.toUint8Array()
  })
} else if (mode === 'pdf') {
  const fixture = createPage(Math.min(groupCount, 20), nodesPerGroup)
  measure('pdf', fixture.nodeCount, function () {
    const backend = new PdfBackend({ standardFonts: { 'sans-serif': 'Helvetica' } })
    render({ pages: [fixture.page] }, backend)
    backend.toUint8Array()
  })
} else if (mode === 'font') {
  class BenchmarkPath2D {
    moveTo(): void {}
    lineTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
  }
  ;(globalThis as unknown as { Path2D: typeof BenchmarkPath2D }).Path2D = BenchmarkPath2D
  const bytes = readFileSync(new URL('../tests/fixtures/fonts/Roboto-Regular.ttf', import.meta.url))
  const font = Font.load(Uint8Array.from(bytes).buffer)
  const run = shapeGlyphRun(font, 'Account 12345', 9)
  const page = cssPage(groupCount * nodesPerGroup)
  for (let i = 0; i < page.children.length; i++) {
    const node = page.children[i]!
    if (node.type === 'text') {
      node.fontId = 'roboto'
      node.glyphRun = run
      node.underline = false
      node.strikethrough = false
      node.hAlign = undefined
    }
  }
  const context = createContext()
  const backend = new CanvasBackend(context, { background: null, fonts: { roboto: font }, devicePixelRatio: 1 })
  measure('font', page.children.length, function () { renderPage(page, backend) })
} else if (mode === 'revision') {
  class BenchmarkOffscreenCanvas {
    width: number
    height: number
    private context = createContext()
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
      this.context.canvas = this as unknown as BenchmarkContext['canvas']
    }
    getContext(): BenchmarkContext { return this.context }
  }
  ;(globalThis as unknown as { OffscreenCanvas: typeof BenchmarkOffscreenCanvas }).OffscreenCanvas = BenchmarkOffscreenCanvas
  const fixture = createPage(groupCount, nodesPerGroup)
  fixture.page.cacheKey = 'benchmark'
  fixture.page.revision = 1
  const context = createContext()
  const cache = new CanvasRenderCache(256 * 1024 * 1024)
  measure('revision', fixture.nodeCount, function () {
    renderPage(fixture.page, new CanvasBackend(context, { background: null, renderCache: cache, devicePixelRatio: 1 }))
  })
} else {
  const page = mode === 'css' ? cssPage(groupCount * nodesPerGroup) : createPage(groupCount, nodesPerGroup).page
  const nodeCount = mode === 'css' ? page.children.length : createPage(groupCount, nodesPerGroup).nodeCount
  const context = createContext()
  const backend = new CanvasBackend(context, { background: null, devicePixelRatio: 1 })
  measure(mode, nodeCount, function () { renderPage(page, backend) })
}
