package gfx

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// typeSpec: the positional arguments of /gfx TYPE ID ... for each object type.
var typeSpec = map[string][]string{
	"group": nil, "layer": nil, "elbow": {"x", "y", "w", "h"},
	"rect": {"x", "y", "w", "h"}, "rrect": {"x", "y", "w", "h", "r"}, "pill": {"x", "y", "w", "h"},
	"circle": {"x", "y", "r"}, "ellipse": {"x", "y", "rx", "ry"},
	"arc":  {"x", "y", "r0", "r1", "a0", "a1"},
	"line": {"x1", "y1", "x2", "y2"}, "polyline": {"@points"}, "polygon": {"@points"}, "path": {"d"},
	"text": {"x", "y", "text"}, "image": {"x", "y", "src"},
	"button": {"x", "y", "w", "h", "text"},
	"planet": {"x", "y", "r"}, "starfield": {"x", "y", "w", "h", "count"}, "emitter": {"x", "y"},
	"shader": {"x", "y", "w", "h", "shader"}, "radar": {"x", "y", "r"}, "graph": {"x", "y", "w", "h"},
}

// typeAlias maps the short command names to protocol types (and sets default props).
var typeAlias = map[string]struct {
	typ   string
	props map[string]any
}{
	"rrect": {"rect", nil}, "poly": {"polygon", nil}, "stars": {"starfield", nil}, "emit": {"emitter", nil},
	"pill": {"rect", map[string]any{"pill": true}},
}

func init() {
	typeSpec["poly"] = typeSpec["polygon"]
	typeSpec["stars"] = typeSpec["starfield"]
	typeSpec["emit"] = typeSpec["emitter"]
}

var eventNames = map[string]bool{"click": true, "down": true, "up": true, "enter": true, "leave": true, "move": true, "wheel": true, "drag": true, "settle": true}

func (h *Hub) cur(create bool) *scene { return h.st.get("", create) }

func (h *Hub) needNode(s *scene, id string) error {
	if id == "" {
		return fmt.Errorf("gfx: an object id is required")
	}
	if _, ok := s.nodes[id]; ok {
		return nil
	}
	// children of composite objects (button.bg, button.label) are addressed by dotted ids
	if i := strings.IndexByte(id, '.'); i > 0 {
		if _, ok := s.nodes[id[:i]]; ok {
			return nil
		}
	}
	return fmt.Errorf("gfx: no object %q in scene %q (/gfx list)", id, s.id)
}

