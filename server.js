const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'ai-tutor.db');
const SESSION_COOKIE = 'ai_tutor_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_COOKIE = 'ai_tutor_admin';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const adminSessions = new Map();
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const AI_LANGUAGES = {
  python: 'Python',
  cpp: 'C++',
  javascript: 'JavaScript',
  scratch: 'Scratch/伪代码',
  other: '其他'
};
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

loadEnv();
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem_text TEXT NOT NULL,
    sample_input TEXT NOT NULL,
    sample_output TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'python',
    code TEXT,
    question_type TEXT,
    ai_response TEXT,
    analysis_mode TEXT,
    error_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS question_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_questions_user_id ON questions(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_question_messages_question_id ON question_messages(question_id, id);
`);

const questionColumns = db.prepare('PRAGMA table_info(questions)').all();
if (!questionColumns.some((column) => column.name === 'question_type')) {
  db.exec('ALTER TABLE questions ADD COLUMN question_type TEXT');
}

function parseEnvValue(raw) {
  const value = String(raw || '').trim();
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
    return value.slice(1, -1).replace(/\\'/g, "'");
  }
  return value;
}

function loadEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = parseEnvValue(line.slice(eq + 1));
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    console.warn('无法读取 .env，将使用默认配置。', error.message);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求内容不是有效 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'admin123456';
}

function verifyAdminPassword(input) {
  const actual = crypto.createHash('sha256').update(String(input || '')).digest();
  const expected = crypto.createHash('sha256').update(getAdminPassword()).digest();
  return crypto.timingSafeEqual(actual, expected);
}

function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}; SameSite=Lax`
  );
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function requireAdminSession(req) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function getAiEnvConfig() {
  return {
    aiBaseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
    aiModel: process.env.AI_MODEL || 'deepseek-chat',
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS) || 120000,
    aiApiKey: process.env.AI_API_KEY || ''
  };
}

function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function formatEnvValue(value) {
  const text = String(value ?? '');
  if (/^[\w\-./:@#+]*$/.test(text)) return text;
  return JSON.stringify(text);
}

function writeEnvFile(updates) {
  const envPath = path.join(ROOT, '.env');
  const entries = Object.entries(updates);
  const seen = new Set();
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    : [];

  const output = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = line.indexOf('=');
    if (eq <= 0) return line;
    const key = line.slice(0, eq).trim();
    const entry = entries.find(([entryKey]) => entryKey === key);
    if (!entry) return line;
    seen.add(key);
    return `${key}=${formatEnvValue(entry[1])}`;
  });

  for (const [key, value] of entries) {
    if (!seen.has(key)) output.push(`${key}=${formatEnvValue(value)}`);
  }

  fs.writeFileSync(envPath, output.join('\n') + (output.length ? '\n' : ''), 'utf8');
  for (const [key, value] of entries) {
    process.env[key] = String(value ?? '');
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('接口地址不能为空');
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('接口地址必须使用 http 或 https');
  }
  return trimmed;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, now.toISOString(), expiresAt.toISOString());
  return token;
}

function getCurrentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.user_id, s.expires_at, u.username, u.display_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return {
    id: Number(row.user_id),
    username: row.username,
    displayName: row.display_name
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isValidUsername(value) {
  return typeof value === 'string' && /^[\w\u4e00-\u9fa5]{2,20}$/.test(value.trim());
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 72;
}

function cleanText(value, maxLength = 50000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeQuestionType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (QUESTION_TYPES.includes(text)) return text;
  if (!text) return '综合题';
  const aliases = [
    ['顺序结构', ['顺序', 'sequence', '入门', '输入输出']],
    ['条件判断', ['条件', '判断', '分支', 'if', 'else', 'condition']],
    ['循环结构', ['循环', 'for', 'while', 'loop', 'repeat']],
    ['数组与列表', ['数组', '列表', 'array', 'list']],
    ['字符串', ['字符串', 'string', '字符']],
    ['函数', ['函数', 'function', 'def']],
    ['数学计算', ['数学', '计算', '算术', 'math']],
    ['模拟', ['模拟', 'simulation', 'simulate']],
    ['枚举/搜索', ['枚举', '搜索', '查找', 'search']],
    ['递归', ['递归', 'recursion']]
  ];
  for (const [type, keywords] of aliases) {
    if (keywords.some((keyword) => text.includes(keyword))) return type;
  }
  return '综合题';
}

function makeQuestionPreview(problemText) {
  const lines = String(problemText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let text = '';
  for (const line of lines) {
    const cleaned = line
      .replace(/^[#>*\-一二三四五六七八九十\d]+[.、)）:：]?\s*/, '')
      .replace(/^【[^】]+】\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) {
      text = text ? `${text} ${cleaned}` : cleaned;
      if (text.length >= 10) break;
    }
  }
  if (!text) return '未命名题目';
  const ellipsis = text.length > 60 ? '…' : '';
  return text.slice(0, 60) + ellipsis;
}

function serializeQuestion(row) {
  if (!row) return null;
  let aiResponse = null;
  if (row.ai_response) {
    try {
      aiResponse = JSON.parse(row.ai_response);
    } catch {
      aiResponse = null;
    }
  }
  return {
    id: Number(row.id),
    problemText: row.problem_text,
    sampleInput: row.sample_input,
    sampleOutput: row.sample_output,
    language: row.language,
    languageName: AI_LANGUAGES[row.language] || row.language,
    code: row.code,
    questionType: row.question_type || '',
    aiResponse,
    analysisMode: row.analysis_mode,
    errorMessage: row.error_message,
    status: row.status,
    createdAt: row.created_at,
    preview: makeQuestionPreview(row.problem_text)
  };
}

function getOwnedQuestion(id, userId) {
  const row = db.prepare(
    `SELECT id, problem_text, sample_input, sample_output, language, code, question_type,
            ai_response, analysis_mode, error_message, status, created_at
     FROM questions
     WHERE id = ? AND user_id = ?`
  ).get(id, userId);
  return serializeQuestion(row);
}

function serializeQuestionMessage(row) {
  return {
    id: Number(row.id),
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

function getQuestionMessages(questionId) {
  return db.prepare(
    `SELECT id, role, content, created_at
     FROM question_messages
     WHERE question_id = ?
     ORDER BY id ASC`
  ).all(questionId).map(serializeQuestionMessage);
}

function buildFollowUpContext(question) {
  const ai = question.aiResponse || {};
  const issueText = Array.isArray(ai.issues) && ai.issues.length
    ? ai.issues.map((issue) => `- ${issue.title}：${issue.explanation || ''}`).join('\n')
    : '';
  return [
    `题目：${question.problemText}`,
    `编程语言：${question.languageName}`,
    `输入样例：${question.sampleInput}`,
    `输出样例：${question.sampleOutput}`,
    question.code ? `学生代码：\n${question.code}` : '学生代码：未提交',
    ai.summary ? `解析摘要：${ai.summary}` : '',
    ai.approach ? `完整解题思路：\n${ai.approach}` : '',
    issueText ? `问题检查：\n${issueText}` : ''
  ].filter(Boolean).join('\n').slice(0, 20000);
}

async function callAIFollowUp(question, messages) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 120000;
  const history = messages.slice(-8).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content
  }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是一位有耐心的少儿编程老师。学生正在针对一道编程题追问，请结合题目、已有解析和前面的对话继续引导。先确认学生卡在哪里，再分步骤讲清思路；不要直接替学生写完完整答案，除非学生已经尝试过且明确请求参考代码。回答要简短、清楚，用中文，并尽量以提问或小任务收尾，让学生自己再走一步。'
          },
          { role: 'user', content: buildFollowUpContext(question) },
          ...history
        ],
        temperature: 0.4
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`模型接口返回 ${response.status}：${detail.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型未返回追问内容');
    return cleanText(content, 10000);
  } finally {
    clearTimeout(timer);
  }
}

function localFollowUp(question, messages) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const userQuestion = lastUser ? lastUser.content : '这个问题应该怎么继续想？';
  const hasCode = typeof question.code === 'string' && question.code.trim().length > 0;
  let focus = '';

  if (/答案|代码|怎么写|怎么改|完整/.test(userQuestion)) {
    focus = '你已经在问完整写法，但我们先不要急着跳到最后一步。先确认输入输出，再把处理过程分成两三步，最后才写代码。';
  } else if (/报错|错误|error|bug|运行失败/.test(userQuestion)) {
    focus = '遇到报错时，先读错误提示里第一次出现的位置。告诉我具体是哪一行、什么提示，我们可以一起把它拆开检查。';
  } else if (/样例|测试|运行|输出/.test(userQuestion)) {
    focus = '把题目给的样例输入手动走一遍，看每一步得到什么结果。如果程序输出和样例不一致，找出第一次不一致的位置，通常那里就是问题所在。';
  } else {
    focus = '先不要追求一次想完整，按“读入数据、处理数据、输出结果”三步走。卡在哪一步，就把那一步单独拿出来想。';
  }

  return [
    `你问的是：${userQuestion}`,
    '',
    focus,
    '',
    `当前题目是 ${question.languageName} 题。请先回答我一个小问题：你觉得自己现在是卡在“不知道怎么开始”“处理过程想不清楚”，还是“代码已经写了但结果不对”？`,
    hasCode
      ? '如果你能把你写到的关键几行代码或具体报错信息发给我，我可以帮你更精确地找到问题。'
      : '如果你还没有写代码，就先不要写完整程序，先用文字把输入到输出的处理步骤列出来。',
    '',
    '把这一小步试完后再告诉我结果，我们继续往下走。'
  ].join('\n');
}

async function generateFollowUp(question, messages) {
  if (process.env.AI_API_KEY) {
    try {
      return await callAIFollowUp(question, messages);
    } catch (error) {
      console.error('AI 追问失败，使用本地辅导：', error.message);
    }
  }
  return localFollowUp(question, messages);
}

function createQuestionRecord(userId, payload) {
  const problemText = cleanText(payload.problemText);
  const sampleInput = cleanText(payload.sampleInput);
  const sampleOutput = cleanText(payload.sampleOutput);
  const code = typeof payload.code === 'string' ? payload.code.trim().slice(0, 100000) : '';
  const language = AI_LANGUAGES[payload.language] ? payload.language : 'python';
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO questions
      (user_id, problem_text, sample_input, sample_output, language, code, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'analyzing', ?)`
  ).run(userId, problemText, sampleInput, sampleOutput, language, code || null, now);
  return {
    id: Number(result.lastInsertRowid),
    problemText,
    sampleInput,
    sampleOutput,
    language,
    languageName: AI_LANGUAGES[language],
    code: code || '',
    questionType: '',
    status: 'analyzing',
    createdAt: now
  };
}

async function analyzeQuestion(input) {
  if (process.env.AI_API_KEY) {
    try {
      const result = await callAIAnalyzer(input);
      return {
        ...result,
        mode: 'ai',
        model: process.env.AI_MODEL || 'gpt-4o-mini'
      };
    } catch (error) {
      console.error('AI 分析失败，切换到本地辅导：', error.message);
      const fallback = await localAnalyzer(input);
      return {
        ...fallback,
        approach: buildLocalLesson(input, fallback),
        mode: 'local-fallback',
        model: 'local',
        notice: `AI 请求失败，已使用本地辅导结果。${error.message}`
      };
    }
  }
  const result = await localAnalyzer(input);
  return {
    ...result,
    approach: buildLocalLesson(input, result),
    mode: 'local',
    model: 'local'
  };
}

function buildAIPrompt(input) {
  const languageName = AI_LANGUAGES[input.language] || input.language;
  const codeBlock = input.code
    ? `用户代码：\n\`\`\`\n${input.code}\n\`\`\``
    : '用户代码：（未提交）';
  return {
    system: `你是一名擅长给中小学生讲解编程题的少儿编程老师。请用简体中文回答，语气耐心、准确、不打击学生。
规则：
1. 如果用户提交了代码，重点找出具体错误和思路错误，说明错误原因，并给出尽量保留学生原有结构的修改建议。
2. 如果用户没有提交代码，说明学生可能没有思路，不要直接给出完整答案，先讲解拆题思路、处理步骤和对照样例调试的方法。
3. 不要给出超出题目本身的大量扩展知识，不要写 Markdown 表格。
4. 只输出一个 JSON 对象，不要输出 Markdown 代码块，也不要输出额外说明。

JSON 字段如下：
- summary: string，一句话诊断，写“当前状态 + 下一步先看哪里”，不解释原理。
- correctness: string，只能是 correct、minor、wrong、no-code 之一。
- questionType: string，从“顺序结构、条件判断、循环结构、数组与列表、字符串、函数、数学计算、模拟、枚举/搜索、递归、综合题”中选择一个主类型。
- issues: array，每项包含 severity（只能是 error、warning、tip）、title、location、explanation、suggestion。
- approach: string，用“1. 2. 3.”分步骤写清思路，不提交代码时尤其重要。
- diagnosis: array，固定 3 项，title 依次为“现在”“原因”“改法”；每项 content 不超过 60 字，尽量使用学生代码里的行号或变量名。
- sampleChecks: array，仅当用户提交了代码时给出 1-2 个关键样例；每项包含 input、expected、actual、note。actual 是对照当前代码推演出的输出。
- actionItems: array，给 2-4 个下一步动作，每项一句话，直接可执行。
- pseudoCode: string，先不写完整代码，把“读入 → 处理 → 输出”拆成学生能照着做的步骤，并给出少量伪代码。
- keySnippets: array，最多 3 个关键片段；每项包含 title、explanation、code。code 只写核心片段，不要写成完整程序。
- fixedCode: string，完整、可运行、带注释的参考代码，最后才供学生查看。
- practice: string，给学生的下一步练习或检查建议。`,
    user: `编程语言：${languageName}
题目描述：
${input.problemText}

样例输入：
${input.sampleInput}

样例输出：
${input.sampleOutput}

${codeBlock}`
  };
}

function buildTeacherPrompt(userContent) {
  return `${userContent}

请像一位有耐心的老师讲题一样，输出完整、详细的解题解析，不要只给简短的提示。要求把以下小节完整写进 JSON 的 approach 字段中，每个小节用一行标题开头：

【题目理解】
说明这道题在考什么、难点在哪里，用自己的话把题目重新讲一遍。

【输入与输出分析】
解释输入数据长什么样、输出要求是什么，以及两者之间需要完成什么处理。

【样例拆解】
逐步对照题目给出的输入和输出，说明每一步为什么会得到这个结果。

【分步解题思路】
用清晰的分步结构讲出完整解题过程：数据读取、数据结构、核心算法、循环或条件设计、输出组装。

【边界情况】
列出容易漏掉的特殊情况，例如空输入、多组输入、最大最小值、空格换行、数据类型等。

【实现与自测建议】
给出写代码时的检查顺序，以及用样例和自造数据自测的方法。

【参考实现】
在 pseudoCode 中给出 3-5 步思路和伪代码；在 keySnippets 中挑 2-3 个核心片段，每段配 title、explanation、code；fixedCode 给出完整参考代码，并与 keySnippets 保持一致。所有 code 字段只写代码文本，不要使用 Markdown 代码围栏。

【诊断与行动】
summary 只用一句话说清楚当前状态和下一步先看哪里；diagnosis 固定写成“现在 / 原因 / 改法”三行短解释；sampleChecks 用学生代码对应的关键样例做对照；actionItems 给 2-4 个能直接照做的动作。

【题目类型】
根据题目考察的知识点和代码结构，从类型列表中选一个最合适的主类型写入 questionType；不确定时用“综合题”。

approach 内容要完整、像课堂讲解，但仍然只用 JSON 对象返回，不要输出 JSON 以外的内容。`;
}

async function callAIAnalyzer(input) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 120000;
  const prompt = buildAIPrompt(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: buildTeacherPrompt(prompt.user) }
        ],
        temperature: 0.3
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`模型接口返回 ${response.status}：${detail.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型未返回分析内容');
    return parseAIResult(content);
  } finally {
    clearTimeout(timer);
  }
}

async function testAIProvider() {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: '尚未配置 API Key，请先保存配置。' };
  }
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'deepseek-chat';
  const timeoutMs = Math.min(Number(process.env.AI_TIMEOUT_MS) || 15000, 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '请只回复 OK' }],
        temperature: 0
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, message: `连接失败：HTTP ${response.status} ${detail.slice(0, 300)}` };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return {
      ok: true,
      message: content
        ? `连接成功，模型回复：${String(content).trim().slice(0, 80)}`
        : '连接成功，但模型没有返回内容。'
    };
  } catch (error) {
    return { ok: false, message: `连接失败：${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function parseAIResult(content) {
  let cleaned = String(content).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`模型返回内容无法解析：${error.message}`);
  }

  const allowedCorrectness = ['correct', 'minor', 'wrong', 'no-code'];
  const allowedSeverity = ['error', 'warning', 'tip'];
  const issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    return {
      severity: allowedSeverity.includes(item.severity) ? item.severity : 'warning',
      title: cleanText(item.title, 120) || `问题 ${index + 1}`,
      location: cleanText(item.location, 200),
      explanation: cleanText(item.explanation, 2000),
      suggestion: cleanText(item.suggestion, 2000)
    };
  }).filter(Boolean) : [];
  const keySnippets = Array.isArray(parsed.keySnippets) ? parsed.keySnippets.slice(0, 3).map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    return {
      title: cleanText(item.title, 120) || `关键片段 ${index + 1}`,
      explanation: cleanText(item.explanation, 2000),
      code: cleanText(item.code, 10000)
    };
  }).filter((item) => item && (item.code || item.explanation)) : [];
  const diagnosis = Array.isArray(parsed.diagnosis) ? parsed.diagnosis.slice(0, 3).map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const titles = ['现在', '原因', '改法'];
    return {
      title: cleanText(item.title, 20) || titles[index] || `第 ${index + 1} 步`,
      content: cleanText(item.content, 800)
    };
  }).filter((item) => item && item.content) : [];
  const sampleChecks = Array.isArray(parsed.sampleChecks) ? parsed.sampleChecks.slice(0, 3).map((item) => {
    if (!item || typeof item !== 'object') return null;
    return {
      input: cleanText(item.input, 2000),
      expected: cleanText(item.expected, 2000),
      actual: cleanText(item.actual, 2000),
      note: cleanText(item.note, 1000)
    };
  }).filter((item) => item && (item.expected || item.actual || item.note)) : [];
  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 4)
    : [];

  return {
    summary: cleanText(parsed.summary, 1000),
    correctness: allowedCorrectness.includes(parsed.correctness) ? parsed.correctness : 'minor',
    questionType: normalizeQuestionType(parsed.questionType),
    issues,
    approach: cleanText(parsed.approach, 50000),
    diagnosis,
    sampleChecks,
    actionItems,
    pseudoCode: cleanText(parsed.pseudoCode, 10000),
    keySnippets,
    fixedCode: cleanText(parsed.fixedCode, 30000),
    practice: cleanText(parsed.practice, 3000)
  };
}

