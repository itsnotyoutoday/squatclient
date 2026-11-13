package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// filesState is files.json: UI file-picker memory (currently only the last folder).
type filesState struct {
	Version    int    `json:"version"`
	LastFolder string `json:"lastFolder"`
}

// LastFolder returns the folder the file picker last used ("" if none or it vanished).
func (s *Store) LastFolder() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(filepath.Join(s.dir, "files.json"))
	if err != nil {
		return ""
	}
	var f filesState
	if json.Unmarshal(b, &f) != nil || f.LastFolder == "" {
		return ""
	}
	if st, err := os.Stat(f.LastFolder); err != nil || !st.IsDir() {
		return ""
	}
	return f.LastFolder
}

// SetLastFolder remembers the folder of the last file the user chose.
func (s *Store) SetLastFolder(dir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.write("files.json", filesState{Version: CurrentVersion, LastFolder: dir})
}
