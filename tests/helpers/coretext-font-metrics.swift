import CoreText
import Foundation

struct FontMetricsResult: Encodable {
    let unitsPerEm: UInt32
    let ascent: Double
    let descent: Double
    let leading: Double
}

guard CommandLine.arguments.count == 3 else {
    throw NSError(domain: "coretext-font-metrics", code: 1, userInfo: [NSLocalizedDescriptionKey: "path and face index are required"])
}
let path = CommandLine.arguments[1]
guard let faceIndex = Int(CommandLine.arguments[2]) else {
    throw NSError(domain: "coretext-font-metrics", code: 2, userInfo: [NSLocalizedDescriptionKey: "face index must be an integer"])
}
guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: path) as CFURL) as? [CTFontDescriptor],
      faceIndex >= 0,
      faceIndex < descriptors.count else {
    throw NSError(domain: "coretext-font-metrics", code: 3, userInfo: [NSLocalizedDescriptionKey: "font face cannot be loaded"])
}
let probe = CTFontCreateWithFontDescriptor(descriptors[faceIndex], 12, nil)
let unitsPerEm = CTFontGetUnitsPerEm(probe)
let font = CTFontCreateWithFontDescriptor(descriptors[faceIndex], CGFloat(unitsPerEm), nil)
let result = FontMetricsResult(
    unitsPerEm: unitsPerEm,
    ascent: CTFontGetAscent(font),
    descent: CTFontGetDescent(font),
    leading: CTFontGetLeading(font)
)
FileHandle.standardOutput.write(try JSONEncoder().encode(result))
