package gfxext

import (
	"strings"
	"testing"

	"github.com/itsnotyoutoday/gtfparser"

	"github.com/itsnotyoutoday/squatclient/internal/gfx"
)

func TestExtensionRunsGfxAndCanvasInTheSharedEngine(t *testing.T) {
	h := gfx.New()
	h.FlushDelay = -1
	var ops []gfx.Op
	h.Emit = func(o []gfx.Op) { ops = append(ops, o...) }
	var out []string
	in := gtfparser.New(gtfparser.HostFuncs{OnEcho: func(s string) { out = append(out, s) }})
	if err := in.Load(Extension(h)); err != nil {
		t.Fatal(err)
	}
	in.Run(`/_gfx open s w=100 h=100%; /_gfx rect a 1 2 3 4 fill=red%; /_canvas new c 10 2%; /_canvas disc c 3 2 2 red`)
	n := map[string]bool{}
	for _, o := range ops {
		if id, ok := o["id"].(string); ok {
			n[id] = true
		}
	}
	if !n["a"] || !n["c"] || len(out) != 0 {
		t.Fatalf("ops %v out %v", ops, out)
	}
	in.Run(`/_gfx set nope x=1`)
	if len(out) == 0 || !strings.Contains(strings.Join(out, "\n"), "no object") {
		t.Fatalf("error not shown: %v", out)
	}
}
