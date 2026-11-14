package main

import "github.com/itsnotyoutoday/squatclient/internal/gfx"

// The graphics part of the UI contract (docs/GFX.md); each method delegates to internal/app.Service.

// GfxSnapshot returns every open graphics scene as scene operations (for a window that mounts after the script ran).
func (a *App) GfxSnapshot() ([]gfx.Op, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.GfxSnapshot(), nil
}

// GfxEvent reports a pointer event on a graphics object ("click", "down", "up", "enter", "leave"); the
// TinyFugue command the script attached with /gfx on runs.
func (a *App) GfxEvent(scene, id, event string, x, y float64) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.GfxEvent(scene, id, event, x, y)
}
