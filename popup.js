// ===== Default prompt (JSON-based, Russian) =====
const defaultPrompt = 'Вы — опытный рецензент кода. Проведите код-ревью диффа из Merge Request в GitLab.\n\n' +
  'Ваша задача:\n' +
  '1. **Найти баги и потенциальные проблемы** — логические ошибки, краевые случаи, race conditions, утечки памяти\n' +
  '2. **Обратить внимание на безопасность** — уязвимости, риски инъекций, утечки данных\n' +
  '3. **Отметить проблемы производительности** — неэффективные алгоритмы, излишняя сложность\n' +
  '4. **Оценить качество кода** — читаемость, поддерживаемость, best practices\n' +
  '5. **Предложить улучшения** — конкретные рекомендации с примерами кода\n\n' +
  'ОЧЕНЬ ВАЖНО: Ответь ТОЛЬКО в формате JSON. Не добавляй ничего кроме JSON. Без markdown обёрток, без текста.\n\n' +
  'Формат JSON:\n' +
  '```\n' +
  '{\n' +
  '  "summary": "Краткое резюме изменений в MR",\n' +
  '  "issues": [\n' +
  '    {\n' +
  '      "title": "Краткое название проблемы",\n' +
  '      "severity": "critical | major | minor | suggestion",\n' +
  '      "description": "Подробное описание проблемы",\n' +
  '      "suggestion": "Рекомендация по исправлению (может быть null)",\n' +
  '      "file": "путь/к/файлу.js",\n' +
  '      "line": 42\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  '```\n\n' +
  'Правила:\n' +
  '- severity: "critical" — баги/утязимости, "major" — проблемы, "minor" — замечания, "suggestion" — улучшения\n' +
  '- "file" и "line" — укажи если проблема в конкретном файле (по диффу видно изменение строк)\n' +
  '- "suggestion" — опиши как исправить (код или текст), может быть null\n' +
  '- Будь конкретен, ссылайся на строчки кода из диффа\n' +
  '- Пиши на русском языке\n' +
  '- Файлы: "old_path" или "new_path" из заголовка диффа (обычно одинаковые)\n\n' +
  'Вот дифф:';

// ===== State =====
let llmProfiles = [];
let activeProfileId = null;

// ===== Helpers =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status show ${type}`;
  setTimeout(() => statusEl.classList.remove('show'), 3000);
}

function resetForm() {
  document.getElementById('profile-id').value = '';
  document.getElementById('profile-name').value = '';
  document.getElementById('api-url').value = '';
  document.getElementById('api-key').value = '';
  document.getElementById('model').value = '';
  document.getElementById('btn-delete-profile').style.display = 'none';
}

// ===== Profiles UI =====
function renderProfilesList() {
  const container = document.getElementById('profiles-list');
  container.innerHTML = '';

  if (llmProfiles.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size:12px;color:#7f849c;padding:8px 0;';
    empty.textContent = 'Нет профилей. Добавьте первый профиль LLM.';
    container.appendChild(empty);
    return;
  }

  llmProfiles.forEach(profile => {
    const item = document.createElement('div');
    const isActive = profile.id === activeProfileId;
    item.className = `profile-item${isActive ? ' active' : ''}`;
    item.dataset.id = profile.id;

    item.innerHTML = `
      <span class="profile-item-name">${escapeHtml(profile.name || profile.model)}</span>
      <span class="profile-item-model">${escapeHtml(profile.model)}</span>
      <button class="btn btn-secondary btn-icon btn-sm btn-delete-profile" title="Удалить">×</button>
    `;

    // Click to select — сначала сохраняем текущий, потом переключаем
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('btn-delete-profile')) return;
      await saveCurrentProfile();
      selectProfile(profile.id);
    });

    // Delete button
    const deleteBtn = item.querySelector('.btn-delete-profile');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProfile(profile.id);
    });

    container.appendChild(item);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function selectProfile(profileId) {
  activeProfileId = profileId;
  const profile = llmProfiles.find(p => p.id === profileId);
  if (!profile) {
    resetForm();
    return;
  }

  document.getElementById('profile-id').value = profile.id;
  document.getElementById('profile-name').value = profile.name || '';
  document.getElementById('api-url').value = profile.apiUrl;
  document.getElementById('api-key').value = profile.apiKey || '';
  document.getElementById('model').value = profile.model;
  document.getElementById('btn-delete-profile').style.display = '';

  renderProfilesList();
}

