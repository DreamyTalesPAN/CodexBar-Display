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
        RuntimePreparationOutcome.nativeRuntimeReady.shouldReloadControlCenter,
        "healthy native runtime must refresh the WebView"
    )
    require(
        RuntimePreparationOutcome.legacyRuntimeRestored.shouldReloadControlCenter,
        "successful rollback must refresh the WebView to the restored runtime"
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
        evaluateExistingDeviceStatus(
            data: Data(
                #"{"ok":true,"companion":{"version":"1.2.3"},"device":{"target":"http://192.168.178.72","paired":true,"ready":true}}"#.utf8
            ),
            httpStatus: 200
        ) == .ready,
        "a verified existing VibeTV must not be repaired again"
    )
    require(
        shouldRepairExistingDevice(
            .ready,
            requireFreshFullFrame: true
        ),
        "legacy migration must prove one fresh full frame even when old status says ready"
    )
    require(
        !shouldRepairExistingDevice(
            .ready,
            requireFreshFullFrame: false
        ),
        "normal app starts must not rewrite an already healthy VibeTV"
    )
    require(
        evaluateExistingDeviceStatus(
            data: Data(
                #"{"ok":true,"companion":{"version":"1.2.3"},"device":{"target":"http://192.168.178.72","connected":true,"ready":false}}"#.utf8
            ),
            httpStatus: 200
        ) == .needsRepair,
        "a preserved target without a fresh frame must be repaired automatically"
    )
    require(
        evaluateExistingDeviceStatus(
            data: Data(
                #"{"ok":true,"companion":{"version":"1.2.3"},"device":{"connected":false,"ready":false}}"#.utf8
            ),
            httpStatus: 200
        ) == .notConfigured,
        "a fresh install without a target must continue to onboarding"
    )
    require(
        evaluateExistingDeviceRepair(
            data: Data(#"{"ok":true,"device":{"ready":true}}"#.utf8),
            httpStatus: 200
        ) == .ready,
        "migration may retire the legacy runtime only after a fresh frame is confirmed"
    )
    require(
        evaluateExistingDeviceRepair(
            data: Data(#"{"ok":true,"device":{"ready":false}}"#.utf8),
            httpStatus: 200
        ) == .failed("VibeTV did not confirm a fresh full display frame"),
        "an incomplete display repair must keep legacy artifacts"
    )
    require(
        shouldRetryExistingDevicePreparation(
            .retryableFailure("temporary network failure"),
            attempt: 1,
            maximumAttempts: 3
        ),
        "a transient device preparation failure must get a bounded retry"
    )
    require(
        !shouldRetryExistingDevicePreparation(
            .retryableFailure("persistent network failure"),
            attempt: 3,
            maximumAttempts: 3
        ),
        "device preparation retries must stop at the configured maximum"
    )
    require(
        !shouldRetryExistingDevicePreparation(
            .failed("pairing repair failed"),
            attempt: 1,
            maximumAttempts: 3
        ),
        "a failed pairing transaction must not be repeated automatically"
    )
    require(
        !shouldRetryExistingDevicePreparation(
            .notConfigured,
            attempt: 1,
            maximumAttempts: 3
        ),
        "a fresh install without a configured VibeTV must not retry migration"
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
