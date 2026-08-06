const state = {
  user: null,
  config: null,
  questions: [],
  currentTypeFilter: '',
  currentQuestion: null
};

const app = document.getElementById('app');
const QUESTION_TYPES = [
  '顺序结构',
  '条件判断',
  '循环结构',
  '数组与列表',
  '字符串',
  '函数',
  '数学计算',
  '模拟',
  '枚举/搜索',
  '递归',
  '综合题'
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function api(path, options = {}) {
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
  if (response.status === 401 && !['/api/login', '/api/register'].includes(path)) {
    state.user = null;
    window.location.hash = '#/login';
    throw new Error(data.error || '请先登录');
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function createIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function toast(message, type = 'error') {
  const root = document.getElementById('toast-root');
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle-2' : 'circle-alert'}"></i>`;
  item.appendChild(document.createTextNode(message));
  root.appendChild(item);
  createIcons();
  setTimeout(() => item.remove(), 4200);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function initials(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1).toUpperCase() : '学';
}

function badge(kind, label, icon) {
  const element = document.createElement('span');
  element.className = `badge badge--${kind}`;
  element.innerHTML = `<i data-lucide="${icon}"></i>`;
  element.appendChild(document.createTextNode(label));
  return element;
}

function statusBadge(status) {
  const map = {
    completed: { label: '已完成', icon: 'check-circle-2', kind: 'completed' },
    analyzing: { label: '分析中', icon: 'loader', kind: 'analyzing' },
    failed: { label: '分析失败', icon: 'circle-alert', kind: 'failed' },
    pending: { label: '待分析', icon: 'clock', kind: 'pending' }
  };
  const meta = map[status] || map.pending;
  return badge(meta.kind, meta.label, meta.icon);
}

function correctnessBadge(value) {
  const map = {
    correct: { label: '思路正确', icon: 'check-circle-2', kind: 'correct' },
    minor: { label: '有小问题', icon: 'triangle-alert', kind: 'minor' },
    wrong: { label: '需要修正', icon: 'circle-alert', kind: 'wrong' },
    'no-code': { label: '未提交代码', icon: 'lightbulb', kind: 'no-code' }
  };
  const meta = map[value] || map.minor;
  return badge(meta.kind, meta.label, meta.icon);
}

function typeBadge(value) {
  const element = document.createElement('span');
  element.className = value ? 'badge badge--type' : 'badge badge--type badge--type--pending';
  element.innerHTML = '<i data-lucide="tag"></i>';
  element.appendChild(document.createTextNode(value || '待识别'));
  return element;
}

function analysisModeLabel(mode) {
  if (mode === 'ai') return 'AI 辅导';
  if (mode === 'local-fallback') return '本地辅导';
  return '本地辅导';
}

function topbar() {
  const connected = Boolean(state.config && state.config.aiConfigured);
  const statusText = connected ? 'AI 已连接' : '本地辅导';
  return `
    <header class="topbar">
      <div class="topbar__brand">
        <span class="brand-mark"><i data-lucide="graduation-cap"></i></span>
        <span class="brand-title">AI 编程辅导</span>
      </div>
      <div class="topbar__right">
        <span class="topbar__status" title="当前辅导模式">
          <span class="status-dot ${connected ? 'status-dot--on' : ''}"></span>
          ${esc(statusText)}
        </span>
        <div class="topbar__user">
          <span class="avatar">${esc(initials(state.user && state.user.displayName))}</span>
          <span class="user-name">${esc(state.user && state.user.displayName)}</span>
          <button class="icon-btn" type="button" data-action="logout" title="退出登录">
            <i data-lucide="log-out"></i>
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderAuth(mode) {
  const isLogin = mode === 'login';
  const title = isLogin ? '登录' : '注册';
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <div class="auth-brand">
          <span class="brand-mark"><i data-lucide="graduation-cap"></i></span>
          <h1>AI 编程辅导</h1>
          <p>${isLogin ? '登录后继续辅导' : '创建学生账号'}</p>
        </div>
        <form class="auth-form" id="auth-form">
          ${isLogin ? '' : `
            <div class="field">
              <label class="field__label" for="display-name">
                <i data-lucide="user"></i> 姓名
              </label>
              <input class="input" id="display-name" name="displayName" maxlength="30" autocomplete="name">
            </div>
          `}
          <div class="field">
            <label class="field__label" for="username">
              <i data-lucide="at-sign"></i> 用户名
            </label>
            <input class="input" id="username" name="username" maxlength="20" autocomplete="username" required>
          </div>
          <div class="field">
            <label class="field__label" for="password">
              <i data-lucide="lock"></i> 密码
            </label>
            <input class="input" id="password" name="password" type="password" maxlength="72" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required>
          </div>
          <p class="error-text" id="auth-error" hidden></p>
          <button class="btn btn--primary btn--block" type="submit" data-label="${title}">
            <i data-lucide="${isLogin ? 'log-in' : 'user-plus'}"></i>
            <span>${title}</span>
          </button>
        </form>
        <div class="auth-switch">
          <span>${isLogin ? '还没有账号？' : '已经有账号？'}</span>
          <button type="button" id="auth-switch">${isLogin ? '去注册' : '去登录'}</button>
        </div>
      </section>
    </main>
  `;

  const form = document.getElementById('auth-form');
  const errorText = document.getElementById('auth-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorText.hidden = true;
    const submitButton = form.querySelector('button[type="submit"]');
    const label = submitButton.dataset.label;
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner"></span> 请稍候';
    const body = {
      username: form.elements.username.value.trim(),
      password: form.elements.password.value
    };
    if (!isLogin) {
      body.displayName = form.elements.displayName ? form.elements.displayName.value.trim() : '';
    }
    try {
      const data = await api(isLogin ? '/api/login' : '/api/register', {
        method: 'POST',
        body
      });
      state.user = data;
      if (window.location.hash === '#/app') {
        renderRoute();
      } else {
        window.location.hash = '#/app';
      }
    } catch (error) {
      errorText.textContent = error.message;
      errorText.hidden = false;
      submitButton.disabled = false;
      submitButton.innerHTML = `<i data-lucide="${isLogin ? 'log-in' : 'user-plus'}"></i><span>${esc(label)}</span>`;
      createIcons();
    }
  });

  document.getElementById('auth-switch').addEventListener('click', () => {
    window.location.hash = isLogin ? '#/register' : '#/login';
  });
  createIcons();
}

function renderDashboard() {
  app.innerHTML = `
    <div class="app-shell">
      ${topbar()}
      <main class="app-main">
        <div class="dashboard-grid">
          <section class="panel">
            <div class="panel__header">
              <h2>新题目辅导</h2>
              <span class="panel__hint">必填：题目、输入样例、输出样例</span>
            </div>
            <div class="panel__body">
              <form class="form-grid" id="question-form">
                <div class="field">
                  <label class="field__label" for="problem-text">
                    <i data-lucide="file-text"></i> 题目描述 <span class="field__required">*</span>
                  </label>
                  <textarea class="textarea" id="problem-text" name="problemText" rows="7" required></textarea>
                </div>
                <div class="field">
                  <label class="field__label" for="sample-input">
                    <i data-lucide="keyboard"></i> 输入样例 <span class="field__required">*</span>
                  </label>
                  <textarea class="textarea textarea--sample" id="sample-input" name="sampleInput" rows="4" required></textarea>
                </div>
                <div class="field">
                  <label class="field__label" for="sample-output">
                    <i data-lucide="monitor"></i> 输出样例 <span class="field__required">*</span>
                  </label>
                  <textarea class="textarea textarea--sample" id="sample-output" name="sampleOutput" rows="4" required></textarea>
                </div>
                <div class="field">
                  <label class="field__label" for="language">
                    <i data-lucide="code-2"></i> 编程语言
                  </label>
                  <select class="select" id="language" name="language">
                    <option value="python">Python</option>
                    <option value="cpp">C++</option>
                    <option value="javascript">JavaScript</option>
                    <option value="scratch">Scratch / 伪代码</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="code">
                    <i data-lucide="braces"></i> 用户代码 <span class="field__hint">选填</span>
                  </label>
                  <textarea class="textarea textarea--code" id="code" name="code" rows="14" spellcheck="false"></textarea>
                </div>
                <div class="form-actions">
                  <button class="btn btn--primary" type="submit" id="submit-question" data-label="开始辅导">
                    <i data-lucide="send"></i>
                    <span>开始辅导</span>
                  </button>
                </div>
              </form>
            </div>
          </section>
          <section class="panel history-panel">
            <div class="panel__header">
              <h2>辅导记录</h2>
              <span class="panel__hint" id="record-count">最近 200 条</span>
            </div>
            <div class="panel__body">
              <div class="record-filters" id="record-filters"></div>
              <div class="record-list" id="record-list">
                <div class="loading-row"><span class="spinner"></span> 加载记录</div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  `;

  const form = document.getElementById('question-form');
  const submitButton = document.getElementById('submit-question');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner"></span> 正在分析';
    const payload = {
      problemText: form.elements.problemText.value.trim(),
      sampleInput: form.elements.sampleInput.value.trim(),
      sampleOutput: form.elements.sampleOutput.value.trim(),
      language: form.elements.language.value,
      code: form.elements.code.value.trim()
    };
    try {
      const record = await api('/api/questions', { method: 'POST', body: payload });
      window.location.hash = `#/record/${record.id}`;
    } catch (error) {
      toast(error.message, 'error');
      submitButton.disabled = false;
      submitButton.innerHTML = '<i data-lucide="send"></i><span>开始辅导</span>';
      createIcons();
    }
  });

  loadQuestions();
  createIcons();
}

