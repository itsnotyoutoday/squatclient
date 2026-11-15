package app

import (
	"regexp"
	"testing"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

func TestCmcpThemeTokens(t *testing.T) {
	hex := regexp.MustCompile(`^#[0-9a-f]{6}$`)
	for _, th := range config.CmcpThemes {
		tk := CmcpThemeTokens(th)
		if tk == nil {
			t.Fatalf("theme %s has no tokens", th)
		}
		for _, k := range []string{"color.bg", "color.panel", "color.text", "color.dim", "color.accent", "color.accent2", "color.ok", "color.warn", "color.alert"} {
			if s, _ := tk[k].(string); !hex.MatchString(s) {
				t.Errorf("%s %s = %v", th, k, tk[k])
			}
		}
	}
	if CmcpThemeTokens("nope") != nil {
		t.Fatal("unknown theme must fall back to the client defaults")
	}
}
