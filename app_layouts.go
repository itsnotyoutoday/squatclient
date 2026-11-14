package main

import (
	"github.com/itsnotyoutoday/squatclient/internal/layouts"
	"github.com/itsnotyoutoday/squatclient/internal/themes"
)

// Layouts (see internal/app/layouts.go).

func (a *App) ListLayouts() ([]layouts.Info, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListLayouts()
}

func (a *App) LoadLayout(id string) (layouts.Bundle, error) {
	s, err := a.service()
	if err != nil {
		return layouts.Bundle{}, err
	}
	return s.LoadLayout(id)
}

func (a *App) AllowLayout(id, hash string, allow bool) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.AllowLayout(id, hash, allow)
}

func (a *App) ReadLayout(id string) (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.ReadLayout(id)
}

func (a *App) SaveLayout(id, source string) (layouts.Info, error) {
	s, err := a.service()
	if err != nil {
		return layouts.Info{}, err
	}
	return s.SaveLayout(id, source)
}

func (a *App) DeleteLayout(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DeleteLayout(id)
}

func (a *App) LayoutStarters() ([]layouts.Starter, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.LayoutStarters(), nil
}

func (a *App) LayoutsDir() (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.LayoutsDir(), nil
}

// Themes (see internal/app/layouts.go).

func (a *App) ListThemes() ([]themes.File, error) {
	s, err := a.service()
	if err != nil {
		return nil, err
	}
	return s.ListThemes()
}

func (a *App) ThemesDir() (string, error) {
	s, err := a.service()
	if err != nil {
		return "", err
	}
	return s.ThemesDir(), nil
}

func (a *App) SaveTheme(id, json string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.SaveTheme(id, json)
}

func (a *App) DeleteTheme(id string) error {
	s, err := a.service()
	if err != nil {
		return err
	}
	return s.DeleteTheme(id)
}
