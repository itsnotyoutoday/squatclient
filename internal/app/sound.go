package app

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/itsnotyoutoday/cmcp/go/audio"
	"github.com/itsnotyoutoday/cmcp/go/msg"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
)

// Sound (cmcp spec 9). The decisions are the shared core's (audio.Resolve: local file named by the era map, else the pack's sample,
// else a synthesis recipe, else the bell, else silence; staged sounds per stage); this file feeds it the player's folder and the era
// maps, turns the outcome into plain playback instructions for the web view's Web Audio engine (frontend/src/cmcp/audio.ts) and
// serves the audio bytes to it. The local sound folder is only ever read, never copied, listed to the game or uploaded.

//go:embed sounddata/*.json
var eraFS embed.FS

const (
	audioURLLocal    = "/cmcp-audio/local/"
	audioURLSample   = "/cmcp-audio/sample/"
	audioURLSelfTest = "/cmcp-audio/selftest/"
)

type soundSvc struct {
	s *Service

	muteMu    sync.Mutex
	quickMute map[string]bool                      // sessions without a saved world: muted for this run only
	loops     map[string]map[string]*msg.SoundPlay // session -> key -> the looping sound that is meant to be playing (resumed when unmuted)

	mu     sync.Mutex
	folder string
	files  map[string]bool    // relative paths (slash separated) of the local sound folder
	gains  map[string]float64 // linear playback gain per relative path (normalise.json, suggestions applied at playback)
	eras   map[string]*audio.EraMap
	idx    audio.EraIndex
}

func newSoundSvc(s *Service) *soundSvc {
	ss := &soundSvc{s: s, eras: map[string]*audio.EraMap{}, quickMute: map[string]bool{}, loops: map[string]map[string]*msg.SoundPlay{}}
	if b, err := eraFS.ReadFile("sounddata/index.json"); err == nil {
		if idx, err := audio.ParseEraIndex(b); err == nil {
			ss.idx = *idx
		}
	}
	if ss.idx.Default == "" {
		ss.idx.Default = "tng"
	}
	return ss
}

// configure points the service at the player's sound folder ("" = none) and rescans it.
func (ss *soundSvc) configure(folder string) {
	ss.mu.Lock()
	same := ss.files != nil && ss.folder == folder
	ss.mu.Unlock()
	if same {
		return
	}
	files := map[string]bool{}
	gains := map[string]float64{}
	if folder != "" {
		_ = filepath.WalkDir(folder, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.Type().IsRegular() {
				if rel, err := filepath.Rel(folder, p); err == nil {
					files[filepath.ToSlash(rel)] = true
				}
			}
			return nil
		})
		if b, err := os.ReadFile(filepath.Join(folder, "era-maps", "normalise.json")); err == nil {
			var n struct {
				Files map[string]map[string]any `json:"files"`
			}
			if json.Unmarshal(b, &n) == nil {
				for f, m := range n.Files {
					for k, v := range m {
						if g, ok := v.(float64); ok && strings.Contains(k, "gain") {
							gains[f] = math.Pow(10, math.Max(-12, math.Min(12, g))/20) // suggestions are limited to +-12 dB
						}
					}
				}
			}
		}
	}
	ss.mu.Lock()
	ss.folder, ss.files, ss.gains, ss.eras = folder, files, gains, map[string]*audio.EraMap{}
	ss.mu.Unlock()
}

// Rescan reads the sound folder again (the player added files).
func (ss *soundSvc) Rescan() {
	ss.mu.Lock()
	f := ss.folder
	ss.files = nil
	ss.mu.Unlock()
	ss.configure(f)
}

// eraMap loads the era's map: the player's own <folder>/era-maps/<era>.json first, then the built-in one.
func (ss *soundSvc) eraMap(era string) *audio.EraMap {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if m, ok := ss.eras[era]; ok {
		return m
	}
	var raw []byte
	if ss.folder != "" {
		raw, _ = os.ReadFile(filepath.Join(ss.folder, "era-maps", era+".json"))
	}
	if raw == nil {
		raw, _ = eraFS.ReadFile("sounddata/" + era + ".json")
	}
	var m *audio.EraMap
	if raw != nil {
		m, _ = audio.ParseEraMap(raw)
	}
	ss.eras[era] = m
	return m
}

