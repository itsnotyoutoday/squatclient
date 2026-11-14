package app

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/proto"
	"github.com/itsnotyoutoday/squatClientDaemon/pkg/wire"

	"github.com/itsnotyoutoday/squatclient/internal/config"
)

// A world whose "Connect via" is a TinyFugue squatter is the same thing as a world record in
// TinyFugue: SquatClient and TinyFugue keep the two in agreement.
//
//   - saving it here puts the record into TinyFugue (and runs /saveworld there), renaming it
//     renames the record, deleting it deletes the record;
//   - renaming the world in TinyFugue (or from the tab) renames the world here;
//   - connecting makes sure the record exists and connects BY RECORD, so the tab, the world
//     and TinyFugue all carry the same name.
//
// Credentials are never copied to TinyFugue: SquatClient logs in with its own keychain
// password, unless the TinyFugue record already has its own login (then TinyFugue does it).

func (s *Service) tfSquatterID(via string) (string, bool) {
	if via == "" || via == "direct" {
		return "", false
	}
	if q, ok := s.squatterRecord(via); ok && q.IsTF() {
		return q.ID, true
	}
	return "", false
}

func (s *Service) warn(text string) { s.emit("notice", Notice{Level: "warn", Text: text}) }

func isNoSuchWorld(err error) bool {
	var pe *wire.ProtoError
	return errors.As(err, &pe) && (pe.Code == "no_such_world" || strings.Contains(strings.ToLower(pe.Message), "no such world"))
}

// mirrorWorld makes TinyFugue's record agree with w. oldName is the name the world had before
// (to rename the record instead of creating a second one). It returns TinyFugue's record.
func (s *Service) mirrorWorld(sq string, w config.World, oldName string) (proto.TFWorld, error) {
	if oldName != "" && oldName != w.Name {
		if err := s.eng.RenameTFWorld(sq, oldName, w.Name, true); err != nil && !isNoSuchWorld(err) {
			return proto.TFWorld{}, fmt.Errorf("renaming %s to %s in TinyFugue: %w", oldName, w.Name, err)
		}
	}
	recs, err := s.eng.TFWorlds(sq)
	if err != nil {
		return proto.TFWorld{}, err
	}
	rec := proto.TFWorld{Name: w.Name}
	for _, r := range recs {
		if r.Name == w.Name {
			rec = r // keep what TinyFugue has: type, character, charset, echo, macro file
		}
	}
	rec.Host, rec.Port, rec.TLS = w.Host, strconv.Itoa(w.Port), w.TLS
	if w.Encoding == "latin1" {
		rec.Charset = "ISO-8859-1"
	}
	if _, err := s.eng.PutTFWorld(sq, wire.WorldPutReq{World: rec, Save: true}); err != nil {
		return proto.TFWorld{}, err
	}
	return rec, nil
}

// afterSaveWorld mirrors a saved world into TinyFugue (in the background: it must not make
// Save wait for the network).
func (s *Service) afterSaveWorld(old *config.World, w config.World) {
	sq, ok := s.tfSquatterID(w.Via)
	if !ok {
		return
	}
	oldName := ""
	if old != nil && old.Via == w.Via {
		oldName = old.Name
	}
	go func() {
		if _, err := s.mirrorWorld(sq, w, oldName); err != nil {
			s.warn(fmt.Sprintf("Saved %q here, but TinyFugue was not updated: %v", w.Name, err))
		}
	}()
}

// afterDeleteWorld deletes the TinyFugue record of a world that was routed through it.
func (s *Service) afterDeleteWorld(w config.World) {
	sq, ok := s.tfSquatterID(w.Via)
	if !ok {
		return
	}
	go func() {
		recs, err := s.eng.TFWorlds(sq)
		if err != nil {
			s.warn(fmt.Sprintf("Deleted %q here, but TinyFugue could not be reached: %v", w.Name, err))
			return
		}
		for _, r := range recs {
			if r.Name == w.Name && r.Host == w.Host && r.Port == strconv.Itoa(w.Port) { // only the record that really was this world
				if err := s.eng.DeleteTFWorld(sq, w.Name); err != nil {
					s.warn(fmt.Sprintf("Deleted %q here, but not in TinyFugue: %v", w.Name, err))
				}
				return
			}
		}
	}()
}

