#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UVICORN="$ROOT_DIR/.venv/bin/uvicorn"
PID_FILE="$ROOT_DIR/.run/atelier.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "L'application n'est pas démarrée (aucun fichier PID)."
  exit 0
fi

read -r app_pid < "$PID_FILE" || true
if [[ ! "${app_pid:-}" =~ ^[0-9]+$ ]]; then
  echo "Le fichier PID est invalide : $PID_FILE" >&2
  exit 1
fi

if ! kill -0 "$app_pid" 2>/dev/null; then
  rm -f -- "$PID_FILE"
  echo "Le serveur était déjà arrêté (PID périmé nettoyé)."
  exit 0
fi

command="$(ps -p "$app_pid" -o args= 2>/dev/null)" || command=""
if [[ "$command" != *"$UVICORN"* || "$command" != *"main:app"* ]]; then
  echo "Le PID $app_pid ne correspond pas à cette application ; aucun processus n'a été arrêté." >&2
  exit 1
fi

kill -TERM "$app_pid"
for _ in {1..40}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    rm -f -- "$PID_FILE"
    echo "Atelier est arrêté."
    exit 0
  fi
  sleep 0.25
done

command="$(ps -p "$app_pid" -o args= 2>/dev/null)" || command=""
if [[ "$command" == *"$UVICORN"* && "$command" == *"main:app"* ]]; then
  kill -KILL "$app_pid"
fi
rm -f -- "$PID_FILE"
echo "Atelier a été arrêté."
