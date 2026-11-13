package main

import "github.com/itsnotyoutoday/squatclient/internal/app"

// Object details methods of the Object Editor (docs/EDIT.md section 11). Thin
// delegation; failures are reported inside the result (ok=false, error, code,
// reply), never as a rejected promise.

// EditDetails is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditDetails(sessionID, dbref string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditDetails(sessionID, dbref)
}

// EditListFlags is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditListFlags(sessionID string) app.EditCatalogResult {
	svc, err := a.service()
	if err != nil {
		return app.EditCatalogResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Items: []app.EditCatalogItem{}}
	}
	return svc.EditListFlags(sessionID)
}

// EditListPowers is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditListPowers(sessionID string) app.EditCatalogResult {
	svc, err := a.service()
	if err != nil {
		return app.EditCatalogResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Items: []app.EditCatalogItem{}}
	}
	return svc.EditListPowers(sessionID)
}

// EditSetFlag is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetFlag(sessionID, dbref, flag string, on bool) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetFlag(sessionID, dbref, flag, on)
}

// EditSetPower is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetPower(sessionID, dbref, power string, on bool) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetPower(sessionID, dbref, power, on)
}

// EditSetAttrFlag is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetAttrFlag(sessionID, dbref, attr, flag string, on bool) app.EditAttrFlagResult {
	svc, err := a.service()
	if err != nil {
		return app.EditAttrFlagResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetAttrFlag(sessionID, dbref, attr, flag, on)
}

// EditRename is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditRename(sessionID, dbref, name string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditRename(sessionID, dbref, name)
}

// EditChown is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditChown(sessionID, dbref, owner string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditChown(sessionID, dbref, owner)
}

// EditSetParent is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetParent(sessionID, dbref, parent string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetParent(sessionID, dbref, parent)
}

// EditSetZone is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetZone(sessionID, dbref, zone string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetZone(sessionID, dbref, zone)
}

// EditSetLock is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetLock(sessionID, dbref, lockType, expr string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetLock(sessionID, dbref, lockType, expr)
}

// EditSetHome is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetHome(sessionID, dbref, room string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetHome(sessionID, dbref, room)
}

// EditSetDestination is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSetDestination(sessionID, dbref, room string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetDestination(sessionID, dbref, room)
}

// EditMove is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditMove(sessionID, dbref, dest string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditMove(sessionID, dbref, dest)
}

// EditSearchRooms is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditSearchRooms(sessionID, query string) app.EditSearchResult {
	svc, err := a.service()
	if err != nil {
		return app.EditSearchResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Items: []app.EditPlace{}}
	}
	return svc.EditSearchRooms(sessionID, query)
}

// EditNearby is bound to the frontend; see docs/EDIT.md section 11.
func (a *App) EditNearby(sessionID, dbref string) app.EditNearbyResult {
	svc, err := a.service()
	if err != nil {
		return app.EditNearbyResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Exits: []app.EditNearbyExit{}, Contents: []app.EditPlace{}}
	}
	return svc.EditNearby(sessionID, dbref)
}

// EditSetLockFlag turns a lock flag on or off.
func (a *App) EditSetLockFlag(sessionID, dbref, lockType, flag string, on bool) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetLockFlag(sessionID, dbref, lockType, flag, on)
}

// EditTestLock evaluates a lock for a target.
func (a *App) EditTestLock(sessionID, dbref, lockType, target string) app.EditTestLockResult {
	svc, err := a.service()
	if err != nil {
		return app.EditTestLockResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Result: "unknown"}
	}
	return svc.EditTestLock(sessionID, dbref, lockType, target)
}

// EditSetAttrLock locks or unlocks an attribute.
func (a *App) EditSetAttrLock(sessionID, dbref, attr string, on bool) app.EditAttrLockResult {
	svc, err := a.service()
	if err != nil {
		return app.EditAttrLockResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Locked: "unknown"}
	}
	return svc.EditSetAttrLock(sessionID, dbref, attr, on)
}

// EditAttrChown changes an attribute's owner.
func (a *App) EditAttrChown(sessionID, dbref, attr, player string) app.EditAttrOwnerResult {
	svc, err := a.service()
	if err != nil {
		return app.EditAttrOwnerResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditAttrChown(sessionID, dbref, attr, player)
}

// EditRenameAttr renames an attribute.
func (a *App) EditRenameAttr(sessionID, dbref, from, to string) app.EditReplyResult {
	svc, err := a.service()
	if err != nil {
		return app.EditReplyResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditRenameAttr(sessionID, dbref, from, to)
}

// EditDeleteAttr clears an attribute.
func (a *App) EditDeleteAttr(sessionID, dbref, attr string) app.EditReplyResult {
	svc, err := a.service()
	if err != nil {
		return app.EditReplyResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditDeleteAttr(sessionID, dbref, attr)
}

// EditSetWarnings sets the object's warnings.
func (a *App) EditSetWarnings(sessionID, dbref, list string) app.EditDetailsResult {
	svc, err := a.service()
	if err != nil {
		return app.EditDetailsResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditSetWarnings(sessionID, dbref, list)
}

// EditWCheck runs @wcheck.
func (a *App) EditWCheck(sessionID, dbref string) app.EditLinesResult {
	svc, err := a.service()
	if err != nil {
		return app.EditLinesResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}, Lines: []string{}}
	}
	return svc.EditWCheck(sessionID, dbref)
}

// EditExamine runs examine silently ("", "all" or "brief") and returns the coloured text.
func (a *App) EditExamine(sessionID, dbref, mode string) app.EditExamineResult {
	svc, err := a.service()
	if err != nil {
		return app.EditExamineResult{EditResult: app.EditResult{Error: err.Error(), Code: "error"}}
	}
	return svc.EditExamine(sessionID, dbref, mode)
}
