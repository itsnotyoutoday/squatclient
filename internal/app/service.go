// Package app is the UI-facing service: it implements every EngineAPI method
// of docs/UI-CONTRACT.md on top of pkg/engine, persists worlds/settings via
// internal/config, keeps passwords in internal/secrets, and turns engine
// events into UI events. It contains no TF/Lua logic and no text parsing.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"

	"github.com/itsnotyoutoday/squatclient/internal/config"
	"github.com/itsnotyoutoday/squatclient/internal/secrets"
)

// Emitter delivers an event to the UI (runtime.EventsEmit in the real app).
type Emitter func(event string, payload any)

// Options configures a Service.
type Options struct {
	Config  *config.Store
	Secrets secrets.Store
	Emit    Emitter
	Engine  engine.Options // Caps/RingSize are derived from settings unless set
	Logger  *slog.Logger
	// OnQuit is called when a script asks to quit (/quit).
	OnQuit func()
	// OnWindow is called when the engine asks the window to change
	// (action "minimise", from /suspend).
	OnWindow func(action string)
	// FlushInterval batches event delivery (default 12ms).
	FlushInterval time.Duration
}

// Service implements the bound methods.
type Service struct {
	cfg   *config.Store
	sec   secrets.Store
	emit  Emitter
	eng   *engine.Engine
	log   *slog.Logger
	quit  func()
	win   func(string)
	flush time.Duration

	ctx    context.Context
	cancel context.CancelFunc // stops squatter connects at shutdown
	boot   sync.WaitGroup
	keyMu  sync.Mutex
	pair   pairing

	fgMu     sync.Mutex
	uiFg     string // foreground the UI last chose or was told about
	unsub    func()
	pumpDone chan struct{}
	once     sync.Once
}

// New builds the service and engine. Call Start to load scripts, begin event
// delivery and auto-connect.
func New(o Options) (*Service, error) {
	if o.Config == nil || o.Secrets == nil || o.Emit == nil {
		return nil, errors.New("app: Config, Secrets and Emit are required")
	}
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	if o.FlushInterval <= 0 {
		o.FlushInterval = 12 * time.Millisecond
	}
	st := o.Config.Settings()
	eo := o.Engine
	if eo.RingSize == 0 {
		eo.RingSize = st.ScrollbackLines
	}
	if eo.Caps == (proto.Caps{}) {
		eo.Caps = capsFor(st)
	}
	if eo.Logger == nil {
		eo.Logger = o.Logger
	}
	s := &Service{cfg: o.Config, sec: o.Secrets, emit: o.Emit, log: o.Logger, quit: o.OnQuit, win: o.OnWindow, flush: o.FlushInterval,
		pumpDone: make(chan struct{})}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	eo.PasswordFor = func(worldID string) string {
		pw, err := s.sec.Get(secrets.WorldKey(worldID))
		if err != nil {
			s.log.Warn("password lookup failed", "world", worldID, "err", err)
			return ""
		}
		return pw
	}
	s.eng = engine.New(eo)
	s.syncWorlds()
	return s, nil
}

func capsFor(st config.Settings) proto.Caps {
	return proto.Caps{Truecolor: true, UTF8: true, ScreenReader: st.ScreenReader}
}

// Engine exposes the engine (tests, live checks).
func (s *Service) Engine() *engine.Engine { return s.eng }

// Start subscribes to the engine, starts event delivery, loads scripts and
// connects autoConnect worlds.
func (s *Service) Start() {
	ch, unsub := s.eng.Subscribe()
	s.unsub = unsub
	go s.pump(ch)
	if err := s.eng.LoadScripts(); err != nil {
		s.log.Warn("script load", "err", err)
	}
	auto := func(via bool) {
		for _, w := range s.cfg.Worlds() {
			if w.AutoConnect && (w.Via != "" && w.Via != "direct") == via {
				if _, err := s.Connect(ConnectTarget{WorldID: w.ID}); err != nil {
					s.emit("notice", Notice{Level: "error", Text: fmt.Sprintf("auto-connect %s: %v", w.Name, err)})
				}
			}
		}
	}
	auto(false)
	// squatters are connected once, in the background; worlds that go through
	// one wait for that. Nothing is retried.
	s.boot.Add(1)
	go func() {
		defer s.boot.Done()
		s.startSquatters()
		if s.ctx.Err() == nil {
			auto(true)
		}
	}()
}

// Shutdown gracefully closes all sessions and stops event delivery.
func (s *Service) Shutdown() {
	s.once.Do(func() {
		s.cancel() // abort squatter connects in flight
		s.boot.Wait()
		// closes direct sessions (client_quit) and only DETACHES from squatters:
		// the daemon keeps those sessions running
		s.eng.Close()
		if s.unsub != nil {
			s.unsub()
			<-s.pumpDone
		}
	})
}

// ---- engine conversions ---------------------------------------------------

