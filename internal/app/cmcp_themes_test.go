package app

import (
	"encoding/json"
	"os"
	"path/filepath"
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

// With CMCP_FIXTURES=<dir> the theme tokens are written as themes.json for the front end's screenshot script and tests.
func TestCmcpThemeFixtures(t *testing.T) {
	dir := os.Getenv("CMCP_FIXTURES")
	if dir == "" {
		t.Skip("CMCP_FIXTURES not set")
	}
	all := map[string]map[string]any{}
	for _, th := range config.CmcpThemes {
		all[th] = CmcpThemeTokens(th)
	}
	b, _ := json.MarshalIndent(all, "", " ")
	if err := os.WriteFile(filepath.Join(dir, "themes.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
}
