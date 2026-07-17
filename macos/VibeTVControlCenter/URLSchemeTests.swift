#if VIBETV_CONTROL_CENTER_TESTING
import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("error: \(message)\n".utf8))
        exit(1)
    }
}

func runURLSchemeTests() {
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
    let config = try! JSONSerialization.jsonObject(
        with: defaultCodexBarConfigData()
    ) as! [String: Any]
    let providers = config["providers"] as! [[String: Any]]
    require(
        providers.compactMap { $0["id"] as? String } == [
            "codex", "claude", "cursor", "gemini", "copilot",
        ],
        "fresh installs must seed only the common supported providers"
    )
    require(
        providers.allSatisfy { $0["enabled"] as? Bool == true },
        "fresh-install providers must be enabled before the first probe"
    )
    require(
        RuntimePreparationOutcome.nativeRuntimeReady.shouldReloadControlCenter,
        "healthy native runtime must refresh the WebView"
    )
    require(
        !RuntimePreparationOutcome.legacyRuntimeRestored.shouldReloadControlCenter,
        "a restored legacy runtime must keep the WebView closed until native installation succeeds"
    )
    require(
        !RuntimePreparationOutcome.keepCurrentPage.shouldReloadControlCenter,
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