func (h *Hub) gfxCmd(line string) error {
	if line == "" {
		return h.gfxHelp()
	}
	sub, rest, _ := strings.Cut(line, " ")
	sub = strings.ToLower(sub)
	rest = strings.TrimSpace(rest)
	if sub == "new" {
		t, r2, _ := strings.Cut(rest, " ")
		if t == "" {
			return fmt.Errorf("gfx: usage /gfx new TYPE ID [args]")
		}
		sub, rest = strings.ToLower(t), strings.TrimSpace(r2)
		if _, ok := typeSpec[sub]; !ok {
			return fmt.Errorf("gfx: unknown object type %q", sub)
		}
	}
	if _, ok := typeSpec[sub]; ok {
		return h.create(sub, rest)
	}
	a, err := ParseArgs(rest)
	if err != nil {
		return fmt.Errorf("gfx %s: %v", sub, err)
	}
	switch sub {
	case "open":
		return h.open(a)
	case "close":
		s := h.st.get(firstOr(a.Pos, ""), false)
		if s == nil {
			return fmt.Errorf("gfx: no such scene")
		}
		h.emit(s, Op{"op": "scene", "scene": s.id, "open": false})
	case "scene":
		if len(a.Pos) == 0 {
			h.echo("current scene: %s", h.st.cur)
			return nil
		}
		h.st.get(a.Pos[0], true)
		h.st.cur = a.Pos[0]
	case "clear":
		s := h.st.get(firstOr(a.Pos, ""), false)
		if s != nil {
			h.emit(s, Op{"op": "clear", "scene": s.id})
		}
	case "reset":
		for _, id := range h.st.order {
			if s := h.st.scenes[id]; s != nil {
				h.emit(s, Op{"op": "clear", "scene": s.id})
				h.emit(s, Op{"op": "scene", "scene": s.id, "open": false})
			}
		}
	case "bloom":
		s := h.cur(true)
		b := map[string]any{}
		for i, k := range []string{"strength", "radius", "threshold"} {
			if i < len(a.Pos) {
				f, err := num(a.Pos[i])
				if err != nil {
					return fmt.Errorf("gfx bloom: %v", err)
				}
				b[k] = f
			}
		}
		for k, v := range a.Kw {
			f, err := num(v)
			if err != nil {
				return fmt.Errorf("gfx bloom: %v", err)
			}
			b[k] = f
		}
		h.emit(s, Op{"op": "scene", "scene": s.id, "bloom": b})
	case "bg":
		if len(a.Pos) < 1 {
			return fmt.Errorf("gfx: usage /gfx bg COLOR")
		}
		s := h.cur(true)
		h.emit(s, Op{"op": "scene", "scene": s.id, "bg": a.Pos[0]})
	case "fps":
		s := h.cur(true)
		on := len(a.Pos) == 0 || a.Pos[0] == "on" || a.Pos[0] == "1"
		h.emit(s, Op{"op": "scene", "scene": s.id, "stats": on})
	case "set":
		return h.set(a)
	case "del", "delete":
		s := h.cur(true)
		for _, id := range a.Pos {
			if err := h.needNode(s, id); err != nil {
				return err
			}
			h.emit(s, Op{"op": "delete", "scene": s.id, "id": id})
		}
	case "move":
		if len(a.Pos) < 3 {
			return fmt.Errorf("gfx: usage /gfx move ID X Y")
		}
		return h.set(Args{Pos: a.Pos[:1], Kw: map[string]string{"x": a.Pos[1], "y": a.Pos[2]}, Keys: []string{"x", "y"}})
	case "show", "hide":
		for _, id := range a.Pos {
			if err := h.set(Args{Pos: []string{id}, Kw: map[string]string{"visible": strconv.FormatBool(sub == "show")}, Keys: []string{"visible"}}); err != nil {
				return err
			}
		}
	case "z", "raise", "lower":
		if len(a.Pos) < 1 {
			return fmt.Errorf("gfx: usage /gfx %s ID [Z]", sub)
		}
		z := "100"
		switch {
		case len(a.Pos) > 1:
			z = a.Pos[1]
		case sub == "lower":
			z = "-100"
		}
		return h.set(Args{Pos: a.Pos[:1], Kw: map[string]string{"z": z}, Keys: []string{"z"}})
	case "parent":
		if len(a.Pos) < 2 {
			return fmt.Errorf("gfx: usage /gfx parent ID PARENT")
		}
		s := h.cur(true)
		if err := h.needNode(s, a.Pos[0]); err != nil {
			return err
		}
		h.emit(s, Op{"op": "set", "scene": s.id, "id": a.Pos[0], "props": map[string]any{"parent": a.Pos[1]}})
		if n := s.nodes[a.Pos[0]]; n != nil {
			n.parent = a.Pos[1]
		}
	case "anim":
		return h.anim(a, nil)
	case "stop":
		s := h.cur(true)
		for _, id := range a.Pos {
			h.emit(s, Op{"op": "stop", "scene": s.id, "id": id})
		}
	case "timeline":
		if len(a.Pos) < 1 {
			return fmt.Errorf("gfx: usage /gfx timeline NAME [loop=N] [dur=SECONDS]")
		}
		s := h.cur(true)
		op := Op{"op": "timeline", "scene": s.id, "name": a.Pos[0], "steps": []Op{}}
		p, err := a.props()
		if err != nil {
			return err
		}
		for k, v := range p {
			op[k] = v
		}
		h.emit(s, op)
	case "at":
		return h.at(a, rest)
	case "play":
		s := h.cur(true)
		for _, n := range a.Pos {
			h.emit(s, Op{"op": "play", "scene": s.id, "name": n})
		}
	case "bind":
		if len(a.Pos) < 3 {
			return fmt.Errorf("gfx: usage /gfx bind ID PROP EXPRESSION")
		}
		s := h.cur(true)
		if err := h.needNode(s, a.Pos[0]); err != nil {
			return err
		}
		expr := restAfter(rest, 2)
		op := Op{"op": "bind", "scene": s.id, "id": a.Pos[0], "prop": canonProp(a.Pos[1])}
		if m := smoothRe.FindStringSubmatch(expr); m != nil { // trailing smooth=SECONDS eases the value between samples
			expr = strings.TrimSpace(expr[:len(expr)-len(m[0])])
			op["smooth"], _ = strconv.ParseFloat(m[1], 64)
		}
		op["expr"] = strings.Trim(expr, "\"'")
		h.emit(s, op)
	case "unbind":
		if len(a.Pos) < 2 {
			return fmt.Errorf("gfx: usage /gfx unbind ID PROP")
		}
		s := h.cur(true)
		h.emit(s, Op{"op": "unbind", "scene": s.id, "id": a.Pos[0], "prop": canonProp(a.Pos[1])})
	case "vars": // /gfx vars a=1 b="two words": several variables at once
		for _, k := range a.Keys {
			v := any(a.Kw[k])
			if f, err := strconv.ParseFloat(a.Kw[k], 64); err == nil && isNum(a.Kw[k]) {
				v = f
			}
			if old, ok := h.st.vars[k]; ok && old == v {
				continue
			}
			h.st.vars[k] = v
			h.vq[k] = v
		}
		h.push()
	case "var", "_v":
		if len(a.Pos) < 1 {
			return fmt.Errorf("gfx: usage /gfx var NAME VALUE")
		}
		raw := restAfter(rest, 1)
		var v any = raw
		if f, err := strconv.ParseFloat(raw, 64); err == nil && isNum(raw) {
			v = f
		}
		if old, ok := h.st.vars[a.Pos[0]]; ok && old == v {
			return nil
		}
		h.st.vars[a.Pos[0]] = v
		h.vq[a.Pos[0]] = v
		h.push()
	case "on":
		return h.on(a, rest)
	case "off":
		if len(a.Pos) < 1 {
			return fmt.Errorf("gfx: usage /gfx off ID [EVENT]")
		}
		s := h.cur(true)
		if len(a.Pos) > 1 {
			delete(s.handlers[a.Pos[0]], a.Pos[1])
		} else {
			delete(s.handlers, a.Pos[0])
		}
		h.emit(s, Op{"op": "on", "scene": s.id, "id": a.Pos[0], "events": eventsOf(s.handlers[a.Pos[0]])})
	case "state":
		if len(a.Pos) < 2 {
			return fmt.Errorf("gfx: usage /gfx state ID hover|down|active|NAME prop=value ... [dur=] [ease=]")
		}
		s := h.cur(true)
		if err := h.needNode(s, a.Pos[0]); err != nil {
			return err
		}
		p, err := a.props("dur", "ease")
		if err != nil {
			return err
		}
		op := Op{"op": "state", "scene": s.id, "id": a.Pos[0], "name": a.Pos[1], "props": p}
		for _, k := range []string{"dur", "ease"} {
			if v, ok := a.Kw[k]; ok {
				op[k], _ = value(k, v)
			}
		}
		h.emit(s, op)
	case "shader":
		return h.shader(a)
	case "font", "image":
		return h.asset(sub, a)
	case "load":
		return h.load(a)
	case "dump":
		return h.dump(a)
	case "list":
		return h.list(a)
	case "info":
		for _, id := range h.st.order {
			s := h.st.scenes[id]
			h.echo("scene %s: %d objects, open=%v, size=%vx%v", id, len(s.nodes), s.cfg["open"], s.cfg["w"], s.cfg["h"])
		}
	case "help":
		return h.gfxHelp()
	default:
		return fmt.Errorf("gfx: unknown subcommand %q (try /gfx help)", sub)
	}
	return nil
}

