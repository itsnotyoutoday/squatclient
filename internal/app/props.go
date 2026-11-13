package app

import (
	"context"
	"errors"
	"time"

	"github.com/itsnotyoutoday/squatClientDaemon/pkg/engine"
)

// Object details bindings for the Object Editor (docs/EDIT.md section 11):
// read an object's properties, flags, powers, locks and location, and change
// them. Every call runs through engine.Capture, so the game's replies are shown
// by the editor only (never in the output pane, never in command history).
// Results carry ok/error/code and the game's exact reply; they never fail as a
// Go error.

// propsTimeout bounds one details call: a mutation is up to three captures.
const propsTimeout = 20 * time.Second

func (s *Service) propsCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(s.ctx, propsTimeout)
}

// EditLock is one lock of an object.
type EditLock struct {
	Type string `json:"type"`
	Expr string `json:"expr"`
}

// EditObjRef names an object.
type EditObjRef struct {
	Dbref string `json:"dbref"`
	Name  string `json:"name"`
}

// EditDetails is the details of one object. Empty strings mean none/unknown;
// pennies is null when the game did not say, attrCount is -1 when unknown.
type EditDetails struct {
	Dbref       string       `json:"dbref"`
	Name        string       `json:"name"`
	Type        string       `json:"type"`
	Owner       string       `json:"owner"`
	Parent      string       `json:"parent"`
	Zone        string       `json:"zone"`
	Location    string       `json:"location"`
	Home        string       `json:"home"`
	Destination string       `json:"destination"`
	Pennies     *int64       `json:"pennies"`
	Created     string       `json:"created"`
	Modified    string       `json:"modified"`
	Flags       []string     `json:"flags"`
	FlagLetters string       `json:"flagLetters"`
	Powers      []string     `json:"powers"`
	Locks       []EditLock   `json:"locks"`
	Contents    []EditObjRef `json:"contents"`
	Exits       []EditObjRef `json:"exits"`
	AttrCount   int          `json:"attrCount"`
}

// EditDetailsResult is the result of EditDetails and of every mutation. For a
// refused mutation Details still holds the (unchanged) re-read state when the
// game could be read, and Reply is the game's exact answer.
type EditDetailsResult struct {
	EditResult
	Reply   string      `json:"reply"`
	Details EditDetails `json:"details"`
}

// EditCatalogItem is one available flag or power.
type EditCatalogItem struct {
	Name   string `json:"name"`
	Letter string `json:"letter"`
	Desc   string `json:"desc"`
}

// EditCatalogResult is the result of EditListFlags / EditListPowers. Known is
// false when the game gave nothing usable (the UI then lets the user type a name).
type EditCatalogResult struct {
	EditResult
	Known bool              `json:"known"`
	Items []EditCatalogItem `json:"items"`
}

// EditAttrFlagResult is the result of EditSetAttrFlag.
type EditAttrFlagResult struct {
	EditResult
	Reply     string `json:"reply"`
	Known     bool   `json:"known"`
	Flags     string `json:"flags"`
	FlagNames string `json:"flagNames"`
}

// EditPlace is a found room or object.
type EditPlace struct {
	Dbref string `json:"dbref"`
	Name  string `json:"name"`
	Type  string `json:"type"`
	Owner string `json:"owner"`
}

// EditSearchResult is the result of EditSearchRooms.
type EditSearchResult struct {
	EditResult
	Items      []EditPlace `json:"items"`
	Restricted bool        `json:"restricted"`
	Truncated  bool        `json:"truncated"`
}

// EditNearbyExit is an exit of a browsed room.
type EditNearbyExit struct {
	Dbref     string `json:"dbref"`
	Name      string `json:"name"`
	DestDbref string `json:"destDbref"`
	DestName  string `json:"destName"`
}

// EditNearbyResult is the result of EditNearby: a read-only look at a room.
type EditNearbyResult struct {
	EditResult
	Room     EditPlace        `json:"room"`
	Desc     string           `json:"desc"`
	Exits    []EditNearbyExit `json:"exits"`
	Contents []EditPlace      `json:"contents"`
}

