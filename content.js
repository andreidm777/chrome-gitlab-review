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

/**
 * Extract GitLab token from page
 * GitLab stores auth tokens in meta tags or localStorage
 */
function extractGitLabToken() {
  // Try to get token from meta tag (GitLab sometimes has CSRF token)
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  if (csrfMeta) {
    return csrfMeta.getAttribute('content');
  }

  // Try localStorage (GitLab may store session data)
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.includes('token') || key.includes('auth')) {
        const value = localStorage.getItem(key);
        if (value && typeof value === 'string' && value.length > 20) {
          return value;
        }
      }
    }
  } catch {
    // Ignore localStorage errors
  }

  return null;
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
    btn.innerHTML = '⏳ Reviewing...';
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

    // Start the review
    const tabId = (await chrome.runtime.sendMessage({ action: 'get-tab-id' }))?.tabId;

    const reviewResponse = await chrome.runtime.sendMessage({
      action: 'start-review',
      payload: { tabId, gitlabInfo: gitLabInfo }
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
        <p class="ai-review-hint">Make sure you've configured the LLM settings (click the extension icon).</p>
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
  // Very basic markdown to HTML conversion
  let html = text;

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Lists
  html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Clean up multiple <br> tags
  html = html.replace(/(<br>){3,}/g, '<br><br>');

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
    case 'get-gitlab-token': {
      const token = extractGitLabToken();
      sendResponse({ token });
      break;
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
