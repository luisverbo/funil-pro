#!/usr/bin/env bash
# ============================================================================
# Bateria do Content Studio — verificação HONESTA
# ----------------------------------------------------------------------------
# Por que este script existe: a bateria era rodada à mão e a conferência olhava
# só a palavra "passaram" na última linha. "34/48 testes passaram" contém
# "passaram" — e uma suíte quebrada passou despercebida por uma rodada inteira.
# Aqui a suíte só é dada como verde quando aprovados == total, e o processo
# termina com código != 0 se QUALQUER suíte falhar.
#
# Uso:  bash scripts/test-content-studio.sh
#       npm run test:cs
#
# Nenhum teste faz chamada real de IA: os provedores são substituídos por
# fakes dentro das próprias suítes.
# ============================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${CS_TEST_OUT:-$RAIZ/.cs-test-build}"

rm -rf "$OUT"
mkdir -p "$OUT"

# tsconfig dedicado: mesmas opções do projeto + alias @/ para src/.
cat > "$OUT/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "outDir": ".", "module": "commonjs", "target": "es2022",
    "moduleResolution": "node", "esModuleInterop": true, "skipLibCheck": true,
    "resolveJsonModule": true, "jsx": "react-jsx", "strict": true,
    "baseUrl": "$RAIZ", "paths": { "@/*": ["src/*"] }
  },
  "include": [
    "$RAIZ/src/lib/content-studio/__tests__/*.test.ts",
    "$RAIZ/src/lib/security/__tests__/*.test.ts"
  ]
}
JSON

# Resolvedor de "@/": as suítes leem módulos por alias, como o app.
cat > "$OUT/alias.js" <<'JS'
const Module = require('module')
const path = require('path')
const orig = Module._resolveFilename
const base = process.env.CS_OUT
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(base, req.slice(2))
  return orig.call(this, req, ...rest)
}
JS

echo "→ compilando as suítes…"
(cd "$OUT" && npx --prefix "$RAIZ" tsc -p tsconfig.json) || true

SOMA=0
TOTAL=0
FALHAS=0

for arquivo in "$OUT"/lib/content-studio/__tests__/*.test.js "$OUT"/lib/security/__tests__/*.test.js; do
  [ -e "$arquivo" ] || continue
  nome="$(basename "$arquivo")"
  linha="$(cd "$RAIZ" && CS_OUT="$OUT" NODE_PATH="$RAIZ/node_modules" \
    node -r "$OUT/alias.js" "$arquivo" 2>&1 | tail -1)"

  # Só "X/Y" com X == Y é verde. Qualquer outra coisa (crash, X<Y) é falha.
  aprovados="$(printf '%s' "$linha" | sed -n 's#^\([0-9]\{1,\}\)/\([0-9]\{1,\}\).*#\1#p')"
  total="$(printf '%s' "$linha" | sed -n 's#^\([0-9]\{1,\}\)/\([0-9]\{1,\}\).*#\2#p')"

  if [ -z "$aprovados" ] || [ "$aprovados" != "$total" ]; then
    echo "  FALHOU  $nome :: $linha"
    FALHAS=$((FALHAS + 1))
  else
    echo "  ok      $nome :: $aprovados/$total"
  fi
  SOMA=$((SOMA + ${aprovados:-0}))
  TOTAL=$((TOTAL + ${total:-0}))
done

echo "────────────────────────────────────────────"
echo "TOTAL: $SOMA/$TOTAL  ·  suítes com falha: $FALHAS"

[ "$FALHAS" -eq 0 ] || exit 1
