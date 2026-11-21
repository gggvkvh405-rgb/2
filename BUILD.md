# ByAzen — сборка приложения

В репозитории лежит **готовое к работе приложение** (`app/`) и обёртки для всех платформ.
Ниже — три пути: запустить сразу, установить как приложение, собрать `.exe` и `.apk`.

---

## 0. Быстрый запуск (без сборки)

```bash
npm run serve        # или: python3 -m http.server 4173 --bind 0.0.0.0
```

- Приложение: `http://localhost:4173/app/index.html`  (корень `/` перенаправляет туда же)
- Бренд-презентация: `http://localhost:4173/concept.html`

Телефон в той же сети: `http://<IP-компьютера>:4173/app/index.html`

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