// Instr is one playback instruction for the web view.
type Instr struct {
	Kind        string          `json:"kind"` // url | recipe | bell | silence | staged
	URL         string          `json:"url,omitempty"`
	Gain        float64         `json:"gain,omitempty"` // linear, 0 = 1
	Loop        bool            `json:"loop,omitempty"`
	Volume      float64         `json:"volume,omitempty"`
	AtS         float64         `json:"atS,omitempty"`
	CrossfadeMS int             `json:"crossfadeMs,omitempty"`
	Recipe      *ResolvedRecipe `json:"recipe,omitempty"`
	Stages      []Instr         `json:"stages,omitempty"`
	OnStop      *Instr          `json:"onStop,omitempty"`
	// Alt is what to play when the first choice cannot be loaded (a pack sample whose host is unreachable, a missing local file): the pack's
	// own recipe for the event, so the default works without any sound folder and without the sample host.
	Alt *Instr `json:"alt,omitempty"`
}

// SoundMsg is the "cmcp-audio" window event.
type SoundMsg struct {
	EvID     string  `json:"evId,omitempty"` // follows one Sound.Play through the diagnostics log
	Session  string  `json:"session"`
	Op       string  `json:"op"` // play stop stopall
	Key      string  `json:"key,omitempty"`
	Event    string  `json:"event,omitempty"`
	Category string  `json:"category,omitempty"`
	Volume   float64 `json:"volume"`
	Pan      float64 `json:"pan,omitempty"`
	Priority int     `json:"priority"`
	FadeMS   int     `json:"fadeMs,omitempty"`
	Loop     bool    `json:"loop,omitempty"`
	Res      *Instr  `json:"res,omitempty"`
}

var categories = map[string]string{
	"red_alert": "alert", "yellow_alert": "alert", "alert": "alert", "alert_off": "alert", "proximity_warning": "alert",
	"phaser_fire": "weapon", "torpedo_launch": "weapon", "torpedo_travel": "weapon", "lock_acquired": "weapon", "lock_lost": "weapon",
	"phaser_hit": "impact", "torpedo_hit": "impact", "shield_hit": "impact", "hull_hit": "impact", "explosion": "impact", "ship_destroyed": "impact",
	"impulse_loop": "ambient", "warp_core_hum": "ambient", "beam_shimmer": "ambient",
	"comm_beep": "ui", "hail": "ui", "console_click": "ui",
}

func categoryOf(event string) string {
	if c, ok := categories[event]; ok {
		return c
	}
	return "system"
}

// resolveInstr resolves one Sound.Play. The result is nil when nothing is to be played.
func (ss *soundSvc) resolve(sessionID string, p *msg.SoundPlay) *Instr {
	st := ss.s.cfg.Settings()
	event := p.Event
	if event == "" {
		event = p.Sound
	}
	shipTheme := ""
	if ui, err := ss.s.eng.CmcpUI(sessionID); err == nil && ui.Ship != nil {
		shipTheme = ui.Ship.Theme
	}
	mode := "ship"
	if st.ConsoleThemeMode == "fixed" || !st.UseShipTheme {
		mode = "fixed"
	}
	era := audio.SelectEra(st.SoundEra, mode, shipTheme, st.ConsoleTheme, ss.idx)
	em := ss.eraMap(era)
	ss.mu.Lock()
	files := ss.files
	ss.mu.Unlock()
	res := audio.Resolve(event, p.Params, em, files, ss.s.eng.CmcpSoundPack(sessionID), audio.Caps{Play: true, Formats: []string{"wav", "ogg", "mp3"}, Recipes: true})
	return ss.instr(sessionID, res, p)
}

func (ss *soundSvc) localURL(rel string) string {
	u := url.URL{Path: rel}
	return audioURLLocal + strings.TrimPrefix(u.EscapedPath(), "/")
}

func opt(o *audio.Option, in *Instr) {
	if o == nil {
		return
	}
	in.Loop = o.Loop
	if o.Volume != nil {
		in.Volume = *o.Volume
	}
	if o.Gain != nil {
		in.Gain *= *o.Gain
	}
	in.AtS, in.CrossfadeMS = o.AtS, o.CrossfadeMS
}

