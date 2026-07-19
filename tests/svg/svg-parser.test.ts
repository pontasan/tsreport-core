import { describe, it, expect } from 'vitest'
import { parseOpenTypeSvg, parseSvg, parseCssColor, parseTransform, multiplyMatrix } from '../../src/svg/svg-parser.js'

describe('parseSvg', () => {
  // Verifies that width/height/viewBox and child elements are extracted from a basic SVG document.
  it('basic SVG with viewBox', () => {
    const svg = '<svg viewBox="0 0 100 100" width="200" height="200"><rect x="10" y="10" width="80" height="80"/></svg>'
    const doc = parseSvg(svg)
    expect(doc.width).toBe(200)
    expect(doc.height).toBe(200)
    expect(doc.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(doc.children.length).toBe(1)
    expect(doc.children[0]!.type).toBe('rect')
  })

  // Verifies that a missing viewBox defaults to (0, 0, width, height).
  it('SVG without viewBox', () => {
    const svg = '<svg width="100" height="50"><circle cx="50" cy="25" r="20"/></svg>'
    const doc = parseSvg(svg)
    expect(doc.width).toBe(100)
    expect(doc.height).toBe(50)
    expect(doc.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })

  // Verifies that the xmlns namespace declaration does not prevent element parsing.
  it('SVG with namespace', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="0" y="0" width="100" height="100"/></svg>'
    const doc = parseSvg(svg)
    expect(doc.children.length).toBe(1)
  })

  // Verifies that parseSvg accepts binary Uint8Array input in addition to strings.
  it('Uint8Array input', () => {
    const svg = '<svg width="50" height="50"><line x1="0" y1="0" x2="50" y2="50"/></svg>'
    const data = new TextEncoder().encode(svg)
    const doc = parseSvg(data)
    expect(doc.children.length).toBe(1)
    expect(doc.children[0]!.type).toBe('line')
  })

  // Verifies that a <path> element's d attribute is parsed into individual path commands.
  it('path element', () => {
    const svg = '<svg width="100" height="100"><path d="M 0 0 L 100 100 Z"/></svg>'
    const doc = parseSvg(svg)
    const path = doc.children[0]!
    expect(path.type).toBe('path')
    if (path.type === 'path') {
      expect(path.commands.length).toBe(3) // M, L, Z
    }
  })

  // Verifies that rect geometry including independent corner radii rx/ry is parsed.
  it('rect with rx/ry', () => {
    const svg = '<svg width="100" height="100"><rect x="5" y="10" width="90" height="80" rx="5" ry="10"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.type).toBe('rect')
    if (rect.type === 'rect') {
      expect(rect.x).toBe(5)
      expect(rect.y).toBe(10)
      expect(rect.width).toBe(90)
      expect(rect.height).toBe(80)
      expect(rect.rx).toBe(5)
      expect(rect.ry).toBe(10)
    }
  })

  // Verifies that percentage lengths resolve against the viewBox dimensions.
  it('percentage lengths are resolved against viewBox', () => {
    const svg = '<svg viewBox="0 0 500 500" width="500" height="500"><rect x="0" y="0" width="100%" height="100%"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.type).toBe('rect')
    if (rect.type === 'rect') {
      expect(rect.width).toBe(500)
      expect(rect.height).toBe(500)
    }
  })

  // Verifies that circle cx/cy/r attributes are parsed as numbers.
  it('circle', () => {
    const svg = '<svg width="100" height="100"><circle cx="50" cy="50" r="25"/></svg>'
    const doc = parseSvg(svg)
    const circle = doc.children[0]!
    if (circle.type === 'circle') {
      expect(circle.cx).toBe(50)
      expect(circle.cy).toBe(50)
      expect(circle.r).toBe(25)
    }
  })

  // Verifies that ellipse cx/rx/ry attributes are parsed as numbers.
  it('ellipse', () => {
    const svg = '<svg width="100" height="100"><ellipse cx="50" cy="50" rx="40" ry="20"/></svg>'
    const doc = parseSvg(svg)
    const el = doc.children[0]!
    if (el.type === 'ellipse') {
      expect(el.cx).toBe(50)
      expect(el.rx).toBe(40)
      expect(el.ry).toBe(20)
    }
  })

  // Verifies that line endpoint attributes x1/y1/x2/y2 are parsed as numbers.
  it('line', () => {
    const svg = '<svg width="100" height="100"><line x1="10" y1="20" x2="80" y2="90"/></svg>'
    const doc = parseSvg(svg)
    const line = doc.children[0]!
    if (line.type === 'line') {
      expect(line.x1).toBe(10)
      expect(line.y1).toBe(20)
      expect(line.x2).toBe(80)
      expect(line.y2).toBe(90)
    }
  })

  // Verifies that the polyline points attribute is parsed into a flat coordinate array.
  it('polyline', () => {
    const svg = '<svg width="100" height="100"><polyline points="10,10 50,50 90,10"/></svg>'
    const doc = parseSvg(svg)
    const pl = doc.children[0]!
    if (pl.type === 'polyline') {
      expect(pl.points.length).toBe(6)
      expect(pl.points[0]).toBe(10)
      expect(pl.points[2]).toBe(50)
    }
  })

  // Verifies that <polygon> is parsed as a distinct element type from polyline.
  it('polygon', () => {
    const svg = '<svg width="100" height="100"><polygon points="50,0 100,100 0,100"/></svg>'
    const doc = parseSvg(svg)
    const pg = doc.children[0]!
    expect(pg.type).toBe('polygon')
  })

  // Verifies that a <g> element nests its child elements in the parsed tree.
  it('group with children', () => {
    const svg = '<svg width="100" height="100"><g><rect x="0" y="0" width="50" height="50"/><circle cx="75" cy="75" r="10"/></g></svg>'
    const doc = parseSvg(svg)
    expect(doc.children.length).toBe(1)
    const g = doc.children[0]!
    expect(g.type).toBe('g')
    if (g.type === 'g') {
      expect(g.children.length).toBe(2)
    }
  })

  // Verifies that fill/stroke named colors and stroke-width are parsed into style paints.
  it('fill and stroke attributes', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="red" stroke="blue" stroke-width="2"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.style.fill?.type).toBe('color')
    expect(rect.style.fill?.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(rect.style.stroke?.type).toBe('color')
    expect(rect.style.stroke?.color).toEqual({ r: 0, g: 0, b: 255 })
    expect(rect.style.strokeWidth).toBe(2)
  })

  // Verifies that vector-effect is picked up from both the presentation attribute and inline style.
  it('parses vector-effect presentation/style attributes', () => {
    const svg = '<svg width="100" height="100"><path d="M0 0 L100 0" stroke="#000" stroke-width="4" vector-effect="non-scaling-stroke" style="vector-effect:non-scaling-stroke"/></svg>'
    const doc = parseSvg(svg)
    const path = doc.children[0]!
    expect(path.style.vectorEffect).toBe('non-scaling-stroke')
  })

  // Verifies that fill="none" is parsed as an explicit 'none' paint, not a missing paint.
  it('fill none', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="none" stroke="#000"/></svg>'
    const doc = parseSvg(svg)
    expect(doc.children[0]!.style.fill?.type).toBe('none')
  })

  // Verifies that fill="currentColor" is kept symbolic while the color property resolves to RGB.
  it('parses currentColor paint and color property', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" color="#336699" fill="currentColor"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.style.color).toEqual({ r: 51, g: 102, b: 153 })
    expect(rect.style.fill?.type).toBe('currentColor')
  })

  // Verifies that a url() paint with a currentColor fallback records both the reference and the fallback flag.
  it('parses url fallback currentColor', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="url(#g) currentColor"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.style.fill?.type).toBe('url')
    if (rect.style.fill?.type === 'url') {
      expect(rect.style.fill.url).toBe('g')
      expect(rect.style.fill.fallbackCurrentColor).toBe(true)
    }
  })

  // Verifies that CSS declarations in the style attribute are parsed into the element style.
  it('inline style attribute', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" style="fill:#ff0000;stroke-width:3"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.style.fill?.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(rect.style.strokeWidth).toBe(3)
  })

  // Verifies that the transform attribute is parsed into a 2x3 affine matrix on the element.
  it('transform attribute', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="50" height="50" transform="translate(10,20)"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.transform).toEqual([1, 0, 0, 1, 10, 20])
  })

  // Verifies that elements with display:none are excluded from the parsed tree entirely.
  it('display: none skipped', () => {
    const svg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" display="none"/></svg>'
    const doc = parseSvg(svg)
    expect(doc.children.length).toBe(0)
  })

  // Verifies that <text> elements capture position and text content.
  it('text element', () => {
    const svg = '<svg width="200" height="100"><text x="10" y="30">Hello World</text></svg>'
    const doc = parseSvg(svg)
    const text = doc.children[0]!
    if (text.type === 'text') {
      expect(text.x).toBe(10)
      expect(text.y).toBe(30)
      expect(text.content).toBe('Hello World')
    }
  })

  // Verifies that a linearGradient in defs is registered with its geometry and color stops.
  it('defs with linearGradient', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <linearGradient id="grad1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="red"/>
          <stop offset="100%" stop-color="blue"/>
        </linearGradient>
      </defs>
      <rect fill="url(#grad1)" x="0" y="0" width="100" height="100"/>
    </svg>`
    const doc = parseSvg(svg)
    expect(doc.defs.gradients.size).toBe(1)
    const grad = doc.defs.gradients.get('grad1')!
    expect(grad.type).toBe('linearGradient')
    if (grad.type === 'linearGradient') {
      expect(grad.x1).toBe(0)
      expect(grad.x2).toBe(1)
      expect(grad.stops.length).toBe(2)
      expect(grad.stops[0]!.color).toEqual({ r: 255, g: 0, b: 0 })
      expect(grad.stops[1]!.color).toEqual({ r: 0, g: 0, b: 255 })
    }
  })

  // Verifies that stop-color="currentColor" resolves from the gradient element's color property.
  it('resolves stop-color currentColor in gradient stops', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <linearGradient id="g1" color="#336699">
          <stop offset="0%" stop-color="currentColor"/>
          <stop offset="100%" stop-color="#000000"/>
        </linearGradient>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const grad = doc.defs.gradients.get('g1')!
    expect(grad.type).toBe('linearGradient')
    if (grad.type === 'linearGradient') {
      expect(grad.stops[0]!.color).toEqual({ r: 51, g: 102, b: 153 })
      expect(grad.stops[1]!.color).toEqual({ r: 0, g: 0, b: 0 })
    }
  })

  // Verifies that a radialGradient in defs is registered with its center and radius.
  it('defs with radialGradient', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <radialGradient id="rg1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="white"/>
          <stop offset="1" stop-color="black"/>
        </radialGradient>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const grad = doc.defs.gradients.get('rg1')!
    expect(grad.type).toBe('radialGradient')
    if (grad.type === 'radialGradient') {
      expect(grad.cx).toBe(0.5)
      expect(grad.r).toBe(0.5)
    }
  })

  // Verifies that <use> expands its referenced element into a group carrying the x/y translation.
  it('use element', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <rect id="myRect" width="50" height="50" fill="red"/>
      </defs>
      <use href="#myRect" x="10" y="20"/>
    </svg>`
    const doc = parseSvg(svg)
    expect(doc.children.length).toBe(1)
    const g = doc.children[0]!
    expect(g.type).toBe('g')
    if (g.type === 'g') {
      expect(g.transform![4]).toBe(10) // translate x
      expect(g.transform![5]).toBe(20) // translate y
      expect(g.children[0]!.type).toBe('rect')
    }
  })

  // Verifies that clipPath defs are registered and clip-path references resolve to the element's clipPathId.
  it('clipPath in defs', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <clipPath id="clip1">
          <circle cx="50" cy="50" r="40"/>
        </clipPath>
      </defs>
      <rect clip-path="url(#clip1)" x="0" y="0" width="100" height="100"/>
    </svg>`
    const doc = parseSvg(svg)
    expect(doc.defs.clipPaths.size).toBe(1)
    const rect = doc.children[0]!
    expect(rect.clipPathId).toBe('clip1')
  })

  // Verifies that XML entities (&amp;, &lt;) in text content are decoded.
  it('XML entities', () => {
    const svg = '<svg width="100" height="100"><text x="0" y="10">A &amp; B &lt; C</text></svg>'
    const doc = parseSvg(svg)
    const text = doc.children[0]!
    if (text.type === 'text') {
      expect(text.content).toBe('A & B < C')
    }
  })

  // Verifies that input without an <svg> root element throws instead of returning a partial document.
  it('throws on missing svg element', () => {
    expect(() => parseSvg('<div>not svg</div>')).toThrow('SVG: <svg> element not found')
  })

  // Verifies that XML declarations and comments before the root element are skipped.
  it('XML declaration and comments', () => {
    const svg = '<?xml version="1.0"?><!-- comment --><svg width="100" height="100"><rect x="0" y="0" width="50" height="50"/></svg>'
    const doc = parseSvg(svg)
    expect(doc.children.length).toBe(1)
  })

  // Verifies that class selectors in a <style> element are applied to matching elements.
  it('CSS style element', () => {
    const svg = `<svg width="100" height="100">
      <style>.red { fill: #ff0000 }</style>
      <rect class="red" x="0" y="0" width="100" height="100"/>
    </svg>`
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.style.fill?.color).toEqual({ r: 255, g: 0, b: 0 })
  })

  // Verifies that a gradient referencing another via href inherits the base gradient's stops.
  it('gradient href inheritance', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <linearGradient id="base">
          <stop offset="0" stop-color="red"/>
          <stop offset="1" stop-color="blue"/>
        </linearGradient>
        <linearGradient id="derived" href="#base" x1="0" y1="0" x2="0" y2="1"/>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const derived = doc.defs.gradients.get('derived')!
    expect(derived.stops.length).toBe(2)
    expect(derived.stops[0]!.color).toEqual({ r: 255, g: 0, b: 0 })
  })

  // Verifies that linear gradient href inheritance covers geometry, gradientUnits, spreadMethod, and transform.
  it('gradient href inheritance includes geometry/units/spread/transform', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <linearGradient id="base" x1="10" y1="20" x2="30" y2="40"
          gradientUnits="userSpaceOnUse" spreadMethod="reflect" gradientTransform="translate(5,6)">
          <stop offset="0" stop-color="#000"/>
          <stop offset="1" stop-color="#fff"/>
        </linearGradient>
        <linearGradient id="derived" href="#base"/>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const derived = doc.defs.gradients.get('derived')!
    expect(derived.type).toBe('linearGradient')
    if (derived.type === 'linearGradient') {
      expect(derived.x1).toBe(10)
      expect(derived.y1).toBe(20)
      expect(derived.x2).toBe(30)
      expect(derived.y2).toBe(40)
      expect(derived.gradientUnits).toBe('userSpaceOnUse')
      expect(derived.spreadMethod).toBe('reflect')
      expect(derived.gradientTransform).toEqual([1, 0, 0, 1, 5, 6])
      expect(derived.stops.length).toBe(2)
    }
  })

  // Verifies that radial gradient href inheritance covers cx/cy/r/fx/fy, units, spreadMethod, and transform.
  it('radial gradient href inheritance includes geometry/units/spread/transform', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <radialGradient id="base" cx="10" cy="20" r="30" fx="11" fy="22"
          gradientUnits="userSpaceOnUse" spreadMethod="repeat" gradientTransform="scale(2)">
          <stop offset="0" stop-color="#000"/>
          <stop offset="1" stop-color="#fff"/>
        </radialGradient>
        <radialGradient id="derived" href="#base"/>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const derived = doc.defs.gradients.get('derived')!
    expect(derived.type).toBe('radialGradient')
    if (derived.type === 'radialGradient') {
      expect(derived.cx).toBe(10)
      expect(derived.cy).toBe(20)
      expect(derived.r).toBe(30)
      expect(derived.fx).toBe(11)
      expect(derived.fy).toBe(22)
      expect(derived.gradientUnits).toBe('userSpaceOnUse')
      expect(derived.spreadMethod).toBe('repeat')
      expect(derived.gradientTransform).toEqual([2, 0, 0, 2, 0, 0])
      expect(derived.stops.length).toBe(2)
    }
  })

  // Verifies that pattern href inheritance covers geometry, units, viewBox, preserveAspectRatio, and children.
  it('pattern href inheritance includes geometry/units/children', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <pattern id="base" x="1" y="2" width="10" height="12"
          patternUnits="userSpaceOnUse" patternContentUnits="objectBoundingBox"
          viewBox="0 0 10 10" preserveAspectRatio="xMaxYMax slice">
          <rect x="0" y="0" width="10" height="10" fill="#00ff00"/>
        </pattern>
        <pattern id="derived" href="#base"/>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const p = doc.defs.patterns.get('derived')!
    expect(p.x).toBe(1)
    expect(p.y).toBe(2)
    expect(p.width).toBe(10)
    expect(p.height).toBe(12)
    expect(p.patternUnits).toBe('userSpaceOnUse')
    expect(p.patternContentUnits).toBe('objectBoundingBox')
    expect(p.viewBox).toEqual({ x: 0, y: 0, width: 10, height: 10 })
    expect(p.preserveAspectRatio).toBe('xMaxYMax slice')
    expect(p.children.length).toBe(1)
  })

  // Verifies that preserveAspectRatio on the root <svg> is stored on the document.
  it('parses preserveAspectRatio on root svg', () => {
    const svg = '<svg viewBox="0 0 100 50" width="100" height="100" preserveAspectRatio="none"></svg>'
    const doc = parseSvg(svg)
    expect(doc.preserveAspectRatio).toBe('none')
  })

  // Verifies that presentation attributes on <use> are kept on its wrapper group for inheritance.
  it('use element keeps style on wrapper group', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <rect id="r1" x="0" y="0" width="20" height="20"/>
      </defs>
      <use href="#r1" x="10" y="20" fill="#00ff00"/>
    </svg>`
    const doc = parseSvg(svg)
    const useGroup = doc.children[0]!
    expect(useGroup.type).toBe('g')
    if (useGroup.type === 'g') {
      expect(useGroup.style.fill?.type).toBe('color')
      expect(useGroup.style.fill?.color).toEqual({ r: 0, g: 255, b: 0 })
    }
  })

  // Verifies that fill-rule/clip-rule, fill/stroke opacity, and marker-start/end references are parsed.
  it('parses clip-rule, marker and opacity styles', () => {
    const svg = `<svg width="100" height="100">
      <path d="M0 0 L10 0" fill-rule="evenodd" clip-rule="evenodd"
        fill-opacity="0.5" stroke-opacity="0.25"
        marker-start="url(#m1)" marker-end="url(#m1)"/>
    </svg>`
    const doc = parseSvg(svg)
    const p = doc.children[0]!
    expect(p.style.fillRule).toBe('evenodd')
    expect(p.style.clipRule).toBe('evenodd')
    expect(p.style.fillOpacity).toBeCloseTo(0.5)
    expect(p.style.strokeOpacity).toBeCloseTo(0.25)
    expect(p.style.markerStart).toBe('m1')
    expect(p.style.markerEnd).toBe('m1')
  })

  // Verifies that pattern/mask/marker defs register and a blur+offset+merge filter chain is recognized as drop-shadow with defaults.
  it('parses pattern/mask/marker/filter defs', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <pattern id="p1" width="10" height="10"><rect x="0" y="0" width="10" height="10" fill="#0f0"/></pattern>
        <mask id="m1"><rect x="0" y="0" width="100" height="100" fill="#fff"/></mask>
        <marker id="mk1" markerWidth="4" markerHeight="4" refX="2" refY="2"><circle cx="2" cy="2" r="2"/></marker>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
          <feOffset dx="3" dy="4"/>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    expect(doc.defs.patterns.has('p1')).toBe(true)
    expect(doc.defs.masks.has('m1')).toBe(true)
    expect(doc.defs.markers.has('mk1')).toBe(true)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.filterUnits).toBe('objectBoundingBox')
      expect(filter.primitiveUnits).toBe('userSpaceOnUse')
      expect(filter.blendMode).toBe('normal')
      expect(filter.x).toBeCloseTo(-0.1)
      expect(filter.y).toBeCloseTo(-0.1)
      expect(filter.width).toBeCloseTo(1.2)
      expect(filter.height).toBeCloseTo(1.2)
      expect(filter.includeSourceGraphic).toBe(true)
      expect(filter.dx).toBe(3)
      expect(filter.dy).toBe(4)
      expect(filter.stdDeviation).toBe(2)
    }
  })

  // Verifies that mask region percentages, mask units, and mask-type="alpha" are parsed.
  it('parses mask geometry and mask-type', () => {
    const svg = `<svg width="200" height="100">
      <defs>
        <mask id="m1" x="-20%" y="-10%" width="140%" height="130%"
          maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" mask-type="alpha">
          <rect x="0" y="0" width="1" height="1" fill="#fff"/>
        </mask>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const mask = doc.defs.masks.get('m1')!
    expect(mask.x).toBeCloseTo(-0.2)
    expect(mask.y).toBeCloseTo(-0.1)
    expect(mask.width).toBeCloseTo(1.4)
    expect(mask.height).toBeCloseTo(1.3)
    expect(mask.maskUnits).toBe('objectBoundingBox')
    expect(mask.maskContentUnits).toBe('objectBoundingBox')
    expect(mask.maskType).toBe('alpha')
  })

  // Verifies that marker orient="auto-start-reverse" and preserveAspectRatio are preserved.
  it('parses marker orient auto-start-reverse', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <marker id="mk1" markerWidth="10" markerHeight="10" refX="5" refY="5"
          orient="auto-start-reverse" preserveAspectRatio="xMinYMin meet">
          <path d="M0 0 L10 5 L0 10 Z"/>
        </marker>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const marker = doc.defs.markers.get('mk1')!
    expect(marker.orient).toBe('auto-start-reverse')
    expect(marker.preserveAspectRatio).toBe('xMinYMin meet')
  })

  // Verifies that preserveAspectRatio on an <image> element is preserved.
  it('parses image preserveAspectRatio', () => {
    const svg = `<svg width="100" height="100">
      <image href="foo.png" x="0" y="0" width="80" height="40" preserveAspectRatio="xMaxYMin slice"/>
    </svg>`
    const doc = parseSvg(svg)
    const img = doc.children[0]!
    expect(img.type).toBe('image')
    if (img.type === 'image') {
      expect(img.preserveAspectRatio).toBe('xMaxYMin slice')
    }
  })

  // Verifies that a single feDropShadow primitive maps to a drop-shadow filter with flood color/opacity.
  it('parses feDropShadow into drop-shadow filter', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feDropShadow dx="3" dy="4" stdDeviation="2" flood-color="#336699" flood-opacity="0.25"/>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.includeSourceGraphic).toBe(true)
      expect(filter.primitiveUnits).toBe('userSpaceOnUse')
      expect(filter.blendMode).toBe('normal')
      expect(filter.dx).toBe(3)
      expect(filter.dy).toBe(4)
      expect(filter.stdDeviation).toBe(2)
      expect(filter.opacity).toBeCloseTo(0.25)
      expect(filter.color).toEqual({ r: 51, g: 102, b: 153 })
    }
  })

  // Verifies that primitiveUnits="objectBoundingBox" is stored with fractional dx/dy/stdDeviation values intact.
  it('parses filter primitiveUnits', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1" primitiveUnits="objectBoundingBox">
          <feDropShadow dx="0.5" dy="0.25" stdDeviation="0.1"/>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.primitiveUnits).toBe('objectBoundingBox')
      expect(filter.dx).toBeCloseTo(0.5)
      expect(filter.dy).toBeCloseTo(0.25)
      expect(filter.stdDeviation).toBeCloseTo(0.1)
    }
  })

  it('inherits filter attributes and primitives through href chains', () => {
    const doc = parseSvg(`<svg width="100" height="100"><defs>
      <filter id="base" filterUnits="userSpaceOnUse" x="5" y="6" width="70" height="80">
        <feFlood flood-color="navy"/>
      </filter>
      <filter id="middle" href="#base" y="7"/>
      <filter id="derived" href="#middle" width="90"><title>ignored description</title></filter>
    </defs></svg>`)
    const filter = doc.defs.filters.get('derived')
    expect(filter?.type).toBe('graph')
    if (filter?.type === 'graph') {
      expect(filter.filterUnits).toBe('userSpaceOnUse')
      expect({ x: filter.x, y: filter.y, width: filter.width, height: filter.height }).toEqual({ x: 5, y: 7, width: 90, height: 80 })
      expect(filter.primitives.map(primitive => primitive.type)).toEqual(['feFlood'])
    }
  })

  it('rejects cyclic filter inheritance', () => {
    expect(() => parseSvg(`<svg><defs>
      <filter id="a" href="#b"/><filter id="b" href="#a"/>
    </defs></svg>`)).toThrow(/cycle/)
  })

  // Verifies that two-value stdDeviation is kept per-axis with the average as the scalar value.
  it('parses anisotropic stdDeviation values in filters', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2 5"/>
          <feOffset dx="1" dy="2"/>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.includeSourceGraphic).toBe(true)
      expect(filter.blendMode).toBe('normal')
      expect(filter.stdDeviationX).toBe(2)
      expect(filter.stdDeviationY).toBe(5)
      expect(filter.stdDeviation).toBeCloseTo(3.5)
    }
  })

  // Verifies that a blur+offset chain without feMerge yields a shadow-only drop-shadow (no SourceGraphic).
  it('parses chain filter without merge as shadow-only result', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1"><feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dx="1" dy="2"/></filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.includeSourceGraphic).toBe(false)
    }
  })

  // Verifies that a feFlood + feComposite coloring chain is recognized as a colored drop-shadow.
  it('parses drop-shadow-like chain with feFlood + feComposite', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
          <feOffset dx="1" dy="2" result="offsetblur"/>
          <feFlood flood-color="#336699" flood-opacity="0.25"/>
          <feComposite operator="in" in2="offsetblur"/>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.color).toEqual({ r: 51, g: 102, b: 153 })
      expect(filter.opacity).toBeCloseTo(0.25)
      expect(filter.includeSourceGraphic).toBe(true)
    }
  })

  // Verifies that the drop-shadow chain analysis follows explicit result/in name references between primitives.
  it('parses drop-shadow chain with explicit result/in references', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur1"/>
          <feOffset in="blur1" dx="3" dy="4" result="shadow1"/>
          <feFlood flood-color="#112233" flood-opacity="0.4" result="flood1"/>
          <feComposite in="flood1" in2="shadow1" operator="in" result="coloredShadow"/>
          <feMerge>
            <feMergeNode in="coloredShadow"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.dx).toBe(3)
      expect(filter.dy).toBe(4)
      expect(filter.opacity).toBeCloseTo(0.4)
      expect(filter.color).toEqual({ r: 17, g: 34, b: 51 })
      expect(filter.includeSourceGraphic).toBe(true)
    }
  })

  // Verifies that a feColorMatrix that only scales alpha is folded into the drop-shadow opacity.
  it('parses drop-shadow chain with feColorMatrix alpha scaling', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur1"/>
          <feOffset in="blur1" dx="1" dy="2" result="off1"/>
          <feColorMatrix in="off1" type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.25 0"/>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.opacity).toBeCloseTo(0.25)
      expect(filter.includeSourceGraphic).toBe(true)
    }
  })

  // Verifies that feBlend against SourceGraphic is accepted as chain composition and its mode is recorded.
  it('parses drop-shadow chain with feBlend composition', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur1"/>
          <feOffset in="blur1" dx="1" dy="2" result="shadow1"/>
          <feBlend in="shadow1" in2="SourceGraphic" mode="multiply"/>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('drop-shadow')
    if (filter?.type === 'drop-shadow') {
      expect(filter.includeSourceGraphic).toBe(true)
      expect(filter.dx).toBe(1)
      expect(filter.dy).toBe(2)
      expect(filter.blendMode).toBe('multiply')
    }
  })

  // Verifies that a non-shadow filter chain is retained as an executable graph.
  it('retains a general filter graph when feMerge uses a named input', () => {
    const svg = `<svg width="100" height="100">
      <defs>
        <filter id="f1">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
          <feOffset dx="1" dy="2"/>
          <feMerge><feMergeNode in="offsetblur"/></feMerge>
        </filter>
      </defs>
    </svg>`
    const doc = parseSvg(svg)
    const filter = doc.defs.filters.get('f1')
    expect(filter?.type).toBe('graph')
    if (filter?.type === 'graph') {
      expect(filter.primitives.map(primitive => primitive.type)).toEqual(['feGaussianBlur', 'feOffset', 'feMerge'])
      expect(filter.primitives[2]!.children[0]!.attributes.in).toBe('offsetblur')
    }
  })

  // Verifies that absolute CSS units (in/cm/pt/pc) are converted to user units at 96dpi.
  it('absolute length units are converted', () => {
    const svg = '<svg width="100" height="100"><rect x="1in" y="1cm" width="72pt" height="6pc"/></svg>'
    const doc = parseSvg(svg)
    const rect = doc.children[0]!
    expect(rect.type).toBe('rect')
    if (rect.type === 'rect') {
      expect(rect.x).toBeCloseTo(96, 5)
      expect(rect.y).toBeCloseTo(96 / 2.54, 5)
      expect(rect.width).toBeCloseTo(96, 5)
      expect(rect.height).toBeCloseTo(96, 5)
    }
  })
})

describe('parseOpenTypeSvg', () => {
  it('requires the OpenType SVG default namespace', () => {
    expect(() => parseOpenTypeSvg('<svg><path d="M0 0"/></svg>')).toThrow(/namespace/)
  })

  it('ignores restricted text and non-PNG/JPEG image content', () => {
    const document = parseOpenTypeSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <g id="glyph1">
        <text x="0" y="10">ignored</text>
        <image href="data:image/svg+xml;base64,PHN2Zy8+" width="10" height="10"/>
        <rect width="10" height="10"/>
      </g>
    </svg>`)
    expect(document.children[0]!.type).toBe('g')
    if (document.children[0]!.type === 'g') {
      expect(document.children[0]!.children.map(node => node.type)).toEqual(['rect'])
    }
  })

  it('ignores complete restricted element subtrees instead of rendering their children', () => {
    const document = parseOpenTypeSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <g id="glyph1">
        <a><rect width="10" height="10"/></a>
        <foreignObject><rect width="10" height="10"/></foreignObject>
        <switch><rect width="10" height="10"/></switch>
        <view><rect width="10" height="10"/></view>
        <rect width="20" height="20"/>
      </g>
    </svg>`)
    expect(document.children[0]!.type).toBe('g')
    if (document.children[0]!.type === 'g') {
      expect(document.children[0]!.children.map(node => node.type)).toEqual(['rect'])
    }
  })

  it('enforces the OpenType namespace, XLink and relative-unit restrictions', () => {
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="urn:test"><path/></svg>')).toThrow(/namespace/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#shape"/></svg>')).toThrow(/XLink namespace/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg" contentStyleType="text/css"><path/></svg>')).toThrow(/contentStyleType/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1em" height="10"/></svg>')).toThrow(/em\/ex units/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="rgba(1,2,3,0.5)"/></svg>')).toThrow(/prohibited color syntax/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:WindowText"/></svg>')).toThrow(/system color/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.x { fill: Highlight }</style><rect class="x"/></svg>')).toThrow(/system color/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red icc-color(profile, 1, 0, 0)"/></svg>')).toThrow(/prohibited color syntax/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>@color-profile p { src: url(p.icc) }</style></svg>')).toThrow(/color-profile/)
    expect(() => parseOpenTypeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect style="color-profile:p"/></svg>')).toThrow(/color-profile/)
  })

  it('rejects direct and indirect use fragment cycles', () => {
    expect(() => parseSvg('<svg><defs><g id="a"><use href="#a"/></g></defs><use href="#a"/></svg>')).toThrow(/reference cycle/)
    expect(() => parseSvg('<svg><defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/></svg>')).toThrow(/reference cycle/)
  })

  it('applies CSS cascade, structural selectors and print media rules', () => {
    const document = parseSvg(`<svg viewBox="0 0 100 100"><style>
      rect { fill: red }
      @media screen { #target { fill: green } }
      @media print { g > rect.mark:first-child { fill: blue } }
      #target { fill: purple }
    </style><g><rect id="target" class="mark" width="10" height="10"/></g></svg>`)
    expect(document.children[0]!.type).toBe('g')
    if (document.children[0]!.type === 'g') {
      expect(document.children[0]!.children[0]!.style.fill?.color).toEqual({ r: 128, g: 0, b: 128 })
    }
  })

  it('evaluates calc lengths with percentages and absolute units', () => {
    const document = parseSvg('<svg viewBox="0 0 200 100"><rect x="calc(50% - 10px)" width="calc(2 * 10px)" height="10"/></svg>')
    const rect = document.children[0]!
    expect(rect.type).toBe('rect')
    if (rect.type === 'rect') {
      expect(rect.x).toBe(90)
      expect(rect.width).toBe(20)
    }
  })

  it('expands internal XML entities and rejects recursive or external entities', () => {
    const document = parseOpenTypeSvg(`<!DOCTYPE svg [<!ENTITY paint "#123456"><!ENTITY size "20">]>
      <svg xmlns="http://www.w3.org/2000/svg"><rect id="glyph1" width="&size;" height="20" fill="&paint;"/></svg>`)
    expect(document.children[0]!.style.fill?.color).toEqual({ r: 18, g: 52, b: 86 })
    expect(() => parseSvg('<!DOCTYPE svg [<!ENTITY a "&b;"><!ENTITY b "&a;">]><svg><rect fill="&a;"/></svg>')).toThrow(/entity cycle/)
    expect(() => parseSvg('<!DOCTYPE svg SYSTEM "external.dtd"><svg/>')).toThrow(/external/)
  })

  it('renders symbol content only through use and applies its viewBox viewport', () => {
    const document = parseOpenTypeSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <symbol id="shape" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
      <use id="glyph1" href="#shape" x="5" y="7" width="20" height="30"/>
    </svg>`)
    expect(document.children).toHaveLength(1)
    expect(document.children[0]!.type).toBe('g')
    expect(document.children[0]!.transform).toEqual([2, 0, 0, 2, 5, 12])
  })
})

