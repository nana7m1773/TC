#!/usr/bin/env bash
set -euo pipefail
# Only the official immutable source is used. No model/network service is required at runtime.
speech_version=v1.8.7
speech_commit=48f628a84833905ee4a0658ee6d4a5c915ce1997
speech_source="${WHISPER_SOURCE_DIR:-/workspace/.cache/whisper.cpp}"
if [[ -e "$speech_source" ]]; then
  [[ -d "$speech_source/.git" ]] || { echo "Whisper source path exists without a Git checkout: $speech_source" >&2; exit 1; }
  [[ "$(git -C "$speech_source" rev-parse HEAD)" == "$speech_commit" ]] || { echo "Whisper source does not match pinned commit $speech_commit" >&2; exit 1; }
  [[ -z "$(git -C "$speech_source" status --porcelain --untracked-files=no)" ]] || { echo "Whisper source contains tracked modifications; preserve them and choose a fresh WHISPER_SOURCE_DIR" >&2; exit 1; }
else
  mkdir -p "$(dirname "$speech_source")"
  speech_temporary="$(mktemp -d "${speech_source}.prepare.XXXXXX")"
  trap 'rm -rf "$speech_temporary"' EXIT
  git -c advice.detachedHead=false clone --depth 1 --branch "$speech_version" https://github.com/ggml-org/whisper.cpp.git "$speech_temporary" >&2
  [[ "$(git -C "$speech_temporary" rev-parse HEAD)" == "$speech_commit" ]] || { echo "Official Whisper tag does not match pinned commit" >&2; exit 1; }
  mv "$speech_temporary" "$speech_source"
  trap - EXIT
fi
[[ -f "$speech_source/include/whisper.h" && -f "$speech_source/ggml/include/ggml.h" ]] || { echo "Whisper checkout is incomplete" >&2; exit 1; }
printf '%s\n' "$speech_source"
