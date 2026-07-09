import Cocoa
import Foundation
import WebKit

private let controlCenterURLString = "http://127.0.0.1:47832/control-center"
private let localStatusURLString = "http://127.0.0.1:47832/v1/status"
private let legacyLaunchAgents = [
    ("com.codexbar-display.daemon", "com.codexbar-display.daemon.plist"),
    ("com.codexbar-display.companion-api", "com.codexbar-display.companion-api.plist"),
]

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var companionProcess: Process?
    private var reloadAttempts = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureMenu()
        prepareCompanion()
        openWindow()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        companionProcess?.terminate()
        return .terminateNow
    }

    @objc private func reloadControlCenter() {
        reloadAttempts = 0
        loadControlCenter()
    }

    private func configureMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()

        appMenu.addItem(
            NSMenuItem(
                title: "Reload Control Center",
                action: #selector(reloadControlCenter),
                keyEquivalent: "r"
            )
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            NSMenuItem(
                title: "Quit VibeTV Control Center",
                action: #selector(NSApplication.terminate(_:)),
                keyEquivalent: "q"
            )
        )

        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)
        NSApp.mainMenu = mainMenu
    }

    private func openWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "VibeTV Control Center"
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        self.window = window
        self.webView = webView
        loadControlCenter()
    }

    private func loadControlCenter() {
        guard let url = URL(string: controlCenterURLString) else {
            return
        }
        webView?.load(URLRequest(url: url))
    }

    private func prepareCompanion() {
        if hasLegacyLaunchAgents() {
            migrateLegacyLaunchAgents()
            startBundledCompanionIfPresent()
            return
        }

        if localCompanionIsReachable(timeout: 0.6) {
            return
        }

        startBundledCompanionIfPresent()
    }

    private func startBundledCompanionIfPresent() {
        guard let resourceURL = Bundle.main.resourceURL else {
            return
        }

        let binaryURL = resourceURL.appendingPathComponent("companion/codexbar-display")
        guard FileManager.default.isExecutableFile(atPath: binaryURL.path) else {
            return
        }

        let process = Process()
        process.executableURL = binaryURL
        process.arguments = [
            "api",
            "--addr",
            "127.0.0.1:47832",
            "--dev-origin",
            "http://127.0.0.1:47832",
        ]

        do {
            try process.run()
            companionProcess = process
        } catch {
            NSLog("VibeTV Control Center could not start bundled Companion: \(error)")
        }
    }

    private func localCompanionIsReachable(timeout: TimeInterval) -> Bool {
        guard let url = URL(string: localStatusURLString) else {
            return false
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = timeout

        let semaphore = DispatchSemaphore(value: 0)
        var reachable = false
        let task = URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse {
                reachable = (200..<500).contains(http.statusCode)
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 0.2)
        task.cancel()
        return reachable
    }

    private func hasLegacyLaunchAgents() -> Bool {
        legacyLaunchAgents.contains { _, plistName in
            FileManager.default.fileExists(atPath: launchAgentURL(plistName).path)
        }
    }

    private func migrateLegacyLaunchAgents() {
        let fileManager = FileManager.default
        let backupRoot = applicationSupportURL()
            .appendingPathComponent("migration-backups", isDirectory: true)
            .appendingPathComponent(timestampForBackup(), isDirectory: true)

        do {
            try fileManager.createDirectory(at: backupRoot, withIntermediateDirectories: true)
        } catch {
            NSLog("VibeTV Control Center could not create migration backup folder: \(error)")
        }

        for (label, plistName) in legacyLaunchAgents {
            stopLaunchAgent(label: label)
            let source = launchAgentURL(plistName)
            guard fileManager.fileExists(atPath: source.path) else {
                continue
            }
            let target = backupRoot.appendingPathComponent(plistName)
            do {
                if fileManager.fileExists(atPath: target.path) {
                    try fileManager.removeItem(at: target)
                }
                try fileManager.moveItem(at: source, to: target)
            } catch {
                NSLog("VibeTV Control Center could not back up \(plistName): \(error)")
            }
        }
    }

    private func stopLaunchAgent(label: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["bootout", "gui/\(getuid())/\(label)"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            NSLog("VibeTV Control Center could not stop legacy LaunchAgent \(label): \(error)")
        }
    }

    private func launchAgentURL(_ plistName: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
            .appendingPathComponent(plistName)
    }

    private func applicationSupportURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/codexbar-display", isDirectory: true)
    }

    private func timestampForBackup() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        scheduleReload()
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        scheduleReload()
    }

    private func scheduleReload() {
        guard reloadAttempts < 20 else {
            return
        }
        reloadAttempts += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.loadControlCenter()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
