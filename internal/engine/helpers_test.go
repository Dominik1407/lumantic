package engine

import "github.com/Dominik1407/lumantic/internal/card"

func cardSpec(op string) card.Spec {
	v := 0.0
	return card.Spec{Good: &card.Rule{Op: op, Value: &v}}
}
