package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"

	"github.com/itsnotyoutoday/squatclient/internal/dlog"
)

// The diagnostics log (internal/dlog): one redacted, timestamped timeline of the session. This file is the service's side of it: it owns the logger, routes
// the engine's trail, the sound path and the page's own lines into it, writes the periodic and on-change state snapshots, and offers the dialog's
// actions (status, switch, clear, view, zip). Nothing here ever leaves the machine by itself.

// DiagSetup is the build-time policy and project constants (main sets them from -ldflags).
type DiagSetup struct {
	Mode        string // always | optin | off
	Build       string // commit, dirty flag and build time
	Version     string
	RepoSlug    string // owner/name of the project's GitHub repository (issues are filed there)
	ContactName string // who to talk to for another private way of delivering a log
	ContactHost string
	ContactPort int
}

// DiagInfo is what the dialog needs to know about the build.
type DiagInfo struct {
	Mode        string `json:"mode"`      // always | optin | off
	Available   bool   `json:"available"` // false when compiled out
	Enabled     bool   `json:"enabled"`
	Build       string `json:"build"`
	Version     string `json:"version"`
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	RepoSlug    string `json:"repoSlug"`
	ContactName string `json:"contactName"`
	ContactHost string `json:"contactHost"`
	ContactPort int    `json:"contactPort"`
	Folder      string `json:"folder"`
}

// DiagStatus is the dialog's status block.
type DiagStatus struct {
	Info       DiagInfo    `json:"info"`
	Log        dlog.Status `json:"log"`
	Redactions int64       `json:"redactions"` // secrets removed from the logs on disk
}

// DiagZipOptions comes from the wizard.
type DiagZipOptions struct {
	CurrentOnly bool   `json:"currentOnly"`
	Note        string `json:"note"`
	Dest        string `json:"dest"` // a full path, or "" for the Downloads folder
}

type diagState struct {
	setup       DiagSetup
	mode        dlog.Mode
	dl          *dlog.Logger
	prefs       string // diagnostics.json
	namesM      sync.Mutex
	names       map[string]string // session id -> world name
	states      map[string]string // session id -> last state logged
	soundEv     atomic.Int64      // Sound.Play event ids
	snapPending atomic.Bool       // a coalesced snapshot is already scheduled (snapshotSoon)
}

var secretKey = regexp.MustCompile(`(?i)pass|secret|token|key|cookie|pw|login`)

var sessionPrefix = regexp.MustCompile(`^(dbg|ctx|pack|stream|theme) (\S+): `)

// initDiag opens the logger according to the compile-time mode and the user's saved choice.
func (s *Service) initDiag(setup DiagSetup) {
	s.d.setup = setup
	s.d.mode = dlog.ParseMode(setup.Mode)
	s.d.names = map[string]string{}
	s.d.states = map[string]string{}
	s.d.prefs = filepath.Join(s.cfg.Dir(), "diagnostics.json")
	if s.d.mode == dlog.Off {
		return // compiled out: no logger, nothing is ever written
	}
	on := dlog.Effective(s.d.mode, dlog.LoadPrefs(s.d.prefs))
	s.d.dl = dlog.Open(dlog.Config{Dir: filepath.Join(s.cfg.Dir(), "diagnostics"), Enabled: on})
	s.eng.SetCmcpTrail(on)
}

// DiagInfo describes the build's diagnostics policy.
func (s *Service) DiagInfo() DiagInfo {
	st := s.d.setup
	return DiagInfo{Mode: string(s.d.mode), Available: s.d.mode != dlog.Off, Enabled: s.d.dl.Enabled(), Build: st.Build, Version: st.Version,
		OS: runtime.GOOS, Arch: runtime.GOARCH, RepoSlug: st.RepoSlug, ContactName: st.ContactName, ContactHost: st.ContactHost, ContactPort: st.ContactPort,
		Folder: filepath.Join(s.cfg.Dir(), "diagnostics")}
}