func toDetails(d engine.Details) EditDetails {
	out := EditDetails{Dbref: d.Dbref, Name: d.Name, Type: d.Type, Owner: d.Owner, Parent: d.Parent, Zone: d.Zone,
		Location: d.Location, Home: d.Home, Destination: d.Destination, Pennies: d.Pennies, Created: d.Created,
		Modified: d.Modified, Flags: nonNil(d.Flags), FlagLetters: d.FlagLetters, Powers: nonNil(d.Powers),
		Locks: []EditLock{}, Contents: []EditObjRef{}, Exits: []EditObjRef{}, AttrCount: d.AttrCount}
	for _, l := range d.Locks {
		out.Locks = append(out.Locks, EditLock{Type: l.Type, Expr: l.Expr})
	}
	for _, c := range d.Contents {
		out.Contents = append(out.Contents, EditObjRef{Dbref: c.Dbref, Name: c.Name})
	}
	for _, c := range d.Exits {
		out.Exits = append(out.Exits, EditObjRef{Dbref: c.Dbref, Name: c.Name})
	}
	return out
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func toPlace(p engine.Place) EditPlace {
	return EditPlace{Dbref: p.Dbref, Name: p.Name, Type: p.Type, Owner: p.Owner}
}

// replyOf extracts the game's reply from a mutation error.
func replyOf(err error) string {
	var me *engine.MutationError
	if errors.As(err, &me) {
		return me.Reply
	}
	return ""
}

func detailsFail(err error, m engine.Mutation) EditDetailsResult {
	r := EditDetailsResult{EditResult: fail(err), Reply: m.Reply, Details: toDetails(m.Details)}
	if r.Reply == "" {
		r.Reply = replyOf(err)
	}
	return r
}

func (s *Service) mutation(m engine.Mutation, err error) EditDetailsResult {
	if err != nil {
		return detailsFail(err, m)
	}
	return EditDetailsResult{EditResult: EditResult{Ok: true}, Reply: m.Reply, Details: toDetails(m.Details)}
}

// EditDetails reads an object's details with one capture.
func (s *Service) EditDetails(sessionID, dbref string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	d, err := s.eng.FetchDetails(ctx, sessionID, dbref)
	if err != nil {
		return EditDetailsResult{EditResult: fail(err), Details: toDetails(engine.Details{Dbref: dbref, AttrCount: -1})}
	}
	return EditDetailsResult{EditResult: EditResult{Ok: true}, Details: toDetails(d)}
}

func (s *Service) catalog(sessionID string, f func(context.Context, string, ...engine.CaptureOpts) (engine.Catalog, error)) EditCatalogResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	c, err := f(ctx, sessionID)
	if err != nil {
		return EditCatalogResult{EditResult: fail(err), Items: []EditCatalogItem{}}
	}
	r := EditCatalogResult{EditResult: EditResult{Ok: true}, Known: c.Known, Items: make([]EditCatalogItem, 0, len(c.Items))}
	for _, it := range c.Items {
		r.Items = append(r.Items, EditCatalogItem{Name: it.Name, Letter: it.Letter, Desc: it.Desc})
	}
	return r
}

// EditListFlags lists the flags the game offers (cached per session).
func (s *Service) EditListFlags(sessionID string) EditCatalogResult {
	return s.catalog(sessionID, s.eng.ListFlags)
}

// EditListPowers lists the powers the game offers (cached per session).
func (s *Service) EditListPowers(sessionID string) EditCatalogResult {
	return s.catalog(sessionID, s.eng.ListPowers)
}

// EditSetFlag turns a flag on or off and returns the verified state.
func (s *Service) EditSetFlag(sessionID, dbref, flag string, on bool) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetFlag(ctx, sessionID, dbref, flag, on))
}

