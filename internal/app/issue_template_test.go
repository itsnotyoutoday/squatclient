package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// The issue form the wizard prefills must be valid for GitHub (ids unique, labels present) and must carry the prefill field ids the URL builder uses
// (frontend/src/lib/diaglog.ts), the public-repository warning and the private-delivery contact. No email address anywhere.
func TestIssueTemplateIsValid(t *testing.T) {
	dir := filepath.Join("..", "..", ".github", "ISSUE_TEMPLATE")
	raw, err := os.ReadFile(filepath.Join(dir, "diagnostics.yml"))
	if err != nil {
		t.Fatal(err)
	}
	var tpl struct {
		Name   string   `yaml:"name"`
		Desc   string   `yaml:"description"`
		Labels []string `yaml:"labels"`
		Body   []struct {
			Type  string         `yaml:"type"`
			ID    string         `yaml:"id"`
			Attrs map[string]any `yaml:"attributes"`
		} `yaml:"body"`
	}
	if err := yaml.Unmarshal(raw, &tpl); err != nil {
		t.Fatal(err)
	}
	if tpl.Name != "Bug report with diagnostics" || tpl.Desc == "" {
		t.Fatalf("name/description: %q %q", tpl.Name, tpl.Desc)
	}
	if strings.Join(tpl.Labels, ",") != "bug,alpha" {
		t.Fatalf("labels %v", tpl.Labels)
	}
	ids := map[string]bool{}
	for _, b := range tpl.Body {
		switch b.Type {
		case "markdown":
		case "input", "textarea", "checkboxes", "dropdown":
			if b.ID == "" || ids[b.ID] {
				t.Errorf("missing or duplicate id %q", b.ID)
			}
			ids[b.ID] = true
			if _, ok := b.Attrs["label"]; !ok {
				t.Errorf("%s has no label", b.ID)
			}
		default:
			t.Errorf("unknown element type %q", b.Type)
		}
	}
	for _, id := range []string{"what", "expected", "steps", "build", "os", "mode", "summary", "diagnostics", "private"} {
		if !ids[id] {
			t.Errorf("the template has no %q field", id)
		}
	}
	text := string(raw)
	for _, want := range []string{"public", "drag the zip here", "check it first", "Nveid", "startrekkin.net port 1701", "privately"} {
		if !strings.Contains(text, want) {
			t.Errorf("template lacks %q", want)
		}
	}
	if regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`).MatchString(text) {
		t.Error("the template must not contain an email address")
	}
	cfg, err := os.ReadFile(filepath.Join(dir, "config.yml"))
	if err != nil || !strings.Contains(string(cfg), "blank_issues_enabled: true") {
		t.Fatalf("config.yml: %v %q", err, cfg)
	}
}
