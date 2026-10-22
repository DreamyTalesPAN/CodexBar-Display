package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themeinstall"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

const (
	releaseStateSchemaVersion = 1
	releaseStateFileName      = "release-state.json"
	protocolVersionV1         = 1
	defaultReleaseRepo        = "DreamyTalesPAN/CodexBar-Display"
	githubAPIBaseURL          = "https://api.github.com"
	githubDownloadBaseURL     = "https://github.com"
	vibeTVFirmwareManifestURL = "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/firmware-manifest.json"
	otaUploadBytesPerSecond   = 32 * 1024
	otaRawWriteChunkBytes     = 64
	otaRawWritePause          = 10 * time.Millisecond
	otaRawWriteBufferBytes    = 2 * 1024
	otaRawAckBlockBytes       = 1024
	otaRawAckTimeout          = 30 * time.Second
	otaRawHeaderPause         = 250 * time.Millisecond
)

var (
	errFirmwareUploadRestartRequired = errors.New("VibeTV must restart before another firmware upload")
	errFirmwareUploadMayHaveWritten  = errors.New("firmware upload may have written data")
	// Current firmware installs updates only over the USB cable (#489).
	errFirmwareUpdateCableOnly   = themeinstall.ErrFirmwareUpdateCableOnly
	upgradeStopLaunchAgentFn     = stopLaunchAgentBestEffort
	upgradeRestartLaunchAgentFn  = restartLaunchAgent
	rollbackRestartLaunchAgentFn = restartLaunchAgent
	rollbackStopTaskFn           = func(home string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		label := runtimepaths.DisplayStreamLaunchAgentLabel()
		return service.New(label, home, false).Stop(ctx, true)
	}
	resolveSerialPortFn                                = usb.ResolvePort
	readDeviceHelloFn                                  = usb.ReadDeviceHello
	closeDefaultSenderFn                               = usb.CloseDefaultSender
	ensureSerialPortNotBusyFn                          = ensureSerialPortNotBusy
	loadReleaseStateFn                                 = loadReleaseState
	saveReleaseStateFn                                 = saveReleaseState
	snapshotInstalledCompanionBinaryFn                 = snapshotInstalledCompanionBinary
	runRestoreKnownGoodCommandFn                       = runRestoreKnownGood
	releaseHTTPClient                  releaseHTTPDoer = &http.Client{Timeout: 5 * time.Minute}
	discoverWiFiDeviceFn                               = transportlayer.DiscoverWiFiDevice
	flashReleaseFirmwareImageFn                        = flashReleaseFirmwareImage
	uploadFirmwareOTAFn                                = uploadFirmwareOTA
	resolveCableFirmwarePortFn                         = usb.ResolveVibeTVControlPort
	readCableFirmwareHelloFn                           = usb.ReadDeviceHello
	transferCableFirmwareFn                            = usb.TransferFirmware
	findLegacyCableVibeTVFn                            = usb.FindLegacyCableVibeTV
	flashCableRescueFn                                 = usb.FlashESP8266AppImageWithOptions
	closeCableSenderFn                                 = usb.CloseDefaultSender
	listCablePortsFn                                   = usb.ListPorts
	cableRescueRetryPause                              = 3 * time.Second
	cableFirmwareVerifyTimeout                         = 120 * time.Second
	cableFirmwareVerifyPollInterval                    = time.Second
	firmwareRawDialContextFn                           = dialFirmwareRawConnection
	firmwareRawOTAPort                                 = "8081"
	firmwareHTTPVerifyPollInterval                     = 2 * time.Second
	firmwareHTTPVerifyProbeTimeout                     = 2 * time.Second
	firmwareUpdateRediscoveryAfter                     = 10 * time.Second
	firmwareUpdateRediscoveryInterval                  = 5 * time.Second
	firmwareInterruptedVerifyTimeout                   = 20 * time.Second
	firmwareUpdateRuntimeHealthOrigin                  = "http://127.0.0.1:47832"
	firmwareUpdateRuntimeHealthTimeout                 = time.Second
	themeRestoreHelloTimeout                           = 60 * time.Second
)

// An aborted upload does not always reboot the device straight away, so the
// stored theme can still look active for a while and only go missing on the
// reboot that follows. These are vars so tests can shrink the watch.
var (
	themeRestorePollInterval = 2 * time.Second
	themeRestoreRebootWatch  = 30 * time.Second
)

// The Companion API job pauses the display stream itself before spawning the
// CLI updater and marks the child with this environment variable so the
// writer-quiesce gate does not refuse its own parent.
const firmwareUpdateParentPausedEnvVar = "VIBETV_UPDATE_PARENT_PAUSED"

// cableRescueTarget flashes a VibeTV whose firmware predates the Cable
// identity contract through its ROM loader. Only the rescue job passes it.
const cableRescueTarget = "cable-rescue://vibetv"
