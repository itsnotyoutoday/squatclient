package gfx

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// CanvasScene is the scene the /canvas family draws in: pixel canvases are objects of it, shown by /canvas show
// or by a /panel {canvas NAME}.
const CanvasScene = "canvas"

var hexRe = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)
var c256Re = regexp.MustCompile(`^256:(\d{1,3})$`)

var colorNames = map[string]bool{"black": true, "red": true, "green": true, "yellow": true, "blue": true, "magenta": true,
	"cyan": true, "white": true, "gray": true, "grey": true, "orange": true, "purple": true, "pink": true, "brown": true,
	"darkgray": true, "darkgrey": true, "lightgray": true, "lightgrey": true, "brightred": true, "brightgreen": true,
	"brightyellow": true, "brightblue": true, "brightmagenta": true, "brightcyan": true, "brightwhite": true,
	"bgred": true, "default": true, "none": true}

func checkColor(s string) error {
	if hexRe.MatchString(s) || colorNames[strings.ToLower(s)] {
		return nil
	}
	if m := c256Re.FindStringSubmatch(s); m != nil {
		if n, _ := strconv.Atoi(m[1]); n <= 255 {
			return nil
		}
	}
	return fmt.Errorf("canvas: %q is not a color (#rrggbb, a name, or 256:N)", s)
}

type cmdShape struct {
	nums  int // numeric arguments after NAME
	color bool
	extra int // optional trailing arguments (after the color)
}

// canvasShapes: arguments after NAME, per drawing command (docs/LAYOUTS.md of the terminal client).
var canvasShapes = map[string]cmdShape{
	"px": {2, true, 0}, "line": {4, true, 0}, "rect": {4, true, 0}, "fill": {4, true, 0}, "rrect": {5, true, 0},
	"circle": {3, true, 0}, "disc": {3, true, 0}, "ellipse": {4, true, 0}, "arc": {6, true, 0}, "glow": {3, true, 0},
	"grad": {4, true, 0}, "stars": {6, false, 0},
}

func (h *Hub) canvasCmd(line string) error {
	sub, rest, _ := strings.Cut(line, " ")
	sub = strings.ToLower(sub)
	rest = strings.TrimSpace(rest)
	if sub == "" {
		return fmt.Errorf("canvas: usage /canvas new|clear|del|list|px|line|rect|fill|rrect|circle|disc|ellipse|arc|poly|glow|grad|stars|text|show|hide ... (docs/GFX.md)")
	}
	s := h.st.get(CanvasScene, true)
	if _, ok := s.cfg["open"]; !ok {
		h.emit(s, Op{"op": "scene", "scene": CanvasScene, "open": true, "dock": "full", "bg": "none", "pixel": true, "passthrough": true})
	}
	a, err := ParseArgs(rest)
	if err != nil {
		return fmt.Errorf("canvas %s: %v", sub, err)
	}
	switch sub {
	case "list":
		for _, id := range s.ids() {
			n := s.nodes[id]
			h.echo("%-12s %vx%v pixels", id, n.props["w"], n.props["h"])
		}
		return nil
	case "new":
		if len(a.Pos) < 3 {
			return fmt.Errorf("canvas: usage /canvas new NAME W H [bg]   (W x H terminal cells = W x 2H pixels)")
		}
		w, err1 := num(a.Pos[1])
		hh, err2 := num(a.Pos[2])
		if err1 != nil || err2 != nil || w < 1 || hh < 1 || w > 4096 || hh > 2048 {
			return fmt.Errorf("canvas new: size must be W H cells, 1..4096 x 1..2048")
		}
		props := map[string]any{"w": w, "h": hh * 2, "cols": w, "rows": hh, "visible": false}
		if len(a.Pos) > 3 {
			if err := checkColor(a.Pos[3]); err != nil {
				return err
			}
			props["bg"] = a.Pos[3]
		}
		if _, ok := s.nodes[a.Pos[0]]; ok {
			h.emit(s, Op{"op": "delete", "scene": s.id, "id": a.Pos[0]})
		}
		h.emit(s, Op{"op": "create", "scene": s.id, "id": a.Pos[0], "type": "pixelcanvas", "props": props})
		return nil
	case "del", "delete":
		for _, id := range a.Pos {
			if _, ok := s.nodes[id]; !ok {
				return fmt.Errorf("canvas: no canvas %q", id)
			}
			h.emit(s, Op{"op": "delete", "scene": s.id, "id": id})
		}
		return nil
	case "show", "hide":
		if len(a.Pos) < 1 {
			return fmt.Errorf("canvas: usage /canvas show NAME [x y [scale]]   (pixels of the window; hide removes it again)")
		}
		if _, ok := s.nodes[a.Pos[0]]; !ok {
			return fmt.Errorf("canvas: no canvas %q", a.Pos[0])
		}
		p := map[string]any{"visible": sub == "show"}
		for i, k := range []string{"x", "y", "scale"} {
			if sub == "show" && i+1 < len(a.Pos) {
				f, err := num(a.Pos[i+1])
				if err != nil {
					return err
				}
				p[k] = f
			}
		}
		h.emit(s, Op{"op": "set", "scene": s.id, "id": a.Pos[0], "props": p})
		return nil
	case "clear":
		if len(a.Pos) < 1 {
			return fmt.Errorf("canvas: usage /canvas clear NAME [color]")
		}
		if _, ok := s.nodes[a.Pos[0]]; !ok {
			return fmt.Errorf("canvas: no canvas %q", a.Pos[0])
		}
		op := Op{"op": "draw", "scene": s.id, "id": a.Pos[0], "cmd": "clear"}
		if len(a.Pos) > 1 {
			if err := checkColor(a.Pos[1]); err != nil {
				return err
			}
			op["color"] = a.Pos[1]
		}
		h.emit(s, op)
		return nil
	case "text":
		return h.canvasText(s, rest)
	case "poly":
		if len(a.Pos) < 2+6 {
			return fmt.Errorf("canvas: usage /canvas poly NAME color x1 y1 x2 y2 x3 y3 and more points")
		}
		if err := checkColor(a.Pos[1]); err != nil {
			return err
		}
		var pts []float64
		for _, t := range a.Pos[2:] {
			f, err := num(t)
			if err != nil {
				return fmt.Errorf("canvas poly: %v", err)
			}
			pts = append(pts, f)
		}
		if len(pts)%2 != 0 {
			return fmt.Errorf("canvas poly: coordinates come in x y pairs")
		}
		return h.canvasDraw(s, a, "poly", pts, a.Pos[1])
	}
	shape, ok := canvasShapes[sub]
	if !ok {
		return fmt.Errorf("canvas: unknown subcommand %q", sub)
	}
	need := 1 + shape.nums
	if shape.color {
		need++
	}
	if len(a.Pos) < need {
		return fmt.Errorf("canvas %s: needs NAME and %d numbers%s", sub, shape.nums, map[bool]string{true: " and a color", false: ""}[shape.color])
	}
	var args []float64
	for _, t := range a.Pos[1 : 1+shape.nums] {
		f, err := num(t)
		if err != nil {
			return fmt.Errorf("canvas %s: %v", sub, err)
		}
		args = append(args, f)
	}
	color := ""
	extra := a.Pos[need:]
	if shape.color {
		color = a.Pos[need-1]
		if err := checkColor(color); err != nil {
			return err
		}
		if sub == "grad" {
			// grad NAME x y w h color1 color2 [v]
			if len(extra) < 1 {
				return fmt.Errorf("canvas grad: needs two colors")
			}
			if err := checkColor(extra[0]); err != nil {
				return err
			}
		}
	}
	op := map[string]any{}
	if sub == "grad" {
		op["color2"] = extra[0]
		op["vertical"] = len(extra) > 1 && (extra[1] == "v" || extra[1] == "V")
	}
	if sub == "stars" {
		// NAME x y w h count seed
		op["count"], op["seed"] = args[4], args[5]
		args = args[:4]
	}
	return h.canvasDrawExtra(s, a, sub, args, color, op)
}

