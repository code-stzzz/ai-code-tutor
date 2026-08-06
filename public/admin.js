const root = document.getElementById('admin-root');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function createIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

async function request(path, options = {}) {
  const init = {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  };
  if (init.body && typeof init.body !== 'string') {
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(path, init);
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setResult(message, type = 'success') {
  const result = document.getElementById('admin-result');
  if (!result) return;
  result.textContent = message;
  result.hidden = false;
  result.className = `admin-result admin-result--${type}`;
}

function renderLogin(message = '') {
  root.innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <div class="auth-brand">
          <span class="brand-mark"><i data-lucide="shield"></i></span>
          <h1>管理员配置</h1>
          <p>登录后管理 DeepSeek API</p>
        </div>
        <form class="auth-form" id="admin-login-form">
          <div class="field">
            <label class="field__label" for="admin-password">
              <i data-lucide="key-round"></i> 管理员密码
            </label>
            <input class="input" id="admin-password" name="password" type="password" required autocomplete="current-password">
          </div>
          <p class="error-text" id="admin-login-error" hidden></p>
          <button class="btn btn--primary btn--block" type="submit">
            <i data-lucide="log-in"></i><span>登录</span>
          </button>
        </form>
        <div class="auth-switch">
          <span>学生端</span>
          <a href="index.html">返回网站</a>
        </div>
      </section>
    </main>
  `;

  const errorText = document.getElementById('admin-login-error');
  if (message) {
    errorText.textContent = message;
    errorText.hidden = false;
  }

  const form = document.getElementById('admin-login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorText.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span><span>登录中</span>';
    try {
      await request('/api/admin/login', {
        method: 'POST',
        body: { password: form.elements.password.value }
      });
      await loadConfig();
    } catch (error) {
      errorText.textContent = error.message;
      errorText.hidden = false;
      button.disabled = false;
      button.innerHTML = '<i data-lucide="log-in"></i><span>登录</span>';
      createIcons();
    }
  });
  createIcons();
}

function renderConfig(config, message = '') {
  const timeoutSeconds = Math.round((config.aiTimeoutMs || 120000) / 1000);
  const keyPlaceholder = config.aiConfigured
    ? `已保存 ${esc(config.keyMasked)}，留空则不修改`
    : '请输入 DeepSeek API Key';

  root.innerHTML = `
    <main class="admin-main">
      <header class="admin-header">
        <div class="admin-header__title">
          <span class="brand-mark"><i data-lucide="settings-2"></i></span>
          <div>
            <h1>DeepSeek API 配置</h1>
            <p>保存后立即生效，不影响学生端使用。</p>
          </div>
        </div>
        <div class="admin-header__actions">
          <button class="btn btn--ghost" type="button" data-action="home">
            <i data-lucide="external-link"></i><span>返回网站</span>
          </button>
          <button class="btn btn--danger" type="button" data-action="logout">
            <i data-lucide="log-out"></i><span>退出管理</span>
          </button>
        </div>
      </header>

      <section class="panel admin-panel">
        <div class="panel__header">
          <h2>当前状态</h2>
        </div>
        <div class="panel__body">
          <div class="admin-status">
            <span class="status-dot ${config.aiConfigured ? 'status-dot--on' : ''}"></span>
            <span>${config.aiConfigured ? `已配置 AI：${esc(config.keyMasked)}` : '未配置 API Key，当前使用本地辅导'}</span>
          </div>
        </div>
      </section>

      <form class="panel admin-panel" id="admin-config-form">
        <div class="panel__header">
          <h2>接口配置</h2>
          <span class="panel__hint">DeepSeek 兼容 OpenAI Chat Completions 接口</span>
        </div>
        <div class="panel__body form-grid">
          <div class="field">
            <label class="field__label" for="ai-base-url">
              <i data-lucide="link"></i> 接口地址
            </label>
            <input class="input" id="ai-base-url" name="aiBaseUrl" value="${esc(config.aiBaseUrl)}" placeholder="https://api.deepseek.com" required>
          </div>
          <div class="field">
            <label class="field__label" for="ai-model">
              <i data-lucide="cpu"></i> 模型名称
            </label>
            <input class="input" id="ai-model" name="aiModel" value="${esc(config.aiModel)}" placeholder="deepseek-chat" required>
          </div>
          <div class="field">
            <label class="field__label" for="ai-api-key">
              <i data-lucide="key-round"></i> API Key
            </label>
            <input class="input" id="ai-api-key" name="aiApiKey" type="password" autocomplete="new-password" placeholder="${esc(keyPlaceholder)}">
            <label class="checkbox-line">
              <input type="checkbox" id="clear-key"> 清除已保存的 Key
            </label>
          </div>
          <div class="field">
            <label class="field__label" for="ai-timeout">
              <i data-lucide="timer"></i> 请求超时（秒）
            </label>
            <input class="input" id="ai-timeout" name="aiTimeout" type="number" min="5" max="300" value="${esc(timeoutSeconds)}" required>
          </div>
          <div class="form-actions admin-form-actions">
            <button class="btn btn--ghost" type="button" id="test-connection">
              <i data-lucide="plug"></i><span>测试连接</span>
            </button>
            <button class="btn btn--primary" type="submit">
              <i data-lucide="save"></i><span>保存配置</span>
            </button>
          </div>
          <div class="admin-result" id="admin-result" hidden></div>
        </div>
      </form>
    </main>
  `;

  if (message) {
    setResult(message, 'success');
  }

  const form = document.getElementById('admin-config-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner"></span><span>保存中</span>';
    try {
      await request('/api/admin/config', {
        method: 'POST',
        body: {
          aiBaseUrl: form.elements.aiBaseUrl.value.trim(),
          aiModel: form.elements.aiModel.value.trim(),
          aiTimeoutMs: Number(form.elements.aiTimeout.value) * 1000,
          aiApiKey: form.elements.aiApiKey.value.trim(),
          clearKey: document.getElementById('clear-key').checked
        }
      });
      const updated = await request('/api/admin/config');
      renderConfig(updated, '配置已保存，学生端会立即使用新的 AI 设置。');
    } catch (error) {
      setResult(error.message, 'error');
      submitButton.disabled = false;
      submitButton.innerHTML = '<i data-lucide="save"></i><span>保存配置</span>';
      createIcons();
    }
  });

  document.getElementById('test-connection').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setResult('正在测试连接...', 'info');
    try {
      const data = await request('/api/admin/test', { method: 'POST' });
      setResult(data.message, 'success');
    } catch (error) {
      setResult(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    try {
      await request('/api/admin/logout', { method: 'POST' });
    } catch {
      // 会话可能已经过期，仍然回到登录页。
    }
    renderLogin();
  });

  document.querySelector('[data-action="home"]').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  createIcons();
}

async function loadConfig() {
  try {
    const config = await request('/api/admin/config');
    renderConfig(config);
  } catch (error) {
    renderLogin(error.status === 401 ? '' : error.message);
  }
}

if (window.location.protocol === 'file:') {
  root.innerHTML = '<div class="startup-error">请先启动本地服务：在项目目录运行 <code>node server.js</code>，然后打开 <code>http://localhost:3000/admin.html</code>。</div>';
} else {
  loadConfig();
}
