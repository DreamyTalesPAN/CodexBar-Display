import Cocoa
import CryptoKit
import Foundation
import ServiceManagement
import UniformTypeIdentifiers
import WebKit
#if canImport(Sparkle)
import Sparkle
#endif

private let controlCenterURLString = "http://127.0.0.1:47832/control-center"
private let runtimeHealthURLString = "http://127.0.0.1:47832/v1/runtime-health"
private let nativeControlCenterUserAgentPrefix = "VibeTVControlCenter/"
private let controlCenterURLScheme = "vibetv"
private let controlCenterURLHost = "open-control-center"
private let restartControlCenterURLHost = "restart-control-center"
private let repairRuntimeURLHost = "repair-runtime"
private let checkForUpdatesURLHost = "check-for-updates"
private let repairCodexBarURLHost = "repair-codexbar"
private let controlCenterBundleIdentifier = "shop.vibetv.control-center"
private let runtimeLaunchAgentLabel = "shop.vibetv.control-center.runtime"
private let previewRuntimeLaunchAgentLabel =
    "shop.vibetv.control-center.preview-runtime"
private let runtimeLaunchAgentPlistName = "shop.vibetv.control-center.runtime.plist"
private let localPreviewRuntimeInfoKey = "VibeTVLocalPreviewRuntime"
private let localPreviewRuntimePlistName = "preview-runtime.plist"
private let runtimeRegisteredVersionDefaultsKey =
    "shop.vibetv.control-center.runtime.registered-bundle-version"
private let pendingNativeUpdateFileName = "pending-native-update.json"
private let pendingNativeUpdateMaximumAge: TimeInterval = 30 * 60
private let runtimeInitialHealthTimeout: TimeInterval = 8
private let runtimeHealthTimeout: TimeInterval = 35
private let runtimeHealthRequestTimeout: TimeInterval = 5
private let localNetworkPrivacyProbeURLString = "http://192.168.4.1/hello"
private let localNetworkPrivacyProbeTimeout: TimeInterval = 15
private let runtimeUnregistrationSettleDelay: Duration = .seconds(2)
private let runtimeValidationUnregisterArgument =
    "--vibetv-validation-unregister-runtime"
private let runtimeValidationUnregisterEnvironmentKey =
    "VIBETV_RUNTIME_VALIDATION_UNREGISTER"
private let codexBarBundleIdentifier = "com.steipete.codexbar"
private let codexBarPinnedVersion = "0.44.0"
private let codexBarMinimumCompatibleVersion = "0.23.0"
private let codexBarPinnedTeamIdentifier = "Y5PE65HELJ"
private let codexBarArchiveName = "CodexBar-macos-universal-0.44.0.zip"
private let codexBarArchiveSHA256 =
    "958c4b3fc64367d833b6e26df98d262b16384a52dcf6b8181f9b98091505671f"
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

func isCheckForUpdatesURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == controlCenterURLScheme,
          components.host?.lowercased() == checkForUpdatesURLHost,
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

func isRestartControlCenterURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == controlCenterURLScheme,
          components.host?.lowercased() == restartControlCenterURLHost,
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

func isRepairRuntimeURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == controlCenterURLScheme,
          components.host?.lowercased() == repairRuntimeURLHost,
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

func isRepairCodexBarURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == controlCenterURLScheme,
          components.host?.lowercased() == repairCodexBarURLHost,
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

enum NativeControlCenterAction: Equatable {
    case restartControlCenter
    case repairRuntime
    case checkForUpdates
    case repairCodexBar
}

func nativeControlCenterAction(for url: URL) -> NativeControlCenterAction? {
    if isRestartControlCenterURL(url) {
        return .restartControlCenter
    }
    if isRepairRuntimeURL(url) {
        return .repairRuntime
    }
    if isCheckForUpdatesURL(url) {
        return .checkForUpdates
    }
    if isRepairCodexBarURL(url) {
        return .repairCodexBar
    }
    return nil
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

func makeLocalNetworkPrivacyProbeRequest(
    urlString: String = localNetworkPrivacyProbeURLString,
    timeout: TimeInterval = localNetworkPrivacyProbeTimeout
) -> URLRequest? {
    guard let url = URL(string: urlString),
          url.scheme?.lowercased() == "http",
          url.host == "192.168.4.1",
          url.path == "/hello",
          url.user == nil,
          url.password == nil,
          url.query == nil,
          url.fragment == nil else {
        return nil
    }
    var request = URLRequest(
        url: url,
        cachePolicy: .reloadIgnoringLocalCacheData,
        timeoutInterval: timeout
    )
    request.httpMethod = "GET"
    return request
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

func isCompatibleCodexBarVersion(
    _ version: String,
    minimumVersion: String = codexBarMinimumCompatibleVersion
) -> Bool {
    let candidate = version.trimmingCharacters(in: .whitespacesAndNewlines)
    let minimum = minimumVersion.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !candidate.isEmpty, !minimum.isEmpty else {
        return false
    }
    return candidate.compare(minimum, options: .numeric) != .orderedAscending
}

func codexBarInstalledAppCandidates(homeDirectory: URL) -> [URL] {
    [
        URL(fileURLWithPath: "/Applications/CodexBar.app", isDirectory: true),
        homeDirectory
            .appendingPathComponent("Applications", isDirectory: true)
            .appendingPathComponent("CodexBar.app", isDirectory: true),
    ]
}

func defaultCodexBarConfigData() -> Data {
    Data(
        """
        {
          "version": 1,
          "providers": [
            {"id": "codex", "enabled": true},
            {"id": "claude", "enabled": true},
            {"id": "cursor", "enabled": true},
            {"id": "gemini", "enabled": true},
            {"id": "copilot", "enabled": true}
          ]
        }

        """.utf8
    )
}

private struct CodexBarCommandResult {
    let exitCode: Int32
    let output: String
}

private func runCodexBarCommand(
    executableURL: URL,
    arguments: [String]
) -> CodexBarCommandResult? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = executableURL
    process.arguments = arguments
    process.standardOutput = pipe
    process.standardError = pipe
    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return nil
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return CodexBarCommandResult(
        exitCode: process.terminationStatus,
        output: String(data: data, encoding: .utf8) ?? ""
    )
}

private func sha256Hex(of fileURL: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
        return nil
    }
    defer { try? handle.close() }
    var digest = SHA256()
    do {
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            digest.update(data: data)
        }
    } catch {
        return nil
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
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
        let app: App?
        let runtime: Runtime?

        struct App: Decodable {
            let version: String?
            let build: String?
            let path: String?
            let installedInApplications: Bool?
        }

        struct Runtime: Decodable {
            let version: String?
            let commit: String?
            let pid: Int32?
            let listenerOwner: String?
        }
    }

    let ok: Bool
    let companion: Companion
}

enum RuntimeHealthEvaluation: Equatable, CustomStringConvertible {
    case healthy(version: String)
    case httpStatus(Int)
    case invalidPayload
    case reportedUnhealthy
    case expectedVersionMissing
    case versionMismatch(expected: String, actual: String)
    case appMetadataMissing
    case appBuildMismatch(expected: String, actual: String)
    case appPathMismatch(expected: String, actual: String)
    case runtimeOwnerMismatch(expected: String, actual: String)
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
        case .appMetadataMissing:
            return "native app metadata is missing"
        case .appBuildMismatch(let expected, let actual):
            return "app build mismatch expected=\(expected) actual=\(actual)"
        case .appPathMismatch(let expected, let actual):
            return "app path mismatch expected=\(expected) actual=\(actual)"
        case .runtimeOwnerMismatch(let expected, let actual):
            return "runtime owner mismatch expected=\(expected) actual=\(actual)"
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
    expectedVersion: String,
    expectedAppVersion: String? = nil,
    expectedBuild: String? = nil,
    expectedAppPath: String? = nil,
    expectedRuntimeOwner: String? = nil
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

