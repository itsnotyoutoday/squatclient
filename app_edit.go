package main

import "github.com/itsnotyoutoday/squatclient/internal/app"

// In-game editor methods (docs/EDIT.md). Thin delegation like the rest of
// app.go; failures are reported inside the result (ok=false, error, code).

// EditFetchObject reads an object's header and attribute names.
func (a *App) EditFetchObject(sessionID, dbref string) app.EditObjectResult {
	svc, err := a.service()
	if err != nil {
		return app.EditObjectResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Attrs: []app.EditAttrName{}}
	}
	return svc.EditFetchObject(sessionID, dbref)
}

// EditFetchAttr reads one attribute (raw value plus the editor form).
func (a *App) EditFetchAttr(sessionID, dbref, attr string) app.EditAttrResult {
	svc, err := a.service()
	if err != nil {
		return app.EditAttrResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Dbref: dbref, Name: attr}
	}
	return svc.EditFetchAttr(sessionID, dbref, attr)
}

// EditSaveAttr saves editor text (newlines become %r) and verifies it.
func (a *App) EditSaveAttr(sessionID, dbref, attr, value string) app.EditResult {
	svc, err := a.service()
	if err != nil {
		return app.EditResult{Error: err.Error(), Code: "error"}
	}
	return svc.EditSaveAttr(sessionID, dbref, attr, value)
}