// EditSetPower grants or removes a power.
func (s *Service) EditSetPower(sessionID, dbref, power string, on bool) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetPower(ctx, sessionID, dbref, power, on))
}

// EditSetAttrFlag turns a flag of one attribute on or off.
func (s *Service) EditSetAttrFlag(sessionID, dbref, attr, flag string, on bool) EditAttrFlagResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	r, err := s.eng.SetAttrFlag(ctx, sessionID, dbref, attr, flag, on)
	out := EditAttrFlagResult{Reply: r.Reply, Known: r.Detail.Known, Flags: r.Detail.Flags, FlagNames: r.Detail.FlagNames}
	if err != nil {
		out.EditResult = fail(err)
		if out.Reply == "" {
			out.Reply = replyOf(err)
		}
		return out
	}
	out.Ok = true
	return out
}

// EditRename renames an object.
func (s *Service) EditRename(sessionID, dbref, name string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.Rename(ctx, sessionID, dbref, name))
}

// EditChown changes the owner (a dbref or a player name).
func (s *Service) EditChown(sessionID, dbref, owner string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.Chown(ctx, sessionID, dbref, owner))
}

// EditSetParent sets the parent ("" or "none" clears it).
func (s *Service) EditSetParent(sessionID, dbref, parent string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetParent(ctx, sessionID, dbref, parent))
}

// EditSetZone sets the zone ("" or "none" clears it).
func (s *Service) EditSetZone(sessionID, dbref, zone string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetZone(ctx, sessionID, dbref, zone))
}

// EditSetLock sets a lock ("" or "none" removes it).
func (s *Service) EditSetLock(sessionID, dbref, lockType, expr string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetLock(ctx, sessionID, dbref, lockType, expr))
}

// EditSetHome sets the home of a thing or player.
func (s *Service) EditSetHome(sessionID, dbref, room string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetHome(ctx, sessionID, dbref, room))
}

// EditSetDestination points an exit at a room.
func (s *Service) EditSetDestination(sessionID, dbref, room string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.SetDestination(ctx, sessionID, dbref, room))
}

// EditMove teleports an object (an exit changes its source room).
func (s *Service) EditMove(sessionID, dbref, dest string) EditDetailsResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	return s.mutation(s.eng.Move(ctx, sessionID, dbref, dest))
}

// EditSearchRooms searches for places to move an object to.
func (s *Service) EditSearchRooms(sessionID, query string) EditSearchResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	r, err := s.eng.SearchRooms(ctx, sessionID, query)
	if err != nil {
		return EditSearchResult{EditResult: fail(err), Items: []EditPlace{}}
	}
	out := EditSearchResult{EditResult: EditResult{Ok: true}, Items: make([]EditPlace, 0, len(r.Items)),
		Restricted: r.Restricted, Truncated: r.Truncated}
	for _, p := range r.Items {
		out.Items = append(out.Items, toPlace(p))
	}
	return out
}

// EditNearby describes the room of an object (or the room itself) for browsing.
func (s *Service) EditNearby(sessionID, dbref string) EditNearbyResult {
	ctx, cancel := s.propsCtx()
	defer cancel()
	n, err := s.eng.Nearby(ctx, sessionID, dbref)
	if err != nil {
		return EditNearbyResult{EditResult: fail(err), Exits: []EditNearbyExit{}, Contents: []EditPlace{}}
	}
	out := EditNearbyResult{EditResult: EditResult{Ok: true}, Room: toPlace(n.Room), Desc: n.Desc,
		Exits: make([]EditNearbyExit, 0, len(n.Exits)), Contents: make([]EditPlace, 0, len(n.Contents))}
	for _, x := range n.Exits {
		out.Exits = append(out.Exits, EditNearbyExit{Dbref: x.Dbref, Name: x.Name, DestDbref: x.DestDbref, DestName: x.DestName})
	}
	for _, p := range n.Contents {
		out.Contents = append(out.Contents, toPlace(p))
	}
	return out
}
