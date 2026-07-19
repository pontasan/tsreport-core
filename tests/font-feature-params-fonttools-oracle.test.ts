import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Font } from '../src/font.js'

const FIXTURES = resolve(import.meta.dirname, 'fixtures/fonts')

const ORACLE = `
import json,sys
from fontTools.ttLib import TTFont
font=TTFont(sys.argv[1])
result=[]
for table_tag in ('GSUB','GPOS'):
  if table_tag not in font: continue
  records=font[table_tag].table.FeatureList.FeatureRecord
  for index,record in enumerate(records):
    params=getattr(record.Feature,'FeatureParams',None)
    if params is None: continue
    item={'table':table_tag,'featureIndex':index,'tag':record.FeatureTag,'lookupIndices':record.Feature.LookupListIndex}
    if record.FeatureTag == 'size':
      item['params']={'kind':'size','designSize':round(params.DesignSize*10),'subfamilyId':params.SubfamilyID,'subfamilyNameId':params.SubfamilyNameID,'rangeStart':round(params.RangeStart*10),'rangeEnd':round(params.RangeEnd*10)}
    elif record.FeatureTag.startswith('ss'):
      item['params']={'kind':'stylistic-set','version':params.Version,'uiNameId':params.UINameID}
    elif record.FeatureTag.startswith('cv'):
      item['params']={'kind':'character-variant','format':params.Format,'uiLabelNameId':params.FeatUILabelNameID,'tooltipNameId':params.FeatUITooltipTextNameID,'sampleTextNameId':params.SampleTextNameID,'namedParameterCount':params.NumNamedParameters,'firstParameterUiLabelNameId':params.FirstParamUILabelNameID,'characters':params.Character}
    result.append(item)
print(json.dumps(result))
`

describe('OpenType FeatureParams public API', () => {
  for (const fileName of ['NotoSans-Regular.ttf', 'SourceSans3-Regular.otf', 'hb-feature-variations.otf']) {
    it(`matches fontTools for ${fileName}`, () => {
      const path = resolve(FIXTURES, fileName)
      const bytes = readFileSync(path)
      const font = Font.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      const expected = JSON.parse(execFileSync('python3', ['-c', ORACLE, path], { encoding: 'utf8' }))
      const actual = font.getOpenTypeLayoutFeatures().filter(function (feature) {
        return feature.params !== null
      })
      expect(actual).toEqual(expected)
    })
  }
})