describe('parseCssColor', () => {
  // Verifies that 3-digit hex colors expand each nibble to a full channel value.
  it('#RGB', () => {
    expect(parseCssColor('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })

  // Verifies that 6-digit hex colors parse to their RGB channel values.
  it('#RRGGBB', () => {
    expect(parseCssColor('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
  })

  // Verifies that 4- and 8-digit hex colors parse the alpha channel as a 0-1 fraction.
  it('#RGBA/#RRGGBBAA', () => {
    expect(parseCssColor('#0f08')).toEqual({ r: 0, g: 255, b: 0, a: 0x88 / 255 })
    expect(parseCssColor('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 0x80 / 255 })
  })

  // Verifies that CSS named colors resolve to their standard RGB values.
  it('named color', () => {
    expect(parseCssColor('red')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseCssColor('white')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseCssColor('navy')).toEqual({ r: 0, g: 0, b: 128 })
  })

  // Verifies that legacy comma-separated rgb() syntax is parsed.
  it('rgb()', () => {
    expect(parseCssColor('rgb(100, 200, 50)')).toEqual({ r: 100, g: 200, b: 50 })
  })

  // Verifies that legacy rgba() syntax parses the alpha component.
  it('rgba()', () => {
    expect(parseCssColor('rgba(100, 200, 50, 0.4)')).toEqual({ r: 100, g: 200, b: 50, a: 0.4 })
  })

  // Verifies that modern space-separated rgb() syntax with percentages and slash alpha is parsed.
  it('rgb()/rgba() modern syntax', () => {
    expect(parseCssColor('rgb(100% 0% 50%)')).toEqual({ r: 255, g: 0, b: 128 })
    expect(parseCssColor('rgb(255 128 0 / 50%)')).toEqual({ r: 255, g: 128, b: 0, a: 0.5 })
  })

  // Verifies that hsl() in both legacy and modern syntax converts to RGB with optional alpha.
  it('hsl()/hsla()', () => {
    expect(parseCssColor('hsl(120, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 0 })
    expect(parseCssColor('hsl(240 100% 50% / 25%)')).toEqual({ r: 0, g: 0, b: 255, a: 0.25 })
  })

  // Verifies that 'transparent' resolves to black with zero alpha.
  it('transparent', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  // Verifies that unrecognized color strings fall back to opaque black.
  it('unknown → black', () => {
    expect(parseCssColor('invalid')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('parseTransform', () => {
  // Verifies that translate(x, y) maps to the affine matrix [1,0,0,1,tx,ty].
  it('translate', () => {
    expect(parseTransform('translate(10, 20)')).toEqual([1, 0, 0, 1, 10, 20])
  })

  // Verifies that a single scale argument applies uniformly to both axes.
  it('scale uniform', () => {
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0])
  })

  // Verifies that two scale arguments set independent x and y factors.
  it('scale non-uniform', () => {
    expect(parseTransform('scale(2, 3)')).toEqual([2, 0, 0, 3, 0, 0])
  })

  // Verifies that rotate(90) produces the expected cos/sin matrix components.
  it('rotate', () => {
    const [a, b, c, d] = parseTransform('rotate(90)')
    expect(a).toBeCloseTo(0, 5)
    expect(b).toBeCloseTo(1, 5)
    expect(c).toBeCloseTo(-1, 5)
    expect(d).toBeCloseTo(0, 5)
  })

  // Verifies that matrix(...) passes its six components through unchanged.
  it('matrix', () => {
    expect(parseTransform('matrix(1, 0, 0, 1, 10, 20)')).toEqual([1, 0, 0, 1, 10, 20])
  })

  // Verifies that multiple transform functions are composed left-to-right into one matrix.
  it('chained transforms', () => {
    const m = parseTransform('translate(10, 0) scale(2)')
    expect(m[0]).toBe(2)
    expect(m[4]).toBe(10)
  })

  // Verifies that skewX(angle) places tan(angle) into the matrix c component.
  it('skewX', () => {
    const m = parseTransform('skewX(45)')
    expect(m[0]).toBe(1)
    expect(m[2]).toBeCloseTo(1, 5) // tan(45°) = 1
  })
})

describe('multiplyMatrix', () => {
  // Verifies that multiplying two identity matrices yields the identity matrix.
  it('identity * identity', () => {
    const id: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
    expect(multiplyMatrix(id, id)).toEqual([1, 0, 0, 1, 0, 0])
  })

  // Verifies that composing two translations sums their offsets.
  it('translate * translate', () => {
    const t1: [number, number, number, number, number, number] = [1, 0, 0, 1, 10, 20]
    const t2: [number, number, number, number, number, number] = [1, 0, 0, 1, 30, 40]
    const result = multiplyMatrix(t1, t2)
    expect(result[4]).toBe(40) // 10 + 30
    expect(result[5]).toBe(60) // 20 + 40
  })
})
