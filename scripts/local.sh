#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"
NETWORK="akab-local"
DATA_VOLUME="akab-backend-data-local"
BACKEND_CONTAINER="akab-backend-local"
FRONTEND_CONTAINER="akab-frontend-local"
BACKEND_IMAGE="akab-backend:local"
FRONTEND_IMAGE="akab-frontend:local"
NODE_IMAGE="akab-node:local"
NODE_PREFIX="akab-node-local"

run_podman() {
  if command -v podman >/dev/null 2>&1; then
    command podman "$@"
  elif command -v flatpak-spawn >/dev/null 2>&1; then
    flatpak-spawn --host podman "$@"
  else
    echo "Podman est requis. Installez-le ou utilisez SteamOS en mode Bureau." >&2
    return 1
  fi
}

run_python() {
  if command -v python3 >/dev/null 2>&1; then
    python3 "$@"
  elif command -v flatpak-spawn >/dev/null 2>&1; then
    flatpak-spawn --host python3 "$@"
  else
    echo "Python 3 est requis pour préparer la configuration et les exemples." >&2
    return 1
  fi
}

container_exists() {
  run_podman container exists "$1"
}

container_running() {
  [[ "$(run_podman container inspect --format '{{.State.Running}}' "$1")" == "true" ]]
}

ensure_local_env() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  local existing_volume="false"
  if run_podman volume exists "$DATA_VOLUME"; then
    existing_volume="true"
  fi
  run_python "$ROOT_DIR/scripts/local_env.py" "$ENV_FILE" "$existing_volume"
  chmod 600 "$ENV_FILE"
}

ensure_network_and_volume() {
  if ! run_podman network exists "$NETWORK"; then
    run_podman network create "$NETWORK" >/dev/null
  fi
  if ! run_podman volume exists "$DATA_VOLUME"; then
    run_podman volume create "$DATA_VOLUME" >/dev/null
  fi
}

build_images() {
  run_podman build --tag "$BACKEND_IMAGE" "$ROOT_DIR/backend"
  run_podman build --tag "$FRONTEND_IMAGE" "$ROOT_DIR/frontend"
}

remove_containers() {
  if container_exists "$FRONTEND_CONTAINER"; then
    run_podman rm --force "$FRONTEND_CONTAINER" >/dev/null
  fi
  if container_exists "$BACKEND_CONTAINER"; then
    run_podman rm --force "$BACKEND_CONTAINER" >/dev/null
  fi
}

start_services() {
  if container_exists "$BACKEND_CONTAINER"; then
    if ! container_running "$BACKEND_CONTAINER"; then
      run_podman start "$BACKEND_CONTAINER" >/dev/null
    fi
  else
    run_podman run --detach \
      --name "$BACKEND_CONTAINER" \
      --network "$NETWORK" \
      --network-alias backend \
      --publish 127.0.0.1:4000:4000 \
      --env-file "$ENV_FILE" \
      --env DATABASE_URL=/app/data/akab.sqlite \
      --volume "$DATA_VOLUME:/app/data" \
      "$BACKEND_IMAGE" >/dev/null
  fi

  if container_exists "$FRONTEND_CONTAINER"; then
    if ! container_running "$FRONTEND_CONTAINER"; then
      run_podman start "$FRONTEND_CONTAINER" >/dev/null
    fi
  else
    run_podman run --detach \
      --name "$FRONTEND_CONTAINER" \
      --network "$NETWORK" \
      --publish 127.0.0.1:3000:80 \
      "$FRONTEND_IMAGE" >/dev/null
  fi
}

node_containers() {
  run_podman ps --all --filter "name=^${NODE_PREFIX}-" --format '{{.Names}}'
}

