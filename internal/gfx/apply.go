package gfx

import "fmt"

const maxJournal = 40000

// emit mirrors an op into the scene state and queues it for the window.
func (h *Hub) emit(s *scene, op Op) {
	h.mirror(s, op)
	h.push(op)
}

func asProps(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func mergeProps(dst, src map[string]any) {
	for k, v := range src {
		if sm, ok := v.(map[string]any); ok {
			if dm, ok := dst[k].(map[string]any); ok && (k == "shadow" || k == "u") {
				for kk, vv := range sm {
					dm[kk] = vv
				}
				continue
			}
		}
		dst[k] = v
	}
}

// mirror applies an op to the Go-side scene mirror.
func (h *Hub) mirror(s *scene, op Op) {
	str := func(k string) string { x, _ := op[k].(string); return x }
	switch str("op") {
	case "scene":
		for k, v := range op {
			if k != "op" && k != "scene" {
				s.cfg[k] = v
			}
		}
	case "clear":
		s.clear()
	case "create":
		s.add(str("id"), str("type"), str("parent"), asProps(op["props"]))
	case "set":
		if n := s.nodes[str("id")]; n != nil {
			mergeProps(n.props, asProps(op["props"]))
		}
	case "delete":
		s.del(str("id"))
	case "bind":
		k := bindKey{str("id"), str("prop")}
		if _, ok := s.binds[k]; !ok {
			s.bindSeq = append(s.bindSeq, k)
		}
		s.binds[k], _ = op["expr"].(string)
	case "unbind":
		delete(s.binds, bindKey{str("id"), str("prop")})
	case "tween":
		if toF(op["loop"]) != 0 {
			id := str("id")
			if id == "" {
				id = fmt.Sprintf("%s#%d", str("target"), len(s.loops))
			}
			s.loops[id] = op
		}
	case "stop":
		id := str("id")
		delete(s.loops, id)
		for k, l := range s.loops {
			if l["target"] == id {
				delete(s.loops, k)
			}
		}
		delete(s.tl, id)
	case "timeline":
		name := str("name")
		steps, _ := op["steps"].([]Op)
		s.tl[name] = steps
		cfg := Op{}
		for k, v := range op {
			if k != "op" && k != "scene" && k != "name" && k != "steps" {
				cfg[k] = v
			}
		}
		s.tlCfg[name] = cfg
	case "state":
		id := str("id")
		if s.states[id] == nil {
			s.states[id] = map[string]Op{}
		}
		s.states[id][str("name")] = op
	case "shader":
		s.shaders[str("name")] = op
	case "draw":
		id := str("id")
		if str("cmd") == "clear" {
			s.journal[id] = nil
		}
		if len(s.journal[id]) < maxJournal {
			s.journal[id] = append(s.journal[id], op)
		}
	}
}

// Apply feeds raw protocol operations (as a remote client would stream them) through the mirror to the window.
// Operations without a scene use the current one.
func (h *Hub) Apply(ops []Op) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, op := range ops {
		name, _ := op["op"].(string)
		switch name {
		case "vars":
			if vs := asProps(op["vars"]); vs != nil {
				for k, v := range vs {
					h.st.vars[k] = v
				}
			}
			h.push(op)
			continue
		case "font", "image":
			h.push(op)
			continue
		}
		sid, _ := op["scene"].(string)
		s := h.st.get(sid, true)
		op["scene"] = s.id
		h.emit(s, op)
	}
}

func toF(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	return 0
}
