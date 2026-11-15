package main

// badgeRGBA draws the unread badge: a red disc with the number (1 to 99) in white, as 32x32 BGRA pixels (top row first,
// straight alpha). The Windows taskbar overlay uses it; there is no art file to ship.
func badgeRGBA(n int) []byte {
	const size = 32
	if n < 1 {
		n = 1
	}
	if n > 99 {
		n = 99
	}
	px := make([]byte, size*size*4)
	set := func(x, y int, b, g, r byte) {
		if x < 0 || y < 0 || x >= size || y >= size {
			return
		}
		i := (y*size + x) * 4
		px[i], px[i+1], px[i+2], px[i+3] = b, g, r, 255
	}
	const c, rad = 15.5, 15.0
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := float64(x)-c, float64(y)-c
			if dx*dx+dy*dy <= rad*rad {
				set(x, y, 0x2f, 0x2f, 0xd3) // #D32F2F
			}
		}
	}
	digits := [10][5]string{
		{"111", "101", "101", "101", "111"}, {"010", "110", "010", "010", "111"}, {"111", "001", "111", "100", "111"},
		{"111", "001", "111", "001", "111"}, {"101", "101", "111", "001", "001"}, {"111", "100", "111", "001", "111"},
		{"111", "100", "111", "101", "111"}, {"111", "001", "001", "001", "001"}, {"111", "101", "111", "101", "111"},
		{"111", "101", "111", "001", "111"},
	}
	text := []int{n}
	scale := 4
	if n >= 10 {
		text, scale = []int{n / 10, n % 10}, 3
	}
	w := len(text)*3*scale + (len(text)-1)*scale
	x0, y0 := (size-w)/2, (size-5*scale)/2
	for k, d := range text {
		for row := 0; row < 5; row++ {
			for col := 0; col < 3; col++ {
				if digits[d][row][col] != '1' {
					continue
				}
				for sy := 0; sy < scale; sy++ {
					for sx := 0; sx < scale; sx++ {
						set(x0+k*4*scale+col*scale+sx, y0+row*scale+sy, 255, 255, 255)
					}
				}
			}
		}
	}
	return px
}
