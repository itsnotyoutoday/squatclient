package main

import "github.com/itsnotyoutoday/squatclient/internal/app"

// Editor workspace methods (docs/EDIT-WORKSPACE.md). Thin delegation; failures
// are reported inside the result (ok=false, error, code).

// EditResolve turns a dbref, `me`, `here` or an object name into {dbref, name}.
func (a *App) EditResolve(sessionID, target string) app.EditResolveResult {
	svc, err := a.service()
	if err != nil {
		return app.EditResolveResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditResolve(sessionID, target)
}

// EditControls asks whether the user controls an object ("true"/"false"/"unknown").
func (a *App) EditControls(sessionID, dbref string) app.EditControlsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditControlsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Controls: "unknown"}
	}
	return svc.EditControls(sessionID, dbref)
}

// EditAttrInfo reads attribute flags/owner (best effort).
func (a *App) EditAttrInfo(sessionID, dbref, attr string) app.EditAttrInfoResult {
	svc, err := a.service()
	if err != nil {
		return app.EditAttrInfoResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Writable: "unknown"}
	}
	return svc.EditAttrInfo(sessionID, dbref, attr)
}
