export {
  normalizePdfEmbeddedFont,
} from './pdf/pdf-embedded-font.js'
export {
  Font,
  type FontLoadOptions,
  type ShapedGlyph,
  type ShapeOptions,
  type BitmapGlyphRenderData,
  type AatFeatureDescription,
  type AatFeatureSettingDescription,
  type AatGlyphProperties,
  type FontDeviceMetrics,
  type PostScriptMemoryUsage,
  type FontEmbeddingPermissions,
  type FontOpticalSizeRange,
  type FontOpenTypeLayoutFeature,
  type ColorPaletteColor,
  type ColorPaletteInfo,
} from './font.js'
export type { TrueTypeHintingState, TrueTypeHintingTransform } from './hinting/tt-glyph-hinter.js'
export { rasterizeTrueTypeHintingState, usesTrueTypeDropoutControl } from './hinting/tt-rasterizer.js'
export type { TrueTypeRasterBitmap, TrueTypeRasterTransform } from './hinting/tt-rasterizer.js'
export type { GraphiteGlyphMetadata, GraphiteJustificationOptions } from './shaping/graphite.js'
export type { OpenTypeFeatureSetting } from './parsers/tables/gsub.js'
export type {
  OpenTypeFeatureParams,
  OpenTypeLayoutFeatureRecord,
  DesignSizeFeatureParams,
  StylisticSetFeatureParams,
  CharacterVariantFeatureParams,
} from './parsers/tables/otl-common.js'
export type { VariationAxis, NamedInstance } from './parsers/tables/fvar.js'
export type { PaintNode, ColorLine, ColorStop, ClipBox, Affine2x3, CompositeMode, ExtendMode } from './parsers/tables/colr.js'
export type { MathTable, MathValueRecord, MathGlyphVariantRecord, GlyphPartRecord, GlyphAssembly, GlyphConstruction } from './parsers/tables/math.js'
export type { BaseTable, BaselineValue, MinMaxValue } from './parsers/tables/base.js'
export type { JstfTable, JstfPriority } from './parsers/tables/jstf.js'
export type { FeatTable, FeatFeature, FeatSelector } from './parsers/tables/feat.js'
export type { TrakTable, TrakData, TrakEntry } from './parsers/tables/trak.js'
export type { OpbdTable, OpbdBounds } from './parsers/tables/opbd.js'
export type { EbscTable, EbscStrike } from './parsers/tables/ebsc.js'
export type { BslnTable } from './parsers/tables/bsln.js'
export type { LcarTable } from './parsers/tables/lcar.js'
export type { MorxTable, MorxChain } from './parsers/tables/morx.js'
export type { MortTable, MortChain } from './parsers/tables/mort.js'
export type { SilfTable, GlocTable, GlatTable, SillTable, GraphiteFeatTable } from './parsers/tables/graphite.js'
export type { CffHintParams } from './hinting/cff-hinter.js'
export type { AcntComponent, AcntGlyphAttachment, AcntTable } from './parsers/tables/acnt.js'
export type { AnkrAnchorPoint, AnkrTable } from './parsers/tables/ankr.js'
export type { FdscDescriptor, FdscTable } from './parsers/tables/fdsc.js'
export type { FmtxTable } from './parsers/tables/fmtx.js'
export type { GcidTable } from './parsers/tables/gcid.js'
export type { PropTable } from './parsers/tables/prop.js'
export type { ZapfFeatureInfo, ZapfGlyphInfo, ZapfGroup, ZapfIdentifier, ZapfSubgroup, ZapfTable } from './parsers/tables/zapf.js'
export type { MergGlyphGroup, MergTable } from './parsers/tables/merg.js'
export type { MetaTable } from './parsers/tables/meta.js'
export type { PcltTable } from './parsers/tables/pclt.js'
export type { DsigSignature, DsigTable } from './parsers/tables/dsig.js'
export {
  signOpenTypeResource,
  verifyOpenTypeSignatures,
  type OpenTypeSignatureVerification,
  type OpenTypeSigningOptions,
} from './font-signature.js'
export { compressLz4Block, decompressLz4Block, compressGraphiteTable } from './parsers/tables/graphite.js'
export { TextMeasurer } from './measure/text-measurer.js'
export { BinaryReader } from './binary/reader.js'
export { BinaryWriter } from './binary/writer.js'
export { collectFontGlyphReferences, subsetFont, subsetFontPreservingTables, type SubsetResult } from './subset/index.js'
export { buildFontCollection, type FontCollectionBuildOptions } from './subset/collection.js'
export {
  wrapWoff2,
  wrapWoff2Collection,
  type Woff2WriteOptions,
} from './parsers/woff2-parser.js'
export { wrapWoff, type WoffWriteOptions } from './parsers/woff-parser.js'
export { parseWoffMetadata, selectWoffMetadataLanguage } from './parsers/woff-metadata.js'
export type {
  Glyph,
  GlyphOutline,
  FontMetrics,
  TextMeasurement,
  CmapTable,
  FontFormat,
  WebFontContainerData,
  WoffMetadataContent,
  WoffMetadataDocument,
  WoffMetadataElement,
  Os2Table,
} from './types/index.js'
export { PathCommand } from './types/index.js'