func (ss *soundSvc) instr(sid string, r audio.Resolution, p *msg.SoundPlay) *Instr {
	in := &Instr{Gain: 1}
	switch r.Kind {
	case audio.Local:
		in.Kind, in.URL = "url", ss.localURL(r.Name)
		ss.mu.Lock()
		if g, ok := ss.gains[r.Name]; ok {
			in.Gain = g
		}
		ss.mu.Unlock()
	case audio.FromPack:
		in.Kind, in.URL = "url", audioURLSample+url.PathEscape(sid)+"/"+url.PathEscape(r.Name)
		// a WebKit view may not decode Ogg Vorbis: the pack's wav of the same sound (when it has one) is the fallback, then the recipe
		if alt := ss.wavSibling(sid, r.Name); alt != "" {
			w := &Instr{Kind: "url", URL: audioURLSample + url.PathEscape(sid) + "/" + url.PathEscape(alt), Gain: 1}
			w.Alt = ss.recipeAlt(sid, p)
			in.Alt = w
		}
	case audio.Recipe:
		sp := ss.s.eng.CmcpSoundPack(sid)
		if sp == nil || sp.Recipes[r.Name] == nil {
			return nil
		}
		rr, err := resolveRecipe(sp.Recipes[r.Name], p.Params, p.Event)
		if err != nil {
			return nil
		}
		in.Kind, in.Recipe = "recipe", rr
	case audio.Bell:
		in.Kind = "bell"
	case audio.Staged:
		in.Kind = "staged"
		for i := range r.Stages {
			if s := ss.instr(sid, r.Stages[i], p); s != nil {
				in.Stages = append(in.Stages, *s)
			}
		}
		if r.Option != nil && r.Option.OnStop != nil {
			in.OnStop = ss.onStop(sid, r.Option.OnStop)
		}
	default:
		return nil
	}
	if in.Kind == "url" && in.Alt == nil {
		in.Alt = ss.recipeAlt(sid, p)
	}
	opt(r.Option, in)
	if in.Kind == "staged" { // the staged option's own loop/volume are per stage
		in.Loop, in.AtS = false, 0
	}
	return in
}

func (ss *soundSvc) onStop(sid string, o *audio.Option) *Instr {
	ss.mu.Lock()
	files := ss.files
	ss.mu.Unlock()
	for _, f := range append([]string{o.File}, o.Files...) {
		if f == "" {
			continue
		}
		if files[f] {
			in := &Instr{Kind: "url", URL: ss.localURL(f), Gain: 1}
			ss.mu.Lock()
			if g, ok := ss.gains[f]; ok {
				in.Gain = g
			}
			ss.mu.Unlock()
			if o.Volume != nil {
				in.Volume = *o.Volume
			}
			return in
		}
	}
	if o.Sample != "" {
		return &Instr{Kind: "url", URL: audioURLSample + url.PathEscape(sid) + "/" + url.PathEscape(o.Sample), Gain: 1}
	}
	return nil
}

// handleNotes turns the engine's sound notes into "cmcp-audio" events.
func (s *Service) handleSoundNotes(session string, notes []engine.CmcpNote) {
	for _, n := range notes {
		if n.Kind != "sound" && n.Kind != "ui-sound" {
			continue
		}
		switch {
		case n.StopAll:
			if s.snd != nil {
				s.snd.noteLoop(session, nil, true, "")
			}
			s.emit("cmcp-audio", SoundMsg{Session: session, Op: "stopall", FadeMS: n.FadeMS})
		case n.Stop != nil:
			if s.snd != nil {
				k := n.Stop.Key
				if k == "" {
					k = n.Stop.Event
				}
				s.snd.noteLoop(session, nil, true, k)
			}
			s.emit("cmcp-audio", SoundMsg{Session: session, Op: "stop", Key: n.Stop.Key, Event: n.Stop.Event, FadeMS: n.Stop.FadeMS})
			if n.Stop.All {
				s.emit("cmcp-audio", SoundMsg{Session: session, Op: "stopall", FadeMS: n.Stop.FadeMS})
			}
		case n.Sound != nil:
			s.playSound(session, n.Sound)
		case n.Kind == "ui-sound":
			s.playSound(session, &msg.SoundPlay{Event: n.Text, Params: n.Params})
		}
	}
}

