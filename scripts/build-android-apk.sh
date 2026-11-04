#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== BIT24 — Debug APK / Capacitor 7 ==="
if ! command -v java >/dev/null 2>&1; then
  echo "Install JDK 21 and Android Studio with SDK Platform 35; set JAVA_HOME and ANDROID_HOME."
  exit 1
fi
major="$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')"
if [[ ! "$major" =~ ^[0-9]+$ ]] || (( major < 21 )); then
  echo "JDK 21+ required (detected: $major). Set JAVA_HOME to Android Studio JBR/JDK 21."
  exit 1
fi
npm run build:client
# Dependencies are pinned in package-lock.json; run npm ci beforehand.
if [ ! -d android ]; then npx --no-install cap add android; fi
npx --no-install cap sync android
(cd android && ./gradlew assembleDebug)
test -s android/app/build/outputs/apk/debug/app-debug.apk
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