// Layout engine
export { layoutText, type TextLayoutOptions, type TextLayoutResult, type LayoutLine } from './layout/text-layout.js'
export { canBreakGraphemeAt, graphemeBreaks, graphemeClusters } from './layout/grapheme-break.js'
export { normalizeUnicodeText, type UnicodeNormalizationForm } from './layout/unicode-normalization.js'
export {
  createReport,
  createReportBook,
  combineReports,
  renderTextToGroup,
  type FontMap,
  type TextContentStyle,
  type TextContentElement,
  type CreateReportOptions,
  type ReportBookPart,
  type ReportBookOptions,
  type ResolvedSubreportTemplate,
  type SubreportTemplateResolver,
} from './layout/engine.js'
export { createReportFromFile } from './layout/create-report-from-file.js'
export { findElementById, getElementChildren } from './template-element-selector.js'
export type { ReportResources } from './layout/resource-resolver.js'
export { installNodeRuntime, type NodeRuntimeBridge } from './node-runtime-bridge.js'
export { brotliCompress, brotliDecompress } from './compression/brotli.js'
export type { BrotliCompressionOptions } from './compression/brotli.js'
export { evaluateExpression, formatValue, clearExpressionCache } from './layout/expression.js'
export {
  ExpressionLanguageError,
  parseExpressionSource,
  validateExpressionSource,
  evaluateScopedExpression,
  evaluateExpressionAst,
  formatExpressionValue,
  clearParsedExpressionCache,
} from './expression-language.js'
export { renderBarcode, type BarcodeOptions } from './layout/barcode-renderer.js'
export { appendBorderNodes, buildBackgroundRect, lineStyleDash } from './layout/decoration.js'
export { layoutTable, type TableDef, type TableColumnDef, type TableRowDef, type TableCellDef, type TableCellStyleDef, type TableLayoutContext } from './layout/table-layout.js'
export { layoutCrosstab, type CrosstabDef, type CrosstabGroupDef, type CrosstabMeasureDef, type CrosstabLayoutContext } from './layout/crosstab-layout.js'
export { flowLayout, type FlowBlock, type FlowPageSettings, type FlowPageInfo, type FlowPageDecorator } from './layout/flow-layout.js'
export { insertTableOfContents, type TocOptions } from './layout/toc-generator.js'
export { resolveBidi, getBaseDirection, getMirrorChar, type BidiResult, type BidiOptions } from './layout/bidi.js'
export { checkGlyphCoverage, type GlyphCoverageIssue } from './layout/glyph-coverage.js'

// Math typesetting
export { parseMathLaTeX } from './math/math-parser.js'
export { layoutMathFormula, type MathBox, type MathLayoutContext } from './math/math-layout.js'
export type {
  MathNode, MathGlyph, MathRow, MathFraction, MathScript,
  MathRadical, MathOperator, MathDelimited, MathAccent,
  MathMatrix, MathSpace, MathText, MathStyle, AtomType,
} from './math/math-ast.js'

