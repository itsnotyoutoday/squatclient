package gfx

import (
	"sort"
)

// Op is one scene operation of the protocol (docs/GFX.md). Every op has an "op" member; most name a "scene".
type Op = map[string]any

type node struct {
	id, typ, parent string
	props           map[string]any
	seq             int
}

type bindKey struct{ id, prop string }

// scene is the Go-side mirror of one frontend scene. It validates commands (does the object exist?),
// lists objects, and can rebuild the whole scene as a batch of ops for a late-mounting window.
type scene struct {
	id       string
	cfg      map[string]any
	nodes    map[string]*node
	seq      int
	binds    map[bindKey]string
	bindSeq  []bindKey
	handlers map[string]map[string]string // id -> event -> TF command
	loops    map[string]Op                // looping tweens, replayed on snapshot
	tl       map[string][]Op              // timelines by name (steps in order)
	tlCfg    map[string]Op
	journal  map[string][]Op // pixel canvas drawing journals (reset by clear)
	shaders  map[string]Op
	states   map[string]map[string]Op // id -> state name -> op
}

func newScene(id string) *scene {
	s := &scene{id: id, cfg: map[string]any{}}
	s.clear()
	return s
}

func (s *scene) add(id, typ, parent string, props map[string]any) {
	s.seq++
	cp := map[string]any{}
	for k, v := range props {
		cp[k] = v
	}
	s.nodes[id] = &node{id: id, typ: typ, parent: parent, props: cp, seq: s.seq}
}

func (s *scene) del(id string) {
	var kids []string
	for _, n := range s.nodes {
		if n.parent == id {
			kids = append(kids, n.id)
		}
	}
	for _, k := range kids {
		s.del(k)
	}
	delete(s.nodes, id)
	delete(s.handlers, id)
	delete(s.journal, id)
	delete(s.states, id)
	for k := range s.binds {
		if k.id == id {
			delete(s.binds, k)
		}
	}
	for k, op := range s.loops {
		if op["target"] == id {
			delete(s.loops, k)
		}
	}
}

func (s *scene) clear() {
	s.nodes = map[string]*node{}
	s.binds, s.bindSeq = map[bindKey]string{}, nil
	s.handlers, s.loops, s.journal = map[string]map[string]string{}, map[string]Op{}, map[string][]Op{}
	s.states = map[string]map[string]Op{}
	s.tl, s.tlCfg = map[string][]Op{}, map[string]Op{}
	s.shaders = map[string]Op{}
}

func (s *scene) ids() []string {
	ns := make([]*node, 0, len(s.nodes))
	for _, n := range s.nodes {
		ns = append(ns, n)
	}
	sort.Slice(ns, func(i, j int) bool { return ns[i].seq < ns[j].seq })
	out := make([]string, len(ns))
	for i, n := range ns {
		out[i] = n.id
	}
	return out
}

func sortedKeys[V any](m map[string]V) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// snapshot rebuilds the scene as ops: config, shaders, objects in creation order (parents first), bindings,
// style states, looping tweens, timelines and pixel canvas drawing.
func (s *scene) snapshot(vars map[string]any) []Op {
	cfg := Op{"op": "scene", "scene": s.id}
	for k, v := range s.cfg {
		cfg[k] = v
	}
	out := []Op{cfg}
	for _, n := range sortedKeys(s.shaders) {
		out = append(out, s.shaders[n])
	}
	if len(vars) > 0 {
		out = append(out, Op{"op": "vars", "scene": s.id, "vars": vars})
	}
	for _, id := range s.ids() {
		n := s.nodes[id]
		op := Op{"op": "create", "scene": s.id, "id": n.id, "type": n.typ, "props": n.props}
		if n.parent != "" {
			op["parent"] = n.parent
		}
		out = append(out, op)
		out = append(out, s.journal[id]...)
	}
	for _, k := range s.bindSeq {
		if e, ok := s.binds[k]; ok {
			out = append(out, Op{"op": "bind", "scene": s.id, "id": k.id, "prop": k.prop, "expr": e})
		}
	}
	for _, id := range sortedKeys(s.states) {
		for _, name := range sortedKeys(s.states[id]) {
			out = append(out, s.states[id][name])
		}
	}
	for _, k := range sortedKeys(s.loops) {
		out = append(out, s.loops[k])
	}
	for _, name := range sortedKeys(s.tl) {
		t := Op{"op": "timeline", "scene": s.id, "name": name, "steps": s.tl[name]}
		for k, v := range s.tlCfg[name] {
			t[k] = v
		}
		out = append(out, t)
	}
	return out
}

// state is the whole mirror of the graphics: scenes and the latest variable values.
type state struct {
	scenes map[string]*scene
	order  []string
	cur    string
	vars   map[string]any
}

func newState() *state {
	return &state{scenes: map[string]*scene{}, cur: "main", vars: map[string]any{}}
}

func (st *state) get(id string, create bool) *scene {
	if id == "" {
		id = st.cur
	}
	s := st.scenes[id]
	if s == nil && create {
		s = newScene(id)
		st.scenes[id] = s
		st.order = append(st.order, id)
	}
	return s
}
