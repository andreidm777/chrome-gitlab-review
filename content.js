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
      // Render the review (JSON or fallback markdown)
      const html = renderReviewJSON(reviewResponse.review);
      content.innerHTML = `
        <div class="ai-review-result">
          ${html}
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

// ===== Review Rendering (JSON-based with issue blocks) =====

/**
 * Severity configuration for UI display
 */
const SEVERITY_CONFIG = {
  critical: { label: '🔴 Критическая', color: '#ef4444', bg: '#fef2f2' },
  major: { label: '🟠 Серьёзная', color: '#f97316', bg: '#fff7ed' },
  minor: { label: '🟡 Замечание', color: '#eab308', bg: '#fefce8' },
  suggestion: { label: '🟢 Предложение', color: '#22c55e', bg: '#f0fdf4' }
};

/**
 * Render review (JSON object or fallback to markdown)
 */
function renderReviewJSON(review) {
  if (!review) return '';

  // Check if it's a string (markdown fallback) — handle it
  if (typeof review === 'string') {
    try {
      review = JSON.parse(review);
    } catch (e) {
      // It's markdown text — render as simple HTML
      return `<div class="ai-review-fallback">${escapeHtml(review).replace(/\n/g, '<br>')}</div>`;
    }
  }

  // Render JSON structure
  let html = '';

  // Summary
  if (review.summary) {
    const summaryId = 'summary-' + Date.now();
    html += `
      <div class="review-summary">
        <h4>${escapeHtml(review.summary)}</h4>
        <button class="review-summary-copy" onclick="copyText(${JSON.stringify(review.summary).replace(/"/g, '&quot;')})" title="Копировать резюме">
          <span class="copy-icon">📋</span>
          <span class="copy-text">Копировать</span>
        </button>
      </div>
    `;
  }

  // Issues
  if (review.issues && Array.isArray(review.issues)) {
    for (const issue of review.issues) {
      html += renderIssueCard(issue);
    }
  }

  return html;
}

/**
 * Render an individual issue card
 */
function renderIssueCard(issue) {
  const severity = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.suggestion;
  const id = 'issue-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  // Build line number reference link (clickable)
  let lineRef = '';
  if (issue.file && issue.line) {
    const gitLabUrl = buildGitLabLineUrl(issue.file, issue.line);
    lineRef = `
      <a href="${escapeHtml(gitLabUrl)}" class="issue-line-ref" target="_blank" rel="noopener" title="Перейти к строке ${issue.line} в GitLab">
        📂 ${escapeHtml(issue.file)}:${issue.line}
      </a>
    `;
  }

  // Build suggestion
  let suggestionHtml = '';
  if (issue.suggestion) {
    suggestionHtml = `<div class="issue-suggestion"><strong>💡 Исправление:</strong> ${escapeHtml(issue.suggestion)}</div>`;
  }

  // Escape description for HTML (preserve newlines)
  const descHtml = escapeHtml(issue.description || '').replace(/\n/g, '<br>');

  return `
    <div class="issue-block" data-severity="${issue.severity || 'suggestion'}" id="${id}">
      <div class="issue-block-header" style="border-left: 4px solid ${severity.color}; background: ${severity.bg};">
        <div class="issue-block-info">
          <h4 class="issue-block-title">${escapeHtml(issue.title || 'Проблема')}</h4>
          <div class="issue-block-meta">
            <span class="issue-severity" style="color: ${severity.color};">${severity.label}</span>
            ${lineRef}
          </div>
        </div>
        <button class="issue-block-copy" onclick="copyIssueBlock('${id}')" title="Копировать">
          <span class="copy-icon">📋</span>
          <span class="copy-text">Копировать</span>
        </button>
      </div>
      <div class="issue-block-content">
        <div class="issue-description">${descHtml}</div>
        ${suggestionHtml}
      </div>
    </div>
  `;
}

/**
 * Build GitLab URL for a specific file and line number
 */
function buildGitLabLineUrl(filePath, lineNumber) {
  if (!gitLabInfo || !gitLabInfo.projectId || !gitLabInfo.mergeRequestIid) {
    return '#';
  }

  // Encode the file path for URL
  const encodedPath = encodeURIComponent(filePath);

  // GitLab MR diff line URL format
  return `${gitLabInfo.baseUrl}/${gitLabInfo.projectId}/-/merge-requests/${gitLabInfo.mergeRequestIid}/diffs?diff_id=${Date.now()}&drop_tab_selection=true&line=${lineNumber}`;
}

/**
 * Copy issue block content to clipboard
 */
async function copyIssueBlock(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;

  // Get title + description + suggestion
  const title = element.querySelector('.issue-block-title')?.textContent || '';
  const desc = element.querySelector('.issue-description')?.textContent || '';
  const suggestion = element.querySelector('.issue-suggestion')?.textContent || '';

  const text = [title, desc, suggestion].filter(Boolean).join('\n\n');

  try {
    await navigator.clipboard.writeText(text);
    const button = element.querySelector('.issue-block-copy');
    if (button) {
      const originalHTML = button.innerHTML;
      button.innerHTML = '<span class="copy-icon">✓</span><span class="copy-text">Скопировано!</span>';
      button.classList.add('copied');
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('copied');
      }, 2000);
    }
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Copy text to clipboard (utility)
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Render markdown content as HTML (simple)
 */
function renderMarkdownContent(text) {
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

    // Headers - skip ## but handle ### and below
    if (line.startsWith('### ')) {
      closeList();
      html += `<h5>${processInline(line.slice(4))}</h5>`;
      continue;
    }

    // Lists
    if (line.match(/^[\-\*]\s/)) {
      inList = true;
      listItems.push(`<li>${processInline(line.replace(/^[\-\*]\s/, ''))}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      closeList();
      html += '<br><br>';
      continue;
    }

    // Regular text
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
