package app

import (
	"errors"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
)

// Editor workspace bindings (docs/EDIT-WORKSPACE.md, docs/EDIT.md section 10):
// resolve a typed target, ask whether the user controls an object, read
// best-effort attribute flags. Same conventions as edit.go: silent captures,
// results carry ok/error/code and never fail as a Go error.

// editCode2 is editCode plus the workspace-only codes.
func editCode2(err error) string {
	if errors.Is(err, engine.ErrAmbiguous) {
		return "ambiguous"
	}
	return editCode(err)
}

func fail2(err error) EditResult {
	return EditResult{Error: err.Error(), Code: editCode2(err)}
}

// EditResolveResult is the result of EditResolve.
type EditResolveResult struct {
	EditResult
	Dbref string `json:"dbref"`
	Name  string `json:"name"`
}

// EditControlsResult is the result of EditControls. Controls is "true",
// "false" or "unknown" (the game could not say).
type EditControlsResult struct {
	EditResult
	Controls string `json:"controls"`
}

// EditAttrInfoResult is the result of EditAttrInfo. Known=false means the game
// could not tell; Writable is "false" only when the flags prove protection.
type EditAttrInfoResult struct {
	EditResult
	Known     bool   `json:"known"`
	Flags     string `json:"flags"`
	FlagNames string `json:"flagNames"`
	Owner     string `json:"owner"`
	Writable  string `json:"writable"`
}

// EditResolve turns a dbref, `me`, `here` or an object name into {dbref, name}.
func (s *Service) EditResolve(sessionID, target string) EditResolveResult {
	ctx, cancel := s.editCtx()
	defer cancel()
	r, err := s.eng.ResolveObject(ctx, sessionID, target)
	if err != nil {
		return EditResolveResult{EditResult: fail2(err)}
	}
	return EditResolveResult{EditResult: EditResult{Ok: true}, Dbref: r.Dbref, Name: r.Name}
}

// EditControls asks whether the connected character controls the object.
func (s *Service) EditControls(sessionID, dbref string) EditControlsResult {
	ctx, cancel := s.editCtx()
	defer cancel()
	t, err := s.eng.Controls(ctx, sessionID, dbref)
	if err != nil {
		return EditControlsResult{EditResult: fail2(err), Controls: string(engine.TriUnknown)}
	}
	return EditControlsResult{EditResult: EditResult{Ok: true}, Controls: string(t)}
}

// EditAttrInfo reads attribute flags/owner when the game can tell.
func (s *Service) EditAttrInfo(sessionID, dbref, attr string) EditAttrInfoResult {
	ctx, cancel := s.editCtx()
	defer cancel()
	d, err := s.eng.AttrInfo(ctx, sessionID, dbref, attr)
	if err != nil {
		return EditAttrInfoResult{EditResult: fail2(err), Writable: string(engine.TriUnknown)}
	}
	return EditAttrInfoResult{EditResult: EditResult{Ok: true}, Known: d.Known, Flags: d.Flags,
		FlagNames: d.FlagNames, Owner: d.Owner, Writable: string(d.Writable)}
}
