# ByAzen — сервер, .exe и .apk

Приложение теперь сетевое: клиент + сервер в этом же репозитории.
Сначала поднимите сервер, потом собирайте оболочки.

## 0. Сервер (обязательно)

```bash
npm install
npm start          # http://localhost:8080/app/index.html
```

Проверка: `curl http://localhost:8080/api/health` → `{"ok":true,...}`

Локальная сеть: друг открывает `http://<IP-компьютера>:8080` (в той же Wi-Fi).
Интернет: задеплойте на Render (`render.yaml` в репозитории), Fly.io, Railway или VPS.
Docker: `docker build -t byazen . && docker run -p 8080:8080 -v byazen-data:/data byazen`.

Адрес сервера вводится на экране входа, у вас и у друга — один и тот же.

## 1. Установка как приложение (работает уже сейчас)

| Платформа | Как |
| --- | --- |
| Android (Chrome) | меню ⋮ → «Установить приложение» / «Добавить на главный экран» |
| iOS (Safari) | «Поделиться» → «На экран Домой» |
| Windows / macOS / Linux (Chrome, Edge) | иконка установки в адресной строке → «Установить» |

Появляется иконка ByAzen, приложение открывается в отдельном окне без браузерной панели,
работает офлайн (service worker). На ПК также доступна кнопка установки в левом рельсе.

## 2. Сборка `.exe` (Windows) — Electron

```bash
npm install
npm start                 # запустить десктоп-версию локально
npm run dist:win          # → release/ByAzen-Setup-1.0.0.exe + portable .exe
```

Что получится:
- `ByAzen-Setup-1.0.0.exe` — установщик NSIS (ярлыки на рабочем столе и в меню «Пуск»);
- `ByAzen-1.0.0-portable.exe` — портативная версия без установки.

macOS / Linux собираются командами `npm run dist:mac` и `npm run dist:linux`.
Кросс-сборка с Linux на Windows требует Wine — проще запустить `npm run dist:win`
на самой Windows-машине (или в GitHub Actions, пример ниже).

## 3. Сборка `.apk` (Android) — Capacitor

Нужны: Node 18+, JDK 17, Android Studio (или Android SDK + Gradle).

```bash
npm install
npx cap add android          # один раз: создаёт папку android/
npx cap sync android         # подтягивает app/ и иконки

# вариант A — из Android Studio
npx cap open android         # Build → Build Bundle(s)/APK(s) → Build APK(s)

# вариант B — из консоли
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk

# релизная подпись
cd android && ./gradlew bundleRelease
```

Перед релизом задайте подпись в `android/app/build.gradle` (keystore) —
иначе Google Play не примет AAB.

## 4. Данные и приватность

- Переписка хранится в `localStorage` устройства, текст сообщений шифруется
  **AES-256-GCM** ключом, сгенерированным на этом устройстве.
- Резервная копия: Профиль → «Скачать резервную копию» (JSON). Храните бережно:
  копия не зашифрована, чтобы её можно было восстановить после сброса ключа.
- Никаких сетевых запросов приложение не делает: всё локально.

## 5. GitHub Actions (сборка .exe и .apk в облаке)

`.github/workflows/build.yml` уже лежит в репозитории. Пуш в `main` или ручной
запуск (Actions → Build → Run workflow) соберёт артефакты:

- `ByAzen-windows` — `.exe` установщик + portable;
- `ByAzen-android` — `app-debug.apk`.

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm start` | десктоп-версия (Electron) |
| `npm run serve` | локальный сервер для PWA/браузера |
| `npm run dist:win` | `.exe` (NSIS + portable) |
| `npm run dist:mac` / `dist:linux` | `.dmg` / `.AppImage` |
| `npx cap add android` | создать Android-проект |
| `npm run mobile:apk` | собрать debug `.apk` |
| `npm run mobile:aab` | собрать release `.aab` |
