#!/bin/bash
# setup-gitlab.sh - Настройка тестового GitLab: создание проекта, пользователя и MR

set -e

GITLAB_URL="http://gitlab.local"
API_URL="${GITLAB_URL}/api/v4"
ROOT_TOKEN="password123"

echo "🔧 Настройка тестового GitLab..."

# Функция для ожидания готовности GitLab
wait_for_gitlab() {
    echo "⏳ Ожидание готовности GitLab..."
    for i in $(seq 1 60); do
        if curl -s "${API_URL}/version" > /dev/null 2>&1; then
            echo "✅ GitLab готов!"
            return 0
        fi
        echo "   Попытка $i/60..."
        sleep 10
    done
    echo "❌ GitLab не ответил в течение 10 минут"
    exit 1
}

# Ждём готовности
wait_for_gitlab

# Получаем root токен через сессию (GitLab CE позволяет логиниться по умолчанию)
echo "📝 Авторизация..."
ROOT_PASSWORD="password123"

# Создаём Personal Access Token для root через UI API
# Сначала получаем CSRF токен
CSRF_TOKEN=$(curl -s -c /tmp/gitlab_cookies.txt "${GITLAB_URL}/users/sign_in" | grep 'csrf-token' | sed 's/.*content="\([^"]*\)".*/\1/')

# Логинимся
curl -s -b /tmp/gitlab_cookies.txt -c /tmp/gitlab_cookies.txt \
    -X POST "${GITLAB_URL}/users/sign_in" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "authenticity_token=${CSRF_TOKEN}&user[login]=root&user[password]=${ROOT_PASSWORD}" \
    -L > /dev/null

# Создаём Personal Access Token
echo "🔑 Создание Personal Access Token..."
PAT_RESPONSE=$(curl -s -b /tmp/gitlab_cookies.txt -c /tmp/gitlab_cookies.txt \
    -X POST "${GITLAB_URL}/-/user_settings/personal_access_tokens" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "personal_access_token[name]=test-token&personal_access_token[scopes][]=api&personal_access_token[scopes][]=read_repository&personal_access_token[expires_at]=")

# Извлекаем токен из ответа (он может быть в HTML или JSON)
# Альтернативный способ - используем стандартный подход через API с initial_root_password
# В новых версиях GitLab initial_root_password работает только для первого логина

# Пробуем получить токен через GraphQL или другой метод
# Если не получилось, используем обходной путь через создание токена напрямую в БД

echo "⚠️  Создание токена через UI может быть нестабильным..."
echo "💡 Альтернатива: создадим токен через Rails консоль"

# Создаём токен через exec
TOKEN=$(docker exec gitlab-test gitlab-rails runner "
    user = User.find_by(username: 'root')
    token = user.personal_access_tokens.create(
      name: 'test-token',
      scopes: ['api', 'read_repository', 'write_repository']
    )
    puts token.token
" 2>/dev/null | tail -1)

if [ -z "$TOKEN" ]; then
    echo "❌ Не удалось создать токен"
    echo "💡 Попробуйте создать токен вручную:"
    echo "   1. Зайдите в http://gitlab.local"
    echo "   2. Логин: root, Пароль: password123"
    echo "   3. User Settings → Access Tokens → Create token (scopes: api)"
    exit 1
fi

echo "✅ Токен создан: ${TOKEN:0:10}..."

# Создаём тестовый проект
echo "📁 Создание тестового проекта..."
PROJECT=$(curl -s --request POST "${API_URL}/projects" \
    --header "PRIVATE-TOKEN: ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data '{
        "name": "test-project",
        "description": "Тестовый проект для проверки расширения",
        "visibility": "public",
        "initialize_with_readme": true
    }')

PROJECT_ID=$(echo "$PROJECT" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$PROJECT_ID" ]; then
    echo "❌ Не удалось создать проект"
    echo "Ответ API: $PROJECT"
    exit 1
fi

echo "✅ Проект создан (ID: ${PROJECT_ID})"

# Создаём файл с багами для ревью
echo "📝 Создание тестовых файлов с намеренными проблемами..."

curl -s --request POST "${API_URL}/projects/${PROJECT_ID}/repository/commits" \
    --header "PRIVATE-TOKEN: ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data '{
        "branch": "main",
        "commit_message": "Add buggy code for review",
        "actions": [
            {
                "action": "create",
                "file_path": "app.py",
                "content": "import os\nimport subprocess\nfrom flask import Flask, request\n\napp = Flask(__name__)\n\n# Баг: SQL инъекция\ndef get_user(username):\n    query = \"SELECT * FROM users WHERE username = '\" + username + \"'\"\n    return query\n\n# Баг: Command injection\n@app.route(\"/exec\")\ndef execute():\n    cmd = request.args.get(\"cmd\", \"\")\n    result = subprocess.call(cmd, shell=True)\n    return str(result)\n\n# Баг: Hardcoded secret\nSECRET_KEY = \"super_secret_key_123\"\nAPI_TOKEN = \"sk-1234567890abcdef\"\n\n# Баг: No input validation\n@app.route(\"/read\")\ndef read_file():\n    path = request.args.get(\"path\", \"\")\n    with open(path, \"r\") as f:\n        return f.read()\n\n# Баг: Race condition\ncounter = 0\n\ndef increment():\n    global counter\n    counter += 1\n    return counter\n\n# Баг: Resource leak\ndef read_data(filename):\n    f = open(filename, \"r\")\n    data = f.read()\n    return data\n\n# Баг: Division by zero\ndef calculate_average(numbers):\n    total = sum(numbers)\n    return total / len(numbers)\n\nif __name__ == \"__main__\":\n    app.run(debug=True)\n"
            }
        ]
    }' > /dev/null

echo "✅ Файл app.py создан"

# Создаём feature branch
curl -s --request POST "${API_URL}/projects/${PROJECT_ID}/repository/branches" \
    --header "PRIVATE-TOKEN: ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data '{
        "branch": "feature/bugfix",
        "ref": "main"
    }' > /dev/null

