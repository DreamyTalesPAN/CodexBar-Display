#if VIBETV_CONTROL_CENTER_TESTING
import Foundation
import WebKit

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("error: \(message)\n".utf8))
        exit(1)
    }
}

func runURLSchemeTests() {
    let companionURL = URL(string: "http://127.0.0.1:54321/v1/status")!
    for (method, timeout) in [("GET", 5.0), ("GET", 20.0), ("POST", 5.0)] {
        let request = makeCompanionRequest(url: companionURL, method: method, timeout: timeout)
        require(
            request.url == companionURL && request.httpMethod == method
                && request.timeoutInterval == timeout
                && request.cachePolicy == .reloadIgnoringLocalCacheData,
            "companion requests must preserve the origin, method, timeout and cache policy"
        )
        require(
            request.httpBody == nil && (request.allHTTPHeaderFields ?? [:]).isEmpty,
            "companion requests must not add a body, token or headers"
        )
    }
    let healthRequest = makeCompanionRequest(url: companionURL)
    require(
        healthRequest.httpMethod == "GET" && healthRequest.timeoutInterval == 5,
        "runtime health requests must keep their five-second GET defaults"
    )

    // Issue #655: a window behind other windows must not suspend the page that
    // drives the setup.
    MainActor.assumeIsolated {
        let configuration = makeControlCenterWebViewConfiguration()
        require(
            configuration.preferences.inactiveSchedulingPolicy == .none,
            "the Control Center page must keep running while its window is covered"
        )
        require(
            configuration.defaultWebpagePreferences.allowsContentJavaScript,
            "the Control Center page needs JavaScript"
        )
    }
    // Issue #655: only macOS 14.0 to 14.5 need the app to keep a covered page
    // running; their WebKit still suspends it despite `.none`.
    for (major, minor, patch) in [(14, 0, 0), (14, 3, 1), (14, 5, 0)] {
        require(
            controlCenterPageNeedsKeepAlive(
                OperatingSystemVersion(majorVersion: major, minorVersion: minor, patchVersion: patch)
            ),
            "macOS \(major).\(minor).\(patch) needs the page keep-alive"
        )
    }
    for (major, minor, patch) in [(14, 6, 0), (14, 7, 6), (15, 0, 0), (26, 0, 0)] {
        require(
            !controlCenterPageNeedsKeepAlive(
                OperatingSystemVersion(majorVersion: major, minorVersion: minor, patchVersion: patch)
            ),
            "macOS \(major).\(minor).\(patch) keeps a covered page running by itself"
        )
    }
    require(
        controlCenterPageKeepAliveInterval < .seconds(8 * 60),
        "the keep-alive must come before WebKit's eight-minute suspension"
    )

    // Issue #556: the start screen retries the CodexBar preparation once; a repair does not.
    require(
        retriesCodexBarBootstrap(fromStartScreen: true, repairRequested: false),
        "the start screen must retry the CodexBar preparation before asking for a repair"
    )
    require(
        !retriesCodexBarBootstrap(fromStartScreen: true, repairRequested: true),
        "a requested CodexBar repair must answer after one preparation"
    )
    require(
        !retriesCodexBarBootstrap(fromStartScreen: false, repairRequested: false),
        "a runtime repair must answer within the page's wait, after one preparation"
    )
    // Issue #582: the page learns how the save dialog ended.
    require(
        downloadFinishedEventScript(fileName: "vibetv-theme-new-theme.zip", saved: true)
            == "window.dispatchEvent(new CustomEvent('vibetv:download-finished', { detail: {\"fileName\":\"vibetv-theme-new-theme.zip\",\"saved\":true} })); true",
        "a saved download must be reported to the page with its file name"
    )
    require(
        downloadFinishedEventScript(fileName: "a.zip", saved: false)?
            .contains("{\"fileName\":\"a.zip\",\"saved\":false}") == true,
        "a cancelled save dialog must be reported as not saved"
    )
    require(
        downloadFinishedEventScript(fileName: "a\"}));alert('x')//\n\\.zip", saved: true)?
            .contains("{\"fileName\":\"a\\\"}));alert('x')\\/\\/\\n\\\\.zip\",\"saved\":true}") == true,
        "a file name must reach the page as JSON text and never end the script's string"
    )
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
    let nativeAIPrompt = nativeSetupAIFixPrompt(
        appVersion: "1.0.99",
        appBuild: "199",
        setupTitle: "Starting Control Center",
        setupDetail: "Preparing the Mac App.",
        macOS: "Version 26.0"
    )
    require(
        nativeAIPrompt.contains("DreamyTalesPAN/CodexBar-Display")
            && nativeAIPrompt.contains("macos/VibeTVControlCenter/main.swift")
            && nativeAIPrompt.contains("1.0.99 (199)")
            && nativeAIPrompt.contains("Starting Control Center — Preparing the Mac App.")
            && nativeAIPrompt.contains("Do not clone the repository")
            && nativeAIPrompt.contains("Never commit, push, or open a pull request"),
        "the native welcome Help menu must copy the approved Ask AI recovery prompt"
    )
    let repairStatus = InstallationStatus(
        title: "Usage service needs repair",
        detail: "Repair the usage service before continuing.",
        failed: true,
        retryTitle: "Repair usage service",
        kind: .standard
    )
    require(
        repairStatus.retryTitle == "Repair usage service",
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
    let blockedStatus = InstallationFailure.launchBlockedBySignature.installationStatus
    require(
        blockedStatus.title == "macOS blocked VibeTV’s background service"
            && blockedStatus.detail.contains("download it again from vibetv.shop")
            && blockedStatus.retryTitle == "Download VibeTV again"
            && blockedStatus.kind == .launchBlocked,
        "a helper killed for its signature must send the customer to a new download, not to Restart service"
    )
    require(
        installationPreviewFailure("launch-blocked") == .launchBlockedBySignature,
        "the blocked-service screen must be previewable for the click test"
    )
    let helperPath = "/Applications/VibeTV Control Center.app/Contents/Helpers/codexbar-display"
    func crashReport(indicator: String, path: String = helperPath) -> String {
        #"{"app_name":"codexbar-display","bug_type":"309"}"# + "\n"
            + #"{"procPath":"\#(path)","termination":{"flags":66,"code":4,"namespace":"CODESIGNING","indicator":"\#(indicator)"}}"#
    }
    require(
        crashReportShowsLaunchConstraintViolation(
            crashReport(indicator: "Launch Constraint Violation"),
            helperPath: helperPath
        ),
        "a launch constraint kill of the bundled helper must be recognised"
    )
    require(
        !crashReportShowsLaunchConstraintViolation(
            crashReport(indicator: "Invalid Page"),
            helperPath: helperPath
        )
            && !crashReportShowsLaunchConstraintViolation(
                crashReport(
                    indicator: "Launch Constraint Violation",
                    path: "/Applications/Other.app/Contents/Helpers/codexbar-display"
                ),
                helperPath: helperPath
            )
            && !crashReportShowsLaunchConstraintViolation("not a report", helperPath: helperPath),
        "only a launch constraint kill of this app's own helper may change the recovery"
    )
    let crashDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("vibetv-626-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: crashDirectory, withIntermediateDirectories: true)
    let staleReport = crashDirectory.appendingPathComponent("codexbar-display-2026-10-15-075801.ips")
    try? crashReport(indicator: "Launch Constraint Violation").write(to: staleReport, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes(
        [.modificationDate: Date().addingTimeInterval(-3_600)],
        ofItemAtPath: staleReport.path
    )
    require(
        !runtimeLaunchWasBlockedBySignature(
            crashDirectory: crashDirectory,
            helperPath: helperPath,
            since: Date().addingTimeInterval(-60)
        ),
        "a crash report from before this start must not decide the recovery"
    )
    try? crashReport(indicator: "Launch Constraint Violation").write(
        to: crashDirectory.appendingPathComponent("codexbar-display-2026-10-20-095314.ips"),
        atomically: true,
        encoding: .utf8
    )
    require(
        runtimeLaunchWasBlockedBySignature(
            crashDirectory: crashDirectory,
            helperPath: helperPath,
            since: Date().addingTimeInterval(-60)
        ),
        "a launch constraint kill during this start must be found in the crash reports"
    )
    try? FileManager.default.trashItem(at: crashDirectory, resultingItemURL: nil)
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
    // Issue #836: a silent service is restarted once by the app itself; only
    // a second failure shows the screen. Other failures never restart.
    require(
        shouldRestartServiceAutomatically(after: .serviceStart, alreadyRestarted: false, repairAttempt: false)
            && !shouldRestartServiceAutomatically(after: .serviceStart, alreadyRestarted: true, repairAttempt: false)
            && !shouldRestartServiceAutomatically(after: .serviceStart, alreadyRestarted: false, repairAttempt: true)
            && !shouldRestartServiceAutomatically(after: .backgroundApproval, alreadyRestarted: false, repairAttempt: false)
            && !shouldRestartServiceAutomatically(after: .updateMismatch, alreadyRestarted: false, repairAttempt: false)
            && !shouldRestartServiceAutomatically(after: .applicationIncomplete, alreadyRestarted: false, repairAttempt: false)
            && !shouldRestartServiceAutomatically(after: .legacyRepair, alreadyRestarted: false, repairAttempt: false)
            && !shouldRestartServiceAutomatically(after: .portConflict("x"), alreadyRestarted: false, repairAttempt: false),
        "a silent background service is restarted once by itself, then the screen shows"
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
    let appSupportURL = URL(
        fileURLWithPath: "/Users/customer/Library/Application Support/codexbar-display",
        isDirectory: true
    )
    require(
        appManagedCodexBarAppURL(applicationSupportURL: appSupportURL).path
            == "/Users/customer/Library/Application Support/codexbar-display/CodexBar/0.79.0/CodexBar.app",
        "VibeTV must publish CodexBar only into its private versioned app support directory"
    )
    require(
        appManagedCodexBarCLIURL(applicationSupportURL: appSupportURL).path
            == "/Users/customer/Library/Application Support/codexbar-display/CodexBar/0.79.0/CodexBar.app/Contents/Helpers/CodexBarCLI",
        "the Companion must use the exact private CodexBarCLI path"
    )
    let managedApp = appManagedCodexBarAppURL(applicationSupportURL: appSupportURL)
    let managedCLI = appManagedCodexBarCLIURL(applicationSupportURL: appSupportURL)
    require(
        managedCodexBarRecoveryURL(
            applicationSupportURL: appSupportURL,
            validatedCLIURL: managedCLI
        ) == managedApp,
        "recovery must choose the validated private CodexBar app"
    )
    for unrelatedCLI in [
        URL(fileURLWithPath: "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"),
        appManagedCodexBarCLIURL(applicationSupportURL: appSupportURL, version: "0.62.0"),
    ] {
        require(
            managedCodexBarRecoveryURL(
                applicationSupportURL: appSupportURL,
                validatedCLIURL: unrelatedCLI
            ) == nil,
            "recovery must reject a different CodexBar bundle"
        )
    }
    require(
        managedCodexBarRecoveryURL(
            applicationSupportURL: appSupportURL,
            validatedCLIURL: nil
        ) == nil,
        "recovery must reject an unverified private app"
    )
    let symlinkTestRoot = FileManager.default.temporaryDirectory
        .resolvingSymlinksInPath()
        .appendingPathComponent("vibetv-recovery-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: symlinkTestRoot) }
    let symlinkSupportURL = symlinkTestRoot.appendingPathComponent("support")
    let symlinkAppURL = appManagedCodexBarAppURL(applicationSupportURL: symlinkSupportURL)
    let unrelatedAppURL = symlinkTestRoot.appendingPathComponent("other/CodexBar.app")
    try! FileManager.default.createDirectory(
        at: symlinkAppURL.deletingLastPathComponent(), withIntermediateDirectories: true
    )
    try! FileManager.default.createDirectory(
        at: unrelatedAppURL, withIntermediateDirectories: true
    )
    try! FileManager.default.createSymbolicLink(
        at: symlinkAppURL, withDestinationURL: unrelatedAppURL
    )
    require(
        managedCodexBarRecoveryURL(
            applicationSupportURL: symlinkSupportURL,
            validatedCLIURL: appManagedCodexBarCLIURL(applicationSupportURL: symlinkSupportURL)
        ) == nil,
        "recovery must reject a private path redirected to another app"
    )
    try! FileManager.default.removeItem(at: symlinkAppURL)
    let symlinkCLIURL = appManagedCodexBarCLIURL(applicationSupportURL: symlinkSupportURL)
    try! FileManager.default.createDirectory(
        at: symlinkCLIURL.deletingLastPathComponent(), withIntermediateDirectories: true
    )
    try! Data().write(to: unrelatedAppURL.appendingPathComponent("CodexBarCLI"))
    try! FileManager.default.createSymbolicLink(
        at: symlinkCLIURL,
        withDestinationURL: unrelatedAppURL.appendingPathComponent("CodexBarCLI")
    )
    require(
        managedCodexBarRecoveryURL(
            applicationSupportURL: symlinkSupportURL,
            validatedCLIURL: symlinkCLIURL
        ) == nil,
        "recovery must reject a private CLI redirected outside the app"
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
    let verboseTimedResult = runCodexBarCommand(
        executableURL: verboseCommand,
        arguments: [],
        timeout: 30
    )
    require(
        verboseTimedResult?.exitCode == 0 && verboseTimedResult?.output.count == 200000,
        "a command with a timeout must still return its whole output"
    )
    let hangingCommand = commandFixtureDirectory.appendingPathComponent("hanging-command")
    try! Data(
        """
        #!/bin/sh
        exec /bin/sleep 30
        """.utf8
    ).write(to: hangingCommand)
    try! FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: hangingCommand.path
    )
    let hangingStartedAt = Date()
    let hangingResult = runCodexBarCommand(
        executableURL: hangingCommand,
        arguments: [],
        timeout: 0.5
    )
    require(
        hangingResult == nil && Date().timeIntervalSince(hangingStartedAt) < 5,
        "a command that outlives its timeout, like an unanswered Keychain prompt, must be stopped"
    )
    let environmentCommand = commandFixtureDirectory.appendingPathComponent("environment-command")
    try! Data(
        """
        #!/bin/sh
        printf '%s' "$HOME"
        """.utf8
    ).write(to: environmentCommand)
    try! FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: environmentCommand.path
    )
    let environmentResult = runCodexBarCommand(
        executableURL: environmentCommand,
        arguments: []
    )
    require(
        environmentResult?.exitCode == 0
            && environmentResult?.output == ProcessInfo.processInfo.environment["HOME"]
            && !(environmentResult?.output.isEmpty ?? true),
        "the Companion child must inherit the app environment so it can find HOME"
    )
    for (capture, merge, expected) in [(true, true, "outerr"), (true, false, "out"), (false, true, "")] {
        let result = try! runProcess(
            executableURL: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "printf out; printf err >&2; exit 7"],
            captureOutput: capture,
            mergeStandardError: merge
        )
        require(
            result?.exitCode == 7 && result?.output == expected,
            "captured, stdout-only and discarded output must preserve nonzero exit status"
        )
    }
    let explicitEnvironment = runCodexBarCommand(
        executableURL: URL(fileURLWithPath: "/usr/bin/printenv"),
        arguments: ["VIBETV_COMMAND_TEST"],
        environment: ["VIBETV_COMMAND_TEST": "explicit"]
    )
    require(
        explicitEnvironment?.exitCode == 0 && explicitEnvironment?.output == "explicit\n",
        "a supplied child environment must be passed through"
    )
    let missingExecutable = commandFixtureDirectory.appendingPathComponent("missing-command")
    require(
        runCodexBarCommand(executableURL: missingExecutable, arguments: []) == nil,
        "CodexBar launch failures must still return nil"
    )
    do {
        _ = try runProcess(executableURL: missingExecutable, arguments: [])
        require(false, "process launch errors must reach callers that log them")
    } catch {
        // Diagnostic and launchctl callers keep their own error messages.
    }
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
        nativeControlCenterAction(for: URL(string: "vibetv://check-for-updates-in-background")!)
            == .checkForUpdatesInBackground,
        "the window's own update prompt must map to the background Sparkle check (#570)"
    )
    require(
        nativeControlCenterAction(for: URL(string: "vibetv://check-for-updates")!) == .checkForUpdates
            && !isCheckForUpdatesInBackgroundURL(URL(string: "vibetv://check-for-updates-in-background?x=1")!),
        "a click keeps the visible check, and the background action takes no query"
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
        isFinishCodexBarRecoveryURL(
            URL(string: "vibetv://finish-codexbar-recovery")!
        ),
        "the exact temporary CodexBar stop action must be accepted"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://finish-codexbar-recovery")!
        ) == .finishCodexBarRecovery,
        "the WebView finish URL must stop only the temporary CodexBar app"
    )
    require(
        isOpenCodexBarURL(URL(string: "vibetv://open-codexbar")!),
        "the exact open-CodexBar action must be accepted"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://open-codexbar")!
        ) == .openCodexBar,
        "the WebView open URL must bring CodexBar to the front"
    )
    for rejectedOpenURL in [
        "vibetv://open-codexbar/extra",
        "vibetv://open-codexbar?activate=true",
        "vibetv://open-codexbar#now",
        "vibetv://user@open-codexbar",
        "https://open-codexbar",
    ] {
        require(
            !isOpenCodexBarURL(URL(string: rejectedOpenURL)!),
            "unexpected open-CodexBar action must be rejected: \(rejectedOpenURL)"
        )
    }
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://open-sign-in?url=https%3A%2F%2Fchatgpt.com")!
        ) == nil,
        "provider sign-in must stay inside CodexBar instead of opening a website"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://check-for-updates")!
        ) == .checkForUpdates,
        "the WebView update URL must route to the native Sparkle action"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://read-browser-sign-in?provider=claude")!
        ) == .readBrowserSignIn(provider: "claude"),
        "Sign in to Claude must read the Claude browser sign-in from the app"
    )
    require(
        nativeControlCenterAction(
            for: URL(string: "vibetv://read-browser-sign-in?provider=Cursor")!
        ) == .readBrowserSignIn(provider: "cursor"),
        "Sign in to Cursor must read the Cursor browser sign-in from the app"
    )
    for rejectedReadURL in [
        "vibetv://read-browser-sign-in",
        "vibetv://read-browser-sign-in?provider=codex",
        "vibetv://read-browser-sign-in?provider=claude&provider=cursor",
        "vibetv://read-browser-sign-in?provider=claude&all=true",
        "vibetv://read-browser-sign-in/extra?provider=claude",
        "https://read-browser-sign-in?provider=claude",
    ] {
        require(
            nativeControlCenterAction(for: URL(string: rejectedReadURL)!) == nil,
            "unexpected browser sign-in read must be rejected: \(rejectedReadURL)"
        )
    }
    require(
        browserSignInReadOutcome(
            #"[{"provider":"claude","status":"refreshed","message":"Browser cookie refreshed."}]"#
        ) == .read,
        "a refreshed answer means the browser sign-in was read"
    )
    require(
        browserSignInReadOutcome(
            #"[{"provider":"claude","status":"failed","message":"Chrome cookie decryption was declined in Keychain; rerun with --allow-keychain-prompt to request Keychain access again."}]"#
        ) == .declined,
        "a Keychain refusal must stop the reading, or CodexBar asks again"
    )
    for pendingAnswer in [
        #"[{"provider":"claude","status":"failed","message":"No browser session cookie was refreshed. Sign in in a configured browser and retry."}]"#,
        #"[{"provider":"claude","status":"blocked","message":"Retry interactively."}]"#,
        #"[{"status":"refreshed"},{"status":"refreshed"}]"#,
        "not json",
        "",
    ] {
        require(
            browserSignInReadOutcome(pendingAnswer) == .notYet,
            "anything else keeps waiting for the sign-in: \(pendingAnswer)"
        )
    }
    require(
        browserSignInProviderReady(
            usage: Data(#"{"providers":[{"id":"codex","stale":false},{"id":"claude","stale":false,"session":26}]}"#.utf8),
            provider: "claude"
        ),
        "current Claude usage means the browser sign-in worked"
    )
    for notReadyUsage in [
        #"{"providers":[{"id":"claude","stale":true,"usageUnavailable":true}]}"#,
        #"{"providers":[{"id":"claude","stale":false,"usageUnavailable":true}]}"#,
        #"{"providers":[{"id":"codex","stale":false}]}"#,
        #"{"providers":[]}"#,
        "not json",
    ] {
        require(
            !browserSignInProviderReady(usage: Data(notReadyUsage.utf8), provider: "claude"),
            "missing, stale or unavailable usage keeps reading the browser sign-in: \(notReadyUsage)"
        )
    }
    let firstRead = Date(timeIntervalSince1970: 1_000)
    require(
        browserSignInProviderHealthy(
            preferences: Data(#"{"items":[{"id":"codexbar.providers.codex.enabled","health":{"state":"auth_required"}},{"id":"codexbar.providers.claude.enabled","health":{"state":"healthy"}}]}"#.utf8),
            provider: "claude"
        ),
        "a healthy Claude row means the browser sign-in worked"
    )
    for notHealthyPreferences in [
        #"{"items":[{"id":"codexbar.providers.claude.enabled","health":{"state":"browser_sign_in_required"}}]}"#,
        #"{"items":[{"id":"codexbar.providers.claude.enabled","health":{"state":"stale","signInState":"browser_sign_in_required"}}]}"#,
        #"{"items":[{"id":"codexbar.providers.claude.enabled"}]}"#,
        #"{"items":[]}"#,
        "not json",
    ] {
        require(
            !browserSignInProviderHealthy(preferences: Data(notHealthyPreferences.utf8), provider: "claude"),
            "a row still asking to sign in keeps reading the browser sign-in: \(notHealthyPreferences)"
        )
    }
    require(
        browserSignInShouldRead(lastReadAt: nil, readWorks: false, now: firstRead),
        "the first check after Sign in reads the browser sign-in"
    )
    require(
        !browserSignInShouldRead(lastReadAt: firstRead, readWorks: false, now: firstRead.addingTimeInterval(75)),
        "after a read the app waits for the usage service instead of asking again"
    )
    require(
        browserSignInShouldRead(lastReadAt: firstRead, readWorks: false, now: firstRead.addingTimeInterval(90)),
        "a read the provider did not accept is read again"
    )
    require(
        !browserSignInShouldRead(lastReadAt: firstRead, readWorks: true, now: firstRead.addingTimeInterval(170)),
        "a read the check found working is never read, and asked for, again"
    )
    let workingCheck = #"{"ok":true,"providerSetup":{"status":"ready","providers":[{"id":"claude","status":"ready"}]}}"#
    require(
        browserSignInReadWorks(check: Data(workingCheck.utf8), provider: "claude"),
        "a check that finds the provider ready accepts the read: \(workingCheck)"
    )
    for notWorking in [
        #"{"ok":true,"providerSetup":{"status":"setup_required","providers":[{"id":"claude","status":"browser_sign_in_required"}]}}"#,
        #"{"ok":true,"providerSetup":{"status":"ready","providers":[{"id":"codex","status":"ready"}]}}"#,
        "not json",
    ] {
        require(
            !browserSignInReadWorks(check: Data(notWorking.utf8), provider: "claude"),
            "a check that does not find the provider ready keeps reading: \(notWorking)"
        )
    }
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
    for rejectedFinishURL in [
        "vibetv://finish-codexbar-recovery/extra",
        "vibetv://finish-codexbar-recovery?force=true",
        "https://finish-codexbar-recovery",
    ] {
        require(
            !isFinishCodexBarRecoveryURL(URL(string: rejectedFinishURL)!),
            "unexpected CodexBar finish action must be rejected: \(rejectedFinishURL)"
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
    require(
        isApprovedCodexBarDownloadURL(
            URL(string: "https://github.com/steipete/CodexBar/releases/latest")!
        ),
        "the official CodexBar releases page must open externally"
    )
    for rejectedURL in [
        "http://github.com/steipete/CodexBar/releases/latest",
        "https://github.com/other/CodexBar/releases/latest",
        "https://github.com/steipete/CodexBar/releases/latest?download=1",
        "https://github.com/steipete/CodexBar/releases/download/v0.79.0/CodexBar.zip",
    ] {
        require(
            !isApprovedCodexBarDownloadURL(URL(string: rejectedURL)!),
            "unapproved CodexBar download URL must stay inside the WebView policy: \(rejectedURL)"
        )
    }

    var coldRouter = ControlCenterURLRouter()
    require(
        coldRouter.receive([URL(string: "vibetv://open-control-center")!]) == nil,
        "cold launch must queue the request until AppKit finishes launching"
    )
    require(coldRouter.markReady() == "control-center", "queued cold launch request was not delivered")
    require(coldRouter.markReady() == nil, "delivered cold launch request was not cleared")

    var warmRouter = ControlCenterURLRouter()
    require(warmRouter.markReady() == nil, "warm router should start without a queued request")
    require(
        warmRouter.receive([URL(string: "vibetv://open-control-center")!]) == "control-center",
        "warm launch request must open immediately"
    )

    let themeLink = URL(string: "vibetv://install-theme/claude-creature")!
    require(installThemeID(from: themeLink) == "claude-creature", "valid catalog theme link must be accepted")
    require(
        controlCenterPath(for: themeLink) == "control-center/install/claude-creature",
        "theme link must target the local install route"
    )
    var coldThemeRouter = ControlCenterURLRouter()
    require(coldThemeRouter.receive([themeLink]) == nil, "cold theme link must wait for the runtime")
    require(
        coldThemeRouter.markReady() == "control-center/install/claude-creature",
        "cold theme link must keep its selected theme"
    )
    require(coldThemeRouter.markReady() == nil, "delivered theme link must be cleared")
    require(
        warmRouter.receive([themeLink]) == "control-center/install/claude-creature",
        "warm theme link must navigate immediately"
    )
    var route = ControlCenterRoute()
    require(route.path == "control-center", "the window must start at the Control Center")
    route.open("control-center/install/claude-creature")
    require(
        route.path == "control-center/install/claude-creature",
        "a theme link must stay the target until its page has loaded, so retries reach it"
    )
    route.didLoad()
    require(
        route.path == "control-center",
        "a reopened window must not load the theme link's page a second time"
    )
    var queuedRouter = ControlCenterURLRouter()
    _ = queuedRouter.receive([URL(string: "vibetv://open-control-center")!])
    _ = queuedRouter.receive([themeLink])
    require(
        queuedRouter.markReady() == "control-center/install/claude-creature",
        "the latest cold link must keep its selected theme"
    )
    require(
        installThemeID(from: URL(string: "vibetv://install-theme/\(String(repeating: "a", count: 64))")!) != nil,
        "the maximum valid theme ID must be accepted"
    )
    for rejectedThemeLink in [
        "vibetv://install-theme",
        "vibetv://install-theme/",
        "vibetv://install-theme/clippy/",
        "vibetv://install-theme/clippy/extra",
        "vibetv://install-theme/Clippy",
        "vibetv://install-theme/a",
        "vibetv://install-theme/\(String(repeating: "a", count: 65))",
        "vibetv://install-theme/claude_creature",
        "vibetv://install-theme/-clippy",
        "vibetv://install-theme/clippy-",
        "vibetv://install-theme/clippy--dark",
        "vibetv://install-theme/%63lippy",
        "vibetv://install-theme/clippy%2Fextra",
        "vibetv://install-theme/clippy?source=shop",
        "vibetv://install-theme/clippy#install",
        "vibetv://user@install-theme/clippy",
        "vibetv://install-theme:42/clippy",
        "vibetv://install-theme/clippy/../synthwave",
        "https://install-theme/clippy",
    ] {
        require(
            installThemeID(from: URL(string: rejectedThemeLink)!) == nil,
            "malformed theme link must not enter the local app: \(rejectedThemeLink)"
        )
    }

    var invalidRouter = ControlCenterURLRouter()
    require(
        invalidRouter.receive([URL(string: "vibetv://install-theme")!]) == nil,
        "invalid URL must not open the Control Center"
    )
    require(invalidRouter.markReady() == nil, "invalid URL must not be queued")

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
        runtimeRegistrationNeedsRefresh(
            repairRequested: true,
            registeredVersion: "1.0.64+64",
            currentVersion: "1.0.64+64"
        ),
        "a Restart service request must replace the runtime registration even when its version matches"
    )
    require(
        !runtimeRegistrationNeedsRefresh(
            repairRequested: false,
            registeredVersion: "1.0.64+64",
            currentVersion: "1.0.64+64"
        ),
        "an ordinary start must keep a registration whose version matches"
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
        !isInstalledApplicationsBundle(
            URL(fileURLWithPath: "/Users/customer/CodexBackups/Applications/VibeTV Control Center.app")
        ),
        "a historical backup app must not become the URL handler"
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

    // Issue #220: what the menu bar item shows for one /v1/status answer.
    func menuBar(_ json: String?) -> MenuBarStatus {
        menuBarStatus(statusJSON: json.map { Data($0.utf8) })
    }
    let notReachable = MenuBarStatus(
        icon: .offline,
        lines: ["Mac App: Not reachable", "VibeTV: Not connected", "Display: Not available"]
    )
    require(
        menuBar(nil) == notReachable,
        "a background service that does not answer must read as not reachable"
    )
    require(
        menuBar("<html>") == notReachable,
        "an answer that is not a status must read as not reachable"
    )
    require(
        menuBar(
            #"{"ok":true,"companion":{"version":"1.9.0"},"device":{"connected":false,"paired":false,"ready":false,"active":false,"connectionState":"setup_required"},"setup":{"providerSelectionRequired":true}}"#
        ) == MenuBarStatus(
            icon: .actionRequired,
            lines: ["Mac App: Online 1.9.0", "VibeTV: Not set up", "Display: Not available"]
        ),
        "a Mac without a chosen VibeTV must ask for setup"
    )
    require(
        menuBar(
            #"{"ok":true,"companion":{"version":"1.9.0"},"device":{"target":"cable://vibetv","deviceId":"16199235","connected":true,"paired":true,"ready":true,"active":true,"connectionState":"ready","capabilities":{"transport":{"active":"usb","mode":"cable"}},"stream":{"healthy":true,"running":true},"standby":{"active":false}},"setup":{"providerSelectionRequired":false}}"#
        ) == MenuBarStatus(
            icon: .healthy,
            lines: ["Mac App: Online 1.9.0", "VibeTV 16199235: Connected by Cable", "Display: Live"]
        ),
        "a ready VibeTV on the cable must read as connected by Cable"
    )
    let wifiReady =
        #"{"ok":true,"companion":{"version":"1.9.0"},"device":{"target":"http://192.168.178.163","deviceId":"vibetv-8caab5","connected":true,"paired":true,"ready":true,"active":true,"connectionState":"ready","capabilities":{"transport":{"active":"wifi","mode":"wifi","supported":["wifi","usb"]}},"stream":{"healthy":true,"running":true}STANDBY},"setup":{"providerSelectionRequired":SETUP}FIRMWARE}"#
    func wifi(
        standby: String = "",
        setup: String = "false",
        firmware: String = ""
    ) -> MenuBarStatus {
        menuBar(
            wifiReady
                .replacingOccurrences(of: "STANDBY", with: standby)
                .replacingOccurrences(of: "SETUP", with: setup)
                .replacingOccurrences(of: "FIRMWARE", with: firmware)
        )
    }
    require(
        wifi() == MenuBarStatus(
            icon: .healthy,
            lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Connected over WiFi", "Display: Live"]
        ),
        "a ready VibeTV on WiFi must read as connected over WiFi"
    )
    // Several VibeTVs: the status names the one this Mac controls, and the
    // menu names that one by its ID, as the picker in setup does.
    require(
        wifi().lines[1].hasPrefix("VibeTV vibetv-8caab5: "),
        "the menu must name the selected VibeTV"
    )
    require(
        wifi(standby: #","standby":{"active":true}"#).lines[2] == "Display: Screensaver",
        "a VibeTV in standby must read as showing its screensaver"
    )
    require(
        wifi(setup: "true") == MenuBarStatus(
            icon: .actionRequired,
            lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Connected over WiFi", "Display: Needs attention"]
        ),
        "an open provider choice must read as needing attention"
    )
    require(
        wifi(firmware: #","firmwareUpdate":{"phase":"installing"}"#).icon == .updating,
        "a firmware update must show while VibeTV still answers"
    )
    require(
        wifi(firmware: #","firmwareUpdate":{"phase":"completed"}"#).icon == .healthy,
        "a finished firmware update must not read as updating"
    )
    require(
        menuBar(
            #"{"ok":true,"companion":{"version":"1.9.0"},"device":{"target":"http://192.168.178.163","deviceId":"vibetv-8caab5","connected":false,"paired":true,"ready":false,"active":true,"connectionState":"reconnecting"},"firmwareUpdate":{"phase":"installing"}}"#
        ) == MenuBarStatus(
            icon: .updating,
            lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Restarting", "Display: Update running"]
        ),
        "a VibeTV that restarts during its update must not read as lost"
    )
    func notReady(_ device: String) -> MenuBarStatus {
        menuBar(
            #"{"ok":true,"companion":{"version":"1.9.0"},"device":{"target":"http://192.168.178.163","deviceId":"vibetv-8caab5","active":true,"ready":false,"#
                + device + "}}"
        )
    }
    require(
        notReady(#""connected":false,"paired":true,"connectionState":"reconnecting""#)
            == MenuBarStatus(
                icon: .offline,
                lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Not connected", "Display: Not available"]
            ),
        "a VibeTV that does not answer must read as not connected"
    )
    require(
        notReady(#""connected":true,"paired":false,"stream":{"healthy":false,"running":true,"errorCode":"pairing_token_rejected"}"#)
            == MenuBarStatus(
                icon: .actionRequired,
                lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Needs attention", "Display: Not available"]
            ),
        "a rejected pairing must read as needing attention"
    )
    require(
        notReady(#""connected":true,"paired":true,"connectionState":"provider_setup_required","stream":{"healthy":false,"running":true,"errorCode":"display_send_failed"}"#)
            == MenuBarStatus(
                icon: .healthy,
                lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Connected over WiFi", "Display: Waiting for first image"]
            ),
        "a stream that fails to send must read as waiting for the first image"
    )
    require(
        notReady(#""connected":true,"paired":true,"connectionState":"provider_setup_required","stream":{"healthy":false,"running":true}"#)
            .lines[2] == "Display: Waiting for usage",
        "a running stream without usage yet must read as waiting for usage"
    )
    require(
        notReady(#""connected":true,"paired":true,"connectionState":"provider_setup_required","stream":{"healthy":false,"running":true,"errorCode":"provider_setup_required"}"#)
            == MenuBarStatus(
                icon: .actionRequired,
                lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Connected over WiFi", "Display: Needs attention"]
            ),
        "a VibeTV without usage from any provider must read as needing attention"
    )
    require(
        notReady(#""connected":true,"paired":true,"connectionState":"display_render_failed","stream":{"healthy":false,"running":true}"#)
            == MenuBarStatus(
                icon: .actionRequired,
                lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Connected over WiFi", "Display: Theme not shown"]
            ),
        "a theme VibeTV cannot draw must be named"
    )
    // Without a place of its own the item lands off the screen on a full
    // menu bar; macOS reads the place under this key, for this name.
    require(
        menuBarItemDefaults["NSStatusItem Preferred Position VibeTVMenuBarItem"] == 400,
        "the menu bar item must start at a place right of the notch"
    )
    // A VibeTV that stopped answering stays "connected" for a short while,
    // in the state "reconnecting", with the stream error it had before.
    for staleStream in [
        #","stream":{"healthy":false,"running":true,"errorCode":"provider_setup_required"}"#,
        #","stream":{"healthy":false,"running":true}"#,
        "",
    ] {
        require(
            notReady(#""connected":true,"paired":true,"connectionState":"reconnecting""# + staleStream)
                == MenuBarStatus(
                    icon: .offline,
                    lines: ["Mac App: Online 1.9.0", "VibeTV vibetv-8caab5: Reconnecting", "Display: Not available"]
                ),
            "a VibeTV that is reconnecting must not send the customer to the providers"
        )
    }
    require(
        menuBar(
            #"{"ok":true,"companion":{"version":"1.9.0"},"device":{"deviceId":"vibetv-8caab5","connected":true,"paired":true,"ready":false,"active":true,"connectionState":"reconnecting"},"firmwareUpdate":{"phase":"installing"}}"#
        ).icon == .updating,
        "a VibeTV that reconnects during its update must read as updating"
    )
    // The state is told without colour: by the symbol, a mark, and in words.
    require(
        [MenuBarIcon.starting, .healthy, .actionRequired, .offline, .updating]
            .map { "\($0.symbolName)\($0.mark)" }
            == ["tv", "tv", "tv!", "tv.slash", "tv↑"],
        "each state must have a shape of its own"
    )
    require(
        Set(
            [MenuBarIcon.starting, .healthy, .actionRequired, .offline, .updating]
                .map(\.accessibilityLabel)
        ).count == 5,
        "each state must be said in words of its own"
    )
}


#endif