async function loadQuestions() {
  const list = document.getElementById('record-list');
  if (!list) return;
  try {
    const data = await api('/api/questions');
    state.questions = data.questions || [];
    renderTypeFilters();
    renderQuestionList();
  } catch (error) {
    list.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<i data-lucide="circle-alert"></i>';
    empty.appendChild(document.createTextNode(error.message));
    list.appendChild(empty);
    createIcons();
  }
}

function renderTypeFilters() {
  const container = document.getElementById('record-filters');
  if (!container) return;
  container.textContent = '';
  const types = [...new Set(state.questions.map((question) => question.questionType).filter(Boolean))];
  const orderedTypes = QUESTION_TYPES.filter((type) => types.includes(type));
  orderedTypes.push(...types.filter((type) => !QUESTION_TYPES.includes(type)));

  const createChip = (type, label) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip';
    if (state.currentTypeFilter === type) chip.classList.add('filter-chip--active');
    chip.dataset.typeFilter = type;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      state.currentTypeFilter = type;
      renderTypeFilters();
      renderQuestionList();
    });
    container.appendChild(chip);
  };

  createChip('', '全部');
  orderedTypes.forEach((type) => createChip(type, type));
}

function renderQuestionList() {
  const list = document.getElementById('record-list');
  if (!list) return;
  list.textContent = '';
  const questions = state.currentTypeFilter
    ? state.questions.filter((question) => question.questionType === state.currentTypeFilter)
    : state.questions;
  const countEl = document.getElementById('record-count');
  if (countEl) countEl.textContent = `共 ${questions.length} 条`;
  if (questions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<i data-lucide="filter"></i>';
    empty.appendChild(document.createTextNode(state.currentTypeFilter ? '这个类型下还没有记录' : '还没有辅导记录'));
    list.appendChild(empty);
  } else {
    questions.forEach((question) => list.appendChild(createRecordItem(question)));
  }
  createIcons();
}

