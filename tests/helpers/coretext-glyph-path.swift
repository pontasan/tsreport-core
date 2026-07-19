import CoreText
import Foundation

struct PathResult: Encodable {
    let commands: [UInt8]
    let coords: [Double]
    let advance: Double
}

guard CommandLine.arguments.count >= 4 else {
    throw NSError(domain: "coretext-glyph-path", code: 1, userInfo: [NSLocalizedDescriptionKey: "path, face index, and glyph ID are required"])
}
let path = CommandLine.arguments[1]
guard let faceIndex = Int(CommandLine.arguments[2]), let glyphValue = UInt16(CommandLine.arguments[3]) else {
    throw NSError(domain: "coretext-glyph-path", code: 2, userInfo: [NSLocalizedDescriptionKey: "face index and glyph ID must be integers"])
}
guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: path) as CFURL) as? [CTFontDescriptor],
      faceIndex >= 0,
      faceIndex < descriptors.count else {
    throw NSError(domain: "coretext-glyph-path", code: 3, userInfo: [NSLocalizedDescriptionKey: "font face cannot be loaded"])
}

var variations: [NSNumber: NSNumber] = [:]
for argument in CommandLine.arguments.dropFirst(4) where argument.hasPrefix("--variation=") {
    let assignment = String(argument.dropFirst(12)).split(separator: ":", maxSplits: 1)
    guard assignment.count == 2, assignment[0].utf8.count == 4, let value = Double(assignment[1]) else {
        throw NSError(domain: "coretext-glyph-path", code: 4, userInfo: [NSLocalizedDescriptionKey: "variation must be tag:value"])
    }
    var identifier: UInt32 = 0
    for byte in assignment[0].utf8 { identifier = (identifier << 8) | UInt32(byte) }
    variations[NSNumber(value: identifier)] = NSNumber(value: value)
}
let descriptor = variations.isEmpty
    ? descriptors[faceIndex]
    : CTFontDescriptorCreateCopyWithAttributes(
        descriptors[faceIndex],
        [kCTFontVariationAttribute: variations] as CFDictionary
    )
let probe = CTFontCreateWithFontDescriptor(descriptor, 12, nil)
let font = CTFontCreateWithFontDescriptor(descriptor, CGFloat(CTFontGetUnitsPerEm(probe)), nil)
var glyph = CGGlyph(glyphValue)
let advance = CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, nil, 1)

guard let glyphPath = CTFontCreatePathForGlyph(font, glyph, nil) else {
    FileHandle.standardOutput.write(try JSONEncoder().encode(PathResult(commands: [], coords: [], advance: advance)))
    exit(0)
}

var commands: [UInt8] = []
var coords: [Double] = []
var current = CGPoint.zero
var contourStart = CGPoint.zero
glyphPath.applyWithBlock { elementPointer in
    let element = elementPointer.pointee
    switch element.type {
    case .moveToPoint:
        let point = element.points[0]
        commands.append(0)
        coords.append(Double(point.x)); coords.append(Double(point.y))
        current = point
        contourStart = point
    case .addLineToPoint:
        let point = element.points[0]
        commands.append(1)
        coords.append(Double(point.x)); coords.append(Double(point.y))
        current = point
    case .addQuadCurveToPoint:
        let control = element.points[0]
        let end = element.points[1]
        let control1 = CGPoint(
            x: current.x + (control.x - current.x) * 2 / 3,
            y: current.y + (control.y - current.y) * 2 / 3
        )
        let control2 = CGPoint(
            x: end.x + (control.x - end.x) * 2 / 3,
            y: end.y + (control.y - end.y) * 2 / 3
        )
        commands.append(2)
        coords.append(Double(control1.x)); coords.append(Double(control1.y))
        coords.append(Double(control2.x)); coords.append(Double(control2.y))
        coords.append(Double(end.x)); coords.append(Double(end.y))
        current = end
    case .addCurveToPoint:
        let control1 = element.points[0]
        let control2 = element.points[1]
        let end = element.points[2]
        commands.append(2)
        coords.append(Double(control1.x)); coords.append(Double(control1.y))
        coords.append(Double(control2.x)); coords.append(Double(control2.y))
        coords.append(Double(end.x)); coords.append(Double(end.y))
        current = end
    case .closeSubpath:
        commands.append(3)
        current = contourStart
    @unknown default:
        fatalError("Unknown CGPath element type")
    }
}

FileHandle.standardOutput.write(try JSONEncoder().encode(PathResult(commands: commands, coords: coords, advance: advance)))
