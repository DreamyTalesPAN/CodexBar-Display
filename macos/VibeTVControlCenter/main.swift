import Cocoa
import Foundation
import ServiceManagement
import WebKit

private let controlCenterURLString = "http://127.0.0.1:47832/control-center"
private let runtimeStatusURLString = "http://127.0.0.1:47832/v1/runtime-health"
private let runtimeDeviceRepairURLString = "http://127.0.0.1:47832/v1/device/repair"
private let nativeControlCenterUserAgentPrefix = "VibeTVControlCenter/"
private let controlCenterURLScheme = "vibetv"
private let controlCenterURLHost = "open-control-center"
private let controlCenterBundleIdentifier = "shop.vibetv.control-center"
private let runtimeLaunchAgentLabel = "shop.vibetv.control-center.runtime"
private let runtimeLaunchAgentPlistName = "shop.vibetv.control-center.runtime.plist"
private let runtimeRegisteredVersionDefaultsKey =
    "shop.vibetv.control-center.runtime.registered-bundle-version"
private let runtimeHealthTimeout: TimeInterval = 35
private let runtimeHealthRequestTimeout: TimeInterval = 5
private let runtimeDeviceRepairTimeout: TimeInterval = 90
private let runtimeDeviceRepairMaxAttempts = 3
private let runtimeDeviceRepairRetryDelay: Duration = .seconds(3)
private let runtimeUnregistrationSettleDelay: Duration = .seconds(2)
private let runtimeValidationUnregisterArgument =
    "--vibetv-validation-unregister-runtime"
private let runtimeValidationUnregisterEnvironmentKey =
    "VIBETV_RUNTIME_VALIDATION_UNREGISTER"
private let legacyLaunchAgents = [
    ("com.codexbar-display.daemon", "com.codexbar-display.daemon.plist"),
    ("com.codexbar-display.companion-api", "com.codexbar-display.companion-api.plist"),
]

func isOpenControlCenterURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == controlCenterURLScheme,
          components.host?.lowercased() == controlCenterURLHost,
          components.user == nil,
          components.password == nil,
          components.port == nil,
          components.query == nil,
          components.fragment == nil,
          components.path.isEmpty || components.path == "/" else {
        return false
    }
    return true
}

func isApprovedDMGDownloadURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == "https",
          components.host?.lowercased() == "github.com",
          components.user == nil,
          components.password == nil,
          components.port == nil,
          components.query == nil,
          components.fragment == nil else {
        return false
    }

    let segments = components.percentEncodedPath
        .split(separator: "/", omittingEmptySubsequences: true)
        .map(String.init)
    guard segments.count == 6,
          segments[0] == "DreamyTalesPAN",
          segments[1] == "CodexBar-Display",
          segments[2] == "releases",
          segments[3] == "download",
          segments[5] == "VibeTV-Control-Center.dmg" else {
        return false
    }

    let tag = segments[4]
    return tag.range(
        of: #"^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$"#,
        options: .regularExpression
    ) != nil
}

struct ControlCenterURLRouter {
    private(set) var isReady = false
    private(set) var hasPendingOpen = false

    mutating func receive(_ urls: [URL]) -> Bool {
        guard urls.contains(where: isOpenControlCenterURL) else {
            return false
        }
        guard isReady else {
            hasPendingOpen = true
            return false
        }
        return true
    }

    mutating func markReady() -> Bool {
        isReady = true
        let shouldOpen = hasPendingOpen
        hasPendingOpen = false
        return shouldOpen
    }
}

func runtimeServiceNeedsRefresh(
    registeredVersion: String?,
    currentVersion: String
) -> Bool {
    let current = currentVersion.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !current.isEmpty else {
        return false
    }
    return registeredVersion?.trimmingCharacters(in: .whitespacesAndNewlines) != current
}

func runtimeBundleVersion(shortVersion: String?, buildVersion: String?) -> String {
    let short = shortVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let build = buildVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if short.isEmpty {
        return build
    }
    if build.isEmpty {
        return short
    }
    return "\(short)+\(build)"
}

func nativeControlCenterUserAgent(shortVersion: String?, buildVersion: String?) -> String {
    let version = runtimeBundleVersion(
        shortVersion: shortVersion,
        buildVersion: buildVersion
    )
    return nativeControlCenterUserAgentPrefix + (version.isEmpty ? "unknown" : version)
}

func normalizedCompanionVersion(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.lowercased().hasPrefix("v") {
        return String(trimmed.dropFirst())
    }
    return trimmed
}

func shouldRunRuntimeValidationUnregister(
    arguments: [String],
    environment: [String: String]
) -> Bool {
    arguments.count == 2
        && arguments[1] == runtimeValidationUnregisterArgument
        && environment[runtimeValidationUnregisterEnvironmentKey] == "1"
}

@MainActor
private func runRuntimeValidationUnregister() async -> Int32 {
    guard Bundle.main.bundleIdentifier == controlCenterBundleIdentifier,
          isInstalledApplicationsBundle(Bundle.main.bundleURL) else {
        FileHandle.standardError.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_ERROR label=\(runtimeLaunchAgentLabel) reason=invalid-installed-app\n".utf8
            )
        )
        return 64
    }

    let service = SMAppService.agent(plistName: runtimeLaunchAgentPlistName)
    switch service.status {
    case .notRegistered, .notFound:
        FileHandle.standardOutput.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_OK label=\(runtimeLaunchAgentLabel) status=already-unregistered\n".utf8
            )
        )
        return 0
    case .enabled, .requiresApproval:
        break
    @unknown default:
        FileHandle.standardError.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_ERROR label=\(runtimeLaunchAgentLabel) reason=unknown-status-before-unregister\n".utf8
            )
        )
        return 70
    }

    let errorDescription: String? = await withCheckedContinuation { continuation in
        service.unregister(completionHandler: { error in
            continuation.resume(
                returning: error.map { ($0 as NSError).localizedDescription }
            )
        })
    }
    if let errorDescription {
        FileHandle.standardError.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_ERROR label=\(runtimeLaunchAgentLabel) reason=unregister-failed detail=\(errorDescription)\n".utf8
            )
        )
        return 70
    }

    try? await Task<Never, Never>.sleep(for: runtimeUnregistrationSettleDelay)
    switch service.status {
    case .notRegistered, .notFound:
        FileHandle.standardOutput.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_OK label=\(runtimeLaunchAgentLabel) status=unregistered\n".utf8
            )
        )
        return 0
    case .enabled, .requiresApproval:
        FileHandle.standardError.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_ERROR label=\(runtimeLaunchAgentLabel) reason=service-remained-registered\n".utf8
            )
        )
        return 70
    @unknown default:
        FileHandle.standardError.write(
            Data(
                "CODEX_RUNTIME_UNREGISTER_ERROR label=\(runtimeLaunchAgentLabel) reason=unknown-status-after-unregister\n".utf8
            )
        )
        return 70
    }
}

