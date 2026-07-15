#!/bin/sh
set -eu

exec node /app/apps/server/dist/cli.js "$@"
