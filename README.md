# 🔍 GitLab MR AI Reviewer

Chrome extension for AI-powered code review on GitLab Merge Requests with support for any LLM via OpenAI-compatible API.

## Features

- ✅ Automatic detection of Merge Request pages in GitLab
- ✅ Integration with **any LLM** through OpenAI API protocol (OpenAI, Ollama, vLLM, LM Studio, and more)
- ✅ Works with **any GitLab installation** (on-premises, gitlab.com)
- ✅ Fetches diff and MR metadata via GitLab API
- ✅ Customizable review prompts
- ✅ Beautiful dark-themed UI with Markdown support

## Installation

### 1. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the extension folder

### 2. Configure LLM Connection

1. Click the extension icon in the toolbar
2. Set the following in the popup:
   - **API Base URL** — URL to your OpenAI-compatible API
   - **API Key** — authorization key (if required)
   - **Model** — model name
3. Click **Test Connection** to verify
4. Click **Save Settings**

### 3. GitLab Token (if required)

For accessing private repositories, you may need a GitLab Personal Access Token:

1. In GitLab, go to **User Settings** → **Access Tokens**
2. Create a token with the `read_api` permission
3. The token is automatically picked up from your GitLab session

> **Note:** If you're logged into GitLab, the extension will attempt to use your session. For private instances, an explicit token may be required.

## LLM Configuration Examples

### OpenAI

```
API Base URL: https://api.openai.com/v1
API Key: sk-...
Model: gpt-4o
```

### Ollama (local, free)

```
API Base URL: http://localhost:11434/v1
API Key: (leave empty)
Model: llama3.1:70b
```

### vLLM

```
API Base URL: http://your-vllm-server:8000/v1
API Key: (your key or leave empty)
Model: meta-llama/Meta-Llama-3-70B-Instruct
```

### LM Studio

```
API Base URL: http://localhost:1234/v1
API Key: (leave empty)
Model: (loaded model name)
```

### Other Compatible APIs

Any service supporting the `/chat/completions` endpoint in OpenAI format:
- Together AI
- OpenRouter
- Azure OpenAI (with appropriate URL)
- Local servers (text-generation-webui, tabby, etc.)

## Usage

1. Open any Merge Request in GitLab
2. The **🤖 AI Review** button appears in the MR header
3. Click it and wait for the result
4. AI analyzes the diff and provides a review

## Prompt Customization

By default, the prompt asks the AI to focus on:
- Bugs and logical errors
- Security vulnerabilities
- Performance issues
- Code quality
- Specific improvement suggestions

You can provide your own prompt in the extension settings.

## Limitations

- **Diff size:** Limited to 5000 lines by default (configurable)
- **Tokens:** Large MRs may exceed your model's token limit
- **Private repositories:** May require a GitLab Personal Access Token

## Project Structure

```
chrome-gitlab-review/
├── manifest.json       # Extension manifest (V3)
├── background.js       # Service Worker (API calls)
├── content.js          # Content Script (page injection)
├── styles.css          # UI styles
├── popup.html          # Settings popup UI
├── popup.js            # Popup logic
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate_icons.py
└── README.md           # This file
```

## Debugging

- **Content script:** Open DevTools on the GitLab page → Console
- **Background script:** `chrome://extensions/` → Details → Service Worker → Inspect
- **Popup:** Open the popup, right-click → Inspect

## Security

- API keys are stored only in Chrome's local storage
- All requests go directly from your machine
- No data is sent to third-party servers (except your chosen LLM)

## License

MIT
