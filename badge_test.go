package main

import "testing"

func TestBadgeRGBA(t *testing.T) {
	for _, n := range []int{0, 1, 7, 10, 42, 99, 500} {
		px := badgeRGBA(n)
		if len(px) != 32*32*4 {
			t.Fatalf("n=%d: %d bytes", n, len(px))
		}
		white, red := 0, 0
		for i := 0; i < len(px); i += 4 {
			switch {
			case px[i] == 255 && px[i+1] == 255 && px[i+2] == 255 && px[i+3] == 255:
				white++
			case px[i+2] == 0xd3 && px[i+3] == 255:
				red++
			}
		}
		if white < 10 || red < 300 {
			t.Fatalf("n=%d: the badge needs a red disc and a white number (white=%d red=%d)", n, white, red)
		}
	}
}