function checkPythonSyntax(code) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const command = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(command, ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => finish({ ok: true, skipped: true }));
    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true });
      } else {
        const firstLine = stderr.split(/\r?\n/).find((line) => line.includes('line')) || stderr.trim();
        finish({ ok: false, message: firstLine.slice(0, 500) || 'Python 代码存在语法错误。' });
      }
    });
    timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, message: '语法检查超时。' });
    }, 5000);
    child.stdin.end(code);
  });
}

function makeLocalIssue(severity, title, explanation, suggestion, location = '') {
  return { severity, title, location, explanation, suggestion };
}

function buildLocalLesson(input, result) {
  const languageName = AI_LANGUAGES[input.language] || input.language;
  const hasCode = typeof input.code === 'string' && input.code.trim().length > 0;
  const inputLines = String(input.sampleInput || '').trim().split(/\r?\n/).filter(Boolean);
  const outputLines = String(input.sampleOutput || '').trim().split(/\r?\n/).filter(Boolean);
  const issueSummary = result && Array.isArray(result.issues) && result.issues.length
    ? result.issues.map((item, index) => `${index + 1}. ${item.title}：${item.explanation || ''}`).join('\n')
    : '当前本地检查没有发现明显错误。';

  return [
    '【题目理解】',
    `这道题要求使用 ${languageName} 完成一个程序。先不要急着写代码，把题目当成老师在黑板上讲题：先确认“输入是什么、要做什么、输出是什么”。`,
    `题目描述：${input.problemText}`,
    '',
    '【输入与输出】',
    `输入：${input.sampleInput || '未提供'}。`,
    `输出：${input.sampleOutput || '未提供'}。`,
    '这意味着程序至少要做到：读入数据，经过计算或判断，再按给定格式输出结果。',
    '',
    '【样例拆解】',
    `把样例输入 ${inputLines.length || 1} 行、样例输出 ${outputLines.length || 1} 行一步步对照。每一行输出都应该能追溯到某一段输入，想一想它是直接原样输出，还是经过计算、循环、条件判断后得到的。`,
    '',
    '【分步解题思路】',
    hasCode
      ? '你已经提交了代码，建议按这个顺序检查：先确认读入和输出，再确认数据处理，最后核对样例和边界情况。'
      : '还没有提交代码时，先按步骤写出思路：1. 明确要读取哪些数据；2. 找出数据之间的规律；3. 设计循环或判断；4. 组合输出；5. 用样例验证。',
    '',
    '【边界情况】',
    '除了题目样例，还要考虑：多组数据时如何逐组处理；输入里可能有空格、换行或多余空白；数字范围很大时是否要使用合适的数据类型；空输入、0、负数、最大值等特殊情况。',
    '',
    '【当前检查】',
    issueSummary,
    '',
    '【自测建议】',
    '先用题目里的输入运行，确认输出完全一致；再自己构造一组简单输入、一组边界输入，逐步走一遍程序。修改代码时一次只改一个问题，改完立刻重新运行样例。'
  ].join('\n');
}