func (s *Service) playSound(session string, p *msg.SoundPlay) {
	if s.snd == nil {
		return
	}
	s.snd.noteLoop(session, p, false, "") // a loop is remembered even while muted: unmuting resumes it
	ev := p.Event
	if ev == "" {
		ev = p.Sound
	}
	eid := fmt.Sprintf("e%d", s.d.soundEv.Add(1)) // one id follows this sound from the wire to the web view's "ended"
	s.dlog("sound", session, "ev=%s wire Sound.Play event=%q key=%q loop=%v", eid, ev, p.Key, p.Loop)
	if !s.eng.CmcpAboard(session) && (ev == "red_alert" || ev == "yellow_alert" || ev == "alert") {
		s.soundLog(eid, "Sound.Play %q not played: the player is not aboard a ship", ev)
		return // the red-alert loop belongs to a ship the player is on (the core keeps no alert-sound state)
	}
	if st := s.MuteState(session); st != "" {
		s.soundLog(eid, "Sound.Play %q not played: muted (%s)", ev, st)
		return // muted (globally or for this world): nothing is resolved and nothing plays
	}
	res := s.snd.resolve(session, p)
	if res == nil || res.Kind == "silence" {
		s.soundLog(eid, "Sound.Play %q resolved to nothing (no local file in %q, no pack sample or recipe, no bell)", ev, s.cfg.Settings().SoundFolder)
		return
	}
	s.dlog("sound", session, "ev=%s resolved %q -> %s", eid, ev, describeInstr(res))
	m := SoundMsg{EvID: eid, Session: session, Op: "play", Key: p.Key, Event: ev, Category: categoryOf(ev), Volume: 1, Priority: 5, FadeMS: p.FadeMS, Loop: p.Loop, Res: res}
	if p.Volume != nil {
		m.Volume = *p.Volume
	}
	if p.Pan != nil {
		m.Pan = *p.Pan
	}
	if p.Priority != nil {
		m.Priority = *p.Priority
	}
	s.dlog("sound", session, "ev=%s emitted cmcp-audio play key=%q event=%q volume=%.2f loop=%v", eid, m.Key, ev, m.Volume, m.Loop)
	s.emit("cmcp-audio", m)
}

// AudioHandler serves the audio bytes to the web view under /cmcp-audio/: files of the local sound folder (streamed with ranges,
// confined to the folder) and samples of a game's sound pack (fetched by the Go side, never by the web view).
func (s *Service) AudioHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, audioURLLocal):
			s.serveLocal(w, r, strings.TrimPrefix(r.URL.Path, audioURLLocal))
		case strings.HasPrefix(r.URL.Path, audioURLSample):
			parts := strings.SplitN(strings.TrimPrefix(r.URL.EscapedPath(), audioURLSample), "/", 2)
			if len(parts) != 2 {
				http.NotFound(w, r)
				return
			}
			sid, _ := url.PathUnescape(parts[0])
			name, _ := url.PathUnescape(parts[1])
			b, ct, err := s.eng.CmcpSample(sid, name)
			if err != nil {
				s.soundLog("", "sample %q of session %q could not be served: %v", name, sid, err)
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", ct)
			w.Header().Set("Cache-Control", "private, max-age=3600")
			_, _ = w.Write(b)
		case strings.HasPrefix(r.URL.Path, audioURLSelfTest):
			// developer diagnostics: SQUATCLIENT_AUDIO_SELFTEST_DIR=<folder> serves that folder's files for the sound self-test (never set in a release)
			dir := os.Getenv("SQUATCLIENT_AUDIO_SELFTEST_DIR")
			name := path.Base(strings.TrimPrefix(r.URL.Path, audioURLSelfTest))
			if dir == "" || name == "." || name == "/" {
				http.NotFound(w, r)
				return
			}
			http.ServeFile(w, r, filepath.Join(dir, name))
		default:
			http.NotFound(w, r)
		}
	})
}

