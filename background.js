// ===== JSON Parsing Helpers =====

/**
 * Extract JSON from LLM response. Handles markdown-wrapped JSON, extra text, etc.
 * Returns parsed object or null if parsing fails.
 */
function parseReviewJSON(text) {
  if (!text) return null;

  // If already valid JSON, return it
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {
    // Not valid JSON yet
  }

  // Try to extract JSON from markdown code blocks: ```json ... ``` or ``` ... ```
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
  const codeBlockMatch = text.match(codeBlockRegex);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {
      // Not valid JSON in code block
    }
  }

  // Try to find JSON object by matching { ... }
  // Find first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {
      // Not valid JSON in braces
    }
  }

  return null;
}

// ===== GitLab API Integration =====

/**
 * Extract GitLab info from the current page URL
 */
function extractGitLabInfo(tabUrl) {
  const url = new URL(tabUrl);
  const basePath = url.pathname;

  // Match patterns like /namespace/project/-/merge_requests/123
  const mrRegex = /(.+)\/-\/merge_requests\/(\d+)/;
  const match = basePath.match(mrRegex);

  if (!match) {
    return null;
  }

  const fullProjectPath = match[1].substring(1); // Remove leading /
  return {
    baseUrl: url.protocol + '//' + url.host,
    projectPath: fullProjectPath, // Remove leading /
    projectId: encodeURIComponent(fullProjectPath), // URL encoded for API
    mergeRequestIid: match[2]
  };
}

/**
 * Check if URL is a GitLab MR page
 */
function isGitLabMRPage(url) {
  return /\/-\/merge_requests\/\d+/.test(new URL(url).pathname);
}

// ===== LLM Integration (OpenAI-compatible) =====

/**
 * Test LLM connection with a simple request
 */
async function testLLMConnection({ apiUrl, apiKey, model }) {
  const url = apiUrl + '/chat/completions';

  const body = {
    model: model,
    messages: [{ role: 'user', content: 'Say "ok" in exactly one word.' }],
    max_tokens: 10
  };

  const headers = new Headers();
  headers.append('Content-Type', 'application/json; charset=utf-8');
  if (apiKey) {
    // Clean apiKey to ensure it's ASCII-only
    const cleanApiKey = String(apiKey).replace(/[^\x00-\x7F]/g, '');
    headers.append('Authorization', 'Bearer ' + cleanApiKey);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error('LLM API error: ' + response.status + ' - ' + error);
  }

  return true;
}

/**
 * Build messages array for LLM API call (without sending)
 */
function buildMessages(diffText, settings, mrDetails) {
  const { reviewPrompt, maxDiffSize } = settings;

  // Split diff into chunks
  const chunks = chunkText(diffText, maxDiffSize);

  // Build context from MR details
  let contextInfo = '';
  if (mrDetails) {
    contextInfo = 'MR Title: ' + mrDetails.title + '\n';
    const sourceBranch = String(mrDetails.source_branch).replace(/→/g, '->');
    const targetBranch = String(mrDetails.target_branch).replace(/→/g, '->');
    contextInfo += 'Source: ' + sourceBranch + ' -> ' + targetBranch + '\n';
    if (mrDetails.description) {
      contextInfo += 'Description: ' + String(mrDetails.description).substring(0, 1000) + '\n';
    }
    contextInfo += '\n';
  }

  // Prepare messages array
  const messages = [
    { role: 'system', content: 'Ты помощник в ревью кода, отвечай на русском языке.' }
  ];

  // Send MR context first (if any)
  if (contextInfo) {
    messages.push({ role: 'user', content: 'Контекст Merge Request:\n' + contextInfo });
  }

  // Send each chunk of the diff
  for (let i = 0; i < chunks.length; i++) {
    const isLastChunk = i === chunks.length - 1;
    const chunkPrefix = chunks.length > 1 ? `Часть ${i + 1} из ${chunks.length}: ` : '';

    const continuation = isLastChunk ? '' : '\n\n(Продолжение следует...)';
    messages.push({
      role: 'user',
      content: chunkPrefix + chunks[i] + continuation
    });
  }

  // Final instruction — use reviewPrompt if set
  if (reviewPrompt) {
    messages.push({ role: 'user', content: reviewPrompt });
  }

  // Remove control characters (except common whitespace like \n, \r, \t)
  for (const msg of messages) {
    msg.content = msg.content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  return messages;
}

/**
 * Split text into chunks for processing
 */
function chunkText(text, maxLinesPerChunk) {
  const lines = text.split('\n');
  const chunks = [];
  
  for (let i = 0; i < lines.length; i += maxLinesPerChunk) {
    chunks.push(lines.slice(i, i + maxLinesPerChunk).join('\n'));
  }
  
  return chunks;
}

/**
 * Send diff to LLM for code review - handles large diffs by chunking
 * Uses buildMessages() to construct the conversation, then sends one request.
 */
async function reviewWithLLM(diffText, settings, mrDetails) {
  const { apiUrl, apiKey, model } = settings;

  const messages = buildMessages(diffText, settings, mrDetails);

  const url = apiUrl + '/chat/completions';

  const body = {
    model: model,
    messages: messages,
    temperature: 1.0,
    max_tokens: 8192
  };

  const headers = new Headers();
  headers.append('Content-Type', 'application/json; charset=utf-8');
  if (apiKey) {
    const cleanApiKey = String(apiKey).replace(/[^\x00-\x7F]/g, '');
    headers.append('Authorization', 'Bearer ' + cleanApiKey);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error('LLM API error: ' + response.status + ' - ' + error);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || 'No review generated.';
}

// ===== Message Handler =====

// Track active reviews per tab to prevent concurrent reviews
const activeReviews = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleAsyncMessage(message, sender).then(sendResponse);
  return true; // Keep message channel open for async response
});

