const defaults = {
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  reviewPrompt: '',
  maxDiffSize: 5000
};

const defaultPrompt = `You are an expert code reviewer. Review the following diff from a GitLab Merge Request.

Your review should:
1. **Identify bugs and potential issues** - Logic errors, edge cases, race conditions, memory leaks
2. **Security concerns** - Vulnerabilities, injection risks, data exposure
3. **Performance issues** - Inefficient algorithms, unnecessary complexity
4. **Code quality** - Readability, maintainability, best practices
5. **Suggestions** - Concrete improvement suggestions with code examples

Format your response in markdown. Be concise but thorough. Focus on meaningful issues, not style preferences.

Here's the diff:`;

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
  showStatus('Settings saved successfully!', 'success');
});

// Test connection
document.getElementById('btn-test').addEventListener('click', async () => {
  const apiUrl = document.getElementById('api-url').value.replace(/\/+$/, '');
  const apiKey = document.getElementById('api-key').value;
  const model = document.getElementById('model').value;

  if (!apiUrl || !model) {
    showStatus('Please fill in API URL and Model', 'error');
    return;
  }

  showStatus('Testing connection...', 'success');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'test-llm-connection',
      payload: { apiUrl, apiKey, model }
    });

    if (response.success) {
      showStatus('Connection successful!', 'success');
    } else {
      showStatus(`Connection failed: ${response.error}`, 'error');
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
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
