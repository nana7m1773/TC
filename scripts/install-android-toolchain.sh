#!/usr/bin/env bash
# Repeatable Linux Android build tools; only writes /workspace/.tooling.
# Checksums were read from Google's repository2-1.xml and publisher checksums.
set -euo pipefail
TASK_TOOLING="${TC_TOOLING_DIR:-/workspace/.tooling}"
export TC_TOOLING_DIR="$TASK_TOOLING"
mkdir -p "$TASK_TOOLING/android-sdk/cmdline-tools" "$TASK_TOOLING/android-user" "$TASK_TOOLING/gradle-cache"
fetch() {
  local url="$1" file="$2" algorithm="$3" expected="$4"
  if [[ -f "$file" ]] && printf '%s  %s\n' "$expected" "$file" | "$algorithm" --check --status; then
    return
  fi
  curl --fail --location --show-error --retry 2 --connect-timeout 20 "$url" -o "$file.part"
  printf '%s  %s\n' "$expected" "$file.part" | "$algorithm" --check --status
  mv "$file.part" "$file"
}
fetch 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.8%2B9/OpenJDK21U-jdk_x64_linux_hotspot_21.0.8_9.tar.gz' "$TASK_TOOLING/jdk21.tar.gz" sha256sum f2dc5418092c43003db8f9005c4a286e1c0104fea96ccdd49e8ebd037cac9219
[[ -x "$TASK_TOOLING/jdk-21.0.8+9/bin/javac" ]] || tar -xzf "$TASK_TOOLING/jdk21.tar.gz" -C "$TASK_TOOLING"
fetch 'https://services.gradle.org/distributions/gradle-8.11.1-bin.zip' "$TASK_TOOLING/gradle8.zip" sha256sum f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6
[[ -x "$TASK_TOOLING/gradle-8.11.1/bin/gradle" ]] || unzip -q "$TASK_TOOLING/gradle8.zip" -d "$TASK_TOOLING"
# Pin the Java sdkmanager; later command-line tools bootstrap a separate CLI.
fetch 'https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip' "$TASK_TOOLING/android-cmdline-tools19.zip" sha1sum 5fdcc763663eefb86a5b8879697aa6088b041e70
if [[ ! -x "$TASK_TOOLING/android-sdk/cmdline-tools/19.0/bin/sdkmanager" ]]; then
  unzip -q "$TASK_TOOLING/android-cmdline-tools19.zip" -d "$TASK_TOOLING/android-sdk/cmdline-tools"
  mv "$TASK_TOOLING/android-sdk/cmdline-tools/cmdline-tools" "$TASK_TOOLING/android-sdk/cmdline-tools/19.0"
fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/android-env.sh"
sdkmanager --sdk_root="$ANDROID_HOME" --licenses < <(yes)
sdkmanager --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 'ndk;28.2.13676358' 'cmake;3.22.1'
java -version
javac -version
gradle --version
sdkmanager --sdk_root="$ANDROID_HOME" --list_installed
