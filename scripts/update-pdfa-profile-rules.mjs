import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const commit = 'c4b3ab5164e4f0ae9bb235f8154db587e0ea483e'
const profiles = [
  {
    profile: 'PDF/A-1b',
    file: 'PDFA-1B.xml',
    specification: 'ISO_19005_1',
    sha256: '93a8254a209a298cdf38d2f259906d585dfcdd1cc700650271b86920be9c00e6',
  },
  {
    profile: 'PDF/A-2b',
    file: 'PDFA-2B.xml',
    specification: 'ISO_19005_2',
    sha256: 'bae015161f0c9b4296481f11936c97728dfd12dffb2df48ea744f885794da382',
  },
  {
    profile: 'PDF/A-3b',
    file: 'PDFA-3B.xml',
    specification: 'ISO_19005_3',
    sha256: 'fc6f5c9cccc8c52af8584f98505fe62979522e66acd525a67ce391c36d8dbc17',
  },
]

function assignRuleFamily(specification, clause) {
  if (clause.startsWith('6.1.2') || clause.startsWith('6.1.3') || clause.startsWith('6.1.4')) {
    return 'file-framing-and-trailers'
  }
  if (specification === 'ISO_19005_1') {
    if (clause.startsWith('6.1.6') || clause.startsWith('6.1.8') || clause.startsWith('6.1.12')) {
      return 'object-syntax-and-limits'
    }
    if (clause.startsWith('6.1.7') || clause.startsWith('6.1.10') || clause.startsWith('6.1.11')) {
      return 'filters-encryption-and-filespec-boundary'
    }
    if (clause.startsWith('6.1.13')) return 'optional-content-configurations'
    if (clause.startsWith('6.2.2') || clause.startsWith('6.2.3')) return 'output-intents-icc-and-device-colour'
    if (clause.startsWith('6.2.4') || clause.startsWith('6.2.5')
      || clause.startsWith('6.2.6') || clause.startsWith('6.2.7')) return 'images-xobjects-and-jpeg2000'
    if (clause.startsWith('6.2.8') || clause.startsWith('6.2.9')
      || clause.startsWith('6.2.10')) return 'content-graphics-state-halftones-and-overprint'
    if (clause.startsWith('6.3')) return 'fonts-cmaps-glyphs-widths-and-rendering-mode'
    if (clause.startsWith('6.4')) return 'transparency-blend-and-page-groups'
    if (clause.startsWith('6.5') || clause.startsWith('6.6')) return 'annotations-actions-and-appearances'
    if (clause.startsWith('6.7')) return 'xmp-identification-synchronization-and-extension-schemas'
    if (clause.startsWith('6.9')) return 'acroform-appearance-and-action-boundary'
  } else {
    if (clause.startsWith('6.1.6') || clause.startsWith('6.1.8') || clause.startsWith('6.1.9')
      || clause.startsWith('6.1.13') || clause.startsWith('6.10') || clause.startsWith('6.11')) {
      return 'object-syntax-and-limits'
    }
    if (clause.startsWith('6.1.7') || clause.startsWith('6.1.10')) {
      return 'filters-encryption-and-filespec-boundary'
    }
    if (clause.startsWith('6.1.12') || clause.startsWith('6.4.3')) {
      return 'signatures-permissions-and-whole-file-byte-range'
    }
    if (clause.startsWith('6.2.2') || clause.startsWith('6.2.5') || clause.startsWith('6.2.6')) {
      return 'content-graphics-state-halftones-and-overprint'
    }
    if (clause.startsWith('6.2.3') || clause.startsWith('6.2.4')) {
      return 'output-intents-icc-and-device-colour'
    }
    if (clause.startsWith('6.2.8') || clause.startsWith('6.2.9')) return 'images-xobjects-and-jpeg2000'
    if (clause.startsWith('6.2.10')) return 'transparency-blend-and-page-groups'
    if (clause.startsWith('6.2.11')) return 'fonts-cmaps-glyphs-widths-and-rendering-mode'
    if (clause.startsWith('6.3') || clause.startsWith('6.5')) return 'annotations-actions-and-appearances'
    if (clause.startsWith('6.4.1') || clause.startsWith('6.4.2')) return 'acroform-appearance-and-action-boundary'
    if (clause.startsWith('6.6')) return 'xmp-identification-synchronization-and-extension-schemas'
    if (clause.startsWith('6.8')) return 'embedded-and-associated-files'
    if (clause.startsWith('6.9')) return 'optional-content-configurations'
  }
  throw new Error(`No PDF/A rule-family assignment for ${specification} ${clause}`)
}

const inventories = []
for (const profile of profiles) {
  const url = `https://raw.githubusercontent.com/veraPDF/veraPDF-validation-profiles/${commit}/PDF_A/${profile.file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to read ${url}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== profile.sha256) throw new Error(`${profile.file} SHA-256 changed: ${sha256}`)
  const xml = new TextDecoder().decode(bytes)
  const rules = []
  const pattern = /<rule\s+object="([^"]+)"[^>]*>([\s\S]*?)<\/rule>/g
  for (const match of xml.matchAll(pattern)) {
    const id = /<id specification="([^"]+)" clause="([^"]+)" testNumber="([^"]+)"\/>/.exec(match[2])
    if (id === null) throw new Error(`${profile.file} contains a rule without an ID`)
    if (id[1] !== profile.specification) throw new Error(`${profile.file} contains unexpected specification ${id[1]}`)
    rules.push({
      id: `${id[1]}:${id[2]}:${id[3]}`,
      object: match[1],
      family: assignRuleFamily(id[1], id[2]),
    })
  }
  const unique = new Set(rules.map(function (rule) { return rule.id }))
  if (unique.size !== rules.length) throw new Error(`${profile.file} contains duplicate rule IDs`)
  inventories.push({
    profile: profile.profile,
    file: profile.file,
    sha256,
    ruleIdSha256: createHash('sha256').update(rules.map(function (rule) { return rule.id }).join('\n')).digest('hex'),
    rules,
  })
}

const output = {
  schemaVersion: 1,
  source: {
    creator: 'veraPDF Consortium',
    copyright: 'Copyright © 2015 veraPDF Consortium',
    repository: 'https://github.com/veraPDF/veraPDF-validation-profiles',
    commit,
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    modifications: 'Extracted PDF/A-1b, PDF/A-2b, and PDF/A-3b rule identifiers and object names; assigned tsreport-core coverage-family labels; recorded source hashes.',
  },
  profiles: inventories,
}

writeFileSync(
  resolve(process.cwd(), 'conformance/pdfa-verapdf-profile-rules.json'),
  `${JSON.stringify(output, null, 2)}\n`,
)
