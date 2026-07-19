import CoreText
import Foundation

struct GlyphResult: Encodable {
    let g: UInt16
    let cl: Int
    let x: Double
    let y: Double
    let ax: Double
    let ay: Double
}

guard CommandLine.arguments.count >= 4 else {
    throw NSError(domain: "coretext-shape", code: 1, userInfo: [NSLocalizedDescriptionKey: "path, face index, and text are required"])
}

let path = CommandLine.arguments[1]
guard let faceIndex = Int(CommandLine.arguments[2]) else {
    throw NSError(domain: "coretext-shape", code: 2, userInfo: [NSLocalizedDescriptionKey: "face index must be an integer"])
}
let text = CommandLine.arguments[3]
let url = URL(fileURLWithPath: path) as CFURL
guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor],
      faceIndex >= 0,
      faceIndex < descriptors.count else {
    throw NSError(domain: "coretext-shape", code: 3, userInfo: [NSLocalizedDescriptionKey: "font face cannot be loaded"])
}

var variations: [NSNumber: NSNumber] = [:]
var featureSettings: [[CFString: Any]] = []
for argument in CommandLine.arguments.dropFirst(4) where argument.hasPrefix("--variation=") {
    let assignment = String(argument.dropFirst(12)).split(separator: ":", maxSplits: 1)
    guard assignment.count == 2, assignment[0].utf8.count == 4, let value = Double(assignment[1]) else {
        throw NSError(domain: "coretext-shape", code: 5, userInfo: [NSLocalizedDescriptionKey: "variation must be tag:value"])
    }
    var identifier: UInt32 = 0
    for byte in assignment[0].utf8 { identifier = (identifier << 8) | UInt32(byte) }
    variations[NSNumber(value: identifier)] = NSNumber(value: value)
}
for argument in CommandLine.arguments.dropFirst(4) where argument.hasPrefix("--aat=") {
    let assignment = String(argument.dropFirst(6)).split(separator: ":", maxSplits: 1)
    guard assignment.count == 2, let type = Int(assignment[0]), let selector = Int(assignment[1]) else {
        throw NSError(domain: "coretext-shape", code: 6, userInfo: [NSLocalizedDescriptionKey: "AAT feature must be type:selector"])
    }
    featureSettings.append([
        kCTFontFeatureTypeIdentifierKey: type,
        kCTFontFeatureSelectorIdentifierKey: selector,
    ])
}
var descriptorAttributes: [CFString: Any] = [:]
if !variations.isEmpty { descriptorAttributes[kCTFontVariationAttribute] = variations }
if !featureSettings.isEmpty { descriptorAttributes[kCTFontFeatureSettingsAttribute] = featureSettings }
let descriptor = descriptorAttributes.isEmpty
    ? descriptors[faceIndex]
    : CTFontDescriptorCreateCopyWithAttributes(
        descriptors[faceIndex],
        descriptorAttributes as CFDictionary
    )
let probeFont = CTFontCreateWithFontDescriptor(descriptor, 12, nil)
let font = CTFontCreateWithFontDescriptor(descriptor, CGFloat(CTFontGetUnitsPerEm(probeFont)), nil)
var attributes: [NSAttributedString.Key: Any] = [kCTFontAttributeName as NSAttributedString.Key: font]
for argument in CommandLine.arguments.dropFirst(4) {
    if argument.hasPrefix("--language=") {
        attributes[kCTLanguageAttributeName as NSAttributedString.Key] = String(argument.dropFirst(11))
    } else if argument == "--vertical" {
        attributes[kCTVerticalFormsAttributeName as NSAttributedString.Key] = true
    }
}
if !featureSettings.isEmpty {
    attributes[kCTFontFeatureSettingsAttribute as NSAttributedString.Key] = featureSettings
}
let attributed = NSAttributedString(string: text, attributes: attributes)
let sourceLine = CTLineCreateWithAttributedString(attributed)
let line: CTLine
if let widthArgument = CommandLine.arguments.dropFirst(4).first(where: { !$0.hasPrefix("--") }) {
    guard let targetWidth = Double(widthArgument) else {
        throw NSError(domain: "coretext-shape", code: 4, userInfo: [NSLocalizedDescriptionKey: "target width must be numeric"])
    }
    line = CTLineCreateJustifiedLine(sourceLine, 1, targetWidth) ?? sourceLine
} else {
    line = sourceLine
}
let runs = CTLineGetGlyphRuns(line) as! [CTRun]
var output: [GlyphResult] = []

for run in runs {
    let count = CTRunGetGlyphCount(run)
    var glyphs = Array(repeating: CGGlyph(), count: count)
    var indices = Array(repeating: CFIndex(), count: count)
    var positions = Array(repeating: CGPoint.zero, count: count)
    var advances = Array(repeating: CGSize.zero, count: count)
    CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
    CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &indices)
    CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
    CTRunGetAdvances(run, CFRange(location: 0, length: 0), &advances)
    for index in 0..<count {
        output.append(GlyphResult(
            g: glyphs[index],
            cl: indices[index],
            x: positions[index].x,
            y: positions[index].y,
            ax: advances[index].width,
            ay: advances[index].height
        ))
    }
}

let data = try JSONEncoder().encode(output)
FileHandle.standardOutput.write(data)