async function localAnalyzer(input) {
  const hasCode = typeof input.code === 'string' && input.code.trim().length > 0;
  const language = input.language || 'python';
  const issues = [];
  const sampleOutputLines = input.sampleOutput.trim().split(/\r?\n/).filter(Boolean).length;

  if (!hasCode) {
    return {
      summary: '还没有提交代码，先不急着写答案，把题目拆成“读入、处理、输出”三部分。',
      correctness: 'no-code',
      questionType: normalizeQuestionType([input.problemText, input.sampleInput, input.sampleOutput].join('\n')),
      issues: [],
      diagnosis: [
        { title: '现在', content: '还没有代码可以检查，先别急着写完整答案。' },
        { title: '原因', content: '题目还没有拆成输入、处理、输出三个步骤。' },
        { title: '改法', content: '先手动走一遍样例，再写出第一版代码。' }
      ],
      sampleChecks: [],
      actionItems: [
        '先确认样例输入有哪些数据',
        '把样例输入手动走一遍',
        '写出第一版代码并提交'
      ],
      approach: [
        '先确认输入格式：样例输入里有哪些数字、字母或空格，哪些数据需要后续处理。',
        '再看输出要求：输出是一行还是多行，是原样输出还是需要计算、判断、拼接。',
        `把样例输入手动走一遍，逐步变成样例输出；样例输出有 ${sampleOutputLines || 1} 行时，重点观察每行之间的变化。`,
        '找出重复动作：如果有多组数据或多次判断，考虑使用循环；如果有条件分支，考虑使用 if/else。',
        '最后用样例输入运行验证，再想一想没有给出的大数、空输入或边界情况。'
      ].join('\n'),
      fixedCode: '',
      practice: '先用文字把处理步骤写下来，再尝试写出第一版代码，即使不完整也可以提交给老师继续修改。'
    };
  }

  if (language === 'python') {
    if (!/\binput\s*\(/.test(input.code)) {
      issues.push(makeLocalIssue(
        'warning',
        '还没有读取输入',
        '代码中没有看到 input()，题目给的样例输入目前没有进入程序。',
        '先用变量接收输入，再根据题意拆分或转换，例如 data = input()。'
      ));
    }
    if (!/\bprint\s*\(/.test(input.code)) {
      issues.push(makeLocalIssue(
        'warning',
        '还没有输出结果',
        '代码中没有看到 print()，即使计算完成，判题系统也看不到结果。',
        '在程序最后使用 print(结果) 输出，确保格式与样例输出一致。'
      ));
    }
    if (/input\s*\(\s*\)/.test(input.code) && !/int\s*\(\s*input/.test(input.code) && /\d+\s*[<>=]/.test(input.code)) {
      issues.push(makeLocalIssue(
        'tip',
        '检查输入是否做了类型转换',
        'input() 返回的是字符串，如果题目给的是数字，直接比较或计算容易得到错误结果。',
        '需要数字计算时，使用 int(input())；需要多个数字时，再配合 split() 拆分。'
      ));
    }
    if (/:\s*$/.test(input.code) && !/^\s+/.test(input.code)) {
      issues.push(makeLocalIssue(
        'tip',
        '检查缩进',
        'Python 中冒号后面的代码块必须缩进，否则会报缩进错误。',
        '把属于 if、for、while、def 后面的语句统一缩进 4 个空格。'
      ));
    }
    const syntax = await checkPythonSyntax(input.code);
    if (!syntax.ok) {
      issues.push(makeLocalIssue(
        'error',
        '代码存在语法错误',
        syntax.message || '程序目前不能正常运行。',
        '先修正报错提示中标注的位置，再继续检查思路。'
      ));
    }
  } else if (language === 'cpp') {
    if (!/\b(cin|scanf)\b/.test(input.code)) {
      issues.push(makeLocalIssue(
        'warning',
        '还没有读取输入',
        '代码中没有看到 cin 或 scanf，样例输入还没有进入程序。',
        '根据数据类型使用 cin >> 变量 或 scanf 读取输入。'
      ));
    }
    if (!/\b(cout|printf)\b/.test(input.code)) {
      issues.push(makeLocalIssue(
        'warning',
        '还没有输出结果',
        '代码中没有看到 cout 或 printf，程序不会产生判题需要的输出。',
        '使用 cout << 结果 << endl; 或 printf 输出。'
      ));
    }
  } else if (language === 'javascript') {
    if (!/(readline|prompt|process\.stdin)/.test(input.code)) {
      issues.push(makeLocalIssue(
        'warning',
        '还没有读取输入',
        '代码中没有看到读取输入的写法，题目输入尚未进入程序。',
        '根据运行环境使用 readline 或 process.stdin 读取数据。'
      ));
    }
    if (!/(console\.log|process\.stdout\.write)/.test(input.code)) {
      issues.push(makeLocalIssue(
        'warning',
        '还没有输出结果',
        '代码中没有 console.log，程序结果没有打印出来。',
        '在程序末尾使用 console.log(结果) 输出。'
      ));
    }
  }

  if (issues.length === 0) {
    issues.push(makeLocalIssue(
      'tip',
      '检查样例运行结果',
      '本地检查没有发现明显的缺项，但还没有实际运行判题。',
      `把样例输入填入程序运行，逐字符比较输出是否等于样例输出的 ${sampleOutputLines || 1} 行内容。`
    ));
  }

  return {
    summary: issues.some((item) => item.severity === 'error')
      ? '代码目前还不能正常运行，先修复语法问题，再继续调试思路。'
      : `代码里有 ${issues.length} 个需要检查的地方，按顺序修正后通常就能接近正确答案。`,
    correctness: issues.some((item) => item.severity === 'error') ? 'wrong' : 'minor',
    questionType: normalizeQuestionType([input.code, input.problemText].join('\n')),
    issues,
    diagnosis: [
      { title: '现在', content: issues[0] ? issues[0].title : '代码已经写完，需要运行样例确认结果。' },
      { title: '原因', content: issues[0] ? issues[0].explanation : '本地检查没有发现明显缺项。' },
      { title: '改法', content: issues[0] ? issues[0].suggestion : '用题目样例运行并逐字符比较输出。' }
    ],
    sampleChecks: [],
    actionItems: issues.length
      ? issues.slice(0, 3).map((issue) => issue.suggestion).filter(Boolean)
      : ['用题目样例运行一次', '逐字符比较输出', '再构造一组边界数据检查'],
    approach: [
      '先保证“读入数据 → 处理数据 → 输出结果”三部分都存在。',
      '对照样例输入，把程序每一步应得到的结果写在纸上。',
      '找到第一次与预期不一致的位置，通常就是主要错误点。',
      '修好后用样例输入再运行，并检查多行输入、边界数字等情况。'
    ].join('\n'),
    fixedCode: '',
    practice: '每改一处，就重新运行一次样例，避免一次修改过多导致错误来源不清晰。'
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const user = getCurrentUser(req);

  if (pathname === '/api/register' && method === 'POST') {
    const body = await readBody(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 30)
      : username;
    if (!isValidUsername(username)) {
      return sendError(res, 400, '用户名需为 2-20 位字母、数字、下划线或中文。');
    }
    if (!isValidPassword(body.password)) {
      return sendError(res, 400, '密码至少 6 位，最多 72 位。');
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return sendError(res, 409, '用户名已存在。');

    const salt = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO users (username, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(username, displayName, hashPassword(body.password, salt), salt, now);
    const token = createSession(Number(result.lastInsertRowid));
    setSessionCookie(res, token);
    return sendJson(res, 201, {
      id: Number(result.lastInsertRowid),
      username,
      displayName
    });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const row = db.prepare(
      'SELECT id, username, display_name, password_hash, password_salt FROM users WHERE username = ?'
    ).get(username);
    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      return sendError(res, 401, '用户名或密码不正确。');
    }
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    const token = createSession(Number(row.id));
    setSessionCookie(res, token);
    return sendJson(res, 200, {
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name
    });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    if (!user) return sendError(res, 401, '未登录');
    return sendJson(res, 200, {
      id: user.id,
      username: user.username,
      displayName: user.displayName
    });
  }

  if (pathname === '/api/config' && method === 'GET') {
    return sendJson(res, 200, {
      aiConfigured: Boolean(process.env.AI_API_KEY),
      aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
      aiBaseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1'
    });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req);
    if (!verifyAdminPassword(body.password)) {
      return sendError(res, 401, '管理员密码不正确');
    }
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, { expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
    setAdminCookie(res, token);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    const token = parseCookies(req)[ADMIN_COOKIE];
    if (token) adminSessions.delete(token);
    clearAdminCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdminSession(req)) {
      return sendError(res, 401, '请先登录管理员');
    }

    if (pathname === '/api/admin/config' && method === 'GET') {
      const config = getAiEnvConfig();
      return sendJson(res, 200, {
        aiConfigured: Boolean(config.aiApiKey),
        aiBaseUrl: config.aiBaseUrl,
        aiModel: config.aiModel,
        aiTimeoutMs: config.aiTimeoutMs,
        keyMasked: maskApiKey(config.aiApiKey)
      });
    }

    if (pathname === '/api/admin/config' && method === 'POST') {
      const body = await readBody(req);
      let baseUrl;
      try {
        baseUrl = normalizeBaseUrl(body.aiBaseUrl);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
      const model = cleanText(body.aiModel, 100);
      if (!model) return sendError(res, 400, '模型名称不能为空');
      const timeoutMs = Number(body.aiTimeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 5000 || timeoutMs > 300000) {
        return sendError(res, 400, '请求超时需在 5 到 300 秒之间');
      }
      const apiKey = typeof body.aiApiKey === 'string' ? body.aiApiKey.trim() : '';
      const updates = {
        AI_BASE_URL: baseUrl,
        AI_MODEL: model,
        AI_TIMEOUT_MS: String(timeoutMs)
      };
      if (apiKey) {
        updates.AI_API_KEY = apiKey;
      } else if (body.clearKey) {
        updates.AI_API_KEY = '';
      }
      writeEnvFile(updates);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/test' && method === 'POST') {
      const result = await testAIProvider();
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    return sendError(res, 404, '管理员接口不存在');
  }

  if (!user) return sendError(res, 401, '未登录');

  if (pathname === '/api/questions' && method === 'GET') {
    const rows = db.prepare(
      `SELECT id, problem_text, sample_input, sample_output, language, code, question_type,
              ai_response, analysis_mode, error_message, status, created_at
       FROM questions
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 200`
    ).all(user.id);
    return sendJson(res, 200, { questions: rows.map(serializeQuestion) });
  }

  if (pathname === '/api/questions' && method === 'POST') {
    const body = await readBody(req);
    const problemText = cleanText(body.problemText);
    const sampleInput = cleanText(body.sampleInput);
    const sampleOutput = cleanText(body.sampleOutput);
    if (!problemText) return sendError(res, 400, '题目描述不能为空。');
    if (!sampleInput) return sendError(res, 400, '输入样例不能为空。');
    if (!sampleOutput) return sendError(res, 400, '输出样例不能为空。');

    const record = createQuestionRecord(user.id, body);
    try {
      const result = await analyzeQuestion({
        problemText: record.problemText,
        sampleInput: record.sampleInput,
        sampleOutput: record.sampleOutput,
        code: record.code,
        language: record.language
      });
      db.prepare(
        "UPDATE questions SET status = 'completed', ai_response = ?, analysis_mode = ?, question_type = ?, error_message = NULL WHERE id = ?"
      ).run(JSON.stringify(result), result.mode, result.questionType || '综合题', record.id);
      return sendJson(res, 201, getOwnedQuestion(record.id, user.id));
    } catch (error) {
      console.error('分析题目失败：', error);
      db.prepare(
        "UPDATE questions SET status = 'failed', error_message = ? WHERE id = ?"
      ).run(error.message || '分析失败', record.id);
      return sendJson(res, 500, {
        error: 'AI 分析失败，记录已保存，可稍后重试。',
        question: getOwnedQuestion(record.id, user.id)
      });
    }
  }

  const detailMatch = pathname.match(/^\/api\/questions\/(\d+)$/);
  const reanalyzeMatch = pathname.match(/^\/api\/questions\/(\d+)\/reanalyze$/);
  const messagesMatch = pathname.match(/^\/api\/questions\/(\d+)\/messages$/);

  if (messagesMatch && method === 'GET') {
    const question = getOwnedQuestion(Number(messagesMatch[1]), user.id);
    if (!question) return sendError(res, 404, '记录不存在');
    return sendJson(res, 200, { messages: getQuestionMessages(question.id) });
  }

  if (messagesMatch && method === 'POST') {
    const question = getOwnedQuestion(Number(messagesMatch[1]), user.id);
    if (!question) return sendError(res, 404, '记录不存在');
    const body = await readBody(req);
    const content = cleanText(body.content, 4000);
    if (!content) return sendError(res, 400, '追问内容不能为空');
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO question_messages (question_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(question.id, 'user', content, now);
    const afterUser = getQuestionMessages(question.id);
    const assistant = await generateFollowUp(question, afterUser);
    db.prepare(
      'INSERT INTO question_messages (question_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(question.id, 'assistant', assistant, new Date().toISOString());
    return sendJson(res, 201, { messages: getQuestionMessages(question.id) });
  }

  if (detailMatch && method === 'GET') {
    const question = getOwnedQuestion(Number(detailMatch[1]), user.id);
    if (!question) return sendError(res, 404, '记录不存在');
    return sendJson(res, 200, { question });
  }

  if (detailMatch && method === 'DELETE') {
    const result = db.prepare('DELETE FROM questions WHERE id = ? AND user_id = ?')
      .run(Number(detailMatch[1]), user.id);
    if (result.changes === 0) return sendError(res, 404, '记录不存在');
    return sendJson(res, 200, { ok: true });
  }

  if (reanalyzeMatch && method === 'POST') {
    const question = getOwnedQuestion(Number(reanalyzeMatch[1]), user.id);
    if (!question) return sendError(res, 404, '记录不存在');
    db.prepare("UPDATE questions SET status = 'analyzing', error_message = NULL WHERE id = ?").run(question.id);
    try {
      const result = await analyzeQuestion({
        problemText: question.problemText,
        sampleInput: question.sampleInput,
        sampleOutput: question.sampleOutput,
        code: question.code || '',
        language: question.language
      });
      db.prepare(
        "UPDATE questions SET status = 'completed', ai_response = ?, analysis_mode = ?, question_type = ?, error_message = NULL WHERE id = ?"
      ).run(JSON.stringify(result), result.mode, result.questionType || '综合题', question.id);
      return sendJson(res, 200, { question: getOwnedQuestion(question.id, user.id) });
    } catch (error) {
      console.error('重新分析失败：', error);
      db.prepare(
        "UPDATE questions SET status = 'failed', error_message = ? WHERE id = ?"
      ).run(error.message || '分析失败', question.id);
      return sendJson(res, 500, {
        error: 'AI 分析失败，记录已保存。',
        question: getOwnedQuestion(question.id, user.id)
      });
    }
  }

  return sendError(res, 404, '接口不存在');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function serveStatic(res, pathname) {
  let relativePath = pathname === '/' ? 'index.html' : pathname;
  let filePath = path.resolve(PUBLIC_DIR, '.' + path.normalize('/' + relativePath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendError(res, 403, '禁止访问');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) return sendError(res, 404, '文件不存在');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, '方法不允许');
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    console.error('请求处理失败：', error);
    if (!res.headersSent) sendError(res, 500, '服务器内部错误');
    else res.end();
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`AI 编程辅导网站已启动：http://localhost:${port}`);
  console.log(`AI 模式：${process.env.AI_API_KEY ? '真实 AI（' + (process.env.AI_MODEL || 'gpt-4o-mini') + '）' : '本地辅导（未配置 AI_API_KEY）'}`);
});
