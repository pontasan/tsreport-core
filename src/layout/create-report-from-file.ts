import type { ReportTemplate, DataSource } from '../types/template.js'
import type { RenderDocument } from '../types/render.js'
import { NodeLocalFileResolver } from '../node-file-resolver.js'
import { currentWorkingDirectory } from '../runtime-environment.js'
import {
  LayoutEngine,
  mergeReportResources,
  type FontMap,
  type CreateReportOptions,
  type SubreportTemplateResolver,
} from './engine.js'
import { ResourceResolver } from './resource-resolver.js'

function readTemplateJsonFromFile(path: string, localFileResolver: NodeLocalFileResolver): ReportTemplate {
  const text = localFileResolver.readText(path)
  return JSON.parse(text) as ReportTemplate
}

function createDefaultSubreportResolver(
  cache: Map<string, { template: ReportTemplate; workingDirectory: string }>,
  referenceCache: Map<string, { template: ReportTemplate; workingDirectory: string } | null>,
  localFileResolver: NodeLocalFileResolver,
): SubreportTemplateResolver {
  return (ref, context) => {
    const referenceKey = context.workingDirectory + '\0' + ref
    const referenceCached = referenceCache.get(referenceKey)
    if (referenceCached === null) return null
    if (referenceCached !== undefined) return referenceCached

    const resolution = localFileResolver.resolve(ref, context.workingDirectory, 'template')
    if (resolution.status === 'missing') {
      referenceCache.set(referenceKey, null)
      return null
    }
    let resolved = cache.get(resolution.path)
    if (resolved === undefined) {
      resolved = {
        template: readTemplateJsonFromFile(resolution.path, localFileResolver),
        workingDirectory: localFileResolver.directory(resolution.path),
      }
      cache.set(resolution.path, resolved)
    }
    referenceCache.set(referenceKey, resolved)
    return resolved
  }
}

export function createReportFromFile(
  templateFilePath: string,
  dataSource: DataSource & Record<string, unknown>,
  fontMap?: FontMap,
): RenderDocument
export function createReportFromFile(
  templateFilePath: string,
  dataSource: DataSource & Record<string, unknown>,
  options?: CreateReportOptions,
): RenderDocument
export function createReportFromFile(
  templateFilePath: string,
  dataSource: DataSource & Record<string, unknown>,
  arg3?: FontMap | CreateReportOptions,
): RenderDocument {
  let fontMap: FontMap | undefined
  let options: CreateReportOptions | undefined
  if (arg3 instanceof Map) {
    fontMap = arg3
  } else if (arg3) {
    options = arg3
    fontMap = arg3.fontMap
  }

  const baseDirectory = options?.workingDirectory ?? currentWorkingDirectory()
  const localFileResolver = new NodeLocalFileResolver(options?.resources?.fileRoot)
  const mainResolution = localFileResolver.resolve(templateFilePath, baseDirectory, 'template')
  if (mainResolution.status === 'missing') throw new Error(`Template file not found: ${templateFilePath}`)
  const mainTemplatePath = mainResolution.path
  const mainTemplate = readTemplateJsonFromFile(mainTemplatePath, localFileResolver)
  const mainTemplateDirectory = localFileResolver.directory(mainTemplatePath)
  const cache = new Map<string, { template: ReportTemplate; workingDirectory: string }>()
  const referenceCache = new Map<string, { template: ReportTemplate; workingDirectory: string } | null>()
  cache.set(mainTemplatePath, { template: mainTemplate, workingDirectory: mainTemplateDirectory })

  const workingDirectory = options?.workingDirectory ?? mainTemplateDirectory
  const resources = mergeReportResources(dataSource, options?.resources)
  const subreportResolver = options?.resolveSubreportTemplate
    ?? createDefaultSubreportResolver(cache, referenceCache, localFileResolver)
  const resourceResolver = new ResourceResolver(resources, workingDirectory, true, localFileResolver)
  return new LayoutEngine(
    mainTemplate,
    dataSource,
    fontMap,
    0,
    resources,
    workingDirectory,
    subreportResolver,
    true,
    resourceResolver,
  ).run()
}