var smoothRe = regexp.MustCompile(`\s+smooth=([0-9.]+)$`)

func firstOr(a []string, d string) string {
	if len(a) > 0 {
		return a[0]
	}
	return d
}

func canonProp(p string) string {
	if al, ok := aliases[p]; ok {
		return al
	}
	return p
}

func eventsOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (h *Hub) gfxHelp() error {
	for _, l := range []string{
		"/gfx open [scene] [w=1280 h=720 bg=#000 dock=full|top|bottom|left|right margin=T,R,B,L bloom=0.8]   /gfx close|clear|reset",
		"/gfx rect|rrect|circle|ellipse|arc|line|polyline|polygon|path|text|image|group|layer|button|planet|starfield|emitter|shader|radar|graph ID ...",
		"/gfx set ID k=v ...   /gfx del ID   /gfx anim ID prop=to|from..to [dur= ease= delay= loop= yoyo]   /gfx stop ID",
		"/gfx timeline NAME   /gfx at NAME T anim|set ...   /gfx play NAME   /gfx bind ID PROP EXPR   /gfx unbind ID PROP",
		"/gfx on ID click|enter|leave|down|up COMMAND   /gfx state ID hover|down k=v   /gfx shader NAME file=...   /gfx font|image NAME FILE",
		"/gfx sync|watch|autosync (TF variables)   /gfx var NAME VALUE   /gfx list|info|dump FILE|load FILE|fps|bloom   (docs/GFX.md)",
	} {
		h.echo("%s", l)
	}
	return nil
}

