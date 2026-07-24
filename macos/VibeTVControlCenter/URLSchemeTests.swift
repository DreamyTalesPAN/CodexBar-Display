#if VIBETV_CONTROL_CENTER_TESTING
import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("error: \(message)\n".utf8))
        exit(1)
    }
}

func runURLSchemeTests() {
    let fallbackEndpoint = RuntimeEndpoint(
        origin: "http://127.0.0.1:54321",
        pid: 83979
    )
    require(
        validatedRuntimeEndpointOrigin(fallbackEndpoint)?.port == 54321,
        "a private loopback fallback endpoint must be accepted"
    )
    for invalid in [
        RuntimeEndpoint(origin: "http://0.0.0.0:54321", pid: 83979),
        RuntimeEndpoint(origin: "https://127.0.0.1:54321", pid: 83979),
        RuntimeEndpoint(origin: "http://127.0.0.1:54321/path", pid: 83979),
        RuntimeEndpoint(origin: "http://127.0.0.1:54321", pid: 0),
    ] {
        require(
            validatedRuntimeEndpointOrigin(invalid) == nil,
            "runtime endpoint discovery must reject non-private or malformed endpoints"
        )
    }
    require(
        parseLsofListenerProcesses(
            """
            p83979
            cnode
            p91234
            cpython3
            """
        ) == [
            PortListenerProcess(pid: 83979, name: "node"),
            PortListenerProcess(pid: 91234, name: "python3"),
        ],
        "port diagnostics must preserve process names and pids"
    )
    require(
        portConflictDetail(
            process: PortListenerProcess(pid: 83979, name: "node"),
            port: 47832
        ) == "“node” (PID 83979) is using VibeTV’s local port 47832. Quit the app or stop the process, then click Try again.",
        "the native failure screen must identify the blocking process and pid"
    )
    let repairStatus = InstallationStatus(
        title: "CodexBar needs repair",
        detail: "Repair CodexBar before continuing.",
        failed: true,
        retryTitle: "Repair CodexBar",
        kind: .standard
    )
    require(
        repairStatus.retryTitle == "Repair CodexBar",
        "native installation status must preserve its repair CTA across window reopening"
    )
    let approvalStatus = InstallationFailure.backgroundApproval.installationStatus
    require(
        approvalStatus.title == "Allow VibeTV to run in the background"
            && approvalStatus.detail
                == "VibeTV needs permission to keep its local service running."
            && approvalStatus.retryTitle == "Try again"
            && approvalStatus.kind == .backgroundApproval,
        "native installation status must preserve background approval across window reopening"
    )
    let serviceStatus = InstallationFailure.serviceStart.installationStatus
    require(
        serviceStatus.title == "VibeTV’s background service couldn’t start"
            && serviceStatus.detail
                == "Restart VibeTV’s local service to continue."
            && serviceStatus.retryTitle == "Restart service"
            && serviceStatus.kind == .serviceRestart,
        "service startup failures must offer the focused restart recovery"
    )
    let updateStatus = InstallationFailure.updateMismatch.installationStatus
    require(
        updateStatus.title == "VibeTV update didn’t finish"
            && updateStatus.detail
                == "The app and its background service are on different versions."
            && updateStatus.retryTitle == "Restart VibeTV"
            && updateStatus.kind == .updateMismatch,
        "version mismatches must explain the interrupted update"
    )
    let incompleteStatus = InstallationFailure.applicationIncomplete.installationStatus
    require(
        incompleteStatus.title == "VibeTV Control Center is incomplete"
            && incompleteStatus.detail
                == "Required application files are missing or damaged."
            && incompleteStatus.retryTitle == "Download VibeTV again"
            && incompleteStatus.kind == .applicationIncomplete,
        "missing app resources must direct the customer to a fresh download"
    )
    let legacyStatus = InstallationFailure.legacyRepair.installationStatus
    require(
        legacyStatus.title == "Your previous VibeTV installation needs repair"
            && legacyStatus.detail
                == "VibeTV couldn’t safely replace the older background service."
            && legacyStatus.retryTitle == "Repair installation"
            && legacyStatus.kind == .legacyRepair,
        "legacy migration failures must offer installation repair"
    )
    require(
        installationPreviewFailure("background-approval") == .backgroundApproval
            && installationPreviewFailure("service-start") == .serviceStart
            && installationPreviewFailure("update-mismatch") == .updateMismatch
            && installationPreviewFailure("application-incomplete")
                == .applicationIncomplete
            && installationPreviewFailure("legacy-repair") == .legacyRepair
            && installationPreviewFailure("unknown") == nil,
        "local preview must expose every approved recovery state and nothing else"
    )
    require(
        installationFailure(
            for: .versionMismatch(expected: "1.0.0", actual: "0.9.0")
        ) == .updateMismatch
            && installationFailure(for: .appMetadataMissing) == .updateMismatch
            && installationFailure(for: .requestFailed("offline"))
                == .serviceStart,
        "runtime diagnostics must select a useful customer recovery state"
    )
    let backgroundApprovalSequence = [
        runtimeServiceRegistrationOutcome(for: .requiresApproval),
        runtimeServiceRegistrationOutcome(for: .enabled),
        runtimeServiceRegistrationOutcome(for: .requiresApproval),
    ]
    require(
        backgroundApprovalSequence == [.requiresApproval, .ready, .requiresApproval],
        "background approval must recover after consent and return when consent is revoked"
    )
    let redactedReport = AppDelegate.redactReportValue([
        "token": "raw-token",
        "apiKey": "raw-api-key",
        "hasPairingToken": true,
        "sessionTokens": 1234,
        "log": "Authorization: Basic raw-basic X-VibeTV-Token: raw-header CODEXBAR_DISPLAY_DEVICE_TOKEN=raw-env https://example.test/?token=raw-query https://alice:raw-userinfo@example.test/path",
    ]) as! [String: Any]
    require(
        redactedReport["token"] as? String == "[redacted]"
            && redactedReport["apiKey"] as? String == "[redacted]",
        "support report must redact generic token and API key fields"
    )
    require(
        redactedReport["hasPairingToken"] as? Bool == true
            && redactedReport["sessionTokens"] as? Int == 1234,
        "support report must preserve safe booleans and usage token counts"
    )
    let redactedLog = redactedReport["log"] as? String ?? ""
    require(
        !redactedLog.contains("raw-basic")
            && !redactedLog.contains("raw-header")
            && !redactedLog.contains("raw-env")
            && !redactedLog.contains("raw-query")
            && !redactedLog.contains("raw-userinfo"),
        "support report must redact secrets embedded in log strings"
    )
    require(
        isCompatibleCodexBarVersion("0.23.0"),
        "the minimum supported CodexBar version must be compatible"
    )
    require(
        isCompatibleCodexBarVersion("0.45.0"),
        "a newer CodexBar version must be reusable"
    )
    require(
        isCompatibleCodexBarVersion("0.43.0"),
        "an existing CodexBar 0.43 installation must remain reusable"
    )
    require(
        !isCompatibleCodexBarVersion("0.22.0"),
        "an unsupported CodexBar version must not replace the pinned bootstrap"
    )
    let commandFixtureDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("vibetv-command-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(
        at: commandFixtureDirectory,
        withIntermediateDirectories: false
    )
    defer { try? FileManager.default.removeItem(at: commandFixtureDirectory) }
    let verboseCommand = commandFixtureDirectory.appendingPathComponent("verbose-command")
    try! Data(
        """
        #!/bin/sh
        /usr/bin/awk 'BEGIN { for (i = 0; i < 200000; i++) printf "x" }'
        """.utf8
    ).write(to: verboseCommand)
    try! FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: verboseCommand.path
    )
    let verboseResult = runCodexBarCommand(
        executableURL: verboseCommand,
        arguments: []
    )
    require(
        verboseResult?.exitCode == 0 && verboseResult?.output.count == 200000,
        "command output must be drained while a verbose child process is running"
    )
    let codexBarCandidates = codexBarInstalledAppCandidates(
        homeDirectory: URL(fileURLWithPath: "/Users/customer", isDirectory: true)
    )
    require(
        codexBarCandidates.map(\.path) == [
            "/Applications/CodexBar.app",
            "/Users/customer/Applications/CodexBar.app",
        ],
        "CodexBar discovery must prefer the shared app and then the user app"
    )
    let configFixtureDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("vibetv-codexbar-config-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(
        at: configFixtureDirectory,
        withIntermediateDirectories: false
    )
    defer { try? FileManager.default.removeItem(at: configFixtureDirectory) }
    let fakeCodexBarCLI = configFixtureDirectory.appendingPathComponent("CodexBarCLI")
    try! Data(
        """
        #!/bin/sh
        case "${1:-} ${2:-}" in
          "config dump")
            printf '{"version":42,"providers":[{"id":"future-provider","enabled":true}]}'
            ;;
          "config validate")
            printf '[]'
            ;;
          *)
            exit 64
            ;;
        esac
        """.utf8
    ).write(to: fakeCodexBarCLI)
    try! FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fakeCodexBarCLI.path
    )
    let generatedConfigURL = configFixtureDirectory.appendingPathComponent("config.json")
    require(
        writeCodexBarOwnedDefaultConfig(
            executableURL: fakeCodexBarCLI,
            targetURL: generatedConfigURL
        ),
        "fresh installs must ask CodexBar to render and validate its own defaults"
    )
    let generatedConfigData = try! Data(contentsOf: generatedConfigURL)
    let config = try! JSONSerialization.jsonObject(
        with: generatedConfigData
    ) as! [String: Any]
    let generatedProviders = config["providers"] as? [[String: Any]]
    require(
        config["version"] as? Int == 42
            && generatedProviders?.first?["id"] as? String == "future-provider",
        "VibeTV must preserve CodexBar's dynamic provider inventory and defaults"
    )
    let existingConfigData = Data(#"{"existing":true}"#.utf8)
    try! existingConfigData.write(to: generatedConfigURL, options: .atomic)
    require(
        writeCodexBarOwnedDefaultConfig(
            executableURL: fakeCodexBarCLI,
            targetURL: generatedConfigURL
        )
            && (try! Data(contentsOf: generatedConfigURL)) == existingConfigData,
        "an existing CodexBar config must remain untouched"
    )
    require(
        RuntimePreparationOutcome.nativeRuntimeReady.shouldReloadControlCenter,
        "healthy native runtime must refresh the WebView"
    )
    require(
        !RuntimePreparationOutcome.codexBarRepairRequired.shouldReloadControlCenter,
        "a failed CodexBar installation must keep customer setup blocked"
    )
    require(
        !RuntimePreparationOutcome.failure(.backgroundApproval)
            .shouldReloadControlCenter,
        "background approval must keep the WebView closed until the runtime is verified"
    )
    require(
        !RuntimePreparationOutcome.failure(.legacyRepair)
            .shouldReloadControlCenter,
        "uncertain runtime state must not force a misleading WebView refresh"
    )
    require(
        !shouldRetryControlCenterNavigation(
            NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)
        ),
        "a navigation replaced by the post-migration reload must not schedule another retry"
    )
    require(
        shouldRetryControlCenterNavigation(
            NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)
        ),
        "a real Control Center navigation failure must remain retryable"
    )
    require(
        isOpenControlCenterURL(URL(string: "vibetv://open-control-center")!),
        "expected launcher URL to be accepted"
    )
    require(
        isOpenControlCenterURL(URL(string: "VIBETV://OPEN-CONTROL-CENTER/")!),
        "scheme and host should be case-insensitive"
    )
    require(
        !isOpenControlCenterURL(URL(string: "vibetv://install-theme")!),
        "unexpected launcher actions must be rejected"
    )
    require(
        !isOpenControlCenterURL(URL(string: "vibetv://open-control-center?theme=mini")!),
        "launcher query parameters must be rejected"
    )
    require(
        !isOpenControlCenterURL(URL(string: "https://open-control-center")!),
        "non-VibeTV schemes must be rejected"
    )
    require(
        isCheckForUpdatesURL(URL(string: "vibetv://check-for-updates")!),
        "the exact native Sparkle action must be accepted"
    )
    require(
        isRestartControlCenterURL(URL(string: "vibetv://restart-control-center")!),
        "the exact native restart action must be accepted"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://restart-control-center")!
        ) == .restartControlCenter,
        "the WebView restart URL must route to the native restart action"
    )
    for rejectedRestartURL in [
        "vibetv://restart-control-center/extra",
        "vibetv://restart-control-center?force=true",
        "https://restart-control-center",
    ] {
        require(
            !isRestartControlCenterURL(URL(string: rejectedRestartURL)!),
            "unexpected restart action must be rejected: \(rejectedRestartURL)"
        )
    }
    require(
        isRepairRuntimeURL(URL(string: "vibetv://repair-runtime")!),
        "the exact native runtime repair action must be accepted"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://repair-runtime")!
        ) == .repairRuntime,
        "the WebView repair URL must route to the native runtime repair action"
    )
    for rejectedRuntimeRepairURL in [
        "vibetv://repair-runtime/extra",
        "vibetv://repair-runtime?force=true",
        "https://repair-runtime",
    ] {
        require(
            !isRepairRuntimeURL(URL(string: rejectedRuntimeRepairURL)!),
            "unexpected runtime repair action must be rejected: \(rejectedRuntimeRepairURL)"
        )
    }
    for rejectedUpdateURL in [
        "vibetv://check-for-updates/extra",
        "vibetv://check-for-updates?channel=beta",
        "https://check-for-updates",
        "vibetv://install-update",
    ] {
        require(
            !isCheckForUpdatesURL(URL(string: rejectedUpdateURL)!),
            "unexpected update action must be rejected: \(rejectedUpdateURL)"
        )
    }
    require(
        isRepairCodexBarURL(URL(string: "vibetv://repair-codexbar")!),
        "the exact native CodexBar repair action must be accepted"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://repair-codexbar")!
        ) == .repairCodexBar,
        "the WebView repair URL must route to the native CodexBar repair action"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://check-for-updates")!
        ) == .checkForUpdates,
        "the WebView update URL must route to the native Sparkle action"
    )
    require(
        shouldHandleWebViewDownload(
            url: URL(string: "blob:http://127.0.0.1/report")!,
            requestedByWebContent: true
        ),
        "an explicit blob download must use the native WebKit download path"
    )
    require(
        !shouldHandleWebViewDownload(
            url: URL(string: "blob:http://127.0.0.1/report")!,
            requestedByWebContent: false
        ),
        "ordinary blob navigation must not become a download"
    )
    for nonBlobDownloadURL in [
        "vibetv://repair-runtime",
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.0/VibeTV-Control-Center.dmg",
    ] {
        require(
            !shouldHandleWebViewDownload(
                url: URL(string: nonBlobDownloadURL)!,
                requestedByWebContent: true
            ),
            "non-blob routes must keep their existing handling: \(nonBlobDownloadURL)"
        )
    }
    for rejectedRepairURL in [
        "vibetv://repair-codexbar/extra",
        "vibetv://repair-codexbar?force=true",
        "https://repair-codexbar",
    ] {
        require(
            !isRepairCodexBarURL(URL(string: rejectedRepairURL)!),
            "unexpected CodexBar repair action must be rejected: \(rejectedRepairURL)"
        )
    }
    require(
        nativeControlCenterAction(
            for: URL(string: "https://app.vibetv.shop/control-center")!
        ) == nil,
        "ordinary WebView navigation must not trigger a native action"
    )
    require(
        isApprovedDMGDownloadURL(
            URL(
                string: "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.2.3/VibeTV-Control-Center.dmg"
            )!
        ),
        "verified GitHub DMG release URL must open externally"
    )
    require(
        isApprovedDMGDownloadURL(
            URL(
                string: "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.2.3-rc.1/VibeTV-Control-Center.dmg"
            )!
        ),
        "verified prerelease DMG URL must open externally"
    )
    for rejectedURL in [
        "http://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.2.3/VibeTV-Control-Center.dmg",
        "https://github.com/Other/CodexBar-Display/releases/download/v1.2.3/VibeTV-Control-Center.dmg",
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/VibeTV-Control-Center.dmg",
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.2.3/other.dmg",
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.2.3/VibeTV-Control-Center.dmg?download=1",
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1%2E2%2E3/VibeTV-Control-Center.dmg",
    ] {
        require(
            !isApprovedDMGDownloadURL(URL(string: rejectedURL)!),
            "unverified DMG URL must stay inside the WebView policy: \(rejectedURL)"
        )
    }

    var coldRouter = ControlCenterURLRouter()
    require(
        !coldRouter.receive([URL(string: "vibetv://open-control-center")!]),
        "cold launch must queue the request until AppKit finishes launching"
    )
    require(coldRouter.hasPendingOpen, "cold launch request was not queued")
    require(coldRouter.markReady(), "queued cold launch request was not delivered")
    require(!coldRouter.hasPendingOpen, "delivered cold launch request was not cleared")

    var warmRouter = ControlCenterURLRouter()
    require(!warmRouter.markReady(), "warm router should start without a queued request")
    require(
        warmRouter.receive([URL(string: "vibetv://open-control-center")!]),
        "warm launch request must open immediately"
    )

    var invalidRouter = ControlCenterURLRouter()
    require(
        !invalidRouter.receive([URL(string: "vibetv://install-theme")!]),
        "invalid URL must not open the Control Center"
    )
    require(!invalidRouter.hasPendingOpen, "invalid URL must not be queued")

    require(
        !runtimeServiceNeedsRefresh(
            registeredVersion: "1.2.3+146",
            currentVersion: "1.2.3+146"
        ),
        "normal UI starts must not restart the current runtime version"
    )
    require(
        runtimeServiceNeedsRefresh(
            registeredVersion: "1.2.2+145",
            currentVersion: "1.2.3+146"
        ),
        "a new app bundle version must refresh the registered runtime"
    )
    require(
        runtimeServiceNeedsRefresh(
            registeredVersion: nil,
            currentVersion: "1.2.3+146"
        ),
        "an enabled service without a recorded version must refresh once"
    )
    require(
        !runtimeServiceNeedsRefresh(registeredVersion: nil, currentVersion: ""),
        "a missing current bundle version must not cause a restart loop"
    )
    require(
        runtimeBundleVersion(shortVersion: "1.2.3", buildVersion: "146") == "1.2.3+146",
        "runtime bundle version must include release and build versions"
    )
    require(
        runtimeBundleVersion(shortVersion: nil, buildVersion: nil).isEmpty,
        "missing bundle metadata must stay empty"
    )
    require(
        nativeControlCenterUserAgent(
            shortVersion: "99.0.16",
            buildVersion: "163"
        ) == "VibeTVControlCenter/99.0.16+163",
        "native WebView must identify itself without exposing the browser UI"
    )
    let pendingCreatedAt = Date(timeIntervalSince1970: 1_700_000_000)
    let pendingUpdate = PendingNativeUpdate(
        version: "1.2.4",
        build: "201",
        createdAt: pendingCreatedAt
    )
    require(
        pendingNativeUpdateMatchesBundle(
            pendingUpdate,
            shortVersion: "1.2.4",
            buildVersion: "201"
        ),
        "a relaunched updated bundle must satisfy its pending marker"
    )
    require(
        pendingNativeUpdateBlocksBundle(
            pendingUpdate,
            shortVersion: "1.2.3",
            buildVersion: "200",
            now: pendingCreatedAt.addingTimeInterval(60),
            maximumAge: 1_800
        ),
        "a fresh pending marker must block an unverified old bundle"
    )
    require(
        !pendingNativeUpdateBlocksBundle(
            pendingUpdate,
            shortVersion: "1.2.3",
            buildVersion: "200",
            now: pendingCreatedAt.addingTimeInterval(1_801),
            maximumAge: 1_800
        ),
        "an abandoned pending marker must expire instead of permanently locking the old app"
    )
    let localNetworkProbe = makeLocalNetworkPrivacyProbeRequest(timeout: 12)
    require(
        localNetworkProbe?.url?.absoluteString == "http://192.168.4.1/hello",
        "local-network privacy preflight must use the read-only setup gateway hello endpoint"
    )
    require(
        localNetworkProbe?.httpMethod == "GET",
        "local-network privacy preflight must remain read-only"
    )
    require(
        localNetworkProbe?.cachePolicy == .reloadIgnoringLocalCacheData,
        "local-network privacy preflight must not accept a cached response"
    )
    require(
        localNetworkProbe?.timeoutInterval == 12,
        "local-network privacy preflight must stay bounded"
    )
    require(
        makeLocalNetworkPrivacyProbeRequest(
            urlString: "http://other-device.local/hello"
        ) == nil,
        "local-network privacy preflight must not contact arbitrary hosts"
    )
    require(
        shouldRunRuntimeValidationUnregister(
            arguments: [
                "/Applications/VibeTV Control Center.app/Contents/MacOS/VibeTVControlCenter",
                "--vibetv-validation-unregister-runtime",
            ],
            environment: ["VIBETV_RUNTIME_VALIDATION_UNREGISTER": "1"]
        ),
        "runtime validation cleanup must require the exact argument and environment opt-in"
    )
    require(
        !shouldRunRuntimeValidationUnregister(
            arguments: [
                "/Applications/VibeTV Control Center.app/Contents/MacOS/VibeTVControlCenter",
                "--vibetv-validation-unregister-runtime",
            ],
            environment: [:]
        ),
        "runtime validation cleanup must reject a missing environment opt-in"
    )
    require(
        !shouldRunRuntimeValidationUnregister(
            arguments: [
                "/Applications/VibeTV Control Center.app/Contents/MacOS/VibeTVControlCenter",
                "--vibetv-validation-unregister-runtime",
                "extra",
            ],
            environment: ["VIBETV_RUNTIME_VALIDATION_UNREGISTER": "1"]
        ),
        "runtime validation cleanup must reject extra arguments"
    )
    require(
        !shouldRunRuntimeValidationUnregister(
            arguments: [
                "/Applications/VibeTV Control Center.app/Contents/MacOS/VibeTVControlCenter",
                "--other-action",
            ],
            environment: ["VIBETV_RUNTIME_VALIDATION_UNREGISTER": "1"]
        ),
        "runtime validation cleanup must reject any other action"
    )

    let healthyStatus = Data(#"{"ok":true,"companion":{"version":"1.2.3"}}"#.utf8)
    require(
        evaluateRuntimeHealth(
            data: healthyStatus,
            httpStatus: 200,
            expectedVersion: "v1.2.3"
        ) == .healthy(version: "1.2.3"),
        "2xx status with the bundled Companion version must pass the health gate"
    )
    require(
        evaluateRuntimeHealth(
            data: healthyStatus,
            httpStatus: 200,
            expectedVersion: "1.2.4"
        ) == .versionMismatch(expected: "1.2.4", actual: "1.2.3"),
        "wrong Companion version must fail the health gate"
    )
    let nativeStatus = Data(
        #"{"ok":true,"companion":{"version":"1.2.3","app":{"version":"2.0.0","build":"200","path":"/Applications/VibeTV Control Center.app","installedInApplications":true},"runtime":{"version":"1.2.3","listenerOwner":"shop.vibetv.control-center.runtime"}}}"#.utf8
    )
    require(
        evaluateRuntimeHealth(
            data: nativeStatus,
            httpStatus: 200,
            expectedVersion: "1.2.3",
            expectedAppVersion: "2.0.0",
            expectedBuild: "200",
            expectedAppPath: "/Applications/VibeTV Control Center.app",
            expectedRuntimeOwner: "shop.vibetv.control-center.runtime"
        ) == .healthy(version: "1.2.3"),
        "native health must verify app, runtime, and listener independently"
    )
    require(
        evaluateRuntimeHealth(
            data: nativeStatus,
            httpStatus: 200,
            expectedVersion: "1.2.3",
            expectedAppVersion: "2.0.0",
            expectedBuild: "201",
            expectedAppPath: "/Applications/VibeTV Control Center.app",
            expectedRuntimeOwner: "shop.vibetv.control-center.runtime"
        ) == .appBuildMismatch(expected: "201", actual: "200"),
        "a stale app build must fail the native health gate"
    )
    require(
        evaluateRuntimeHealth(
            data: nativeStatus,
            httpStatus: 200,
            expectedVersion: "1.2.3",
            expectedAppVersion: "2.0.0",
            expectedBuild: "200",
            expectedAppPath: "/Applications/VibeTV Control Center.app",
            expectedRuntimeOwner: "unexpected.owner"
        ) == .runtimeOwnerMismatch(
            expected: "unexpected.owner",
            actual: "shop.vibetv.control-center.runtime"
        ),
        "the wrong listener owner must fail the native health gate"
    )
    require(
        evaluateRuntimeHealth(
            data: healthyStatus,
            httpStatus: 503,
            expectedVersion: "1.2.3"
        ) == .httpStatus(503),
        "non-2xx status must fail the health gate"
    )
    require(
        evaluateRuntimeHealth(
            data: Data(#"{"ok":false,"companion":{"version":"1.2.3"}}"#.utf8),
            httpStatus: 200,
            expectedVersion: "1.2.3"
        ) == .reportedUnhealthy,
        "ok=false must fail the health gate"
    )
    require(
        evaluateRuntimeHealth(
            data: Data("not-json".utf8),
            httpStatus: 200,
            expectedVersion: "1.2.3"
        ) == .invalidPayload,
        "invalid status JSON must fail the health gate"
    )
    require(
        shouldRetryRuntimeRegistration(
            after: .requestFailed("connection refused"),
            serviceEnabled: true
        ),
        "a missing fresh runtime listener must get one bounded registration refresh"
    )
    require(
        shouldRetryRuntimeRegistration(
            after: .ownershipFailed(.servicePIDMissing),
            serviceEnabled: true
        ),
        "an enabled SMAppService without a PID must get one bounded registration refresh"
    )
    require(
        !shouldRetryRuntimeRegistration(
            after: .ownershipFailed(
                .listenerMismatch(servicePID: 4242, listenerPIDs: [4343])
            ),
            serviceEnabled: true
        ),
        "a foreign listener must never trigger an automatic registration refresh"
    )
    require(
        !shouldRetryRuntimeRegistration(
            after: .versionMismatch(expected: "1.2.3", actual: "1.2.2"),
            serviceEnabled: true
        ),
        "a version mismatch must stay visible instead of entering a refresh loop"
    )
    require(
        !shouldRetryRuntimeRegistration(
            after: .requestFailed("connection refused"),
            serviceEnabled: false
        ),
        "a disabled SMAppService must not trigger a registration refresh"
    )
    require(
        runtimeHealthGatePassed(.healthy(version: "1.2.3")),
        "proven runtime health must survive a stale Service Management status after an app update"
    )
    require(
        !runtimeHealthGatePassed(.ownershipFailed(.serviceUnavailable)),
        "a listener without proven launchd ownership must not pass the runtime health gate"
    )

    let launchctlFixture = """
    gui/501/shop.vibetv.control-center.runtime = {
        state = running
        pid = 4242
    }
    """
    require(
        parseLaunchctlServicePID(launchctlFixture) == 4242,
        "launchctl parser must extract the app-managed service PID"
    )
    require(
        parseLaunchctlServicePID("pid = 4242\npid = 4343\n") == nil,
        "launchctl parser must reject ambiguous service PIDs"
    )
    require(
        parseLsofListenerPIDs("p4242\np4242\n") == [4242],
        "lsof parser must normalize the listener PID fields"
    )
    require(
        evaluateRuntimeOwnership(
            launchctlExitStatus: 0,
            launchctlOutput: launchctlFixture,
            lsofExitStatus: 0,
            lsofOutput: "p4242\n"
        ) == .owned(pid: 4242),
        "health must accept only the SMAppService PID as the local listener"
    )
    require(
        evaluateRuntimeOwnership(
            launchctlExitStatus: 0,
            launchctlOutput: launchctlFixture,
            lsofExitStatus: 0,
            lsofOutput: "p4343\n"
        ) == .listenerMismatch(servicePID: 4242, listenerPIDs: [4343]),
        "health must reject a listener owned by an unrelated process"
    )
    require(
        evaluateRuntimeOwnership(
            launchctlExitStatus: 1,
            launchctlOutput: "",
            lsofExitStatus: nil,
            lsofOutput: ""
        ) == .serviceUnavailable,
        "health must reject a missing SMAppService label"
    )
    require(
        evaluateRuntimeOwnership(
            launchctlExitStatus: 0,
            launchctlOutput: launchctlFixture,
            lsofExitStatus: 1,
            lsofOutput: ""
        ) == .listenerUnavailable(servicePID: 4242),
        "health must reject an app-managed process without the expected listener"
    )

    require(
        isInstalledApplicationsBundle(
            URL(fileURLWithPath: "/Applications/VibeTV Control Center.app")
        ),
        "the DMG app in /Applications must be eligible for persistent migration"
    )
    require(
        !isInstalledApplicationsBundle(
            URL(fileURLWithPath: "/Volumes/VibeTV/VibeTV Control Center.app")
        ),
        "an app opened from a mounted DMG must not migrate persistent services"
    )
    require(
        !requiresApplicationInstallation(
            URL(fileURLWithPath: "/Applications/VibeTV Control Center.app")
        ),
        "an app opened from /Applications must continue to the Control Center"
    )
    require(
        requiresApplicationInstallation(
            URL(fileURLWithPath: "/Volumes/VibeTV/VibeTV Control Center.app")
        ),
        "an app opened directly from the DMG must require installation"
    )
    require(
        requiresApplicationInstallation(
            URL(
                fileURLWithPath: "/private/var/folders/ab/cd/T/AppTranslocation/1234/d/VibeTV Control Center.app"
            )
        ),
        "an App Translocation launch must require installation"
    )
    testLegacyLaunchAgentMigrationPlanning()
    testLegacyTerminalAppDetection()
}

private func testLegacyLaunchAgentMigrationPlanning() {
    let userPlist = URL(
        fileURLWithPath: "/Users/test/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
    )
    let systemPlist = URL(
        fileURLWithPath: "/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
    )

    let systemOnly = makeLegacyLaunchAgentDescriptor(
        label: "com.codexbar-display.companion-api",
        userPlistURL: userPlist,
        systemPlistURL: systemPlist,
        userPlistExists: false,
        systemPlistExists: true,
        isLoaded: false
    )
    require(
        systemOnly != nil,
        "a known system LaunchAgent must be selected even without a user plist"
    )
    require(
        systemOnly?.migrationPlistURL == nil,
        "a system LaunchAgent plist must never be selected for migration"
    )
    require(
        systemOnly?.restartPlistURL == systemPlist,
        "rollback must be able to restart a system LaunchAgent from its original plist"
    )
    require(
        canSafelyStopLegacyLaunchAgent(
            isLoaded: true,
            restartPlistURL: systemOnly?.restartPlistURL
        ),
        "a loaded system LaunchAgent with its original plist must be safe to stop"
    )

    let loadedOnly = makeLegacyLaunchAgentDescriptor(
        label: "com.codexbar-display.companion-api",
        userPlistURL: userPlist,
        systemPlistURL: systemPlist,
        userPlistExists: false,
        systemPlistExists: false,
        isLoaded: true
    )
    require(
        loadedOnly != nil,
        "a loaded known LaunchAgent must be selected even when no plist can be found"
    )
    require(
        loadedOnly?.migrationPlistURL == nil,
        "a loaded-only LaunchAgent must not invent a movable plist"
    )
    require(
        !canSafelyStopLegacyLaunchAgent(
            isLoaded: true,
            restartPlistURL: loadedOnly?.restartPlistURL
        ),
        "migration must not stop a loaded service when rollback could not restart it"
    )
    require(
        makeLegacyLaunchAgentDescriptor(
            label: "com.codexbar-display.companion-api",
            userPlistURL: userPlist,
            systemPlistURL: systemPlist,
            userPlistExists: false,
            systemPlistExists: false,
            isLoaded: false
        ) == nil,
        "an absent and unloaded legacy LaunchAgent must not enter migration"
    )

    let userAgent = makeLegacyLaunchAgentDescriptor(
        label: "com.codexbar-display.companion-api",
        userPlistURL: userPlist,
        systemPlistURL: systemPlist,
        userPlistExists: true,
        systemPlistExists: true,
        isLoaded: true
    )
    require(
        userAgent?.migrationPlistURL == userPlist,
        "only the user LaunchAgent plist may move into the migration backup"
    )
    require(
        userAgent?.restartPlistURL == userPlist,
        "rollback must prefer the user plist when it existed before migration"
    )

    let disabledFixture = """
    disabled services = {
        "com.codexbar-display.companion-api" => disabled
        "com.codexbar-display.daemon" => enabled
        "legacy.true" => true
        "legacy.false" => false
    }
    """
    let disabledStates = parseLaunchctlDisabledServiceStates(disabledFixture)
    require(
        disabledStates["com.codexbar-display.companion-api"] == true,
        "launchctl disabled state must be parsed"
    )
    require(
        disabledStates["com.codexbar-display.daemon"] == false,
        "launchctl enabled state must be parsed"
    )
    require(
        disabledStates["legacy.true"] == true
            && disabledStates["legacy.false"] == false,
        "launchctl boolean state output must remain compatible"
    )
    require(
        launchctlServiceTarget(
            uid: 501,
            label: "com.codexbar-display.companion-api"
        ) == "gui/501/com.codexbar-display.companion-api",
        "legacy operations must target the current user's launchd GUI domain"
    )
}

private func testLegacyTerminalAppDetection() {
    let fileManager = FileManager.default
    let root = fileManager.temporaryDirectory
        .appendingPathComponent("vibetv-native-tests-\(UUID().uuidString)", isDirectory: true)
    defer {
        try? fileManager.removeItem(at: root)
    }

    let legacyApp = root.appendingPathComponent(
        "VibeTV Control Center.app",
        isDirectory: true
    )
    let contents = legacyApp.appendingPathComponent("Contents", isDirectory: true)
    let executable = contents
        .appendingPathComponent("MacOS", isDirectory: true)
        .appendingPathComponent("codexbar-display")
    do {
        try fileManager.createDirectory(
            at: executable.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let plist = try PropertyListSerialization.data(
            fromPropertyList: [
                "CFBundleIdentifier": "shop.vibetv.control-center",
                "CFBundleExecutable": "codexbar-display",
                "CFBundlePackageType": "APPL",
            ],
            format: .xml,
            options: 0
        )
        try plist.write(to: contents.appendingPathComponent("Info.plist"))
        try Data("#!/bin/sh\n".utf8).write(to: executable)
        try fileManager.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: executable.path
        )
    } catch {
        require(false, "could not prepare legacy app test bundle: \(error)")
        return
    }

    require(
        isLegacyTerminalAppBundle(
            at: legacyApp,
            currentAppURL: root.appendingPathComponent("Current.app"),
            expectedBundleIdentifier: "shop.vibetv.control-center"
        ),
        "old terminal app bundle must be selected for migration"
    )
    require(
        !isLegacyTerminalAppBundle(
            at: legacyApp,
            currentAppURL: legacyApp,
            expectedBundleIdentifier: "shop.vibetv.control-center"
        ),
        "the currently running app must never migrate itself"
    )
}
#endif
