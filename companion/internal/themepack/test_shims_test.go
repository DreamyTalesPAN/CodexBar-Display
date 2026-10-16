package themepack

// Short forms of production functions that only the tests call.

func Load(packPath string) (*Pack, error) {
	return LoadVerified(packPath, "", 0)
}
