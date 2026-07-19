import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Font } from '../../src/font.js'
import { SvgBackend } from '../../src/renderer/svg-backend.js'

const HB_VIEW = '/opt/homebrew/bin/hb-view'
// OFL-licensed single-glyph subset of googlefonts/noto-emoji Noto-COLRv1.ttf.
const FONT_BASE64 = `AAEAAAAPAIAAAwBwQ09MUr0Yo1gAAAqQAAABJUNQQUyR+yLwAAALuAAAAC5HU1VCuPq49AAAC+gAAAAqT1MvMl8qYDoAAARUAAAA
YGNtYXAAEuxWAAAEtAAAADBnbHlmOy5WdwAAAPwAAAKqaGVhZC28yAcAAAPgAAAANmhoZWEItQgjAAAEMAAAACRobXR4CjsG4QAA
BBgAAAAYbG9jYQJ8A0EAAAPIAAAAGG1heHAC/TVkAAADqAAAACBuYW1leturfgAABOQAAAWKcG9zdP+2ADMAAApwAAAAIHZoZWEH
MAKXAAAMLAAAACR2bXR4BOIAAAAADBQAAAAYAAEBvAEEAfcBOQALAAABFgcGBicxJjc2NhcB6Q4JBRUKDgkFFQoBNA0SCgcFDRIK
BwUAAQBW/1wElgN0ABcAAAUyNjc2NjU0JicmJiMiDgMVFB4DAnZsxEtRVFRRS8NtTpyMbD4+bIycpEdBSMV3d8dHQkUoUX2qbGyp
fVIoAAEBdwGGAg0CNgANAAABMhYVFAYjMSImNTQ2MwHCHi0tHh0uLh0CNi8pKS8vKSkvAAEC3wGGA3UCNgANAAABMhYVFAYjMSIm
NTQ2MwMqHS4uHR0uLh0CNi8pKS8vKSkvAAEAo/9cBJoCoAAXAAABFhUUBgcGBiMiJiYnHgIzMjY3NjY1NAQ7X1VQS8RsWrKYMzWS
qFVsxEtRVAKgg7V3xUhBRzVsUklfL0dBSMZ2oQAAAQED//kD7AE2ABYAAAEWBgcGBiMjIiYnJiY3NjYXFjcWNzYWA+IKCQgtvHoB
erwtCQgJCiYTkZeYkBMnARcSJxJjcHBjEicSEQ4HKgEBKgcOAAEB1f/3AxQAXAATAAAlFhcGIyMGJzY2NzY2NzYXNhcWFgMNBANL
UAJUTgIDAwIGAz9RTzwCBh4FBRwBHwIFAgMEAzIBAjUCBQAAAQEIALED6AE2ABUAAAE2FhcWFwYHBicGJyYnNjc2NhcWNxYDnxMn
CQUBBgWnt8CsBgUBAwomE5GXmAEvBw4RCQkDAk8CAlYCAwUGEQ4HKgEBAAEBAwCtA+wBNgArAAABFgYHBgYHMDY2JicmJyIHBicj
BicmIwYHBgYWFjEmJyYmNzY2FxY3Fjc2FgPjCQgIBAkEBQUBBgoRBgeTmgOalAcGEQkGAgUGCQcJCAkKJhORl5eRFCYBFhEnEggP
CBchHwgOAQIsAQEsAgEOCB8hFw8QEicSEQ4HKgEBKgcOAAAAAAEAAAALNWMC8QAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
GQA/AFcAbwCXAMAA5QEOAVUAAQAAAAINDgxCvQVfDzz1AAMEAAAAAADk07t+AAAAAOTTu8QAI/8GBNoDtgAAAAYAAgAAAAAAAAT7
ADMAAAG8AFYBdwLfAKMBAwHVAQgBAwABAAADtv8GAAAE+wAjACEE2gQAAAAAAAAAAAAAAAAAAAAAAQAEBPsBkAAFAAACmgJmAAAA
TQKaAmYAAAFmADMBMwAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAABOT05FAMD/////A7b/BgAAA7YA+gAAAAEAAAAAAgACzQAA
ACAACQAAAAIAAAAEAAAAFAADAAoAAAAUAAwAAAAAABwAAAAAAAAAAQAB9gAAAfYAAAAAAQAAAA8AugADAAEECQAAADQAAAADAAEE
CQABACAANAADAAEECQACAA4AVAADAAEECQADACAANAADAAEECQAEACAANAADAAEECQAFAJ4AYgADAAEECQAGABwBAAADAAEECQAH
AEQBHAADAAEECQAIABgBYAADAAEECQAJABgBYAADAAEECQAKADwBeAADAAEECQALAFIBtAADAAEECQAMAFIBtAADAAEECQANApYC
BgADAAEECQAOADQEnABDAG8AcAB5AHIAaQBnAGgAdAAgADIAMAAyADIAIABHAG8AbwBnAGwAZQAgAEkAbgBjAC4ATgBvAHQAbwAg
AEMAbwBsAG8AcgAgAEUAbQBvAGoAaQBSAGUAZwB1AGwAYQByAFYAZQByAHMAaQBvAG4AIAAyAC4AMAA1ADEAOwBHAE8ATwBHADsA
bgBvAHQAbwAtAGUAbQBvAGoAaQA6ADIAMAAyADUAMAA4ADEAOAA6AGUAOQAyADcANQAzAGIAZgBhADUANQBmAGQANAA0ADkAZQA0
ADIANwBkADQAZAAzADIANQBmADkAYwA4AGMANAAwADQAMAA4AGMANwA0AGUATgBvAHQAbwBDAG8AbABvAHIARQBtAG8AagBpAE4A
bwB0AG8AIABpAHMAIABhACAAdAByAGEAZABlAG0AYQByAGsAIABvAGYAIABHAG8AbwBnAGwAZQAgAEkAbgBjAC4ARwBvAG8AZwBs
AGUALAAgAEkAbgBjAC4AQwBvAGwAbwByACAAZQBtAG8AagBpACAAZgBvAG4AdAAgAHUAcwBpAG4AZwAgAEMATwBMAFIAdgAxAC4A
aAB0AHQAcABzADoALwAvAGcAaQB0AGgAdQBiAC4AYwBvAG0ALwBnAG8AbwBnAGwAZQBmAG8AbgB0AHMALwBuAG8AdABvAC0AZQBt
AG8AagBpAFQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlACAAaQBzACAAbABpAGMAZQBuAHMAZQBkACAAdQBuAGQA
ZQByACAAdABoAGUAIABTAEkATAAgAE8AcABlAG4AIABGAG8AbgB0ACAATABpAGMAZQBuAHMAZQAsACAAVgBlAHIAcwBpAG8AbgAg
ADEALgAxAC4AIABUAGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAgAGkAcwAgAGQAaQBzAHQAcgBpAGIAdQB0AGUA
ZAAgAG8AbgAgAGEAbgAgACIAQQBTACAASQBTACIAIABCAEEAUwBJAFMALAAgAFcASQBUAEgATwBVAFQAIABXAEEAUgBSAEEATgBU
AEkARQBTACAATwBSACAAQwBPAE4ARABJAFQASQBPAE4AUwAgAE8ARgAgAEEATgBZACAASwBJAE4ARAAsACAAZQBpAHQAaABlAHIA
IABlAHgAcAByAGUAcwBzACAAbwByACAAaQBtAHAAbABpAGUAZAAuACAAUwBlAGUAIAB0AGgAZQAgAFMASQBMACAATwBwAGUAbgAg
AEYAbwBuAHQAIABMAGkAYwBlAG4AcwBlACAAZgBvAHIAIAB0AGgAZQAgAHMAcABlAGMAaQBmAGkAYwAgAGwAYQBuAGcAdQBhAGcA
ZQAsACAAcABlAHIAbQBpAHMAcwBpAG8AbgBzACAAYQBuAGQAIABsAGkAbQBpAHQAYQB0AGkAbwBuAHMAIABnAG8AdgBlAHIAbgBp
AG4AZwAgAHkAbwB1AHIAIAB1AHMAZQAgAG8AZgAgAHQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlAC4AaAB0AHQA
cAA6AC8ALwBzAGMAcgBpAHAAdABzAC4AcwBpAGwALgBvAHIAZwAvAE8ARgBMAAAAAwAAAAAAAP+zADMAAAAAAAAAAAAAAAAAAAAA
AAAAAAABAAAAAAAAAAAAAAAAAAAAIgAAADIAAAEQAAAAAAAAAAAAAAABAAEAAAAKAQoAAAAAAAAACgAAACwAAABXAAAAXQAAAHwA
AACCAAAArAAAALIAAAC9AAAAyAAAANMKAAAGAAMGAAAQAnYBaAAAAnYBaAIWAAADIAAABkAAOuEABUAAQAAABEAACgAAYQAEDAAA
LAAABwABAAAAAAAAAAAAAAABAAD/1hgQAN0P3woAADwABQwAAAcAABIKAAAGAAICAAFAAAABAAAAAAAAAAAAAAABAAABPaAAAN0P
3woAAC0ABgoAAAYABwIAAEAACgAABgAIAgADQAAKAAAGAAkCAAdAAAoAAAYACgIAAkAAAQAAAAEAAQABAAAMAQBA/0AEoAOAAAAA
AAAACAABAAgAAAAOAAANK0L/JGCJ/wCP6/9wd+3/I6L0/yvA9/8w4P3//////wAAAAEAAAAKACYAKAACREZMVAAObGF0bgAYAAQA
AAAA//8AAAAAAAAAAAAAAAAE4gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAn79ggAABOIAAAAyBLAAAAAAAAAAAAAAAAAAAAAA
AAE=`

