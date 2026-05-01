# 🎴 德州扑克在线游戏 - 全盘设计方案

## 📋 项目概述

一款支持最多12人同时在线的德州扑克游戏，可部署在家庭电脑作为私人服务器，邀请好友远程对战。

**核心特色:**
- 精美明快的游戏界面
- 每局详细结算说明（谁赢了、怎么赢的）
- 无限领取筹码，无压力娱乐
- 最终统计对比初始状态的总盈亏

---

## 🏗️ 一、技术架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端层 (Frontend)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │   Web App   │  │   Mobile    │  │   Desktop   │               │
│  │  (浏览器)    │  │  (响应式)   │  │  (Electron) │               │
│  └─────────────┘  └─────────────┘  └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS/WSS
┌─────────────────────────────────────────────────────────────────┐
│                      网关层 (Nginx/Traefik)                      │
│              静态资源服务 │ WebSocket代理 │ 负载均衡              │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      服务端 (Node.js/Express)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │  REST API   │  │  WebSocket  │  │  Game Logic │               │
│  │   接口服务   │  │  实时通信   │  │   游戏引擎  │               │
│  └─────────────┘  └─────────────┘  └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       数据层 (Data Layer)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │  SQLite/    │  │   Redis     │  │   Memory    │               │
│  │  PostgreSQL │  │  (实时数据)  │  │  (游戏状态) │               │
│  │ (持久化存储) │  │             │  │             │               │
│  └─────────────┘  └─────────────┘  └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈选型

| 层级 | 技术 | 选择理由 |
|------|------|----------|
| **前端** | React 18 + TypeScript + TailwindCSS | 组件化开发、类型安全、快速样式开发 |
| **状态管理** | Zustand | 轻量级、易学易用 |
| **动画** | Framer Motion | 流畅的卡片/筹码动画效果 |
| **后端** | Node.js + Express + Socket.io | JavaScript全栈、成熟的WebSocket支持 |
| **数据库** | SQLite (轻量) / PostgreSQL (进阶) | 零配置部署或生产级选择 |
| **缓存** | Redis / Node-Cache | 房间状态、游戏数据缓存 |
| **部署** | Docker + Docker Compose | 一键启动、易于迁移 |

### 1.3 项目目录结构

```
texas-poker-game/
├── README.md
├── DESIGN.md                    # 设计文档
├── docker-compose.yml           # Docker部署配置
├── .env.example                 # 环境变量模板
│
├── server/                      # 服务端代码
│   ├── package.json
│   ├── src/
│   │   ├── index.ts             # 入口文件
│   │   ├── config/              # 配置管理
│   │   │   ├── database.ts
│   │   │   └── game.ts
│   │   ├── models/              # 数据模型
│   │   │   ├── User.ts
│   │   │   ├── Room.ts
│   │   │   ├── Game.ts
│   │   │   └── HandHistory.ts
│   │   ├── services/            # 业务服务
│   │   │   ├── RoomService.ts
│   │   │   ├── GameService.ts
│   │   │   ├── PokerEngine.ts
│   │   │   └── HandEvaluator.ts
│   │   ├── controllers/         # 控制器
│   │   │   ├── RoomController.ts
│   │   │   └── GameController.ts
│   │   ├── routes/              # 路由定义
│   │   ├── websocket/           # WebSocket处理器
│   │   │   ├── handlers/
│   │   │   │   ├── roomHandler.ts
│   │   │   │   └── gameHandler.ts
│   │   │   └── events.ts        # 事件定义
│   │   └── utils/               # 工具函数
│   │       ├── deck.ts          # 牌组管理
│   │       ├── pokerHands.ts    # 牌型判断
│   │       └── logger.ts
│   └── tests/
│
├── client/                      # 客户端代码
│   ├── package.json
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/          # UI组件
│       │   ├── common/          # 通用组件
│       │   │   ├── Button.tsx
│       │   │   ├── Card.tsx
│       │   │   ├── Chip.tsx
│       │   │   └── Modal.tsx
│       │   ├── game/            # 游戏相关组件
│       │   │   ├── PokerTable.tsx      # 扑克桌
│       │   │   ├── PlayerSeat.tsx      # 玩家座位
│       │   │   ├── CommunityCards.tsx  # 公共牌
│       │   │   ├── PlayerHand.tsx      # 玩家手牌
│       │   │   ├── ActionPanel.tsx     # 操作面板
│       │   │   ├── PotDisplay.tsx      # 底池显示
│       │   │   ├── HandResult.tsx      # 手牌结果展示
│       │   │   └── ChatBox.tsx         # 聊天框
│       │   └── lobby/           # 大厅组件
│       │       ├── RoomList.tsx
│       │       ├── CreateRoomModal.tsx
│       │       └── PlayerProfile.tsx
│       ├── pages/               # 页面
│       │   ├── LoginPage.tsx
│       │   ├── LobbyPage.tsx    # 游戏大厅
│       │   ├── GamePage.tsx     # 游戏房间
│       │   └── StatisticsPage.tsx
│       ├── hooks/               # 自定义Hooks
│       │   ├── useSocket.ts
│       │   ├── useGame.ts
│       │   └── useRoom.ts
│       ├── stores/              # 状态管理
│       │   ├── userStore.ts
│       │   ├── gameStore.ts
│       │   └── roomStore.ts
│       ├── services/            # API服务
│       │   ├── api.ts
│       │   ├── roomApi.ts
│       │   └── gameApi.ts
│       ├── types/               # TypeScript类型
│       │   ├── user.ts
│       │   ├── room.ts
│       │   ├── game.ts
│       │   └── poker.ts
│       └── utils/               # 工具函数
│           ├── formatters.ts
│           └── validators.ts
│
└── shared/                      # 前后端共享代码
    └── types/
        ├── poker.ts             # 扑克相关类型
        ├── events.ts            # WebSocket事件类型
        └── constants.ts         # 游戏常量
```

