package desktop

import (
	"context"
	"time"

	"github.com/godbus/dbus/v5"
)

// Session is the session bus (godbus) as a Bus.
type Session struct{ conn *dbus.Conn }

// Connect connects to the user's session bus. There is none on a headless box or over a bare ssh login: that is an error the
// caller treats as "no desktop features".
func Connect() (*Session, error) {
	c, err := dbus.ConnectSessionBus()
	if err != nil {
		return nil, err
	}
	return &Session{conn: c}, nil
}

// vars turns the {string: any} maps this package builds into the a{sv} D-Bus wants; everything else goes as it is.
func vars(args []any) []any {
	out := make([]any, len(args))
	for i, a := range args {
		if m, ok := a.(map[string]any); ok {
			vm := make(map[string]dbus.Variant, len(m))
			for k, v := range m {
				vm[k] = dbus.MakeVariant(v)
			}
			out[i] = vm
		} else {
			out[i] = a
		}
	}
	return out
}

// Call implements Bus. A daemon that is not answering costs three seconds at most.
func (s *Session) Call(dest, path, iface, method string, args ...any) ([]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c := s.conn.Object(dest, dbus.ObjectPath(path)).CallWithContext(ctx, iface+"."+method, 0, vars(args)...)
	return c.Body, c.Err
}

// Emit implements Bus.
func (s *Session) Emit(path, iface, name string, args ...any) error {
	return s.conn.Emit(dbus.ObjectPath(path), iface+"."+name, vars(args)...)
}

// Watch delivers the notification daemon's click and close signals to d, and the portal's appearance changes to onLook, until the
// connection closes. It returns at once; the delivery runs in the background.
func (s *Session) Watch(d *Desktop, onLook func(Look)) {
	_ = s.conn.AddMatchSignal(dbus.WithMatchObjectPath(notifPath), dbus.WithMatchInterface(notifIface))
	_ = s.conn.AddMatchSignal(dbus.WithMatchInterface(portalIface), dbus.WithMatchMember("SettingChanged"))
	ch := make(chan *dbus.Signal, 32)
	s.conn.Signal(ch)
	go func() {
		look := d.Appearance()
		for sig := range ch {
			b := sig.Body
			switch sig.Name {
			case notifIface + ".ActionInvoked":
				if id, ok := first(b).(uint32); ok {
					d.ActionInvoked(id, "")
				}
			case notifIface + ".NotificationClosed":
				if id, ok := first(b).(uint32); ok {
					d.NotificationClosed(id)
				}
			case portalIface + ".SettingChanged":
				if len(b) == 3 {
					ns, _ := b[0].(string)
					key, _ := b[1].(string)
					if Setting(&look, ns, key, b[2]) && onLook != nil {
						onLook(look)
					}
				}
			}
		}
	}()
}

func first(b []any) any {
	if len(b) == 0 {
		return nil
	}
	return b[0]
}