// Template and render tree types
export type {
  ReportTemplate, DataSource, PageSettings, PageTransparencyGroupDef, BandSet, BandDef,
  ElementDef, ElementBase, StyleDef, VariableDef, GroupDef, LineSpacingDef,
  Padding, BorderDef,
  StaticTextDef, FormFieldDef, TextFieldDef, LineDef, RectangleDef, EllipseDef,
  PathDef, PdfSourceVectorDef, PdfSourceVectorDefinitionDef, PdfSourceVectorInstanceDef, ImageDef, FrameDef, SubreportDef, BreakDef, BarcodeDef,
  Expression, ExpressionCallback, ReportContext, OnBeforeRenderCallback,
  MathDef, SvgElementDef, HyperlinkDef, TableElementDef, CrosstabElementDef,
  GradientStopDef, LinearGradientDef, RadialGradientDef, GradientDef, FillDef,
  PdfFunctionDef, PdfProcessColorSpaceDef, PdfSeparationColorSpaceDef, PdfDeviceNProcessDef, PdfDeviceNMixingHintsDef, PdfDeviceNColorSpaceDef, PdfIndexedColorSpaceDef, PdfShadingColorSpaceDef, PdfSpecialColorDef,
  PdfAxialRadialShadingDef, PdfNativeAxialRadialShadingDef, PdfMeshShadingDef, PdfNativeMeshShadingDef, PdfNativeFunctionShadingDef,
  MeshPatchDef, MeshTriangleDef, MeshLatticeDef, MeshGradientDef, FunctionShadingDef, TilePathDef, TileImageDef, TileTextDef, TileGraphicDef, TilingPatternDef,
  OptionalContentDef, PdfOptionalContentGroupDef, PdfOptionalContentMembershipDef, PdfOptionalContentExpressionDef,
  PdfOptionalContentPropertiesDef, PdfOptionalContentConfigurationDef, PdfOptionalContentUsageApplicationDef, PdfOptionalContentOrderDef,
  PdfFormXObjectDef, PdfRawValueDef, PdfActionSubtypeDef, PdfActionDef, PdfActionAnnotationTargetDef,
  PdfDestinationDef, PdfDestinationFitDef, PdfStructureDestinationDef, PdfEmbeddedTargetDef, PdfEmbeddedTargetSelectorDef,
  PdfLaunchPlatformParametersDef, PdfWindowsLaunchParametersDef, PdfActionFieldTargetsDef, PdfArticleActionTargetDef, PdfOptionalContentStateDef,
  PdfPageTransitionDef, PdfOpiMetadataDef, PdfImageAlternateDef,
} from './types/template.js'
export type {
  ExpressionAstNode,
  LiteralExpressionNode,
  IdentifierExpressionNode,
  MemberExpressionNode,
  CallExpressionNode,
  UnaryExpressionNode,
  BinaryExpressionNode,
  ConditionalExpressionNode,
  TemplateExpressionNode,
  TemplateExpressionPart,
  TemplateTextPart,
  TemplateValuePart,
  ParsedExpression,
  ExpressionReferenceMap,
  ExpressionEvaluationOptions,
} from './expression-language.js'
export type {
  RenderDocument, RenderPage, RenderPageTransparencyGroup, RenderNode, RenderGroup,
  RenderText, RenderLine, RenderRect, RenderEllipse,
  RenderPath, RenderImage, RenderSvg, RenderOptions,
  StructureRole, StructureTag, StructurePhoneticAlphabet, StructureAttributeOwner, StructureAttribute, StructureUserProperty, StructureNamespace,
  StructureNamespaceDefinition, StructureNamespaceRoleTarget, MathMlStructureNode, RenderGlyphRun, RenderOptionalContent,
} from './types/render.js'

// Compression
export { deflate, zlibDeflate } from './compression/deflate.js'
export { inflate, zlibInflate, gzipInflate } from './compression/inflate.js'