---

## 🎮 二、游戏规则设计

### 2.1 标准德州扑克规则 (Texas Hold'em No Limit)

#### 基础规则
- **牌组**: 标准52张扑克牌（无大小王）
- **人数**: 2-12人（推荐6-9人最佳体验）
- **座位**: 按顺序编号0-11，0号位为庄家按钮位(Button)
- **强制盲注**: 小盲注(SB)和大盲注(BB)，每局自动轮转

#### 游戏流程

```
┌─────────────────────────────────────────────────────────────┐
│                    一局游戏的完整流程                         │
├─────────────────────────────────────────────────────────────┤
│  1. 发底牌阶段 (Pre-flop)                                    │
│     ├── 玩家入座，确认盲注位置                                │
│     ├── 发2张底牌给每位玩家                                  │
│     └── 从小盲注后开始第一轮下注                             │
│                                                              │
│  2. 翻牌阶段 (Flop)                                          │
│     ├── 弃掉1张牌，发出3张公共牌                             │
│     └── 从庄家后第一位活跃玩家开始第二轮下注                 │
│                                                              │
│  3. 转牌阶段 (Turn)                                          │
│     ├── 弃掉1张牌，发出第4张公共牌                           │
│     └── 第三轮下注                                           │
│                                                              │
│  4. 河牌阶段 (River)                                         │
│     ├── 弃掉1张牌，发出第5张公共牌                           │
│     └── 最后一轮下注                                         │
│                                                              │
│  5. 摊牌阶段 (Showdown)                                      │
│     ├── 剩余玩家亮出底牌                                     │
│     ├── 系统计算最大5张牌组合                                │
│     ├── 确定赢家并分配底池                                   │
│     └── 显示详细的获胜说明                                   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 下注动作

| 动作 | 说明 | 使用时机 |
|------|------|----------|
| **弃牌 (Fold)** | 放弃手牌，退出本局 | 任何下注轮 |
| **过牌 (Check)** | 不下注，让过 | 前面无人下注时 |
| **跟注 (Call)** | 跟上前一位的下注额 | 前面有人下注时 |
| **加注 (Raise)** | 增加下注额 | 想要增加筹码时 |
| **全押 (All-in)** | 押上所有筹码 | 筹码不足或all-in策略 |

### 2.3 牌型大小 (从大到小)

```
1. 皇家同花顺 (Royal Flush)      A-K-Q-J-10 同花色
2. 同花顺 (Straight Flush)        五张连续同花色
3. 四条 (Four of a Kind)          四张同点数
4. 葫芦 (Full House)              三条+一对
5. 同花 (Flush)                   五张同花色
6. 顺子 (Straight)                五张连续不同花色
7. 三条 (Three of a Kind)         三张同点数
8. 两对 (Two Pair)                两个不同的对子
9. 一对 (One Pair)                一对相同点数
10. 高牌 (High Card)              没有任何组合，比最大单牌
```

---

## 🏠 三、房间系统设计

### 3.1 房间生命周期

```
┌──────────┐    创建房间     ┌──────────┐    开始游戏     ┌──────────┐
│          │ ─────────────→ │          │ ─────────────→ │          │
│   空闲   │                │  等待中   │                │  游戏中   │
│          │ ←───────────── │          │ ←───────────── │          │
└──────────┘   解散/超时    └──────────┘   游戏结束     └──────────┘
                                              │
                                              │ 重新开始
                                              ↓
                                         ┌──────────┐
                                         │  结算中   │
                                         └──────────┘
```

### 3.2 房间配置参数

```typescript
interface RoomConfig {
  // 基本信息
  roomId: string;              // 6位字母数字房间号
  roomName: string;            // 房间名称
  hostId: string;              // 房主ID
  createdAt: Date;             // 创建时间
  
  // 游戏配置
  maxPlayers: number;          // 最大玩家数 (2-12，默认9)
  minPlayers: number;          // 最小开始人数 (2，默认2)
  smallBlind: number;          // 小盲注金额 (默认10)
  bigBlind: number;            // 大盲注金额 (默认20)
  buyInMin: number;            // 最小买入 (默认1000)
  buyInMax: number;            // 最大买入 (默认10000)
  
  // 时间配置
  actionTimeout: number;       // 行动限时(秒，默认30)
  autoStart: boolean;          // 人满自动开始
  autoStartDelay: number;      // 自动开始延迟(秒)
  