func (h *Hub) open(a Args) error {
	name := firstOr(a.Pos, h.st.cur)
	s := h.st.get(name, true)
	h.st.cur = name
	op := Op{"op": "scene", "scene": name, "open": true}
	p, err := a.props()
	if err != nil {
		return err
	}
	for k, v := range p {
		op[k] = v
	}
	if m, ok := op["margin"].(float64); ok {
		op["margin"] = []float64{m, m, m, m}
	}
	h.emit(s, op)
	return nil
}

func (h *Hub) create(typ, rest string) error {
	spec := typeSpec[typ]
	al := typeAlias[typ]
	realType := typ
	if al.typ != "" {
		realType = al.typ
	}
	a, err := ParseArgs(rest)
	if err != nil {
		return fmt.Errorf("gfx %s: %v", typ, err)
	}
	if len(a.Pos) < 1 {
		return fmt.Errorf("gfx: usage /gfx %s ID %s [prop=value ...]", typ, strings.Join(spec, " "))
	}
	id := a.Pos[0]
	args := a.Pos[1:]
	props, err := a.props("parent", "in")
	if err != nil {
		return err
	}
	for k, v := range al.props {
		props[k] = v
	}
	for i, name := range spec {
		if strings.HasPrefix(name, "@") && props["points"] != nil { // points=x,y,... given as an option
			break
		}
		if strings.HasPrefix(name, "@") { // all remaining numbers
			var pts []float64
			for _, t := range args[min(i, len(args)):] {
				f, err := nums(t)
				if err != nil {
					return fmt.Errorf("gfx %s: %v", typ, err)
				}
				pts = append(pts, f...)
			}
			if len(pts) < 4 || len(pts)%2 != 0 {
				return fmt.Errorf("gfx %s: needs x y pairs (at least two points)", typ)
			}
			props["points"] = pts
			args = nil
			break
		}
		if i >= len(args) {
			break
		}
		if (typ == "text" || typ == "button") && name == "text" { // free text: the rest of the positional words
			props["text"] = strings.Join(args[i:], " ")
			args = nil
			break
		}
		v, err := value(name, args[i])
		if err != nil {
			return err
		}
		setProp(props, name, v)
	}
	if typ == "text" && props["text"] == nil {
		props["text"] = ""
	}
	parent := a.Kw["parent"]
	if parent == "" {
		parent = a.Kw["in"]
	}
	s := h.cur(true)
	if parent != "" {
		if err := h.needNode(s, parent); err != nil {
			return err
		}
	}
	if _, exists := s.nodes[id]; exists { // creating again replaces: scripts re-run
		h.emit(s, Op{"op": "delete", "scene": s.id, "id": id})
	}
	op := Op{"op": "create", "scene": s.id, "id": id, "type": realType, "props": props}
	if parent != "" {
		op["parent"] = parent
	}
	h.emit(s, op)
	return nil
}

