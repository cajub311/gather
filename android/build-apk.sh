#!/usr/bin/env bash
# Gather Android app = a WebView around the live site, so every site update shows up with no reinstall.
set -euo pipefail
cd "$(dirname "$0")"
SDK="/Users/robobootcamp/Library/Android/sdk"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"
BT="$SDK/build-tools/36.0.0"
rm -rf build/classes build/dex build/res.zip build/base.apk; mkdir -p build/classes build/dex build/keys
if [ ! -f build/keys/debug.keystore ]; then
  ( umask 077; openssl rand -hex 16 > build/keys/password
    keytool -genkeypair -keystore build/keys/debug.keystore -storepass "$(cat build/keys/password)" \
      -alias gather -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Gather" >/dev/null 2>&1 )
fi
javac -source 11 -target 11 -cp "$ANDROID_JAR" -d build/classes app/src/local/gather/*.java 2>&1 | grep -v warning || true
"$BT/d8" --lib "$ANDROID_JAR" --output build/dex build/classes/local/gather/*.class
"$BT/aapt2" compile --dir app/res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$ANDROID_JAR" --manifest app/AndroidManifest.xml --min-sdk-version 24 --target-sdk-version 36 --version-code $(( ($(date +%s)-1762300000)/60 )) --version-name 1.0 --auto-add-overlay build/res.zip
cp build/base.apk build/unsigned.apk
zip -qj build/unsigned.apk build/dex/classes.dex
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks build/keys/debug.keystore --ks-pass file:build/keys/password --out build/gather.apk build/aligned.apk
"$BT/apksigner" verify build/gather.apk && ls -lh build/gather.apk
