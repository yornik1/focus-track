import Cocoa
import ScreenCaptureKit

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: focus-capture <output.jpg> [maxWidth] [quality]\n", stderr)
    exit(1)
}

let outputPath = args[1]
let maxWidth: CGFloat = args.count > 2 ? CGFloat(Double(args[2]) ?? 1280.0) : 1280.0
let quality: Double = args.count > 3 ? (Double(args[3]) ?? 0.4) : 0.4

Task { @MainActor in
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true
        )

        guard let display = content.displays.first else {
            fputs("ERROR: no display found\n", stderr)
            exit(2)
        }

        let filter = SCContentFilter(
            display: display,
            excludingWindows: []
        )

        let config = SCStreamConfiguration()
        let scale = maxWidth / CGFloat(display.width)
        config.width = Int(maxWidth)
        config.height = Int(CGFloat(display.height) * scale)
        config.showsCursor = true
        config.captureResolution = .best

        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: config
        )

        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let jpegData = bitmap.representation(
            using: .jpeg,
            properties: [.compressionFactor: quality]
        ) else {
            fputs("ERROR: JPEG conversion failed\n", stderr)
            exit(4)
        }

        try jpegData.write(to: URL(fileURLWithPath: outputPath))
        let kb = jpegData.count / 1024
        fputs("OK: \(outputPath) (\(kb)KB)\n", stderr)
        exit(0)

    } catch {
        fputs("ERROR: \(error.localizedDescription)\n", stderr)
        exit(2)
    }
}

dispatchMain()