function createRecordItem(question) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'record-item';
  item.addEventListener('click', () => {
    window.location.hash = `#/record/${question.id}`;
  });

  const top = document.createElement('div');
  top.className = 'record-item__top';
  const title = document.createElement('span');
  title.className = 'record-title';
  title.textContent = question.preview || '未命名题目';
  title.title = question.problemText || title.textContent;
  const badges = document.createElement('div');
  badges.className = 'record-item__badges';
  badges.append(typeBadge(question.questionType), statusBadge(question.status));
  top.append(title, badges);

  const meta = document.createElement('div');
  meta.className = 'record-item__meta';
  const language = document.createElement('span');
  language.innerHTML = '<i data-lucide="code-2"></i>';
  language.appendChild(document.createTextNode(question.languageName));
  const time = document.createElement('span');
  time.innerHTML = '<i data-lucide="clock"></i>';
  time.appendChild(document.createTextNode(formatDate(question.createdAt)));
  const codeState = document.createElement('span');
  codeState.innerHTML = `<i data-lucide="${question.code ? 'file-code-2' : 'file-question'}"></i>`;
  codeState.appendChild(document.createTextNode(question.code ? '已提交代码' : '仅思路'));
  meta.append(language, time, codeState);

  item.append(top, meta);
  return item;
}

async function renderRecord(id) {
  app.innerHTML = `
    <div class="app-shell">
      ${topbar()}
      <main class="app-main">
        <div class="record-detail__header">
          <div>
            <h1 class="record-detail__title">辅导记录</h1>
            <div class="record-detail__subtitle" id="record-subtitle"></div>
          </div>
          <div class="record-detail__actions">
            <button class="btn btn--ghost" type="button" data-action="back">
              <i data-lucide="arrow-left"></i><span>返回</span>
            </button>
            <button class="btn btn--danger" type="button" data-action="delete" data-id="${esc(id)}">
              <i data-lucide="trash-2"></i><span>删除</span>
            </button>
          </div>
        </div>
        <div class="record-detail__content" id="record-content">
          <div class="loading-row"><span class="spinner"></span> 加载记录</div>
        </div>
      </main>
    </div>
  `;
  createIcons();
  try {
    const data = await api(`/api/questions/${id}`);
    state.currentQuestion = data.question;
    renderRecordContent(data.question);
  } catch (error) {
    const content = document.getElementById('record-content');
    content.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<i data-lucide="circle-alert"></i>';
    empty.appendChild(document.createTextNode(error.message));
    content.appendChild(empty);
  }
}

