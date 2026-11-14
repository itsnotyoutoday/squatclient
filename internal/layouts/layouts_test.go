package layouts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSplit(t *testing.T) {
	src := "<!-- name: T -->\n<App>\n  <Mush />\n</App>\n<script>\n  const a = 1;\n</script>\n<lua>\nsquat.log('x')\n</lua>\n<style>\n.x { color: red }\n</style>\n"
	p, err := Split(src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Markup, "<Mush />") || strings.Contains(p.Markup, "name: T") || strings.Contains(p.Markup, "script") {
		t.Fatalf("markup %q", p.Markup)
	}
	if strings.TrimSpace(p.Script) != "const a = 1;" || strings.TrimSpace(p.Lua) != "squat.log('x')" || strings.TrimSpace(p.CSS) != ".x { color: red }" {
		t.Fatalf("%+v", p)
	}
	for name, bad := range map[string]string{
		"unclosed":   "<App />\n<script>\nx",
		"mismatch":   "<App />\n<script>\n</lua>",
		"stray end":  "<App />\n</script>",
		"no markup":  "<script>\nx\n</script>",
		"only blank": "\n\n",
	} {
		if _, err := Split(bad); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestStartersCompile(t *testing.T) {
	st := Starters()
	if len(st) < 4 {
		t.Fatalf("starters: %d", len(st))
	}
	for _, s := range st {
		c, err := Compile(s.ID, ".layout", s.Source, t.TempDir())
		if err != nil {
			t.Fatalf("%s: %v", s.ID, err)
		}
		if !strings.Contains(c.Code, "exports") || !strings.Contains(c.Code, "createElement") || !strings.Contains(c.Code, "Mush") {
			t.Fatalf("%s: odd output:\n%s", s.ID, c.Code)
		}
		if strings.Contains(c.Code, "name:") {
			t.Fatalf("%s: the name comment leaked into the code", s.ID)
		}
	}
}

func TestScriptLuaStyleAndPlainFiles(t *testing.T) {
	src := "<App>\n  <Mush />\n  <Text value={low ? 'LOW' : 'ok'} />\n  <InputBar />\n</App>\n<script>\nconst hp = useGmcp('Char.Vitals.hp');\nconst low = hp < 25;\n</script>\n<lua>\nsquat.var.set('a', 1)\n</lua>\n<style>\n.lay-text { color: red }\n</style>\n"
	c, err := Compile("t", ".layout", src, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.Code, "useGmcp") || !strings.Contains(c.Lua, "squat.var.set") || !strings.Contains(c.CSS, "color: red") {
		t.Fatalf("%+v", c)
	}
	// the same component written directly, as .tsx / .jsx / .ts / .js
	for ext, code := range map[string]string{
		".tsx": "export default function L(): JSX.Element { const n: number = 1; return <App><Mush />{n}</App>; }",
		".jsx": "export default function L() { return <App><Mush /></App>; }",
		".ts":  "export default function L() { const n: number = 1; return n; }",
		".js":  "export default function L() { return 1; }",
	} {
		if _, err := Compile("p", ext, code, t.TempDir()); err != nil {
			t.Errorf("%s: %v", ext, err)
		}
	}
}

// Errors point at the line of the file the user wrote, not at generated code.
func TestErrorsPointAtTheOriginalLine(t *testing.T) {
	src := "<App>\n  <Mush />\n  <Text value={oops(} />\n</App>\n"
	_, err := Compile("broken", ".layout", src, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "broken.layout:3:") {
		t.Fatalf("want an error at line 3, got %v", err)
	}
	src = "<App><Mush /></App>\n<script>\nconst a = ;\n</script>\n"
	_, err = Compile("broken2", ".layout", src, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "broken2.layout:3:") {
		t.Fatalf("script error line: %v", err)
	}
}

func TestImportSandbox(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "helper.js"), []byte("export const x = 42;"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(dir), "outside.js")
	_ = os.WriteFile(outside, []byte("export const y = 1;"), 0o600)
	defer os.Remove(outside)
	ok := "import { x } from './helper.js';\nimport React from 'react';\nimport * as sq from 'squat';\nexport default function L() { return <App>{x}</App>; }"
	if _, err := Compile("a", ".tsx", ok, dir); err != nil {
		t.Fatalf("allowed imports refused: %v", err)
	}
	for name, src := range map[string]string{
		"node module": "import fs from 'fs';\nexport default () => fs;",
		"package":     "import _ from 'lodash';\nexport default () => _;",
		"parent":      "import { y } from '../outside.js';\nexport default () => y;",
		"absolute":    "import { y } from '" + outside + "';\nexport default () => y;",
	} {
		if _, err := Compile("b", ".tsx", src, dir); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func newMgr(t *testing.T) *Manager {
	d := t.TempDir()
	return New(filepath.Join(d, "layouts"), filepath.Join(d, "consent.json"))
}

func TestConsentFlow(t *testing.T) {
	m := newMgr(t)
	if err := os.MkdirAll(m.Dir(), 0o700); err != nil {
		t.Fatal(err)
	}
	src := "<!-- name: Mine -->\n<App><Mush /><InputBar /></App>\n"
	if err := os.WriteFile(filepath.Join(m.Dir(), "mine.layout"), []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	l, _ := m.List()
	if len(l) != 1 || l[0].ID != "mine" || l[0].Name != "Mine" || l[0].Allowed {
		t.Fatalf("%+v", l)
	}
	// a layout nobody allowed does not run: no code, but the source to read
	b, err := m.Load("mine")
	if err != nil || !b.NeedsConsent || b.Code != "" || !strings.Contains(b.Source, "<Mush />") {
		t.Fatalf("%+v %v", b, err)
	}
	if err := m.Allow("mine", b.Hash, true); err != nil {
		t.Fatal(err)
	}
	b, _ = m.Load("mine")
	if b.NeedsConsent || b.Code == "" {
		t.Fatalf("allowed layout not compiled: %+v", b)
	}
	// changing the file withdraws the consent
	if err := os.WriteFile(filepath.Join(m.Dir(), "mine.layout"), []byte(src+"<script>\nconst x = 1;\n</script>\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if b, _ = m.Load("mine"); !b.NeedsConsent {
		t.Fatal("an edited layout ran without asking again")
	}
	// a compile error is reported, not thrown
	bad := "<App>\n<Text value={ }\n</App>\n"
	_ = os.WriteFile(filepath.Join(m.Dir(), "bad.layout"), []byte(bad), 0o600)
	l, _ = m.List()
	var hash string
	for _, x := range l {
		if x.ID == "bad" {
			hash = x.Hash
		}
	}
	_ = m.Allow("bad", hash, true)
	if b, err = m.Load("bad"); err != nil || b.Error == "" || b.Code != "" {
		t.Fatalf("%+v %v", b, err)
	}
	if _, err := m.Load("../etc/passwd"); err == nil {
		t.Fatal("a path was accepted as an id")
	}
	if _, err := m.Load("nope"); err == nil {
		t.Fatal("missing layout loaded")
	}
}

func TestSaveCompilesFirstAndAllowsItsOwnText(t *testing.T) {
	m := newMgr(t)
	if _, err := m.Save("x", "<App>\n<Text value={ }\n</App>"); err == nil {
		t.Fatal("a layout that does not compile was saved")
	}
	info, err := m.Save("good", "<App><Mush /><InputBar /></App>")
	if err != nil || !info.Allowed {
		t.Fatalf("%+v %v", info, err)
	}
	if b, _ := m.Load("good"); b.NeedsConsent || b.Code == "" {
		t.Fatalf("%+v", b)
	}
	if _, err := m.Save("Bad Id", "<App />"); err == nil {
		t.Fatal("bad id accepted")
	}
	if err := m.Delete("good"); err != nil {
		t.Fatal(err)
	}
	if l, _ := m.List(); len(l) != 0 {
		t.Fatalf("%+v", l)
	}
}

// The compiled code really runs: evaluate it with Node against a tiny React stand-in.
func TestCompiledCodeRuns(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	src := "<App>\n  <Mush />\n  <Text value={label} />\n</App>\n<script>\nconst label = 'hp:' + useGmcp('Char.Vitals.hp');\n</script>\n"
	c, err := Compile("run", ".layout", src, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	harness := `
const React = { createElement: (t, p, ...k) => ({ t: typeof t === 'string' ? t : t.name, p, k }), Fragment: 'frag' };
const names = ['App','Mush','Text','useGmcp'];
const api = { App: function App(){}, Mush: function Mush(){}, Text: function Text(){}, useGmcp: () => 77 };
const module = { exports: {} };
const require = (id) => id === 'react' ? React : id === 'squat' ? api : (() => { throw new Error('no ' + id) })();
new Function('React','require','module','exports', ...names, process.argv[1])(React, require, module, module.exports, ...names.map(n => api[n]));
const out = module.exports.default();
console.log(JSON.stringify(out));
`
	cmd := exec.Command(node, "-e", harness, c.Code)
	b, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node: %v\n%s", err, b)
	}
	got := string(b)
	if !strings.Contains(got, `"hp:77"`) || !strings.Contains(got, `"t":"App"`) || !strings.Contains(got, `"t":"Mush"`) {
		t.Fatalf("unexpected render tree: %s", got)
	}
}
