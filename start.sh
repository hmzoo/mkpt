#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UVICORN="$ROOT_DIR/.venv/bin/uvicorn"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/atelier.pid"
LOG_FILE="$RUN_DIR/atelier.log"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

if [[ ! -x "$UVICORN" ]]; then
  echo "Le venv est introuvable. Créez-le et installez les dépendances avec :" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

process_is_this_app() {
  local command
  command="$(ps -p "$1" -o args= 2>/dev/null)" || return 1
  [[ "$command" == *"$UVICORN"* && "$command" == *"main:app"* ]]
}

if [[ -f "$PID_FILE" ]]; then
  read -r existing_pid < "$PID_FILE" || true
  if [[ "${existing_pid:-}" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    if process_is_this_app "$existing_pid"; then
      echo "L'application tourne déjà (PID $existing_pid)."
      echo "Journal : $LOG_FILE"
      exit 0
    fi
    echo "Le PID $existing_pid n'est pas celui de cette application. Vérifiez $PID_FILE." >&2
    exit 1
  fi
  rm -f -- "$PID_FILE"
fi

mkdir -p -- "$RUN_DIR"
chmod 700 "$RUN_DIR"
cd -- "$ROOT_DIR"
nohup "$UVICORN" main:app --host "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 < /dev/null &
app_pid=$!
printf '%s\n' "$app_pid" > "$PID_FILE"
chmod 600 "$PID_FILE" "$LOG_FILE"

for _ in {1..40}; do
  if curl --silent --show-error --fail "http://$HOST:$PORT/" > /dev/null 2>&1; then
    echo "Atelier est démarré sur http://$HOST:$PORT/ (PID $app_pid)."
    echo "Journal : $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

echo "Le serveur n'a pas démarré correctement. Dernières lignes du journal :" >&2
tail -n 30 "$LOG_FILE" >&2 || true
if process_is_this_app "$app_pid"; then
  kill -TERM "$app_pid" 2>/dev/null || true
fi
rm -f -- "$PID_FILE"
exit 1
