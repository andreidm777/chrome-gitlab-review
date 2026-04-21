// ===== GitLab MR Page Detection =====

let gitLabInfo = null;
let isInitialized = false;
let diffLineMap = {};
let diffFileHashes = {};

function sha1Sync(str) {
  function rotl(n, x) { return ((x << n) | (x >>> (32 - n))); }
  function toHex(n) { return (n >>> 0).toString(16).padStart(8, '0'); }

  const msg = new TextEncoder().encode(str);
  const len = msg.length;
  const bitLen = len * 8;

  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) { const x = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16]; w[i] = rotl(1, x); }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const temp = (rotl(5, a) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(30, b); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content;
}

async function createDraftCommentWithCookies(baseUrl, filePath, lineNumber, commentText) {
    const csrfToken = getCsrfToken();

    if (!csrfToken) {
        throw new Error('CSRF token not found on the page');
    }

    const diffRefs = gitLabInfo?.diffRefs;
    if (!diffRefs?.base_sha || !diffRefs?.start_sha || !diffRefs?.head_sha) {
        throw new Error('diff_refs not available');
    }

    const fileMaps = diffLineMap[filePath] || { toOld: {}, toNew: {} };
    let newLine, oldLine;

    // Determine if lineNumber refers to old_line or new_line
    if (fileMaps.toNew[lineNumber] !== undefined) {
        // lineNumber is old_line
        oldLine = lineNumber;
        newLine = fileMaps.toNew[oldLine];
    } else {
        // lineNumber is new_line
        newLine = lineNumber;
        oldLine = fileMaps.toOld[lineNumber];
    }

    const position = {
        position_type: "text",
        old_path: filePath,
        new_path: filePath,
        base_sha: diffRefs.base_sha,
        start_sha: diffRefs.start_sha,
        head_sha: diffRefs.head_sha,
        new_line: newLine
    };

    if (oldLine && oldLine !== newLine) {
        position.old_line = oldLine;
    }

    const response = await fetch(
        `${gitLabInfo.baseUrl}/api/v4/projects/${gitLabInfo.projectId}/merge_requests/${gitLabInfo.mergeRequestIid}/draft_notes`,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'X-CSRF-Token': csrfToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                note: commentText,
                position: position
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitLab API error (${response.status}): ${errorText}`);
    }

    return response.json();
}

/**
 * Check if we're on a GitLab MR page
 */
function detectMRPage() {
  const path = decodeURIComponent(window.location.pathname);
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

function buildDiffLineMap(diffs) {
  diffLineMap = {};

  for (const diff of diffs) {
    const filePath = diff.new_path || diff.old_path;
    const lines = (diff.diff || '').split('\n');
    const fileMap = {};
    const reverseFileMap = {};

    diffFileHashes[filePath] = sha1Sync(filePath);

    let oldLine = 0;
    let newLine = 0;
    let lastOldLine = 0;
    let inHunk = false;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
        lastOldLine = oldLine > 0 ? oldLine - 1 : 0;
        inHunk = true;
        continue;
      }

      if (!inHunk) continue;
      if (line.startsWith('\\')) continue;

      if (line.startsWith('-')) {
        lastOldLine = oldLine;
        oldLine++;
      } else if (line.startsWith('+')) {
        fileMap[newLine] = lastOldLine;
        newLine++;
      } else {
        fileMap[newLine] = oldLine;
        reverseFileMap[oldLine] = newLine;
        lastOldLine = oldLine;
        oldLine++;
        newLine++;
      }
    }

    // Store both maps: newLine→oldLine and oldLine→newLine
    diffLineMap[filePath] = {
      toOld: fileMap,
      toNew: reverseFileMap
    };
  }
}

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

    buildDiffLineMap(diffs);

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

let isReviewInProgress = false;

/**
 * Start the review process
 */
async function startReview() {
  // Prevent concurrent reviews
  if (isReviewInProgress) {
    console.warn('startReview called while review is already in progress');
    return;
  }
  isReviewInProgress = true;

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

    gitLabInfo.diffRefs = mrDetails?.diff_refs || null;

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

      // Add download button at the top of the result
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'ai-review-download-btn';
      downloadBtn.innerHTML = '<span class="download-icon">💾</span> <span class="download-text">Скачать отчёт</span>';
      downloadBtn.addEventListener('click', () => {
        downloadReviewAsHTML(gitLabInfo.projectId, gitLabInfo.mergeRequestIid, reviewResponse.review, mrDetails);
      });
      content.querySelector('.ai-review-result').insertAdjacentElement('beforebegin', downloadBtn);

      content.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        if (action === 'copy') {
          const block = btn.closest('.issue-block');
          copyIssueBlock(block?.id);
        } else if (action === 'draft') {
          const block = btn.closest('.issue-block');
          createDraftComment(block?.id, btn.dataset.file, parseInt(btn.dataset.line, 10));
        } else if (action === 'copy-text') {
          copyText(btn.dataset.text);
        }
      });
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
    isReviewInProgress = false;
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
        <button class="review-summary-copy" data-action="copy-text" data-text="${escapeHtml(review.summary).replace(/"/g, '&quot;')}" title="Копировать резюме">
          <span class="copy-icon">📋</span>
          <span class="copy-text">Копировать</span>
        </button>
      </div>
    `;
  }

  // Issues (standard field from our prompt)
  // Also check 'suggestions' as a fallback (some LLM models use this name)
  const items = review.issues || review.suggestions || [];
  if (Array.isArray(items)) {
    for (const item of items) {
      // Normalize field names — LLM may return 'message' instead of 'description'
      // or 'type' instead of 'title'
      const normalized = {
        title: item.title || item.type || 'Проблема',
        severity: item.severity || 'suggestion',
        description: item.description || item.message || '',
        suggestion: item.suggestion || '',
        file: item.file || '',
        line: item.line || null
      };
      html += renderIssueCard(normalized);
    }
  }

  // Render verdict badge (if provided)
  if (review.verdict) {
    const verdictLabel = {
      approved: '✅ Approved',
      changes_requested: '🔴 Changes Requested',
      commented: '💬 Comments'
    }[review.verdict] || review.verdict;
    html += `<div class="review-verdict">${verdictLabel}</div>`;
  }

  // Render additional comments (if provided)
  if (review.comments && typeof review.comments === 'string' && !review.summary) {
    html += `<div class="review-summary"><h4>${escapeHtml(review.comments)}</h4></div>`;
  } else if (review.comments && typeof review.comments === 'string' && review.summary) {
    html += `<div class="review-comments"><p>${escapeHtml(review.comments).replace(/\n/g, '<br>')}</p></div>`;
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
      <a href="${gitLabUrl}" class="issue-line-ref" target="_blank" rel="noopener" title="Перейти к строке ${issue.line} в GitLab">
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
        <div class="issue-block-actions">
          ${issue.file && issue.line ? `<button class="issue-block-draft" data-action="draft" data-file="${escapeHtml(issue.file)}" data-line="${issue.line}" title="Создать черновик комментария">
            <span class="draft-icon">💬</span>
            <span class="draft-text">Draft</span>
          </button>` : ''}
          <button class="issue-block-copy" data-action="copy" title="Копировать">
            <span class="copy-icon">📋</span>
            <span class="copy-text">Копировать</span>
          </button>
        </div>
      </div>
      <div class="issue-block-content">
        <div class="issue-description">${descHtml}</div>
        ${suggestionHtml}
      </div>
    </div>
  `;
}

/**
 * Build GitLab URL for a specific file and line number.
 *
 * GitLab URL hash format: #fileHash_oldLine_newLine
 *
 * issue.line from LLM can be either old_line (line in the original file)
 * or new_line (line in the modified file). We try to detect which one it is
 * using the bidirectional line map.
 */
function buildGitLabLineUrl(filePath, lineNumber) {
  if (!gitLabInfo || !gitLabInfo.projectPath || !gitLabInfo.mergeRequestIid) {
    return '#';
  }

  const fileMaps = diffLineMap[filePath] || { toOld: {}, toNew: {} };
  const fileHash = diffFileHashes[filePath] || sha1Sync(filePath);

  let oldLine, newLine;

  // Check if lineNumber is an old_line (present in reverse map)
  if (fileMaps.toNew[lineNumber] !== undefined) {
    // lineNumber is old_line
    oldLine = lineNumber;
    newLine = fileMaps.toNew[oldLine];
  } else if (fileMaps.toOld[lineNumber] !== undefined) {
    // lineNumber is new_line
    newLine = lineNumber;
    oldLine = fileMaps.toOld[newLine];
  } else {
    // Fallback: assume lineNumber is new_line, use it as oldLine too
    oldLine = lineNumber;
    newLine = lineNumber;
  }

  let url = `${gitLabInfo.baseUrl}/${gitLabInfo.projectPath}/-/merge_requests/${gitLabInfo.mergeRequestIid}/diffs?drop_tab_selection=true&line=${newLine}`;
  url += `#${fileHash}_${oldLine}_${newLine}`;

  return url;
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

async function createDraftComment(elementId, filePath, lineNumber) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const button = element.querySelector('.issue-block-draft');
  if (!button || button.disabled) return;

  const title = element.querySelector('.issue-block-title')?.textContent || '';
  const desc = element.querySelector('.issue-description')?.textContent || '';
  const suggestion = element.querySelector('.issue-suggestion')?.textContent || '';
  const parts = [title];
  if (desc) parts.push(desc);
  if (suggestion) parts.push(suggestion);
  const commentText = parts.join('\n\n');

  button.disabled = true;
  button.innerHTML = '<span class="draft-icon">⏳</span><span class="draft-text">...</span>';

  try {
    await createDraftCommentWithCookies(gitLabInfo.baseUrl.replace(/^https?:\/\//, ''), filePath, lineNumber, commentText);
    button.innerHTML = '<span class="draft-icon">✓</span><span class="draft-text">Создано</span>';
    button.classList.add('draft-created');
    setTimeout(() => {
      button.innerHTML = '<span class="draft-icon">💬</span><span class="draft-text">Draft</span>';
      button.classList.remove('draft-created');
      button.disabled = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to create draft comment:', err);
    button.innerHTML = '<span class="draft-icon">✗</span><span class="draft-text">Ошибка</span>';
    setTimeout(() => {
      button.innerHTML = '<span class="draft-icon">💬</span><span class="draft-text">Draft</span>';
      button.disabled = false;
    }, 2000);
  }
}

/**
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
 * Download review as standalone HTML report
 */
function downloadReviewAsHTML(projectId, mergeRequestIid, reviewData, mrDetails) {
  const projectName = mrDetails?.title
    ? mrDetails.title
        .replace(/\//g, '-')
        .replace(/[^a-zA-Zа-яА-Я0-9\-_ ]/g, '')
        .trim()
    : `project_${projectId}`;
  const safeName = `${projectName}_MR${mergeRequestIid}`.replace(/[^a-zA-Zа-яА-Я0-9\-_]/g, '_').replace(/_+/g, '_');

  // Build issues HTML from review data
  let issuesHtml = '';
  const items = reviewData?.issues || reviewData?.suggestions || [];

  if (Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      const severity = item.severity || 'suggestion';
      const title = item.title || item.type || 'Проблема';
      const description = item.description || item.message || '';
      const suggestion = item.suggestion || '';
      const file = item.file || '';
      const line = item.line || null;
      const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.suggestion;

      issuesHtml += `
        <div class="issue-block" style="border: 1px solid #e5e7eb; border-radius: 8px; margin: 16px 0; overflow: hidden; background: #ffffff;">
          <div class="issue-block-header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: ${config.bg}; border-bottom: 1px solid #e5e7eb; gap: 12px; border-left: 4px solid ${config.color};">
            <div class="issue-block-info" style="flex: 1; min-width: 0;">
              <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #1f2937;">${escapeHtml(title)}</h4>
              <div class="issue-block-meta" style="display: flex; align-items: center; gap: 12px; margin-top: 4px; font-size: 13px;">
                <span style="font-weight: 600; font-size: 12px; color: ${config.color};">${config.label}</span>
                ${file && line ? `<span style="color: #667eea;">📂 ${escapeHtml(file)}:${line}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="issue-block-content" style="padding: 16px; color: #1f2937;">
            <div class="issue-description" style="margin-bottom: 12px; line-height: 1.6;">${escapeHtml(description).replace(/\n/g, '<br>')}</div>
            ${suggestion ? `<div class="issue-suggestion" style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #0c4a6e; margin-top: 8px;"><strong style="color: #0369a1;">💡 Исправление:</strong> ${escapeHtml(suggestion)}</div>` : ''}
          </div>
        </div>
      `;
    }
  } else {
    // Fallback: render reviewData as markdown-like
    const text = typeof reviewData === 'string' ? reviewData : JSON.stringify(reviewData, null, 2);
    issuesHtml = `<div style="white-space: pre-wrap; font-family: inherit; padding: 16px; background: #f9fafb; border-radius: 8px; color: #1f2937;">${escapeHtml(text)}</div>`;
  }

  // Summary
  const summary = reviewData?.summary || reviewData?.comments || '';
  const summaryHtml = summary
    ? `<div class="review-summary" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;"><h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #1f2937;">${escapeHtml(summary).replace(/\n/g, '<br>')}</h4></div>`
    : '';

  // Verdict
  const verdictMap = {
    approved: '✅ Approved',
    changes_requested: '🔴 Changes Requested',
    commented: '💬 Comments'
  };
  const verdict = reviewData?.verdict ? verdictMap[reviewData.verdict] || reviewData.verdict : '';
  const verdictHtml = verdict
    ? `<div class="review-verdict" style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 10px 16px; margin: 12px 0; font-size: 14px; font-weight: 600; color: #065f46;">${verdict}</div>`
    : '';

  // MR context
  const mrContext = mrDetails
    ? `<div style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border-radius: 6px; font-size: 14px; color: #0c4a6e;">
        <strong>MR Title:</strong> ${escapeHtml(mrDetails.title)}<br>
        <strong>Branch:</strong> ${escapeHtml(mrDetails.source_branch)} → ${escapeHtml(mrDetails.target_branch)}<br>
        <strong>Автор:</strong> ${escapeHtml(mrDetails.author?.name || 'N/A')}<br>
        <strong>Дата:</strong> ${mrDetails.created_at ? new Date(mrDetails.created_at).toLocaleString('ru-RU') : 'N/A'}
      </div>`
    : '';

  const now = new Date().toLocaleString('ru-RU');

  // Build full HTML document
  const htmlContent = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Review — ${safeName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px;
      background: #ffffff;
      color: #1f2937;
      line-height: 1.6;
    }
    h1 {
      font-size: 24px;
      color: #1f2937;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .report-meta {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 24px;
    }
    .review-summary h4 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;
    }
    .review-verdict {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 6px;
      padding: 10px 16px;
      margin: 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: #065f46;
    }
    .issue-block {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin: 16px 0;
      overflow: hidden;
      background: #ffffff;
    }
    .issue-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
      gap: 12px;
      border-left: 4px solid;
    }
    .issue-block-info {
      flex: 1;
      min-width: 0;
    }
    .issue-block-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 4px;
      font-size: 13px;
    }
    .issue-block-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;
    }
    .issue-block-content {
      padding: 16px;
      color: #1f2937;
    }
    .issue-description {
      margin-bottom: 12px;
      line-height: 1.6;
    }
    .issue-suggestion {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      color: #0c4a6e;
    }
    .issue-suggestion strong {
      color: #0369a1;
    }
    @media print {
      body { padding: 12px; }
      .issue-block { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>🤖 AI Code Review Report</h1>
  <div class="report-meta">
    Проект: ${projectId} | MR: ${mergeRequestIid} | Сгенерировано: ${now}
  </div>
  ${mrContext}
  ${summaryHtml}
  ${verdictHtml}
  ${issuesHtml}
</body>
</html>`;

  // Create and download the file
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
