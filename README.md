# 🎴 德州扑克在线游戏

一款支持2-12人同时在线的德州扑克游戏，可部署在家庭电脑作为私人服务器，邀请好友远程对战。

## ✨ 特性

- 🎮 **多人对战**: 支持2-12人同时游戏
- 🏠 **私人服务器**: 可部署在家庭电脑，邀请好友加入
- 💰 **无限筹码**: 随时补充筹码，无压力娱乐
- 📊 **详细结算**: 每局结束显示详细获胜说明
- 💬 **实时聊天**: 游戏内聊天功能，支持 @提及
- 🎨 **精美界面**: 专业的扑克桌设计风格
- 🤖 **AI 玩家**: LLM 驱动的 AI 玩家，可自动加入房间、做决策、聊天互动
- 🎲 **18种变体**: 常规德州、奥马哈、短牌、大菠萝、五张换牌、鱿鱼系列等
- 🃏 **6种修饰器**: 炸弹池、免弃牌、跟到底、大小盲梭哈等

## 🚀 快速开始

### 方式一: 本地开发运行

#### 1. 安装依赖

```bash
# 在项目根目录
npm install

# 安装服务端依赖
cd server && npm install

# 安装前端依赖
cd ../client && npm install
```

#### 2. 配置环境变量

```bash
# 在项目根目录创建 .env 文件
cp .env.example .env

# 编辑 .env 文件（可选，使用默认配置即可）
```

#### 3. 启动开发服务器

```bash
# 在项目根目录同时启动前后端
npm run dev
```

或者分别启动:

```bash
# 终端1: 启动服务端
cd server && npm run dev

# 终端2: 启动前端
cd client && npm run dev
```

#### 4. 访问游戏

打开浏览器访问: http://localhost:5173

### 方式二: Docker部署

#### 1. 构建并启动

```bash
# 在项目根目录
docker-compose up -d
```

#### 2. 访问游戏

打开浏览器访问: http://localhost:8080

### 方式三: 内网穿透（邀请外网好友）

#### 使用 ngrok

```bash
# 1. 注册 ngrok 账号并安装客户端
# 2. 配置 authtoken
ngrok config add-authtoken YOUR_AUTHTOKEN

# 3. 启动内网穿透
ngrok http 5173

# 4. 将生成的 https 链接分享给好友
```

#### 使用 Cloudflare Tunnel (推荐，免费)

```bash
# 1. 安装 cloudflared
# Windows: 下载安装包
# Mac: brew install cloudflared

# 2. 登录
cloudflared tunnel login

# 3. 创建隧道
cloudflared tunnel create poker

# 4. 配置并运行
cloudflared tunnel route dns poker poker.yourdomain.com
cloudflared tunnel run poker
```

## 📁 项目结构

```
texas-poker-game/
├── server/              # 服务端代码 (Node.js + Express + Socket.io)
│   ├── src/
│   │   ├── poker/       # 扑克引擎 (发牌、牌型判断)
│   │   ├── game/        # 游戏逻辑
│   │   ├── room/        # 房间管理
│   │   ├── websocket/   # WebSocket处理器
│   │   └── index.ts     # 入口文件
│   └── package.json
├── client/              # 前端代码 (React + Vite + TailwindCSS)
│   ├── src/
│   │   ├── components/  # UI组件
│   │   ├── pages/       # 页面组件
│   │   ├── stores/      # 状态管理
│   │   └── App.tsx
│   └── package.json
├── script/              # AI 玩家脚本 & 测试工具
│   ├── smart_ai_player.py  # LLM 驱动的 AI 玩家
│   ├── test_ai_interface.py # AI 接口测试脚本
│   └── ...
├── doc/                 # 文档
│   ├── ai_interface.md  # AI 接口文档
│   └── player_state_machine.md  # 玩家状态机设计
├── shared/              # 共享类型定义
└── docker-compose.yml   # Docker部署配置
```

## 🎮 游戏玩法

### 创建房间

1. 进入游戏大厅
2. 点击"创建房间"
3. 设置房间参数（人数、盲注等）
4. 点击"创建"

### 加入房间

1. 方式一: 点击大厅中的房间卡片
2. 方式二: 输入6位房间号加入
3. 方式三: 使用邀请链接

### 游戏流程

1. 所有玩家点击"准备"
2. 房主点击"开始游戏"
3. 系统发底牌（每人2张）
4. 按顺序进行下注操作:
   - **弃牌**: 放弃本局
   - **过牌**: 不下注
   - **跟注**: 跟上前注
   - **加注**: 增加下注额
   - **全押**: 押上所有筹码
