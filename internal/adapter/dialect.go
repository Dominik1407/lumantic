package adapter

import (
	"fmt"
	"strings"
)

// Dialect writes the few SQL shapes Lumantic asks for in one database's
// flavour. Lumantic builds its questions as structures (Series, the values of
// a dimension, row counts); only the dialect turns them into SQL text.
type Dialect struct {
	Name   string
	quote  string // identifier quote
	text   string // type that casts to text
	period func(expr string, daily bool) string
	escape func(s string) string // a string literal's inside
}

var dialects = map[string]Dialect{
	"duckdb": {
		Name: "duckdb", quote: `"`, text: "VARCHAR",
		period: func(e string, daily bool) string {
			if daily {
				return "strftime(CAST(" + e + " AS DATE), '%Y-%m-%d')"
			}
			return "strftime(CAST(" + e + " AS DATE), '%Y-%m')"
		},
		escape: func(s string) string { return strings.ReplaceAll(s, "'", "''") },
	},
	// Snowflake folds unquoted names to upper case. Names come from its
	// information schema as stored, so quoting them keeps them exact.
	"snowflake": {
		Name: "snowflake", quote: `"`, text: "VARCHAR",
		period: func(e string, daily bool) string {
			if daily {
				return "TO_CHAR(CAST(" + e + " AS DATE), 'YYYY-MM-DD')"
			}
			return "TO_CHAR(CAST(" + e + " AS DATE), 'YYYY-MM')"
		},
		escape: func(s string) string {
			return strings.NewReplacer(`\`, `\\`, "'", "''").Replace(s)
		},
	},
	// Databricks SQL quotes names with backticks and reads backslashes in
	// string literals as escapes.
	"databricks": {
		Name: "databricks", quote: "`", text: "STRING",
		period: func(e string, daily bool) string {
			if daily {
				return "date_format(CAST(" + e + " AS DATE), 'yyyy-MM-dd')"
			}
			return "date_format(CAST(" + e + " AS DATE), 'yyyy-MM')"
		},
		escape: func(s string) string {
			return strings.NewReplacer(`\`, `\\`, "'", `\'`).Replace(s)
		},
	},
}

// DialectFor returns the dialect of that name; unknown names get DuckDB's.
func DialectFor(name string) Dialect {
	if d, ok := dialects[name]; ok {
		return d
	}
	return dialects["duckdb"]
}

// DialectOf returns the dialect an adapter speaks.
func DialectOf(ad Adapter) Dialect { return DialectFor(ad.Dialect()) }

func (d Dialect) Ident(s string) string {
	return d.quote + strings.ReplaceAll(s, d.quote, d.quote+d.quote) + d.quote
}

// Table quotes a dotted name part by part: schema.table or catalog.schema.table.
func (d Dialect) Table(name string) string {
	parts := strings.Split(name, ".")
	for i, p := range parts {
		parts[i] = d.Ident(p)
	}
	return strings.Join(parts, ".")
}

func (d Dialect) Literal(s string) string { return "'" + d.escape(s) + "'" }

// Text casts an expression to text.
func (d Dialect) Text(expr string) string { return "CAST(" + expr + " AS " + d.text + ")" }

// Period turns a date or timestamp column into its month (YYYY-MM) or day
// (YYYY-MM-DD) as text.
func (d Dialect) Period(col string, daily bool) string { return d.period(d.Ident(col), daily) }

// Series asks for value columns summed per month or day, optionally per value
// of one dimension. The answer has p (the period), s (the dimension value, if
// split) and c0, c1, … (the sums, in the order of Values).
type Series struct {
	Table  string
	Time   string
	Split  string
	Daily  bool
	Values []string
}

func (d Dialect) Series(q Series) string {
	sel := []string{d.Period(q.Time, q.Daily) + " AS p"}
	group := "1"
	if q.Split != "" {
		sel = append(sel, d.Text(d.Ident(q.Split))+" AS s")
		group = "1, 2"
	}
	for i, c := range q.Values {
		sel = append(sel, fmt.Sprintf("CAST(SUM(%s) AS DOUBLE) AS c%d", d.Ident(c), i))
	}
	return fmt.Sprintf("SELECT %s FROM %s GROUP BY %s ORDER BY 1", strings.Join(sel, ", "), d.Table(q.Table), group)
}

// Column names one column of one table.
type Column struct{ Table, Column string }

// Values asks for up to 40 distinct values of each column, in one query. The
// answer has t (table), c (column) and v (a value as text).
func (d Dialect) Values(cols []Column) string {
	parts := make([]string, 0, len(cols))
	for _, c := range cols {
		col := d.Ident(c.Column)
		parts = append(parts, fmt.Sprintf(
			"SELECT %s AS t, %s AS c, v FROM (SELECT DISTINCT %s AS v FROM %s WHERE %s IS NOT NULL ORDER BY 1 LIMIT 40) AS x",
			d.Literal(c.Table), d.Literal(c.Column), d.Text(col), d.Table(c.Table), col))
	}
	return strings.Join(parts, "\nUNION ALL\n")
}

// Counts asks for the number of rows of each table, in one query. The answer
// has t (table) and n (rows).
func (d Dialect) Counts(tables []string) string {
	parts := make([]string, 0, len(tables))
	for _, t := range tables {
		parts = append(parts, fmt.Sprintf("SELECT %s AS t, CAST(count(*) AS BIGINT) AS n FROM %s", d.Literal(t), d.Table(t)))
	}
	return strings.Join(parts, "\nUNION ALL\n")
}

// ReadOnly reports whether sql is a single query that only reads. Adapters for
// warehouses check it before sending anything, as a second fence behind a
// read-only role.
func ReadOnly(sql string) bool {
	code, ok := skeleton(sql)
	if !ok {
		return false
	}
	s := strings.TrimRight(strings.TrimSpace(code), "; \t\r\n")
	if strings.Contains(s, ";") {
		return false
	}
	head := strings.ToUpper(strings.TrimLeft(s, "( \t\r\n"))
	for _, w := range []string{"SELECT", "WITH"} {
		if strings.HasPrefix(head, w) {
			rest := head[len(w):]
			return rest == "" || strings.ContainsRune(" \t\r\n(", rune(rest[0]))
		}
	}
	return false
}

// skeleton returns sql without comments and with the insides of string
// literals and quoted names blanked, so what is left is the statement's
// shape. ok is false when a literal, name or comment is not closed.
func skeleton(sql string) (string, bool) {
	var b strings.Builder
	for i := 0; i < len(sql); i++ {
		switch ch := sql[i]; {
		case ch == '\'' || ch == '"' || ch == '`':
			b.WriteByte(ch)
			for i++; ; i++ {
				if i >= len(sql) {
					return "", false
				}
				if ch == '\'' && sql[i] == '\\' {
					i++
					b.WriteString("  ")
					continue
				}
				if sql[i] == ch {
					if i+1 < len(sql) && sql[i+1] == ch {
						i++
						b.WriteString("  ")
						continue
					}
					b.WriteByte(ch)
					break
				}
				b.WriteByte(' ')
			}
		case ch == '-' && i+1 < len(sql) && sql[i+1] == '-':
			for i < len(sql) && sql[i] != '\n' {
				i++
			}
			b.WriteByte(' ')
		case ch == '/' && i+1 < len(sql) && sql[i+1] == '*':
			end := strings.Index(sql[i+2:], "*/")
			if end < 0 {
				return "", false
			}
			i += end + 3
			b.WriteByte(' ')
		default:
			b.WriteByte(ch)
		}
	}
	return b.String(), true
}
