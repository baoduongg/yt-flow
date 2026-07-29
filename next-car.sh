#!/usr/bin/env bash
# Pop next car from queue, refill from master when empty, fill both prompt templates.
set -euo pipefail
cd "$(dirname "$0")"

QUEUE=cars-queue.txt
MASTER=cars-master.txt

if [ ! -s "$QUEUE" ]; then
  cp "$MASTER" "$QUEUE"
fi

CAR=$(head -n 1 "$QUEUE")
tail -n +2 "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"

SLUG=$(echo "$CAR" | tr ' /' '--' | tr -cd 'a-zA-Z0-9-')
OUT="output/${SLUG}-$(date +%Y%m%d%H%M%S)"
mkdir -p "$OUT"

sed "s/{CAR_MODEL}/$CAR/g" prompt-veo3.md > "$OUT/veo3-prompt.md"
sed "s/{CAR_MODEL}/$CAR/g" prompt-create-info-video.md > "$OUT/seo-prompt.md"

echo "Car: $CAR"
echo "$OUT/veo3-prompt.md"
echo "$OUT/seo-prompt.md"
