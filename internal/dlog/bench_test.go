package dlog

import "testing"

func BenchmarkRedactTypicalLine(b *testing.B) {
	line := `dbg s2: <- Cobra.Console {"status":"ok","aboard":true,"context":"helm","pulse":0.4,"sound":"impulse_loop"} from nexus`
	for i := 0; i < b.N; i++ {
		Redact(line)
	}
}
