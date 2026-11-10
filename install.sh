#!/usr/bin/env bash
# Link the mods into the Herdr app's mods folder. Run it again after you edit a
# file: Herdr does not watch through a symlink, but it reloads a mod when the
# link itself is replaced.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODS="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"

[ -d "$MODS" ] || { echo "no $MODS (is the Herdr app installed?)" >&2; exit 1; }
for m in vitals limits; do
  if [ -e "$MODS/$m" ] && [ ! -L "$MODS/$m" ]; then
    echo "skip $m: $MODS/$m is a real folder, move it away first" >&2
    continue
  fi
  ln -sfn "$HERE/$m" "$MODS/$m"
  echo "linked $m"
done