func (h *Hub) set(a Args) error {
	if len(a.Pos) < 1 {
		return fmt.Errorf("gfx: usage /gfx set ID prop=value [prop=value]")
	}
	s := h.cur(true)
	p, err := a.props()
	if err != nil {
		return err
	}
	if len(a.Pos) > 1 { // /gfx set ID text with spaces: the remaining words are the text
		if _, has := p["text"]; !has {
			p["text"] = strings.Join(a.Pos[1:], " ")
		}
	}
	for _, id := range strings.Split(a.Pos[0], ",") {
		if err := h.needNode(s, id); err != nil {
			return err
		}
		h.emit(s, Op{"op": "set", "scene": s.id, "id": id, "props": cloneProps(p)})
	}
	return nil
}

func cloneProps(p map[string]any) map[string]any {
	out := make(map[string]any, len(p))
	for k, v := range p {
		out[k] = v
	}
	return out
}

// anim builds a tween op from "ID prop=to [prop=from..to] dur= ease= delay= loop= yoyo after= name=".
// into, when set, receives the op instead of the scene (timeline steps).
func (h *Hub) anim(a Args, into *Op) error {
	if len(a.Pos) < 1 {
		return fmt.Errorf("gfx: usage /gfx anim ID prop=to [prop=from..to] [dur=0.5] [ease=outCubic] [delay=0] [loop=N|inf] [yoyo] [after=ANIM] [name=NAME]")
	}
	s := h.cur(true)
	target := a.Pos[0]
	if err := h.needNode(s, target); err != nil {
		return err
	}
	op := Op{"op": "tween", "scene": s.id, "target": target}
	for _, w := range a.Pos[1:] {
		if w == "yoyo" {
			op["yoyo"] = true
		}
	}
	tracks := map[string]any{}
	special := map[string]bool{"dur": true, "ease": true, "delay": true, "loop": true, "yoyo": true, "after": true, "name": true}
	for _, k := range a.Keys {
		v := a.Kw[k]
		if special[k] {
			switch k {
			case "dur", "delay":
				f, err := num(v)
				if err != nil {
					return fmt.Errorf("gfx anim %s: %v", k, err)
				}
				op[k] = f
			case "loop":
				if v == "inf" || v == "forever" {
					op[k] = -1
				} else {
					f, err := num(v)
					if err != nil {
						return fmt.Errorf("gfx anim loop: %v", err)
					}
					op[k] = int(f)
				}
			case "yoyo":
				op[k] = v == "" || v == "1" || v == "true" || v == "on"
			case "name":
				op["id"] = v
			default:
				op[k] = v
			}
			continue
		}
		prop := canonProp(k)
		if strings.HasPrefix(k, "from.") {
			continue
		}
		tr := map[string]any{}
		if i := strings.Index(v, ".."); i > 0 && !isNum(v) {
			f, err := value(prop, v[:i])
			if err != nil {
				return err
			}
			t, err := value(prop, v[i+2:])
			if err != nil {
				return err
			}
			tr["from"], tr["to"] = f, t
		} else {
			t, err := value(prop, v)
			if err != nil {
				return err
			}
			tr["to"] = t
		}
		if fv, ok := a.Kw["from."+k]; ok {
			tr["from"], _ = value(prop, fv)
		}
		tracks[prop] = tr
	}
	if len(tracks) == 0 {
		return fmt.Errorf("gfx anim: no property to animate (prop=value)")
	}
	op["tracks"] = tracks
	if _, ok := op["dur"]; !ok {
		op["dur"] = 0.4
	}
	if into != nil {
		delete(op, "scene")
		*into = op
		return nil
	}
	h.emit(s, op)
	return nil
}

