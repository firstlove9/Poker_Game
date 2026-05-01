# 🎴 德州扑克在线游戏

一款支持2-12人同时在线的德州扑克游戏，可部署在家庭电脑作为私人服务器，邀请好友远程对战。

## ✨ 特性

- 🎮 **多人对战**: 支持2-12人同时游戏
- 🏠 **私人服务器**: 可部署在家庭电脑，邀请好友加入
- 💰 **无限筹码**: 随时补充筹码，无压力娱乐
- 📊 **详细结算**: 每局结束显示详细获胜说明
- 💬 **实时聊天**: 游戏内聊天功能
- 🎨 **精美界面**: 专业的扑克桌设计风格

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
- [ ] 语音聊天
- [ ] 游戏历史统计
- [ ] 战绩排行榜

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

## 📄 许可证

MIT License

---

Made with ❤️ for poker lovers
