# Chrome GitLab Review — Проект контекста

## Обзор проекта

**Chrome GitLab Review** — расширение Chrome для AI-powered ревью кода в GitLab Merge Requests. Расширение автоматически обнаруживает страницы MR, извлекает diff через GitLab API и отправляет его на анализ любой LLM, совместимой с OpenAI API (OpenAI, Ollama, vLLM, LM Studio и др.).

### Основные возможности

- ✅ Автоматическое обнаружение страниц Merge Request в GitLab
- ✅ Интеграция с **любой LLM** через OpenAI API протокол
- ✅ Работа с **любой установкой GitLab** (корпоративные сервера, gitlab.com)
- ✅ Получение diff и метаданных MR через GitLab API
- ✅ Настраиваемые промпты для ревью
- ✅ Красивый UI с тёмной темой и поддержкой Markdown
- ✅ Тестовая среда для разработки (GitLab CE в Docker)

### Технологический стек

| Категория | Технологии |
|-----------|------------|
| Платформа | Chrome Extension (Manifest V3) |
| Языки | JavaScript, HTML, CSS |
| API | GitLab REST API v4, OpenAI-compatible Chat API |
| Тестирование | Docker, GitLab CE |
| UI | Vanilla JS, кастомные стили |

---

## Структура проекта

```
chrome-gitlab-review/
├── manifest.json       # Манифест расширения (V3)
├── background.js       # Service Worker: API вызовы к GitLab и LLM
├── content.js          # Content Script: инжект UI, детекция MR страниц
├── popup.html          # UI попапа настроек
├── popup.js            # Логика попапа (сохранение, тестирование подключения)
├── styles.css          # Стили для AI Review кнопок и панелей
├── icons/              # Иконки расширения
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate_icons.py  # Скрипт генерации иконок
├── docker-compose.yml  # Конфигурация GitLab CE для тестирования
├── setup-gitlab.sh     # Скрипт настройки тестового проекта и MR
├── start.sh            # Запуск тестовой среды
├── stop.sh             # Остановка тестовой среды
├── README.md           # Документация пользователя
└── QWEN.md             # Этот файл
```

---

## Архитектура

### Компоненты расширения

#### 1. **background.js** (Service Worker)
- Обработка сообщений от content script и popup
- Извлечение информации о MR из URL GitLab
- Вызов GitLab API для получения diff и метаданных MR
- Отправка diff на LLM для анализа
- Тестирование подключения к LLM

#### 2. **content.js** (Content Script)
- Детекция страниц Merge Request по URL паттерну
- Извлечение GitLab token из страницы (meta tags, localStorage)
- Инжект UI: кнопка "🤖 AI Review" и панель результатов
- Рендеринг Markdown в HTML
- Обработка событий навигации (SPA behavior)

#### 3. **popup.html/js** (Options Popup)
- Настройка подключения к LLM (API URL, ключ, модель)
- Кастомизация промпта для ревью
- Тестирование подключения
- Сохранение настроек в `chrome.storage.local`

### Поток данных

```
1. Пользователь открывает MR в GitLab
2. content.js детектирует MR и добавляет кнопку "🤖 AI Review"
3. Пользователь нажимает кнопку
4. background.js получает diff через GitLab API (/api/v4/projects/:id/merge_requests/:iid/diffs)
5. background.js отправляет diff на LLM endpoint (/chat/completions)
6. Результат возвращается в content.js и рендерится в панели
```

---

## Разработка и запуск

### Установка расширения

1. Откройте `chrome://extensions/`
2. Включите **Developer mode** (справа сверху)
3. Нажмите **Load unpacked**
4. Выберите папку проекта

### Тестовая среда (для разработки)

```bash
# Запуск тестовой среды (GitLab + тестовый MR с багами)
./start.sh

# Остановка
./stop.sh
```

Скрипт `start.sh` автоматически:
- Поднимает GitLab CE в Docker
- Добавляет `gitlab.local` в `/etc/hosts`
- Создаёт тестовый проект с намеренными багами
- Создаёт MR для тестирования

### Настройка LLM

Расширение поддерживает **любой OpenAI-compatible API**:

**Ollama (локально, бесплатно):**
```
API Base URL: http://localhost:11434/v1
API Key: (оставьте пустым)
Model: llama3.1:70b
```

