package app

// NudgeSquatters retries lost squatter connections right away instead of waiting for the next
// backoff step. The window calls it when it becomes visible again or the network comes back.
// It returns how many squatters it is retrying.
func (s *Service) NudgeSquatters() int { return s.eng.NudgeSquatters() }

// EmitUI sends an event to the window (platform code outside this package, such as the Linux desktop watcher, uses it).
func (s *Service) EmitUI(name string, payload any) { s.emit(name, payload) }
