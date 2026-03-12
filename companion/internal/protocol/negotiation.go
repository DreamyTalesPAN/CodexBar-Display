package protocol

const (
	ProtocolVersionV1 = 1
	ProtocolVersionV2 = 2
)

var hostSupportedProtocolVersions = []int{ProtocolVersionV2, ProtocolVersionV1}

func HostSupportedProtocolVersions() []int {
	out := make([]int, len(hostSupportedProtocolVersions))
	copy(out, hostSupportedProtocolVersions)
	return out
}

func IsSupportedProtocolVersion(version int) bool {
	switch version {
	case ProtocolVersionV1, ProtocolVersionV2:
		return true
	default:
		return false
	}
}

func NormalizeProtocolVersion(version int) int {
	if IsSupportedProtocolVersion(version) {
		return version
	}
	return ProtocolVersionV1
}

func NegotiateProtocolVersion(deviceSupported []int, devicePreferred int, legacyProtocolVersion int) int {
	deviceSet := make(map[int]struct{}, len(deviceSupported)+1)
	for _, version := range deviceSupported {
		if !IsSupportedProtocolVersion(version) {
			continue
		}
		deviceSet[version] = struct{}{}
	}

	if len(deviceSet) == 0 && IsSupportedProtocolVersion(legacyProtocolVersion) {
		deviceSet[legacyProtocolVersion] = struct{}{}
	}
	if len(deviceSet) == 0 {
		return ProtocolVersionV1
	}

	if IsSupportedProtocolVersion(devicePreferred) {
		if _, ok := deviceSet[devicePreferred]; ok {
			for _, hostVersion := range hostSupportedProtocolVersions {
				if hostVersion == devicePreferred {
					return devicePreferred
				}
			}
		}
	}

	for _, hostVersion := range hostSupportedProtocolVersions {
		if _, ok := deviceSet[hostVersion]; ok {
			return hostVersion
		}
	}

	return ProtocolVersionV1
}
