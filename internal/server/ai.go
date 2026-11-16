package server

import (
	"github.com/Dominik1407/lumantic/internal/ai"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/lumina"
)

// rebuildAI makes Lumina from the current settings and token.
func (s *Server) rebuildAI() {
	eff := s.Config.Effective()
	var lum ai.Lumina
	var tr lumina.Translator = lumina.Offline{}
	if set, missing := s.aiSettings(eff); missing == "" {
		switch {
		case s.NewLumina != nil:
			lum = s.NewLumina(set)
		case set.Provider == config.ProviderOpenAI:
			lum = ai.NewOpenAI(set)
		default:
			c := ai.NewClaude(set)
			lum, tr = c, lumina.NewClaude(c.Client(), eff.AI.Model)
		}
		// The cards of the first board come from Claude alone; with another model their routes say so.
		if set.Provider == config.ProviderOpenAI {
			tr = lumina.Elsewhere{Name: set.Model}
		}
	}
	s.mu.Lock()
	s.lum, s.tr = lum, tr
	s.mu.Unlock()
}

// aiSettings are the settings Lumina is built from, and what she still lacks:
// "off" (the AI is switched off), "model", "token", or "" when she can ask. With
// Anthropic she needs a token. Another provider needs a model, and a key only
// at OpenAI itself: a local model or a gateway with an address of its own may
// go without.
func (s *Server) aiSettings(eff config.Config) (ai.Settings, string) {
	a := eff.AI
	var set ai.Settings
	var has bool
	if a.Provider == config.ProviderOpenAI {
		tok, st, _ := s.Config.Secret(config.OpenAIToken)
		set, has = ai.Settings{Provider: a.Provider, Model: a.Model, BaseURL: a.BaseURL, Token: tok}, st.Set || a.BaseURL != ""
	} else {
		tok, st, envName := s.Config.Secret(config.AnthropicToken)
		set, has = ai.Settings{Provider: config.ProviderAnthropic, Model: a.Model, BaseURL: a.BaseURL, Token: tok, AuthToken: envName == "ANTHROPIC_AUTH_TOKEN"}, st.Set
	}
	switch {
	case !a.Enabled:
		return set, "off"
	case set.Model == "":
		return set, "model"
	case !has:
		return set, "token"
	}
	return set, ""
}

// waiting says why Lumina cannot ask a model, in a sentence for an answer 409.
func (s *Server) waiting() string {
	switch _, missing := s.aiSettings(s.Config.Effective()); missing {
	case "off":
		return "Lumina ist ohne KI eingestellt."
	case "model":
		return "Für Lumina ist kein Modell eingetragen."
	}
	return "Für Lumina ist kein API-Token gesetzt."
}
