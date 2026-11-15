package app

import (
	"hash/fnv"
	"math"
	"sync/atomic"

	"github.com/itsnotyoutoday/cmcp/go/audio"
)

// A recipe (spec 9.6) with every parameter mapping evaluated by the shared core and the `vary` ranges drawn from mulberry32, so
// the web view's synthesiser only has to play numbers.
type ResolvedRecipe struct {
	Duration float64         `json:"duration"` // seconds, already stretched by time_pct
	Loop     bool            `json:"loop,omitempty"`
	Gain     float64         `json:"gain"` // master gain including gain_db
	Pan      float64         `json:"pan"`
	Detune   float64         `json:"detuneCents"` // the vary draw, added to every voice
	Voices   []ResolvedVoice `json:"voices"`
}

// ResolvedSweep is a value that may glide.
type ResolvedSweep struct {
	Start float64  `json:"start"`
	End   *float64 `json:"end,omitempty"`
	Curve string   `json:"curve,omitempty"` // lin | exp
	Time  float64  `json:"time,omitempty"`  // seconds, 0 = the voice's whole length
}

// ResolvedVoice is one oscillator or noise source.
type ResolvedVoice struct {
	Type   string         `json:"type"` // osc | noise
	Wave   string         `json:"wave,omitempty"`
	Color  string         `json:"color,omitempty"`
	Freq   *ResolvedSweep `json:"freq,omitempty"`
	Filter *struct {
		Type   string        `json:"type"`
		Cutoff ResolvedSweep `json:"cutoff"`
		Q      float64       `json:"q"`
	} `json:"filter,omitempty"`
	Amp    struct{ Peak, A, D, S, R float64 } `json:"amp"`
	Detune float64                            `json:"detuneCents"`
	Delay  float64                            `json:"delay"`
	Pan    float64                            `json:"pan"`
	Gain   float64                            `json:"gain"`
	LFO    *struct {
		Target string  `json:"target"`
		Rate   float64 `json:"rate"`
		Depth  float64 `json:"depth"`
		Wave   string  `json:"wave"`
	} `json:"lfo,omitempty"`
}

var playCounter atomic.Uint32

func sweep(s audio.Sweep, p map[string]any) ResolvedSweep {
	r := ResolvedSweep{Start: s.Start.Resolve(p), Curve: s.Curve, Time: s.Time}
	if s.End != nil {
		e := s.End.Resolve(p)
		r.End = &e
	}
	return r
}

func resolveRecipe(raw []byte, params map[string]any, event string) (*ResolvedRecipe, error) {
	d, err := audio.ParseRecipe(raw)
	if err != nil {
		return nil, err
	}
	out := &ResolvedRecipe{Duration: d.Duration, Loop: d.Loop, Gain: 1}
	var vr audio.Variation
	if d.Vary != nil {
		h := fnv.New32a()
		_, _ = h.Write([]byte(event))
		seed := h.Sum32() + playCounter.Add(1)*2654435761 // a per-play counter mixed with a hash of the event id (spec 9.6)
		var n uint32
		if len(d.Vary.Seed) > 0 && d.Vary.Seed[0] != '"' {
			for _, c := range d.Vary.Seed {
				if c >= '0' && c <= '9' {
					n = n*10 + uint32(c-'0')
				}
			}
			seed = n // an integer seed (tests)
		}
		vr = audio.DrawVary(*d.Vary, seed)
		out.Duration *= 1 + vr.TimePct/100
		out.Detune = vr.PitchCents
		out.Gain = pow10(vr.GainDB / 20)
	}
	if d.Master != nil {
		if d.Master.Gain != nil {
			out.Gain *= d.Master.Gain.Resolve(params)
		}
		if d.Master.Pan != nil {
			out.Pan = d.Master.Pan.Resolve(params)
		}
	}
	for _, v := range d.Voices {
		rv := ResolvedVoice{Type: v.Type, Wave: v.Wave, Color: v.Color, Delay: v.Delay, Gain: 1}
		if v.Freq != nil {
			f := sweep(*v.Freq, params)
			rv.Freq = &f
		}
		if v.Filter != nil {
			rv.Filter = &struct {
				Type   string        `json:"type"`
				Cutoff ResolvedSweep `json:"cutoff"`
				Q      float64       `json:"q"`
			}{Type: v.Filter.Type, Cutoff: sweep(v.Filter.Cutoff, params), Q: 1}
			if v.Filter.Q != nil {
				rv.Filter.Q = v.Filter.Q.Resolve(params)
			}
		}
		rv.Amp.Peak, rv.Amp.A, rv.Amp.D, rv.Amp.R = v.Amp.Peak.Resolve(params), v.Amp.A, v.Amp.D, v.Amp.R
		rv.Amp.S = 1
		if v.Amp.S != nil {
			rv.Amp.S = v.Amp.S.Resolve(params)
		}
		if v.DetuneCents != nil {
			rv.Detune = v.DetuneCents.Resolve(params)
		}
		if v.Pan != nil {
			rv.Pan = v.Pan.Resolve(params)
		}
		if v.Gain != nil {
			rv.Gain = v.Gain.Resolve(params)
		}
		if v.LFO != nil {
			rv.LFO = &struct {
				Target string  `json:"target"`
				Rate   float64 `json:"rate"`
				Depth  float64 `json:"depth"`
				Wave   string  `json:"wave"`
			}{Target: v.LFO.Target, Rate: v.LFO.Rate.Resolve(params), Depth: v.LFO.Depth.Resolve(params), Wave: v.LFO.Wave}
		}
		out.Voices = append(out.Voices, rv)
	}
	return out, nil
}

func pow10(x float64) float64 {
	return math.Pow(10, x)
}