// PDF parser / merge
export {
  parsePdf, parsePdfObject, PdfDocument, PdfName, PdfString, PdfRef, PdfStream,
  type PdfDict, type PdfValue,
} from './pdf/pdf-parser.js'
export { mergePdfFiles, collectPdfPages, type CollectedPage } from './pdf/pdf-import.js'
export {
  validatePdfMediaMimeType,
  validatePdfMediaBaseUrl,
  resolvePdfMediaUrl,
  validatePdfMediaOffset,
  validatePdfMediaDefinition,
  resolvePdfMediaTemporalSelection,
  computePdfMediaPlacement,
  type PdfMediaTemporaryFilePermission,
  type PdfMediaOffset,
  type PdfMediaClipSection,
  type PdfMediaDuration,
  type PdfMediaFit,
  type PdfMediaPlayParameters,
  type PdfMediaFloatingWindow,
  type PdfMediaScreenParameters,
  type PdfMediaDefinition,
  type PdfMediaTemporalContext,
  type PdfMediaTemporalSelection,
  type PdfMediaPlacement,
} from './pdf/pdf-media.js'
export {
  decodeU3dScene,
  calculatePdf3DSceneBounds,
  measurePdf3DScene,
  renderPdf3DPoster,
  type Pdf3DVector3,
  type Pdf3DMatrix4,
  type Pdf3DParentTransform,
  type Pdf3DSceneNode,
  type Pdf3DGroupNode,
  type Pdf3DModelNode,
  type Pdf3DLightNode,
  type Pdf3DViewNode,
  type Pdf3DBoundingSphere,
  type Pdf3DBoundingBox,
  type Pdf3DScene,
  type Prc3DScene,
  type Pdf3DDecodedScene,
  type Pdf3DPrimitive,
  type Pdf3DTrianglePrimitive,
  type Pdf3DLinePrimitive,
  type Pdf3DPointPrimitive,
  type Pdf3DTextPrimitive,
  type Pdf3DSurfaceMaterial,
  type Pdf3DTextureImage,
  type Pdf3DTextureLayer,
  type Pdf3DRenderPass,
  type Pdf3DLightSource,
  type Pdf3DClippingPlane,
  type Pdf3DMeasurement,
  type Pdf3DPoster,
  type U3dMetadataEntry,
  type U3dBlock,
  type U3dHeader,
  type U3dDecodeOptions,
  type U3dModifierChain,
  type U3dViewTextureLayer,
} from './pdf/pdf-3d.js'
export { decodePrcScene } from './pdf/pdf-prc.js'
export {
  analyzePdfPageTransparency,
  analyzeParsedPdfPageTransparency,
  type PdfTransparencyReason,
  type PdfTransparencyFinding,
  type PdfPageTransparencyAnalysis,
  type PdfTransparencyAnalysisOptions,
} from './pdf/pdf-transparency-analysis.js'
export {
  PdfImporter, type ImportedOutlineNode, type ImportedEmbeddedFile, type ImportedAnnotation, type Imported3DArtwork, type ImportedLinkAction, type ImportedNamedDestination, type ImportedNameTreeEntry, type ImportedNumberTreeEntry, type ImportedPageLabel, type ImportedJavaScript, type ImportedCollection, type ImportedCollectionField, type ImportedDocumentPart, type ImportedDocumentPartHierarchy, type ImportedArticleThread, type ImportedCatalogModel, type ImportedWebCapture, type ImportedFormField, type ImportedFormFieldFlag, type ImportedFormWidget, type ImportedStructureNode, type ImportedStructureContent, type ImportedStructureModel, type ImportedStructureAttribute, type ImportedStructureUserProperty, type ImportedStructureNamespace, type ImportedStructureNamespaceRoleTarget, type ImportedPronunciationLexicon, type ImportedRubyStructure, type ImportedWarichuStructure, type ImportedMathMlStructureNode, type ImportedListStructure, type ImportedTableStructure, type ImportedArtifactStructure, type ImportedMarkedContentArtifact, type ImportedPageProperties, type ImportedPageBoxes, type ImportedRedactionAppearance,
  getPdfPageCount,
  importPdfPage,
  pdfStringToText,
  parsePdfDateText,
  type ImportedPage,
  type ImportedFontInfo,
  type PdfImportOptions, type PdfImportProgress, type PdfImportProgressCallback, type PdfImportProgressStage,
  type PdfFontResolver, type PdfResolvedFontProgram,
} from './pdf/pdf-page-importer.js'
export {
  parsePdfPronunciationLexicon,
  resolvePdfPronunciation,
  type PdfPronunciation,
  type PdfPronunciationLexeme,
  type PdfPronunciationLexicon,
  type PdfResolvedPronunciation,
} from './pdf/pdf-pronunciation-lexicon.js'
export {
  decodePdfXfaXml,
  validatePdfXfa,
  type PdfXfa,
  type PdfXfaDocument,
  type PdfXfaPacket,
  type PdfXfaPacketArray,
} from './pdf/pdf-xfa.js'
export {
  classifyPdfName,
  validatePdfSecondClassName,
  validatePdfThirdClassName,
  validatePdfDeveloperExtensions,
  requiredPdfVersionForExtensions,
  comparePdfSpecificationVersions,
  type PdfSpecificationVersion,
  type PdfDeveloperExtension,
  type PdfDeveloperExtensions,
  type PdfNameClass,
} from './pdf/pdf-extensions.js'
export { validatePdfOpiMetadata } from './pdf/pdf-opi.js'
export { validatePdfDestinationProfileReference } from './pdf/pdf-output-intent.js'
export type { PdfXRegisteredOutputCondition, PdfXOutputProfileResolver, PdfXOutputConditionValidator } from './pdf/pdf-output-intent.js'
export { validateBcp47LanguageTag } from './pdf/language-tag.js'
export {
  inspectIccProfile,
  parseIccProfile,
  type IccProfileHeader,
  type IccProfileClass,
  type IccRenderingIntent,
  type IccTransform,
} from './pdf/icc-profile-reader.js'
export { applyPdfRedactions, type PdfRedactionApplyOptions } from './pdf/pdf-redaction.js'
export {
  buildPdfXmpPacket,
  parsePdfXmpPacket,
  validatePdfXmpSynchronization,
  type PdfXmpPropertyValue,
  type PdfXmpProperty,
  type PdfXmpExtensionProperty,
  type PdfXmpExtensionSchema,
  type PdfXmpMetadata,
  type ParsedPdfXmpMetadata,
  type PdfXmpSynchronizedFields,
} from './pdf/pdf-xmp.js'
export {
  parsePdfFragmentIdentifier,
  serializePdfFragmentIdentifier,
  resolvePdfFragmentIdentifier,
  type PdfFragmentIdentifier,
  type PdfFragmentParameter,
  type PdfFragmentObjectParameter,
  type PdfFragmentOpenParameter,
  type PdfFragmentResolutionContext,
  type PdfResolvedFragmentIdentifier,
} from './pdf/pdf-fragment-identifier.js'
export {
  validatePdfMeasurementViewport,
  isPdfMeasurementViewport,
  pdfMeasurementViewportToRaw,
  pdfMeasurementViewportFromRaw,
  pdfMeasurementToRaw,
  pdfMeasurementFromRaw,
  pdfPointDataToRaw,
  pdfPointDataFromRaw,
  selectPdfMeasurementViewport,
  convertPdfPagePointToMeasurement,
  convertPdfMeasurementPointToPage,
  formatPdfMeasurement,
  measurePdfPolyline,
  measurePdfArea,
  measurePdfAngle,
  measurePdfSlope,
  extractPdfPointDataCoordinates,
  type PdfMeasurementPoint,
  type PdfNumberFormatMode,
  type PdfNumberFormatLabelPosition,
  type PdfNumberFormat,
  type PdfRectilinearMeasure,
  type PdfGeographicCoordinateSystem,
  type PdfProjectedCoordinateSystem,
  type PdfGeospatialCoordinateSystem,
  type PdfLinearDisplayUnit,
  type PdfAreaDisplayUnit,
  type PdfAngularDisplayUnit,
  type PdfPreferredDisplayUnits,
  type PdfGeospatialMeasure,
  type PdfMeasurement,
  type PdfPointData,
  type PdfMeasurementViewport,
  type PdfRectilinearCoordinate,
  type PdfGeospatialCoordinate,
  type PdfConvertedMeasurementPoint,
  type PdfFormattedMeasurement,
  type PdfPointDataCoordinate,
} from './pdf/pdf-measurement.js'
export { decodePdfTextStringBytes, encodePdfTextStringBytes } from './pdf/pdf-text-string.js'
export { verifyPdfSignatures, type PdfSignatureVerification } from './pdf/pdf-signature.js'
export type {
  PdfSignatureFieldSelection,
  PdfSignatureFieldLock,
  PdfSignatureSeedConstraint,
  PdfCertificateSeedConstraint,
  PdfCertificateSeedValue,
  PdfSignatureSeedValue,
  PdfUsageRights,
} from './pdf/pdf-signature-policy.js'
export {
  recoverPubSecFileKey,
  createPubSecEncryptionContext,
  type PubSecCredential,
  type PdfPubSecRecipient,
  type PdfPubSecEncryptionOptions,
  type PdfPubSecKeyAgreementOptions,
  type PdfEcdhKdf,
  type PdfAesKeyWrap,
  type PdfPubSecContentEncryption,
  type PdfRsaKeyTransportOptions,
  type PdfRsaOaepDigest,
} from './pdf/pdf-pubsec.js'
export { sha3_256, sha3_384, sha3_512, shake256 } from './encryption/sha3.js'
export { deriveEdDsaPublicKey, signEdDsa, verifyEdDsa, type EdDsaCurveName } from './encryption/eddsa.js'
export { pbkdf2, hmac, type Pbkdf2Prf } from './encryption/pbkdf2.js'
export { decryptPkcs8PrivateKey } from './encryption/pkcs8.js'
export { appendIncrementalUpdate, type IncrementalObject, type IncrementalUpdateOptions } from './pdf/pdf-incremental.js'
export { rewritePdfToTraditional } from './pdf/pdf-rewrite.js'
export { parseFdf, writeFdf, FdfDocument, type FdfWriteOptions } from './pdf/fdf.js'
export { linearizePdf } from './pdf/pdf-linearize.js'
export {
  signPdf,
  preparePdfDocumentTimestamp,
  signRsaPkcs1Sha256,
  buildCmsSignedData,
  parseRsaPrivateKey,
  type RsaPrivateKey,
  type PdfSignOptions,
  type PdfSignatureDigestAlgorithm,
  type PdfSignatureAlgorithm,
  type PdfLocalSignatureSubFilter,
  type PdfRsaPssOptions,
  type PdfDocumentTimestampPreparation,
  type PdfDocumentTimestampOptions,
} from './pdf/pdf-signer.js'
export {
  buildRfc3161TimestampRequest,
  parseRfc3161TimestampRequest,
  parseRfc3161TimestampToken,
  type Rfc3161DigestAlgorithm,
  type Rfc3161Extension,
  type Rfc3161RequestOptions,
  type Rfc3161TimestampRequestInfo,
  type Rfc3161Accuracy,
  type Rfc3161GeneralName,
  type Rfc3161TimestampInfo,
} from './pdf/pdf-rfc3161.js'
export {
  appendPdfLongTermValidation,
  readPdfDocumentSecurityStore,
  verifyPdfLongTermValidation,
  pdfVriKey,
  type PdfVriClaimedTime,
  type PdfVriInput,
  type PdfLongTermValidationInput,
  type PdfValidationRelatedInformation,
  type PdfDocumentSecurityStore,
  type PdfLongTermValidationVerification,
  type PdfLongTermValidationVerificationOptions,
} from './pdf/pdf-ltv.js'
export {
  verifyX509CertificateChain,
  parseAndVerifyX509Crl,
  parseAndVerifyOcspResponse,
  type X509CertificateChainValidation,
  type X509CertificateChainOptions,
  type ParsedX509Crl,
  type VerifiedOcspResponse,
} from './pdf/x509-validation.js'

