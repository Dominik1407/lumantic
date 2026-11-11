# Windmill-Skript «f/lumantic/describe» (Vorlage)
#
# Liefert Lumantic den Katalog eines Goldlayers: Tabellen, Spalten, Beschreibungen
# und die Namen der Kategorien. Keine Datenzeilen. Lumantic ruft das Skript beim
# Start und über «Katalog neu laden» auf.
#
# Anpassen: GOLD (DuckDB-Datei oder ATTACH auf euren Lake) und SCHEMA_PREFIX.
import duckdb

GOLD = "/data/gold/retail.duckdb"
SCHEMA_PREFIX = "gold"
SOURCE = "Goldlayer · Retail Banking"


def main():
    con = duckdb.connect(GOLD, read_only=True)
    rows = con.execute(
        """
        SELECT t.schema_name, t.table_name, t.comment, c.column_name, c.data_type, c.comment
        FROM duckdb_tables() t
        JOIN duckdb_columns() c USING (database_name, schema_name, table_name)
        WHERE t.schema_name LIKE ? || '%'
        ORDER BY t.schema_name, t.table_name, c.column_index
        """,
        [SCHEMA_PREFIX],
    ).fetchall()

    tables = {}
    for schema, table, tcomment, col, dtype, ccomment in rows:
        name = f"{schema}.{table}"
        t = tables.setdefault(name, {"name": name, "desc": tcomment or "", "columns": []})
        column = {"name": col, "type": dtype, "desc": ccomment or ""}
        if dtype.upper().startswith("VARCHAR"):
            # Kategorienamen (Filialen, Kostenstellen), keine Kundendaten.
            column["values"] = [
                v[0]
                for v in con.execute(
                    f'SELECT DISTINCT CAST("{col}" AS VARCHAR) FROM "{schema}"."{table}" ORDER BY 1 LIMIT 40'
                ).fetchall()
            ]
        t["columns"].append(column)

    return {"source": SOURCE, "tables": list(tables.values())}
