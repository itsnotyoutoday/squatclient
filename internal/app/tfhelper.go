package app

import (
	_ "embed"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/wire"
)

// SquatClient asks the game its own questions (the Object Editor, game type detection) through
// TinyFugue, and TinyFugue shows the answers on its own screen too. The data must keep coming to this
// app; only TinyFugue's screen should be spared. So when this app connects to a TinyFugue squatter
// as an admin device that is allowed to send scripts, it sends it a small script of gag macros
// (tfscripts/squatclient-hide.tf) over the bridge. TinyFugue loads it sandboxed when its
// squat_scripts is "safe". The script is sent again on every new connection, because macros are
// gone when TinyFugue restarts. If TinyFugue does not allow scripts, nothing happens: the queries
// just also show there, as before.

//go:embed tfscripts/squatclient-hide.tf
var hideScript string

const hideScriptName = "squatclient-hide.tf"

// noteSquatterState runs for every squatter status event and sends the helper script when a
// TinyFugue squatter has just become connected.
func (s *Service) noteSquatterState(info *engine.SquatterInfo) {
	connected := info.State == engine.SqConnected
	s.helperMu.Lock()
	was := s.helperSeen[info.ID]
	if s.helperSeen == nil {
		s.helperSeen = map[string]bool{}
	}
	s.helperSeen[info.ID] = connected
	s.helperMu.Unlock()
	if !connected || was || info.Kind != "tf-squatterd" || info.Role != "admin" || !s.cfg.Settings().TFHideQueries {
		return
	}
	scripts := false
	for _, f := range info.Features {
		if f == wire.FeatureScripts {
			scripts = true
		}
	}
	if !scripts {
		return // TinyFugue has script upload off (squat_scripts): nothing to do
	}
	go s.sendHideScript(info.ID, info.Name)
}

func (s *Service) sendHideScript(id, name string) {
	r, err := s.eng.PutTFScript(id, hideScriptName, hideScript, true)
	switch {
	case err != nil:
		s.log.Debug("could not send the helper script to TinyFugue", "squatter", name, "err", err)
	case !r.Loaded:
		s.log.Warn("TinyFugue did not load the helper script", "squatter", name, "out", r.Out)
	default:
		s.log.Debug("helper script loaded in TinyFugue", "squatter", name)
	}
}
