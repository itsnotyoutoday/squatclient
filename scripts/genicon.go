//go:build ignore

// genicon renders build/appicon.png (1024x1024): a rounded dark tile with a
// ">_" prompt. Run: go run scripts/genicon.go
package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

const size = 1024

func inRoundRect(x, y, r float64) bool {
	const lo, hi = 64.0, size - 64.0
	if x < lo || x > hi || y < lo || y > hi {
		return false
	}
	cx := math.Min(math.Max(x, lo+r), hi-r)
	cy := math.Min(math.Max(y, lo+r), hi-r)
	return (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r
}

// distSeg is the distance from p to segment ab.
func distSeg(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	t := ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(px-(ax+t*dx), py-(ay+t*dy))
}

func main() {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	accent := color.NRGBA{0x4c, 0x8d, 0xff, 255}
	warm := color.NRGBA{0xf0, 0xc6, 0x74, 255}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			fx, fy := float64(x)+0.5, float64(y)+0.5
			if !inRoundRect(fx, fy, 200) {
				continue
			}
			t := fy / size
			c := color.NRGBA{uint8(20 + 14*t), uint8(22 + 16*t), uint8(26 + 30*t), 255}
			// ">" chevron
			if d := math.Min(distSeg(fx, fy, 300, 330, 540, 512), distSeg(fx, fy, 540, 512, 300, 694)); d < 44 {
				c = accent
			}
			// "_" cursor block
			if fx > 580 && fx < 760 && fy > 650 && fy < 710 {
				c = warm
			}
			img.SetNRGBA(x, y, c)
		}
	}
	f, err := os.Create("build/appicon.png")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}
