// Package catalog describes what a gold layer offers: tables, columns and
// their meaning. Lumina reads only this structure, never data rows.
package catalog

import "strings"

const (
	RoleTime      = "time"
	RoleDimension = "dimension"
	RoleMeasure   = "measure"
)

type Column struct {
	Name   string   `json:"name"`
	Type   string   `json:"type"`
	Role   string   `json:"role"`
	Unit   string   `json:"unit,omitempty"`
	Desc   string   `json:"desc"`
	Values []string `json:"values,omitempty"` // known values of a dimension
}

type Table struct {
	Name    string   `json:"name"` // schema.table
	Desc    string   `json:"desc"`
	Columns []Column `json:"columns"`
}

type Catalog struct {
	Source  string  `json:"source"`
	Dialect string  `json:"dialect"`
	Tables  []Table `json:"tables"`
}

func (c *Catalog) Table(name string) *Table {
	for i := range c.Tables {
		if strings.EqualFold(c.Tables[i].Name, name) {
			return &c.Tables[i]
		}
	}
	return nil
}

func (t *Table) Column(name string) *Column {
	for i := range t.Columns {
		if strings.EqualFold(t.Columns[i].Name, name) {
			return &t.Columns[i]
		}
	}
	return nil
}

func (t *Table) TimeColumn() *Column {
	for i := range t.Columns {
		if t.Columns[i].Role == RoleTime {
			return &t.Columns[i]
		}
	}
	return nil
}

// RoleFor derives a column's role from its SQL type, as DuckDB, Snowflake and
// Databricks name them. Types that are neither (structs, binary, time of day)
// get no role and are left out of key figures.
func RoleFor(sqlType string) string {
	t := strings.ToUpper(strings.TrimSpace(sqlType))
	has := func(prefixes ...string) bool {
		for _, p := range prefixes {
			if strings.HasPrefix(t, p) {
				return true
			}
		}
		return false
	}
	switch {
	case has("DATE", "TIMESTAMP"): // DATE, DATETIME, TIMESTAMP_NTZ, TIMESTAMP WITH TIME ZONE …
		return RoleTime
	case has("VARCHAR", "TEXT", "STRING", "CHAR", "NVARCHAR", "NCHAR", "ENUM", "BOOL"):
		return RoleDimension
	case has("INTERVAL"):
		return ""
	case has("INT", "BIGINT", "SMALLINT", "TINYINT", "HUGEINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT", "UHUGEINT",
		"LONG", "SHORT", "BYTE", "DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMBER", "NUMERIC"):
		return RoleMeasure
	}
	return ""
}

// UnitFor derives the display unit from the column naming convention.
func UnitFor(name string) string {
	switch n := strings.ToLower(name); {
	case strings.HasSuffix(n, "_chf"):
		return "CHF"
	case strings.HasSuffix(n, "_eur"):
		return "EUR"
	case strings.HasSuffix(n, "_min"):
		return "Min."
	case strings.HasSuffix(n, "_score"):
		return "von 10"
	case strings.HasSuffix(n, "_pct"):
		return "%"
	}
	return ""
}
