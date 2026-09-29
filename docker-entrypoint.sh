#!/bin/sh
# Starts the server as the unprivileged `node` user. When DATABASE_URL points
# at a SQLite file on a freshly mounted volume (owned by root, as on Fly.io),
# first hand its directory to `node` so the server can write to it.
set -e

if [ "$(id -u)" = "0" ]; then
  case "${DATABASE_URL:-}" in
    file:* | sqlite:*)
      db_path="${DATABASE_URL#*:}"
      db_path="${db_path#//}"
      db_dir="$(dirname "$db_path")"
      mkdir -p "$db_dir"
      chown node:node "$db_dir"
      ;;
  esac
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
