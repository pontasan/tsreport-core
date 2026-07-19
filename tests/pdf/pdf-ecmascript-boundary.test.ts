import { describe, expect, it } from 'vitest'
import * as core from '../../src/index.js'
import { PdfBackend, PdfImporter } from '../../src/index.js'

describe('ISO 21757-1 ECMAScript execution boundary', function () {
  it('does not expose a partial PDF ECMAScript execution API', function () {
    const publicNames = Object.keys(core)
    expect(publicNames.filter(function (name) {
      return /(?:execute|evaluate|run).*pdf.*(?:javascript|ecmascript)|(?:javascript|ecmascript).*(?:execute|evaluate|run)/i.test(name)
    })).toEqual([])

    // The public type surface deliberately has no partial ISO 21757 executor.
    // @ts-expect-error PDF JavaScript is data-only until the complete API contract is implemented.
    expect(core.executePdfJavaScript).toBeUndefined()
  })

  it('round-trips scripts as inert source without evaluating them', function () {
    const marker = '__tsreport_pdf_javascript_executed__'
    const globalRecord = globalThis as typeof globalThis & Record<string, unknown>
    delete globalRecord[marker]
    const script = `globalThis.${marker} = true`
    const backend = new PdfBackend({
      fonts: {},
      javaScript: [{ name: 'DocumentScript', script }],
    })
    backend.beginDocument()
    backend.beginPage(20, 20)
    backend.endPage()
    backend.endDocument()

    expect(PdfImporter.open(backend.toUint8Array()).importJavaScript()).toEqual([
      { name: 'DocumentScript', script },
    ])
    expect(globalRecord[marker]).toBeUndefined()
  })
})
