import type {
  PdfCatalogModel,
  PdfCollection,
  PdfPageOptions,
} from './renderer/pdf-backend.js'

export interface PdfOptionImageSources {
  catalog?: Pick<PdfCatalogModel, 'spiderInfo'>
  collection?: Pick<PdfCollection, 'folders'>
  pageOptions?: readonly Pick<PdfPageOptions, 'thumbnailImageId'>[]
}

export type PdfOptionImageReference =
  | { imageId: string, usage: 'Web Capture image' }
  | { imageId: string, usage: 'collection folder thumbnail' }
  | { imageId: string, usage: 'page thumbnail', pageIndex: number }

/** Returns every image reference consumed from PDF document and page options. */
export function collectPdfOptionImageReferences(
  sources: PdfOptionImageSources,
): PdfOptionImageReference[] {
  const references: PdfOptionImageReference[] = []
  const spiderInfo = sources.catalog?.spiderInfo
  if (spiderInfo !== undefined) {
    for (let setIndex = 0; setIndex < spiderInfo.contentSets.length; setIndex++) {
      const objects = spiderInfo.contentSets[setIndex]!.objects
      for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
        const object = objects[objectIndex]!
        if (object.kind === 'image') references.push({ imageId: object.imageId, usage: 'Web Capture image' })
      }
    }
  }

  const rootFolder = sources.collection?.folders
  if (rootFolder !== undefined) addCollectionFolderImageReferences(rootFolder, references)

  const pageOptions = sources.pageOptions
  if (pageOptions !== undefined) {
    for (let pageIndex = 0; pageIndex < pageOptions.length; pageIndex++) {
      const thumbnailImageId = pageOptions[pageIndex]!.thumbnailImageId
      if (thumbnailImageId !== undefined) {
        references.push({ imageId: thumbnailImageId, usage: 'page thumbnail', pageIndex })
      }
    }
  }
  return references
}

function addCollectionFolderImageReferences(
  folder: NonNullable<PdfCollection['folders']>,
  references: PdfOptionImageReference[],
): void {
  if (folder.thumbnailImageId !== undefined) {
    references.push({ imageId: folder.thumbnailImageId, usage: 'collection folder thumbnail' })
  }
  if (folder.children === undefined) return
  for (let childIndex = 0; childIndex < folder.children.length; childIndex++) {
    addCollectionFolderImageReferences(folder.children[childIndex]!, references)
  }
}
