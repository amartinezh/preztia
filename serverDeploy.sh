#!/usr/bin/env bash
# Despliegue completo: backend en el VPS y LUEGO la web. Si el deploy del backend
# falla (p. ej. árbol sucio en el servidor), NO se publica la web: evita dejar
# front nuevo hablando con API vieja.
set -euo pipefail

ssh deploy@62.84.181.41 '~/preztia/deploy/scripts/deploy.sh'
./deploy/scripts/publish-web.sh