private struct RuntimeStatusPayload: Decodable {
    struct Companion: Decodable {
        let version: String
    }

    struct Device: Decodable {
        let target: String?
        let paired: Bool?
        let ready: Bool
    }

    let ok: Bool
    let companion: Companion
    let device: Device?
}

private struct RuntimeDeviceRepairPayload: Decodable {
    struct Device: Decodable {
        let ready: Bool
    }

    let ok: Bool
    let device: Device
}

enum ExistingDeviceStatusEvaluation: Equatable {
    case ready
    case notConfigured
    case needsRepair
    case failed(String)
}

enum ExistingDevicePreparationOutcome: Equatable, CustomStringConvertible {
    case ready
    case notConfigured
    case failed(String)

    var description: String {
        switch self {
        case .ready:
            return "ready"
        case .notConfigured:
            return "not configured"
        case .failed(let detail):
            return "failed: \(detail)"
        }
    }
}

func evaluateExistingDeviceStatus(
    data: Data,
    httpStatus: Int
) -> ExistingDeviceStatusEvaluation {
    guard (200..<300).contains(httpStatus) else {
        return .failed("unexpected HTTP status \(httpStatus)")
    }
    guard let payload = try? JSONDecoder().decode(RuntimeStatusPayload.self, from: data),
          payload.ok else {
        return .failed("invalid or unhealthy status JSON")
    }
    let target = payload.device?.target?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !target.isEmpty else {
        return .notConfigured
    }
    return payload.device?.ready == true ? .ready : .needsRepair
}

func evaluateExistingDeviceRepair(
    data: Data,
    httpStatus: Int
) -> ExistingDevicePreparationOutcome {
    guard (200..<300).contains(httpStatus) else {
        return .failed("unexpected HTTP status \(httpStatus)")
    }
    guard let payload = try? JSONDecoder().decode(
        RuntimeDeviceRepairPayload.self,
        from: data
    ), payload.ok else {
        return .failed("invalid or unsuccessful repair JSON")
    }
    guard payload.device.ready else {
        return .failed("VibeTV did not confirm a fresh full display frame")
    }
    return .ready
}

func shouldRepairExistingDevice(
    _ evaluation: ExistingDeviceStatusEvaluation,
    requireFreshFullFrame: Bool
) -> Bool {
    switch evaluation {
    case .needsRepair:
        return true
    case .ready:
        return requireFreshFullFrame
    case .notConfigured, .failed:
        return false
    }
}

func shouldRetryExistingDevicePreparation(
    _ outcome: ExistingDevicePreparationOutcome,
    attempt: Int,
    maximumAttempts: Int
) -> Bool {
    guard attempt < maximumAttempts else {
        return false
    }
    if case .failed = outcome {
        return true
    }
    return false
}

enum RuntimeHealthEvaluation: Equatable, CustomStringConvertible {
    case healthy(version: String)
    case httpStatus(Int)
    case invalidPayload
    case reportedUnhealthy
    case expectedVersionMissing
    case versionMismatch(expected: String, actual: String)
    case ownershipFailed(RuntimeOwnershipEvaluation)
    case requestFailed(String)

    var description: String {
        switch self {
        case .healthy(let version):
            return "healthy version=\(version)"
        case .httpStatus(let status):
            return "unexpected HTTP status \(status)"
        case .invalidPayload:
            return "invalid status JSON"
        case .reportedUnhealthy:
            return "status JSON reported ok=false"
        case .expectedVersionMissing:
            return "expected bundled Companion version is missing"
        case .versionMismatch(let expected, let actual):
            return "version mismatch expected=\(expected) actual=\(actual)"
        case .ownershipFailed(let ownership):
            return "listener ownership failed: \(ownership)"
        case .requestFailed(let detail):
            return "request failed: \(detail)"
        }
    }
}

enum RuntimeOwnershipEvaluation: Equatable, CustomStringConvertible {
    case owned(pid: Int32)
    case serviceUnavailable
    case servicePIDMissing
    case listenerUnavailable(servicePID: Int32)
    case listenerMismatch(servicePID: Int32, listenerPIDs: [Int32])

    var description: String {
        switch self {
        case .owned(let pid):
            return "owned pid=\(pid)"
        case .serviceUnavailable:
            return "SMAppService label is not loaded"
        case .servicePIDMissing:
            return "SMAppService PID is missing or ambiguous"
        case .listenerUnavailable(let servicePID):
            return "no TCP listener found for service pid=\(servicePID)"
        case .listenerMismatch(let servicePID, let listenerPIDs):
            return "service pid=\(servicePID) does not exclusively own listener pids=\(listenerPIDs)"
        }
    }
}

func parseLaunchctlServicePID(_ output: String) -> Int32? {
    let pids = output.split(whereSeparator: \Character.isNewline).compactMap { line -> Int32? in
        let fields = line.split(whereSeparator: \Character.isWhitespace)
        guard fields.count == 3,
              fields[0] == "pid",
              fields[1] == "=",
              let pid = Int32(fields[2]),
              pid > 0 else {
            return nil
        }
        return pid
    }
    let uniquePIDs = Set(pids)
    guard uniquePIDs.count == 1 else {
        return nil
    }
    return uniquePIDs.first
}

func parseLsofListenerPIDs(_ output: String) -> [Int32] {
    let pids = output.split(whereSeparator: \Character.isNewline).compactMap { line -> Int32? in
        guard line.first == "p",
              let pid = Int32(line.dropFirst()),
              pid > 0 else {
            return nil
        }
        return pid
    }
    return Set(pids).sorted()
}

