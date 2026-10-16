package themeinstall

// Short forms of production functions that only the tests call.

func ResolveSource(packPath, catalogRef, themeID string) (string, error) {
	resolved, err := resolveSource(packPath, catalogRef, themeID, "", 0)
	return resolved.Path, err
}