func toEngineWorld(w config.World, defaultEnc string) engine.World {
	ew := engine.World{ID: w.ID, Name: w.Name, Host: w.Host, Port: w.Port, TLS: w.TLS, TLSVerify: w.TLSVerify, Encoding: w.Encoding}
	if w.Via != "" && w.Via != "direct" {
		ew.Via = w.Via
	}
	if ew.Encoding == "" {
		ew.Encoding = defaultEnc
	}
	if w.Login != nil && w.Login.Template != "" {
		ew.Login = &engine.Login{Template: w.Login.Template, CharName: w.Login.CharName,
			Delay: time.Duration(w.Login.DelayMs) * time.Millisecond}
	}
	return ew
}

func (s *Service) syncWorlds() {
	enc := s.cfg.Settings().DefaultEncoding
	var ws []engine.World
	for _, w := range s.cfg.Worlds() {
		ws = append(ws, toEngineWorld(w, enc))
	}
	s.eng.SetWorlds(ws)
}

// ---- events ---------------------------------------------------------------

// Notice mirrors EngineEvents.notice.
type Notice struct {
	Level   string `json:"level"`
	Text    string `json:"text"`
	Session string `json:"session,omitempty"`
}

type gmcpPayload struct {
	Session string          `json:"session"`
	Package string          `json:"package"`
	Data    json.RawMessage `json:"data"`
}

type statusPayload struct {
	Session string               `json:"session"`
	Fields  []engine.StatusField `json:"fields"`
}

// pump batches engine events: everything except status-type events is emitted
// in order; session/status updates are coalesced per batch and emitted after
// the lines of that batch (so unread counts are never ahead of the text).
func (s *Service) pump(ch <-chan engine.Event) {
	defer close(s.pumpDone)
	const maxBatch = 512
	for first := range ch {
		batch := []engine.Event{first}
		timer := time.NewTimer(s.flush)
	collect:
		for len(batch) < maxBatch {
			select {
			case ev, ok := <-ch:
				if !ok {
					break collect
				}
				batch = append(batch, ev)
			case <-timer.C:
				break collect
			}
		}
		timer.Stop()
		s.deliver(batch)
	}
}

func (s *Service) deliver(batch []engine.Event) {
	pendInfo := map[string]*engine.SessionInfo{}
	pendStatus := map[string]statusPayload{}
	var order []string // "s:<id>" / "t:<id>" in first-seen order
	flush := func() {
		for _, k := range order {
			id := k[2:]
			if k[0] == 's' {
				if si, ok := pendInfo[id]; ok {
					s.emit("session", si)
				}
			} else if st, ok := pendStatus[id]; ok {
				s.emit("status", st)
			}
		}
		pendInfo, pendStatus, order = map[string]*engine.SessionInfo{}, map[string]statusPayload{}, nil
	}
	for _, ev := range batch {
		switch ev.Kind {
		case engine.EvLine:
			s.emit("line", ev.Line)
		case engine.EvGmcp:
			s.emit("gmcp", gmcpPayload{Session: ev.Session, Package: ev.Gmcp.Package, Data: ev.Gmcp.Data})
		case engine.EvSession:
			if _, ok := pendInfo[ev.Session]; !ok {
				order = append(order, "s:"+ev.Session)
			}
			pendInfo[ev.Session] = ev.Info
		case engine.EvStatus:
			if _, ok := pendStatus[ev.Session]; !ok {
				order = append(order, "t:"+ev.Session)
			}
			f := ev.Fields
			if f == nil {
				f = []engine.StatusField{}
			}
			pendStatus[ev.Session] = statusPayload{Session: ev.Session, Fields: f}
		case engine.EvSessionRemoved:
			delete(pendInfo, ev.Session) // never resurrect a removed session
			delete(pendStatus, ev.Session)
			s.emit("session-removed", map[string]string{"id": ev.Session})
		case engine.EvForeground:
			flush() // the session must be known to the UI before it is selected
			s.fgMu.Lock()
			echo := s.uiFg == ev.Session // the UI's own choice coming back: do not bounce it
			s.uiFg = ev.Session
			s.fgMu.Unlock()
			if !echo {
				s.emit("foreground", map[string]string{"session": ev.Session})
			}
		case engine.EvReset:
			s.emit("reset", map[string]string{"session": ev.Session})
		case engine.EvNotice:
			s.emit("notice", Notice{Level: ev.Level, Text: ev.Text, Session: ev.Session})
		case engine.EvBell:
			s.emit("bell", map[string]string{"session": ev.Session})
		case engine.EvSquatter:
			if ev.Squatter != nil {
				s.emit("squatter", ev.Squatter)
			}
		case engine.EvSuspend:
			s.emit("suspend", map[string]bool{"suspended": ev.Suspended})
		case engine.EvAway:
			s.emit("away", map[string]any{"sessions": ev.Away})
		case engine.EvWindow:
			if s.win != nil {
				s.win(ev.Text)
			}
		case engine.EvQuit:
			s.emit("quit", map[string]string{})
			if s.quit != nil {
				go s.quit()
			}
		}
	}
	flush()
}