function renderRecordContent(question) {
  const detailTitle = document.querySelector('.record-detail__title');
  if (detailTitle) detailTitle.textContent = question.preview || '辅导记录';
  const subtitle = document.getElementById('record-subtitle');
  subtitle.textContent = '';
  const language = document.createElement('span');
  language.innerHTML = '<i data-lucide="code-2"></i>';
  language.appendChild(document.createTextNode(question.languageName));
  const time = document.createElement('span');
  time.innerHTML = '<i data-lucide="clock"></i>';
  time.appendChild(document.createTextNode(formatDate(question.createdAt)));
  const type = typeBadge(question.questionType);
  subtitle.append(language, time, type, statusBadge(question.status));

  const content = document.getElementById('record-content');
  content.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'detail-grid';

  const problemPanel = document.createElement('section');
  problemPanel.className = 'panel';
  problemPanel.innerHTML = '<div class="panel__header"><h2>题目信息</h2></div>';
  const problemBody = document.createElement('div');
  problemBody.className = 'panel__body';
  problemBody.append(
    createSection('题目描述', 'file-text', createTextBlock('preview-text', question.problemText)),
    createSection('样例输入', 'keyboard', createTextBlock('preview-text preview-text--code', question.sampleInput)),
    createSection('样例输出', 'monitor', createTextBlock('preview-text preview-text--code', question.sampleOutput)),
    createSection('学生代码', 'braces', createCodeBlock(question.code))
  );
  problemPanel.append(problemBody);

  const analysisPanel = document.createElement('section');
  analysisPanel.className = 'panel';
  analysisPanel.innerHTML = '<div class="panel__header"><h2>辅导结果</h2></div>';
  const analysisBody = document.createElement('div');
  analysisBody.className = 'panel__body';

  if (question.status === 'analyzing') {
    const loading = document.createElement('div');
    loading.className = 'loading-row';
    loading.innerHTML = '<span class="spinner"></span> 正在生成辅导结果';
    analysisBody.appendChild(loading);
  } else if (question.status === 'failed') {
    analysisBody.appendChild(createFailedState(question));
  } else if (question.aiResponse) {
    analysisBody.append(...createAnalysisSections(question));
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<i data-lucide="sparkles"></i>';
    empty.appendChild(document.createTextNode('暂无辅导结果'));
    analysisBody.appendChild(empty);
  }
  analysisPanel.append(analysisBody);
  grid.append(problemPanel, analysisPanel);
  content.appendChild(grid);
  appendFollowUpSection(analysisBody, question.id);
  createIcons();
}

function appendFollowUpSection(container, questionId) {
  const section = document.createElement('section');
  section.className = 'followup-section';
  section.innerHTML = `
    <div class="followup-section__head">
      <i data-lucide="message-circle"></i>
      <h3>继续追问</h3>
      <span>看完解析后，把还不明白的地方写下来</span>
    </div>
    <div class="followup-messages" id="followup-messages">
      <div class="loading-row"><span class="spinner"></span>加载追问记录</div>
    </div>
    <form class="followup-form" id="followup-form">
      <textarea class="textarea followup-input" id="followup-input" rows="2" maxlength="4000" placeholder="写下你还不明白的地方，例如：为什么这里要用循环？"></textarea>
      <div class="form-actions">
        <button class="btn btn--primary" type="submit">
          <i data-lucide="send"></i><span>发送追问</span>
        </button>
      </div>
    </form>
  `;
  container.appendChild(section);
  loadFollowUp(questionId);

  const form = document.getElementById('followup-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('followup-input');
    const content = input.value.trim();
    if (!content) return;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner"></span><span>回答中</span>';
    input.value = '';
    appendLocalFollowUpMessage(content);
    appendTypingIndicator();
    try {
      const data = await api(`/api/questions/${questionId}/messages`, {
        method: 'POST',
        body: { content }
      });
      renderFollowUpMessages(data.messages || []);
    } catch (error) {
      removeTypingIndicator();
      const localUser = document.getElementById('followup-local-user');
      if (localUser) localUser.remove();
      toast(error.message, 'error');
      input.value = content;
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = '<i data-lucide="send"></i><span>发送追问</span>';
      createIcons();
    }
  });
}

async function loadFollowUp(questionId) {
  const container = document.getElementById('followup-messages');
  if (!container) return;
  try {
    const data = await api(`/api/questions/${questionId}/messages`);
    renderFollowUpMessages(data.messages || []);
  } catch (error) {
    container.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state followup-empty';
    empty.textContent = error.message;
    container.appendChild(empty);
  }
}

