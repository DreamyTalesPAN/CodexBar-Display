package theme

// Short forms of production functions that only the tests call.

func DefaultProtocolName() string {
	return Classic
}

func Definitions() []Definition {
	out := make([]Definition, len(registry))
	copy(out, registry)
	return out
}