start_nodes() {
  local count="$1"
  ensure_local_env
  ensure_network_and_volume
  run_podman build --tag "$NODE_IMAGE" "$ROOT_DIR/storage-node"
  local tokens
  tokens="$(run_python "$ROOT_DIR/scripts/local_nodes.py" enable "$ENV_FILE" "$count")"
  for index in $(seq 1 "$count"); do
    local name="${NODE_PREFIX}-${index}"
    local token
    token="$(run_python -c 'import json,sys; print(json.loads(sys.argv[1])["tokens"]["local-"+sys.argv[2]])' "$tokens" "$index")"
    if container_exists "$name"; then
      run_podman rm --force "$name" >/dev/null
    fi
    run_podman run --detach \
      --name "$name" \
      --network "$NETWORK" \
      --network-alias "$name" \
      --env "NODE_TOKEN=$token" \
      --volume "akab-node-local-data-${index}:/data" \
      "$NODE_IMAGE" >/dev/null
  done
  remove_containers
  start_services
}

case "${1:-up}" in
  up)
    ensure_local_env
    ensure_network_and_volume
    if ! run_podman image exists "$BACKEND_IMAGE" || ! run_podman image exists "$FRONTEND_IMAGE"; then
      build_images
    fi
    start_services
    echo "AKAB est disponible sur http://localhost:3000 (API : http://localhost:4000)."
    ;;
  down)
    for container in "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER"; do
      if container_exists "$container" && container_running "$container"; then
        run_podman stop "$container" >/dev/null
      fi
    done
    echo "AKAB est arrêté. Le volume de données local a été conservé."
    ;;
  rebuild)
    ensure_local_env
    ensure_network_and_volume
    remove_containers
    build_images
    start_services
    echo "AKAB a été recompilé et redémarré sur http://localhost:3000."
    ;;
  nodes)
    case "${2:-status}" in
      up)
        count="${3:-3}"
        if ! [[ "$count" =~ ^[1-9]$ ]]; then
          echo "Usage : $0 nodes up [1-9]" >&2
          exit 2
        fi
        start_nodes "$count"
        echo "$count nœud(s) de stockage chiffrés démarrés ; la clé de chiffrement est dans .env.local (à sauvegarder !)."
        ;;
      down)
        for node in $(node_containers); do
          run_podman rm --force "$node" >/dev/null
        done
        run_python "$ROOT_DIR/scripts/local_nodes.py" disable "$ENV_FILE"
        remove_containers
        start_services
        echo "Nœuds arrêtés. Leurs volumes et la clé sont conservés ; les nouvelles preuves reviennent au stockage local."
        ;;
      status)
        run_podman ps --all --filter "name=^${NODE_PREFIX}-"
        ;;
      *)
        echo "Usage : $0 nodes [up [N]|down|status]" >&2
        exit 2
        ;;
    esac
    ;;
  status)
    run_podman ps --filter "name=akab-"
    ;;
  logs)
    target="${2:-backend}"
    case "$target" in
      backend) run_podman logs --follow "$BACKEND_CONTAINER" ;;
      frontend) run_podman logs --follow "$FRONTEND_CONTAINER" ;;
      *) echo "Usage : $0 logs [backend|frontend]" >&2; exit 2 ;;
    esac
    ;;
  demo)
    ensure_local_env
    run_python "$ROOT_DIR/scripts/demo_data.py" seed "$ENV_FILE"
    ;;
  reset-demo)
    if ! container_exists "$BACKEND_CONTAINER" || ! container_running "$BACKEND_CONTAINER"; then
      echo "Démarrez d'abord AKAB avec : bash scripts/local.sh up" >&2
      exit 1
    fi
    run_podman exec "$BACKEND_CONTAINER" node -e '
      const Database = require("better-sqlite3");
      const db = new Database("/app/data/akab.sqlite");
      const result = db.prepare("DELETE FROM signals WHERE title LIKE ?").run("DEMO AKAB LOCAL:%");
      console.log(`Exemples fictifs supprimés : ${result.changes}`);
      db.close();
    '
    ;;
  test)
    run_podman build --target builder --tag akab-backend-builder:local "$ROOT_DIR/backend"
    run_podman run --rm --entrypoint npm akab-backend-builder:local test
    run_podman build --target builder --tag akab-frontend-builder:local "$ROOT_DIR/frontend"
    run_podman run --rm --entrypoint npm akab-frontend-builder:local test
    ;;
  *)
    echo "Usage : $0 {up|down|rebuild|status|nodes [up [N]|down|status]|logs [backend|frontend]|demo|reset-demo|test}" >&2
    exit 2
    ;;
esac
