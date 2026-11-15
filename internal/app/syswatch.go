package app

import (
	"net"
	"sort"
	"strings"
	"time"
)

// sysWatcher notices two things the operating system does not always tell an app: the machine woke from sleep, and the
// network changed (Wi-Fi to cable, a VPN up or down, a new address). Both usually kill the link to a squatter, so the
// client retries at once instead of waiting out the backoff. It is portable on purpose: a clock that jumped forward means
// the process was suspended, and the set of up interfaces and their addresses says the network moved.
type sysWatcher struct {
	last    time.Time
	sig     string // the last network seen while online
	offline bool
}

const (
	sysTick    = 2 * time.Second
	sysSleepAt = 15 * time.Second // a tick this late means the machine was asleep (a busy one is never 7 ticks late)
)

// step is told the time and the network signature and says why the client should reconnect ("" = nothing happened).
func (w *sysWatcher) step(now time.Time, sig string) string {
	reason := ""
	gap := !w.last.IsZero() && now.Sub(w.last) > sysSleepAt
	w.last = now
	switch {
	case gap:
		reason = "resume"
	case sig == "": // no network now: nothing to retry until it is back
		w.offline = w.sig != ""
		return ""
	case w.offline || (w.sig != "" && sig != w.sig):
		reason = "network"
	}
	w.sig, w.offline = firstNonEmpty(sig, w.sig), sig == "" && w.offline
	return reason
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// netSignature lists the up, non-loopback interfaces and their addresses.
func netSignature() string {
	ifs, err := net.Interfaces()
	if err != nil {
		return ""
	}
	var parts []string
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		var as []string
		for _, a := range addrs {
			if ip, _, err := net.ParseCIDR(a.String()); err == nil && !ip.IsLinkLocalUnicast() {
				as = append(as, ip.String())
			}
		}
		if len(as) == 0 {
			continue
		}
		sort.Strings(as)
		parts = append(parts, i.Name+"="+strings.Join(as, ","))
	}
	sort.Strings(parts)
	return strings.Join(parts, ";")
}

// watchSystem retries the squatter links after a wake or a network change and tells the window (event "system").
func (s *Service) watchSystem() {
	go func() {
		w := &sysWatcher{}
		t := time.NewTicker(sysTick)
		defer t.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case now := <-t.C:
				if reason := w.step(now, netSignature()); reason != "" {
					s.log.Info("system change", "reason", reason)
					s.NudgeSquatters()
					s.emit("system", map[string]string{"reason": reason})
				}
			}
		}
	}()
}
