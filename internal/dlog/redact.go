package dlog

import (
	"regexp"
	"strings"
	"sync/atomic"
)

// Redaction runs on every line before it is written (so the file on disk is already clean) and again when a zip is built (so a log written by an
// older build, or edited by hand, cannot leak either). It errs on the side of removing too much: a log that lost a harmless word is still useful, a log
// that kept a password is not.

const mark = "[redacted]"

type rule struct {
	re   *regexp.Regexp
	repl string
}

var rules = []rule{
	// a login or create command: connect <name> <password>, create <name> <password> (quoted names allowed)
	{regexp.MustCompile(`(?i)\b(connect|create)(\s+)("[^"]*"|'[^']*'|\S+)(\s+)("[^"]*"|'[^']*'|\S+)`), `${1}${2}${3}${4}` + mark},
	// /pair <code>, /squatter pair <code>
	{regexp.MustCompile(`(?i)(/(?:squatter\s+)?pair\w*\s+)\S+`), `${1}` + mark},
	{regexp.MustCompile(`(?i)(pair(?:ing)?[ _-]?code\s*[:=]\s*)("[^"]*"|\S+)`), `${1}` + mark},
	// a TinyFugue world definition carries a character and password: keep the command, drop the arguments
	{regexp.MustCompile(`(?i)(/(?:add)?world\b)[^\r\n|]*`), `${1} ` + mark},
	// the login block of a world in worlds.json
	{regexp.MustCompile(`(?i)("(?:login|autologin)"\s*:\s*)(\{[^}]*\}|"[^"]*")`), `${1}"` + mark + `"`},
	// headers and fields that hold secrets (JSON or key=value or key: value)
	{regexp.MustCompile(`(?i)(authorization["']?\s*[:=]\s*)("(?:bearer|basic)?[^"]*"|(?:bearer\s+|basic\s+)?\S+)`), `${1}` + mark},
	{regexp.MustCompile(`(?i)("?(?:password|passwd|passphrase|pass|pw|secret|token|api[_-]?key|private[_-]?key|privkey|session[_-]?key|cookie|bearer)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)`), `${1}` + mark},
	// free text: "my password is hunter2"
	{regexp.MustCompile(`(?i)(\b(?:password|passwd|passphrase)\s+(?:is|was)\s+)\S+`), `${1}` + mark},
	// user:password@ in a URL
	{regexp.MustCompile(`(?i)(://)[^/\s:@]+:[^/\s@]+@`), `${1}` + mark + `@`},
}

// longToken finds key-like strings; pure hex (a content hash, which is useful and not secret) is left alone.
var longToken = regexp.MustCompile(`[A-Za-z0-9+/_\-]{40,}={0,2}`)

var hexOnly = regexp.MustCompile(`^[0-9a-fA-F]+$`)

var redactCount atomic.Int64

// Redacted is how many secrets this process has removed so far.
func Redacted() int64 { return redactCount.Load() }

// Redact removes passwords, pairing codes, keys and tokens from one line; it returns the clean line and how many things it removed.
func Redact(s string) (string, int) {
	n := 0
	low := strings.ToLower(s)
	if !hasTrigger(low) { // most lines hold nothing a rule looks for: skip the regular expressions (they cost ~40 us a line)
		return redactTokens(s)
	}
	for _, r := range rules {
		if !r.re.MatchString(s) {
			continue
		}
		s = r.re.ReplaceAllStringFunc(s, func(m string) string {
			out := r.re.ReplaceAllString(m, r.repl)
			if out != m {
				n++
			}
			return out
		})
	}
	s, k := redactTokens(s)
	return s, n + k
}

var triggers = []string{"connect", "create", "pair", "world", "login", "authorization", "pass", "pw", "secret", "token", "key", "cookie", "bearer", "://"}

func hasTrigger(low string) bool {
	for _, t := range triggers {
		if strings.Contains(low, t) {
			return true
		}
	}
	return false
}

// hasLongRun is true when the line has 40 or more key-like characters in a row (the only thing longToken can match).
func hasLongRun(s string) bool {
	run := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '_' || c == '-' {
			if run++; run >= 40 {
				return true
			}
		} else {
			run = 0
		}
	}
	return false
}

func redactTokens(s string) (string, int) {
	n := 0
	if !hasLongRun(s) {
		return s, 0
	}
	s = longToken.ReplaceAllStringFunc(s, func(m string) string {
		if hexOnly.MatchString(m) || strings.HasPrefix(m, "/") || strings.Contains(m, "//") {
			return m
		}
		n++
		return "[redacted-token]"
	})
	return s, n
}

// RedactText is Redact for a block of text (it keeps the line structure).
func RedactText(s string) (string, int) {
	total := 0
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		c, n := Redact(l)
		lines[i] = c
		total += n
	}
	return strings.Join(lines, "\n"), total
}
