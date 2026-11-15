//go:build !windows && !darwin && !linux

package main

// requestAttention: no taskbar/dock hook on this platform.
func requestAttention(bool) {}
