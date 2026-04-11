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
    baseUrl: `${url.protocol}//${url.host}`,
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

/**
 * Get GitLab private token from page context
 * This requires the user to have a token available (set via content script)
 */
async function getGitLabToken(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'get-gitlab-token' });
    return response?.token || null;
  } catch {
    return null;
  }
}

/**
 * Fetch MR diff from GitLab API
 */
async function fetchMRDiff(gitlabInfo, token) {
  const { baseUrl, projectId, mergeRequestIid } = gitlabInfo;

  const url = `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/diffs`;

  const headers = {
    'Accept': 'application/json'
  };

  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const diffs = await response.json();

  // Combine all diffs into a single text
  const diffText = diffs.map(diff => {
    const header = `--- ${diff.old_path}\n+++ ${diff.new_path}\n`;
    return header + diff.diff;
  }).join('\n\n');

  return diffText;
}

/**
 * Get MR details (title, description)
 */
async function getMRDetails(gitlabInfo, token) {
  const { baseUrl, projectId, mergeRequestIid } = gitlabInfo;

  const url = `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`;

  const headers = {
    'Accept': 'application/json'
  };

  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// ===== LLM Integration (OpenAI-compatible) =====

/**
 * Test LLM connection with a simple request
 */
async function testLLMConnection({ apiUrl, apiKey, model }) {
  const url = `${apiUrl}/chat/completions`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body = {
    model: model,
    messages: [{ role: 'user', content: 'Say "ok" in exactly one word.' }],
    max_tokens: 10
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${error}`);
  }

  return true;
}

/**
 * Send diff to LLM for code review
 */
async function reviewWithLLM(diffText, settings, mrDetails = null) {
  const { apiUrl, apiKey, model, reviewPrompt, maxDiffSize } = settings;

  // Truncate diff if too large
  let truncatedDiff = diffText;
  let wasTruncated = false;

  if (diffText.length > maxDiffSize) {
    truncatedDiff = diffText.substring(0, maxDiffSize);
    wasTruncated = true;
  }

  // Build context from MR details
  let contextInfo = '';
  if (mrDetails) {
    contextInfo = `MR Title: ${mrDetails.title}\n`;
    contextInfo += `Source: ${mrDetails.source_branch} → ${mrDetails.target_branch}\n`;
    if (mrDetails.description) {
      contextInfo += `Description: ${mrDetails.description.substring(0, 1000)}\n`;
    }
    contextInfo += '\n';
  }

  const prompt = `${reviewPrompt}\n\n${contextInfo}${truncatedDiff}`;

  if (wasTruncated) {
    prompt += '\n\n[Note: Diff was truncated due to size limits. Only first part is shown.]';
  }

  const url = `${apiUrl}/chat/completions`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body = {
    model: model,
    messages: [
      { role: 'system', content: 'You are a helpful code review assistant.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 4096
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${error}`);
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
      const { tabId, gitlabInfo } = message.payload;
      const token = await getGitLabToken(tabId);

      try {
        // Send progress update
        chrome.tabs.sendMessage(tabId, {
          action: 'review-progress',
          payload: { stage: 'fetching-diff', message: 'Fetching MR diff...' }
        });

        // Fetch diff and details
        const [diffText, mrDetails] = await Promise.all([
          fetchMRDiff(gitlabInfo, token),
          getMRDetails(gitlabInfo, token)
        ]);

        if (!diffText) {
          throw new Error('No diff found. The MR may not have any changes or you may need to provide a token.');
        }

        // Send progress update
        chrome.tabs.sendMessage(tabId, {
          action: 'review-progress',
          payload: { stage: 'reviewing', message: `Analyzing ${diffText.split('\n').length} lines of diff...` }
        });

        // Get settings
        const settings = await chrome.storage.local.get({
          apiUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o',
          reviewPrompt: '',
          maxDiffSize: 5000
        });

        // Use default prompt if not set
        const defaultPrompt = `You are an expert code reviewer. Review the following diff from a GitLab Merge Request.

Your review should:
1. **Identify bugs and potential issues** - Logic errors, edge cases, race conditions, memory leaks
2. **Security concerns** - Vulnerabilities, injection risks, data exposure
3. **Performance issues** - Inefficient algorithms, unnecessary complexity
4. **Code quality** - Readability, maintainability, best practices
5. **Suggestions** - Concrete improvement suggestions with code examples

Format your response in markdown. Be concise but thorough. Focus on meaningful issues, not style preferences.

Here's the diff:`;

        settings.reviewPrompt = settings.reviewPrompt || defaultPrompt;

        // Call LLM
        const review = await reviewWithLLM(diffText, settings, mrDetails);

        return {
          success: true,
          review
        };
      } catch (err) {
        return {
          success: false,
          error: err.message
        };
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

    case 'get-gitlab-token': {
      // This is handled by content script, not background
      return { token: null };
    }

    default:
      return { error: 'Unknown action' };
  }
}
