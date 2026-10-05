#!/bin/sh
# NexusHub — supervision de clamd sur Fly (spec 2026-10-05-clamav-monitoring).
#
# L'image clamav/clamav lance clamd en arrière-plan puis termine par
# `exec tail -f /dev/null` : si clamd meurt, le conteneur reste « vivant » et
# Fly ne le relance jamais (incident 2026-09-05 → 2026-10-05). Ce script
# remplace l'entrypoint : il lance l'init d'origine, attend que clamd soit
# prêt, puis le surveille ; s'il ne répond plus, il sort en erreur pour que
# Fly redémarre la machine (`[[restart]] policy = "always"`).
set -u

STARTUP_TIMEOUT="${CLAMD_STARTUP_TIMEOUT:-1800}"

/init &
INIT_PID=$!

elapsed=0
until clamdscan --ping 1 >/dev/null 2>&1; do
  if ! kill -0 "$INIT_PID" 2>/dev/null; then
    echo "[supervise] /init a quitté avant que clamd soit prêt"
    exit 1
  fi
  if [ "$elapsed" -ge "$STARTUP_TIMEOUT" ]; then
    echo "[supervise] clamd pas prêt après ${STARTUP_TIMEOUT}s"
    exit 1
  fi
  sleep 10
  elapsed=$((elapsed + 10))
done
echo "[supervise] clamd prêt — surveillance toutes les 60 s"

while true; do
  sleep 60
  # 3 tentatives espacées de 10 s : tolère un rechargement de base.
  if ! clamdscan --ping 3:10 >/dev/null 2>&1; then
    echo "[supervise] clamd ne répond plus (3 tentatives) — arrêt pour redémarrage Fly"
    exit 1
  fi
done