  // 房间设置
  isPrivate: boolean;          // 是否私密房间
  password?: string;           // 房间密码
  allowSpectate: boolean;      // 允许观战
  allowChat: boolean;          // 允许聊天
  
  // 游戏变体
  gameVariant: 'texas_holdem'; // 游戏类型
  deckCount: number;           // 牌组数量(默认1)
}
```

### 3.3 房间操作流程

```
┌──────────────────────────────────────────────────────────────────┐
│                      创建房间流程                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   玩家A                                                          │
│     │                                                            │
│     │ 1. 点击"创建房间"                                           │
│     ▼                                                            │
│   ┌─────────────────┐                                            │
│   │  设置房间参数    │                                            │
│   │  - 房间名称     │                                            │
│   │  - 最大人数     │                                            │
│   │  - 盲注大小     │                                            │
│   │  - 是否私密     │                                            │
│   │  - 密码(可选)   │                                            │
│   └─────────────────┘                                            │
│     │                                                            │
│     │ 2. 提交创建                                                 │
│     ▼                                                            │
│   Server: 生成唯一roomId，创建房间实例                            │
│     │                                                            │
│     ▼                                                            │
│   ┌─────────────────┐                                            │
│   │  返回房间信息    │                                            │
│   │  - roomId: ABC123                                           │
│   │  - 房主成为第一位玩家                                         │
│   │  - 生成邀请链接/二维码                                        │
│   └─────────────────┘                                            │
│     │                                                            │
│     ▼                                                            │
│   显示房间等待界面，展示邀请信息                                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                      加入房间流程                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   方式一: 通过房间号加入                                          │
│   ─────────────────────────                                       │
│   玩家B点击"加入房间" → 输入6位房间号 → 验证 → 进入               │
│                                                                  │
│   方式二: 通过邀请链接加入                                        │
│   ─────────────────────────                                       │
│   点击链接/扫描二维码 → 自动解析房间号 → 进入                     │
│                                                                  │
│   方式三: 浏览房间列表加入                                        │
│   ─────────────────────────                                       │
│   查看公开房间列表 → 选择有空位的房间 → 点击加入                  │
│                                                                  │
│   加入验证流程:                                                   │
│   ┌─────────────┐                                                │
│   │ 1. 房间是否存在?                                              │
│   │    否 → 返回错误"房间不存在"                                  │
│   └──────┬──────┘                                                │
│          │ 是                                                    │
│          ▼                                                       │
│   ┌─────────────┐                                                │
│   │ 2. 房间是否已满?                                              │
│   │    是 → 返回错误"房间已满"                                    │
│   └──────┬──────┘                                                │
│          │ 否                                                    │
│          ▼                                                       │
│   ┌─────────────┐                                                │
│   │ 3. 是否需要密码?                                              │
│   │    是 → 要求输入密码 → 验证失败返回错误                       │
│   └──────┬──────┘                                                │
│          │ 否/通过                                               │
│          ▼                                                       │
│   ┌─────────────┐                                                │
│   │ 4. 玩家是否被禁?                                              │
│   │    是 → 返回错误"你被房主请出了"                              │
│   └──────┬──────┘                                                │
│          │ 否                                                    │
│          ▼                                                       │
│   ┌─────────────┐                                                │
│   │ 5. 成功加入，通知房间内所有玩家                               │
│   └─────────────┘                                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🎴 四、游戏界面设计

### 4.1 界面风格

**设计理念**: 现代、明快、专业赌场风格

**配色方案**:
```
主色调:
- 背景深绿: #1B4D3E (扑克桌布颜色)
- 桌面绿: #2D5A4A (稍浅的桌面)
- 金色强调: #FFD700 (按钮、高亮)
- 筹码红: #E74C3C
- 筹码蓝: #3498DB
- 筹码黑: #2C3E50
- 文字白: #FFFFFF
- 文字金: #F1C40F
```

### 4.2 游戏主界面布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [房间名]                    底池: $1,250                  [设置] [?]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│     ┌─────┐                                          ┌─────┐           │
│     │ P10 │                                          │ P11 │           │
│     │$500 │                                          │$800 │           │
│     └──┬──┘                                          └──┬──┘           │
│        │                                                │              │
│        │    ┌─────┐                          ┌─────┐    │              │
│        └────┤ P9  │                          │ P0  ├────┘              │
│             │$1200│     ┌──────────────┐     │ BTN │                   │
│             └──┬──┘     │              │     └──┬──┘                   │
│                │        │   ♠️A ♥️K ♦️Q   │        │                      │
│     ┌─────┐    │        │   ♣️J ♠️10     │        │    ┌─────┐          │
│     │ P8  ├────┘        │              │        └────┤ P1  │          │
│     │ BB  │             │   底池: $1250 │             │ SB  │          │
│     │$950 │             └──────────────┘             │$700 │          │
│     └──┬──┘                                          └──┬──┘          │
│        │                                                │              │
│     ┌──┴──┐    ┌─────┐    ┌─────┐    ┌─────┐    ┌──┴──┐              │
│     │ P7  ├────┤ P6  ├────┤ P5  ├────┤ P4  ├────┤ P3  │              │
│     │$1100│    │$600 │    │Fold │    │$1500│    │$900 │              │
│     └─────┘    └─────┘    └─────┘    └─────┘    └─────┘              │
│                              P2                                         │
│                           [我的位置]                                     │
│                    ┌─────────────────┐                                  │
│                    │  🂡🂢  [我的底牌]  │                                  │
│                    │                 │                                  │
│                    │   我的筹码: $850 │                                  │
│                    └─────────────────┘                                  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  消息: 玩家P3加注到$200      [当前轮到你行动]                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│     ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │
│     │ 弃牌   │  │ 过牌   │  │ 跟注   │  │ 加注   │  │ 全押   │        │
│     │ Fold   │  │ Check  │  │ Call   │  │ Raise  │  │ All-in │        │
│     │        │  │        │  │ $200   │  │        │  │ $850   │        │
│     └────────┘  └────────┘  └────────┘  └────────┘  └────────┘        │
│                                                              滑块调整   │
│                                          ├─────────────────────────┤  │
│                                          $200      $500     $850      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  [💬] 玩家P3: 这把我要全押了!                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ P3: 加注到$200              P0: 跟注$200                        │   │
│  │ P1: 弃牌                    P2: [等待行动]                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.3 玩家座位状态显示