function renderFollowUpMessages(messages) {
  const container = document.getElementById('followup-messages');
  if (!container) return;
  container.textContent = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state followup-empty';
    empty.innerHTML = '<i data-lucide="message-circle"></i>';
    empty.appendChild(document.createTextNode('还没有追问。看完解析后，可以把还不明白的地方写下来继续问。'));
    container.appendChild(empty);
    createIcons();
    return;
  }
  messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = `followup-message followup-message--${message.role}`;
    const meta = document.createElement('div');
    meta.className = 'followup-message__meta';
    meta.textContent = message.role === 'user' ? '你' : '老师';
    const text = document.createElement('div');
    text.className = 'followup-message__text';
    text.textContent = message.content;
    item.append(meta, text);
    container.appendChild(item);
  });
  container.scrollTop = container.scrollHeight;
}

function appendLocalFollowUpMessage(content) {
  const container = document.getElementById('followup-messages');
  if (!container) return;
  const empty = container.querySelector('.followup-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'followup-message followup-message--user';
  item.id = 'followup-local-user';
  item.innerHTML = '<div class="followup-message__meta">你</div><div class="followup-message__text"></div>';
  item.querySelector('.followup-message__text').textContent = content;
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
  const container = document.getElementById('followup-messages');
  if (!container) return;
  const existing = document.getElementById('followup-typing');
  if (existing) existing.remove();
  const item = document.createElement('div');
  item.className = 'followup-message followup-message--assistant';
  item.id = 'followup-typing';
  item.innerHTML = `
    <div class="followup-message__meta">老师</div>
    <div class="followup-message__text followup-message__text--typing">
      <span></span><span></span><span></span>
    </div>
  `;
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const item = document.getElementById('followup-typing');
  if (item) item.remove();
}

function createSection(title, iconName, bodyElement) {
  const section = document.createElement('section');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = `<i data-lucide="${iconName}"></i>`;
  head.appendChild(document.createTextNode(title));
  section.append(head, bodyElement);
  return section;
}

function createTextBlock(className, value) {
  const element = document.createElement('p');
  element.className = className || 'preview-text';
  element.textContent = value || '（未填写）';
  return element;
}

function createCodeBlock(code) {
  if (!code || !code.trim()) {
    const placeholder = document.createElement('div');
    placeholder.className = 'code-placeholder';
    placeholder.appendChild(document.createTextNode('未提交代码'));
    return placeholder;
  }
  const pre = document.createElement('pre');
  pre.className = 'code-block';
  const codeElement = document.createElement('code');
  codeElement.textContent = code;
  pre.appendChild(codeElement);
  return pre;
}

function createReferenceSection(question) {
  const response = question.aiResponse;
  const pseudoCode = (response.pseudoCode || '').trim();
  const snippets = Array.isArray(response.keySnippets)
    ? response.keySnippets.filter((item) => item && (item.code || item.explanation))
    : [];
  const fixedCode = (response.fixedCode || '').trim();
  if (!pseudoCode && !snippets.length && !fixedCode) return null;

  const section = document.createElement('section');
  section.className = 'reference-guide';

  const head = document.createElement('div');
  head.className = 'reference-guide__head';
  head.innerHTML = '<i data-lucide="unlock"></i>';
  const headText = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = '参考实现';
  const hint = document.createElement('p');
  hint.textContent = '先自己试，再按顺序解锁关键片段和完整代码';
  headText.append(title, hint);
  head.appendChild(headText);
  section.appendChild(head);

  const firstBody = pseudoCode
    ? createTextBlock('reference-text', pseudoCode)
    : createTextBlock(
        'reference-text',
        question.code
          ? '你已提交代码，先对照上面的思路检查读入、处理、输出三部分是否完整，再继续解锁。'
          : '你还没有提交代码，建议先按上面的完整解题思路自己写一版，再继续解锁。'
      );
  section.appendChild(createReferenceStep({
    number: 1,
    title: '先自己试',
    subtitle: '思路与伪代码',
    open: true,
    body: firstBody
  }));

  if (snippets.length) {
    const snippetsBody = document.createElement('div');
    snippetsBody.className = 'reference-step__content';
    snippets.forEach((snippet) => snippetsBody.appendChild(createReferenceSnippet(snippet)));
    section.appendChild(createReferenceStep({
      number: 2,
      title: '关键片段',
      subtitle: '只展示核心实现，不给完整答案',
      locked: true,
      body: snippetsBody
    }));
  }

  if (fixedCode) {
    const codeBody = document.createElement('div');
    codeBody.className = 'reference-step__content';
    codeBody.appendChild(createCodePanel(fixedCode, '完整参考代码'));
    section.appendChild(createReferenceStep({
      number: 3,
      title: '完整参考代码',
      subtitle: question.code ? '对照你的实现检查' : '建议先自己写一版再查看',
      locked: snippets.length > 0,
      body: codeBody
    }));
  }

  return section;
}

function createReferenceStep({ number, title, subtitle, body, open = false, locked = false }) {
  const step = document.createElement('div');
  step.className = 'reference-step';
  step.dataset.step = String(number);
  if (open) step.classList.add('reference-step--open');
  if (locked) step.classList.add('reference-step--locked');

  const head = document.createElement('div');
  head.className = 'reference-step__head';
  const numberEl = document.createElement('span');
  numberEl.className = 'reference-step__number';
  numberEl.textContent = String(number);
  const info = document.createElement('div');
  info.className = 'reference-step__info';
  const infoTitle = document.createElement('strong');
  infoTitle.textContent = title;
  const infoSubtitle = document.createElement('span');
  infoSubtitle.textContent = subtitle;
  info.append(infoTitle, infoSubtitle);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn--ghost reference-step__toggle';
  toggle.disabled = locked;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.innerHTML = open
    ? '<i data-lucide="minus"></i><span>收起</span>'
    : `<i data-lucide="${locked ? 'lock' : 'unlock'}"></i><span>${locked ? '先解锁上一步' : '查看'}</span>`;
  head.append(numberEl, info, toggle);

  body.className = `reference-step__body ${body.className || ''}`.trim();
  body.hidden = !open;
  step.append(head, body);

  toggle.addEventListener('click', () => {
    const isOpen = !body.hidden;
    if (isOpen) {
      body.hidden = true;
      step.classList.remove('reference-step--open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<i data-lucide="unlock"></i><span>查看</span>';
    } else {
      body.hidden = false;
      step.classList.add('reference-step--open');
      step.classList.remove('reference-step--locked');
      toggle.disabled = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.innerHTML = '<i data-lucide="minus"></i><span>收起</span>';
      const nextStep = step.parentElement.querySelector(`.reference-step[data-step="${number + 1}"]`);
      if (nextStep) {
        const nextToggle = nextStep.querySelector('.reference-step__toggle');
        if (nextToggle) {
          nextToggle.disabled = false;
          nextStep.classList.remove('reference-step--locked');
          nextToggle.setAttribute('aria-expanded', 'false');
          nextToggle.innerHTML = '<i data-lucide="unlock"></i><span>查看</span>';
        }
      }
    }
    createIcons();
    if (!body.hidden) step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  return step;
}

function createReferenceSnippet(snippet) {
  const item = document.createElement('article');
  item.className = 'snippet-item';
  const head = document.createElement('div');
  head.className = 'snippet-item__head';
  head.innerHTML = '<i data-lucide="braces"></i>';
  const title = document.createElement('strong');
  title.textContent = snippet.title || '关键片段';
  head.appendChild(title);
  item.appendChild(head);
  if (snippet.explanation) {
    const explanation = document.createElement('p');
    explanation.className = 'snippet-item__explanation';
    explanation.textContent = snippet.explanation;
    item.appendChild(explanation);
  }
  if (snippet.code) item.appendChild(createCodePanel(snippet.code, '片段代码'));
  return item;
}

function createCodePanel(code, label) {
  const panel = document.createElement('div');
  panel.className = 'code-panel';
  const toolbar = document.createElement('div');
  toolbar.className = 'code-toolbar';
  const labelEl = document.createElement('span');
  labelEl.textContent = label || '代码';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn--ghost btn--small';
  copy.innerHTML = '<i data-lucide="copy"></i><span>复制</span>';
  copy.addEventListener('click', () => copyText(code));
  toolbar.append(labelEl, copy);
  panel.append(toolbar, createCodeBlock(code));
  return panel;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      toast('代码已复制', 'success');
      return;
    }
  } catch {
    // 继续走兼容复制。
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  toast(copied ? '代码已复制' : '复制失败，请手动选择代码', copied ? 'success' : 'error');
}

function createDiagnosisCard(response, question) {
  const card = document.createElement('div');
  card.className = 'analysis-summary diagnosis-card';

  const head = document.createElement('div');
  head.className = 'analysis-head';
  const mode = document.createElement('h3');
  mode.textContent = analysisModeLabel(question.analysisMode);
  head.append(mode, correctnessBadge(response.correctness));
  card.appendChild(head);

  const summaryText = document.createElement('p');
  summaryText.className = 'diagnosis-card__summary';
  summaryText.textContent = response.summary || '已完成分析';
  card.appendChild(summaryText);

  if (response.notice) {
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.innerHTML = '<i data-lucide="triangle-alert"></i>';
    notice.appendChild(document.createTextNode(response.notice));
    card.appendChild(notice);
  }

  const diagnosis = Array.isArray(response.diagnosis)
    ? response.diagnosis.filter((item) => item && item.content)
    : [];
  if (diagnosis.length) {
    const rows = document.createElement('div');
    rows.className = 'diagnosis-rows';
    diagnosis.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'diagnosis-row';
      const label = document.createElement('span');
      label.className = 'diagnosis-row__label';
      label.textContent = item.title || ['现在', '原因', '改法'][index] || `第 ${index + 1} 步`;
      const text = document.createElement('p');
      text.className = 'diagnosis-row__text';
      text.textContent = item.content;
      row.append(label, text);
      rows.appendChild(row);
    });
    card.appendChild(rows);
  }

  const sampleChecks = Array.isArray(response.sampleChecks)
    ? response.sampleChecks.filter((item) => item && (item.expected || item.actual || item.note))
    : [];
  if (sampleChecks.length) {
    const block = document.createElement('div');
    block.className = 'diagnosis-block';
    const blockHead = document.createElement('div');
    blockHead.className = 'diagnosis-block__head';
    blockHead.innerHTML = '<i data-lucide="git-compare"></i><span>样例对照</span>';
    const list = document.createElement('div');
    list.className = 'sample-check__list';
    sampleChecks.forEach((sample) => list.appendChild(createSampleCheckItem(sample)));
    block.append(blockHead, list);
    card.appendChild(block);
  }

  const actionItems = Array.isArray(response.actionItems) ? response.actionItems.filter(Boolean) : [];
  if (actionItems.length) {
    const block = document.createElement('div');
    block.className = 'diagnosis-block';
    const blockHead = document.createElement('div');
    blockHead.className = 'diagnosis-block__head';
    blockHead.innerHTML = '<i data-lucide="check-square"></i><span>先做这几步</span>';
    const checklist = document.createElement('div');
    checklist.className = 'action-checklist';
    actionItems.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'action-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const text = document.createElement('span');
      text.textContent = item;
      label.append(checkbox, text);
      checklist.appendChild(label);
    });
    block.append(blockHead, checklist);
    card.appendChild(block);
  }

  return card;
}

