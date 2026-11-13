package app

// SetGameType sets what kind of game a session is ("" or "auto" detects it again). The kind decides
// which modules apply: the Object Editor is the module for the MU* family.
func (s *Service) SetGameType(sessionID, gameType string) error {
	return s.eng.SetGameType(sessionID, gameType)
}

// SetSessionWorld links a session to a saved world (after "Save as world" on a quick connect).
func (s *Service) SetSessionWorld(sessionID, worldID string) error {
	if worldID != "" {
		if _, err := s.cfg.World(worldID); err != nil {
			return err
		}
	}
	return s.eng.SetSessionWorld(sessionID, worldID)
}
