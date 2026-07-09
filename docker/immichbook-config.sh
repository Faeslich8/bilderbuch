#!/bin/sh
# Wird vom nginx-Entrypoint (/docker-entrypoint.d/) beim Containerstart ausgeführt.
# Erzeugt /config.js aus der Umgebungsvariable IMMICH_API_KEY, sodass jedes Gerät
# im Netzwerk die App ohne manuelle Eingabe von Server und Schlüssel nutzen kann.
# Ist IMMICH_API_KEY leer, bleibt der Key leer und die App fragt nach dem Schlüssel.
set -eu

: "${IMMICH_API_KEY:=}"

# Backslashes und Anführungszeichen für den JS-String escapen.
escaped=$(printf '%s' "$IMMICH_API_KEY" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

cat > /usr/share/nginx/html/config.js <<EOF
window.__IMMICHBOOK_CONFIG__ = { apiKey: "${escaped}" };
EOF

if [ -n "$IMMICH_API_KEY" ]; then
  echo "immich-book: zentraler API-Schlüssel in config.js hinterlegt."
else
  echo "immich-book: kein IMMICH_API_KEY gesetzt – Geräte fragen nach dem Schlüssel."
fi