    let requiresNativeMetadata = expectedBuild != nil
        || expectedAppPath != nil
        || expectedRuntimeOwner != nil
    if requiresNativeMetadata {
        guard let app = payload.companion.app,
              let runtime = payload.companion.runtime,
              app.installedInApplications == true else {
            return .appMetadataMissing
        }
        let expectedNativeAppVersion = normalizedCompanionVersion(
            expectedAppVersion ?? expectedVersion
        )
        let appVersion = normalizedCompanionVersion(app.version ?? "")
        guard appVersion == expectedNativeAppVersion else {
            return .versionMismatch(expected: expectedNativeAppVersion, actual: appVersion)
        }
        if let expectedBuild {
            let actualBuild = app.build?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard actualBuild == expectedBuild.trimmingCharacters(in: .whitespacesAndNewlines) else {
                return .appBuildMismatch(expected: expectedBuild, actual: actualBuild)
            }
        }
        if let expectedAppPath {
            let expectedPath = URL(fileURLWithPath: expectedAppPath)
                .standardizedFileURL.resolvingSymlinksInPath().path
            let actualPath = URL(fileURLWithPath: app.path ?? "")
                .standardizedFileURL.resolvingSymlinksInPath().path
            guard actualPath == expectedPath else {
                return .appPathMismatch(expected: expectedPath, actual: actualPath)
            }
        }
        let runtimeVersion = normalizedCompanionVersion(runtime.version ?? "")
        guard runtimeVersion == expected else {
            return .versionMismatch(expected: expected, actual: runtimeVersion)
        }
        if let expectedRuntimeOwner {
            let actualOwner = runtime.listenerOwner?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard actualOwner == expectedRuntimeOwner else {
                return .runtimeOwnerMismatch(
                    expected: expectedRuntimeOwner,
                    actual: actualOwner
                )
            }
        }
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
         .versionMismatch,
         .appMetadataMissing,
         .appBuildMismatch,
         .appPathMismatch,
         .runtimeOwnerMismatch:
        return false
    }
}