func (h *Hub) canvasDraw(s *scene, a Args, cmd string, args []float64, color string) error {
	return h.canvasDrawExtra(s, a, cmd, args, color, nil)
}

func (h *Hub) canvasDrawExtra(s *scene, a Args, cmd string, args []float64, color string, extra map[string]any) error {
	id := a.Pos[0]
	if _, ok := s.nodes[id]; !ok {
		return fmt.Errorf("canvas: no canvas %q (/canvas new NAME W H)", id)
	}
	op := Op{"op": "draw", "scene": s.id, "id": id, "cmd": cmd, "args": args}
	if color != "" {
		op["color"] = color
	}
	for k, v := range extra {
		op[k] = v
	}
	if v, ok := a.Kw["a"]; ok {
		f, err := num(v)
		if err != nil || f < 0 || f > 1 {
			return fmt.Errorf("canvas %s: a=ALPHA must be 0..1", cmd)
		}
		op["alpha"] = f
	}
	if v, ok := a.Kw["t"]; ok {
		f, err := num(v)
		if err != nil {
			return fmt.Errorf("canvas %s: t=%v", cmd, err)
		}
		op["t"] = f
	}
	if v, ok := a.Kw["corners"]; ok {
		op["corners"] = strings.Split(strings.ReplaceAll(v, " ", ""), ",")
	}
	h.emit(s, op)
	return nil
}

var wordRe = regexp.MustCompile(`\S+`)

// canvasText: /canvas text NAME cellx celly color [bold=1] text...  (the text keeps its spacing).
func (h *Hub) canvasText(s *scene, rest string) error {
	locs := wordRe.FindAllStringIndex(rest, -1)
	if len(locs) < 5 {
		return fmt.Errorf("canvas: usage /canvas text NAME cellx celly color [bold=1] and the text")
	}
	w := func(i int) string { return rest[locs[i][0]:locs[i][1]] }
	name := w(0)
	cx, err1 := num(w(1))
	cy, err2 := num(w(2))
	if err1 != nil || err2 != nil {
		return fmt.Errorf("canvas text: cellx and celly must be numbers")
	}
	color := w(3)
	if err := checkColor(color); err != nil {
		return err
	}
	i := 4
	op := map[string]any{}
	alpha := -1.0
	for i < len(locs) {
		m := kwRe.FindStringSubmatch(w(i))
		if m == nil || (m[1] != "bold" && m[1] != "a") {
			break
		}
		if m[1] == "bold" {
			op["bold"] = m[2] != "0" && m[2] != "" && m[2] != "false"
		} else if f, err := num(m[2]); err == nil {
			alpha = f
		}
		i++
	}
	if i >= len(locs) {
		return fmt.Errorf("canvas text: no text")
	}
	op["text"] = rest[locs[i][0]:]
	a := Args{Pos: []string{name}, Kw: map[string]string{}}
	if alpha >= 0 {
		a.Kw["a"] = strconv.FormatFloat(alpha, 'f', -1, 64)
	}
	return h.canvasDrawExtra(s, a, "text", []float64{cx, cy}, color, op)
}
