# 白纸（Baizhi）

无限白纸风格待办 · 本地 · Apple-like UI

- App ID: `com.sykin.baizhi`
- Stack: Vite (vanilla) + Capacitor 7 Android
- APK: `/workspace/baizhi-v1-debug.apk`

## Dev
```bash
cd /workspace/baizhi
npm install
npm run dev          # browser
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

JDK 21 + Android SDK 35 required for APK build (see parent report).