```typescript
// 座位显示状态
interface SeatDisplay {
  position: number;            // 座位位置 0-11
  player?: {
    id: string;
    name: string;
    avatar: string;
    chips: number;
    isOnline: boolean;
  };
  status: 'empty' | 'waiting' | 'playing' | 'folded' | 'all-in' | 'away';
  role?: 'dealer' | 'sb' | 'bb';  // 本局角色
  currentBet?: number;         // 本轮已下注
  totalBet?: number;           // 本局总下注
  cards?: [Card, Card];        // 底牌（仅自己可见）
  isTurn: boolean;             // 是否当前行动
  timeRemaining?: number;      // 剩余时间（秒）
}
```

### 4.4 游戏大厅界面

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🎴 德州扑克大厅                                          [👤 玩家昵称] │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   [+]           │  │   [+]           │  │   [+]           │         │
│  │  创建房间        │  │  快速加入        │  │  加入指定房间    │         │
│  │                 │  │                 │  │                 │         │
│  │  设置参数        │  │  自动匹配        │  │  输入房间号      │         │
│  │  邀请好友        │  │  最快开始        │  │  密码加入        │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
├─────────────────────────────────────────────────────────────────────────┤
│  🔥 推荐房间                    [筛选 ▼]              [刷新] [>]        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 房间名              人数    盲注      状态       操作            │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ 🟢 欢乐桌 #1        6/9     10/20    游戏中     [观战]          │   │
│  │ 🟡 新手场           3/6     5/10     等待中     [加入]          │   │
│  │ 🔴 高倍场           8/9     50/100   满员       [--]            │   │
│  │ 🟢 好友局           2/6     20/40    等待中     [加入]          │   │
│  │ 🟡 深夜局           4/9     10/20    等待中     [加入]          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  📊 我的统计                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  总游戏局数: 128    胜率: 42%    总盈亏: +$5,240               │   │
│  │  最佳手牌: 皇家同花顺    最大赢取: $3,200                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  📋 游戏说明                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • 德州扑克是一种技巧与运气并存的扑克游戏                       │   │
│  │  • 每人2张底牌，配合5张公共牌组成最大5张牌组合                  │   │
│  │  • 无限注规则，可以随时全押                                     │   │
│  │  • 点击房间列表加入游戏，或创建自己的房间邀请好友               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 五、网络通信设计

### 5.1 WebSocket 事件定义

```typescript
// 客户端 → 服务端 事件
enum ClientEvents {
  // 房间相关
  CREATE_ROOM = 'room:create',
  JOIN_ROOM = 'room:join',
  LEAVE_ROOM = 'room:leave',
  KICK_PLAYER = 'room:kick',
  UPDATE_ROOM_CONFIG = 'room:update_config',
  READY = 'room:ready',
  START_GAME = 'room:start_game',
  
  // 游戏相关
  PLAYER_ACTION = 'game:action',        // 下注动作
  GET_CHIPS = 'game:get_chips',         // 领取筹码
  SEND_CHAT = 'game:chat',              // 发送消息
  REQUEST_HISTORY = 'game:history',     // 请求历史记录
}

// 服务端 → 客户端 事件
enum ServerEvents {
  // 连接相关
  CONNECTED = 'connection:connected',
  DISCONNECTED = 'connection:disconnected',
  ERROR = 'connection:error',
  
  // 房间相关
  ROOM_CREATED = 'room:created',
  ROOM_UPDATED = 'room:updated',
  PLAYER_JOINED = 'room:player_joined',
  PLAYER_LEFT = 'room:player_left',
  PLAYER_KICKED = 'room:player_kicked',
  HOST_CHANGED = 'room:host_changed',
  
  // 游戏相关
  GAME_STARTED = 'game:started',
  GAME_ENDED = 'game:ended',
  DEAL_CARDS = 'game:deal_cards',       // 发牌
  COMMUNITY_CARDS = 'game:community_cards', // 公共牌
  PLAYER_TURN = 'game:player_turn',     // 轮到某位玩家
  ACTION_RESULT = 'game:action_result', // 动作结果
  POT_UPDATED = 'game:pot_updated',     // 底池更新
  SHOWDOWN = 'game:showdown',           // 摊牌
  HAND_RESULT = 'game:hand_result',     // 手牌结果
  PLAYER_ELIMINATED = 'game:player_eliminated',
  
  // 系统相关
  CHAT_MESSAGE = 'system:chat',
  SYSTEM_MESSAGE = 'system:message',
  CHIPS_RECEIVED = 'system:chips_received',
}
```

