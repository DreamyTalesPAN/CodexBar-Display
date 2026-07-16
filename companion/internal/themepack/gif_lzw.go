package themepack

import (
	"bytes"
	"errors"
	"fmt"
)

const maxGIFLZWCodeBits = 12

// maxGIFLZWCodeWidth parses all image streams and returns the widest code
// actually read by a GIF decoder. It intentionally does not render pixels.
func maxGIFLZWCodeWidth(data []byte) (int, error) {
	if len(data) < 13 {
		return 0, errors.New("truncated header or logical screen descriptor")
	}
	if !bytes.Equal(data[:6], []byte("GIF87a")) && !bytes.Equal(data[:6], []byte("GIF89a")) {
		return 0, errors.New("invalid GIF header")
	}
	screenWidth := int(data[6]) | int(data[7])<<8
	screenHeight := int(data[8]) | int(data[9])<<8
	if screenWidth == 0 || screenHeight == 0 {
		return 0, errors.New("logical screen has zero width or height")
	}
	pos := 13
	packed := data[10]
	if packed&0x80 != 0 {
		if err := skipGIFBytes(data, &pos, gifColorTableBytes(packed), "global color table"); err != nil {
			return 0, err
		}
	}

	maxBits := 0
	images := 0
	for {
		if pos >= len(data) {
			return 0, errors.New("truncated GIF: missing trailer")
		}
		block := data[pos]
		pos++
		switch block {
		case 0x3b:
			if images == 0 {
				return 0, errors.New("GIF contains no image")
			}
			if pos != len(data) {
				return 0, errors.New("unexpected data after GIF trailer")
			}
			return maxBits, nil
		case 0x21:
			if pos >= len(data) {
				return 0, errors.New("truncated extension label")
			}
			pos++
			if _, err := readGIFSubBlocks(data, &pos, "extension"); err != nil {
				return 0, err
			}
		case 0x2c:
			if pos+9 > len(data) {
				return 0, errors.New("truncated image descriptor")
			}
			left := int(data[pos]) | int(data[pos+1])<<8
			top := int(data[pos+2]) | int(data[pos+3])<<8
			width := int(data[pos+4]) | int(data[pos+5])<<8
			height := int(data[pos+6]) | int(data[pos+7])<<8
			imagePacked := data[pos+8]
			pos += 9
			if width == 0 || height == 0 || left > screenWidth || top > screenHeight || width > screenWidth-left || height > screenHeight-top {
				return 0, errors.New("image dimensions exceed logical screen")
			}
			if imagePacked&0x80 != 0 {
				if err := skipGIFBytes(data, &pos, gifColorTableBytes(imagePacked), "local color table"); err != nil {
					return 0, err
				}
			}
			if pos >= len(data) {
				return 0, errors.New("truncated LZW minimum code size")
			}
			minimumCodeSize := int(data[pos])
			pos++
			compressed, err := readGIFSubBlocks(data, &pos, "image data")
			if err != nil {
				return 0, err
			}
			expectedPixels := uint64(width) * uint64(height)
			bits, err := validateGIFLZW(compressed, minimumCodeSize, expectedPixels)
			if err != nil {
				return 0, fmt.Errorf("invalid image LZW stream: %w", err)
			}
			if bits > maxBits {
				maxBits = bits
			}
			images++
		default:
			return 0, fmt.Errorf("unknown GIF block 0x%02x", block)
		}
	}
}

func gifColorTableBytes(packed byte) int {
	return 3 * (1 << (int(packed&0x07) + 1))
}

func skipGIFBytes(data []byte, pos *int, count int, label string) error {
	if count < 0 || *pos+count > len(data) {
		return fmt.Errorf("truncated %s", label)
	}
	*pos += count
	return nil
}

func readGIFSubBlocks(data []byte, pos *int, label string) ([]byte, error) {
	var joined []byte
	for {
		if *pos >= len(data) {
			return nil, fmt.Errorf("truncated %s sub-block length", label)
		}
		size := int(data[*pos])
		*pos++
		if size == 0 {
			return joined, nil
		}
		if *pos+size > len(data) {
			return nil, fmt.Errorf("truncated %s sub-block", label)
		}
		joined = append(joined, data[*pos:*pos+size]...)
		*pos += size
	}
}

type gifLSBCodeReader struct {
	data   []byte
	bitPos int
}

func (r *gifLSBCodeReader) read(width int) (int, error) {
	if width <= 0 || r.bitPos+width > len(r.data)*8 {
		return 0, errors.New("truncated LZW code")
	}
	code := 0
	for bit := 0; bit < width; bit++ {
		if r.data[(r.bitPos+bit)/8]&(1<<uint((r.bitPos+bit)%8)) != 0 {
			code |= 1 << uint(bit)
		}
	}
	r.bitPos += width
	return code, nil
}

func validateGIFLZW(data []byte, minimumCodeSize int, expectedPixels uint64) (int, error) {
	if minimumCodeSize < 2 || minimumCodeSize > 8 {
		return 0, fmt.Errorf("minimum code size %d is outside 2..8", minimumCodeSize)
	}
	if expectedPixels == 0 {
		return 0, errors.New("image has no pixels")
	}
	clearCode := 1 << uint(minimumCodeSize)
	eoiCode := clearCode + 1
	reader := gifLSBCodeReader{data: data}
	width := minimumCodeSize + 1
	nextCode := clearCode + 2
	maxBits := width
	codeLengths := make([]uint64, 1<<maxGIFLZWCodeBits)
	havePrevious := false
	haveClear := false
	haveData := false
	var previousLength uint64
	var emittedPixels uint64

	for {
		code, err := reader.read(width)
		if err != nil {
			return 0, fmt.Errorf("missing end-of-information code: %w", err)
		}
		if width > maxBits {
			maxBits = width
		}
		if code == clearCode {
			width = minimumCodeSize + 1
			nextCode = clearCode + 2
			havePrevious = false
			previousLength = 0
			haveClear = true
			continue
		}
		if !haveClear {
			return 0, errors.New("first code is not a clear code")
		}
		if code == eoiCode {
			if !haveData {
				return 0, errors.New("end-of-information code appears before image data")
			}
			if emittedPixels != expectedPixels {
				return 0, fmt.Errorf("decoded pixel count does not match image dimensions: got=%d expected=%d", emittedPixels, expectedPixels)
			}
			return maxBits, nil
		}
		if !havePrevious {
			if code >= clearCode {
				return 0, fmt.Errorf("first code after clear is not a literal: %d", code)
			}
			if emittedPixels >= expectedPixels {
				return 0, fmt.Errorf("decoded pixel count exceeds image dimensions: got>%d", expectedPixels)
			}
			havePrevious = true
			haveData = true
			previousLength = 1
			emittedPixels++
			continue
		}
		if code > nextCode {
			return 0, fmt.Errorf("code %d exceeds next dictionary code %d", code, nextCode)
		}
		var outputLength uint64
		switch {
		case code < clearCode:
			outputLength = 1
		case code < nextCode:
			outputLength = codeLengths[code]
		default:
			outputLength = previousLength + 1
		}
		if outputLength == 0 || emittedPixels > expectedPixels || outputLength > expectedPixels-emittedPixels {
			return 0, fmt.Errorf("decoded pixel count exceeds image dimensions: got>%d", expectedPixels)
		}
		emittedPixels += outputLength
		if nextCode < 1<<maxGIFLZWCodeBits {
			codeLengths[nextCode] = previousLength + 1
			nextCode++
			if nextCode == 1<<uint(width) && width < maxGIFLZWCodeBits {
				width++
			}
		}
		previousLength = outputLength
		haveData = true
	}
}
