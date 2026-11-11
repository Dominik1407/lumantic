package adapter

import (
	"strings"
	"testing"

	"lumantic/internal/catalog"
)

func TestSeriesInEachDialect(t *testing.T) {
	q := Series{Table: "gold.kredite", Time: "stichtag", Split: "region", Values: []string{"volumen_chf", "o'neil"}}
	want := map[string]string{
		"duckdb":     `SELECT strftime(CAST("stichtag" AS DATE), '%Y-%m') AS p, CAST("region" AS VARCHAR) AS s, CAST(SUM("volumen_chf") AS DOUBLE) AS c0, CAST(SUM("o'neil") AS DOUBLE) AS c1 FROM "gold"."kredite" GROUP BY 1, 2 ORDER BY 1`,
		"snowflake":  `SELECT TO_CHAR(CAST("stichtag" AS DATE), 'YYYY-MM') AS p, CAST("region" AS VARCHAR) AS s, CAST(SUM("volumen_chf") AS DOUBLE) AS c0, CAST(SUM("o'neil") AS DOUBLE) AS c1 FROM "gold"."kredite" GROUP BY 1, 2 ORDER BY 1`,
		"databricks": "SELECT date_format(CAST(`stichtag` AS DATE), 'yyyy-MM') AS p, CAST(`region` AS STRING) AS s, CAST(SUM(`volumen_chf`) AS DOUBLE) AS c0, CAST(SUM(`o'neil`) AS DOUBLE) AS c1 FROM `gold`.`kredite` GROUP BY 1, 2 ORDER BY 1",
	}
	for name, sql := range want {
		if got := DialectFor(name).Series(q); got != sql {
			t.Errorf("%s:\n got %s\nwant %s", name, got, sql)
		}
	}
	daily := DialectFor("databricks").Series(Series{Table: "s.t", Time: "d", Daily: true, Values: []string{"v"}})
	if !strings.Contains(daily, "'yyyy-MM-dd'") || strings.Contains(daily, " AS s") {
		t.Errorf("daily: %s", daily)
	}
}

func TestQuotingKeepsNamesAndValuesApart(t *testing.T) {
	cases := []struct{ dialect, in, ident, lit string }{
		{"duckdb", `a"b'c\`, `"a""b'c\"`, `'a"b''c\'`},
		{"snowflake", `a"b'c\`, `"a""b'c\"`, `'a"b''c\\'`},
		{"databricks", "a`b'c\\", "`a``b'c\\`", `'a` + "`" + `b\'c\\'`},
	}
	for _, c := range cases {
		d := DialectFor(c.dialect)
		if got := d.Ident(c.in); got != c.ident {
			t.Errorf("%s ident: %s, want %s", c.dialect, got, c.ident)
		}
		if got := d.Literal(c.in); got != c.lit {
			t.Errorf("%s literal: %s, want %s", c.dialect, got, c.lit)
		}
	}
	if DialectFor("excel").Name != "duckdb" {
		t.Error("an unknown dialect should fall back to DuckDB")
	}
}

func TestValuesAndCounts(t *testing.T) {
	d := DialectFor("snowflake")
	v := d.Values([]Column{{"GOLD.KREDITE", "REGION"}, {"GOLD.KREDITE", "SEGMENT"}})
	if strings.Count(v, "UNION ALL") != 1 || !strings.Contains(v, `WHERE "REGION" IS NOT NULL ORDER BY 1 LIMIT 40) AS x`) {
		t.Errorf("values: %s", v)
	}
	if !ReadOnly(v) {
		t.Errorf("the values query must count as read-only: %s", v)
	}
	c := DialectFor("databricks").Counts([]string{"gold.a", "gold.b"})
	if !strings.Contains(c, "SELECT 'gold.a' AS t, CAST(count(*) AS BIGINT) AS n FROM `gold`.`a`") || !ReadOnly(c) {
		t.Errorf("counts: %s", c)
	}
}

func TestReadOnly(t *testing.T) {
	ok := []string{
		"SELECT 1",
		"  select * from t;",
		"WITH x AS (SELECT 1) SELECT * FROM x",
		"(SELECT 1) UNION ALL (SELECT 2)",
		"-- note\nSELECT 'a;b' AS v",
		"/* drop table */ SELECT \"x;y\" FROM t",
		`SELECT 'it\'s; fine'`,
		"SELECT 'it''s; fine'",
	}
	for _, sql := range ok {
		if !ReadOnly(sql) {
			t.Errorf("should pass: %q", sql)
		}
	}
	refused := []string{
		"",
		"DROP TABLE t",
		"SELECT 1; DROP TABLE t",
		"select 1;delete from t",
		"INSERT INTO t SELECT 1",
		"SELECTX FROM t",
		"CREATE TABLE t AS SELECT 1",
		"SELECT 'open",
		"SELECT 1 /* open",
		"-- SELECT\nDELETE FROM t",
		"CALL system$whatever()",
		"COPY INTO @stage FROM t",
	}
	for _, sql := range refused {
		if ReadOnly(sql) {
			t.Errorf("should be refused: %q", sql)
		}
	}
}

func TestRolesOfWarehouseTypes(t *testing.T) {
	want := map[string]string{
		"DATE": catalog.RoleTime, "TIMESTAMP_NTZ": catalog.RoleTime, "timestamp with time zone": catalog.RoleTime, "DATETIME": catalog.RoleTime,
		"TEXT": catalog.RoleDimension, "STRING": catalog.RoleDimension, "VARCHAR(16777216)": catalog.RoleDimension, "CHARACTER VARYING": catalog.RoleDimension,
		"BOOLEAN": catalog.RoleDimension, "ENUM('a')": catalog.RoleDimension,
		"NUMBER": catalog.RoleMeasure, "NUMBER(38,2)": catalog.RoleMeasure, "DECIMAL(18,2)": catalog.RoleMeasure, "LONG": catalog.RoleMeasure,
		"INT": catalog.RoleMeasure, "BIGINT": catalog.RoleMeasure, "DOUBLE": catalog.RoleMeasure, "FLOAT": catalog.RoleMeasure, "HUGEINT": catalog.RoleMeasure,
		"VARIANT": "", "STRUCT<a: INT>": "", "ARRAY": "", "BINARY": "", "TIME": "", "INTERVAL": "",
	}
	for typ, role := range want {
		if got := catalog.RoleFor(typ); got != role {
			t.Errorf("%s: %q, want %q", typ, got, role)
		}
	}
}