func evaluateRuntimeOwnership(
    launchctlExitStatus: Int32?,
    launchctlOutput: String,
    lsofExitStatus: Int32?,
    lsofOutput: String
) -> RuntimeOwnershipEvaluation {
    guard launchctlExitStatus == 0 else {
        return .serviceUnavailable
    }
    guard let servicePID = parseLaunchctlServicePID(launchctlOutput) else {
        return .servicePIDMissing
    }
    guard lsofExitStatus == 0 else {
        return .listenerUnavailable(servicePID: servicePID)
    }
    let listenerPIDs = parseLsofListenerPIDs(lsofOutput)
    guard listenerPIDs == [servicePID] else {
        return .listenerMismatch(
            servicePID: servicePID,
            listenerPIDs: listenerPIDs
        )
    }
    return .owned(pid: servicePID)
}

func evaluateRuntimeHealth(
    data: Data,
    httpStatus: Int,
    expectedVersion: String
) -> RuntimeHealthEvaluation {
    guard (200..<300).contains(httpStatus) else {
        return .httpStatus(httpStatus)
    }
    guard let payload = try? JSONDecoder().decode(RuntimeStatusPayload.self, from: data) else {
        return .invalidPayload
    }
    guard payload.ok else {
        return .reportedUnhealthy
    }

    let expected = normalizedCompanionVersion(expectedVersion)
    guard !expected.isEmpty else {
        return .expectedVersionMissing
    }
    let actual = normalizedCompanionVersion(payload.companion.version)
    guard actual == expected else {
        return .versionMismatch(expected: expected, actual: actual)
    }
    return .healthy(version: actual)
}

func shouldRetryRuntimeRegistration(
    after health: RuntimeHealthEvaluation,
    serviceEnabled: Bool
) -> Bool {
    guard serviceEnabled else {
        return false
    }
    switch health {
    case .requestFailed:
        return true
    case .ownershipFailed(let ownership):
        switch ownership {
        case .serviceUnavailable, .servicePIDMissing, .listenerUnavailable:
            return true
        case .owned, .listenerMismatch:
            return false
        }
    case .healthy,
         .httpStatus,
         .invalidPayload,
         .reportedUnhealthy,
         .expectedVersionMissing,
         .versionMismatch:
        return false
    }
}

func isInstalledApplicationsBundle(_ appURL: URL) -> Bool {
    let path = appURL.standardizedFileURL.resolvingSymlinksInPath().path
    return path.hasPrefix("/Applications/")
}

func requiresApplicationInstallation(_ appURL: URL) -> Bool {
    !isInstalledApplicationsBundle(appURL)
}

func isLegacyTerminalAppBundle(
    at candidateURL: URL,
    currentAppURL: URL,
    expectedBundleIdentifier: String,
    fileManager: FileManager = .default
) -> Bool {
    let candidate = candidateURL.standardizedFileURL.resolvingSymlinksInPath()
    let current = currentAppURL.standardizedFileURL.resolvingSymlinksInPath()
    guard candidate != current,
          fileManager.fileExists(atPath: candidate.path),
          Bundle(url: candidate)?.bundleIdentifier == expectedBundleIdentifier else {
        return false
    }
    let legacyExecutable = candidate
        .appendingPathComponent("Contents/MacOS", isDirectory: true)
        .appendingPathComponent("codexbar-display")
    return fileManager.isExecutableFile(atPath: legacyExecutable.path)
}

struct LegacyLaunchAgentDescriptor: Equatable {
    let label: String
    let userPlistURL: URL?
    let systemPlistURL: URL?

    var migrationPlistURL: URL? {
        userPlistURL
    }

    var restartPlistURL: URL? {
        userPlistURL ?? systemPlistURL
    }
}

private struct LegacyLaunchAgentState {
    let descriptor: LegacyLaunchAgentDescriptor
    let wasLoaded: Bool
    let wasDisabled: Bool
}

func makeLegacyLaunchAgentDescriptor(
    label: String,
    userPlistURL: URL,
    systemPlistURL: URL,
    userPlistExists: Bool,
    systemPlistExists: Bool,
    isLoaded: Bool
) -> LegacyLaunchAgentDescriptor? {
    guard userPlistExists || systemPlistExists || isLoaded else {
        return nil
    }
    return LegacyLaunchAgentDescriptor(
        label: label,
        userPlistURL: userPlistExists ? userPlistURL : nil,
        systemPlistURL: systemPlistExists ? systemPlistURL : nil
    )
}

func parseLaunchctlDisabledServiceStates(_ output: String) -> [String: Bool] {
    var states: [String: Bool] = [:]
    for rawLine in output.split(whereSeparator: \Character.isNewline) {
        let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        guard line.first == "\"",
              let closingQuote = line.dropFirst().firstIndex(of: "\"") else {
            continue
        }
        let label = String(line[line.index(after: line.startIndex)..<closingQuote])
        let valueStart = line.index(after: closingQuote)
        let remainder = line[valueStart...]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard remainder.hasPrefix("=>") else {
            continue
        }
        let value = remainder.dropFirst(2)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("true") || value.hasPrefix("disabled") {
            states[label] = true
        } else if value.hasPrefix("false") || value.hasPrefix("enabled") {
            states[label] = false
        }
    }
    return states
}

func launchctlServiceTarget(uid: uid_t, label: String) -> String {
    "gui/\(uid)/\(label)"
}

func canSafelyStopLegacyLaunchAgent(
    isLoaded: Bool,
    restartPlistURL: URL?
) -> Bool {
    !isLoaded || restartPlistURL != nil
}

private struct MigrationArtifact {
    let source: URL
    let destination: URL
}

private struct ProcessOutput {
    let exitStatus: Int32?
    let output: String
}

enum RuntimePreparationOutcome: Equatable {
    case nativeRuntimeReady
    case legacyRuntimeRestored
    case keepCurrentPage

    var shouldReloadControlCenter: Bool {
        self == .nativeRuntimeReady || self == .legacyRuntimeRestored
    }
}