### 5.2 消息格式

```typescript
// 基础消息结构
interface WebSocketMessage<T = any> {
  event: string;
  payload: T;
  timestamp: number;
  messageId: string;
}

// 示例: 玩家动作消息
interface PlayerActionPayload {
  roomId: string;
  playerId: string;
  action: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  amount?: number;  // raise/all-in时需要
}

// 示例: 发牌消息
interface DealCardsPayload {
  roomId: string;
  handId: string;
  cards: [Card, Card];  // 仅发送给对应玩家
}

// 示例: 游戏结果消息
interface HandResultPayload {
  roomId: string;
  handId: string;
  winners: WinnerInfo[];
  pots: PotResult[];
  playerHands: PlayerHandReveal[];
  handRankings: HandRanking[];
}

interface WinnerInfo {
  playerId: string;
  playerName: string;
  winAmount: number;
  handRank: HandRank;
  handDescription: string;
  winningCards: Card[];
  explanation: string;  // 详细的获胜说明
}
```

### 5.3 房间状态同步策略

```
┌─────────────────────────────────────────────────────────────────┐
│                     状态同步机制                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 完整状态同步 (进入房间时)                                    │
│  ─────────────────────────                                       │
│  客户端 → Server: 请求加入房间                                   │
│  Server → 客户端: 发送完整房间状态                               │
│  ┌─────────────────────────────────────────┐                     │
│  │ RoomFullState {                         │                     │
│  │   room: RoomInfo,                       │                     │
│  │   players: Player[],                    │                     │
│  │   gameState?: GameState,                │                     │
│  │   history: HandHistory[]                │                     │
│  │ }                                       │                     │
│  └─────────────────────────────────────────┘                     │
│                                                                  │
│  2. 增量更新 (游戏中)                                            │
│  ─────────────────                                               │
│  仅发送变化的部分，减少网络传输:                                  │
│  - game:player_turn → 仅包含当前玩家和行动信息                   │
│  - game:action_result → 仅包含动作结果和状态变化                 │
│  - game:pot_updated → 仅包含新的底池金额                         │
│                                                                  │
│  3. 心跳保活                                                     │
│  ───────────                                                     │
│  Client → Server: ping (每30秒)                                  │
│  Server → Client: pong + 在线玩家列表                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 💰 六、结算与统计系统

### 6.1 每局详细结算

**结算时需要展示的信息:**

```typescript
interface HandSettlement {
  handId: string;
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  
  // 赢家信息
  winners: {
    playerId: string;
    playerName: string;
    winAmount: number;
    potType: 'main' | 'side1' | 'side2';
    
    // 关键: 详细的获胜说明
    winningHand: {
      rank: HandRank;           // 牌型等级
      rankName: string;         // 牌型名称(如"同花顺")
      description: string;      // 描述(如"A-K-Q-J-10 同花")
      cards: Card[];            // 组成牌型的5张牌
      holeCards: Card[];        // 使用的底牌
      communityCards: Card[];   // 使用的公共牌
    };
    
    explanation: string;        // 人类可读的说明
    // 例如: "玩家张三以黑桃同花顺(A-K-Q-J-10)击败李四的三条A，赢得主池$500"
  }[];
  
  // 所有参与者的手牌（游戏结束后才揭示）
  allHands: {
    playerId: string;
    playerName: string;
    holeCards: Card[];
    bestHand: Card[];
    handRank: HandRank;
    handDescription: string;
    result: 'win' | 'loss' | 'fold';
  }[];
  
  // 底池分配详情
  potBreakdown: {
    totalPot: number;
    mainPot: number;
    sidePots?: {
      amount: number;
      eligiblePlayers: string[];
      winner: string;
    }[];
  };
}
```

### 6.2 结算界面设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🎉 本局结算                                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  🏆 赢家: 张三                                                   │   │
│  │                                                                  │   │
│  │  获胜牌型: 同花顺 (Straight Flush)                               │   │
│  │  牌型描述: 黑桃 A-K-Q-J-10                                       │   │
│  │                                                                  │   │
│  │  底牌: 🂡 🂢  (黑桃A, 黑桃K)                                       │   │
│  │  公共牌: 🂡 🂢 🂣 🂤 🂥  (黑桃A,K,10,方块J,梅花Q)                     │   │
│  │                                                                  │   │
│  │  说明: 张三以黑桃同花顺击败李四的三条A和李王的顺子               │   │
│  │        赢得主池 $500                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  📊 本局所有玩家手牌                                             │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  张三 [WIN]  🂡🂢  +$500   同花顺                                 │   │
│  │  李四        🂮🂭  -$200   三条A (被同花顺击败)                    │   │
│  │  李王        🂹🂸  -$200   顺子 (被同花顺击败)                    │   │
│  │  赵六 [Fold]  ??   -$50   弃牌                                  │   │
│  │  钱七 [Fold]  ??   -$50   弃牌                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  💰 底池分配详情                                                 │   │
│  │  主池: $500 → 张三                                               │   │
│  │  边池1: $0                                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                    [下一局]  [查看详情]  [返回大厅]                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 最终统计系统

**游戏结束时的总统计:**

```typescript
interface SessionStatistics {
  sessionId: string;
  roomId: string;
  startTime: Date;
  endTime: Date;
  totalHands: number;          // 总局数
  
