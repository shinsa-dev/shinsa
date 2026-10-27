import CoreGraphics
import Foundation

guard CommandLine.arguments.count > 1, let pid = Int32(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: swift windows.swift <pid>\n".data(using: .utf8)!)
  exit(2)
}

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let entries = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
let windows: [[String: Any]] = entries.compactMap { entry in
  guard (entry[kCGWindowOwnerPID as String] as? Int32) == pid,
    (entry[kCGWindowLayer as String] as? Int) == 0,
    let id = entry[kCGWindowNumber as String] as? Int,
    let bounds = entry[kCGWindowBounds as String] as? [String: Double]
  else { return nil }
  return ["id": id, "title": entry[kCGWindowName as String] as? String ?? "", "bounds": bounds]
}
let data = try JSONSerialization.data(withJSONObject: windows)
print(String(data: data, encoding: .utf8)!)