// DiagStatus lists what is logged and what is on disk.
func (s *Service) DiagStatus() DiagStatus {
	ds := DiagStatus{Info: s.DiagInfo(), Log: s.d.dl.Status()}
	for _, si := range ds.Log.Sessions {
		ds.Redactions += si.Redactions
	}
	return ds
}

// DiagSetEnabled is the user's switch (it persists).
func (s *Service) DiagSetEnabled(on bool) error {
	if s.d.mode == dlog.Off || s.d.dl == nil {
		return fmt.Errorf("diagnostics are not part of this build")
	}
	if !on {
		s.dlog("settings", "", "diagnostics logging turned OFF by the user (this is the last line of this log until it is turned on again)")
	}
	if err := dlog.SavePrefs(s.d.prefs, dlog.Prefs{Chosen: true, Enabled: on}); err != nil {
		return err
	}
	s.d.dl.SetEnabled(on)
	s.eng.SetCmcpTrail(on)
	if on {
		s.logHeader()
		s.DiagSnapshot("switched on")
	}
	return nil
}

// DiagClear deletes every diagnostics log (the user confirmed in the dialog).
func (s *Service) DiagClear() error {
	if s.d.dl == nil {
		return nil
	}
	err := s.d.dl.Clear()
	if s.d.dl.Enabled() {
		s.logHeader()
	}
	return err
}

// DiagView returns the last n lines of the current session containing filter.
func (s *Service) DiagView(n int, filter string) ([]string, error) {
	if n <= 0 || n > 5000 {
		n = 500
	}
	return s.d.dl.Tail(n, filter)
}

// DiagLogLine is the page's way into the log: layer is ui, web-audio, error, snapshot...; the world name is looked up from the session id.
func (s *Service) DiagLogLine(layer, session, text string) {
	if layer == "" {
		layer = "ui"
	}
	s.dlog(layer, session, "%s", text)
}

// dlog writes one line; it is cheap when logging is off.
func (s *Service) dlog(layer, session, format string, a ...any) {
	dl := s.d.dl
	if dl == nil || !dl.Enabled() {
		return
	}
	msg := format
	if len(a) > 0 || strings.Contains(format, "%") {
		msg = fmt.Sprintf(format, a...)
	}
	dl.Log(layer, session, s.worldName(session), msg)
}

func (s *Service) worldName(session string) string {
	if session == "" {
		return ""
	}
	s.d.namesM.Lock()
	defer s.d.namesM.Unlock()
	return s.d.names[session]
}

// noteSession remembers a session's world name and logs its state changes (connect, ready, ended with the reason).
func (s *Service) noteSession(si *engine.SessionInfo) {
	if si == nil {
		return
	}
	s.d.namesM.Lock()
	s.d.names[si.ID] = si.Name
	prev := s.d.states[si.ID]
	cur := si.State
	if si.EndReason != "" {
		cur += "/" + si.EndReason
	}
	s.d.states[si.ID] = cur
	s.d.namesM.Unlock()
	if prev != cur {
		line := fmt.Sprintf("session %s %q %s:%d tls=%v state %s -> %s", si.ID, si.Name, si.Host, si.Port, si.TLS, orNone(prev), cur)
		if si.EndDetail != "" {
			line += " detail=" + si.EndDetail
		}
		s.dlog("net", si.ID, "%s", line)
		s.snapshotSoon("session state: " + cur)
	}
}

func orNone(s string) string {
	if s == "" {
		return "(new)"
	}
	return s
}

