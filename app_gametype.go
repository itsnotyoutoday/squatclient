package main

// SetGameType sets what kind of game a session is (see Service.SetGameType).
func (a *App) SetGameType(sessionID, gameType string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetGameType(sessionID, gameType)
}