func shouldRetryControlCenterNavigation(_ error: Error) -> Bool {
    let error = error as NSError
    return !(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var activeNavigation: WKNavigation?
    private let runtimeService = SMAppService.agent(plistName: runtimeLaunchAgentPlistName)
    private var urlRouter = ControlCenterURLRouter()
    private var reloadAttempts = 0
    private var scheduledReload: Task<Void, Never>?
    private var installationRequired: Bool {
        requiresApplicationInstallation(Bundle.main.bundleURL)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureMenu()
        guard !installationRequired else {
            presentInstallationRequiredAlert()
            return
        }
        Task { [weak self] in
            guard let self else {
                return
            }
            let outcome = await self.prepareCompanion()
            if outcome.shouldReloadControlCenter {
                self.reloadControlCenter()
            }
        }
        _ = urlRouter.markReady()
        presentControlCenter()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard !installationRequired else {
            return
        }
        if urlRouter.receive(urls) {
            presentControlCenter()
        }
    }

    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        guard !installationRequired else {
            return false
        }
        presentControlCenter()
        return true
    }

    @objc private func reloadControlCenter() {
        scheduledReload?.cancel()
        scheduledReload = nil
        reloadAttempts = 0
        loadControlCenter(cachePolicy: .reloadIgnoringLocalCacheData)
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

    private func presentControlCenter() {
        guard !installationRequired else {
            return
        }
        if window == nil {
            createWindow()
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func presentInstallationRequiredAlert() {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Move VibeTV Control Center to Applications"
        alert.informativeText = """
            In Finder, drag VibeTV Control Center into Applications, then open it there again.

            If the app already appears in Applications, move it to another folder and then back to Applications before opening it again.
            """
        alert.addButton(withTitle: "Open Applications")
        alert.addButton(withTitle: "Quit")

        if alert.runModal() == .alertFirstButtonReturn {
            let applicationsURL = URL(fileURLWithPath: "/Applications", isDirectory: true)
            if !NSWorkspace.shared.open(applicationsURL) {
                NSLog("VibeTV Control Center could not open /Applications in Finder")
            }
        }
        NSApp.terminate(nil)
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = nativeControlCenterUserAgent(
            shortVersion: Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String,
            buildVersion: Bundle.main.object(
                forInfoDictionaryKey: "CFBundleVersion"
            ) as? String
        )
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
        window.isReleasedWhenClosed = false

        self.window = window
        self.webView = webView
        loadControlCenter()
    }

    private func loadControlCenter(
        cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy
    ) {
        guard let url = URL(string: controlCenterURLString) else {
            return
        }
        activeNavigation = webView?.load(
            URLRequest(
                url: url,
                cachePolicy: cachePolicy,
                timeoutInterval: 30
            )
        )
    }

    private func prepareCompanion() async -> RuntimePreparationOutcome {
        guard isInstalledApplicationsBundle(Bundle.main.bundleURL) else {
            NSLog(
                "VibeTV Control Center runtime migration skipped: move the app to /Applications first"
            )
            return .keepCurrentPage
        }
        guard bundledRuntimeResourcesAreValid() else {
            NSLog("VibeTV Control Center app-managed runtime resources are missing")
            return .keepCurrentPage
        }

        let expectedVersion = currentCompanionVersion()
        guard !expectedVersion.isEmpty else {
            NSLog("VibeTV Control Center bundled Companion version is missing")
            return .keepCurrentPage
        }

        guard let legacyStates = legacyLaunchAgentStates() else {
            NSLog(
                "VibeTV Control Center kept legacy services and apps because their launchctl state could not be captured"
            )
            return .keepCurrentPage
        }
        let legacyDescriptors = legacyStates.map(\.descriptor)
        let legacyApps = legacyTerminalAppURLs()
        let hasLoadedLegacyWriter = legacyStates.contains(where: \.wasLoaded)

        // Repair an already-overlapping installation before migration. Apple's
        // unregister call terminates the running app-managed LaunchAgent.
        if hasLoadedLegacyWriter, runtimeService.status == .enabled {
            guard await unregisterBundledRuntimeService() else {
                NSLog(
                    "VibeTV Control Center could not stop the app-managed runtime before legacy migration"
                )
                return .keepCurrentPage
            }
        }

        if !stopLegacyLaunchAgents(legacyStates) {
            let reason = "one or more legacy LaunchAgents could not be stopped"
            let restored = restoreLegacyAgents(legacyStates, reason: reason)
            return restored ? .legacyRuntimeRestored : .keepCurrentPage
        }

        // SMAppService.register() bootstraps a LaunchAgent immediately. Stop
        // every legacy writer first so migration never overlaps two streams.
        guard await ensureBundledRuntimeServiceRegistered() else {
            NSLog(
                "VibeTV Control Center could not register the app-managed runtime after stopping legacy services"
            )
            if !legacyStates.isEmpty {
                let reason = "the app-managed runtime could not be registered"
                let restored: Bool
                if runtimeService.status == .enabled {
                    restored = await rollbackToLegacyAgents(legacyStates, reason: reason)
                } else {
                    restored = restoreLegacyAgents(legacyStates, reason: reason)
                }
                return restored ? .legacyRuntimeRestored : .keepCurrentPage
            }
            return .keepCurrentPage
        }

        var health = await waitForHealthyRuntime(expectedVersion: expectedVersion)
        if shouldRetryRuntimeRegistration(
            after: health,
            serviceEnabled: runtimeService.status == .enabled
        ) {
            NSLog(
                "VibeTV Control Center runtime did not become reachable; refreshing its Service Management registration once: \(health)"
            )
            if await unregisterBundledRuntimeService(), registerBundledRuntimeService() {
                health = await waitForHealthyRuntime(expectedVersion: expectedVersion)
            }
        }
        guard case .healthy = health, runtimeService.status == .enabled else {
            NSLog(
                "VibeTV Control Center runtime health gate failed; legacy artifacts remain untouched: \(health)"
            )
            if !legacyStates.isEmpty {
                let restored = await rollbackToLegacyAgents(
                    legacyStates,
                    reason: health.description
                )
                return restored ? .legacyRuntimeRestored : .keepCurrentPage
            } else if !(await unregisterBundledRuntimeService()) {
                NSLog(
                    "VibeTV Control Center could not unregister the failed app-managed runtime"
                )
            }
            return .keepCurrentPage
        }

        let devicePreparation = await prepareExistingDeviceConnectionWithRetries(
            requireFreshFullFrame: !legacyStates.isEmpty || !legacyApps.isEmpty
        )
        if case .failed(let detail) = devicePreparation {
            NSLog(
                "VibeTV Control Center kept legacy artifacts because the existing VibeTV connection could not be repaired automatically: \(detail)"
            )
            if !legacyStates.isEmpty {
                let restored = await rollbackToLegacyAgents(
                    legacyStates,
                    reason: "existing VibeTV repair failed: \(detail)"
                )
                return restored ? .legacyRuntimeRestored : .keepCurrentPage
            }
            return .nativeRuntimeReady
        }
        NSLog(
            "VibeTV Control Center existing device preparation completed: \(devicePreparation)"
        )

        if legacyStates.isEmpty {
            let migratedLegacyApps = await migrateLegacyAppsAfterHealthyRuntime(legacyApps)
            guard migratedLegacyApps else {
                return .nativeRuntimeReady
            }
            recordCurrentRuntimeBundleVersion()
            return .nativeRuntimeReady
        }

        if !legacyApps.isEmpty {
            let registeredURLHandler = await registerCurrentAppAsURLHandler()
            if !registeredURLHandler {
                let restored = await rollbackToLegacyAgents(
                    legacyStates,
                    reason: "the current app could not become the vibetv URL handler"
                )
                return restored ? .legacyRuntimeRestored : .keepCurrentPage
            }
        }

        let backupRoot = migrationBackupURL()
        let artifacts = migrationArtifacts(
            legacyAgents: legacyDescriptors,
            legacyApps: legacyApps,
            backupRoot: backupRoot
        )
        guard moveMigrationArtifacts(artifacts) != nil else {
            let restored = await rollbackToLegacyAgents(
                legacyStates,
                reason: "legacy artifacts could not be moved into the migration backup"
            )
            return restored ? .legacyRuntimeRestored : .keepCurrentPage
        }

        recordCurrentRuntimeBundleVersion()
        NSLog(
            "VibeTV Control Center migration completed with healthy Companion version \(expectedVersion); backup=\(backupRoot.path)"
        )
        return .nativeRuntimeReady
    }

    private func prepareExistingDeviceConnectionWithRetries(
        requireFreshFullFrame: Bool
    ) async -> ExistingDevicePreparationOutcome {
        var attempt = 1
        var outcome = await prepareExistingDeviceConnection(
            requireFreshFullFrame: requireFreshFullFrame
        )
        while shouldRetryExistingDevicePreparation(
            outcome,
            attempt: attempt,
            maximumAttempts: runtimeDeviceRepairMaxAttempts
        ) {
            NSLog(
                "VibeTV Control Center device preparation attempt \(attempt) failed transiently: \(outcome); retrying"
            )
            try? await Task<Never, Never>.sleep(for: runtimeDeviceRepairRetryDelay)
            attempt += 1
            outcome = await prepareExistingDeviceConnection(
                requireFreshFullFrame: requireFreshFullFrame
            )
        }
        return outcome
    }

    private func prepareExistingDeviceConnection(
        requireFreshFullFrame: Bool
    ) async -> ExistingDevicePreparationOutcome {
        guard let statusURL = URL(string: runtimeStatusURLString),
              let repairURL = URL(string: runtimeDeviceRepairURLString) else {
            return .failed("invalid local device preparation URL")
        }

        do {
            var statusRequest = URLRequest(
                url: statusURL,
                cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: runtimeHealthRequestTimeout
            )
            statusRequest.httpMethod = "GET"
            let (statusData, statusResponse) = try await URLSession.shared.data(
                for: statusRequest
            )
            guard let statusHTTP = statusResponse as? HTTPURLResponse else {
                return .failed("local status response was not HTTP")
            }

            let statusEvaluation = evaluateExistingDeviceStatus(
                data: statusData,
                httpStatus: statusHTTP.statusCode
            )
            switch statusEvaluation {
            case .ready:
                if !shouldRepairExistingDevice(
                    statusEvaluation,
                    requireFreshFullFrame: requireFreshFullFrame
                ) {
                    return .ready
                }
            case .notConfigured:
                return .notConfigured
            case .failed(let detail):
                return .failed(detail)
            case .needsRepair:
                break
            }

            var repairRequest = URLRequest(
                url: repairURL,
                cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: runtimeDeviceRepairTimeout
            )
            repairRequest.httpMethod = "POST"
            repairRequest.httpBody = Data("{}".utf8)
            repairRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let (repairData, repairResponse) = try await URLSession.shared.data(
                for: repairRequest
            )
            guard let repairHTTP = repairResponse as? HTTPURLResponse else {
                return .failed("local repair response was not HTTP")
            }
            return evaluateExistingDeviceRepair(
                data: repairData,
                httpStatus: repairHTTP.statusCode
            )
        } catch {
            return .failed((error as NSError).localizedDescription)
        }
    }

    private func ensureBundledRuntimeServiceRegistered() async -> Bool {
        switch runtimeService.status {
        case .enabled:
            if runtimeServiceNeedsRefresh(
                registeredVersion: registeredRuntimeBundleVersion(),
                currentVersion: currentRuntimeBundleVersion()
            ) {
                guard await unregisterBundledRuntimeService() else {
                    return false
                }
                return registerBundledRuntimeService()
            }
            return true
        case .requiresApproval:
            NSLog(
                "VibeTV Control Center runtime needs approval in System Settings > General > Login Items"
            )
            return false
        case .notRegistered, .notFound:
            return registerBundledRuntimeService()
        @unknown default:
            NSLog("VibeTV Control Center runtime has an unknown Service Management status")
            return false
        }
    }

    private func registerBundledRuntimeService() -> Bool {
        do {
            try runtimeService.register()
        } catch {
            NSLog("VibeTV Control Center could not register its app-managed runtime: \(error)")
            return runtimeService.status == .enabled
        }

        switch runtimeService.status {
        case .enabled:
            return true
        case .requiresApproval:
            NSLog(
                "VibeTV Control Center runtime was registered but needs approval in System Settings > General > Login Items"
            )
            return false
        case .notRegistered, .notFound:
            NSLog("VibeTV Control Center runtime registration did not become enabled")
            return false
        @unknown default:
            NSLog("VibeTV Control Center runtime has an unknown status after registration")
            return false
        }
    }

    private func unregisterBundledRuntimeService() async -> Bool {
        switch runtimeService.status {
        case .notRegistered, .notFound:
            return true
        case .enabled, .requiresApproval:
            break
        @unknown default:
            break
        }

        let errorDescription: String? = await withCheckedContinuation { continuation in
            runtimeService.unregister(completionHandler: { error in
                continuation.resume(returning: error.map { ($0 as NSError).localizedDescription })
            })
        }

        switch runtimeService.status {
        case .notRegistered, .notFound:
            try? await Task<Never, Never>.sleep(for: runtimeUnregistrationSettleDelay)
            return true
        case .enabled, .requiresApproval:
            NSLog(
                "VibeTV Control Center could not unregister its runtime: \(errorDescription ?? "service remained registered")"
            )
            return false
        @unknown default:
            NSLog(
                "VibeTV Control Center runtime has an unknown status after unregister: \(errorDescription ?? "unknown error")"
            )
            return false
        }
    }

    private func waitForHealthyRuntime(
        expectedVersion: String
    ) async -> RuntimeHealthEvaluation {
        guard let statusURL = URL(string: runtimeStatusURLString) else {
            return .requestFailed("invalid local status URL")
        }

        let deadline = Date().addingTimeInterval(runtimeHealthTimeout)
        var lastEvaluation: RuntimeHealthEvaluation = .requestFailed("no response")
        repeat {
            var request = URLRequest(
                url: statusURL,
                cachePolicy: .reloadIgnoringLocalCacheData,
                timeoutInterval: runtimeHealthRequestTimeout
            )
            request.httpMethod = "GET"
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    lastEvaluation = .requestFailed("response was not HTTP")
                    continue
                }
                lastEvaluation = evaluateRuntimeHealth(
                    data: data,
                    httpStatus: http.statusCode,
                    expectedVersion: expectedVersion
                )
                if case .healthy = lastEvaluation {
                    let ownership = verifyRuntimeListenerOwnership()
                    if case .owned = ownership {
                        return lastEvaluation
                    }
                    lastEvaluation = .ownershipFailed(ownership)
                }
            } catch {
                lastEvaluation = .requestFailed((error as NSError).localizedDescription)
            }

            if Date() < deadline {
                try? await Task<Never, Never>.sleep(for: .milliseconds(500))
            }
        } while Date() < deadline

        return lastEvaluation
    }

    private func currentCompanionVersion() -> String {
        let shortVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? ""
        return normalizedCompanionVersion(shortVersion)
    }

    private func currentRuntimeBundleVersion() -> String {
        let shortVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String
        let buildVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String
        return runtimeBundleVersion(shortVersion: shortVersion, buildVersion: buildVersion)
    }

    private func registeredRuntimeBundleVersion() -> String? {
        UserDefaults.standard.string(forKey: runtimeRegisteredVersionDefaultsKey)
    }

    private func recordCurrentRuntimeBundleVersion() {
        UserDefaults.standard.set(
            currentRuntimeBundleVersion(),
            forKey: runtimeRegisteredVersionDefaultsKey
        )
    }

    private func bundledRuntimeResourcesAreValid() -> Bool {
        let binaryURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers", isDirectory: true)
            .appendingPathComponent("codexbar-display")
        let plistURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Library/LaunchAgents", isDirectory: true)
            .appendingPathComponent(runtimeLaunchAgentPlistName)
        return FileManager.default.isExecutableFile(atPath: binaryURL.path)
            && FileManager.default.fileExists(atPath: plistURL.path)
    }

    private func legacyLaunchAgentStates() -> [LegacyLaunchAgentState]? {
        let fileManager = FileManager.default
        let candidates = legacyLaunchAgents.compactMap { label, plistName
            -> (LegacyLaunchAgentDescriptor, Bool)? in
            let userPlistURL = userLaunchAgentURL(plistName)
            let systemPlistURL = systemLaunchAgentURL(plistName)
            let isLoaded = legacyServiceIsLoaded(label: label)
            guard let descriptor = makeLegacyLaunchAgentDescriptor(
                label: label,
                userPlistURL: userPlistURL,
                systemPlistURL: systemPlistURL,
                userPlistExists: fileManager.fileExists(atPath: userPlistURL.path),
                systemPlistExists: fileManager.fileExists(atPath: systemPlistURL.path),
                isLoaded: isLoaded
            ) else {
                return nil
            }
            return (descriptor, isLoaded)
        }
        guard !candidates.isEmpty else {
            return []
        }

        guard let disabledStates = legacyDisabledServiceStates() else {
            return nil
        }
        return candidates.map { descriptor, isLoaded in
            LegacyLaunchAgentState(
                descriptor: descriptor,
                wasLoaded: isLoaded,
                wasDisabled: disabledStates[descriptor.label] ?? false
            )
        }
    }

    private func stopLegacyLaunchAgents(_ states: [LegacyLaunchAgentState]) -> Bool {
        guard states.allSatisfy({
            canSafelyStopLegacyLaunchAgent(
                isLoaded: $0.wasLoaded,
                restartPlistURL: $0.descriptor.restartPlistURL
            )
        }) else {
            NSLog(
                "VibeTV Control Center kept a loaded legacy LaunchAgent because no rollback plist could be found"
            )
            return false
        }

        for state in states {
            let service = launchctlServiceTarget(
                uid: getuid(),
                label: state.descriptor.label
            )
            if !state.wasDisabled {
                guard launchctlExitStatus(["disable", service]) == 0 else {
                    NSLog(
                        "VibeTV Control Center could not disable legacy LaunchAgent \(state.descriptor.label)"
                    )
                    return false
                }
            }
            guard legacyServiceIsDisabled(label: state.descriptor.label) == true else {
                NSLog(
                    "VibeTV Control Center could not verify disabled legacy LaunchAgent \(state.descriptor.label)"
                )
                return false
            }

            if state.wasLoaded {
                _ = launchctlExitStatus(["bootout", service])
            }
            guard !legacyServiceIsLoaded(label: state.descriptor.label) else {
                NSLog(
                    "VibeTV Control Center could not stop legacy LaunchAgent \(state.descriptor.label)"
                )
                return false
            }
        }
        return true
    }

    private func rollbackToLegacyAgents(
        _ states: [LegacyLaunchAgentState],
        reason: String
    ) async -> Bool {
        NSLog("VibeTV Control Center rolling back to legacy services: \(reason)")
        guard await unregisterBundledRuntimeService() else {
            NSLog(
                "VibeTV Control Center rollback stopped: app-managed runtime could not be unregistered"
            )
            return false
        }
        return restoreLegacyAgents(states, reason: reason)
    }

    private func restoreLegacyAgents(
        _ states: [LegacyLaunchAgentState],
        reason: String
    ) -> Bool {
        NSLog("VibeTV Control Center restoring legacy services: \(reason)")
        var restored = true
        for state in states {
            let service = launchctlServiceTarget(
                uid: getuid(),
                label: state.descriptor.label
            )
            if !state.wasDisabled || state.wasLoaded {
                guard launchctlExitStatus(["enable", service]) == 0,
                      legacyServiceIsDisabled(label: state.descriptor.label) == false else {
                    NSLog(
                        "VibeTV Control Center could not re-enable legacy LaunchAgent \(state.descriptor.label)"
                    )
                    restored = false
                    continue
                }
            }

            guard state.wasLoaded else {
                continue
            }
            if !legacyServiceIsLoaded(label: state.descriptor.label) {
                guard let restartPlistURL = state.descriptor.restartPlistURL,
                      FileManager.default.fileExists(atPath: restartPlistURL.path) else {
                    NSLog(
                        "VibeTV Control Center rollback has no plist to restart legacy LaunchAgent \(state.descriptor.label)"
                    )
                    restored = false
                    continue
                }
                _ = launchctlExitStatus([
                    "bootstrap",
                    "gui/\(getuid())",
                    restartPlistURL.path,
                ])
                if !legacyServiceIsLoaded(label: state.descriptor.label) {
                    NSLog(
                        "VibeTV Control Center could not restore legacy LaunchAgent \(state.descriptor.label)"
                    )
                    restored = false
                    continue
                }
            }
            if state.wasDisabled {
                guard launchctlExitStatus(["disable", service]) == 0,
                      legacyServiceIsDisabled(label: state.descriptor.label) == true else {
                    NSLog(
                        "VibeTV Control Center could not restore disabled state for legacy LaunchAgent \(state.descriptor.label)"
                    )
                    restored = false
                    continue
                }
            }
        }

        if restored {
            NSLog("VibeTV Control Center restored the previous legacy services")
        }
        return restored
    }

    private func legacyServiceIsLoaded(label: String) -> Bool {
        launchctlExitStatus([
            "print",
            launchctlServiceTarget(uid: getuid(), label: label),
        ]) == 0
    }

    private func legacyDisabledServiceStates() -> [String: Bool]? {
        let result = runCommandCapturingOutput(
            executable: "/bin/launchctl",
            arguments: ["print-disabled", "gui/\(getuid())"]
        )
        guard result.exitStatus == 0 else {
            NSLog("VibeTV Control Center could not read disabled LaunchAgent state")
            return nil
        }
        return parseLaunchctlDisabledServiceStates(result.output)
    }

    private func legacyServiceIsDisabled(label: String) -> Bool? {
        guard let states = legacyDisabledServiceStates() else {
            return nil
        }
        return states[label] ?? false
    }

    private func verifyRuntimeListenerOwnership() -> RuntimeOwnershipEvaluation {
        let launchctl = runCommandCapturingOutput(
            executable: "/bin/launchctl",
            arguments: [
                "print",
                "gui/\(getuid())/\(runtimeLaunchAgentLabel)",
            ]
        )
        guard let servicePID = parseLaunchctlServicePID(launchctl.output),
              launchctl.exitStatus == 0 else {
            return evaluateRuntimeOwnership(
                launchctlExitStatus: launchctl.exitStatus,
                launchctlOutput: launchctl.output,
                lsofExitStatus: nil,
                lsofOutput: ""
            )
        }

        let lsof = runCommandCapturingOutput(
            executable: "/usr/sbin/lsof",
            arguments: [
                "-nP",
                "-a",
                "-p",
                String(servicePID),
                "-iTCP@127.0.0.1:47832",
                "-sTCP:LISTEN",
                "-Fp",
            ]
        )
        return evaluateRuntimeOwnership(
            launchctlExitStatus: launchctl.exitStatus,
            launchctlOutput: launchctl.output,
            lsofExitStatus: lsof.exitStatus,
            lsofOutput: lsof.output
        )
    }

    private func runCommandCapturingOutput(
        executable: String,
        arguments: [String]
    ) -> ProcessOutput {
        let process = Process()
        let outputPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = outputPipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return ProcessOutput(
                exitStatus: process.terminationStatus,
                output: String(data: data, encoding: .utf8) ?? ""
            )
        } catch {
            NSLog(
                "VibeTV Control Center could not run \(executable) \(arguments.joined(separator: " ")): \(error)"
            )
            return ProcessOutput(exitStatus: nil, output: "")
        }
    }

    private func launchctlExitStatus(_ arguments: [String]) -> Int32? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            NSLog(
                "VibeTV Control Center could not run launchctl \(arguments.joined(separator: " ")): \(error)"
            )
            return nil
        }
    }

    private func legacyTerminalAppURLs() -> [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [
            home
                .appendingPathComponent("Applications", isDirectory: true)
                .appendingPathComponent("VibeTV Control Center.app", isDirectory: true),
            applicationSupportURL()
                .appendingPathComponent("VibeTV Control Center.app", isDirectory: true),
        ]
        return candidates.filter {
            isLegacyTerminalAppBundle(
                at: $0,
                currentAppURL: Bundle.main.bundleURL,
                expectedBundleIdentifier: controlCenterBundleIdentifier
            )
        }
    }

    private func migrateLegacyAppsAfterHealthyRuntime(_ legacyApps: [URL]) async -> Bool {
        guard !legacyApps.isEmpty else {
            return true
        }

        guard await registerCurrentAppAsURLHandler() else {
            NSLog(
                "VibeTV Control Center kept legacy app bundles because the vibetv URL handler could not be updated"
            )
            return false
        }

        let backupRoot = migrationBackupURL()
        let artifacts = migrationArtifacts(
            legacyAgents: [],
            legacyApps: legacyApps,
            backupRoot: backupRoot
        )
        guard moveMigrationArtifacts(artifacts) != nil else {
            NSLog(
                "VibeTV Control Center kept legacy app bundles because they could not be moved"
            )
            return false
        }
        NSLog(
            "VibeTV Control Center moved legacy app bundles into \(backupRoot.path)"
        )
        return true
    }

    private func migrationArtifacts(
        legacyAgents: [LegacyLaunchAgentDescriptor],
        legacyApps: [URL],
        backupRoot: URL
    ) -> [MigrationArtifact] {
        var artifacts = legacyAgents.compactMap { descriptor -> MigrationArtifact? in
            guard let userPlistURL = descriptor.migrationPlistURL else {
                return nil
            }
            return MigrationArtifact(
                source: userPlistURL,
                destination: backupRoot
                    .appendingPathComponent("launch-agents", isDirectory: true)
                    .appendingPathComponent(userPlistURL.lastPathComponent)
            )
        }
        artifacts.append(contentsOf: legacyApps.enumerated().map { index, source in
            MigrationArtifact(
                source: source,
                destination: backupRoot
                    .appendingPathComponent("legacy-apps", isDirectory: true)
                    .appendingPathComponent(
                        "legacy-\(index + 1)-VibeTV-Control-Center.app.backup",
                        isDirectory: true
                    )
            )
        })
        return artifacts
    }

    private func moveMigrationArtifacts(
        _ artifacts: [MigrationArtifact]
    ) -> [MigrationArtifact]? {
        let fileManager = FileManager.default
        var moved: [MigrationArtifact] = []
        for artifact in artifacts {
            do {
                try fileManager.createDirectory(
                    at: artifact.destination.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try fileManager.moveItem(at: artifact.source, to: artifact.destination)
                moved.append(artifact)
            } catch {
                NSLog(
                    "VibeTV Control Center could not move \(artifact.source.path) into migration backup: \(error)"
                )
                _ = restoreMigrationArtifacts(moved)
                return nil
            }
        }
        return moved
    }

    @discardableResult
    private func restoreMigrationArtifacts(_ artifacts: [MigrationArtifact]) -> Bool {
        let fileManager = FileManager.default
        var restored = true
        for artifact in artifacts.reversed() {
            guard fileManager.fileExists(atPath: artifact.destination.path) else {
                continue
            }
            do {
                try fileManager.createDirectory(
                    at: artifact.source.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try fileManager.moveItem(at: artifact.destination, to: artifact.source)
            } catch {
                NSLog(
                    "VibeTV Control Center could not restore \(artifact.source.path): \(error)"
                )
                restored = false
            }
        }
        return restored
    }

    private func registerCurrentAppAsURLHandler() async -> Bool {
        let errorDescription: String? = await withCheckedContinuation { continuation in
            NSWorkspace.shared.setDefaultApplication(
                at: Bundle.main.bundleURL,
                toOpenURLsWithScheme: controlCenterURLScheme,
                completion: { error in
                    continuation.resume(
                        returning: error.map { ($0 as NSError).localizedDescription }
                    )
                }
            )
        }
        if let errorDescription {
            NSLog(
                "VibeTV Control Center could not become the vibetv URL handler: \(errorDescription)"
            )
            return false
        }
        return true
    }

    private func migrationBackupURL() -> URL {
        let uniqueSuffix = UUID().uuidString.prefix(8)
        return applicationSupportURL()
            .appendingPathComponent("migration-backups", isDirectory: true)
            .appendingPathComponent(
                "\(timestampForBackup())-\(uniqueSuffix)",
                isDirectory: true
            )
    }

    private func userLaunchAgentURL(_ plistName: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
            .appendingPathComponent(plistName)
    }

    private func systemLaunchAgentURL(_ plistName: String) -> URL {
        URL(fileURLWithPath: "/Library/LaunchAgents", isDirectory: true)
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
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url,
              isApprovedDMGDownloadURL(url) else {
            decisionHandler(.allow)
            return
        }

        decisionHandler(.cancel)
        if !NSWorkspace.shared.open(url) {
            NSLog("VibeTV Control Center could not open verified DMG URL in the default browser")
        }
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        guard let activeNavigation, navigation === activeNavigation else {
            return
        }
        self.activeNavigation = nil
        guard shouldRetryControlCenterNavigation(error) else {
            return
        }
        scheduleReload()
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        guard let activeNavigation, navigation === activeNavigation else {
            return
        }
        self.activeNavigation = nil
        guard shouldRetryControlCenterNavigation(error) else {
            return
        }
        scheduleReload()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let activeNavigation, navigation === activeNavigation else {
            return
        }
        self.activeNavigation = nil
        scheduledReload?.cancel()
        scheduledReload = nil
        reloadAttempts = 0
    }

    private func scheduleReload() {
        guard reloadAttempts < 20, scheduledReload == nil else {
            return
        }
        reloadAttempts += 1
        scheduledReload = Task { [weak self] in
            do {
                try await Task<Never, Never>.sleep(for: .milliseconds(500))
            } catch {
                return
            }
            guard !Task<Never, Never>.isCancelled else {
                return
            }
            guard let self else {
                return
            }
            self.scheduledReload = nil
            self.loadControlCenter(cachePolicy: .reloadIgnoringLocalCacheData)
        }
    }
}

#if VIBETV_CONTROL_CENTER_TESTING
runURLSchemeTests()
#else
if shouldRunRuntimeValidationUnregister(
    arguments: CommandLine.arguments,
    environment: ProcessInfo.processInfo.environment
) {
    Task { @MainActor in
        exit(await runRuntimeValidationUnregister())
    }
    dispatchMain()
} else {
    MainActor.assumeIsolated {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
#endif
