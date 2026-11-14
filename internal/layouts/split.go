package layouts

import (
	"errors"
	"regexp"
	"strings"
)

// A ".layout" file is markup followed by (or mixed with) code blocks, in the style of a Blazor @code block
// or a Vue single-file component (docs/LAYOUTS.md):
//
//	<App> ... </App>
//	<script> JavaScript or TypeScript run in the window: becomes the body of the layout component </script>
//	<lua>    Lua run in the engine as a plugin tied to the layout </lua>
//	<style>  CSS for the layout </style>
//
// Blocks start and end on lines of their own. Everything else is markup.

// Parts is a split ".layout" file.
type Parts struct {
	Markup  string
	Script  string
	Lua     string
	CSS     string
	markupL []int // original line numbers of the markup lines (1-based)
	scriptL []int
}

var (
	blockStart = regexp.MustCompile(`^\s*<(script|lua|style)(\s[^>]*)?>\s*$`)
	blockEnd   = regexp.MustCompile(`^\s*</(script|lua|style)>\s*$`)
)

// Split cuts a .layout source into its parts.
func Split(src string) (Parts, error) {
	var p Parts
	var markup, script, lua, css []string
	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")
	cur := ""
	curStart := 0
	for i, l := range lines {
		n := i + 1
		if cur == "" {
			if m := blockStart.FindStringSubmatch(l); m != nil {
				cur, curStart = m[1], n
				continue
			}
			if blockEnd.MatchString(l) {
				return p, errors.New("line " + itoa(n) + ": a closing block tag without a start")
			}
			markup = append(markup, l)
			p.markupL = append(p.markupL, n)
			continue
		}
		if m := blockEnd.FindStringSubmatch(l); m != nil {
			if m[1] != cur {
				return p, errors.New("line " + itoa(n) + ": </" + m[1] + "> closes <" + cur + ">")
			}
			cur = ""
			continue
		}
		switch cur {
		case "script":
			script = append(script, l)
			p.scriptL = append(p.scriptL, n)
		case "lua":
			lua = append(lua, l)
		case "style":
			css = append(css, l)
		}
	}
	if cur != "" {
		return p, errors.New("line " + itoa(curStart) + ": <" + cur + "> is never closed")
	}
	p.Markup = stripComments(strings.Join(markup, "\n"))
	p.Script = strings.Join(script, "\n")
	p.Lua = strings.Join(lua, "\n")
	p.CSS = strings.Join(css, "\n")
	if strings.TrimSpace(p.Markup) == "" {
		return p, errors.New("a layout needs markup (for example <App><Mush /><InputBar /></App>)")
	}
	return p, nil
}

var htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)

// stripComments removes <!-- ... --> comments (JSX has none), keeping the line count so error
// messages still point at the right line.
func stripComments(s string) string {
	return htmlComment.ReplaceAllStringFunc(s, func(c string) string { return strings.Repeat("\n", strings.Count(c, "\n")) })
}

func itoa(n int) string {
	const d = "0123456789"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{d[n%10]}, b...)
		n /= 10
	}
	return string(b)
}

// TSX builds the component source and a map from its lines back to lines of the original file (0 for
// lines the compiler added), so error messages point at the file the user wrote.
func (p Parts) TSX() (src string, lineMap []int) {
	var out []string
	add := func(s string, orig int) {
		out = append(out, s)
		lineMap = append(lineMap, orig)
	}
	add("export default function Layout() {", 0)
	for i, l := range strings.Split(p.Script, "\n") {
		if p.Script == "" {
			break
		}
		add(l, p.scriptL[i])
	}
	add("return (<>", 0)
	for i, l := range strings.Split(p.Markup, "\n") {
		add(l, p.markupL[i])
	}
	add("</>);", 0)
	add("}", 0)
	return strings.Join(out, "\n"), lineMap
}
