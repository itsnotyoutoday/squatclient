package gfx

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Args is a parsed argument line: positional words and key=value pairs (in order).
type Args struct {
	Pos  []string
	Kw   map[string]string
	Keys []string // keyword names in the order given
	Raw  string   // the line as given
}

// tokens splits a line into words; "double" and 'single' quotes group, a backslash escapes inside
// double quotes. key="a b" keeps the key attached to the quoted value.
func tokens(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	have := false
	var q rune
	rs := []rune(s)
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		switch {
		case q != 0:
			if c == '\\' && q == '"' && i+1 < len(rs) {
				i++
				switch rs[i] {
				case 'n':
					cur.WriteRune('\n')
				case 't':
					cur.WriteRune('\t')
				default:
					cur.WriteRune(rs[i])
				}
			} else if c == q {
				q = 0
			} else {
				cur.WriteRune(c)
			}
		case c == '"' || c == '\'':
			q, have = c, true
		case c == ' ' || c == '\t':
			if have {
				out = append(out, cur.String())
				cur.Reset()
				have = false
			}
		default:
			cur.WriteRune(c)
			have = true
		}
	}
	if q != 0 {
		return nil, fmt.Errorf("unterminated %c quote", q)
	}
	if have {
		out = append(out, cur.String())
	}
	return out, nil
}

