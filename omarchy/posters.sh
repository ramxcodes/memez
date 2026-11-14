#!/bin/bash

# Makes a still of the first frame of each video in a Memez library, for the
# overlay grid (the shell draws stills only). Media file names are content
# hashes, so a poster is never out of date. Prints the id of every video that
# has a poster, so the overlay asks only for files that exist.
#
# Usage: posters.sh <library-folder> <poster-folder>

set -uo pipefail

library=${1:-}
posters=${2:-}
[[ -d $library/media && -n $posters ]] || exit 0
command -v ffmpeg >/dev/null || exit 0
mkdir -p "$posters"

shopt -s nullglob
for video in "$library"/media/*.mp4 "$library"/media/*.webm; do
  name=$(basename "$video")
  [[ $name =~ ^([a-f0-9]{16})\.(mp4|webm)$ ]] || continue
  id=${BASH_REMATCH[1]}
  if [[ -s $posters/$id.jpg ]]; then
    echo "$id"
    continue
  fi
  tmp="$posters/.$id.$$.jpg"
  if nice -n 19 ffmpeg -nostdin -loglevel error -y -i "$video" -frames:v 1 \
    -vf "scale='min(480,iw)':-2" "$tmp" && [[ -s $tmp ]]; then
    mv -f "$tmp" "$posters/$id.jpg"
    echo "$id"
  else
    rm -f "$tmp"
  fi
done