func (h *Hub) at(a Args, rest string) error {
	if len(a.Pos) < 3 {
		return fmt.Errorf("gfx: usage /gfx at TIMELINE SECONDS anim|set ID and arguments")
	}
	s := h.cur(true)
	name := a.Pos[0]
	t, err := num(a.Pos[1])
	if err != nil {
		return fmt.Errorf("gfx at: %v", err)
	}
	if _, ok := s.tl[name]; !ok {
		return fmt.Errorf("gfx at: no timeline %q (/gfx timeline NAME first)", name)
	}
	kind := a.Pos[2]
	sub, err := ParseArgs(restAfter(rest, 3))
	if err != nil {
		return err
	}
	var step Op
	switch kind {
	case "anim":
		if err := h.anim(sub, &step); err != nil {
			return err
		}
	case "set":
		if len(sub.Pos) < 1 {
			return fmt.Errorf("gfx at: set needs an object id")
		}
		p, err := sub.props()
		if err != nil {
			return err
		}
		step = Op{"op": "set", "id": sub.Pos[0], "props": p}
	default:
		return fmt.Errorf("gfx at: step must be anim or set, not %q", kind)
	}
	steps := append(s.tl[name], Op{"at": t, "do": step})
	op := Op{"op": "timeline", "scene": s.id, "name": name, "steps": steps}
	for k, v := range s.tlCfg[name] {
		op[k] = v
	}
	h.emit(s, op)
	return nil
}

func (h *Hub) on(a Args, rest string) error {
	if len(a.Pos) < 3 {
		return fmt.Errorf("gfx: usage /gfx on ID click|down|up|enter|leave COMMAND   ($id $x $y $ev expand)")
	}
	ev := strings.ToLower(a.Pos[1])
	if !eventNames[ev] {
		return fmt.Errorf("gfx on: unknown event %q (click down up enter leave move wheel)", ev)
	}
	s := h.cur(true)
	if err := h.needNode(s, a.Pos[0]); err != nil {
		return err
	}
	cmd := restAfter(rest, 2)
	if s.handlers[a.Pos[0]] == nil {
		s.handlers[a.Pos[0]] = map[string]string{}
	}
	s.handlers[a.Pos[0]][ev] = cmd
	h.emit(s, Op{"op": "on", "scene": s.id, "id": a.Pos[0], "events": eventsOf(s.handlers[a.Pos[0]])})
	return nil
}

func (h *Hub) shader(a Args) error {
	if len(a.Pos) < 1 {
		return fmt.Errorf("gfx: usage /gfx shader NAME file=FILE|src=GLSL [uniform=name:type,...]")
	}
	op := Op{"op": "shader", "name": a.Pos[0]}
	switch {
	case a.Kw["file"] != "":
		p, err := h.findFile(a.Kw["file"])
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return fmt.Errorf("gfx shader: %v", err)
		}
		op["glsl"] = string(b)
	case a.Kw["src"] != "":
		op["glsl"] = strings.ReplaceAll(a.Kw["src"], `\n`, "\n")
	default:
		return fmt.Errorf("gfx shader: give file=FILE or src=\"vec4 shade(vec2 uv, vec2 px){...}\"")
	}
	u := map[string]any{}
	if us := a.Kw["uniform"]; us != "" {
		for _, d := range strings.Split(us, ",") {
			n, t, ok := strings.Cut(d, ":")
			if !ok || !(t == "float" || t == "vec2" || t == "vec3" || t == "vec4" || t == "color") {
				return fmt.Errorf("gfx shader: uniform %q must be name:float|vec2|vec3|vec4|color", d)
			}
			u[n] = t
		}
	}
	op["uniforms"] = u
	h.emit(h.cur(true), op)
	return nil
}

