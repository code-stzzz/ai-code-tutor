# ai-code-tutor

AI 编程辅导网站

面向少儿编程课堂的题目辅导工具。学生登录后提交题目描述、输入样例、输出样例和可选代码，网站会生成一份辅导记录。

- 有代码：定位代码错误、思路错误，并给出修改建议。
- 没有代码：拆解题意，给出分步思路，先不直接替学生写完答案。
- 所有提问记录按学生账号保存在本地 SQLite 数据库中。

## 运行环境

- Node.js 24 或更高版本（使用 Node 内置 SQLite，无需安装 npm 依赖）。
- Python 可选安装：配置了本地辅导时，Python 代码会做语法检查。

## 启动

```bash
node server.js
```

然后打开 `http://localhost:3000`。如果端口被占用：

```bash
$env:PORT=3001
node server.js
```

## 管理界面

管理员入口：`http://localhost:3000/admin.html`

默认管理员密码：`admin123456`（见 `.env` 中的 `ADMIN_PASSWORD`，建议尽快修改）。

在管理界面中可配置：
- DeepSeek 接口地址：`https://api.deepseek.com`
- 模型名称：`deepseek-chat`
- API Key
- 请求超时

配置保存后立即生效，不需要重启服务；API Key 只显示掩码，不会回显完整内容。

未配置 AI Key 时会进入本地辅导模式，网站仍可以完成登录、提交、保存记录和基础代码检查。需要真实 AI 辅导时，在管理界面填入 DeepSeek API Key 即可，也可以直接编辑 `.env`：

```dotenv
AI_API_KEY=你的密钥
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
AI_TIMEOUT_MS=120000
ADMIN_PASSWORD=你的管理员密码
```

## 数据结构

- `users`：学生账号
- `sessions`：登录会话
- `questions`：每次提交的题目、样例、代码、AI 分析结果和状态

数据库文件保存在 `data/ai-tutor.db`。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/register` | 注册 |
| `POST` | `/api/login` | 登录 |
| `POST` | `/api/logout` | 退出登录 |
| `GET` | `/api/me` | 当前用户 |
| `POST` | `/api/questions` | 提交题目并生成辅导 |
| `GET` | `/api/questions` | 当前用户的记录列表 |
| `GET` | `/api/questions/:id` | 查看单条记录 |
| `POST` | `/api/questions/:id/reanalyze` | 重新分析 |
| `DELETE` | `/api/questions/:id` | 删除记录 |
| `GET` | `/api/questions/:id/messages` | 获取追问记录 |
| `POST` | `/api/questions/:id/messages` | 发送追问并获取回答 |
| `POST` | `/api/admin/login` | 管理员登录 |
| `GET` | `/api/admin/config` | 获取管理员配置 |
| `POST` | `/api/admin/config` | 保存 AI 配置 |
| `POST` | `/api/admin/test` | 测试 AI 连接 |

## 使用说明

1. 首次打开先注册账号，之后登录进入工作台。
2. 工作台左侧填写题目描述、输入样例、输出样例；代码可填可不填。
3. 提交后自动进入辅导结果页，可以返回历史记录查看。
4. 历史记录按账号保存，每条记录支持重新分析和删除。

## 安全说明

本项目面向本地课堂或自托管小范围使用。服务器不会直接执行学生提交的代码，只会在本地辅导模式下对 Python 代码做语法解析；正式部署到公网前，建议再加登录限流、HTTPS、备份数据库等保护措施。
