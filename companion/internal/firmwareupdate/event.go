package firmwareupdate

const EventPrefix = "CODEX_FIRMWARE_UPDATE_EVENT "

type Event struct {
	Stage             string `json:"stage"`
	Phase             string `json:"phase,omitempty"`
	Outcome           string `json:"outcome,omitempty"`
	Firmware          string `json:"firmware,omitempty"`
	Target            string `json:"target,omitempty"`
	DeviceID          string `json:"deviceId,omitempty"`
	ArtifactValidated bool   `json:"artifactValidated,omitempty"`
	UploadAccepted    bool   `json:"uploadAccepted,omitempty"`
	HelloVerified     bool   `json:"helloVerified,omitempty"`
}