func runtimeHealthGatePassed(_ health: RuntimeHealthEvaluation) -> Bool {
    if case .healthy = health {
        return true
    }
    return false
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

private func captureProcessOutput(
    executable: String,
    arguments: [String]
) -> ProcessOutput {
    let process = Process()
    let outputPipe = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = outputPipe
    process.standardError = outputPipe
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

private struct NativeSupportReportSnapshot: Sendable {
    let generatedAt: String
    let setupTitle: String
    let setupDetail: String
    let setupFailed: Bool
    let installationReady: Bool
    let codexBarRepairRequired: Bool
    let macOS: String
    let architecture: String
    let processIdentifier: Int32
    let physicalMemory: UInt64
    let lowPowerMode: Bool
    let appVersion: String
    let appBuild: String
    let appPath: String
    let installedInApplications: Bool
    let localPreviewRuntime: Bool
    let helperPath: String
    let runtimeLabel: String
    let runtimeRegistrationStatus: String
    let codexBarPath: String?
    let supportDirectoryPath: String
    let crashDirectoryPath: String
}

struct PendingNativeUpdate: Codable, Equatable {
    let version: String
    let build: String
    let createdAt: Date
}

func pendingNativeUpdateMatchesBundle(
    _ pending: PendingNativeUpdate,
    shortVersion: String?,
    buildVersion: String?
) -> Bool {
    normalizedCompanionVersion(pending.version)
        == normalizedCompanionVersion(shortVersion ?? "")
        && pending.build.trimmingCharacters(in: .whitespacesAndNewlines)
        == (buildVersion ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}

func pendingNativeUpdateIsExpired(
    _ pending: PendingNativeUpdate,
    now: Date = Date(),
    maximumAge: TimeInterval = pendingNativeUpdateMaximumAge
) -> Bool {
    maximumAge >= 0 && now.timeIntervalSince(pending.createdAt) > maximumAge
}

func pendingNativeUpdateBlocksBundle(
    _ pending: PendingNativeUpdate,
    shortVersion: String?,
    buildVersion: String?,
    now: Date = Date(),
    maximumAge: TimeInterval = pendingNativeUpdateMaximumAge
) -> Bool {
    !pendingNativeUpdateMatchesBundle(
        pending,
        shortVersion: shortVersion,
        buildVersion: buildVersion
    ) && !pendingNativeUpdateIsExpired(
        pending,
        now: now,
        maximumAge: maximumAge
    )
}

enum RuntimePreparationOutcome: Equatable {
    case nativeRuntimeReady
    case legacyRuntimeRestored
    case codexBarRepairRequired
    case keepCurrentPage

    var shouldReloadControlCenter: Bool {
        self == .nativeRuntimeReady
    }
}

func shouldRetryControlCenterNavigation(_ error: Error) -> Bool {
    let error = error as NSError
    return !(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
}

struct InstallationStatus {
    let title: String
    let detail: String
    let failed: Bool
    let retryTitle: String
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var activeNavigation: WKNavigation?
    private let runtimeService = SMAppService.agent(plistName: runtimeLaunchAgentPlistName)
    private var urlRouter = ControlCenterURLRouter()
    private var reloadAttempts = 0
    private var scheduledReload: Task<Void, Never>?
    private var preparationTask: Task<Void, Never>?
    private var closePreparationInFlight = false
    private var allowPreparedWindowClose = false
    private var scheduledCloseFallback: DispatchWorkItem?
    private var installationReady = false
    private var installationStatus: InstallationStatus?
    private var codexBarRepairRequired = false
    private var codexBarAutoRepairAttempted = false
    private var installationStatusTitle = "Starting Control Center"
    private var installationStatusDetail = "Preparing the Mac App."
    private var installationStatusFailed = false
#if canImport(Sparkle)
    private lazy var updaterController = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: self,
        userDriverDelegate: nil
    )
#endif
    private var installationRequired: Bool {
        requiresApplicationInstallation(Bundle.main.bundleURL)
    }
    private var usesLocalPreviewRuntime: Bool {
        Bundle.main.object(
            forInfoDictionaryKey: localPreviewRuntimeInfoKey
        ) as? Bool == true
    }
    private var activeRuntimeLaunchAgentLabel: String {
        usesLocalPreviewRuntime
            ? previewRuntimeLaunchAgentLabel
            : runtimeLaunchAgentLabel
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureMenu()
        guard !installationRequired else {
            presentInstallationRequiredAlert()
            return
        }
#if canImport(Sparkle)
        _ = updaterController
#endif
        presentInstallationStatus(
            title: "Starting Control Center",
            detail: "Checking the Mac App and your last connected VibeTV.",
            failed: false
        )
        startRuntimePreparation()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard !installationRequired else {
            return
        }
        if urls.contains(where: isCheckForUpdatesURL) {
            checkForUpdates()
            return
        }
        if urls.contains(where: isRepairCodexBarURL) {
            beginCodexBarRepair()
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
        if installationReady {
            presentControlCenter()
        } else if let status = installationStatus {
            presentInstallationStatus(
                title: status.title,
                detail: status.detail,
                failed: status.failed,
                retryTitle: status.retryTitle
            )
        } else {
            window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        return true
    }

    private func startRuntimePreparation() {
        guard preparationTask == nil else {
            return
        }
        presentInstallationStatus(
            title: "Starting Control Center",
            detail: "Checking the Mac App and your last connected VibeTV.",
            failed: false
        )
        Task { [weak self] in
            await self?.performLocalNetworkPrivacyPreflight()
        }
        preparationTask = Task { [weak self] in
            guard let self else {
                return
            }
            let outcome = await self.prepareCompanionWithAutomaticCodexBarRepair()
            self.preparationTask = nil
            switch outcome {
            case .nativeRuntimeReady:
                self.codexBarRepairRequired = false
                self.codexBarAutoRepairAttempted = false
                self.installationReady = true
                self.installationStatus = nil
                _ = self.urlRouter.markReady()
                self.presentControlCenter()
            case .legacyRuntimeRestored:
                self.codexBarRepairRequired = false
                self.presentInstallationStatus(
                    title: "Installation needs attention",
                    detail: "The previous VibeTV service was restored. Try again or open the support log.",
                    failed: true
                )
            case .codexBarRepairRequired:
                self.codexBarRepairRequired = true
                self.presentInstallationStatus(
                    title: "CodexBar needs repair",
                    detail: "Repair CodexBar to install and start the verified copy included with VibeTV Control Center.",
                    failed: true,
                    retryTitle: "Repair CodexBar"
                )
            case .keepCurrentPage:
                self.codexBarRepairRequired = false
                self.presentInstallationStatus(
                    title: "Installation could not be verified",
                    detail: "The Mac App, runtime, and local listener did not reach one verified state.",
                    failed: true
                )
            }
        }
    }

    private func prepareCompanionWithAutomaticCodexBarRepair() async -> RuntimePreparationOutcome {
        let outcome = await prepareCompanion()
        guard outcome == .codexBarRepairRequired,
              !codexBarAutoRepairAttempted else {
            return outcome
        }
        codexBarAutoRepairAttempted = true
        guard repairCodexBarInstallation() else {
            return outcome
        }
        return await prepareCompanion()
    }

    @objc private func retryRuntimePreparation() {
        discardMismatchedPendingNativeUpdate()
        if codexBarRepairRequired && !repairCodexBarInstallation() {
            presentInstallationStatus(
                title: "CodexBar repair failed",
                detail: "CodexBar could not be backed up or reinstalled. Open the support log for details.",
                failed: true,
                retryTitle: "Repair CodexBar"
            )
            return
        }
        codexBarRepairRequired = false
        startRuntimePreparation()
    }

    private func beginCodexBarRepair() {
        installationReady = false
        codexBarRepairRequired = true
        activeNavigation = nil
        webView = nil
        presentInstallationStatus(
            title: "Repairing CodexBar…",
            detail: "Backing up an incompatible copy before installing the verified version.",
            failed: false
        )
        retryRuntimePreparation()
    }

    @objc private func openSupportLog() {
        let logURL = applicationSupportURL()
            .appendingPathComponent("logs", isDirectory: true)
        if !NSWorkspace.shared.open(logURL) {
            _ = NSWorkspace.shared.open(applicationSupportURL())
        }
    }

    @objc private func createNativeSupportReport() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = "vibetv-support-report-\(timestampForBackup()).json"
        panel.directoryURL = FileManager.default.urls(
            for: .downloadsDirectory,
            in: .userDomainMask
        ).first

        let save: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK, let url = panel.url, let self else {
                return
            }
            let snapshot = self.nativeSupportReportSnapshot()
            Task { [weak self] in
                let report = await Task.detached(priority: .userInitiated) {
                    Self.nativeSupportReportData(snapshot: snapshot)
                }.value
                guard let self else {
                    return
                }
                guard let report else {
                    self.presentSupportReportError(
                        title: "Support report could not be created",
                        detail: "Try again, or open the support log instead."
                    )
                    return
                }
                do {
                    try report.write(to: url, options: .atomic)
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                } catch {
                    self.presentSupportReportError(
                        title: "Support report could not be saved",
                        detail: (error as NSError).localizedDescription
                    )
                }
            }
        }

        if let window {
            panel.beginSheetModal(for: window, completionHandler: save)
        } else {
            save(panel.runModal())
        }
    }

    private func presentSupportReportError(title: String, detail: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = detail
        alert.runModal()
    }

    private func nativeSupportReportSnapshot() -> NativeSupportReportSnapshot {
        let helperURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers", isDirectory: true)
            .appendingPathComponent("codexbar-display")
        return NativeSupportReportSnapshot(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            setupTitle: installationStatusTitle,
            setupDetail: installationStatusDetail,
            setupFailed: installationStatusFailed,
            installationReady: installationReady,
            codexBarRepairRequired: codexBarRepairRequired,
            macOS: ProcessInfo.processInfo.operatingSystemVersionString,
            architecture: machineArchitecture(),
            processIdentifier: ProcessInfo.processInfo.processIdentifier,
            physicalMemory: ProcessInfo.processInfo.physicalMemory,
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
            appVersion: Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "unknown",
            appBuild: Bundle.main.object(
                forInfoDictionaryKey: "CFBundleVersion"
            ) as? String ?? "unknown",
            appPath: Bundle.main.bundleURL.path,
            installedInApplications: isInstalledApplicationsBundle(Bundle.main.bundleURL),
            localPreviewRuntime: usesLocalPreviewRuntime,
            helperPath: helperURL.path,
            runtimeLabel: activeRuntimeLaunchAgentLabel,
            runtimeRegistrationStatus: runtimeRegistrationStatusDescription(),
            codexBarPath: existingCodexBarApp()?.path,
            supportDirectoryPath: applicationSupportURL().path,
            crashDirectoryPath: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Logs/DiagnosticReports", isDirectory: true)
                .path
        )
    }

    nonisolated private static func nativeSupportReportData(
        snapshot: NativeSupportReportSnapshot
    ) -> Data? {
        let fileManager = FileManager.default
        let helperURL = URL(fileURLWithPath: snapshot.helperPath)
        let appSignature = captureProcessOutput(
            executable: "/usr/bin/codesign",
            arguments: ["--verify", "--deep", "--strict", "--verbose=2", snapshot.appPath]
        )
        let helperSignature = captureProcessOutput(
            executable: "/usr/bin/codesign",
            arguments: ["--verify", "--strict", "--verbose=2", helperURL.path]
        )
        let appGatekeeper = captureProcessOutput(
            executable: "/usr/sbin/spctl",
            arguments: ["--assess", "--type", "execute", "--verbose=4", snapshot.appPath]
        )
        let launchAgent = captureProcessOutput(
            executable: "/bin/launchctl",
            arguments: ["print", launchctlServiceTarget(uid: getuid(), label: snapshot.runtimeLabel)]
        )
        let listener = captureProcessOutput(
            executable: "/usr/sbin/lsof",
            arguments: ["-nP", "-iTCP@127.0.0.1:47832", "-sTCP:LISTEN"]
        )
        let backgroundItems = captureProcessOutput(
            executable: "/usr/bin/sfltool",
            arguments: ["dumpbtm"]
        )
        let companionDiagnostics = captureProcessOutput(
            executable: "/usr/bin/curl",
            arguments: ["--silent", "--show-error", "--max-time", "40", "http://127.0.0.1:47832/v1/diagnostics"]
        )
        let report: [String: Any] = [
            "schemaVersion": 2,
            "generatedAt": snapshot.generatedAt,
            "reportType": "native_installation",
            "setupScreen": [
                "title": snapshot.setupTitle,
                "detail": snapshot.setupDetail,
                "failed": snapshot.setupFailed,
                "installationReady": snapshot.installationReady,
                "codexBarRepairRequired": snapshot.codexBarRepairRequired,
            ],
            "system": [
                "macOS": snapshot.macOS,
                "architecture": snapshot.architecture,
                "processIdentifier": snapshot.processIdentifier,
                "physicalMemory": snapshot.physicalMemory,
                "lowPowerMode": snapshot.lowPowerMode,
            ],
            "app": [
                "version": snapshot.appVersion,
                "build": snapshot.appBuild,
                "path": snapshot.appPath,
                "installedInApplications": snapshot.installedInApplications,
                "signature": processOutputReport(appSignature),
                "gatekeeper": processOutputReport(appGatekeeper),
                "localPreviewRuntime": snapshot.localPreviewRuntime,
            ],
            "runtime": [
                "label": snapshot.runtimeLabel,
                "serviceStatus": snapshot.localPreviewRuntime
                    ? (launchAgent.exitStatus == 0 ? "loaded" : "not loaded")
                    : snapshot.runtimeRegistrationStatus,
                "listenerOwnership": runtimeListenerOwnership(
                    launchAgent: launchAgent
                ),
                "helperExists": fileManager.isExecutableFile(atPath: helperURL.path),
                "helperSignature": processOutputReport(helperSignature),
                "launchAgent": processOutputReport(launchAgent),
                "listener": processOutputReport(listener),
                "backgroundItems": filteredBackgroundItems(
                    backgroundItems.output,
                    runtimeLabel: snapshot.runtimeLabel
                ),
                "recentCrashReports": recentTextFiles(
                    in: URL(fileURLWithPath: snapshot.crashDirectoryPath, isDirectory: true),
                    matching: "codexbar-display-",
                    limit: 3
                ),
                "recentLogs": recentTextFiles(
                    in: URL(fileURLWithPath: snapshot.supportDirectoryPath, isDirectory: true)
                        .appendingPathComponent("logs", isDirectory: true),
                    matching: nil,
                    limit: 6
                ),
            ],
            "codexBar": [
                "installed": snapshot.codexBarPath != nil,
                "path": snapshot.codexBarPath ?? "not found",
            ],
            "controlCenterDiagnostics": decodedJSONOrProcessOutput(companionDiagnostics),
        ]
        return try? JSONSerialization.data(
            withJSONObject: redactReportValue(report),
            options: [.prettyPrinted, .sortedKeys]
        )
    }

    private func runtimeRegistrationStatusDescription() -> String {
        switch runtimeService.status {
        case .enabled:
            return "enabled"
        case .requiresApproval:
            return "requires approval"
        case .notRegistered:
            return "not registered"
        case .notFound:
            return "not found"
        @unknown default:
            return "unknown"
        }
    }

    nonisolated private static func runtimeListenerOwnership(
        launchAgent: ProcessOutput
    ) -> String {
        guard let servicePID = parseLaunchctlServicePID(launchAgent.output),
              launchAgent.exitStatus == 0 else {
            return evaluateRuntimeOwnership(
                launchctlExitStatus: launchAgent.exitStatus,
                launchctlOutput: launchAgent.output,
                lsofExitStatus: nil,
                lsofOutput: ""
            ).description
        }
        let lsof = captureProcessOutput(
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
            launchctlExitStatus: launchAgent.exitStatus,
            launchctlOutput: launchAgent.output,
            lsofExitStatus: lsof.exitStatus,
            lsofOutput: lsof.output
        ).description
    }

    nonisolated private static func recentTextFiles(
        in directory: URL,
        matching prefix: String?,
        limit: Int
    ) -> [[String: Any]] {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        return urls
            .filter { prefix == nil || $0.lastPathComponent.hasPrefix(prefix!) }
            .sorted {
                let left = try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                let right = try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                return (left ?? .distantPast) > (right ?? .distantPast)
            }
            .prefix(limit)
            .map { url in
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return [
                    "name": url.lastPathComponent,
                    "modifiedAt": values?.contentModificationDate.map { ISO8601DateFormatter().string(from: $0) } ?? "unknown",
                    "bytes": values?.fileSize ?? 0,
                    "tail": tailText(at: url, maximumBytes: 64 * 1024),
                ]
            }
    }

    nonisolated private static func tailText(at url: URL, maximumBytes: UInt64) -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return "unavailable"
        }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        try? handle.seek(toOffset: size > maximumBytes ? size - maximumBytes : 0)
        let data = (try? handle.readToEnd()) ?? Data()
        return String(data: data, encoding: .utf8) ?? "unreadable"
    }

    nonisolated private static func processOutputReport(_ result: ProcessOutput) -> [String: Any] {
        [
            "exitStatus": result.exitStatus.map(Int.init) ?? -1,
            "output": boundedText(result.output, maximumCharacters: 64 * 1024),
        ]
    }

    nonisolated private static func decodedJSONOrProcessOutput(_ result: ProcessOutput) -> Any {
        guard result.exitStatus == 0,
              let data = result.output.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) else {
            return processOutputReport(result)
        }
        return value
    }

    nonisolated private static func filteredBackgroundItems(
        _ output: String,
        runtimeLabel: String
    ) -> String {
        let blocks = output.components(separatedBy: "\n\n")
        let relevant = blocks.filter { block in
            let value = block.lowercased()
            return value.contains("shop.vibetv.control-center")
                || value.contains("codexbar-display")
                || value.contains(runtimeLabel.lowercased())
        }
        return boundedText(relevant.joined(separator: "\n\n"), maximumCharacters: 64 * 1024)
    }

    nonisolated private static func boundedText(_ value: String, maximumCharacters: Int) -> String {
        guard value.count > maximumCharacters else {
            return value
        }
        return "…[truncated]\n" + String(value.suffix(maximumCharacters))
    }

    nonisolated static func redactReportValue(_ value: Any, key: String? = nil) -> Any {
        if let key, isSensitiveReportKey(key), !(value is Bool) {
            return "[redacted]"
        }
        if let dictionary = value as? [String: Any] {
            return Dictionary(uniqueKeysWithValues: dictionary.map { entry in
                (entry.key, redactReportValue(entry.value, key: entry.key))
            })
        }
        if let array = value as? [Any] {
            return array.map { redactReportValue($0) }
        }
        if let text = value as? String {
            return redactSensitiveReportText(text)
        }
        return value
    }

    nonisolated private static func isSensitiveReportKey(_ key: String) -> Bool {
        let normalized = key
            .replacingOccurrences(
                of: "([a-z0-9])([A-Z])",
                with: "$1_$2",
                options: .regularExpression
            )
            .replacingOccurrences(of: "-", with: "_")
            .lowercased()
        if normalized == "token" || normalized == "api_key" {
            return true
        }
        return normalized.range(
            of: "(^|_)(authorization|cookie|password|secret|access_token|refresh_token|device_token|pairing_token)(_|$)",
            options: .regularExpression
        ) != nil
    }

    nonisolated private static func redactSensitiveReportText(_ value: String) -> String {
        let patterns = [
            #"(?i)([a-z][a-z0-9+.-]*://[^/\s:@]+:)[^@/\s]+@"#,
            #"(?i)(\b(?:bearer|basic)\s+)[^\s,;}]+"#,
            #"(?i)([\"']?(?:[a-z0-9.]+[_-])*(?:authorization|cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|device[_-]?token|pairing[_-]?token|token)[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)"#,
            #"(?i)([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)=)[^&#\s]*"#,
        ]
        return patterns.reduce(value) { current, pattern in
            guard let expression = try? NSRegularExpression(pattern: pattern) else {
                return current
            }
            let range = NSRange(current.startIndex..<current.endIndex, in: current)
            return expression.stringByReplacingMatches(
                in: current,
                range: range,
                withTemplate: "$1[redacted]"
            )
        }
    }

    private func machineArchitecture() -> String {
#if arch(arm64)
        return "arm64"
#elseif arch(x86_64)
        return "x86_64"
#else
        return "unknown"
#endif
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
        appMenu.addItem(
            NSMenuItem(
                title: "Check for Updates…",
                action: #selector(checkForUpdates),
                keyEquivalent: ""
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

    @objc private func checkForUpdates() {
        guard !installationRequired else {
            presentInstallationRequiredAlert()
            return
        }
#if canImport(Sparkle)
        updaterController.checkForUpdates(nil)
#else
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Native updater is unavailable"
        alert.informativeText = "Install the latest signed VibeTV Control Center from app.vibetv.shop."
        alert.runModal()
#endif
    }

    private func restartControlCenter() {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.addsToRecentItems = false
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(
            at: Bundle.main.bundleURL,
            configuration: configuration
        ) { application, error in
            DispatchQueue.main.async {
                guard application != nil, error == nil else {
                    let detail = error?.localizedDescription
                        ?? "new app instance was not created"
                    NSLog(
                        "VibeTV Control Center could not restart: \(detail)"
                    )
                    return
                }
                NSApp.terminate(nil)
            }
        }
    }

    private func beginRuntimeRepair() {
        guard preparationTask == nil else {
            return
        }
        preparationTask = Task { [weak self] in
            guard let self else {
                return
            }
            let outcome = await self.prepareCompanionWithAutomaticCodexBarRepair()
            self.preparationTask = nil
            guard outcome == .nativeRuntimeReady else {
                self.notifyRuntimeRepairResult(success: false)
                return
            }
            self.codexBarRepairRequired = false
            self.codexBarAutoRepairAttempted = false
            self.installationReady = true
            self.installationStatus = nil
            self.notifyRuntimeRepairResult(success: true)
            self.loadControlCenter(cachePolicy: .reloadIgnoringLocalCacheData)
        }
    }

    private func notifyRuntimeRepairResult(success: Bool) {
        let value = success ? "true" : "false"
        let script = "window.dispatchEvent(new CustomEvent('vibetv:runtime-repair-result', { detail: { success: \(value) } })); true"
        webView?.evaluateJavaScript(script) { _, error in
            if let error {
                NSLog(
                    "VibeTV Control Center could not report runtime repair result: \(error.localizedDescription)"
                )
            }
        }
    }

    private func presentControlCenter() {
        guard !installationRequired, installationReady else {
            return
        }
        if webView == nil {
            createWindow()
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func presentInstallationRequiredAlert() {
        installationStatusTitle = "Move VibeTV Control Center to Applications"
        installationStatusDetail = "The app is not running from Applications."
        installationStatusFailed = true
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Move VibeTV Control Center to Applications"
        alert.informativeText = """
            In Finder, drag VibeTV Control Center into Applications, then open it there again.

            If the app already appears in Applications, move it to another folder and then back to Applications before opening it again.
            """
        alert.addButton(withTitle: "Open Applications")
        alert.addButton(withTitle: "Quit")
        alert.addButton(withTitle: "Create report")

        var response = alert.runModal()
        while response == .alertThirdButtonReturn {
            createNativeSupportReport()
            response = alert.runModal()
        }
        if response == .alertFirstButtonReturn {
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
        webView.uiDelegate = self

        let window = window ?? makeMainWindow()
        window.title = "VibeTV Control Center"
        window.contentView = webView

        self.window = window
        self.webView = webView
        closePreparationInFlight = false
        allowPreparedWindowClose = false
        scheduledCloseFallback?.cancel()
        scheduledCloseFallback = nil
        // The local server can keep the same URL across app updates. Always
        // fetch the freshly bundled UI instead of reviving an older cached
        // Control Center whose device-selection logic may be stale.
        loadControlCenter(cachePolicy: .reloadIgnoringLocalCacheData)
    }

    private func makeMainWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "VibeTV Control Center"
        window.center()
        window.delegate = self
        window.isReleasedWhenClosed = false
        return window
    }

    private func presentInstallationStatus(
        title: String,
        detail: String,
        failed: Bool,
        retryTitle: String = "Try again"
    ) {
        installationStatus = InstallationStatus(
            title: title,
            detail: detail,
            failed: failed,
            retryTitle: retryTitle
        )
        installationStatusTitle = title
        installationStatusDetail = detail
        installationStatusFailed = failed
        let window = window ?? makeMainWindow()
        let container = NSView()
        // This screen intentionally uses a fixed light surface and dark text.
        // Keep inherited AppKit controls (spinner and buttons) in the matching
        // appearance so they do not render white-on-white in macOS Dark Mode.
        container.appearance = NSAppearance(named: .aqua)
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(
            calibratedRed: 0.976,
            green: 0.976,
            blue: 0.976,
            alpha: 1
        ).cgColor

        let brand = NSTextField(labelWithString: "VIBETV")
        brand.font = .systemFont(ofSize: 40, weight: .black)
        brand.textColor = NSColor(calibratedWhite: 0.1, alpha: 1)
        brand.alignment = .center

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = .systemFont(ofSize: 28, weight: .bold)
        titleLabel.textColor = NSColor(calibratedWhite: 0.1, alpha: 1)
        titleLabel.alignment = .center
        titleLabel.maximumNumberOfLines = 2
        titleLabel.lineBreakMode = .byWordWrapping
        titleLabel.setAccessibilityRole(.staticText)

        let detailLabel = NSTextField(wrappingLabelWithString: detail)
        detailLabel.font = .systemFont(ofSize: 16, weight: .regular)
        detailLabel.textColor = NSColor(calibratedWhite: 0.28, alpha: 1)
        detailLabel.alignment = .center
        detailLabel.maximumNumberOfLines = 3

        let progress = NSProgressIndicator()
        progress.style = .spinning
        progress.controlSize = .large
        if failed {
            progress.isHidden = true
        } else {
            progress.startAnimation(nil)
        }

        let retry = NSButton(
            title: retryTitle,
            target: self,
            action: #selector(retryRuntimePreparation)
        )
        retry.bezelStyle = .rounded
        retry.keyEquivalent = "\r"
        retry.isHidden = !failed

        let support = NSButton(
            title: "Create report",
            target: self,
            action: #selector(createNativeSupportReport)
        )
        support.bezelStyle = .rounded
        support.isHidden = false

        let supportLog = NSButton(
            title: "Open support log",
            target: self,
            action: #selector(openSupportLog)
        )
        supportLog.bezelStyle = .rounded
        supportLog.isHidden = !failed

        let actions = NSStackView(views: [retry, support, supportLog])
        actions.orientation = .horizontal
        actions.alignment = .centerY
        actions.spacing = 12

        let stack = NSStackView(views: [brand, titleLabel, detailLabel, progress, actions])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
            titleLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 620),
            detailLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 620),
        ])

        window.contentView = container
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    func windowWillClose(_ notification: Notification) {
        guard let closingWindow = notification.object as? NSWindow,
              closingWindow === window else {
            return
        }

        scheduledReload?.cancel()
        scheduledReload = nil
        closePreparationInFlight = false
        allowPreparedWindowClose = false
        scheduledCloseFallback?.cancel()
        scheduledCloseFallback = nil
        activeNavigation = nil
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        closingWindow.delegate = nil
        closingWindow.contentView = nil
        webView = nil
        window = nil
    }

    func windowShouldClose(_ closingWindow: NSWindow) -> Bool {
        guard closingWindow === window, let webView else {
            return true
        }
        if allowPreparedWindowClose {
            allowPreparedWindowClose = false
            return true
        }
        if closePreparationInFlight {
            return false
        }

        closePreparationInFlight = true
        let fallback = DispatchWorkItem { [weak self, weak closingWindow] in
            guard let self, let closingWindow else {
                return
            }
            NSLog("VibeTV Control Center timed out flushing browser state before closing")
            self.finishPreparedWindowClose(closingWindow)
        }
        scheduledCloseFallback = fallback
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: fallback)
        let script = "window.dispatchEvent(new Event('vibetv:native-window-will-close')); true"
        webView.evaluateJavaScript(script) { [weak self, weak closingWindow] _, error in
            guard let self, let closingWindow, closingWindow === self.window else {
                return
            }
            self.scheduledCloseFallback?.cancel()
            self.scheduledCloseFallback = nil
            if let error {
                NSLog("VibeTV Control Center could not flush browser state before closing: \(error.localizedDescription)")
            }
            self.finishPreparedWindowClose(closingWindow)
        }
        return false
    }

    private func finishPreparedWindowClose(_ closingWindow: NSWindow) {
        guard closingWindow === window, closePreparationInFlight else {
            return
        }
        scheduledCloseFallback?.cancel()
        scheduledCloseFallback = nil
        closePreparationInFlight = false
        allowPreparedWindowClose = true
        closingWindow.performClose(nil)
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

    private func codexBarCLIURL(in appURL: URL) -> URL? {
        let cliURL = appURL
            .appendingPathComponent("Contents/Helpers", isDirectory: true)
            .appendingPathComponent("CodexBarCLI")
        return FileManager.default.isExecutableFile(atPath: cliURL.path)
            ? cliURL
            : nil
    }

    private func validatedCodexBarApp(
        at appURL: URL,
        requirePinnedVersion: Bool = false
    ) -> URL? {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: appURL.path),
              let bundle = Bundle(url: appURL),
              bundle.bundleIdentifier == codexBarBundleIdentifier,
              let version = bundle.object(
                  forInfoDictionaryKey: "CFBundleShortVersionString"
              ) as? String,
              (requirePinnedVersion
                  ? version == codexBarPinnedVersion
                  : isCompatibleCodexBarVersion(version)),
              codexBarCLIURL(in: appURL) != nil else {
            return nil
        }

        guard let signature = runCodexBarCommand(
            executableURL: URL(fileURLWithPath: "/usr/bin/codesign"),
            arguments: ["--verify", "--deep", "--strict", "--verbose=2", appURL.path]
        ), signature.exitCode == 0 else {
            NSLog("VibeTV Control Center rejected CodexBar with an invalid signature: \(appURL.path)")
            return nil
        }
        guard let details = runCodexBarCommand(
            executableURL: URL(fileURLWithPath: "/usr/bin/codesign"),
            arguments: ["--display", "--verbose=4", appURL.path]
        ), details.exitCode == 0,
              details.output
                .split(separator: "\n")
                .contains("TeamIdentifier=\(codexBarPinnedTeamIdentifier)") else {
            NSLog("VibeTV Control Center rejected CodexBar from an unexpected signing team: \(appURL.path)")
            return nil
        }
        guard let assessment = runCodexBarCommand(
            executableURL: URL(fileURLWithPath: "/usr/sbin/spctl"),
            arguments: ["--assess", "--type", "execute", "--verbose=4", appURL.path]
        ), assessment.exitCode == 0 else {
            NSLog("VibeTV Control Center rejected CodexBar because Gatekeeper did not accept it: \(appURL.path)")
            return nil
        }
        return appURL
    }

    private func existingCodexBarApp() -> URL? {
        let running = NSWorkspace.shared.runningApplications.compactMap(\.bundleURL)
        let installed = codexBarInstalledAppCandidates(
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser
        )
        var seen = Set<String>()
        let candidates = (running + installed).filter { candidate in
            seen.insert(candidate.standardizedFileURL.path).inserted
        }
        for requirePinnedVersion in [true, false] {
            if let candidate = candidates.first(where: {
                validatedCodexBarApp(
                    at: $0,
                    requirePinnedVersion: requirePinnedVersion
                ) != nil
            }) {
                return candidate
            }
        }
        return nil
    }

    private func installBundledCodexBarApp() -> URL? {
        let fileManager = FileManager.default
        let resourcesURL = Bundle.main.resourceURL?
            .appendingPathComponent("CodexBar", isDirectory: true)
        guard let archiveURL = resourcesURL?.appendingPathComponent(codexBarArchiveName),
              fileManager.fileExists(atPath: archiveURL.path),
              sha256Hex(of: archiveURL) == codexBarArchiveSHA256 else {
            NSLog("VibeTV Control Center bundled CodexBar archive is missing or failed its checksum")
            return nil
        }

        let applicationsURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications", isDirectory: true)
        let targetURL = applicationsURL
            .appendingPathComponent("CodexBar.app", isDirectory: true)
        do {
            try fileManager.createDirectory(
                at: applicationsURL,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            NSLog("VibeTV Control Center could not create ~/Applications for CodexBar: \(error)")
            return nil
        }

        // Never replace another CodexBar installation. A compatible app at
        // this location was already selected above; any remaining item needs
        // an explicit user-controlled update instead of an implicit overwrite.
        guard !fileManager.fileExists(atPath: targetURL.path) else {
            NSLog("VibeTV Control Center kept the existing ~/Applications/CodexBar.app unchanged")
            return nil
        }

        let stagingURL = applicationsURL.appendingPathComponent(
            ".vibetv-codexbar-install-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? fileManager.removeItem(at: stagingURL) }
        do {
            try fileManager.createDirectory(
                at: stagingURL,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            NSLog("VibeTV Control Center could not create CodexBar staging directory: \(error)")
            return nil
        }

        guard let extraction = runCodexBarCommand(
            executableURL: URL(fileURLWithPath: "/usr/bin/ditto"),
            arguments: ["-x", "-k", archiveURL.path, stagingURL.path]
        ), extraction.exitCode == 0 else {
            NSLog("VibeTV Control Center could not extract bundled CodexBar")
            return nil
        }
        let stagedAppURL = stagingURL
            .appendingPathComponent("CodexBar.app", isDirectory: true)
        guard validatedCodexBarApp(
            at: stagedAppURL,
            requirePinnedVersion: true
        ) != nil else {
            NSLog("VibeTV Control Center rejected the extracted CodexBar app")
            return nil
        }

        do {
            // stagingURL and targetURL share the same filesystem, so this is
            // an atomic publish after every identity check has passed.
            try fileManager.moveItem(at: stagedAppURL, to: targetURL)
        } catch {
            NSLog("VibeTV Control Center could not publish CodexBar atomically: \(error)")
            return nil
        }
        return validatedCodexBarApp(at: targetURL, requirePinnedVersion: true)
    }

    private func repairCodexBarInstallation() -> Bool {
        let fileManager = FileManager.default
        let targetURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications", isDirectory: true)
            .appendingPathComponent("CodexBar.app", isDirectory: true)
        if validatedCodexBarApp(
            at: targetURL,
            requirePinnedVersion: true
        ) != nil {
            return true
        }
        if fileManager.fileExists(atPath: targetURL.path) {
            let backupURL = applicationSupportURL()
                .appendingPathComponent("codexbar-backups", isDirectory: true)
                .appendingPathComponent(
                    "\(timestampForBackup())-\(UUID().uuidString.prefix(8))",
                    isDirectory: true
                )
                .appendingPathComponent("CodexBar.app", isDirectory: true)
            do {
                try fileManager.createDirectory(
                    at: backupURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700]
                )
                try fileManager.moveItem(at: targetURL, to: backupURL)
                NSLog("VibeTV Control Center backed up incompatible CodexBar at \(backupURL.path)")
            } catch {
                NSLog("VibeTV Control Center could not back up incompatible CodexBar: \(error)")
                return false
            }
        }
        guard let installed = installBundledCodexBarApp() else {
            return false
        }
        NSLog("VibeTV Control Center repaired CodexBar at \(installed.path)")
        return true
    }

    private func preparedCodexBarConfigURL() -> URL? {
        let fileManager = FileManager.default
        let homeURL = fileManager.homeDirectoryForCurrentUser
        let existingCandidates = [
            homeURL
                .appendingPathComponent(".config/codexbar", isDirectory: true)
                .appendingPathComponent("config.json"),
            homeURL
                .appendingPathComponent(".codexbar", isDirectory: true)
                .appendingPathComponent("config.json"),
        ]
        for candidate in existingCandidates
        where fileManager.fileExists(atPath: candidate.path) {
            if fileManager.isWritableFile(atPath: candidate.path) {
                return candidate
            }
            NSLog("VibeTV Control Center kept an existing non-writable CodexBar config unchanged: \(candidate.path)")
            return nil
        }

        let configDirectoryURL = homeURL
            .appendingPathComponent(".codexbar", isDirectory: true)
        let configURL = configDirectoryURL.appendingPathComponent("config.json")
        do {
            try fileManager.createDirectory(
                at: configDirectoryURL,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try fileManager.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: configDirectoryURL.path
            )
            try defaultCodexBarConfigData().write(to: configURL, options: .atomic)
            try fileManager.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: configURL.path
            )
            return configURL
        } catch {
            NSLog("VibeTV Control Center could not prepare its private CodexBar config: \(error)")
            return nil
        }
    }

    private func launchCodexBar(_ appURL: URL) async -> Bool {
        if NSWorkspace.shared.runningApplications.contains(where: {
            $0.bundleIdentifier == codexBarBundleIdentifier
                && $0.bundleURL?.standardizedFileURL == appURL.standardizedFileURL
        }) {
            return true
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        if let configURL = preparedCodexBarConfigURL() {
            var environment = ProcessInfo.processInfo.environment
            environment["CODEXBAR_CONFIG"] = configURL.path
            configuration.environment = environment
        }
        return await withCheckedContinuation { continuation in
            NSWorkspace.shared.openApplication(
                at: appURL,
                configuration: configuration
            ) { application, error in
                if let error {
                    NSLog("VibeTV Control Center could not launch CodexBar: \(error)")
                }
                let launchedExpectedApp = application?.bundleURL?.standardizedFileURL
                    == appURL.standardizedFileURL
                if application != nil && !launchedExpectedApp {
                    NSLog("VibeTV Control Center opened a different CodexBar copy than \(appURL.path)")
                }
                continuation.resume(returning: launchedExpectedApp && error == nil)
            }
        }
    }

    private func bootstrapCodexBar() async -> Bool {
        if let existing = existingCodexBarApp() {
            return await launchCodexBar(existing)
        }
        guard let installed = installBundledCodexBarApp() else {
            NSLog("VibeTV Control Center could not provision CodexBar; native setup remains blocked")
            return false
        }
        NSLog("VibeTV Control Center installed verified CodexBar \(codexBarPinnedVersion) at \(installed.path)")
        return await launchCodexBar(installed)
    }

    private func prepareCompanion() async -> RuntimePreparationOutcome {
        guard isInstalledApplicationsBundle(Bundle.main.bundleURL) else {
            NSLog(
                "VibeTV Control Center runtime migration skipped: move the app to /Applications first"
            )
            return .keepCurrentPage
        }
        if let pending = loadPendingNativeUpdate() {
            let shortVersion = Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String
            let buildVersion = Bundle.main.object(
                forInfoDictionaryKey: "CFBundleVersion"
            ) as? String
            if pendingNativeUpdateBlocksBundle(
                pending,
                shortVersion: shortVersion,
                buildVersion: buildVersion
            ) {
                NSLog(
                    "VibeTV Control Center pending update mismatch expected=\(pending.version)+\(pending.build); Try again can discard the failed handoff"
                )
                return .keepCurrentPage
            }
            if !pendingNativeUpdateMatchesBundle(
                pending,
                shortVersion: shortVersion,
                buildVersion: buildVersion
            ) {
                NSLog(
                    "VibeTV Control Center discarded expired pending update expected=\(pending.version)+\(pending.build)"
                )
                clearPendingNativeUpdate()
            }
        }
        guard bundledRuntimeResourcesAreValid() else {
            NSLog("VibeTV Control Center app-managed runtime resources are missing")
            return .keepCurrentPage
        }

        guard await bootstrapCodexBar() else {
            return .codexBarRepairRequired
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
        if hasLoadedLegacyWriter, bundledRuntimeServiceIsEnabled() {
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
                if bundledRuntimeServiceIsEnabled() {
                    restored = await rollbackToLegacyAgents(legacyStates, reason: reason)
                } else {
                    restored = restoreLegacyAgents(legacyStates, reason: reason)
                }
                return restored ? .legacyRuntimeRestored : .keepCurrentPage
            }
            return .keepCurrentPage
        }

        // Detect a failed first runtime launch quickly, then use the existing
        // bounded unregister/register recovery. The recovery attempt still
        // receives the full health timeout below.
        var health = await waitForHealthyRuntime(
            expectedVersion: expectedVersion,
            timeout: runtimeInitialHealthTimeout
        )
        if shouldRetryRuntimeRegistration(
            after: health,
            serviceEnabled: bundledRuntimeServiceIsEnabled()
        ) {
            NSLog(
                "VibeTV Control Center runtime did not become reachable; refreshing its Service Management registration once: \(health)"
            )
            if await unregisterBundledRuntimeService(), registerBundledRuntimeService() {
                health = await waitForHealthyRuntime(expectedVersion: expectedVersion)
            }
        }
        // A healthy result already proves that the expected Companion version
        // owns the listener through this launchd label. Service Management can
        // briefly report a stale non-enabled status after an app update or a
        // bounded re-registration. Do not let that weaker snapshot tear down a
        // runtime whose identity, version, and listener ownership were proven.
        guard runtimeHealthGatePassed(health) else {
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
        clearPendingNativeUpdate()

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

    private func performLocalNetworkPrivacyPreflight() async {
        guard let request = makeLocalNetworkPrivacyProbeRequest() else {
            NSLog("VibeTV Control Center local-network privacy preflight URL is invalid")
            return
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = localNetworkPrivacyProbeTimeout
        configuration.timeoutIntervalForResource = localNetworkPrivacyProbeTimeout
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        do {
            _ = try await session.data(for: request)
            NSLog("VibeTV Control Center local-network privacy preflight completed")
        } catch {
            // This read-only probe only lets macOS resolve Local Network
            // privacy while the foreground app is visible. Setup handles
            // discovery and device availability afterward.
            NSLog(
                "VibeTV Control Center local-network privacy preflight finished without a device response: \((error as NSError).localizedDescription)"
            )
        }
    }

    private func ensureBundledRuntimeServiceRegistered() async -> Bool {
        if usesLocalPreviewRuntime {
            // An ad-hoc preview cannot satisfy the Developer ID launch
            // constraint retained by SMAppService from a production install.
            // Isolate previews behind their own user LaunchAgent instead.
            _ = launchctlExitStatus([
                "bootout",
                launchctlServiceTarget(
                    uid: getuid(),
                    label: runtimeLaunchAgentLabel
                ),
            ])
            guard await unregisterLocalPreviewRuntimeService() else {
                return false
            }
            return registerLocalPreviewRuntimeService()
        }
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
        if usesLocalPreviewRuntime {
            return registerLocalPreviewRuntimeService()
        }
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
        if usesLocalPreviewRuntime {
            return await unregisterLocalPreviewRuntimeService()
        }
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

    private func bundledRuntimeServiceIsEnabled() -> Bool {
        if usesLocalPreviewRuntime {
            return legacyServiceIsLoaded(label: previewRuntimeLaunchAgentLabel)
        }
        return runtimeService.status == .enabled
    }

    private func registerLocalPreviewRuntimeService() -> Bool {
        let fileManager = FileManager.default
        let helperURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers", isDirectory: true)
            .appendingPathComponent("codexbar-display")
        guard fileManager.isExecutableFile(atPath: helperURL.path) else {
            NSLog("VibeTV Control Center preview runtime helper is missing")
            return false
        }

        let plistURL = applicationSupportURL()
            .appendingPathComponent(localPreviewRuntimePlistName)
        let environment = [
            "CODEXBAR_DISPLAY_LAST_GOOD_MAX_AGE": "168h",
            "CODEXBAR_DISPLAY_STREAM_LAUNCH_AGENT_LABEL":
                previewRuntimeLaunchAgentLabel,
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "VIBETV_DISABLE_MAC_APP_SELF_UPDATE": "1",
            "VIBETV_MAC_APP_BUILD": Bundle.main.object(
                forInfoDictionaryKey: "CFBundleVersion"
            ) as? String ?? "",
            "VIBETV_MAC_APP_VERSION": Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "",
        ]
        let plist: [String: Any] = [
            "Label": previewRuntimeLaunchAgentLabel,
            "Program": helperURL.path,
            "ProgramArguments": [
                helperURL.path,
                "daemon",
                "--transport",
                "wifi",
                "--interval",
                "30s",
                "--api-addr",
                "127.0.0.1:47832",
                "--api-dev-origin",
                "http://127.0.0.1:47832",
            ],
            "EnvironmentVariables": environment,
            "RunAtLoad": true,
            "KeepAlive": true,
            "ProcessType": "Background",
            "ThrottleInterval": 10,
        ]

        do {
            try fileManager.createDirectory(
                at: applicationSupportURL(),
                withIntermediateDirectories: true
            )
            let data = try PropertyListSerialization.data(
                fromPropertyList: plist,
                format: .xml,
                options: 0
            )
            try data.write(to: plistURL, options: .atomic)
        } catch {
            NSLog(
                "VibeTV Control Center could not write its preview runtime plist: \(error)"
            )
            return false
        }

        let status = launchctlExitStatus([
            "bootstrap",
            "gui/\(getuid())",
            plistURL.path,
        ])
        guard status == 0 else {
            let exitDescription = status.map(String.init) ?? "unknown"
            NSLog(
                "VibeTV Control Center could not bootstrap its local preview runtime: exit=\(exitDescription)"
            )
            return false
        }
        return legacyServiceIsLoaded(label: previewRuntimeLaunchAgentLabel)
    }

    private func unregisterLocalPreviewRuntimeService() async -> Bool {
        let service = launchctlServiceTarget(
            uid: getuid(),
            label: previewRuntimeLaunchAgentLabel
        )
        _ = launchctlExitStatus(["bootout", service])
        guard !legacyServiceIsLoaded(
            label: previewRuntimeLaunchAgentLabel
        ) else {
            NSLog("VibeTV Control Center could not stop its local preview runtime")
            return false
        }
        try? await Task<Never, Never>.sleep(for: .milliseconds(250))
        return true
    }

    private func waitForHealthyRuntime(
        expectedVersion: String,
        timeout: TimeInterval = runtimeHealthTimeout
    ) async -> RuntimeHealthEvaluation {
        guard let statusURL = URL(string: runtimeHealthURLString) else {
            return .requestFailed("invalid local status URL")
        }

        let deadline = Date().addingTimeInterval(timeout)
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
                    expectedVersion: expectedVersion,
                    expectedAppVersion: Bundle.main.object(
                        forInfoDictionaryKey: "CFBundleShortVersionString"
                    ) as? String,
                    expectedBuild: Bundle.main.object(
                        forInfoDictionaryKey: "CFBundleVersion"
                    ) as? String,
                    expectedAppPath: Bundle.main.bundleURL.path,
                    expectedRuntimeOwner: activeRuntimeLaunchAgentLabel
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
                "gui/\(getuid())/\(activeRuntimeLaunchAgentLabel)",
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
        captureProcessOutput(executable: executable, arguments: arguments)
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

    private func pendingNativeUpdateURL() -> URL {
        applicationSupportURL().appendingPathComponent(pendingNativeUpdateFileName)
    }

    private func loadPendingNativeUpdate() -> PendingNativeUpdate? {
        guard let data = try? Data(contentsOf: pendingNativeUpdateURL()) else {
            return nil
        }
        return try? JSONDecoder().decode(PendingNativeUpdate.self, from: data)
    }

    private func savePendingNativeUpdate(version: String, build: String) {
        let pending = PendingNativeUpdate(
            version: version,
            build: build,
            createdAt: Date()
        )
        do {
            try FileManager.default.createDirectory(
                at: applicationSupportURL(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(pending)
            try data.write(to: pendingNativeUpdateURL(), options: .atomic)
        } catch {
            NSLog("VibeTV Control Center could not save pending update verification: \(error)")
        }
    }

    private func clearPendingNativeUpdate() {
        let url = pendingNativeUpdateURL()
        guard FileManager.default.fileExists(atPath: url.path) else {
            return
        }
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            NSLog("VibeTV Control Center could not clear pending update verification: \(error)")
        }
    }

    private func discardMismatchedPendingNativeUpdate() {
        guard let pending = loadPendingNativeUpdate(),
              !pendingNativeUpdateMatchesBundle(
                  pending,
                  shortVersion: Bundle.main.object(
                      forInfoDictionaryKey: "CFBundleShortVersionString"
                  ) as? String,
                  buildVersion: Bundle.main.object(
                      forInfoDictionaryKey: "CFBundleVersion"
                  ) as? String
              ) else {
            return
        }
        NSLog(
            "VibeTV Control Center user discarded failed pending update expected=\(pending.version)+\(pending.build)"
        )
        clearPendingNativeUpdate()
    }

#if canImport(Sparkle)
    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        savePendingNativeUpdate(
            version: item.displayVersionString,
            build: item.versionString
        )
    }
#endif

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
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if let action = nativeControlCenterAction(for: url) {
            decisionHandler(.cancel)
            switch action {
            case .restartControlCenter:
                restartControlCenter()
            case .repairRuntime:
                beginRuntimeRepair()
            case .checkForUpdates:
                checkForUpdates()
            case .repairCodexBar:
                beginCodexBarRepair()
            }
            return
        }

        guard navigationAction.navigationType == .linkActivated else {
            decisionHandler(.allow)
            return
        }

        guard isApprovedDMGDownloadURL(url) else {
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
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection

        let finish: (NSApplication.ModalResponse) -> Void = { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
        if let window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            panel.begin(completionHandler: finish)
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

#if canImport(Sparkle)
extension AppDelegate: SPUUpdaterDelegate {}
#endif

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