var kwRe = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_.]*)=(.*)$`)

// ParseArgs splits a line into positional arguments and key=value options.
func ParseArgs(s string) (Args, error) {
	a := Args{Kw: map[string]string{}, Raw: s}
	ts, err := tokens(s)
	if err != nil {
		return a, err
	}
	for _, t := range ts {
		if m := kwRe.FindStringSubmatch(t); m != nil {
			if _, dup := a.Kw[m[1]]; !dup {
				a.Keys = append(a.Keys, m[1])
			}
			a.Kw[m[1]] = m[2]
			continue
		}
		a.Pos = append(a.Pos, t)
	}
	return a, nil
}

// restAfter returns the raw text of s after its first n words (words split on blanks, quotes ignored),
// so free text such as a label or a TF command keeps its spacing.
func restAfter(s string, n int) string {
	s = strings.TrimLeft(s, " \t")
	for i := 0; i < n; i++ {
		j := strings.IndexAny(s, " \t")
		if j < 0 {
			return ""
		}
		s = strings.TrimLeft(s[j:], " \t")
	}
	return s
}

// stringProps are never converted to numbers or lists.
var stringProps = map[string]bool{
	"text": true, "font": true, "src": true, "d": true, "name": true, "id": true, "cursor": true,
	"blend": true, "align": true, "baseline": true, "anchor": true, "shader": true, "fit": true,
	"ease": true, "parent": true, "cmd": true, "label": true, "glsl": true, "mode": true, "space": true,
	"cap": true, "join": true, "source": true, "dock": true, "weight": true, "style": true,
}

var numRe = regexp.MustCompile(`^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`)

func isNum(s string) bool { return numRe.MatchString(s) }

func num(s string) (float64, error) {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0, fmt.Errorf("%q is not a number", s)
	}
	return f, nil
}

// nums parses a comma/space separated list of numbers.
func nums(s string) ([]float64, error) {
	var out []float64
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' }) {
		f, err := num(p)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}

// value converts one option value to its protocol form.
func value(key, s string) (any, error) {
	if stringProps[key] {
		return s, nil
	}
	if s == "" {
		return "", nil
	}
	switch s[0] {
	case '[', '{':
		var v any
		if err := json.Unmarshal([]byte(s), &v); err != nil {
			return nil, fmt.Errorf("%s: invalid JSON: %v", key, err)
		}
		return v, nil
	case '=':
		return s, nil // a binding expression, resolved by the renderer
	}
	switch s {
	case "true":
		return true, nil
	case "false":
		return false, nil
	}
	if strings.HasPrefix(s, "lin(") || strings.HasPrefix(s, "rad(") {
		return gradient(s)
	}
	if isNum(s) {
		return strconv.ParseFloat(s, 64)
	}
	if strings.Contains(s, ",") {
		parts := strings.Split(s, ",")
		all := true
		for _, p := range parts {
			if !isNum(strings.TrimSpace(p)) {
				all = false
				break
			}
		}
		if all {
			return nums(s)
		}
	}
	return s, nil
}

// gradient parses lin(angle;stops), lin(x1,y1,x2,y2;stops), rad(cx,cy,r;stops); a stop is color or color@pos.
func gradient(s string) (any, error) {
	if !strings.HasSuffix(s, ")") {
		return nil, fmt.Errorf("gradient %q: missing )", s)
	}
	body := s[4 : len(s)-1]
	head, stops, ok := strings.Cut(body, ";")
	if !ok {
		return nil, fmt.Errorf("gradient %q: expected head;stop,stop", s)
	}
	h, err := nums(head)
	if err != nil {
		return nil, fmt.Errorf("gradient %q: %v", s, err)
	}
	var st [][]any
	parts := strings.Split(stops, ",")
	// colors such as rgb(1,2,3) contain commas: rejoin parenthesised pieces
	var cols []string
	for i := 0; i < len(parts); i++ {
		p := parts[i]
		for strings.Count(p, "(") > strings.Count(p, ")") && i+1 < len(parts) {
			i++
			p += "," + parts[i]
		}
		cols = append(cols, p)
	}
	for i, c := range cols {
		pos := float64(i) / float64(max(len(cols)-1, 1))
		if j := strings.LastIndex(c, "@"); j > 0 {
			if f, err := num(c[j+1:]); err == nil {
				pos, c = f, c[:j]
			}
		}
		st = append(st, []any{pos, c})
	}
	if len(st) < 2 {
		return nil, fmt.Errorf("gradient %q needs at least two colors", s)
	}
	g := map[string]any{"stops": st}
	if s[:3] == "lin" {
		g["type"] = "linear"
		switch len(h) {
		case 1:
			g["angle"] = h[0]
		case 4:
			g["x1"], g["y1"], g["x2"], g["y2"] = h[0], h[1], h[2], h[3]
		default:
			return nil, fmt.Errorf("gradient %q: lin() takes an angle or x1,y1,x2,y2", s)
		}
	} else {
		g["type"] = "radial"
		if len(h) != 3 {
			return nil, fmt.Errorf("gradient %q: rad() takes cx,cy,r (fractions of the box)", s)
		}
		g["cx"], g["cy"], g["r"] = h[0], h[1], h[2]
	}
	return g, nil
}

// props converts keyword options to a property map, resolving aliases.
func (a Args) props(skip ...string) (map[string]any, error) {
	sk := map[string]bool{}
	for _, s := range skip {
		sk[s] = true
	}
	out := map[string]any{}
	for _, k := range a.Keys {
		if sk[k] {
			continue
		}
		v, err := value(k, a.Kw[k])
		if err != nil {
			return nil, err
		}
		setProp(out, k, v)
	}
	return out, nil
}

var aliases = map[string]string{
	"rot": "rotation", "angle": "rotation", "alpha": "opacity", "sw": "strokeWidth",
	"thickness": "strokeWidth", "lw": "strokeWidth", "px": "pivotX", "py": "pivotY", "radius": "r",
	"sx": "scaleX", "sy": "scaleY", "fg": "color", "bgcolor": "bg",
}

func setProp(m map[string]any, k string, v any) {
	if k == "scale" {
		m["scaleX"], m["scaleY"] = v, v
		return
	}
	if strings.HasPrefix(k, "shadow.") {
		sh, _ := m["shadow"].(map[string]any)
		if sh == nil {
			sh = map[string]any{}
			m["shadow"] = sh
		}
		sh[k[7:]] = v
		return
	}
	if strings.HasPrefix(k, "u.") { // custom shader uniforms
		u, _ := m["u"].(map[string]any)
		if u == nil {
			u = map[string]any{}
			m["u"] = u
		}
		u[k[2:]] = v
		return
	}
	if al, ok := aliases[k]; ok {
		k = al
	}
	m[k] = v
}
