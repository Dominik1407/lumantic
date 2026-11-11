// Package store keeps the board: cards (a question, its rule and how it is
// computed), notes and the workspace (dashboard layouts, pinned moments,
// design). Never data from the gold layer.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"lumantic/internal/card"
)

var ErrNotFound = errors.New("Nicht gefunden")

// Note is a piece of the team's second brain. [[Short name]] links it to a card.
type Note struct {
	ID      string       `json:"id"`
	Text    string       `json:"text"`
	Created time.Time    `json:"created"`
	Layout  *card.Layout `json:"layout,omitempty"`
}

type file struct {
	Cards     []card.Card     `json:"cards"`
	Notes     []Note          `json:"notes"`
	Workspace json.RawMessage `json:"workspace,omitempty"`
	// Workspaces holds the pages of every Kosmos beside the first, by its id.
	Workspaces map[string]json.RawMessage `json:"workspaces,omitempty"`
}

type Store struct {
	mu   sync.Mutex
	path string
	data file
}

// StartNotes are the example notes of the demo board.
var StartNotes = []string{
	"# Kreditprüfung Zürich\nZwei Stellen sind seit Oktober unbesetzt. Rückstand bis Ende November abbauen, Aushilfe aus Bern anfragen.\n\nBetrifft [[Offene Kreditanträge]]",
	"# Lizenzen KW 43\nJahreslizenz für das Analytics-Tool wurde auf einmal bezahlt. Einmaliger Effekt, kein Trend.\n\nErklärt die Spitze bei [[IT-Kosten]]",
	"# Umfrage Oktober\nNeue Fragebogen-Version seit KW 44. Vergleichbarkeit mit dem Vorjahr prüfen.\n\nSiehe [[Kundenzufriedenheit]] und [[Wartezeit am Schalter]]",
}

// Open loads the board from path, or starts it with the given specs and notes.
func Open(path string, start []card.Spec, notes []string) (*Store, error) {
	s := &Store{path: path}
	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &s.data); err != nil {
			return nil, err
		}
	case errors.Is(err, os.ErrNotExist):
		s.reset(start, notes)
		if err := s.save(); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	return s, nil
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) reset(start []card.Spec, notes []string) {
	now := time.Now()
	s.data = file{Workspace: s.data.Workspace, Workspaces: s.data.Workspaces}
	for i, spec := range start {
		s.data.Cards = append(s.data.Cards, card.Card{ID: newID(), Spec: spec, Origin: "start", Created: now.Add(time.Duration(i) * time.Millisecond)})
	}
	for i, text := range notes {
		s.data.Notes = append(s.data.Notes, Note{ID: newID(), Text: text, Created: now.Add(time.Duration(i) * time.Millisecond)})
	}
}

func (s *Store) save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(s.data, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Cards() []card.Card {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]card.Card(nil), s.data.Cards...)
}

func (s *Store) Add(spec card.Spec, origin string) (card.Card, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := card.Card{ID: newID(), Spec: spec, Origin: origin, Created: time.Now()}
	s.data.Cards = append(s.data.Cards, c)
	return c, s.save()
}

func (s *Store) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, c := range s.data.Cards {
		if c.ID == id {
			s.data.Cards = append(s.data.Cards[:i], s.data.Cards[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *Store) SetRule(id string, rule *card.Rule) (card.Card, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Cards {
		if s.data.Cards[i].ID == id {
			s.data.Cards[i].Spec.Good = rule
			return s.data.Cards[i], s.save()
		}
	}
	return card.Card{}, ErrNotFound
}

// SetLayouts stores positions and forms; unknown ids are ignored.
func (s *Store) SetLayouts(cards, notes map[string]card.Layout) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Cards {
		if l, ok := cards[s.data.Cards[i].ID]; ok {
			s.data.Cards[i].Layout = &l
		}
	}
	for i := range s.data.Notes {
		if l, ok := notes[s.data.Notes[i].ID]; ok {
			s.data.Notes[i].Layout = &l
		}
	}
	return s.save()
}

func (s *Store) Notes() []Note {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Note(nil), s.data.Notes...)
}

func (s *Store) AddNote(text string, layout *card.Layout) (Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := Note{ID: newID(), Text: text, Created: time.Now(), Layout: layout}
	s.data.Notes = append(s.data.Notes, n)
	return n, s.save()
}

func (s *Store) SetNoteText(id, text string) (Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Notes {
		if s.data.Notes[i].ID == id {
			s.data.Notes[i].Text = text
			return s.data.Notes[i], s.save()
		}
	}
	return Note{}, ErrNotFound
}

func (s *Store) RemoveNote(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, n := range s.data.Notes {
		if n.ID == id {
			s.data.Notes = append(s.data.Notes[:i], s.data.Notes[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *Store) Reset(start []card.Spec, notes []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reset(start, notes)
	return s.save()
}

// Workspace returns the stored workspace document, or an empty object.
func (s *Store) Workspace() json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.data.Workspace) == 0 {
		return json.RawMessage("{}")
	}
	return append(json.RawMessage(nil), s.data.Workspace...)
}

// SetWorkspace replaces the workspace document; it must be a JSON object.
func (s *Store) SetWorkspace(raw json.RawMessage) error {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return errors.New("Der Arbeitsbereich muss ein JSON-Objekt sein")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Workspace = append(json.RawMessage(nil), raw...)
	return s.save()
}

// WorkspaceOf returns the workspace document of a further Kosmos, or an empty object.
func (s *Store) WorkspaceOf(id string) json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if raw := s.data.Workspaces[id]; len(raw) > 0 {
		return append(json.RawMessage(nil), raw...)
	}
	return json.RawMessage("{}")
}

// SetWorkspaceOf replaces the workspace document of a further Kosmos.
func (s *Store) SetWorkspaceOf(id string, raw json.RawMessage) error {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return errors.New("Der Arbeitsbereich muss ein JSON-Objekt sein")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Workspaces == nil {
		s.data.Workspaces = map[string]json.RawMessage{}
	}
	s.data.Workspaces[id] = append(json.RawMessage(nil), raw...)
	return s.save()
}

// HasWorkspace says whether a workspace document was ever saved under id.
func (s *Store) HasWorkspace(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.data.Workspaces[id]) > 0
}

// DropWorkspace forgets the workspace of a Kosmos that was removed, and the
// workspaces people kept in it ("id|person").
func (s *Store) DropWorkspace(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dropped := false
	for key := range s.data.Workspaces {
		if key == id || strings.HasPrefix(key, id+"|") {
			delete(s.data.Workspaces, key)
			dropped = true
		}
	}
	if !dropped {
		return nil
	}
	return s.save()
}