async function handleAsyncMessage(message, sender) {
  switch (message.action) {
    case 'check-gitlab-mr': {
      const tabUrl = sender.tab?.url;
      if (!tabUrl || !isGitLabMRPage(tabUrl)) {
        return { isMRPage: false };
      }

      const gitlabInfo = extractGitLabInfo(tabUrl);
      return {
        isMRPage: true,
        gitlabInfo
      };
    }

    case 'start-review': {
      const { gitlabInfo } = message.payload;
      const senderTabId = sender.tab?.id;

      if (!senderTabId) {
        return { success: false, error: 'Cannot determine tab ID' };
      }

      // Prevent concurrent reviews on the same tab
      if (activeReviews.has(senderTabId)) {
        console.warn('Review already in progress for tab ' + senderTabId);
        return { success: false, error: 'Ревью уже выполняется для этой вкладки.' };
      }
      activeReviews.set(senderTabId, true);

      try {
        // Send progress update
        chrome.tabs.sendMessage(senderTabId, {
          action: 'review-progress',
          payload: { stage: 'fetching-diff', message: 'Fetching MR diff...' }
        });

        // Ask content script to fetch diff using its context (with cookies)
        const fetchResult = await chrome.tabs.sendMessage(senderTabId, {
          action: 'fetch-gitlab-data',
          payload: gitlabInfo
        });

        if (!fetchResult.success) {
          throw new Error(fetchResult.error || 'Failed to fetch MR data');
        }

        const { diffText, mrDetails } = fetchResult;

        if (!diffText) {
          throw new Error('No diff found. The MR may not have any changes.');
        }

        // Send progress update
        chrome.tabs.sendMessage(senderTabId, {
          action: 'review-progress',
          payload: { stage: 'reviewing', message: 'Analyzing ' + diffText.split('\n').length + ' lines of diff...' }
        });

        // Get active LLM profile + global settings
        const allSettings = await chrome.storage.local.get({
          llmProfiles: [],
          activeProfileId: null,
          reviewPrompt: '',
          maxDiffSize: 10000
        });

        // Resolve active profile
        let profile = null;
        if (allSettings.activeProfileId && allSettings.llmProfiles.length > 0) {
          profile = allSettings.llmProfiles.find(p => p.id === allSettings.activeProfileId);
        }

        if (!profile) {
          // Fallback: try first profile
          profile = allSettings.llmProfiles.length > 0 ? allSettings.llmProfiles[0] : null;
        }

        if (!profile) {
          return { success: false, error: 'Нет профилей LLM. Добавьте профиль в настройках.' };
        }

        const settings = {
          apiUrl: profile.apiUrl,
          apiKey: profile.apiKey || '',
          model: profile.model,
          reviewPrompt: allSettings.reviewPrompt,
          maxDiffSize: allSettings.maxDiffSize || 10000
        };

        // Use default prompt if not set (Russian) — returns JSON
        // This prompt contains ONLY instructions — the diff is sent separately in reviewWithLLM
        const defaultPrompt = 'Проведите код-ревью диффа, который я прислал выше.\n\n' +
          'Ваша задача:\n' +
          '1. **Найти баги и потенциальные проблемы** — логические ошибки, краевые случаи, race conditions, утечки памяти\n' +
          '2. **Обратить внимание на безопасность** — уязвимости, риски инъекций, утечки данных\n' +
          '3. **Отметить проблемы производительности** — неэффективные алгоритмы, излишняя сложность\n' +
          '4. **Оценить качество кода** — читаемость, поддерживаемость, best practices\n' +
          '5. **Предложить улучшения** — конкретные рекомендации с примерами кода\n\n'

        const staticPrompt = '\nОЧЕНЬ ВАЖНО: Ответь ТОЛЬКО в формате JSON. Не добавляй ничего кроме JSON. Без markdown обёрток, без текста.\n\n' +
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
          '      "line_new": 42,\n' +
          '      "line_old": 41\n' +
          '    }\n' +
          '  ]\n' +
          '}\n' +
          '```\n\n' +
          'Правила:\n' +
          '- severity: "critical" — баги/уязвимости, "major" — проблемы, "minor" — замечания, "suggestion" — улучшения\n' +
          '- Каждая строка диффа начинается с маркера [L:OLD NEW]:\n' +
          '  * "[L:53 53]  text" — контекстная строка (не менялась), OLD=53, NEW=53\n' +
          '  * "[L:63   ] -text" — удалённая строка, OLD=63\n' +
          '  * "[L:   63] +text" — добавленная строка, NEW=63\n' +
          '- "line_new" — номер NEW из маркера [L:OLD NEW]\n' +
          '- "line_old" — номер OLD из маркера [L:OLD NEW]\n' +
          '- "suggestion" — опиши как исправить (код или текст), может быть null\n' +
          '- Будь конкретен, ссылайся на одну строчку диффа, чтобы мы могли составить ссылку на строку в интерфейсе гитлаба\n' +
          '- Пиши на русском языке\n' +
          '- Файлы: "old_path" или "new_path" из заголовка диффа (обычно одинаковые)\n';

        settings.reviewPrompt = settings.reviewPrompt || defaultPrompt;
        settings.reviewPrompt +=  staticPrompt

        // Call LLM
        const rawReview = await reviewWithLLM(diffText, settings, mrDetails);

        // Try to parse JSON response
        let reviewData = parseReviewJSON(rawReview);

        if (!reviewData) {
          // Retry with correction prompt — send ONLY the correction, not the full conversation
          try {
            const correctionMessage = 'Ошибка! Ваш предыдущий ответ не является валидным JSON. Переотвечай ТОЛЬКО в формате JSON. Без текста, без markdown.';

            const correctionHeaders = new Headers();
            correctionHeaders.append('Content-Type', 'application/json; charset=utf-8');
            if (settings.apiKey) {
              const cleanApiKey = String(settings.apiKey).replace(/[^\x00-\x7F]/g, '');
              correctionHeaders.append('Authorization', 'Bearer ' + cleanApiKey);
            }

            const correctionMessages = [
              ...buildMessages(diffText, settings, mrDetails),
              { role: 'user', content: correctionMessage }
            ];

            const correctionBody = {
              model: settings.model,
              messages: correctionMessages,
              temperature: 0.7,
              max_tokens: 8192
            };

            const correctionUrl = settings.apiUrl + '/chat/completions';

            const correctionResponse = await fetch(correctionUrl, {
              method: 'POST',
              headers: correctionHeaders,
              body: JSON.stringify(correctionBody)
            });

            if (!correctionResponse.ok) {
              const error = await correctionResponse.text();
              throw new Error('LLM API error: ' + correctionResponse.status + ' - ' + error);
            }

            const correctionData = await correctionResponse.json();
            const retryReview = correctionData.choices[0]?.message?.content || '';
            reviewData = parseReviewJSON(retryReview);
          } catch (retryErr) {
            // If retry fails, return raw review as fallback
            console.warn('JSON parse retry failed, returning raw review');
          }
        }

        return {
          success: true,
          review: reviewData || rawReview
        };
      } finally {
        // Cleanup active review for this tab
        activeReviews.delete(senderTabId);
      }
    }

    case 'test-llm-connection': {
      try {
        await testLLMConnection(message.payload);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    default:
      return { error: 'Unknown action' };
  }
}