const available = existsSync(HB_VIEW)

describe.skipIf(!available)('COLR v1 HarfBuzz raster oracle', function () {
  const directory = join(tmpdir(), `tsreport-colr-${process.pid}`)
  const fontPath = join(directory, 'smile.ttf')
  const oraclePath = join(directory, 'oracle.png')

  beforeAll(function () {
    mkdirSync(directory, { recursive: true })
    writeFileSync(fontPath, Buffer.from(FONT_BASE64.replace(/\s/g, ''), 'base64'))
    execFileSync(HB_VIEW, ['--output-file', oraclePath, '--output-format=png', '--font-size=200', fontPath, '😀'])
  })

  afterAll(function () { rmSync(directory, { recursive: true, force: true }) })

  it('matches the independently rasterized paint graph', async function () {
    const bytes = Buffer.from(FONT_BASE64.replace(/\s/g, ''), 'base64')
    const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const backend = new SvgBackend({ fonts: { emoji: font }, background: '#ffffff' })
    backend.beginDocument()
    backend.beginPage(300, 300)
    backend.drawText(20, 20, '😀', 'emoji', 200, '#000000')
    backend.endPage()
    backend.endDocument()
    const svg = backend.getPages()[0]!
    const actual = await sharp(Buffer.from(svg)).flatten({ background: '#fff' })
      .trim({ background: '#fff' }).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    const expected = await sharp(oraclePath).flatten({ background: '#fff' })
      .trim({ background: '#fff' }).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    let absoluteError = 0
    for (let i = 0; i < actual.length; i++) absoluteError += Math.abs(actual[i]! - expected[i]!)
    expect(absoluteError / actual.length).toBeLessThan(3)

    const subset = Font.load(font.subsetPreservingTables('😀').buffer)
    const subsetBackend = new SvgBackend({ fonts: { emoji: subset }, background: '#ffffff' })
    subsetBackend.beginDocument()
    subsetBackend.beginPage(300, 300)
    subsetBackend.drawText(20, 20, '😀', 'emoji', 200, '#000000')
    subsetBackend.endPage()
    subsetBackend.endDocument()
    const subsetPixels = await sharp(Buffer.from(subsetBackend.getPages()[0]!)).flatten({ background: '#fff' })
      .trim({ background: '#fff' }).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    let subsetError = 0
    for (let i = 0; i < subsetPixels.length; i++) subsetError += Math.abs(subsetPixels[i]! - expected[i]!)
    expect(subsetError / subsetPixels.length).toBeLessThan(3)

    const compact = Font.load(font.subset('😀'))
    const compactBackend = new SvgBackend({ fonts: { emoji: compact }, background: '#ffffff' })
    compactBackend.beginDocument()
    compactBackend.beginPage(300, 300)
    compactBackend.drawText(20, 20, '😀', 'emoji', 200, '#000000')
    compactBackend.endPage()
    compactBackend.endDocument()
    const compactPixels = await sharp(Buffer.from(compactBackend.getPages()[0]!)).flatten({ background: '#fff' })
      .trim({ background: '#fff' }).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    let compactError = 0
    for (let i = 0; i < compactPixels.length; i++) compactError += Math.abs(compactPixels[i]! - expected[i]!)
    expect(compactError / compactPixels.length).toBeLessThan(3)
  })
})