// Image utilities
export { detectImageFormat, normalizeImageData, decodeBase64, getImageDimensions, type ImageFormat } from './image/image-utils.js'
export { parseJpegInfo, type JpegInfo } from './image/jpeg-parser.js'
export { parsePngInfo, decompressPng, decodePng, type PngInfo, type DecodedPngImage } from './image/png-parser.js'
export { parseWebpInfo, decodeWebp, type WebpInfo, type DecodedImage } from './image/webp-parser.js'
export {
  parseAvifInfo,
  decodeAvif,
  extractPrimaryAv1Payload,
  type AvifInfo,
  type AvifDecodeOptions,
  type AvifCicpInfo,
  type AvifContentLightLevelInfo,
  type AvifMasteringDisplayColorVolumeInfo,
  type DecodedAvifImage,
} from './image/avif-parser.js'

// SVG
export { parseSvg } from './svg/svg-parser.js'
export { parseSvgPath, type SvgPathData } from './svg/svg-path-parser.js'
export { buildSvgPathD } from './svg/svg-path-builder.js'
export {
  materializePdfSourceVector,
  materializePdfSourceVectorPath,
  type MaterializedPdfSourceVector,
} from './pdf/pdf-source-vector.js'
export { renderSvg, renderSvgGlyph } from './svg/svg-renderer.js'
export type {
  SvgDocument, SvgNode, SvgDefs, SvgStyle, SvgPaint, SvgColor,
  SvgMatrix, SvgGradient, SvgLinearGradient, SvgRadialGradient,
  SvgGradientStop, SvgClipPath,
  SvgGroup, SvgPath, SvgRect, SvgCircle, SvgEllipse,
  SvgLine, SvgPolyline, SvgPolygon, SvgText, SvgImage,
} from './svg/svg-types.js'

