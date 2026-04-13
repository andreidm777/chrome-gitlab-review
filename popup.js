const defaults = {
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  reviewPrompt: '',
  maxDiffSize: 5000
};

const defaultPrompt = `Вы — опытный рецензент кода. Проведите код-ревью диффа из Merge Request в GitLab.

Ваша задача:
1. **Найти баги и потенциальные проблемы** — логические ошибки, краевые случаи, race conditions, утечки памяти
2. **Обратить внимание на безопасность** — уязвимости, риски инъекций, утечки данных
3. **Отметить проблемы производительности** — неэффективные алгоритмы, излишняя сложность
4. **Оценить качество кода** — читаемость, поддерживаемость, best practices
5. **Предложить улучшения** — конкретные рекомендации с примерами кода

Форматируйте ответ в markdown. Будьте кратки, но подробны. Фокусируйтесь на существенных проблемах, а не на предпочтениях по стилю.`;

// Load saved settings on popup open
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.local.get(defaults);

  document.getElementById('api-url').value = settings.apiUrl;
  document.getElementById('api-key').value = settings.apiKey;
  document.getElementById('model').value = settings.model;
  document.getElementById('review-prompt').value = settings.reviewPrompt || '';
  document.getElementById('max-diff-size').value = settings.maxDiffSize;
});

// Save settings
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = {
    apiUrl: document.getElementById('api-url').value.replace(/\/+$/, ''), // Remove trailing slashes
    apiKey: document.getElementById('api-key').value,
    model: document.getElementById('model').value,
    reviewPrompt: document.getElementById('review-prompt').value || defaultPrompt,
    maxDiffSize: parseInt(document.getElementById('max-diff-size').value, 10) || 5000
  };

  await chrome.storage.local.set(settings);
  showStatus('Настройки сохранены!', 'success');
});

// Test connection
document.getElementById('btn-test').addEventListener('click', async () => {
  const apiUrl = document.getElementById('api-url').value.replace(/\/+$/, '');
  const apiKey = document.getElementById('api-key').value;
  const model = document.getElementById('model').value;

  if (!apiUrl || !model) {
    showStatus('Пожалуйста, заполните API URL и модель', 'error');
    return;
  }

  showStatus('Проверка соединения...', 'success');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'test-llm-connection',
      payload: { apiUrl, apiKey, model }
    });

    if (response.success) {
      showStatus('Соединение успешно!', 'success');
    } else {
      showStatus(`Ошибка: ${response.error}`, 'error');
    }
  } catch (err) {
    showStatus(`Ошибка: ${err.message}`, 'error');
  }
});

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status show ${type}`;

  setTimeout(() => {
    statusEl.classList.remove('show');
  }, 3000);
}
