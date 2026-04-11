#!/bin/bash
# stop.sh - Остановка тестовой среды

echo "🛑 Остановка GitLab..."
docker-compose down
echo "✅ Остановлено"
echo ""
echo "💡 Для полного удаления данных:"
echo "   docker-compose down -v"