  players: {
    playerId: string;
    playerName: string;
    
    // 筹码变化
    initialChips: number;      // 起始筹码
    finalChips: number;        // 结束筹码
    netProfit: number;         // 净盈亏 (最终-初始)
    buyIns: number;            // 补充次数
    totalBuyInAmount: number;  // 总补充金额
    
    // 游戏统计
    handsPlayed: number;       // 参与手数
    handsWon: number;          // 获胜手数
    handsFolded: number;       // 弃牌手数
    winRate: number;           // 胜率
    
    // 下注统计
    totalBet: number;          // 总下注额
    totalWin: number;          // 总赢取额
    biggestWin: number;        // 单局最大赢取
    biggestLoss: number;       // 单局最大损失
    
    // 手牌统计
    bestHand: HandRank;        // 最佳牌型
    bestHandDescription: string;
    allInCount: number;        // 全押次数
    
    // 排名
    rank: number;              // 最终排名
  }[];
  
  // 精彩时刻
  highlights: {
    biggestPot: {
      amount: number;
      handId: string;
      winners: string[];
    };
    bestHand: {
      handRank: HandRank;
      playerName: string;
      handId: string;
    };
    mostActionPlayer: string;  // 最活跃玩家
    luckiestPlayer: string;    // 运气最好玩家
  };
}
```

### 6.4 最终结算界面

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🎊 游戏结束 - 最终统计                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  游戏时长: 2小时35分钟    总局数: 47局    房间: 欢乐德州桌              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  🏆 最终排行榜                                                   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  排名  玩家        起始筹码   结束筹码   盈亏      胜率    手数 │   │
│  │  ─────────────────────────────────────────────────────────────  │   │
│  │  🥇 1   张三       $1,000    $3,240   +$2,240   48%     45    │   │
│  │  🥈 2   李四       $1,000    $2,180   +$1,180   42%     47    │   │
│  │  🥉 3   王五       $1,000    $1,050    +$50     38%     46    │   │
│  │  4    赵六       $1,000      $480    -$520    35%     43    │   │
│  │  5    钱七       $1,000      $50     -$950    28%     44    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  📈 个人详细统计 - 张三                                          │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  总盈亏: +$2,240 (+224%)                                        │   │
│  │  参与手数: 45 / 47 (96%)                                        │   │
│  │  获胜手数: 22 (48%胜率)                                         │   │
│  │  总下注额: $5,680                                               │   │
│  │  最大单局赢取: $890                                             │   │
│  │  最大单局损失: $340                                             │   │
│  │  最佳牌型: 同花顺 (A-K-Q-J-10)                                  │   │
│  │  全押次数: 3                                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  🌟 精彩时刻                                                     │   │
│  │  • 最大底池: $1,560 (第23局，张三、李四、王五三家all-in)        │   │
│  │  • 最佳牌型: 张三的同花顺 (第31局)                              │   │
│  │  • 最活跃玩家: 张三 (参与96%的手牌)                             │   │
│  │  • 运气之星: 王五 (中四条2次)                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│           [💾 保存截图]  [📊 导出数据]  [🏠 返回大厅]                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🃏 七、扑克引擎核心算法

### 7.1 牌型判断算法

```typescript
// 牌型定义
enum HandRank {
  HIGH_CARD = 1,
  ONE_PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
  ROYAL_FLUSH = 10,
}

// 牌型判断器
class HandEvaluator {
  // 从7张牌(2张底牌+5张公共牌)中找出最大5张组合
  static evaluate(cards: Card[]): HandResult {
    const allCombinations = this.getCombinations(cards, 5);
    let bestHand = null;
    let bestRank = 0;
    
    for (const combo of allCombinations) {
      const rank = this.evaluateFiveCards(combo);
      if (rank > bestRank) {
        bestRank = rank;
        bestHand = combo;
      }
    }
    
    return {
      rank: bestRank,
      rankName: this.getRankName(bestRank),
      cards: bestHand,
      description: this.getDescription(bestHand, bestRank),
    };
  }
  
