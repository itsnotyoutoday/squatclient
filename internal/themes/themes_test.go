package themes

import "testing"

func TestFolderAndFile(t *testing.T) {
	m := New(t.TempDir() + "/themes")
	if l, err := m.List(); err != nil || len(l) != 0 {
		t.Fatalf("empty: %v %v", l, err)
	}
	if err := m.Save("solar", `{"a":1}`); err != nil {
		t.Fatal(err)
	}
	if err := m.Save("../x", "{}"); err == nil {
		t.Fatal("bad id accepted")
	}
	l, _ := m.List()
	if len(l) != 1 || l[0].ID != "solar" || l[0].JSON != `{"a":1}` {
		t.Fatalf("%+v", l)
	}
	if err := m.Delete("solar"); err != nil {
		t.Fatal(err)
	}
	if l, _ := m.List(); len(l) != 0 {
		t.Fatal("not deleted")
	}
}
