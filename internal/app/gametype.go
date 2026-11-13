package app

// SetGameType sets what kind of game a session is ("" or "auto" detects it again). The kind decides
// which modules apply: the Object Editor is the module for the MU* family.
func (s *Service) SetGameType(sessionID, gameType string) error {
	return s.eng.SetGameType(sessionID, gameType)
}
