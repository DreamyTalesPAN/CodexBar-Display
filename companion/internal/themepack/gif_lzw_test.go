package themepack

import (
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themespec"
)

func TestValidateAgainstCapabilitiesAcceptsGIFAtElevenBits(t *testing.T) {
	gif := testGIFWithLiteralCodes(t, 1000, false)
	pack := testGIFPack(t, gif)

	if err := pack.ValidateAgainstCapabilities(testGIFCapabilities(11)); err != nil {
		t.Fatalf("expected 11-bit GIF to be accepted: %v", err)
	}
}

func TestValidateAgainstCapabilitiesRejectsGIFAboveElevenBits(t *testing.T) {
	gif := testGIFWithLiteralCodes(t, 1800, false)
	pack := testGIFPack(t, gif)

	err := pack.ValidateAgainstCapabilities(testGIFCapabilities(11))
	if err == nil || !strings.Contains(err.Error(), "requires LZW code width 12 bits") || !strings.Contains(err.Error(), "at most 11 bits") {
		t.Fatalf("expected clear LZW width error, got %v", err)
	}
}

func TestValidateAgainstCapabilitiesZeroLZWLimitIsBackwardCompatible(t *testing.T) {
	gif := testGIFWithLiteralCodes(t, 1800, false)
	pack := testGIFPack(t, gif)

	if err := pack.ValidateAgainstCapabilities(testGIFCapabilities(0)); err != nil {
		t.Fatalf("expected zero capability to impose no width limit: %v", err)
	}
}

func TestMaxGIFLZWCodeWidthHandlesClearReset(t *testing.T) {
	gif := testGIFWithLiteralCodes(t, 300, true)

	bits, err := maxGIFLZWCodeWidth(gif)
	if err != nil {
		t.Fatalf("expected valid stream after clear reset: %v", err)
	}
	if bits != 10 {
		t.Fatalf("expected maximum width 10 before reset, got %d", bits)
	}
}

func TestValidateAgainstCapabilitiesRejectsMalformedReferencedGIF(t *testing.T) {
	gif := testGIFWithLiteralCodes(t, 10, false)
	gif = gif[:len(gif)-3]
	pack := testGIFPack(t, gif)

	err := pack.ValidateAgainstCapabilities(testGIFCapabilities(0))
	if err == nil || !strings.Contains(err.Error(), "GIF asset /themes/u/test.gif is malformed") || !strings.Contains(err.Error(), "truncated") {
		t.Fatalf("expected understandable malformed GIF error, got %v", err)
	}
}

func TestValidateAgainstCapabilitiesRejectsGIFWithEarlyEOI(t *testing.T) {
	gif := testGIFWithLiteralCodesAndPixelCount(t, 1, false, 2)
	pack := testGIFPack(t, gif)

	err := pack.ValidateAgainstCapabilities(testGIFCapabilities(0))
	if err == nil || !strings.Contains(err.Error(), "decoded pixel count does not match image dimensions") {
		t.Fatalf("expected early EOI pixel-count error, got %v", err)
	}
}

func TestValidateAgainstCapabilitiesRejectsGIFWithTooManyPixels(t *testing.T) {
	gif := testGIFWithLiteralCodesAndPixelCount(t, 2, false, 1)
	pack := testGIFPack(t, gif)

	err := pack.ValidateAgainstCapabilities(testGIFCapabilities(0))
	if err == nil || !strings.Contains(err.Error(), "decoded pixel count exceeds image dimensions") {
		t.Fatalf("expected excess pixel-count error, got %v", err)
	}
}

func testGIFPack(t *testing.T, gif []byte) *Pack {
	t.Helper()
	raw := []byte(`{"v":1,"id":"test-gif","rev":1,"fb":"mini","p":[{"t":"g","x":0,"y":0,"w":1,"h":1,"a":"/themes/u/test.gif"}]}`)
	spec, normalizedRaw, err := themespec.Parse(raw)
	if err != nil {
		t.Fatalf("parse test theme spec: %v", err)
	}
	return &Pack{
		ThemeSpec:    spec,
		ThemeSpecRaw: normalizedRaw,
		Assets: []File{{
			Entry: FileEntry{Path: "/themes/u/test.gif"},
			Data:  gif,
		}},
	}
}

