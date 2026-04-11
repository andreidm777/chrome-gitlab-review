# 🔍 GitLab MR AI Reviewer

Chrome extension для AI-powered ревью кода в GitLab Merge Requests с поддержкой любой LLM через OpenAI-совместимый протокол.

## 🚀 Быстрый старт (тестирование)

### 1. Запусти тестовую среду

```bash
# Запуск GitLab + создание тестового MR с багами
./start.sh
```

Скрипт автоматически:
- Поднимет GitLab CE в Docker
- Создаст тестовый проект с намеренными багами
- Создаст MR с "исправлениями" (и новыми багами)
- Выведет URL для тестирования

### 2. Установи расширение в Chrome

1. Открой `chrome://extensions/`
2. Включи **Developer mode** (справа сверху)
3. Нажми **Load unpacked**
4. Выбери папку `chrome-mr-plug`

### 3. Настрой LLM

Кликни на иконку расширения и настрой подключение:

**Пример с Ollama (локально, бесплатно):**
```
API Base URL: http://localhost:11434/v1
API Key: (оставь пустым)
Model: llama3.1:70b
```

**Пример с OpenAI:**
```
API Base URL: https://api.openai.com/v1
API Key: sk-...
Model: gpt-4o
```

### 4. Протестируй

1. Открой MR в браузере (URL будет выведен после `./start.sh`)
2. Найди кнопку **🤖 AI Review** в шапке MR
3. Нажми и дождись ревью!

### Остановка

```bash
./stop.sh
```

## Возможности

- ✅ Автоматическое обнаружение страниц Merge Request в GitLab
- ✅ Интеграция с **любой LLM** через OpenAI API протокол (OpenAI, Ollama, vLLM, LM Studio, и др.)
- ✅ Работа с **любой установкой GitLab** (корпоративные сервера, gitlab.com)
- ✅ Получение diff через GitLab API
- ✅ Настраиваемые промпты для ревью
- ✅ Красивый UI с тёмной темой
- ✅ Поддержка Markdown в результатах

## Установка

### 1. Загрузите расширение в Chrome

1. Откройте Chrome и перейдите на `chrome://extensions/`
2. Включите **Developer mode** (переключатель в правом верхнем углу)
3. Нажмите **Load unpacked**
4. Выберите папку с расширением (`chrome-mr-plug`)

### 2. Настройте подключение к LLM

1. Кликните на иконку расширения в панели инструментов
2. В настройках укажите:
   - **API Base URL** - URL к OpenAI-совместимому API
   - **API Key** - ключ авторизации (если требуется)
   - **Model** - название модели
3. Нажмите **Test Connection** для проверки
4. Нажмите **Save Settings**

### 3. Получите GitLab Token (если требуется)

Для доступа к приватным репозиториям нужен GitLab Personal Access Token:

1. В GitLab перейдите в **User Settings** → **Access Tokens**
2. Создайте токен с правом `read_api`
3. Токен автоматически подхватится из сессии GitLab

> **Примечание:** Если вы авторизованы в GitLab, расширение попытается использовать вашу сессию. Для приватных инстансов может потребоваться явный токен.

## Настройка LLM

### OpenAI

```
API Base URL: https://api.openai.com/v1
API Key: sk-...
Model: gpt-4o
```

### Ollama (локальная)

```
API Base URL: http://localhost:11434/v1
API Key: (оставьте пустым)
Model: llama3.1:70b
```

### vLLM

```
API Base URL: http://your-vllm-server:8000/v1
API Key: (ваш ключ или оставьте пустым)
Model: meta-llama/Meta-Llama-3-70B-Instruct
```

### LM Studio

```
API Base URL: http://localhost:1234/v1
API Key: (оставьте пустым)
Model: (название загруженной модели)
```

### Другие совместимые API

Любой сервис, поддерживающий `/chat/completions` endpoint в формате OpenAI:
- Together AI
- OpenRouter
- Azure OpenAI (с соответствующим URL)
- Локальные серверы (text-generation-webui, tabby, и др.)

## Использование

1. Откройте любой Merge Request в GitLab
2. В шапке MR появится кнопка **🤖 AI Review**
3. Нажмите на неё и дождитесь результата
4. AI проанализирует diff и выдаст ревью

## Структура проекта

```
chrome-mr-plug/
├── manifest.json       # Манифест расширения (V3)
├── background.js       # Service Worker (API вызовы)
├── content.js          # Content Script (инжект на страницу)
├── styles.css          # Стили для UI расширения
├── popup.html          # UI попапа настроек
├── popup.js            # Логика попапа
├── icons/              # Иконки расширения
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate_icons.py
└── README.md           # Этот файл
```

## Настройка промпта

По умолчанию используется промпт, который просит AI фокусироваться на:
- Багах и логических ошибках
- Уязвимостях безопасности
- Проблемах производительности
- Качестве кода
- Конкретных предложениях по улучшению

Вы можете задать свой промпт в настройках расширения.

## Ограничения

- **Размер diff:** По умолчанию ограничен 5000 строк (настраивается)
- **Токены:** Большие MR могут превысить лимит токенов вашей модели
- **Приватные репозитории:** Может потребоваться GitLab Personal Access Token

## Разработка

### Перезагрузка расширения

1. Перейдите на `chrome://extensions/`
2. Найдите "GitLab MR AI Reviewer"
3. Нажмите иконку обновления 🔄

### Отладка

- **Content script:** Откройте DevTools страницы GitLab → Console
- **Background script:** `chrome://extensions/` → Details → Service Worker
- **Popup:** Откройте popup, ПКМ → Inspect

## Лицензия

MIT

## Безопасность

- API ключи хранятся только в локальном хранилище Chrome
- Все запросы идут напрямую с вашего компьютера
- Никакие данные не отправляются на сторонние серверы (кроме выбранной LLM)
