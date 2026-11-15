package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ExpandPath turns "~", "~/x" and (on Windows) "~\x" into the user's home folder. Anything else is returned as is.
func ExpandPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		if h, err := os.UserHomeDir(); err == nil {
			return filepath.Join(h, p[1:])
		}
	}
	return p
}

// CleanScriptDirs validates the scripts-folder settings: each path must be absolute (after ~ expansion), is
// cleaned, and empty or duplicate entries are dropped. The home form (~/...) is kept as typed so a settings file
// carried to another machine still points into that machine's home folder.
func CleanScriptDirs(scripts string, libs []string) (string, []string, error) {
	check := func(what, p string) (string, error) {
		p = strings.TrimSpace(p)
		if p == "" {
			return "", nil
		}
		if !filepath.IsAbs(ExpandPath(p)) {
			return "", fmt.Errorf("%s %q must be an absolute path (or start with ~/)", what, p)
		}
		if strings.HasPrefix(p, "~") {
			return p, nil
		}
		return filepath.Clean(p), nil
	}
	sc, err := check("scripts folder", scripts)
	if err != nil {
		return "", nil, err
	}
	var out []string
	seen := map[string]bool{}
	for _, l := range libs {
		c, err := check("library folder", l)
		if err != nil {
			return "", nil, err
		}
		if c != "" && !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return sc, out, nil
}