5. 经过翻牌、转牌、河牌阶段
6. 摊牌结算，显示获胜者及牌型

## 🤖 AI 玩家

本项目支持通过 WebSocket AI 接口接入 LLM 驱动的 AI 玩家，自动参与牌局并聊天互动。

### 快速启动 AI 玩家

```bash
# 1. 安装 Python 依赖
pip install python-socketio[client] openai

# 2. 配置 LLM
# 在项目根目录创建 llm_config.json
{
  "LLM_API_KEY": "your-api-key",
  "LLM_BASE_URL": "https://api.openai.com/v1",
  "LLM_MODEL": "gpt-4o-mini"
}

# 3. 启动 AI 玩家（自动查找或创建房间）
python script/smart_ai_player.py

# 4. 指定房间加入
python script/smart_ai_player.py --room ABC123

# 5. 指定名字和个性
python script/smart_ai_player.py --name "AI_烈焰" --personality gambler
```

### AI 玩家特性

| 特性 | 说明 |
|------|------|
| **5种个性** | shark(鲨鱼) / gambler(赌神) / fox(狐狸) / prof(教授) / rookie(新手) |
| **LLM决策** | 综合手牌强度、底池赔率、对手建模做出决策 |
| **聊天互动** | 回应 @提及，主动发表评论，大赢/大输时反应 |
| **风格切换** | 输了自动切换个性，赢了保持当前风格 |
| **断线重连** | 自动保存状态，重连后恢复名字和房间 |
| **自动补码** | 筹码耗尽后自动补充 |
| **跑马处理** | 自动选择不跑马（once），避免牌局卡住 |

### AI WebSocket 接口

AI 通过 `/ai` namespace 的 WebSocket 连接，使用 CLI 风格指令协议：

```python
import socketio

sio = socketio.Client()
sio.connect('http://localhost:3000', namespaces=['/ai'])

# 发送指令
sio.emit('ai:cmd', {
    'cmd': 'join-room',
    'args': {'roomId': 'ABC123', 'name': 'MyBot'},
    'reqId': 'req_001'
}, namespace='/ai', callback=on_response)
```

**常用指令**：

| 指令 | 说明 |
|------|------|
| `create-room` | 创建房间 |
| `join-room` | 加入房间 |
| `ready` | 准备 |
| `start-game` | 开始游戏 |
| `get-state` | 获取牌局状态（含底牌） |
| `action` | 执行行动（fold/check/call/raise/all-in） |
| `chat` | 发送聊天 |
| `get-chips` | 破产补充筹码 |
| `run-it-twice-choice` | 跑马选择 |
| `draw` | 换牌（Five Card Draw） |
| `discard` | 弃底牌（Pineapple） |

完整的接口文档见 [doc/ai_interface.md](doc/ai_interface.md)。

### AI 接口测试

```bash
# 运行接口测试脚本
python script/test_ai_interface.py
```

## 🛠️ 技术栈

### 后端
- **Node.js** + **Express** - Web框架
- **Socket.io** - 实时通信
- **TypeScript** - 类型安全

### 前端
- **React 18** - UI框架
- **Vite** - 构建工具
- **TailwindCSS** - 样式
- **Zustand** - 状态管理
- **Framer Motion** - 动画

### 部署
- **Docker** + **Docker Compose** - 容器化部署

## 📝 开发计划

- [x] 基础框架搭建
- [x] 扑克引擎（发牌、牌型判断）
- [x] 房间系统（创建/加入/管理）
- [x] 游戏流程（下注/结算）
- [x] 前端界面
- [x] 详细结算展示
- [x] Docker部署
- [x] AI 玩家接口（WebSocket /ai namespace）
- [x] LLM 驱动的 AI 玩家（5种个性、聊天互动、风格切换）
- [x] 18种游戏变体（德州、奥马哈、短牌、大菠萝、五张换牌、鱿鱼系列等）
- [x] 6种游戏修饰器（炸弹池、免弃牌、跟到底等）
- [x] 聊天 @提及功能
- [x] 房主离线时任意玩家可开始游戏
- [x] 房间自动关闭（所有玩家离线30秒）
- [x] 玩家状态机（SPECTATOR/SEATED/ACTIVE/BUSTED）
- [ ] 语音聊天
- [ ] 游戏历史统计
- [ ] 战绩排行榜

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

## 📄 许可证

MIT License

---

Made with ❤️ for poker lovers