// AudioSelfTestDir is the developer sound self-test folder (SQUATCLIENT_AUDIO_SELFTEST_DIR), "" in a normal run.
func (s *Service) AudioSelfTestDir() string { return os.Getenv("SQUATCLIENT_AUDIO_SELFTEST_DIR") }

// AudioSelfTestLive is the developer live self-test script (SQUATCLIENT_AUDIO_SELFTEST_LIVE="host:port|command|command..."), "" in a normal run.
func (s *Service) AudioSelfTestLive() string { return os.Getenv("SQUATCLIENT_AUDIO_SELFTEST_LIVE") }

func (s *Service) serveLocal(w http.ResponseWriter, r *http.Request, rel string) {
	if s.snd == nil {
		http.NotFound(w, r)
		return
	}
	s.snd.mu.Lock()
	folder, ok := s.snd.folder, s.snd.files
	s.snd.mu.Unlock()
	clean := path.Clean("/" + rel)[1:]
	if folder == "" || clean == "" || !ok[clean] { // only files the scan found: no traversal, no symlink-to-elsewhere surprises
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(folder, filepath.FromSlash(clean))
	if real, err := filepath.EvalSymlinks(full); err == nil {
		if rf, err := filepath.EvalSymlinks(folder); err == nil && !strings.HasPrefix(real, rf+string(filepath.Separator)) {
			http.NotFound(w, r) // a link that leaves the folder
			return
		}
	}
	f, err := os.Open(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, clean, st.ModTime(), f) // Range requests: long beds stream
}

// recipeAlt is the pack's synthesis recipe for the event, when it has one: the fallback for a file that cannot be loaded.
func (ss *soundSvc) recipeAlt(sid string, p *msg.SoundPlay) *Instr {
	sp := ss.s.eng.CmcpSoundPack(sid)
	if sp == nil {
		return nil
	}
	ev := p.Event
	if ev == "" {
		ev = p.Sound
	}
	for _, o := range sp.Events[ev] {
		if o.Recipe == "" || sp.Recipes[o.Recipe] == nil {
			continue
		}
		rr, err := resolveRecipe(sp.Recipes[o.Recipe], p.Params, ev)
		if err != nil {
			return nil
		}
		in := &Instr{Kind: "recipe", Recipe: rr, Gain: 1, Loop: o.Loop}
		if o.Volume != nil {
			in.Volume = *o.Volume
		}
		return in
	}
	return nil
}

// ---- mute: global (the soundMuted setting) or per world (World.SoundMuted; a connection without a saved world mutes for this run only)

// MuteState says what mutes a session's sound: "global", "world" or "" (audible). Global wins when both are set.
func (s *Service) MuteState(session string) string {
	if s.cfg.Settings().SoundMuted {
		return "global"
	}
	if s.sessionWorldMuted(session) {
		return "world"
	}
	return ""
}

func (s *Service) sessionWorldMuted(session string) bool {
	if si, err := s.eng.Session(session); err == nil && si.WorldID != "" {
		if w, err := s.cfg.World(si.WorldID); err == nil {
			return w.SoundMuted
		}
	}
	if s.snd == nil {
		return false
	}
	s.snd.muteMu.Lock()
	defer s.snd.muteMu.Unlock()
	return s.snd.quickMute[session]
}

// SetWorldSoundMuted mutes or unmutes one session's world: persisted on the saved world, else for this connection. Anything that
// loops stops at once; unmuting resumes the loops that were meant to be playing (a red alert that is still on).
func (s *Service) SetWorldSoundMuted(session string, muted bool) error {
	si, err := s.eng.Session(session)
	if err != nil {
		return err
	}
	if si.WorldID != "" {
		if w, err := s.cfg.World(si.WorldID); err == nil {
			w.SoundMuted = muted
			if _, err := s.cfg.SaveWorld(w); err != nil {
				return err
			}
			s.syncWorlds()
			s.soundMuteChanged(session)
			return nil
		}
	}
	if s.snd != nil {
		s.snd.muteMu.Lock()
		s.snd.quickMute[session] = muted
		s.snd.muteMu.Unlock()
	}
	s.soundMuteChanged(session)
	return nil
}

// soundMuteChanged applies the effective mute of one session (or every session when session is ""): stops its sounds when muted, resumes
// the loops that are still meant to play when audible, and tells the web view.
func (s *Service) soundMuteChanged(session string) {
	ids := []string{session}
	if session == "" {
		ids = nil
		for _, si := range s.eng.Sessions() {
			ids = append(ids, si.ID)
		}
	}
	for _, id := range ids {
		st := s.MuteState(id)
		eff := st
		if eff == "" {
			eff = "audible"
		}
		s.ClientLog(fmt.Sprintf("mute: session %s is now %s (global=%v)", id, eff, s.cfg.Settings().SoundMuted))
		s.snapshotSoon("mute change")
		s.emit("sound-mute", map[string]any{"session": id, "muted": st})
		if st != "" {
			s.emit("cmcp-audio", SoundMsg{Session: id, Op: "stopall", FadeMS: 100})
			continue
		}
		if s.snd == nil {
			continue
		}
		s.snd.muteMu.Lock()
		var again []*msg.SoundPlay
		for _, p := range s.snd.loops[id] {
			again = append(again, p)
		}
		s.snd.muteMu.Unlock()
		for _, p := range again {
			s.playSound(id, p)
		}
	}
}

// noteLoop keeps track of the loops a session's game started and has not stopped (so unmuting can resume them).
func (ss *soundSvc) noteLoop(session string, p *msg.SoundPlay, stop bool, key string) {
	ss.muteMu.Lock()
	defer ss.muteMu.Unlock()
	if stop {
		if key == "" {
			delete(ss.loops, session)
		} else if m := ss.loops[session]; m != nil {
			delete(m, key)
		}
		return
	}
	if p == nil || !p.Loop {
		return
	}
	k := p.Key
	if k == "" {
		k = p.Event
	}
	if ss.loops[session] == nil {
		ss.loops[session] = map[string]*msg.SoundPlay{}
	}
	ss.loops[session][k] = p
}

// wavSibling is the pack's wav file of the same sound as an ogg sample ("red_alert.ogg" -> "red_alert.wav"), "" when it has none.
func (ss *soundSvc) wavSibling(sid, name string) string {
	if !strings.HasSuffix(strings.ToLower(name), ".ogg") {
		return ""
	}
	sp := ss.s.eng.CmcpSoundPack(sid)
	if sp == nil {
		return ""
	}
	w := strings.TrimSuffix(name, name[len(name)-4:]) + ".wav"
	if _, ok := sp.Files[w]; ok {
		return w
	}
	return ""
}

// soundLog writes a line of the sound path's decisions to client.log. It never hides a CHANGE: an identical line (same event, same decision) is written at most
// once per 10 s, with a count of the ones held back, so a busy game cannot fill the log and a mute, an unmute or a new decision always shows. State
// changes (mutes, packs, the audio trace) do not go through here at all.
func (s *Service) soundLog(eid, format string, a ...any) {
	line := fmt.Sprintf(format, a...)
	now := time.Now()
	s.soundSeenMu.Lock()
	if s.soundSeen == nil {
		s.soundSeen = map[string]*soundSeen{}
	}
	e := s.soundSeen[line]
	if e != nil && now.Sub(e.at) < 10*time.Second {
		e.held++
		s.soundSeenMu.Unlock()
		return
	}
	held := 0
	if e != nil {
		held = e.held
	}
	s.soundSeen[line] = &soundSeen{at: now}
	if len(s.soundSeen) > 2000 { // bounded: forget the old ones
		s.soundSeen = map[string]*soundSeen{line: {at: now}}
	}
	s.soundSeenMu.Unlock()
	if held > 0 {
		line = fmt.Sprintf("%s (+%d like it in the last 10 s)", line, held)
	}
	s.dlog("sound", "", "ev=%s %s", eid, line)
}

type soundSeen struct {
	at   time.Time
	held int
}

func describeInstr(in *Instr) string {
	switch in.Kind {
	case "url":
		return "url " + in.URL
	case "staged":
		var parts []string
		for i := range in.Stages {
			parts = append(parts, describeInstr(&in.Stages[i]))
		}
		return "staged [" + strings.Join(parts, " > ") + "]"
	}
	return in.Kind
}