// dialTFWorld connects a world routed through TinyFugue: by record, after making sure it exists.
func (s *Service) dialTFWorld(sq string, w config.World, pw string) (engine.SessionInfo, error) {
	ew := toEngineWorld(w, s.cfg.Settings().DefaultEncoding)
	rec, err := s.mirrorWorld(sq, w, "")
	if err != nil {
		s.warn(fmt.Sprintf("Could not update %q in TinyFugue (%v); connecting by address instead.", w.Name, err))
		return s.eng.Dial(ew, pw)
	}
	ew.Ref = w.Name
	if rec.PassSet && rec.Char != "" {
		ew.Login = nil // TinyFugue's own record logs in; two logins would send the password twice
		pw = ""
	}
	return s.eng.Dial(ew, pw)
}

// reconcileRename renames this app's world when TinyFugue's record of it was renamed.
func (s *Service) reconcileRename(squatterID, oldName, newName string) {
	if oldName == "" || newName == "" || oldName == newName {
		return
	}
	for _, w := range s.cfg.Worlds() {
		if w.Via != squatterID || w.Name != oldName {
			continue
		}
		for _, o := range s.cfg.Worlds() {
			if o.Name == newName && o.ID != w.ID {
				s.warn(fmt.Sprintf("TinyFugue renamed %q to %q, but you already have a world called %q here.", oldName, newName, newName))
				return
			}
		}
		w.Name = newName
		if _, err := s.cfg.SaveWorld(w); err != nil {
			s.warn(fmt.Sprintf("TinyFugue renamed %q to %q; could not rename it here: %v", oldName, newName, err))
			return
		}
		s.syncWorlds()
		s.emit("worlds", map[string]string{"reason": "renamed in TinyFugue"})
		return
	}
}

// RenameTFSession renames the world behind a TinyFugue connection (the tab's name) in
// TinyFugue; the tab, and a world of this app that is routed through it, follow.
func (s *Service) RenameTFSession(sessionID, newName string) error {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return errors.New("a name is required")
	}
	si, err := s.eng.Session(sessionID)
	if err != nil {
		return err
	}
	if si.TF == nil {
		return engine.ErrNotTF
	}
	sq, ok := s.tfSquatterID(si.Via)
	if !ok {
		return engine.ErrNotTF
	}
	temp := strings.HasPrefix(si.TF.World, "(") // opened by address: TinyFugue's world is "(unnamedN)"
	if err := s.eng.RenameTFWorld(sq, si.TF.World, newName, true); err != nil {
		return err
	}
	if temp {
		s.adoptConnection(sessionID, sq, newName, si)
	}
	return nil
}

// adoptConnection makes a world of this app for a connection that was opened by address and
// has just become a named world in TinyFugue, and links the tab to it.
func (s *Service) adoptConnection(sessionID, sq, name string, si engine.SessionInfo) {
	for _, w := range s.cfg.Worlds() {
		if w.Via == sq && w.Name == name {
			return
		}
	}
	w, err := s.cfg.SaveWorld(config.World{Name: name, Host: si.Host, Port: si.Port, TLS: si.TLS, Via: sq,
		TLSVerify: "strict", Encoding: s.cfg.Settings().DefaultEncoding})
	if err != nil {
		s.warn(fmt.Sprintf("%q is a world in TinyFugue now; could not add it to your worlds: %v", name, err))
		return
	}
	s.syncWorlds()
	_ = s.eng.SetSessionWorld(sessionID, w.ID)
	s.emit("worlds", map[string]string{"reason": "saved as a world"})
}
