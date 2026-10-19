package firmwareupdate

import (
	"encoding/json"
	"reflect"
	"testing"
)

// The Control Center parses these JSON keys from the event line, so the
// names and the omitempty behaviour are pinned here.
func TestEventJSONShapeOmitsEmptyFields(t *testing.T) {
	cases := []struct {
		name  string
		event Event
		want  map[string]any
	}{
		{
			name:  "zero value keeps only the required stage",
			event: Event{},
			want:  map[string]any{"stage": ""},
		},
		{
			name:  "false booleans are omitted",
			event: Event{Stage: "uploading", UploadAccepted: false, HelloVerified: false},
			want:  map[string]any{"stage": "uploading"},
		},
		{
			name:  "true booleans are written",
			event: Event{Stage: "verifying", ArtifactValidated: true, UploadAccepted: true, HelloVerified: true},
			want: map[string]any{
				"stage":             "verifying",
				"artifactValidated": true,
				"uploadAccepted":    true,
				"helloVerified":     true,
			},
		},
		{
			name: "every field uses its wire name",
			event: Event{
				Stage:             "verifying_health",
				Phase:             "installing",
				Outcome:           "interrupted",
				RetryPolicy:       "reconnect_cable",
				Firmware:          "1.0.1",
				ObservedFirmware:  "1.0.0",
				Target:            "cable://vibetv",
				DeviceID:          "device-cable",
				ArtifactValidated: true,
				UploadAccepted:    true,
				HelloVerified:     true,
			},
			want: map[string]any{
				"stage":             "verifying_health",
				"phase":             "installing",
				"outcome":           "interrupted",
				"retryPolicy":       "reconnect_cable",
				"firmware":          "1.0.1",
				"observedFirmware":  "1.0.0",
				"target":            "cable://vibetv",
				"deviceId":          "device-cable",
				"artifactValidated": true,
				"uploadAccepted":    true,
				"helloVerified":     true,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.event)
			if err != nil {
				t.Fatalf("marshal event: %v", err)
			}
			var got map[string]any
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatalf("unmarshal event: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("event JSON = %s, want keys %v", data, tc.want)
			}
		})
	}
}
