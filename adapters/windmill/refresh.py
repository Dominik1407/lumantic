# Windmill-Skript «f/lumantic/refresh» (Vorlage)
#
# Letzter Schritt eines Flows, der den Goldlayer lädt: sagt Lumantic, dass es neue
# Daten gibt. Lumantic antwortet sofort (202) und rechnet den Kosmos im Hintergrund
# neu; offene Seiten bieten danach «Neue Zahlen» an.
#
# Den Token erzeugst du in Lumantic unter Einstellungen › Daten › Aktualisierung.
# Er erscheint nur einmal. Leg ihn in Windmill als Secret-Variable ab, zum Beispiel
# f/lumantic/refresh_token, und gib dem Skript die Adresse von Lumantic und die
# Kennung des Kosmos («main» für den ersten, sonst die aus ?k=… in der Adresse).
import json
import urllib.parse
import urllib.request

import wmill


def main(url: str = "http://lumantic.intern:8080", kosmos: str = "main",
         token_path: str = "f/lumantic/refresh_token"):
    token = wmill.get_variable(token_path)
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/refresh?k={urllib.parse.quote(kosmos)}",
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        # {"kosmos": …, "queued": true|false, "status": {…}}: queued is false when a
        # read was already waiting; that one sees the new data as well.
        return json.loads(resp.read() or b"{}")