// classify turns a line of the engine's trail or the legacy ClientLog into a layer, a session id and the text.
func classify(line string) (layer, session, text string) {
	line = strings.TrimSpace(line)
	if m := sessionPrefix.FindStringSubmatch(line); m != nil {
		text = line[len(m[0]):]
		switch m[1] {
		case "pack", "theme":
			return "packs", m[2], text
		case "stream":
			return "cmcp", m[2], "stream " + text
		case "ctx":
			return "cmcp", m[2], "ctx: " + text
		}
		if strings.HasPrefix(text, "player:") {
			return "ui", m[2], text
		}
		return "cmcp", m[2], text
	}
	switch {
	case strings.HasPrefix(line, "sound:"), strings.HasPrefix(line, "mute:"):
		return "sound", "", line
	case strings.HasPrefix(line, "settings:"):
		return "settings", "", line
	case strings.HasPrefix(line, "start:"):
		return "session", "", line
	case strings.HasPrefix(line, "pack store"):
		return "packs", "", line
	case strings.HasPrefix(line, "selftest"):
		return "web-audio", "", line
	}
	return "ui", "", line
}

// ClientLog is the legacy sink (the engine's trail, the sound path, the page's older calls): the line is classified and written to the diagnostics log.
// A developer self-test (SQUATCLIENT_AUDIO_SELFTEST_*) also gets the plain client.log it reads.
func (s *Service) ClientLog(line string) {
	layer, sid, text := classify(line)
	s.dlog(layer, sid, "%s", text)
	if os.Getenv("SQUATCLIENT_AUDIO_SELFTEST_DIR") != "" || os.Getenv("SQUATCLIENT_AUDIO_SELFTEST_LIVE") != "" {
		if f, err := os.OpenFile(filepath.Join(s.cfg.Dir(), "client.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
			_, _ = f.WriteString(time.Now().Format("2006-01-02 15:04:05 ") + strings.ReplaceAll(strings.TrimSpace(line), "\n", " | ") + "\n")
			_ = f.Close()
		}
	}
}

// logHeader writes the environment header: build, policy, platform, versions, settings (nothing secret).
func (s *Service) logHeader() {
	st := s.d.setup
	s.dlog("session", "", "env: build=%q version=%s diagnosticsMode=%s os=%s arch=%s go=%s cpus=%d", st.Build, st.Version, s.d.mode, runtime.GOOS, runtime.GOARCH, runtime.Version(), runtime.NumCPU())
	s.dlog("session", "", "env: configDir=%s worlds=%d core=%s", tilde(s.cfg.Dir()), len(s.cfg.Worlds()), coreVersion())
	s.dlog("settings", "", "settings at start: %s", settingsSummary(s.cfg.Settings()))
	s.dlog("sound", "", "sound path check: packStore=%v soundFolderSet=%v cmcp=%v originPolicy=%s", s.eng.HasCmcpPacks(), s.cfg.Settings().SoundFolder != "", s.cfg.Settings().Cmcp,
		"announced packs from the game's own host or an https origin it announces are fetched when the consent mode allows (see cmcp.packs lines per session)")
}

func tilde(p string) string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return strings.Replace(p, h, "~", 1)
	}
	return p
}

// coreVersion is the shared CMCP core module's version (or its local replacement) from the build info.
func coreVersion() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, d := range bi.Deps {
		if strings.HasPrefix(d.Path, "github.com/itsnotyoutoday/cmcp") {
			v := d.Version
			if d.Replace != nil {
				v += " (replaced by " + tilde(d.Replace.Path) + " " + d.Replace.Version + ")"
			}
			return v
		}
	}
	return "unknown"
}

// settingsMap is the settings as a flat key -> value map (JSON round trip).
func settingsMap(v any) map[string]any {
	b, _ := json.Marshal(v)
	m := map[string]any{}
	_ = json.Unmarshal(b, &m)
	return m
}

func settingsSummary(v any) string {
	m := settingsMap(v)
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s ", k, short(fmt.Sprint(m[k])))
	}
	return strings.TrimSpace(b.String())
}

func short(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 160 {
		return s[:160] + "..."
	}
	return s
}