  // 判断5张牌的牌型
  private static evaluateFiveCards(cards: Card[]): number {
    const isFlush = this.isFlush(cards);
    const isStraight = this.isStraight(cards);
    const counts = this.getCardCounts(cards);
    
    if (isFlush && isStraight) {
      return cards.some(c => c.rank === 'A') && cards.some(c => c.rank === 'K')
        ? HandRank.ROYAL_FLUSH 
        : HandRank.STRAIGHT_FLUSH;
    }
    if (counts.includes(4)) return HandRank.FOUR_OF_A_KIND;
    if (counts.includes(3) && counts.includes(2)) return HandRank.FULL_HOUSE;
    if (isFlush) return HandRank.FLUSH;
    if (isStraight) return HandRank.STRAIGHT;
    if (counts.includes(3)) return HandRank.THREE_OF_A_KIND;
    if (counts.filter(c => c === 2).length === 2) return HandRank.TWO_PAIR;
    if (counts.includes(2)) return HandRank.ONE_PAIR;
    return HandRank.HIGH_CARD;
  }
  
  // 比较两手牌大小
  static compareHands(hand1: HandResult, hand2: HandResult): number {
    if (hand1.rank !== hand2.rank) {
      return hand1.rank - hand2.rank;
    }
    // 同牌型时比较关键牌
    return this.compareByKickers(hand1.cards, hand2.cards);
  }
}
```

### 7.2 底池分配算法

```typescript
class PotManager {
  private mainPot: number = 0;
  private sidePots: SidePot[] = [];
  private contributions: Map<string, number> = new Map();
  
  // 记录玩家下注
  addBet(playerId: string, amount: number) {
    const current = this.contributions.get(playerId) || 0;
    this.contributions.set(playerId, current + amount);
  }
  
  // 计算边池（当有玩家all-in时）
  calculatePots() {
    const sortedContributions = Array.from(this.contributions.entries())
      .sort((a, b) => a[1] - b[1]);
    
    let previousAmount = 0;
    const pots: Pot[] = [];
    
    for (let i = 0; i < sortedContributions.length; i++) {
      const [playerId, amount] = sortedContributions[i];
      const diff = amount - previousAmount;
      
      if (diff > 0) {
        const eligiblePlayers = sortedContributions
          .slice(i)
          .map(([id]) => id);
        
        pots.push({
          amount: diff * eligiblePlayers.length,
          eligiblePlayers,
        });
        
        previousAmount = amount;
      }
    }
    
    return pots;
  }
  
  // 分配底池给赢家
  distributePots(pots: Pot[], winners: string[]): Map<string, number> {
    const payouts = new Map<string, number>();
    
    for (const pot of pots) {
      const potWinners = winners.filter(w => pot.eligiblePlayers.includes(w));
      const splitAmount = Math.floor(pot.amount / potWinners.length);
      
      for (const winner of potWinners) {
        const current = payouts.get(winner) || 0;
        payouts.set(winner, current + splitAmount);
      }
    }
    
    return payouts;
  }
}
```

---

## 🚀 八、部署方案

### 8.1 Docker 部署配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  # 主应用服务
  poker-server:
    build:
      context: ./server
      dockerfile: Dockerfile
    ports:
      - "3000:3000"      # HTTP API
      - "3001:3001"      # WebSocket
    environment:
      - NODE_ENV=production
      - PORT=3000
      - WS_PORT=3001
      - DB_PATH=/data/poker.db
      - JWT_SECRET=${JWT_SECRET}
    volumes:
      - ./data:/data      # 持久化数据库
    restart: unless-stopped
    networks:
      - poker-network

  # 前端服务 (可选，用于静态文件)
  poker-client:
    build:
      context: ./client
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - poker-server
    restart: unless-stopped
    networks:
      - poker-network

  # Nginx 反向代理 (可选)
  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"
      - "8443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - poker-server
      - poker-client
    restart: unless-stopped
    networks:
      - poker-network

networks:
  poker-network:
    driver: bridge
```

### 8.2 家庭服务器部署步骤

```bash
# 1. 安装 Docker 和 Docker Compose
# Windows: 安装 Docker Desktop
# Linux:
curl -fsSL https://get.docker.com | sh

# 2. 克隆项目
git clone https://github.com/yourname/texas-poker-game.git
cd texas-poker-game

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件设置 JWT_SECRET 等

# 4. 启动服务
docker-compose up -d

# 5. 查看日志
docker-compose logs -f poker-server

# 6. 访问游戏
# 本地: http://localhost:8080
# 局域网: http://<服务器IP>:8080
```

### 8.3 内网穿透方案（邀请外网好友）

```
方案一: 使用 frp (推荐)
────────────────────────
1. 准备一台有公网IP的服务器（阿里云/腾讯云轻量）
2. 在公网服务器部署 frps
3. 在家用电脑部署 frpc，将本地 8080 端口映射到公网
4. 好友通过公网地址访问

方案二: 使用 ngrok
──────────────────
1. 注册 ngrok 账号
2. 下载 ngrok 客户端
3. ngrok http 8080
4. 获得临时公网 URL 分享给好友

方案三: 使用 cloudflare tunnel (免费)
──────────────────────────────────────
1. 安装 cloudflared
2. cloudflared tunnel login
3. cloudflared tunnel create poker
4. cloudflared tunnel route dns poker poker.yourdomain.com
5. cloudflared tunnel run poker
```

---

## 📱 九、用户体验细节

### 9.1 新手引导

