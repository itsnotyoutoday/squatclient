//go:build !darwin

package main

// fixEditMenu is only needed on macOS, where the native Edit menu claims Cmd+Z.
func fixEditMenu(func(action string)) {}
