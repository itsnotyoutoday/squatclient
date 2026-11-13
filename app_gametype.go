package main

// SetGameType sets what kind of game a session is (see Service.SetGameType).
func (a *App) SetGameType(sessionID, gameType string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetGameType(sessionID, gameType)
}

// SetSessionWorld links a session to a saved world (see Service.SetSessionWorld).
func (a *App) SetSessionWorld(sessionID, worldID string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SetSessionWorld(sessionID, worldID)
}