```
首次进入游戏:
1. 欢迎弹窗 + 简短游戏规则动画 (30秒)
2. 界面高亮提示:
   - 闪烁显示"创建房间"按钮
   - 显示气泡: "点击这里创建你的第一个房间!"
3. 第一局游戏:
   - 显示推荐操作提示
   - 牌型强度指示器
   - 当前胜率估算
```

### 9.2 动画效果设计

```typescript
// 关键动画效果
const animations = {
  // 发牌动画
  dealCard: {
    duration: 0.3,
    from: { scale: 0, x: 0, y: 0 },  // 牌堆位置
    to: { scale: 1, x: seatX, y: seatY },
    easing: 'easeOutBack',
  },
  
  // 筹码移动
  moveChips: {
    duration: 0.5,
    from: { x: playerX, y: playerY },
    to: { x: potX, y: potY },
    easing: 'easeInOutQuad',
  },
  
  // 赢家效果
  winnerGlow: {
    duration: 2,
    animation: 'pulse-gold',
    repeat: 3,
  },
  
  // 手牌揭示
  revealCards: {
    duration: 0.4,
    from: { rotateY: 180 },  // 背面
    to: { rotateY: 0 },      // 正面
    stagger: 0.1,            // 两张牌间隔
  },
};
```

### 9.3 音效设计

```
音效列表:
- deal.mp3      : 发牌音效
- chips.mp3     : 筹码下注
- fold.mp3      : 弃牌
- win.mp3       : 胜利
- allin.mp3     : 全押
- tick.mp3      : 倒计时提醒
- yourturn.mp3  : 轮到行动
```

### 9.4 快捷操作

```
键盘快捷键:
- Space : 跟注/过牌
- F     : 弃牌
- A     : 全押
- R     : 加注 (打开加注面板)
- 1-9   : 快速加注 (1x, 1.5x, 2x, ... 底池)
- C     : 聊天框聚焦
- Esc   : 取消/关闭弹窗
```

---

## 🔐 十、安全与防作弊

### 10.1 安全措施

```typescript
// 服务端验证
class SecurityManager {
  // 1. 所有操作服务端验证
  validateAction(playerId: string, action: PlayerAction, gameState: GameState): boolean {
    // 验证玩家是否轮到
    if (gameState.currentPlayer !== playerId) return false;
    
    // 验证动作合法性
    if (!this.isValidAction(action, gameState)) return false;
    
    // 验证筹码足够
    const player = gameState.getPlayer(playerId);
    if (player.chips < action.amount) return false;
    
    return true;
  }
  
  // 2. 手牌加密存储（直到摊牌）
  private encryptHand(hand: Card[], key: string): string {
    return encrypt(JSON.stringify(hand), key);
  }
  
  // 3. 防止串通: 记录IP，同IP警告
  checkCollusion(room: Room): CollusionWarning[] {
    const ipMap = new Map<string, string[]>();
    for (const player of room.players) {
      const ips = ipMap.get(player.ip) || [];
      ips.push(player.id);
      ipMap.set(player.ip, ips);
    }
    // 返回同IP多账号警告
  }
}
```

### 10.2 反作弊检测

```
检测机制:
1. 异常下注模式检测
2. 胜率异常检测 (胜率>60%触发审查)
3. 行动时间分析 (脚本操作通常时间固定)
4. 多账号检测 (同IP/设备指纹)
```

---

## 📅 十一、开发计划

### 11.1 开发阶段

```
Phase 1: 基础框架 (2周)
───────────────────────
□ 项目脚手架搭建
□ 数据库设计实现
□ 基础API开发
□ WebSocket连接框架

Phase 2: 游戏核心 (3周)
───────────────────────
□ 扑克引擎 (发牌、牌型判断)
□ 游戏状态机
□ 底池计算
□ 基本游戏流程

Phase 3: 房间系统 (2周)
───────────────────────
□ 房间创建/加入
□ 玩家管理
□ 房间配置
□ 邀请系统

Phase 4: 前端界面 (3周)
───────────────────────
□ 游戏大厅
□ 扑克桌界面
□ 玩家交互
□ 动画效果

Phase 5: 结算系统 (1周)
───────────────────────
□ 每局结算展示
□ 最终统计
□ 数据导出

Phase 6: 优化部署 (1周)
───────────────────────
□ 性能优化
□ Docker配置
□ 内网穿透集成
□ 文档完善
```

### 11.2 MVP 功能列表

**最小可行产品 (MVP) 必须包含:**
1. ✅ 2-6人游戏支持
2. ✅ 基础德州扑克规则
3. ✅ 房间创建/加入
4. ✅ 基础游戏界面
5. ✅ 基本结算显示
6. ✅ 筹码补充功能

**后续迭代添加:**
- 观战模式
- 语音聊天
- 自定义头像
- 战绩统计
- 排行榜
- 成就系统

---

## 📚 参考资源

### 设计参考
- PokerStars 客户端界面
- Zynga Poker 移动版
- 德州扑克专业赛事直播界面

### 技术参考
- Socket.io 文档: https://socket.io/docs/
- PokerHand Evaluator 算法
- React 游戏开发最佳实践

---

*文档版本: 1.0*
*创建日期: 2026-04-29*
*作者: AI Assistant*