# Создаём изменённый файл с "исправлениями" (но с новыми багами)
curl -s --request POST "${API_URL}/projects/${PROJECT_ID}/repository/commits" \
    --header "PRIVATE-TOKEN: ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data '{
        "branch": "feature/bugfix",
        "commit_message": "Fix some bugs but introduce new ones",
        "actions": [
            {
                "action": "update",
                "file_path": "app.py",
                "content": "import os\nimport subprocess\nfrom flask import Flask, request\nimport sqlite3\n\napp = Flask(__name__)\n\n# Исправлено: используем параметризованный запрос, но есть баг\ndef get_user(username):\n    conn = sqlite3.connect(\"database.db\")\n    cursor = conn.cursor()\n    cursor.execute(\"SELECT * FROM users WHERE username = ?\", (username,))\n    return cursor.fetchone()\n    # Баг: соединение не закрывается\n\n# Баг: всё ещё уязвимо, но обфусцировано\n@app.route(\"/exec\")\ndef execute():\n    cmd = request.args.get(\"cmd\", \"\")\n    # Пытаемся \"защитить\", но неэффективно\n    if \"rm\" not in cmd:\n        result = subprocess.call(cmd, shell=True)\n        return str(result)\n    return \"Blocked\"\n\n# Улучшено: загружаем из env, но нет fallback\nSECRET_KEY = os.environ[\"SECRET_KEY\"]  # Баг: KeyError если нет переменной\nAPI_TOKEN = os.environ.get(\"API_TOKEN\", \"default_token_here\")\n\n# Исправлено: ограничиваем пути\nALLOWED_DIR = \"/tmp/safe\"\n\n@app.route(\"/read\")\ndef read_file():\n    path = request.args.get(\"path\", \"\")\n    full_path = os.path.join(ALLOWED_DIR, path)\n    # Баг: path traversal всё ещё возможен через ..\n    with open(full_path, \"r\") as f:\n        return f.read()\n\n# Баг: всё ещё race condition + non-atomic operation\ncounter = 0\n\ndef increment():\n    global counter\n    temp = counter + 1\n    counter = temp\n    return counter\n\n# Исправлено: используем with, но нет обработки ошибок\ndef read_data(filename):\n    with open(filename, \"r\") as f:\n        data = f.read()\n    return data\n\n# Исправлено: проверка на ноль, но неправильная\ndef calculate_average(numbers):\n    if len(numbers) > 0:\n        total = sum(numbers)\n        return total / len(numbers)\n    return None  # Баг: лучше вернуть 0 или бросить исключение\n\n# Новый баг: XSS\n@app.route(\"/greet\")\ndef greet():\n    name = request.args.get(\"name\", \"World\")\n    return f\"<h1>Hello, {name}!</h1>\"\n\n# Новый баг: SSRF\n@app.route(\"/fetch\")\ndef fetch_url():\n    url = request.args.get(\"url\", \"\")\n    import urllib.request\n    response = urllib.request.urlopen(url)\n    return response.read()\n\nif __name__ == \"__main__\":\n    # Баг: debug=True в production\n    app.run(debug=True, host=\"0.0.0.0\")\n"
            },
            {
                "action": "create",
                "file_path": "utils.py",
                "content": "import pickle\nimport json\n\n# Баг: Deserialization vulnerability\ndef load_data(data):\n    return pickle.loads(data)\n\n# Баг: JSON инъекция через eval\ndef parse_json(text):\n    return eval(text)\n\n# Баг: нет валидации\ndef divide(a, b):\n    return a / b\n\n# Баг: хардкод путей\ndef get_config():\n    with open(\"/etc/myapp/config.json\", \"r\") as f:\n        return json.load(f)\n"
            }
        ]
    }' > /dev/null

echo "✅ Изменения в feature branch созданы"

# Создаём Merge Request
echo "🔄 Создание Merge Request..."
MR_RESPONSE=$(curl -s --request POST "${API_URL}/projects/${PROJECT_ID}/merge_requests" \
    --header "PRIVATE-TOKEN: ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data '{
        "source_branch": "feature/bugfix",
        "target_branch": "main",
        "title": "Fix bugs and improve security",
        "description": "This MR fixes several security issues and improves code quality.\n\nChanges:\n- Fixed SQL injection\n- Improved secret management\n- Fixed resource leaks\n\nPlease review."
    }')

MR_IID=$(echo "$MR_RESPONSE" | grep -o '"iid":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$MR_IID" ]; then
    echo "❌ Не удалось создать MR"
    echo "Ответ API: $MR_RESPONSE"
    exit 1
fi

echo ""
echo "🎉 Тестовая среда готова!"
echo ""
echo "📋 Информация:"
echo "   GitLab URL: ${GITLAB_URL}"
echo "   Логин: root"
echo "   Пароль: ${ROOT_PASSWORD}"
echo "   Проект: test-project (ID: ${PROJECT_ID})"
echo "   MR URL: ${GITLAB_URL}/root/test-project/-/merge_requests/${MR_IID}"
echo "   API Token: ${TOKEN}"
echo ""
echo "🔧 Для тестирования расширения:"
echo "   1. Добавьте '127.0.0.1 gitlab.local' в /etc/hosts"
echo "   2. Откройте MR в браузере: ${GITLAB_URL}/root/test-project/-/merge_requests/${MR_IID}"
echo "   3. Нажмите кнопку '🤖 AI Review'"
echo ""
