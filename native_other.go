//go:build !windows && !darwin && !linux

package main

func setBadge(int)                   {}
func notify(title, body, _ string)   {}
func startDesktop(func(string, any)) {}
