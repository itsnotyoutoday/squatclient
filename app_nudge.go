package main

// NudgeSquatters retries lost squatter connections now (see Service.NudgeSquatters).
func (a *App) NudgeSquatters() (int, error) {
	s, err := a.service()
	if err != nil {
		return 0, err
	}
	return s.NudgeSquatters(), nil
}