func testGIFCapabilities(maxLZWBits int) protocol.DeviceCapabilities {
	return protocol.DeviceCapabilities{
		Known:                   true,
		SupportsThemeSpecV1:     true,
		MaxThemeSpecBytes:       4096,
		MaxThemePrimitives:      32,
		MaxThemeGifAssets:       1,
		MaxThemeGifBytes:        1 << 20,
		MaxThemeGifWidth:        80,
		MaxThemeGifHeight:       80,
		MaxThemeGifPixels:       6400,
		MaxThemeGifLzwBits:      maxLZWBits,
		SupportedPrimitiveTypes: []string{"gif"},
		BuiltinThemes:           []string{"mini"},
	}
}

func testGIFWithLiteralCodes(t *testing.T, literalCount int, resetBeforeEOI bool) []byte {
	t.Helper()
	expectedPixels := literalCount
	if resetBeforeEOI {
		expectedPixels++
	}
	return testGIFWithLiteralCodesAndPixelCount(t, literalCount, resetBeforeEOI, expectedPixels)
}

func testGIFWithLiteralCodesAndPixelCount(t *testing.T, literalCount int, resetBeforeEOI bool, expectedPixels int) []byte {
	t.Helper()
	if literalCount <= 0 || expectedPixels <= 0 {
		t.Fatalf("literal and expected pixel counts must be positive: literals=%d expected=%d", literalCount, expectedPixels)
	}
	const minimumCodeSize = 8
	clearCode := 1 << minimumCodeSize
	codes := make([]int, 0, literalCount+4)
	codes = append(codes, clearCode)
	for i := 0; i < literalCount; i++ {
		codes = append(codes, 0)
	}
	if resetBeforeEOI {
		codes = append(codes, clearCode, 0)
	}
	codes = append(codes, clearCode+1)
	compressed := packTestGIFCodes(t, minimumCodeSize, codes)
	width, height := testGIFDimensions(t, expectedPixels)

	gif := []byte("GIF89a")
	gif = append(gif,
		byte(width), byte(width>>8), byte(height), byte(height>>8), // logical width and height
		0x80, 0x00, 0x00, // global table present, two entries
		0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
		0x21, 0xfe, 0x03, 'L', 'Z', 'W', 0x00, // comment extension
		0x2c, 0x00, 0x00, 0x00, 0x00, byte(width), byte(width>>8), byte(height), byte(height>>8),
		0x80, // local table present, two entries
		0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
		minimumCodeSize,
	)
	for len(compressed) > 0 {
		size := len(compressed)
		if size > 255 {
			size = 255
		}
		gif = append(gif, byte(size))
		gif = append(gif, compressed[:size]...)
		compressed = compressed[size:]
	}
	return append(gif, 0x00, 0x3b)
}

func testGIFDimensions(t *testing.T, pixels int) (int, int) {
	t.Helper()
	width := 1
	for candidate := 1; candidate <= pixels/candidate; candidate++ {
		if pixels%candidate == 0 {
			width = candidate
		}
	}
	height := pixels / width
	if width > 0xffff || height > 0xffff {
		t.Fatalf("test GIF dimensions exceed uint16: pixels=%d width=%d height=%d", pixels, width, height)
	}
	return width, height
}

func packTestGIFCodes(t *testing.T, minimumCodeSize int, codes []int) []byte {
	t.Helper()
	clearCode := 1 << minimumCodeSize
	eoiCode := clearCode + 1
	width := minimumCodeSize + 1
	nextCode := clearCode + 2
	havePrevious := false
	bitPos := 0
	var out []byte

	for _, code := range codes {
		if code >= 1<<width {
			t.Fatalf("test code %d does not fit width %d", code, width)
		}
		for bit := 0; bit < width; bit++ {
			byteIndex := (bitPos + bit) / 8
			for byteIndex >= len(out) {
				out = append(out, 0)
			}
			if code&(1<<bit) != 0 {
				out[byteIndex] |= 1 << uint((bitPos+bit)%8)
			}
		}
		bitPos += width

		switch code {
		case clearCode:
			width = minimumCodeSize + 1
			nextCode = clearCode + 2
			havePrevious = false
		case eoiCode:
			return out
		default:
			if !havePrevious {
				havePrevious = true
				continue
			}
			if nextCode < 1<<maxGIFLZWCodeBits {
				nextCode++
				if nextCode == 1<<width && width < maxGIFLZWCodeBits {
					width++
				}
			}
		}
	}
	t.Fatal("test code stream has no end-of-information code")
	return nil
}