**OpenAI:**
```
API Base URL: https://api.openai.com/v1
API Key: sk-...
Model: gpt-4o
```

**LM Studio:**
```
API Base URL: http://localhost:1234/v1
Model: (название модели)
```

### Переменные окружения расширения

Настройки хранятся в `chrome.storage.local`:

| Ключ | Значение по умолчанию | Описание |
|------|----------------------|----------|
| `apiUrl` | `https://api.openai.com/v1` | Endpoint LLM API |
| `apiKey` | `` | API ключ авторизации |
| `model` | `gpt-4o` | Название модели |
| `reviewPrompt` | `` | Кастомный промпт (используется дефолтный) |
| `maxDiffSize` | `5000` | Максимальный размер diff в строках |

---

## API интеграции

### GitLab API

**Получение diff MR:**
```http
GET /api/v4/projects/:id/merge_requests/:iid/diffs
Headers: PRIVATE-TOKEN: <token>
```

**Получение метаданных MR:**
```http
GET /api/v4/projects/:id/merge_requests/:iid
Headers: PRIVATE-TOKEN: <token>
```

### LLM API (OpenAI-compatible)

**Тестирование подключения:**
```http
POST /chat/completions
Content-Type: application/json
Authorization: Bearer <key>

{
  "model": "<model>",
  "messages": [{"role": "user", "content": "Say 'ok' in exactly one word."}],
  "max_tokens": 10
}
```

**Анализ кода:**
```http
POST /chat/completions
Content-Type: application/json

{
  "model": "<model>",
  "messages": [
    {"role": "system", "content": "You are a helpful code review assistant."},
    {"role": "user", "content": "<prompt> + <context> + <diff>"}
  ],
  "temperature": 0.3,
  "max_tokens": 4096
}
```

---

## Конвенции разработки

### Стиль кода

- **JavaScript:** Vanilla JS без фреймворков
- **CSS:** CSS Variables не используются, кастомные стили для тёмной темы через `@media (prefers-color-scheme: dark)`
- **Именование:** camelCase для JS, kebab-case для CSS классов
- **Комментарии:** JSDoc-style для основных функций

### Обработка ошибок

- Ошибки API возвращаются в ответе с `success: false` и полем `error`
- UI показывает ошибки в красной панели с подсказками
- Diff ограничивается 5000 строками по умолчанию для избежания лимитов токенов

### Безопасность

- API ключи хранятся только в локальном хранилище Chrome (`chrome.storage.local`)
- Запросы к LLM идут напрямую с устройства пользователя
- GitLab token извлекается из сессии браузера (не передаётся на сторонние серверы)
- Для приватных репозиториев требуется Personal Access Token с правами `read_api`

---

## Отладка

### Content Script
```javascript
// Откройте DevTools на странице GitLab → Console
console.log('Content script loaded');
```

### Service Worker
```
chrome://extensions/ → Details → Service Worker → Inspect
```

### Popup
```
chrome://extensions/ → Inspect Views: Options
```

---

## Утилиты

### Генерация иконок

```bash
python3 icons/generate_icons.py
```

Создаёт `icon16.png`, `icon48.png`, `icon128.png` с градиентом и иконкой лупы.

### Docker (тестовая среда)

```bash
# Проверка Docker
docker --version

# Запуск GitLab
docker-compose up -d

# Просмотр логов
docker logs -f gitlab-test

# Очистка данных
docker-compose down -v
```

---

## Troubleshooting

### Проблема: Кнопка "🤖 AI Review" не появляется

**Решение:** Проверьте консоль content script на наличие ошибок. Убедитесь, что URL соответствует паттерну `/:project/-/merge_requests/:id`.

### Проблема: Ошибка доступа к GitLab API

**Решение:** Для приватных репозиториев настройте Personal Access Token в настройках расширения (User Settings → Access Tokens в GitLab).

### Проблема: LLM API возвращает ошибку

**Решение:** Используйте кнопку "Test Connection" в popup для диагностики. Проверьте URL, ключ и название модели.

### Проблема: Diff слишком большой

**Решение:** Увеличьте `maxDiffSize` в настройках или используйте модель с большим контекстом.

---

## Лицензия

MIT
