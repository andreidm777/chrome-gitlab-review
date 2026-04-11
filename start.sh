#!/bin/bash
# start.sh - Быстрый запуск тестовой среды

set -e

echo "🚀 Запуск тестовой среды GitLab MR Reviewer"
echo ""

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не найден. Установите Docker:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose не найден. Установите Docker Compose:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

COMPOSE_CMD="docker-compose"
if docker compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
fi

# Добавление в hosts
if grep -q "gitlab.local" /etc/hosts 2>/dev/null; then
    echo "✅ gitlab.local уже в /etc/hosts"
else
    echo "📝 Добавление gitlab.local в /etc/hosts..."
    echo "127.0.0.1 gitlab.local" | sudo tee -a /etc/hosts > /dev/null
    echo "✅ Добавлено"
fi

# Запуск GitLab
if [ "$(docker ps -q -f name=gitlab-test 2>/dev/null)" ]; then
    echo "✅ GitLab уже запущен"
else
    echo "🐳 Запуск GitLab..."
    $COMPOSE_CMD up -d
    echo "✅ GitLab запущен"
fi

echo ""
echo "⏳ GitLab загружается (это может занять 2-5 минут)..."
echo "   Запуск настройки..."
echo ""

# Запуск скрипта настройки
bash setup-gitlab.sh
