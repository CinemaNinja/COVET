// Lift the subject out of a photo with the macOS Vision framework.
// Used by tools/canvas_build.py; not meant to be run by hand.
//
//   lift <in> <out.png> [<in> <out.png> ...]
//
// Prints one line per photo: "OK <in>", "NONE <in>" (no subject found),
// or "FAIL <in>: <reason>".
import AppKit
import CoreImage
import Foundation
import Vision

let maxSide: CGFloat = 1100
let args = Array(CommandLine.arguments.dropFirst())
let context = CIContext()
var index = 0

while index + 1 < args.count {
    let source = args[index]
    let target = URL(fileURLWithPath: args[index + 1])
    index += 2

    guard let photo = CIImage(
        contentsOf: URL(fileURLWithPath: source),
        options: [.applyOrientationProperty: true]
    ) else {
        print("FAIL \(source): unreadable")
        continue
    }

    let handler = VNImageRequestHandler(ciImage: photo)
    let request = VNGenerateForegroundInstanceMaskRequest()
    do {
        try handler.perform([request])
        guard let found = request.results?.first else {
            print("NONE \(source)")
            continue
        }
        let buffer = try found.generateMaskedImage(
            ofInstances: found.allInstances,
            from: handler,
            croppedToInstancesExtent: false
        )
        var lifted = CIImage(cvPixelBuffer: buffer)
        let side = max(lifted.extent.width, lifted.extent.height)
        if side > maxSide {
            let scale = maxSide / side
            lifted = lifted.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        guard let rendered = context.createCGImage(lifted, from: lifted.extent),
              let png = NSBitmapImageRep(cgImage: rendered).representation(using: .png, properties: [:])
        else {
            print("FAIL \(source): could not render")
            continue
        }
        try png.write(to: target)
        print("OK \(source)")
    } catch {
        print("FAIL \(source): \(error.localizedDescription)")
    }
}
