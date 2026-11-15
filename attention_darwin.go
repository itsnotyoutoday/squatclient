//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
void squatRequestAttention(int on);
*/
import "C"

// requestAttention bounces the Dock icon once (on) or cancels the request (off).
func requestAttention(on bool) {
	if on {
		C.squatRequestAttention(1)
	} else {
		C.squatRequestAttention(0)
	}
}
