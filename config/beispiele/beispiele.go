// Package beispiele carries the definitions of the example Kosmen in the
// program, so a first start shows them without any file beside it
// (internal/beispiele writes them out). The files here are also what
// config/lumantic.example.json points to.
package beispiele

import "embed"

//go:embed *.json
var Files embed.FS
