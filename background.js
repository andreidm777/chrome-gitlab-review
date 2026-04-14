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

  return {
    baseUrl: url.protocol + '//' + url.host,
    projectPath: match[1].substring(1), // Remove leading /
    projectId: encodeURIComponent(match[1].substring(1)), // URL encoded for API
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
 */
async function reviewWithLLM(diffText, settings, mrDetails) {
  const { apiUrl, apiKey, model, reviewPrompt, maxDiffSize } = settings;

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

  // Prepare messages array for streaming context
  const messages = [
    { role: 'system', content: 'Ты помошник в ревью коде, отвечай на русском языке.' }
  ];

  // Add MR context
  if (contextInfo) {
    messages.push({ role: 'user', content: 'Контекст Merge Request:\n' + contextInfo });
    messages.push({ role: 'assistant', content: 'Принято. Жду дифф для анализа.' });
  }

  // Send each chunk
  for (let i = 0; i < chunks.length; i++) {
    const isLastChunk = i === chunks.length - 1;
    const chunkPrefix = chunks.length > 1 ? `Часть ${i + 1} из ${chunks.length}: ` : '';
    
    const continuation = isLastChunk ? '' : '\n\n(Продолжение следует...)';
    messages.push({
      role: 'user',
      content: chunkPrefix + chunks[i] + continuation
    });
    
    messages.push({
      role: 'assistant',
      content: isLastChunk ? '' : 'Получил, жду следующую часть.'
    });
  }

  // Final prompt asking for full review
  const finalPrompt = chunks.length > 1 
    ? `Это весь дифф. Теперь проведи полное код-ревью всего кода, который я прислал.`
    : `Вот дифф для анализа:\n\n${diffText}`;

  messages.push({ role: 'user', content: finalPrompt });

  // Remove control characters (except common whitespace like \n, \r, \t)
  for (const msg of messages) {
    msg.content = msg.content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  const url = apiUrl + '/chat/completions';

  const body = {
    model: model,
    messages: messages,
    temperature: 0.7,
    max_tokens: 8192
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

  const data = await response.json();
  return data.choices[0]?.message?.content || 'No review generated.';
}

// ===== Message Handler =====

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

      // Get settings
      const settings = await chrome.storage.local.get({
        apiUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o',
        reviewPrompt: '',
        maxDiffSize: 10000
      });

      // Use default prompt if not set (Russian)
      const defaultPrompt = 'Вы — опытный рецензент кода. Проведите код-ревью диффа из Merge Request в GitLab.\n\n' +
        'Ваша задача:\n' +
        '1. **Найти баги и потенциальные проблемы** — логические ошибки, краевые случаи, race conditions, утечки памяти\n' +
        '2. **Обратить внимание на безопасность** — уязвимости, риски инъекций, утечки данных\n' +
        '3. **Отметить проблемы производительности** — неэффективные алгоритмы, излишняя сложность\n' +
        '4. **Оценить качество кода** — читаемость, поддерживаемость, best practices\n' +
        '5. **Предложить улучшения** — конкретные рекомендации с примерами кода\n\n' +
        'Форматируйте ответ в markdown. Будьте кратки, но подробны. Фокусируйтесь на существенных проблемах, а не на предпочтениях по стилю. пиши на русском языке\n\n' +
        'Вот дифф:';

      settings.reviewPrompt = settings.reviewPrompt || defaultPrompt;

      // Call LLM
      const review = await reviewWithLLM(diffText, settings, mrDetails);

      return {
        success: true,
        review
      };
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
