package codexbar

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

func grantClaudeCredentials() error {
	path, err := ensureWindowsConfigDir()
	if err != nil {
		return err
	}
	return rewriteSettingsFile(path, settingsCodec{unprotect: dpapiUnprotect, protect: dpapiProtect})
}

func dpapiProtect(plain []byte) ([]byte, error) {
	var out windows.DataBlob
	in := windows.DataBlob{Size: uint32(len(plain)), Data: &plain[0]}
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("DPAPI protect: %w", err)
	}
	return copyBlob(out), nil
}

func dpapiUnprotect(protected []byte) ([]byte, error) {
	if len(protected) == 0 {
		return nil, fmt.Errorf("DPAPI unprotect: empty payload")
	}
	var out windows.DataBlob
	in := windows.DataBlob{Size: uint32(len(protected)), Data: &protected[0]}
	if err := windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("DPAPI unprotect: %w", err)
	}
	return copyBlob(out), nil
}

func copyBlob(blob windows.DataBlob) []byte {
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(blob.Data)))
	return append([]byte(nil), unsafe.Slice(blob.Data, blob.Size)...)
}