// Renderers
export { render, renderPage, renderToPdf } from './renderer/renderer.js'
export { parseTemplateColor, toDisplayColor, isPrintColor, type CalibratedColor, type DeviceNColor, type TemplateColor } from './renderer/color.js'
export type {
  RenderBackend,
  TextDrawOptions,
  ShapeDrawOptions,
  RectCornerRadii,
  ResolvedRectCornerRadii,
  RectDrawOptions,
  GradientStop,
  LinearGradientPaint,
  RadialGradientPaint,
  GradientPaint,
  PaintValue,
  PathPaintOptions,
  LinkAnnotation,
  BookmarkEntry,
  AnchorEntry,
} from './renderer/backend.js'
export { CanvasBackend, CanvasRenderCache, clearCanvasImageCache, type CanvasBackendOptions } from './renderer/canvas-backend.js'
export { SvgBackend, type SvgBackendOptions } from './renderer/svg-backend.js'
export {
  applyDeviceRasterToRgba,
  applyDeviceRasterToComponents,
  validateRenderDeviceParams,
  evaluatePredefinedSpotFunction,
  PDF_PREDEFINED_SPOT_FUNCTIONS,
  type PdfPredefinedSpotFunction,
} from './renderer/device-raster.js'
export {
  flattenPdfPath,
  adjustPdfStrokePath,
  adjustPdfStrokeWidth,
  type FlattenedPdfPath,
  type PdfDeviceMatrix,
} from './renderer/pdf-scan-conversion.js'
export { compositePdfTransparencyObject, extractPdfTransparencyGroup, compositePdfPixel, blendPdfColor } from './renderer/pdf-compositor.js'
export {
  createPdfPrintColorTransform,
  resolvePdfPrintColor,
  compositePdfPrintPlates,
  compositePdfOverprintRgba,
  type PdfPrintColor,
  type PdfPrintColorKind,
  type PdfOverprintPaint,
  type PdfPrintColorTransform,
} from './renderer/pdf-print-color.js'
export {
  PdfBackend,
  type PdfBackendOptions,
  type PdfAConformance,
  type PdfInfoCustomValue,
  type PdfPageMode,
  type PdfPageLayout,
  type PdfPageBoundary,
  type PdfPageLabelStyle,
  type PdfPageLabel,
  type PdfDocumentPartMetadataValue,
  type PdfDocumentPart,
  type PdfDocumentPartHierarchy,
  type PdfDestinationFit,
  type PdfOpenAction,
  type PdfNamedDestination,
  type PdfNameTreeEntry,
  type PdfNumberTreeEntry,
  type PdfJavaScriptAction,
  type PdfEmbeddedFile,
  type PdfEmbeddedFileMacParameters,
  type PdfAFRelationship,
  type PdfCollection,
  type PdfCollectionField,
  type PdfCollectionFieldSubtype,
  type PdfCollectionItemValue,
  type PdfCollectionSubitem,
  type PdfCollectionSort,
  type PdfCollectionView,
  type PdfCollectionRgb,
  type PdfCollectionColors,
  type PdfCollectionSplit,
  type PdfCollectionNavigator,
  type PdfCollectionFolder,
  type PdfArticleInfo,
  type PdfArticleBead,
  type PdfArticleThread,
  type PdfDocumentRequirementType,
  type PdfDocumentRequirementVersion,
  type PdfDocumentRequirementHandler,
  type PdfDocumentRequirement,
  type PdfWebCaptureUrlAlias,
  type PdfWebCaptureSource,
  type PdfWebCaptureCommandSettings,
  type PdfWebCapturePostedData,
  type PdfWebCaptureCommand,
  type PdfWebCaptureContentObject,
  type PdfWebCapturePageSet,
  type PdfWebCaptureImageSet,
  type PdfWebCaptureContentSet,
  type PdfWebCapture,
  type PdfAnnotationSubtype,
  type PdfAnnotationLineEnding,
  type PdfAnnotationTextIcon,
  type PdfAnnotationStampIcon,
  type PdfAnnotationFileAttachmentIcon,
  type PdfSoundEncoding,
  type PdfFixedPrintMatrix,
  type PdfFixedPrint,
  type PdfMovieRotation,
  type PdfMovie,
  type PdfScreenAppearanceCharacteristics,
  type PdfAnnotationPoint,
  type PdfAnnotationBorderStyle,
  type PdfAnnotationBorderEffect,
  type PdfAnnotationQuadPoints,
  type PdfCaretAnnotationSymbol,
  type PdfAnnotationBase,
  type PdfPreservedAnnotation,
  type PdfLinkAnnotation,
  type PdfTextAnnotation,
  type PdfFreeTextAnnotation,
  type PdfLineAnnotation,
  type PdfSquareCircleAnnotation,
  type PdfTextMarkupAnnotationSubtype,
  type PdfTextMarkupAnnotation,
  type PdfHighlightAnnotation,
  type PdfPolygonAnnotation,
  type PdfStampAnnotation,
  type PdfCaretAnnotation,
  type PdfInkAnnotation,
  type PdfPopupAnnotation,
  type PdfSoundAnnotation,
  type PdfMovieAnnotation,
  type PdfScreenAnnotation,
  type PdfPrepressAppearance,
  type PdfPrinterMarkAppearance,
  type PdfPrinterMarkAnnotation,
  type PdfTrapNetAnnotation,
  type PdfWatermarkAnnotation,
  type PdfFileAttachmentAnnotation,
  type PdfRedactAnnotation,
  type PdfProjectionAnnotation,
  type PdfAnnotation,
  type PdfStructureObjectReference,
  type PdfPageRotation,
  type PdfPageBox,
  type PdfDeviceColorant,
  type PdfSeparationInfo,
  type PdfPageTransparencyGroup,
  type PdfPageOptions,
  type PdfViewerPreferences,
  type PdfCatalogModel,
  type PdfOutputIntentProfile,
  type PdfOutputIntent,
} from './renderer/pdf-backend.js'
export {
  createPureRasterImageDecoder,
  createNodeExternalRasterImageDecoder,
  getDefaultRasterImageDecoder,
  setDefaultRasterImageDecoder,
  type RasterImageDecoder,
  type RasterDecodableFormat,
  type DecodedRgbaImage,
} from './renderer/raster-image-decoder.js'
export type { PdfEncryptionOptions, PdfPermissions } from './renderer/pdf-encryption.js'
export {
  decodeJpegSamples,
  decodeJpegToRgba,
  decodeJpegToRgbaWithSamples,
  type DecodedJpeg,
  type DecodedJpegSamples,
  type DecodedJpegWithSamples,
} from './image/jpeg-decoder.js'
export { decodeJbig2, decodeJbig2Pages, type Jbig2Image, type Jbig2Comment } from './compression/jbig2-decoder.js'