function createSampleCheckItem(sample) {
  const item = document.createElement('article');
  item.className = 'sample-check__item';
  const grid = document.createElement('div');
  grid.className = 'sample-check__grid';
  grid.append(
    createSampleCheckField('输入', sample.input),
    createSampleCheckField('期望输出', sample.expected),
    createSampleCheckField('当前输出（AI 预估）', sample.actual)
  );
  item.appendChild(grid);
  if (sample.note) {
    const note = document.createElement('p');
    note.className = 'sample-check__note';
    note.textContent = sample.note;
    item.appendChild(note);
  }
  return item;
}

function createSampleCheckField(label, value) {
  const field = document.createElement('div');
  field.className = 'sample-check__field';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('pre');
  valueEl.className = 'sample-check__value';
  valueEl.textContent = value || '（未提供）';
  field.append(labelEl, valueEl);
  return field;
}

function createDetailsSection(title, iconName, bodyElement) {
  const details = document.createElement('details');
  details.className = 'details-section';
  const summary = document.createElement('summary');
  summary.className = 'details-section__summary';
  const icon = document.createElement('i');
  icon.dataset.lucide = iconName;
  icon.className = 'details-section__icon';
  const label = document.createElement('span');
  label.textContent = title;
  const chevron = document.createElement('i');
  chevron.dataset.lucide = 'chevron-down';
  chevron.className = 'details-section__chevron';
  summary.append(icon, label, chevron);
  details.append(summary, bodyElement);
  return details;
}

