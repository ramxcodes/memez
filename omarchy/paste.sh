#!/bin/bash

# Puts a meme on the clipboard and, unless --copy-only, pastes it into the
# window in front, like the Memez app does:
#   still images go as PNG image data, so they paste into chat apps and editors;
#   GIFs and videos go as a file (text/uri-list): as image data they would lose
#   their animation.
#
# Usage: paste.sh [--copy-only] <file>

set -euo pipefail

copy_only=false
if [[ ${1:-} == "--copy-only" ]]; then
  copy_only=true
  shift
fi

path=${1:-}
[[ -n $path && -r $path ]] || { echo "paste.sh: cannot read ${path:-<none>}" >&2; exit 1; }

# file:// URL with every byte outside the unreserved set percent-encoded.
file_url() {
  local LC_ALL=C s=$1 out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in
      [A-Za-z0-9/._~-]) out+=$c ;;
      *) printf -v c '%%%02X' "'$c"; out+=$c ;;
    esac
  done
  printf 'file://%s\n' "$out"
}

case ${path,,} in
  *.png)
    wl-copy --type image/png < "$path"
    ;;
  *.jpg | *.jpeg | *.webp)
    if command -v magick >/dev/null; then
      magick "$path" png:- | wl-copy --type image/png
    elif [[ ${path,,} == *.webp ]]; then
      wl-copy --type image/webp < "$path"
    else
      wl-copy --type image/jpeg < "$path"
    fi
    ;;
  *)
    file_url "$path" | wl-copy --type text/uri-list
    ;;
esac

[[ $copy_only == true ]] && exit 0

# Same keystroke the Omarchy clipboard manager sends: Shift+Insert pastes in
# terminals and GUI apps alike.
sleep 0.15
wtype -M shift -k Insert -m shift 2>/dev/null || true