// ===== Save current profile data (used before switching) =====
async function saveCurrentProfile() {
  if (!activeProfileId) return;
  const profile = llmProfiles.find(p => p.id === activeProfileId);
  if (!profile) return;

  profile.name = document.getElementById('profile-name').value;
  profile.apiUrl = document.getElementById('api-url').value.replace(/\/+$/, '');
  profile.apiKey = document.getElementById('api-key').value;
  profile.model = document.getElementById('model').value;

  await saveData();
  renderProfilesList();
}

function createNewProfile() {
  const id = generateId();
  const newProfile = {
    id,
    name: '',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  };
  llmProfiles.push(newProfile);
  activeProfileId = id;
  renderProfilesList();
  selectProfile(id);
  document.getElementById('profile-name').focus();
}

async function deleteProfile(profileId) {
  const profile = llmProfiles.find(p => p.id === profileId);
  const name = profile ? (profile.name || profile.model) : '';
  if (!confirm(`Удалить профиль "${name}"?`)) return;

  llmProfiles = llmProfiles.filter(p => p.id !== profileId);

  if (activeProfileId === profileId) {
    if (llmProfiles.length > 0) {
      activeProfileId = llmProfiles[0].id;
    } else {
      activeProfileId = null;
      resetForm();
    }
  }

  await saveData();
  renderProfilesList();
}

async function loadFormIntoProfile() {
  if (!activeProfileId) return;

  const profile = llmProfiles.find(p => p.id === activeProfileId);
  if (!profile) return;

  profile.name = document.getElementById('profile-name').value;
  profile.apiUrl = document.getElementById('api-url').value.replace(/\/+$/, '');
  profile.apiKey = document.getElementById('api-key').value;
  profile.model = document.getElementById('model').value;

  renderProfilesList();
}

// ===== Storage =====
async function saveData() {
  await chrome.storage.local.set({
    llmProfiles,
    activeProfileId,
    reviewPrompt: document.getElementById('review-prompt').value || defaultPrompt,
    maxDiffSize: parseInt(document.getElementById('max-diff-size').value, 10) || 10000
  });
}

// ===== Load on DOM ready =====
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get({
    llmProfiles: [],
    activeProfileId: null,
    reviewPrompt: defaultPrompt,
    maxDiffSize: 10000
  });

  llmProfiles = stored.llmProfiles;
  activeProfileId = stored.activeProfileId;

  // Restore global settings
  document.getElementById('review-prompt').value = stored.reviewPrompt === defaultPrompt ? '' : stored.reviewPrompt;
  document.getElementById('max-diff-size').value = stored.maxDiffSize || 10000;

  renderProfilesList();

  // Restore active profile form
  if (activeProfileId && llmProfiles.length > 0) {
    selectProfile(activeProfileId);
  } else if (llmProfiles.length > 0) {
    selectProfile(llmProfiles[0].id);
  } else {
    createNewProfile();
  }
});

// ===== Save button =====
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  await loadFormIntoProfile();
  await saveData();
  showStatus('Настройки сохранены!', 'success');
});

// ===== Add profile button =====
document.getElementById('add-profile').addEventListener('click', () => {
  createNewProfile();
  showStatus('Новый профиль создан', 'success');
});

// ===== Delete profile button =====
document.getElementById('btn-delete-profile').addEventListener('click', () => {
  if (activeProfileId) {
    deleteProfile(activeProfileId);
  }
});

// ===== Test connection =====
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

// ===== Live-save global fields on change =====
document.getElementById('review-prompt').addEventListener('change', async () => {
  await saveData();
});

document.getElementById('max-diff-size').addEventListener('change', async () => {
  await saveData();
});

// ===== Live-save profile fields on change =====
['profile-name', 'api-url', 'api-key', 'model'].forEach(id => {
  document.getElementById(id).addEventListener('change', async () => {
    await saveCurrentProfile();
  });
});