function createAnalysisSections(question) {
  const response = question.aiResponse;
  const sections = [];
  sections.push(createDiagnosisCard(response, question));

  if (response.issues && response.issues.length) {
    const body = document.createElement('div');
    body.className = 'details-section__body';
    const list = document.createElement('div');
    list.className = 'issue-list';
    response.issues.forEach((issue) => list.appendChild(createIssueItem(issue)));
    body.appendChild(list);
    sections.push(createDetailsSection('详细问题', 'list-checks', body));
  }

  if (response.approach) {
    const body = document.createElement('div');
    body.className = 'details-section__body';
    body.appendChild(createTextBlock('approach-text', response.approach));
    sections.push(createDetailsSection('完整讲解', 'route', body));
  }
  const referenceSection = createReferenceSection(question);
  if (referenceSection) {
    sections.push(referenceSection);
  }
  if (response.practice) {
    const section = createSection('下一步练习', 'target', createTextBlock('practice-text', response.practice));
    section.classList.add('section--practice');
    sections.push(section);
  }
  return sections;
}

function createIssueItem(issue) {
  const item = document.createElement('div');
  item.className = 'issue-item';
  const head = document.createElement('div');
  head.className = 'issue-item__head';
  const severityMap = {
    error: { icon: 'circle-alert', label: '错误', kind: 'error' },
    warning: { icon: 'triangle-alert', label: '提醒', kind: 'warning' },
    tip: { icon: 'lightbulb', label: '建议', kind: 'tip' }
  };
  const meta = severityMap[issue.severity] || severityMap.warning;
  const icon = document.createElement('span');
  icon.className = `severity-icon severity-icon--${meta.kind}`;
  icon.innerHTML = `<i data-lucide="${meta.icon}"></i>`;
  const title = document.createElement('span');
  title.className = 'issue-item__title';
  title.textContent = issue.title || meta.label;
  head.append(icon, title);
  if (issue.location) {
    const location = document.createElement('span');
    location.className = 'issue-item__location';
    location.textContent = issue.location;
    head.appendChild(location);
  }

  const body = document.createElement('div');
  body.className = 'issue-item__text';
  if (issue.explanation) {
    const explanation = document.createElement('div');
    explanation.textContent = issue.explanation;
    body.appendChild(explanation);
  }
  if (issue.suggestion) {
    const suggestion = document.createElement('div');
    suggestion.className = 'issue-item__suggestion';
    suggestion.textContent = `建议：${issue.suggestion}`;
    body.appendChild(suggestion);
  }
  item.append(head, body);
  return item;
}

