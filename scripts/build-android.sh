#!/usr/bin/env bash
set -euo pipefail
TASK_REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_REPO"
if [[ -x "${TC_TOOLING_DIR:-/workspace/.tooling}/jdk-21.0.8+9/bin/javac" ]]; then
  source "$TASK_REPO/scripts/android-env.sh"
fi
export LLAMA_SOURCE_DIR="${LLAMA_SOURCE_DIR:-/workspace/.cache/llama.cpp-new}"
export WHISPER_SOURCE_DIR="${WHISPER_SOURCE_DIR:-/workspace/.cache/whisper.cpp}"
bash scripts/prepare-speech.sh >/dev/null
TASK_LLAMA_COMMIT=d81235049384534c167caea52b85a694f6103d14
if [[ ! -f "$LLAMA_SOURCE_DIR/include/llama.h" ]]; then
  mkdir -p "$(dirname "$LLAMA_SOURCE_DIR")"
  git clone --depth 1 --branch b11429 https://github.com/ggml-org/llama.cpp.git "$LLAMA_SOURCE_DIR"
fi
if [[ "$(git -C "$LLAMA_SOURCE_DIR" rev-parse HEAD)" != "$TASK_LLAMA_COMMIT" ]]; then
  printf '%s\n' 'llama.cpp must be pinned to b11429 / d81235049384534c167caea52b85a694f6103d14.' >&2
  exit 1
fi
command -v javac >/dev/null || { printf '%s\n' 'JDK 21 required. See docs/build.md.' >&2; exit 1; }
[[ -n "${ANDROID_HOME:-}" ]] || { printf '%s\n' 'Set ANDROID_HOME to Android SDK 35 with NDK 28.2.13676358 and CMake 3.22.1.' >&2; exit 1; }
if [[ ! -d node_modules/@capacitor/android ]]; then npm ci; fi
npm run build
rm -rf -- apps/android/app/src/main/assets/public
mkdir -p apps/android/app/src/main/assets/public
cp -a dist/. apps/android/app/src/main/assets/public/
cp resources/default-model.json apps/android/app/src/main/assets/default-model.json
cp resources/local-speech.json apps/android/app/src/main/assets/local-speech.json
cat > apps/android/app/src/main/assets/capacitor.config.json <<'JSON'
{"appId":"cn.tc.assistant","appName":"L-BOT","webDir":"dist","loggingBehavior":"none","server":{"hostname":"localhost","androidScheme":"https"},"android":{"allowMixedContent":false,"webContentsDebuggingEnabled":false}}
JSON
printf '%s\n' '[]' > apps/android/app/src/main/assets/capacitor.plugins.json
TASK_GRADLE="${GRADLE_BIN:-gradle}"
if [[ -x apps/android/gradlew ]]; then TASK_GRADLE=./gradlew; fi
(cd apps/android && "$TASK_GRADLE" --no-daemon --max-workers=2 assembleDebug)
mkdir -p artifacts/android
cp apps/android/app/build/outputs/apk/debug/app-debug.apk artifacts/android/L-BOT-Android-0.2.0-arm64-debug.apk
printf '%s\n' "APK: $TASK_REPO/artifacts/android/L-BOT-Android-0.2.0-arm64-debug.apk"
printf '%s\n' 'Debug-signed arm64 Android APK. Real 8GB device / 12800-token / 30-minute acceptance still required.'
