package metrics

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"lumantic/internal/catalog"
)

// Editing key figures from the app. The definitions stay a JSON file the
// analysts own; the app only adds, changes and removes entries in it.

// Clone returns a deep copy.
func (c *Config) Clone() *Config {
	raw, _ := json.Marshal(c)
	var out Config
	json.Unmarshal(raw, &out)
	return &out
}

// Save writes the definitions atomically, pretty-printed.
func (c *Config) Save(path string) error {
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	_, werr := tmp.Write(append(raw, '\n'))
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(name)
		return errors.Join(werr, cerr)
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}

// Check runs the checks that do not need the gold layer.
func (c *Config) Check() error { return c.check() }

func (c *Config) Find(id string) int {
	for i, k := range c.KPIs {
		if k.ID == id {
			return i
		}
	}
	return -1
}

func (c *Config) HasGroup(id string) bool {
	for _, g := range c.Groups {
		if g.ID == id {
			return true
		}
	}
	return false
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// Slug makes an id from a name: "Kredit-Volumen (CHF)" → kredit-volumen-chf.
func Slug(name string) string {
	s := strings.ToLower(name)
	s = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss", "é", "e", "è", "e", "à", "a").Replace(s)
	s = strings.Trim(slugRe.ReplaceAllString(s, "-"), "-")
	if len(s) > 32 {
		s = strings.Trim(s[:32], "-")
	}
	return s
}

// UniqueID returns base, or base-2, base-3 … if taken.
func (c *Config) UniqueID(base string) string {
	if base == "" {
		base = "kennzahl"
	}
	id := base
	for n := 2; c.Find(id) >= 0; n++ {
		id = fmt.Sprintf("%s-%d", base, n)
	}
	return id
}

// Input is a definition as the app sends it: a Def plus a new group's name.
type Input struct {
	Def
	GroupName string `json:"groupName"`
}

// Prepare fills defaults, creates a new group if asked, and checks the figure
// against the catalog. It changes c only when it returns nil.
func (c *Config) Prepare(in Input, cat *catalog.Catalog) (Def, error) {
	d := in.Def
	d.Name = strings.TrimSpace(d.Name)
	d.Monthly.Table = strings.TrimSpace(d.Monthly.Table)
	d.Monthly.Value = strings.TrimSpace(d.Monthly.Value)
	if d.Name == "" {
		return Def{}, errors.New("Die Kennzahl braucht einen Namen.")
	}
	if strings.TrimSpace(d.ID) == "" {
		d.ID = c.UniqueID(Slug(d.Name))
	}
	if d.Short == "" {
		d.Short = d.Name
	}
	if d.Long == "" {
		d.Long = d.Name
	}
	if d.Monthly.Table == "" || d.Monthly.Value == "" {
		return Def{}, errors.New("Bitte Tabelle und Wertspalte wählen.")
	}
	if d.Dec < 0 || d.Dec > 3 {
		return Def{}, errors.New("Dezimalstellen: 0 bis 3.")
	}
	var newGroup *Group
	if !c.HasGroup(d.Group) {
		name := strings.TrimSpace(in.GroupName)
		if name == "" {
			if d.Group == "" {
				return Def{}, errors.New("Bitte ein Thema wählen oder ein neues benennen.")
			}
			return Def{}, fmt.Errorf("Das Thema %q gibt es nicht.", d.Group)
		}
		id := d.Group
		if id == "" {
			id = Slug(name)
		}
		if id == "" {
			return Def{}, errors.New("Der Name des Themas braucht Buchstaben oder Ziffern.")
		}
		if !c.HasGroup(id) {
			newGroup = &Group{ID: id, Name: name}
		}
		d.Group = id
	}
	if missing := d.Missing(cat); len(missing) > 0 {
		return Def{}, &MissingError{Items: missing}
	}
	if t := cat.Table(d.Monthly.Table); t != nil {
		if col := t.Column(d.Monthly.Value); col != nil && (col.Role == catalog.RoleTime || col.Role == catalog.RoleDimension) {
			return Def{}, fmt.Errorf("Die Spalte %s ist keine Zahl.", d.Monthly.Value)
		}
	}
	probe := c.Clone()
	if newGroup != nil {
		probe.Groups = append(probe.Groups, *newGroup)
	}
	if i := probe.Find(d.ID); i >= 0 {
		probe.KPIs[i] = d
	} else {
		probe.KPIs = append(probe.KPIs, d)
	}
	if err := probe.check(); err != nil {
		return Def{}, err
	}
	if newGroup != nil {
		c.Groups = append(c.Groups, *newGroup)
	}
	return d, nil
}

// MissingError names what the gold layer does not have.
type MissingError struct{ Items []string }

func (e *MissingError) Error() string {
	return "Im Goldlayer fehlt: " + strings.Join(e.Items, ", ") + "."
}