function createFailedState(question) {
  const section = document.createElement('section');
  section.className = 'section';
  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = '<i data-lucide="circle-alert"></i>';
  head.appendChild(document.createTextNode('分析失败'));
  const text = document.createElement('p');
  text.className = 'preview-text';
  text.textContent = question.errorMessage || 'AI 分析失败，请重试。';
  const button = document.createElement('button');
  button.className = 'btn btn--primary';
  button.type = 'button';
  button.dataset.action = 'reanalyze';
  button.dataset.id = String(question.id);
  button.innerHTML = '<i data-lucide="refresh-cw"></i><span>重新分析</span>';
  section.append(head, text, button);
  return section;
}

async function handleAction(action, element) {
  if (action === 'logout') {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      // 本地会话已失效也直接回到登录页。
    }
    state.user = null;
    state.currentTypeFilter = '';
    if (window.location.hash === '#/login') {
      renderRoute();
    } else {
      window.location.hash = '#/login';
    }
    return;
  }
  if (action === 'home') {
    window.location.hash = '#/app';
    return;
  }
  if (action === 'back') {
    window.location.hash = '#/app';
    return;
  }
  if (action === 'delete') {
    const id = element.dataset.id;
    if (!window.confirm('确定删除这条辅导记录吗？')) return;
    try {
      await api(`/api/questions/${id}`, { method: 'DELETE' });
      window.location.hash = '#/app';
      toast('记录已删除', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
    return;
  }
  if (action === 'reanalyze') {
    const id = element.dataset.id;
    const button = element.closest('button') || element;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> 正在分析';
    try {
      await api(`/api/questions/${id}/reanalyze`, { method: 'POST' });
      await renderRecord(id);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.innerHTML = '<i data-lucide="refresh-cw"></i><span>重新分析</span>';
      createIcons();
    }
    return;
  }
}

async function boot() {
  try {
    state.user = await api('/api/me');
  } catch {
    state.user = null;
  }
  try {
    state.config = await api('/api/config');
  } catch {
    state.config = null;
  }

  document.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (actionElement) handleAction(actionElement.dataset.action, actionElement);
  });
  window.addEventListener('hashchange', () => {
    if (state.user) renderRoute();
    else renderRoute();
  });
  renderRoute();
}

async function renderRoute() {
  const hash = window.location.hash || '#/app';
  if (!state.user) {
    renderAuth(hash === '#/register' ? 'register' : 'login');
    return;
  }
  if (hash.startsWith('#/record/')) {
    const id = hash.split('/')[2];
    if (id) {
      await renderRecord(id);
      return;
    }
  }
  renderDashboard();
}

if (window.location.protocol === 'file:') {
  app.innerHTML = '<div class="startup-error">请先启动本地服务：在项目目录运行 <code>node server.js</code>，然后打开 <code>http://localhost:3000</code>。</div>';
} else {
  boot();
}
