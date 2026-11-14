package app

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/itsnotyoutoday/squatclient/internal/layouts"
	"github.com/itsnotyoutoday/squatclient/internal/themes"
)

// Layouts (docs/LAYOUTS.md): user files that arrange the window's built-in components. They are compiled
// here (esbuild) when the window asks, and only run after the user allowed that exact content.

func (s *Service) layoutMgr() *layouts.Manager {
	s.layOnce.Do(func() {
		dir := s.cfg.Dir()
		s.lay = layouts.New(filepath.Join(dir, "layouts"), filepath.Join(dir, "layout-consent.json"))
	})
	return s.lay
}

// ListLayouts lists the layout files in the user's folder.
func (s *Service) ListLayouts() ([]layouts.Info, error) { return s.layoutMgr().List() }

// LoadLayout compiles a layout for the window (or says that the user has to allow it first).
func (s *Service) LoadLayout(id string) (layouts.Bundle, error) { return s.layoutMgr().Load(id) }

// AllowLayout records that the user allows the layout with this content hash to run.
func (s *Service) AllowLayout(id, hash string, allow bool) error {
	if err := s.layoutMgr().Allow(id, hash, allow); err != nil {
		return err
	}
	s.emit("layouts-changed", struct{}{})
	return nil
}

// ReadLayout returns a layout's source (for the editor).
func (s *Service) ReadLayout(id string) (string, error) { return s.layoutMgr().Read(id) }

// SaveLayout writes a layout the user made in the app (it must compile) and allows it to run.
func (s *Service) SaveLayout(id, source string) (layouts.Info, error) {
	info, err := s.layoutMgr().Save(id, source)
	if err == nil {
		s.emit("layouts-changed", struct{}{})
	}
	return info, err
}

// DeleteLayout removes a layout file.
func (s *Service) DeleteLayout(id string) error {
	err := s.layoutMgr().Delete(id)
	if err == nil {
		s.emit("layouts-changed", struct{}{})
	}
	return err
}

// LayoutStarters returns the layouts that ship with the app, as source to copy and edit.
func (s *Service) LayoutStarters() []layouts.Starter { return layouts.Starters() }

// LayoutsDir is the folder the user's layouts live in.
func (s *Service) LayoutsDir() string { return s.layoutMgr().Dir() }

// watchLayouts tells the window when files in the layouts folder change (so an edit shows at once).
func (s *Service) watchLayouts() {
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		last := ""
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-t.C:
				l, err := s.layoutMgr().List()
				if err != nil {
					continue
				}
				sig := ""
				for _, x := range l {
					sig += x.ID + x.Hash + "|"
				}
				if last != "" && sig != last {
					s.emit("layouts-changed", struct{}{})
				}
				last = sig
			}
		}
	}()
}

// Themes: a folder of "<id>.json" files (or "<id>/theme.json"). The window validates them.

func (s *Service) themeMgr() *themes.Manager {
	return themes.New(filepath.Join(s.cfg.Dir(), "themes"))
}

// ListThemes lists the theme files in the user's folder.
func (s *Service) ListThemes() ([]themes.File, error) { return s.themeMgr().List() }

// ThemesDir is the folder the user's themes live in.
func (s *Service) ThemesDir() string { return s.themeMgr().Dir() }

// SaveTheme writes a theme (an import from the settings dialog) into the folder.
func (s *Service) SaveTheme(id, json string) error {
	err := s.themeMgr().Save(id, json)
	if err == nil {
		s.emit("themes-changed", struct{}{})
	}
	return err
}

// DeleteTheme removes a theme from the folder.
func (s *Service) DeleteTheme(id string) error {
	err := s.themeMgr().Delete(id)
	if err == nil {
		s.emit("themes-changed", struct{}{})
	}
	return err
}

// watchThemes tells the window when the themes folder changes (so an edited theme shows at once).
func (s *Service) watchThemes() {
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		last := ""
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-t.C:
				l, err := s.themeMgr().List()
				if err != nil {
					continue
				}
				sig := ""
				for _, x := range l {
					sig += fmt.Sprintf("%s:%s:%d|", x.ID, x.File, x.Modified)
				}
				if last != "" && sig != last {
					s.emit("themes-changed", struct{}{})
				}
				last = sig
			}
		}
	}()
}
