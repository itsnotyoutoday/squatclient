package desktop

import (
	"errors"
	"testing"
)

type call struct {
	dest, path, iface, method string
	args                      []any
}

type fakeBus struct {
	calls   []call
	emitted []call
	caps    []string
	noDaem  bool
	nextID  uint32
	portal  map[string]uint32
}

type variant struct{ v any }

func (v variant) Value() any { return v.v }

func (f *fakeBus) Call(dest, path, iface, method string, args ...any) ([]any, error) {
	f.calls = append(f.calls, call{dest, path, iface, method, args})
	switch method {
	case "GetCapabilities":
		if f.noDaem {
			return nil, errors.New("no daemon")
		}
		return []any{f.caps}, nil
	case "Notify":
		f.nextID++
		return []any{f.nextID}, nil
	case "Read":
		key := args[1].(string)
		if v, ok := f.portal[key]; ok {
			return []any{variant{variant{v}}}, nil // the portal nests a variant in a variant
		}
		return nil, errors.New("no such key")
	}
	return nil, errors.New("unexpected " + method)
}

func (f *fakeBus) Emit(path, iface, name string, args ...any) error {
	f.emitted = append(f.emitted, call{path: path, iface: iface, method: name, args: args})
	return nil
}

func (f *fakeBus) notifies() (n []call) {
	for _, c := range f.calls {
		if c.method == "Notify" {
			n = append(n, c)
		}
	}
	return
}

func TestNotifyClickAndReplace(t *testing.T) {
	b := &fakeBus{caps: []string{"body", "actions", "body-markup"}}
	var opened []string
	d := New(b, "squatclient", func(s string) { opened = append(opened, s) })
	if !d.Notify("CaveMUSH", "Bob says <hi> & waves", "s1") {
		t.Fatal("a daemon is there")
	}
	n := b.notifies()[0].args
	if n[0] != "SquatClient" || n[1] != uint32(0) || n[2] != "squatclient" {
		t.Fatalf("app name, replaces id and icon: %v", n[:3])
	}
	if n[3] != "CaveMUSH" || n[4] != "Bob says &lt;hi&gt; &amp; waves" {
		t.Fatalf("a daemon with markup must get the game's text escaped: %q %q", n[3], n[4])
	}
	if a := n[5].([]string); len(a) != 2 || a[0] != "default" {
		t.Fatalf("a daemon that can do actions gets the default (click) action: %v", a)
	}
	if h := n[6].(map[string]any); h["desktop-entry"] != "squatclient" {
		t.Fatalf("the desktop-entry hint ties it to the .desktop file: %v", h)
	}
	// a second one for the same world replaces the first instead of stacking
	d.Notify("CaveMUSH", "again", "s1")
	if got := b.notifies()[1].args[1]; got != uint32(1) {
		t.Fatalf("replaces_id should be the first notification's id: %v", got)
	}
	// another world is its own notification
	d.Notify("M*U*S*H", "hello", "s2")
	if got := b.notifies()[2].args[1]; got != uint32(0) {
		t.Fatalf("a different world does not replace: %v", got)
	}
	// a click opens the world; a closed notification is forgotten
	d.ActionInvoked(2, "default")
	if len(opened) != 1 || opened[0] != "s1" {
		t.Fatalf("the click opens the world: %v", opened)
	}
	d.NotificationClosed(2)
	d.ActionInvoked(2, "default")
	if len(opened) != 1 {
		t.Fatalf("a closed notification no longer opens anything: %v", opened)
	}
	d.Notify("CaveMUSH", "after close", "s1")
	if got := b.notifies()[3].args[1]; got != uint32(0) {
		t.Fatalf("after the notification closed, a new one starts fresh: %v", got)
	}
}

func TestNotifyAdaptsToTheDaemon(t *testing.T) {
	b := &fakeBus{caps: []string{}} // a bare daemon: no body, no actions, no markup
	d := New(b, "squatclient", nil)
	d.Notify("Cave", "x < y", "s1")
	n := b.notifies()[0].args
	if n[3] != "Cave: x < y" || n[4] != "" {
		t.Fatalf("no body support: the text goes in the summary, unescaped: %q %q", n[3], n[4])
	}
	if a := n[5].([]string); len(a) != 0 {
		t.Fatalf("no actions support: %v", a)
	}
	none := New(&fakeBus{noDaem: true}, "squatclient", nil)
	if none.Notify("a", "b", "s") {
		t.Fatal("no daemon: nothing was shown, and that is reported, not an error")
	}
}

func TestBadge(t *testing.T) {
	b := &fakeBus{}
	d := New(b, "squatclient", nil)
	_ = d.Badge(7)
	_ = d.Badge(0)
	e := b.emitted
	if len(e) != 2 || e[0].iface != "com.canonical.Unity.LauncherEntry" || e[0].method != "Update" || e[0].args[0] != "application://squatclient.desktop" {
		t.Fatalf("launcher entry signal: %+v", e)
	}
	p := e[0].args[1].(map[string]any)
	if p["count"] != int64(7) || p["count-visible"] != true {
		t.Fatalf("count shown: %v", p)
	}
	if p := e[1].args[1].(map[string]any); p["count-visible"] != false {
		t.Fatalf("zero hides the count: %v", p)
	}
}

func TestAppearance(t *testing.T) {
	d := New(&fakeBus{portal: map[string]uint32{"color-scheme": 1, "contrast": 1}}, "x", nil)
	if l := d.Appearance(); !l.Known || !l.Dark || !l.HighContrast {
		t.Fatalf("dark + high contrast through nested variants: %+v", l)
	}
	if l := New(&fakeBus{portal: map[string]uint32{"color-scheme": 2}}, "x", nil).Appearance(); !l.Known || l.Dark || l.HighContrast {
		t.Fatalf("light: %+v", l)
	}
	if l := New(&fakeBus{}, "x", nil).Appearance(); l.Known {
		t.Fatalf("no portal: nothing is claimed: %+v", l)
	}
	var l Look
	if !Setting(&l, "org.freedesktop.appearance", "color-scheme", variant{uint32(1)}) || !l.Dark {
		t.Fatalf("a changed colour scheme: %+v", l)
	}
	if Setting(&l, "org.gnome.something", "color-scheme", uint32(2)) || !l.Dark {
		t.Fatal("other namespaces are ignored")
	}
}
