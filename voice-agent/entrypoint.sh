#!/bin/sh
# First start: fetch the Arabic (Jordan) Piper voice into the models volume. Whisper downloads itself on first use into HF_HOME.
set -e
VOICE=/models/ar_JO-kareem-medium
if [ ! -f "$VOICE.onnx" ]; then
  BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium
  curl -fL "$BASE/ar_JO-kareem-medium.onnx" -o "$VOICE.onnx.part" && mv "$VOICE.onnx.part" "$VOICE.onnx"
  curl -fL "$BASE/ar_JO-kareem-medium.onnx.json" -o "$VOICE.onnx.json"
fi
exec python agent.py