// logSettingsChange writes one line per changed setting: key, old, new (values go through the redactor with the line).
func (s *Service) logSettingsChange(old, cur any) {
	o, n := settingsMap(old), settingsMap(cur)
	keys := make([]string, 0, len(n))
	for k := range n {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	changed := 0
	for _, k := range keys {
		a, b := fmt.Sprint(o[k]), fmt.Sprint(n[k])
		if a != b {
			changed++
			if secretKey.MatchString(k) {
				s.dlog("settings", "", "changed %s: (value not logged)", k)
				continue
			}
			s.dlog("settings", "", "changed %s: %s -> %s", k, short(a), short(b))
		}
	}
	if changed == 0 {
		s.dlog("settings", "", "settings saved, nothing changed")
	}
}

// DiagSnapshot writes one compact state line per session (plus a global one). why says what triggered it; the page adds its own lines (tabs, audio
// context, voices) when it receives the "diag-snapshot" event.
func (s *Service) DiagSnapshot(why string) {
	if !s.d.dl.Enabled() {
		return
	}
	hits, misses := s.eng.PackStats()
	set := s.cfg.Settings()
	sess := s.eng.Sessions()
	s.dlog("snapshot", "", "why=%s sessions=%d packStore=%v packHits=%d packMisses=%d globalMute=%v soundFolderSet=%v theme=%q", why, len(sess), s.eng.HasCmcpPacks(), hits, misses, set.SoundMuted, set.SoundFolder != "", set.ConsoleTheme)
	s.fgMu.Lock()
	fg := s.uiFg
	s.fgMu.Unlock()
	for _, si := range sess {
		line := fmt.Sprintf("world=%q id=%s %s:%d state=%s fg=%v mute=%q", si.Name, si.WorldID, si.Host, si.Port, si.State, si.ID == fg, s.MuteState(si.ID))
		if ui, err := s.eng.CmcpUI(si.ID); err == nil && ui != nil {
			var stack []string
			for _, e := range ui.Stack {
				stack = append(stack, e.Kind+":"+e.Key)
			}
			cons := ""
			if ui.Console != nil {
				cons = ui.Console.ID
			}
			ship := ""
			if ui.Ship != nil {
				ship = ui.Ship.ID
			} else if o := ui.Scopes["ship"].Owner; ui.V2 && o != nil {
				ship = o.ID
			}
			if ui.V2 && ui.Ctx != nil { // CMCP 2: the active context's type stands where the console id was
				cons = ui.Ctx.Type
			}
			note := ""
			if ui.Notice != nil {
				note = ui.Notice.Text
			}
			line += fmt.Sprintf(" cmcp=%s ship=%q aboard=%v console=%q stack=%v screen=%q alert=%q theme=%q notice=%q", ui.State, ship, s.eng.CmcpAboard(si.ID), cons, stack, ui.Screen.Resolved, ui.Alert, ui.ShipTheme, note)
		}
		s.dlog("snapshot", si.ID, "%s", line)
	}
	s.emit("diag-snapshot", map[string]string{"why": why})
}

// snapshotSoon writes a snapshot a moment from now (changes that arrive together share one): a connection state change, a tab switch, a mute.
func (s *Service) snapshotSoon(why string) {
	if !s.d.dl.Enabled() || !s.d.snapPending.CompareAndSwap(false, true) {
		return
	}
	time.AfterFunc(400*time.Millisecond, func() {
		s.d.snapPending.Store(false)
		s.DiagSnapshot(why)
	})
}

// startDiagSnapshots writes a snapshot every 30 s while any session is connected.
func (s *Service) startDiagSnapshots() {
	go func() {
		defer s.recoverLog("snapshot timer")
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-t.C:
				for _, si := range s.eng.Sessions() {
					if si.State == "connected" || si.State == "ready" || si.State == "open" {
						s.DiagSnapshot("periodic")
						break
					}
				}
			}
		}
	}()
}