const maxAsset = 6 << 20

func (h *Hub) asset(kind string, a Args) error {
	if len(a.Pos) < 2 {
		return fmt.Errorf("gfx: usage /gfx %s NAME FILE|URL", kind)
	}
	src := a.Pos[1]
	if !strings.HasPrefix(src, "http://") && !strings.HasPrefix(src, "https://") && !strings.HasPrefix(src, "data:") {
		p, err := h.findFile(src)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return fmt.Errorf("gfx %s: %v", kind, err)
		}
		if len(b) > maxAsset {
			return fmt.Errorf("gfx %s: %s is larger than %d MiB", kind, src, maxAsset>>20)
		}
		mt := mime.TypeByExtension(strings.ToLower(filepath.Ext(p)))
		switch strings.ToLower(filepath.Ext(p)) {
		case ".woff2":
			mt = "font/woff2"
		case ".woff":
			mt = "font/woff"
		case ".ttf":
			mt = "font/ttf"
		case ".otf":
			mt = "font/otf"
		}
		if mt == "" {
			mt = "application/octet-stream"
		}
		src = "data:" + mt + ";base64," + base64.StdEncoding.EncodeToString(b)
	}
	op := Op{"op": kind, "name": a.Pos[0], "src": src}
	for _, k := range []string{"weight", "style"} {
		if v, ok := a.Kw[k]; ok {
			op[k] = v
		}
	}
	h.push(op)
	return nil
}

// load runs a file: JSON (an array of operations) is applied as is; anything else is read as one /gfx or
// /canvas command per line.
func (h *Hub) load(a Args) error {
	if len(a.Pos) < 1 {
		return fmt.Errorf("gfx: usage /gfx load FILE")
	}
	p, err := h.findFile(a.Pos[0])
	if err != nil {
		return err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return fmt.Errorf("gfx load: %v", err)
	}
	if strings.HasSuffix(p, ".json") {
		var ops []Op
		if err := json.Unmarshal(b, &ops); err != nil {
			return fmt.Errorf("gfx load: %s: %v", p, err)
		}
		h.mu.Unlock() // Apply locks
		h.Apply(ops)
		h.mu.Lock()
		return nil
	}
	for n, l := range strings.Split(string(b), "\n") {
		l = strings.TrimSpace(l)
		if l == "" || strings.HasPrefix(l, ";") || strings.HasPrefix(l, "#") {
			continue
		}
		l = strings.TrimPrefix(l, "/")
		c, r, _ := strings.Cut(l, " ")
		var err error
		switch c {
		case "gfx":
			err = h.gfxCmd(strings.TrimSpace(r))
		case "canvas":
			err = h.canvasCmd(strings.TrimSpace(r))
		default:
			err = h.gfxCmd(l)
		}
		if err != nil {
			return fmt.Errorf("%s:%d: %v", filepath.Base(p), n+1, err)
		}
	}
	return nil
}

func (h *Hub) dump(a Args) error {
	if len(a.Pos) < 1 {
		return fmt.Errorf("gfx: usage /gfx dump FILE")
	}
	var out []Op
	for _, id := range h.st.order {
		if s := h.st.scenes[id]; s != nil {
			out = append(out, s.snapshot(h.st.vars)...)
		}
	}
	b, err := json.MarshalIndent(out, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(a.Pos[0], b, 0o644); err != nil {
		return fmt.Errorf("gfx dump: %v", err)
	}
	h.echo("wrote %d operations to %s", len(out), a.Pos[0])
	return nil
}

func (h *Hub) list(a Args) error {
	s := h.st.get(firstOr(a.Pos, ""), false)
	if s == nil {
		h.echo("no scene")
		return nil
	}
	for _, id := range s.ids() {
		n := s.nodes[id]
		par := ""
		if n.parent != "" {
			par = " in " + n.parent
		}
		h.echo("%-14s %-9s%s", n.id, n.typ, par)
	}
	return nil
}
