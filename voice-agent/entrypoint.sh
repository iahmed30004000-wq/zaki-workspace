#!/bin/sh
# First start: fetch the Arabic (Jordan) Piper voice into the models volume. Whisper downloads itself on first use into HF_HOME.
set -e
VOICE=/models/ar_JO-kareem-medium
if [ ! -f "$VOICE.onnx" ]; then
  BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium
  curl -fL "$BASE/ar_JO-kareem-medium.onnx" -o "$VOICE.onnx.part" && mv "$VOICE.onnx.part" "$VOICE.onnx"
  curl -fL "$BASE/ar_JO-kareem-medium.onnx.json" -o "$VOICE.onnx.json"
fi

# The vowel-mark model (libtashkeel, MIT, 4.7 MB) makes the voice sound natural. Optional: if the download fails the voice still works and says so in its log.
TK=/models/tashkeel
TK_BASE=https://raw.githubusercontent.com/mush42/libtashkeel/9b91c2dbc3dc4085dc4f77a9e250e5dd095d7d0c/crates/core/data
if [ ! -f "$TK/model.onnx" ]; then
  mkdir -p "$TK"
  (
    set -e
    for f in input_id_map.json hint_id_map.json target_id_map.json; do
      curl -fL "$TK_BASE/$f" -o "$TK/$f"
    done
    curl -fL "$TK_BASE/ort/model.onnx" -o "$TK/model.onnx.part" && mv "$TK/model.onnx.part" "$TK/model.onnx"
  ) || echo "tashkeel download failed; the voice will read plain text"
fi

exec python agent.py
