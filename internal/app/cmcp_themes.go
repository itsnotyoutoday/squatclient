package app

import (
	"fmt"
	"strconv"
)

// The design tokens (cmcp spec 6.7) of the seven console themes, taken from the palettes of the Lua themes in
// plugins/squat-gfx (theme_*.lua, lcars.lua "tng"): accent = p, accent2 = k, text = s, alert = r, warn = x.
// The panel and dim tones are mixed from the background so every theme stays readable.
type themeSpec struct {
	bg, p, s, k, x, r string
	font, title       string
	radius            float64
}

var themeSpecs = map[string]themeSpec{
	"tng":     {"#000000", "#ff9900", "#ffcc99", "#99ccff", "#ffcc66", "#cc6666", "Antonio", "Antonio", 14},
	"soft":    {"#090b0d", "#d98a63", "#e6d6c4", "#9cc2c6", "#e0b48e", "#c26b5a", "Rajdhani", "Rajdhani", 6},
	"klingon": {"#050102", "#c1121f", "#b0a8a0", "#d4b86a", "#c9a84c", "#e63946", "Teko", "Teko", 0},
	"romulan": {"#020805", "#4fe39a", "#9fd9b8", "#7fc7a5", "#e8a63a", "#c47a2c", "Rajdhani", "Rajdhani", 0},
	"tos":     {"#1e2125", "#e8372c", "#f5f1e6", "#9fd0ff", "#f2c230", "#2aa75b", "Orbitron", "Orbitron", 10},
	"ferengi": {"#12060a", "#d4a017", "#e8c872", "#e6b655", "#f0d98c", "#b5651d", "Cinzel", "Cinzel", 8},
	"ops":     {"#040506", "#ff3b2f", "#efe6d2", "#7fd0dc", "#e8923a", "#ff7a2a", "Rajdhani", "Rajdhani", 0},
}

func hex3(c string) (r, g, b float64) {
	v, _ := strconv.ParseUint(c[1:7], 16, 32)
	return float64(v >> 16 & 255), float64(v >> 8 & 255), float64(v & 255)
}

func mix(a, b string, t float64) string {
	ar, ag, ab := hex3(a)
	br, bg, bb := hex3(b)
	f := func(x, y float64) int { return int(x + (y-x)*t + 0.5) }
	return fmt.Sprintf("#%02x%02x%02x", f(ar, br), f(ag, bg), f(ab, bb))
}

// CmcpThemeTokens returns the tokens of a theme (nil for an unknown name: the client defaults apply).
func CmcpThemeTokens(theme string) map[string]any {
	t, ok := themeSpecs[theme]
	if !ok {
		return nil
	}
	return map[string]any{
		"color.bg": t.bg, "color.panel": mix(t.bg, t.p, 0.14), "color.text": t.s, "color.dim": mix(t.s, t.bg, 0.45),
		"color.accent": t.p, "color.accent2": t.k, "color.ok": "#66dd88", "color.warn": t.x, "color.alert": t.r,
		"font.body": t.font, "font.title": t.title, "radius": t.radius, "stroke": 1.0,
	}
}
