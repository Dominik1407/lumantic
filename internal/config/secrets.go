package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"
)

// Secrets live in their own file (data/secrets.json, mode 0600) so the config
// can be shared. The API never hands a secret out, only whether it is set.

const (
	AnthropicToken = "anthropicToken"
	WindmillToken  = "windmillToken"
	// The secrets of a warehouse belong to one Kosmos (see KosmosKey).
	SnowflakeToken   = "snowflakeToken"   // a programmatic access token or OAuth token
	DatabricksToken  = "databricksToken"  // a personal access token
	DatabricksSecret = "databricksSecret" // the service principal's OAuth secret
	// A loading job sends this token to say there is new data (POST /api/refresh).
	// The file keeps only "<last four>:<sha256>"; an environment variable holds it plain.
	RefreshToken = "refreshToken"
)

var secretKeys = []struct {
	key, path string
	env       []string
	perKosmos bool
}{
	{AnthropicToken, "ai.token", []string{"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"}, false},
	{WindmillToken, "data.windmill.token", []string{"WINDMILL_TOKEN"}, false},
	{SnowflakeToken, "data.snowflake.token", []string{"SNOWFLAKE_TOKEN"}, true},
	{DatabricksToken, "data.databricks.token", []string{"DATABRICKS_TOKEN"}, true},
	{DatabricksSecret, "data.databricks.secret", []string{"DATABRICKS_CLIENT_SECRET"}, true},
	{RefreshToken, "refresh.token", []string{"LUMANTIC_REFRESH_TOKEN"}, true},
}

// KosmosKey names a warehouse secret of one Kosmos. The first Kosmos uses the
// plain key, which an environment variable can also set; every other Kosmos
// has its own entry in the secrets file, "key@id".
func KosmosKey(key, kosmos string) string {
	if kosmos == "" || kosmos == MainID {
		return key
	}
	return key + "@" + kosmos
}

type SecretStatus struct {
	Set    bool   `json:"set"`
	Hint   string `json:"hint"`
	Source string `json:"source"` // "datei", "umgebung" or ""
}

// SecretEnvError means an environment variable fixes the secret.
type SecretEnvError struct{ Env string }

func (e *SecretEnvError) Error() string {
	return fmt.Sprintf("Dieser Token ist durch die Umgebungsvariable %s gesetzt und lässt sich hier nicht ändern.", e.Env)
}

func (m *Manager) loadSecrets() error {
	if m.secretsPath == "" {
		return nil
	}
	raw, err := os.ReadFile(m.secretsPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &m.secrets); err != nil {
		return fmt.Errorf("Die Datei %s ist kein gültiges JSON: %w", m.secretsPath, err)
	}
	return nil
}

func (m *Manager) envSecret(key string) (value, name string, ok bool) {
	for _, s := range secretKeys {
		if s.key != key {
			continue
		}
		for _, n := range s.env {
			if v, found := m.lookup(n); found && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v), n, true
			}
		}
	}
	return "", "", false
}

func knownSecret(key string) bool {
	base, kosmos, scoped := strings.Cut(key, "@")
	for _, s := range secretKeys {
		if s.key == base {
			return !scoped || (s.perKosmos && ValidID(kosmos))
		}
	}
	return false
}

// PerKosmos says whether a secret belongs to one Kosmos (see KosmosKey).
func PerKosmos(key string) bool {
	for _, s := range secretKeys {
		if s.key == key {
			return s.perKosmos
		}
	}
	return false
}

// DropSecrets removes the secrets of a Kosmos that is gone.
func (m *Manager) DropSecrets(kosmos string) error {
	if kosmos == "" || kosmos == MainID || m.secretsPath == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	next, dropped := map[string]string{}, false
	for k, v := range m.secrets {
		if strings.HasSuffix(k, "@"+kosmos) {
			dropped = true
			continue
		}
		next[k] = v
	}
	if !dropped {
		return nil
	}
	raw, _ := json.MarshalIndent(next, "", "  ")
	if err := writeAtomic(m.secretsPath, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	m.secrets = next
	return nil
}

// Secret returns the value (env first, then file) and its status.
// EnvName is the variable it came from, if any.
func (m *Manager) Secret(key string) (value string, st SecretStatus, envName string) {
	if v, n, ok := m.envSecret(key); ok {
		return v, SecretStatus{Set: true, Hint: hint(v), Source: "umgebung"}, n
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if v := m.secrets[key]; v != "" {
		return v, SecretStatus{Set: true, Hint: hint(v), Source: "datei"}, ""
	}
	return "", SecretStatus{}, ""
}

func hint(v string) string {
	if utf8.RuneCountInString(v) < 8 {
		return ""
	}
	r := []rune(v)
	return string(r[len(r)-4:])
}

// SetSecret stores a secret in the secrets file; an empty value deletes it.
func (m *Manager) SetSecret(key, value string) (SecretStatus, error) {
	if !knownSecret(key) {
		return SecretStatus{}, fmt.Errorf("Unbekannter Schlüssel %q.", key)
	}
	if _, n, ok := m.envSecret(key); ok {
		return SecretStatus{}, &SecretEnvError{Env: n}
	}
	value = strings.TrimSpace(value)
	if len(value) > 4000 || strings.ContainsAny(value, "\r\n\t ") {
		return SecretStatus{}, errors.New("Der Token darf keine Leerzeichen oder Zeilenumbrüche enthalten.")
	}
	if m.secretsPath == "" {
		return SecretStatus{}, errors.New("Es ist keine Datei für Tokens eingerichtet.")
	}
	m.mu.Lock()
	next := map[string]string{}
	for k, v := range m.secrets {
		next[k] = v
	}
	if value == "" {
		delete(next, key)
	} else {
		next[key] = value
	}
	raw, _ := json.MarshalIndent(next, "", "  ")
	err := writeAtomic(m.secretsPath, append(raw, '\n'), 0o600)
	if err == nil {
		m.secrets = next
	}
	m.mu.Unlock()
	if err != nil {
		return SecretStatus{}, fmt.Errorf("Der Token lässt sich nicht speichern: %w", err)
	}
	_, st, _ := m.Secret(key)
	return st, nil
}
