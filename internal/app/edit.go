package app

import (
	"context"
	"errors"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
)

// In-game object/attribute editor bindings (docs/EDIT.md). The calls run
// engine.FetchObject / FetchAttr / SaveAttr, which talk to the game through
// engine.Capture: silent, never typed input, so nothing reaches the command
// history or the output pane. Errors are returned as messages in the result
// (Ok=false, Error, Code), never as a Go error, so the UI always gets a value.

// editTimeout bounds one editor call (capture time plus read-back).
const editTimeout = 12 * time.Second

// EditResult is the common tail of every Edit* result.
type EditResult struct {
	Ok    bool   `json:"ok"`
	Error string `json:"error,omitempty"` // human readable
	Code  string `json:"code,omitempty"`  // machine readable, see editCode
}

// EditAttrName is one attribute name of an object.
type EditAttrName struct {
	Name string `json:"name"`
}

// EditObjectResult is the result of EditFetchObject.
type EditObjectResult struct {
	EditResult
	Dbref    string         `json:"dbref"`
	Name     string         `json:"name"`
	Type     string         `json:"type"`
	Owner    string         `json:"owner"`
	Flags    string         `json:"flags"`
	Location string         `json:"location"`
	Attrs    []EditAttrName `json:"attrs"`
}

// EditAttrResult is the result of EditFetchAttr. Value is the raw stored text
// (literal %r); Editable shows %r as newlines and %t as tabs for the editor.
type EditAttrResult struct {
	EditResult
	Dbref    string `json:"dbref"`
	Name     string `json:"name"`
	Exists   bool   `json:"exists"`
	Value    string `json:"value"`
	Editable string `json:"editable"`
}

// editCode maps an engine error to a stable machine-readable code.
func editCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, engine.ErrNoSession):
		return "no_session"
	case errors.Is(err, engine.ErrNoSuchObject):
		return "no_such_object"
	case errors.Is(err, engine.ErrPermission):
		return "permission"
	case errors.Is(err, engine.ErrInvalidInput), errors.Is(err, engine.ErrCaptureInput):
		return "invalid"
	case errors.Is(err, engine.ErrCaptureTimeout), errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, engine.ErrCaptureSessionEnded):
		return "session_ended"
	case errors.Is(err, engine.ErrSaveRejected), errors.Is(err, engine.ErrRejected):
		return "rejected"
	case errors.Is(err, engine.ErrSaveMismatch), errors.Is(err, engine.ErrMismatch):
		return "mismatch"
	case errors.Is(err, engine.ErrNewline), errors.Is(err, engine.ErrUnsafeValue), errors.Is(err, engine.ErrAmbiguousEscape):
		return "unsafe_value"
	case errors.Is(err, engine.ErrBadReply):
		return "bad_reply"
	}
	return "error"
}

func fail(err error) EditResult {
	return EditResult{Error: err.Error(), Code: editCode(err)}
}

func (s *Service) editCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(s.ctx, editTimeout)
}

// EditFetchObject reads an object's header and attribute names.
func (s *Service) EditFetchObject(sessionID, dbref string) EditObjectResult {
	ctx, cancel := s.editCtx()
	defer cancel()
	o, err := s.eng.FetchObject(ctx, sessionID, dbref)
	if err != nil {
		return EditObjectResult{EditResult: fail(err), Attrs: []EditAttrName{}}
	}
	r := EditObjectResult{EditResult: EditResult{Ok: true}, Dbref: o.Dbref, Name: o.Name, Type: o.Type,
		Owner: o.Owner, Flags: o.Flags, Location: o.Location, Attrs: make([]EditAttrName, 0, len(o.Attrs))}
	for _, a := range o.Attrs {
		r.Attrs = append(r.Attrs, EditAttrName{Name: a.Name})
	}
	return r
}

// EditFetchAttr reads one attribute (a missing attribute is Ok with Exists=false).
func (s *Service) EditFetchAttr(sessionID, dbref, attr string) EditAttrResult {
	ctx, cancel := s.editCtx()
	defer cancel()
	a, err := s.eng.FetchAttr(ctx, sessionID, dbref, attr)
	if err != nil {
		return EditAttrResult{EditResult: fail(err), Dbref: dbref, Name: attr}
	}
	return EditAttrResult{EditResult: EditResult{Ok: true}, Dbref: a.Dbref, Name: a.Name, Exists: a.Exists,
		Value: a.Value, Editable: engine.ExpandEscapes(a.Value)}
}

// EditSaveAttr saves editor text: real newlines/tabs become %r/%t first
// (engine.CompressEscapes), then the engine sends `&ATTR dbref=value` and
// reads it back to confirm. An empty value clears the attribute.
func (s *Service) EditSaveAttr(sessionID, dbref, attr, value string) EditResult {
	packed, err := engine.CompressEscapes(value)
	if err != nil {
		return fail(err)
	}
	ctx, cancel := s.editCtx()
	defer cancel()
	if err := s.eng.SaveAttr(ctx, sessionID, dbref, attr, packed); err != nil {
		return fail(err)
	}
	return EditResult{Ok: true}
}
