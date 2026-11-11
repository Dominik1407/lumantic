# Windmill-Skript «f/lumantic/query» (Vorlage)
#
# Führt eine Abfrage von Lumantic auf dem Goldlayer aus und gibt die Zeilen als
# Liste von Objekten zurück. Lumantic sendet nur SELECT-Abfragen, die es selbst aus
# geprüften Karten erzeugt. Die Verbindung ist zusätzlich read-only.
import datetime
import decimal
import re

import duckdb

GOLD = "/data/gold/retail.duckdb"


def _plain(v):
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()  # date -> "2026-11-02", wie Lumantic es erwartet
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def main(sql: str):
    if not re.match(r"^\s*SELECT\b", sql, re.IGNORECASE):
        raise ValueError("Lumantic darf nur lesen: erwartet wird eine SELECT-Abfrage.")
    con = duckdb.connect(GOLD, read_only=True)
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, map(_plain, row))) for row in cur.fetchall()]
