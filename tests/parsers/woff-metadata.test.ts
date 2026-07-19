import { describe, expect, it } from 'vitest'
import { parseWoffMetadata, selectWoffMetadataLanguage } from '../../src/index.js'
import type { WoffMetadataElement } from '../../src/index.js'

const COMPLETE_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<metadata version="1.0">
  <uniqueid id="org.example.demo"/>
  <vendor name="Example Foundry" url="https://example.test" dir="ltr" class="vendor"/>
  <credits><credit name="Designer" role="design" url="https://example.test/designer" dir="ltr" class="person"/></credits>
  <description url="https://example.test/font">
    <text xml:lang="en" dir="ltr" class="description"><div>English <span class="em">description</span>.</div></text>
    <text xml:lang="ja">日本語の説明</text>
  </description>
  <license id="demo-license" url="https://example.test/license"><text lang="en">License</text></license>
  <copyright><text>Copyright</text></copyright>
  <trademark><text>Trademark</text></trademark>
  <licensee name="Customer" dir="ltr" class="licensee"/>
  <extension id="org.example.extension">
    <name xml:lang="en">Extra data</name>
    <item id="purpose"><name xml:lang="en">Purpose</name><value xml:lang="en">Testing</value></item>
  </extension>
</metadata>`

function elements(parent: WoffMetadataElement, name: string): WoffMetadataElement[] {
  return parent.children.filter(function (child): child is WoffMetadataElement {
    return typeof child !== 'string' && child.name === name
  })
}

describe('WOFF extended metadata', () => {
  it('preserves every standard element, attribute, localization, and mixed-content node', () => {
    const document = parseWoffMetadata(COMPLETE_METADATA)
    expect(document.version).toBe('1.0')
    expect(elements(document.root, 'uniqueid')[0]?.attributes.id).toBe('org.example.demo')
    expect(elements(document.root, 'vendor')[0]?.attributes.class).toBe('vendor')
    expect(elements(elements(document.root, 'credits')[0]!, 'credit')[0]?.attributes.role).toBe('design')
    const localized = elements(elements(document.root, 'description')[0]!, 'text')
    expect(selectWoffMetadataLanguage(localized, ['ja-JP'])?.attributes['xml:lang']).toBe('ja')
    expect(elements(localized[0]!, 'div')[0]?.children.some(function (child) { return typeof child !== 'string' && child.name === 'span' })).toBe(true)
    expect(elements(document.root, 'extension')).toHaveLength(1)
  })

  it('uses unlabelled and first localization fallbacks in specification order', () => {
    const root = parseWoffMetadata('<metadata version="1.0"><description><text xml:lang="fr">fr</text><text>default</text></description></metadata>').root
    const localized = elements(elements(root, 'description')[0]!, 'text')
    expect(selectWoffMetadataLanguage(localized, ['de'])?.attributes['xml:lang']).toBeUndefined()
    expect(selectWoffMetadataLanguage(localized.slice(0, 1), ['de'])?.attributes['xml:lang']).toBe('fr')
  })

  it('rejects schema violations', () => {
    expect(() => parseWoffMetadata('<metadata version="2.0"/>')).toThrow('version must be 1.0')
    expect(() => parseWoffMetadata('<metadata version="1.0"><vendor/></metadata>')).toThrow('requires name')
    expect(() => parseWoffMetadata('<metadata version="1.0"><description/></metadata>')).toThrow('requires text')
    expect(() => parseWoffMetadata('<metadata version="1.0"><vendor name="x" dir="up"/></metadata>')).toThrow('invalid direction')
    expect(() => parseWoffMetadata('<metadata version="1.0"><extension><item><value>x</value><name>n</name></item></extension></metadata>')).toThrow('names must precede values')
    expect(() => parseWoffMetadata('<metadata version="1.0"><unknown/></metadata>')).toThrow('not permitted')
  })

  it('rejects malformed XML and entity references', () => {
    expect(() => parseWoffMetadata('<metadata version="1.0"><license></metadata>')).toThrow('mismatched closing tag')
    expect(() => parseWoffMetadata('<metadata version="1.0"><license><text>&unknown;</text></license></metadata>')).toThrow('entity reference')
    expect(() => parseWoffMetadata('<metadata version="1.0"><license><text>&</text></license></metadata>')).toThrow('entity reference')
  })
})
