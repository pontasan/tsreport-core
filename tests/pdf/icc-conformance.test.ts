import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectIccProfile, parseIccProfile } from '../../src/pdf/icc-profile-reader.js'
import { generateCmykIccProfile, generateSRGBIccProfile } from '../../src/renderer/icc-profile.js'

const CONVERT_AVAILABLE = spawnSync('convert', ['-version']).status === 0
if (process.env.TSREPORT_PDF_CONFORMANCE === '1' && !CONVERT_AVAILABLE) {
  throw new Error('ICC conformance requires ImageMagick convert')
}

describe.skipIf(!CONVERT_AVAILABLE)('ICC independent color-management oracle', function () {
  it('matches an independent ICC engine for generated output and display profiles', function () {
    const directory = mkdtempSync(join(tmpdir(), 'tsreport-icc-oracle-'))
    try {
      const sourcePath = join(directory, 'source-srgb.icc')
      const destinationPath = join(directory, 'destination-srgb.icc')
      const sourceProfile = generateSRGBIccProfile()
      const destinationProfile = generateSRGBIccProfile()
      writeFileSync(sourcePath, sourceProfile)
      writeFileSync(destinationPath, destinationProfile)

      expect(inspectIccProfile(generateCmykIccProfile())).toMatchObject({
        profileClass: 'output', dataColorSpace: 'CMYK', connectionSpace: 'Lab', components: 4,
      })
      expect(inspectIccProfile(sourceProfile)).toMatchObject({
        profileClass: 'display', dataColorSpace: 'RGB', connectionSpace: 'XYZ', components: 3,
      })

      const sample = [180, 90, 30]
      const ppm = Buffer.concat([Buffer.from('P6\n1 1\n255\n'), Buffer.from(sample)])
      const oracle = execFileSync('convert', [
        'ppm:-', '+profile', '*',
        '-profile', sourcePath, '-intent', 'relative', '-profile', destinationPath, 'ppm:-',
      ], { input: ppm })
      const expected = oracle.subarray(oracle.length - 3)
      const actual = parseIccProfile(sourceProfile)!.toRgb(
        sample.map(function (value) { return value / 255 }),
        'RelativeColorimetric',
      ).map(function (value) { return Math.round(value * 255) })
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(actual[channel]! - expected[channel]!), `ICC channel ${channel}`).toBeLessThanOrEqual(1)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
