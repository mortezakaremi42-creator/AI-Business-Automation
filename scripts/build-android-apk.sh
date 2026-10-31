#!/usr/bin/env bash
set -euo pipefail

echo "=== BIT24 AI TRADER PRO — ساخت فایل نصبی اندروید APK ==="

if ! command -v java >/dev/null 2>&1; then
  echo "[خطا] Java JDK 17 و Android SDK روی این ماشین نصب نیست."
  echo "لطفاً این اسکریپت را روی رایانه دارای Android Studio / JDK 17 اجرا کنید."
  exit 1
fi

npm run build:client

if [ ! -d "android" ]; then
  npm install --no-save @capacitor/core @capacitor/cli @capacitor/android
  npx cap add android
fi

npx cap sync android
cd android
./gradlew assembleDebug
echo "=== فایل APK با موفقیت ساخته شد: android/app/build/outputs/apk/debug/app-debug.apk ==="