// systemSummary is the zip's system.txt: build, platform, policy and settings, without secrets.
func (s *Service) systemSummary() string {
	var b strings.Builder
	st := s.d.setup
	fmt.Fprintf(&b, "build: %s\nversion: %s\nos/arch: %s/%s\ngo: %s\ndiagnostics mode: %s\ncore: %s\nconfig folder: %s\nworlds: %d\nsessions open: %d\n",
		st.Build, st.Version, runtime.GOOS, runtime.GOARCH, runtime.Version(), s.d.mode, coreVersion(), tilde(s.cfg.Dir()), len(s.cfg.Worlds()), len(s.eng.Sessions()))
	fmt.Fprintf(&b, "settings: %s\n", settingsSummary(s.cfg.Settings()))
	return b.String()
}

// DiagSummaryLines is a one-line state summary and the last few error lines for the issue form's prefilled fields (already redacted).
func (s *Service) DiagSummaryLines() []string {
	lines, _ := s.d.dl.Tail(5, "[error]")
	return lines
}

// DiagBuildZip packs the log into a zip (Downloads by default) named squatclient-diagnostics-<build>-<date>.zip. Nothing is uploaded.
func (s *Service) DiagBuildZip(o DiagZipOptions) (*dlog.ZipResult, error) {
	if s.d.dl == nil {
		return nil, fmt.Errorf("diagnostics are not part of this build")
	}
	dest := o.Dest
	if dest == "" {
		dir := DownloadsDir(s.cfg.Dir())
		dest = uniquePath(filepath.Join(dir, dlog.ZipName(s.d.setup.Build, time.Now())))
	}
	s.dlog("ui", "", "diagnostics zip requested: currentOnly=%v note=%v dest=%s", o.CurrentOnly, strings.TrimSpace(o.Note) != "", tilde(filepath.Dir(dest)))
	res, err := s.d.dl.BuildZip(dest, dlog.ZipOptions{CurrentOnly: o.CurrentOnly, Note: o.Note, System: s.systemSummary()})
	if err != nil {
		s.dlog("error", "", "diagnostics zip failed: %v", err)
		return nil, err
	}
	s.dlog("ui", "", "diagnostics zip written: %s (%d bytes, %d files)", filepath.Base(res.Path), res.Size, len(res.Files))
	return res, nil
}

// DownloadsDir is the user's Downloads folder, or the fallback when there is none.
func DownloadsDir(fallback string) string {
	if h, err := os.UserHomeDir(); err == nil {
		d := filepath.Join(h, "Downloads")
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			return d
		}
		if h != "" {
			return h
		}
	}
	return fallback
}

// uniquePath adds -2, -3... before the extension while the file exists.
func uniquePath(p string) string {
	if _, err := os.Stat(p); err != nil {
		return p
	}
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(p, ext)
	for i := 2; i < 1000; i++ {
		c := fmt.Sprintf("%s-%d%s", base, i, ext)
		if _, err := os.Stat(c); err != nil {
			return c
		}
	}
	return p
}

// DiagDeleteZip removes a zip this app made (only a file named like one, so the call cannot delete anything else).
func (s *Service) DiagDeleteZip(path string) error {
	b := filepath.Base(path)
	if !strings.HasPrefix(b, "squatclient-diagnostics-") || !strings.HasSuffix(b, ".zip") {
		return fmt.Errorf("not a diagnostics zip")
	}
	s.dlog("ui", "", "diagnostics zip deleted by the user: %s", b)
	return os.Remove(path)
}

// closeDiag flushes the log at exit.
func (s *Service) closeDiag() {
	if s.d.dl.Enabled() {
		s.dlog("session", "", "client shutting down")
	}
	s.d.dl.Close()
}

// recoverLog logs a recovered panic with its stack (used by goroutine entry points); it never re-panics.
func (s *Service) recoverLog(where string) {
	if r := recover(); r != nil {
		s.dlog("error", "", "PANIC in %s: %v\n%s", where, r, strings.ReplaceAll(string(debug.Stack()), "\n", " | "))
		s.d.dl.Flush()
	}
}
