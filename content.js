// ===== GitLab MR Page Detection =====

let gitLabInfo = null;
let isInitialized = false;

/**
 * Check if we're on a GitLab MR page
 */
function detectMRPage() {
  const path = window.location.pathname;
  const mrRegex = /(.+)\/-\/merge_requests\/(\d+)/;
  const match = path.match(mrRegex);

  if (match) {
    return {
      projectPath: match[1].substring(1),
      mergeRequestIid: match[2]
    };
  }

  return null;
}

// ===== GitLab API Integration (using same-origin requests with cookies) =====

/**
 * Fetch MR diff from GitLab API using same-origin request (uses session cookies)
 */
async function fetchGitLabDiff(baseUrl, projectId, mergeRequestIid) {
  const url = `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/diffs`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
      // Cookies are automatically included in same-origin requests
    });

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
  } catch (err) {
    throw new Error(`Failed to fetch MR diff: ${err.message}`);
  }
}

/**
 * Get MR details (title, description) using same-origin request
 */
async function fetchGitLabDetails(baseUrl, projectId, mergeRequestIid) {
  const url = `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
      // Cookies are automatically included in same-origin requests
    });

    if (!response.ok) {
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    throw new Error(`Failed to fetch MR details: ${err.message}`);
  }
}

// ===== UI Components =====

/**
 * Create the AI Review button
 */
function createReviewButton() {
  const btn = document.createElement('button');
  btn.id = 'ai-review-btn';
  btn.className = 'btn btn-md btn-confirm mr-2';
  btn.innerHTML = '🤖 AI Review';

  btn.addEventListener('click', startReview);

  return btn;
}

/**
 * Create the review panel
 */
function createReviewPanel() {
  const panel = document.createElement('div');
  panel.id = 'ai-review-panel';
  panel.className = 'ai-review-panel';

  panel.innerHTML = `
    <div class="ai-review-header">
      <h3>🤖 AI Code Review</h3>
      <button class="ai-review-close" title="Close">×</button>
    </div>
    <div class="ai-review-content">
      <div class="ai-review-placeholder">
        <p>Click the button above to start AI review...</p>
      </div>
    </div>
  `;

  // Close button handler
  panel.querySelector('.ai-review-close').addEventListener('click', () => {
    panel.classList.remove('visible');
  });

  return panel;
}

/**
 * Inject the button and panel into the page
 */
function injectUI() {
  // Don't inject twice
  if (document.getElementById('ai-review-btn')) {
    return;
  }

  // Find a good place to inject the button
  // GitLab MR pages have a .detail-page-header-actions or similar
  let targetContainer = null;

  // Try various selectors that GitLab uses
  const selectors = [
    '.detail-page-header-actions',
    '.issuable-header .controls',
    '.merge-request-header .controls',
    '.page-content .header-actions',
    '.gl-show-hide-buttons',
    '[data-qa-selector="merge_request_header"]'
  ];

  for (const selector of selectors) {
    targetContainer = document.querySelector(selector);
    if (targetContainer) break;
  }

  // If no specific container found, try to find header area
  if (!targetContainer) {
    // Look for the MR title area
    const header = document.querySelector('h1.title, .detail-page-header');
    if (header) {
      targetContainer = header.parentElement;
    }
  }

  if (targetContainer) {
    const btn = createReviewButton();
    targetContainer.appendChild(btn);
  }

  // Add review panel to the main content area
  const contentArea = document.querySelector('.content-wrapper, .page-content, #content-body');
  if (contentArea) {
    const panel = createReviewPanel();
    contentArea.insertBefore(panel, contentArea.firstChild);
  }
}

// ===== Review Flow =====

/**
 * Start the review process
 */
async function startReview() {
  const btn = document.getElementById('ai-review-btn');
  const panel = document.getElementById('ai-review-panel');
  const content = panel.querySelector('.ai-review-content');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Ревью...';
  }

  if (panel) {
    panel.classList.add('visible');
  }

  content.innerHTML = `
    <div class="ai-review-loading">
      <div class="ai-review-spinner"></div>
      <p class="ai-review-status">Initializing...</p>
    </div>
  `;

  try {
    // Check if this is an MR page
    const response = await chrome.runtime.sendMessage({ action: 'check-gitlab-mr' });

    if (!response.isMRPage) {
      throw new Error('Not a GitLab MR page. Please navigate to a Merge Request.');
    }

    gitLabInfo = response.gitlabInfo;

    // Fetch diff and details using same-origin requests (with cookies)
    content.querySelector('.ai-review-status').textContent = 'Загрузка диффа...';
    
    const [diffText, mrDetails] = await Promise.all([
      fetchGitLabDiff(gitLabInfo.baseUrl, gitLabInfo.projectId, gitLabInfo.mergeRequestIid),
      fetchGitLabDetails(gitLabInfo.baseUrl, gitLabInfo.projectId, gitLabInfo.mergeRequestIid)
    ]);

    if (!diffText) {
      throw new Error('No diff found. The MR may not have any changes.');
    }

    // Send to background for LLM processing
    content.querySelector('.ai-review-status').textContent = `Анализ ${diffText.split('\n').length} строк диффа...`;
    
    const reviewResponse = await chrome.runtime.sendMessage({
      action: 'start-review',
      payload: { gitlabInfo: gitLabInfo }
    });

    if (reviewResponse.success) {
      // Render the review
      const markdownHtml = renderMarkdown(reviewResponse.review);
      content.innerHTML = `
        <div class="ai-review-result">
          ${markdownHtml}
        </div>
      `;
    } else {
      throw new Error(reviewResponse.error || 'Unknown error occurred');
    }
  } catch (err) {
    content.innerHTML = `
      <div class="ai-review-error">
        <h4>❌ Review Failed</h4>
        <p>${escapeHtml(err.message)}</p>
        <p class="ai-review-hint">Make sure you're logged into GitLab and have access to this MR.</p>
      </div>
    `;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🤖 AI Review';
    }
  }
}

// ===== Markdown Rendering (simple) =====

function renderMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let html = '';
  let inCodeBlock = false;
  let codeBlockContent = [];
  let codeBlockLang = '';
  let inList = false;
  let listItems = [];

  function closeList() {
    if (inList && listItems.length > 0) {
      html += '<ul>' + listItems.join('') + '</ul>';
      listItems = [];
      inList = false;
    }
  }

  function processInline(line) {
    // Escape HTML first
    line = line.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');

    // Inline code (before other formatting)
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');

    return line;
  }

  for (const line of lines) {
    // Code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        closeList();
        inCodeBlock = true;
        codeBlockLang = line.slice(3);
        codeBlockContent = [];
      } else {
        html += `<pre><code class="language-${codeBlockLang}">${codeBlockContent.join('<br>')}</code></pre>`;
        inCodeBlock = false;
        codeBlockContent = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('# ')) {
      closeList();
      html += `<h2>${processInline(line.slice(2))}</h2>`;
      continue;
    }
    if (line.startsWith('## ')) {
      closeList();
      html += `<h3>${processInline(line.slice(3))}</h3>`;
      continue;
    }
    if (line.startsWith('### ')) {
      closeList();
      html += `<h4>${processInline(line.slice(4))}</h4>`;
      continue;
    }
    if (line.startsWith('#### ')) {
      closeList();
      html += `<h5>${processInline(line.slice(5))}</h5>`;
      continue;
    }

    // Lists
    if (line.match(/^\- /)) {
      inList = true;
      listItems.push(`<li>${processInline(line.slice(2))}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      closeList();
      html += '<br><br>';
      continue;
    }

    // Regular text - close list first
    closeList();
    html += processInline(line) + '<br>';
  }

  // Close any remaining code block or list
  if (inCodeBlock && codeBlockContent.length > 0) {
    html += `<pre><code class="language-${codeBlockLang}">${codeBlockContent.join('<br>')}</code></pre>`;
  }
  closeList();

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Message Handler =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'fetch-gitlab-data': {
      // Fetch GitLab data using same-origin requests (automatically uses cookies)
      const { baseUrl, projectId, mergeRequestIid } = message.payload;
      
      fetchGitLabDiff(baseUrl, projectId, mergeRequestIid)
        .then(diffText => {
          if (!diffText) {
            return sendResponse({ success: false, error: 'No diff found' });
          }
          
          return fetchGitLabDetails(baseUrl, projectId, mergeRequestIid)
            .then(mrDetails => ({
              success: true,
              diffText,
              mrDetails
            }))
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message }));
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      
      return true; // Async response
    }

    case 'review-progress': {
      const statusEl = document.querySelector('.ai-review-status');
      if (statusEl) {
        statusEl.textContent = message.payload.message;
      }
      sendResponse({ received: true });
      break;
    }
  }
});

// ===== Initialization =====

function init() {
  if (isInitialized) return;
  isInitialized = true;

  // Check if this is an MR page
  const mrInfo = detectMRPage();
  if (mrInfo) {
    gitLabInfo = mrInfo;
    // Wait a bit for GitLab's dynamic content to load
    setTimeout(() => {
      injectUI();
    }, 1000);
  }
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Re-inject on navigation (SPA behavior)
let lastUrl = window.location.href;
new MutationObserver(() => {
  const url = window.location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    isInitialized = false;
    setTimeout(init, 500);
  }
}).observe(document, { subtree: true, childList: true });
