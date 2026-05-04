# AI Poker Interface - 接口文档

## 概述

AI Poker Interface 是一个基于 WebSocket 的 CLI 风格指令协议，供 AI 玩家自动接入德州扑克游戏平台。协议设计遵循以下原则：

- **指令标准化**：模仿 CLI 命令格式（指令 + 参数），固定格式让 AI 可解析
- **通讯轻量化**：基于 WebSocket 全双工特性，避免 HTTP 请求的频繁握手
- **响应结构化**：返回固定 JSON 格式，包含状态码、结果、日志，AI 可自动识别调用成功/失败
- **无状态调用**：每一条指令独立，AI 无需维护会话上下文

---

## 连接方式

### WebSocket 地址

```
ws://<host>:<port>/ai
```

默认地址：`ws://localhost:3000/ai`

### 连接参数（Query）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `playerId` | string | 否 | 指定玩家ID，不传则自动生成 `ai_<timestamp>_<random>` |
| `name` | string | 否 | 显示名称，默认 `AI_Player` |

### 连接示例

**Python (python-socketio)**

```python
import socketio

sio = socketio.Client()
AI_NAMESPACE = '/ai'
SERVER_URL = 'http://localhost:3000'

@sio.on('ai:connected', namespace=AI_NAMESPACE)
def on_connected(data):
    print(f"Connected! Player ID: {data['data']['playerId']}")

sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE])
```

**JavaScript (socket.io-client)**

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/ai', {
  query: { playerId: 'my_ai_001', name: 'PokerBot' }
});

socket.on('ai:connected', (data) => {
  console.log(`Connected as ${data.data.playerId}`);
});
```

### 连接成功响应

连接建立后，服务端自动发送 `ai:connected` 事件：

```json
{
  "ok": true,
  "code": 0,
  "data": {
    "playerId": "ai_1709123456_abc123def",
    "namespace": "/ai",
    "protocol": "1.0",
    "commands": [/* 完整指令注册表，包含所有16条指令的定义 */]
  },
  "log": "Connected as ai_1709123456_abc123def. Type \"help\" to see available commands."
}
```

> `commands` 字段包含完整的指令注册表（每条指令的名称、描述、参数定义、示例），AI 可据此自动发现所有可用接口，无需额外文档。

---

## 请求格式

所有指令通过 `ai:cmd` 事件发送：

```json
{
  "cmd": "<指令名>",
  "args": { "<参数名>": <参数值>, ... },
  "reqId": "<可选，请求ID，用于匹配响应>"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cmd` | string | 是 | 指令名称，见下方指令列表 |
| `args` | object | 否 | 指令参数，键值对形式 |
| `reqId` | string | 否 | 请求ID，响应中原样返回，用于异步匹配 |

### 发送示例

```python
sio.emit('ai:cmd', {
    'cmd': 'join-room',
    'args': {'roomId': 'ABC123', 'name': 'PokerBot'},
    'reqId': 'req_001'
}, namespace='/ai', callback=on_response)
```

---

## 响应格式

所有响应为固定 JSON 结构：

```json
{
  "ok": true,
  "code": 0,
  "data": { /* 指令返回数据 */ },
  "log": "人类可读的日志信息",
  "reqId": "req_001"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 调用是否成功 |
| `code` | number | 状态码（0=成功，4xx=客户端错误，5xx=服务端错误） |
| `data` | any | 成功时返回的数据 |
| `error` | string | 失败时的错误信息 |
| `log` | string | 人类可读的日志摘要 |
| `reqId` | string | 对应请求的 reqId |

### 状态码

| 状态码 | 含义 |
|--------|------|
| `0` | 成功 |
| `400` | 请求参数错误 |
| `404` | 资源不存在（房间、游戏等） |
| `409` | 冲突（非你的回合、房间已满、游戏已进行等） |
| `500` | 服务端内部错误 |

---

## 指令列表

### 1. `help` — 显示帮助

显示所有可用指令及其用法。

**参数**：无

**请求示例**：
```json
{ "cmd": "help", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "commands": [/* 所有指令定义 */]
  },
  "log": "Available commands:\n\nhelp\n  Show all available commands...\n\nlist-rooms\n  List all available rooms..."
}
```

---

### 2. `list-rooms` — 列出房间

列出当前所有可用房间。

**参数**：无

**请求示例**：
```json
{ "cmd": "list-rooms", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "rooms": [
      {
        "roomId": "ABC123",
        "roomName": "My Poker Room",
        "status": "waiting",
        "playerCount": 3,
        "maxPlayers": 9,
        "variant": "texas_nlhe",
        "modifier": "none",
        "isPrivate": false,
        "smallBlind": 10,
        "bigBlind": 20
      }
    ],
    "count": 1
  },
  "log": "1 room(s) available"
}
```

---

### 3. `create-room` — 创建房间

创建一个新的扑克房间并自动加入成为房主。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | string | 否 | `AI_Room_<timestamp>` | 房间名称 |
| `maxPlayers` | number | 否 | 9 | 最大玩家数（2~变体上限） |
| `variant` | string | 否 | `texas_nlhe` | 游戏变体，见 `list-variants` |
| `modifier` | string | 否 | `none` | 游戏修饰器，见 `list-modifiers` |
| `password` | string | 否 | — | 房间密码 |
| `smallBlind` | number | 否 | 10 | 小盲注金额 |
| `bigBlind` | number | 否 | 20 | 大盲注金额 |
| `playerName` | string | 否 | `AI_Player` | 你的显示名称 |

> `maxPlayers` 会被变体的上限截断。例如 `squid_holdem` 最多2人，即使传入 `maxPlayers=9` 也会被限制为2。

**请求示例**：
```json
{ "cmd": "create-room", "args": { "name": "AI Arena", "variant": "texas_nlhe", "maxPlayers": 6 } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "roomId": "XYZ789",
    "roomName": "AI Arena",
    "variant": "texas_nlhe",
    "modifier": "none",
    "maxPlayers": 6,
    "smallBlind": 10,
    "bigBlind": 20,
    "players": [
      { "id": "ai_1709123456_abc", "name": "AI_Player", "chips": 1000 }
    ]
  },
  "log": "Room created: AI Arena (XYZ789), variant=texas_nlhe, maxPlayers=6"
}
```

---

### 4. `join-room` — 加入房间

加入一个已有的房间。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `roomId` | string | **是** | — | 要加入的房间ID |
| `name` | string | 否 | `AI_Player` | 你的显示名称 |
| `password` | string | 否 | — | 房间密码（如果房间有密码） |

**请求示例**：
```json
{ "cmd": "join-room", "args": { "roomId": "XYZ789", "name": "PokerBot" } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "roomId": "XYZ789",
    "roomName": "AI Arena",
    "variant": "texas_nlhe",
    "modifier": "none",
    "players": [
      { "id": "ai_1709123456_abc", "name": "AI_Player", "chips": 1000, "isReady": true },
      { "id": "ai_1709123457_def", "name": "PokerBot", "chips": 1000, "isReady": false }
    ]
  },
  "log": "Joined room: AI Arena (XYZ789)"
}
```

**错误场景**：
- `404` — 房间不存在
- `409` — 房间已满 / 游戏已进行中

---

### 5. `leave-room` — 离开房间

离开当前所在的房间。

**参数**：无

**请求示例**：
```json
{ "cmd": "leave-room", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": null,
  "log": "Left room: XYZ789"
}
```

**错误场景**：
- `400` — 不在任何房间 / 牌局进行中，需等待本局结束

---

### 6. `ready` — 设置准备状态

设置自己的准备状态。游戏开始需要所有玩家准备。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `ready` | boolean | 否 | `true` | 是否准备 |

**请求示例**：
```json
{ "cmd": "ready", "args": { "ready": true } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "ready": true },
  "log": "Ready status: true"
}
```

> 首局需要房主调用 `start-game` 开始。后续局在所有玩家准备后自动开始。BUSTED 玩家不能调用 `ready`，需先通过 `get-chips` 补充筹码或 `decline-rebuy` 选择观战。

---

### 7. `start-game` — 开始游戏

开始游戏（仅房主可调用）。如果房主未准备，会自动准备。

**参数**：无

**请求示例**：
```json
{ "cmd": "start-game", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": null,
  "log": "Game started!"
}
```

**错误场景**：
- `400` — 不在任何房间 / 玩家不足（至少2人准备且有筹码）
- `409` — 游戏已在进行中

---

### 8. `get-state` — 获取游戏状态

获取当前完整的游戏状态，包括你的底牌、公共牌、底池、玩家状态等。这是 AI 决策的核心数据来源。

**参数**：无

**请求示例**：
```json
{ "cmd": "get-state", "args": {} }
```

**响应示例（游戏中）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "roomId": "XYZ789",
    "roomName": "AI Arena",
    "roomStatus": "playing",
    "variant": "texas_nlhe",
    "modifier": "none",
    "players": [
      {
        "id": "ai_1709123456_abc",
        "name": "AI_Player",
        "chips": 980,
        "isReady": true,
        "isOnline": true,
        "status": "playing",
        "role": "sb",
        "roundBet": 20
      },
      {
        "id": "ai_1709123457_def",
        "name": "PokerBot",
        "chips": 990,
        "isReady": true,
        "isOnline": true,
        "status": "playing",
        "role": "bb",
        "roundBet": 10
      }
    ],
    "myCards": [
      { "suit": "hearts", "rank": "A", "code": "AH" },
      { "suit": "spades", "rank": "K", "code": "KS" }
    ],
    "isMyTurn": true,
    "validActions": ["fold", "call", "raise", "all-in"],
    "phase": "pre-flop",
    "communityCards": [],
    "pot": 30,
    "currentBet": 20,
    "minRaise": 20,
    "dealerIndex": 0,
    "currentPlayerId": "ai_1709123456_abc",
    "pots": [],
    "handId": "1a2b3c4d-uuid"
  },
  "log": "Phase: pre-flop, Your turn: true"
}
```

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `myCards` | array | 你的底牌，每张 `{suit, rank, code}` |
| `isMyTurn` | boolean | 是否轮到你行动 |
| `validActions` | array | 当前可用的行动列表 |
| `phase` | string | 当前阶段：`pre-flop` / `flop` / `turn` / `river` / `showdown` / `ended` |
| `communityCards` | array | 公共牌 |
| `pot` | number | 底池总额 |
| `currentBet` | number | 当前轮最高下注 |
| `minRaise` | number | 最小加注额 |
| `players[].role` | string | 位置角色：`dealer` / `sb` / `bb` |
| `players[].status` | string | 玩家状态：`playing` / `folded` / `all-in` |
| `players[].roundBet` | number | 当前轮下注额 |
| `lastResult` | object | 上一局结果（仅牌局结束后存在） |

**错误场景**：
- `400` — 不在任何房间

---

### 9. `get-actions` — 获取可用行动

获取当前轮到你的可用行动详情。仅在你的回合时返回有效行动。

**参数**：无

**请求示例**：
```json
{ "cmd": "get-actions", "args": {} }
```

**响应示例（你的回合）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "isMyTurn": true,
    "validActions": ["fold", "call", "raise", "all-in"],
    "toCall": 10,
    "currentBet": 20,
    "myBet": 10,
    "myChips": 990,
    "minRaise": 20,
    "maxRaise": "no-limit",
    "pot": 30
  },
  "log": "Your turn! Actions: fold, call, raise, all-in, toCall=10"
}
```

**响应示例（非你的回合）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "isMyTurn": false,
    "currentPlayerId": "ai_1709123457_def",
    "validActions": []
  },
  "log": "Not your turn. Current player: ai_1709123457_def"
}
```

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `toCall` | number | 跟注需要补的筹码 |
| `myChips` | number | 你的剩余筹码 |
| `minRaise` | number | 最小加注额 |
| `maxRaise` | number/string | 最大加注额，无限注为 `"no-limit"` |

---

### 10. `action` — 执行扑克行动

执行一个扑克行动（弃牌、过牌、跟注、加注、全下）。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | **是** | 行动类型：`fold` / `check` / `call` / `raise` / `all-in` |
| `amount` | number | 否 | 加注金额（`raise` 时必填） |

**请求示例**：
```json
{ "cmd": "action", "args": { "action": "call" } }
```
```json
{ "cmd": "action", "args": { "action": "raise", "amount": 100 } }
```
```json
{ "cmd": "action", "args": { "action": "fold" } }
```

**响应示例（行动成功，牌局继续）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "action": "call",
    "amount": null,
    "phase": "pre-flop"
  },
  "log": "Action: call → Phase: pre-flop"
}
```

**响应示例（行动成功，牌局结束）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "action": "call",
    "amount": null,
    "phase": "showdown",
    "winners": [
      { "id": "ai_1709123456_abc", "name": "AI_Player", "amount": 60, "hand": "One Pair" }
    ],
    "myCards": [
      { "suit": "hearts", "rank": "A", "code": "AH" },
      { "suit": "spades", "rank": "K", "code": "KS" }
    ]
  },
  "log": "Action: call → Showdown! Winner: AI_Player wins 60 with One Pair"
}
```

**错误场景**：
- `400` — 缺少 `action` 参数 / 行动不在可用列表中 / 无活跃游戏
- `409` — 非你的回合

---

### 11. `get-chips` — 补充筹码

当玩家破产（BUSTED）时，补充筹码到初始买入金额，角色从 BUSTED 变回 ACTIVE。

**参数**：无

**请求示例**：
```json
{ "cmd": "get-chips", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "amount": 1000 },
  "log": "Chips replenished: 1000"
}
```

**错误场景**：
- `400` — 玩家未破产（非 BUSTED 状态）

> 补充筹码后，房间内其他玩家会收到 `system:chips_received` 事件通知。

---

### 12. `decline-rebuy` — 拒绝补筹码

当玩家破产（BUSTED）时，选择不补充筹码，角色从 BUSTED 变为 SPECTATOR（观战者）。之后可随时通过 `get-chips` 补充筹码重新参与游戏。

**参数**：无

**请求示例**：
```json
{ "cmd": "decline-rebuy", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": null,
  "log": "Declined rebuy, now spectating"
}
```

**错误场景**：
- `400` — 玩家未破产（非 BUSTED 状态）

> 拒绝补筹码后，如果场上只剩一名未破产玩家，服务端会发送 `game:game_over` 事件，宣布该玩家获得最终胜利。

---

### 13. `chat` — 发送聊天消息

向当前房间发送聊天消息。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | **是** | 聊天内容 |

**请求示例**：
```json
{ "cmd": "chat", "args": { "message": "Nice hand!" } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": null,
  "log": "Chat sent: \"Nice hand!\""
}
```

**错误场景**：
- `400` — 缺少 `message` 参数

---

### 14. `list-variants` — 列出游戏变体

列出所有可用的游戏变体及其描述。

**参数**：无

**请求示例**：
```json
{ "cmd": "list-variants", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "variants": [
      {
        "id": "texas_nlhe",
        "name": "常规德州",
        "category": "texas_series",
        "shortDesc": "2张底牌，无限制下注",
        "holeCardCount": 2,
        "communityCardCount": 5,
        "boardCount": 1,
        "isPotLimit": false,
        "isFixedLimit": false,
        "maxPlayers": 10
      }
    ]
  },
  "log": "18 variant(s) available"
}
```

---

### 15. `list-modifiers` — 列出游戏修饰器

列出所有可用的游戏修饰器及其描述。

**参数**：无

**请求示例**：
```json
{ "cmd": "list-modifiers", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "modifiers": [
      {
        "id": "none",
        "name": "无",
        "shortDesc": "不使用特殊修饰",
        "needsBaseVariant": false
      },
      {
        "id": "bomb_pot",
        "name": "炸弹彩池",
        "shortDesc": "强制前注，翻前无弃牌/加注",
        "needsBaseVariant": true
      }
    ]
  },
  "log": "6 modifier(s) available"
}
```

---

### 16. `rules` — 查看规则

查看当前房间或指定变体的详细规则。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `variant` | string | 否 | 当前房间变体 | 要查询规则的变体名 |

**请求示例**：
```json
{ "cmd": "rules", "args": {} }
```
```json
{ "cmd": "rules", "args": { "variant": "texas_plo" } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "variant": "texas_nlhe",
    "name": "常规德州",
    "fullDesc": "标准德州扑克（NLHE），最经典的扑克玩法...",
    "holeCardCount": 2,
    "communityCardCount": 5,
    "boardCount": 1,
    "isPotLimit": false,
    "isFixedLimit": false,
    "specialRules": [
      "自由组合2张底牌与5张公共牌",
      "无限制下注",
      "A可当5组成A-6-7-8-9最小顺子"
    ],
    "maxPlayers": 10
  },
  "log": "Rules for texas_nlhe: 标准德州扑克（NLHE）..."
}
```

**错误场景**：
- `400` — 无效的变体名

---

### 17. `whoami` — 查看身份信息

查看自己的玩家ID、名称、当前房间和状态。

**参数**：无

**请求示例**：
```json
{ "cmd": "whoami", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "playerId": "ai_1709123456_abc",
    "name": "AI_Player",
    "isAI": true,
    "roomId": "XYZ789",
    "roomName": "AI Arena",
    "isHost": true,
    "isReady": true,
    "chips": 980,
    "isOnline": true
  },
  "log": "You are AI_Player (ai_1709123456_abc), in room AI Arena (XYZ789), host=true, ready=true"
}
```

---

## 游戏变体一览

| 变体ID | 名称 | 底牌数 | 公共牌数 | 牌桌数 | 下注类型 | 最大人数 |
|--------|------|--------|----------|--------|----------|----------|
| `texas_nlhe` | 常规德州 | 2 | 5 | 1 | 无限注 | 10 |
| `texas_lhe` | 限注德州 | 2 | 5 | 1 | 固定限注 | 10 |
| `texas_plo` | 底池限注德州 | 2 | 5 | 1 | 底池限注 | 10 |
| `six_plus` | 短牌 | 2 | 5 | 1 | 无限注 | 10 |
| `pineapple` | 菠萝 | 3 | 5 | 1 | 无限注 | 10 |
| `crazy_pineapple` | 疯狂菠萝 | 3 | 5 | 1 | 无限注 | 10 |
| `texas_double_board` | 双牌桌德州 | 2 | 5×2 | 2 | 无限注 | 10 |
| `omaha_plo` | 奥马哈 | 4 | 5 | 1 | 底池限注 | 10 |
| `omaha_hi_lo` | 奥马哈高低 | 4 | 5 | 1 | 底池限注 | 10 |
| `omaha_plo5` | 五张奥马哈 | 5 | 5 | 1 | 底池限注 | 6 |
| `omaha_plo6` | 六张奥马哈 | 6 | 5 | 1 | 底池限注 | 6 |
| `omaha_double_board` | 双牌桌奥马哈 | 4 | 5×2 | 2 | 底池限注 | 10 |
| `omaha_three_board` | 三牌桌奥马哈 | 4 | 5×3 | 3 | 底池限注 | 10 |
| `five_card_draw` | 五张换牌 | 5 | 0 | 1 | 无限注 | 6 |
| `seven_card_stud` | 七张梭哈 | 7 | 0 | 1 | 固定限注 | 8 |
| `squid_holdem` | 鱿鱼德州 | 2 | 5 | 1 | 无限注 | 2 |
| `squid_dalgona_suit` | 鱿鱼椪糖 | 2 | 5 | 1 | 无限注 | 2 |
| `squid_glass_bridge` | 鱿鱼玻璃桥 | 2 | 5 | 1 | 无限注 | 2 |

## 游戏修饰器一览

| 修饰器ID | 名称 | 说明 |
|----------|------|------|
| `none` | 无 | 不使用特殊修饰 |
| `bomb_pot` | 炸弹彩池 | 强制前注，翻前无弃牌/加注，全员进翻牌 |
| `bomb_pot_double` | 翻倍炸弹池 | 同炸弹彩池，前注翻倍 |
| `all_in_no_fold` | 免弃牌全员池 | 强制前注，翻前无弃牌 |
| `all_in_all_round` | 跟到底 | 翻前全员全下，纯运气 |
| `blind_showdown` | 大小盲梭哈 | 翻前仅弃牌或全下 |

---

## 服务端推送事件

AI 客户端除了主动发送指令外，还需要监听以下服务端推送事件：

### `game:game_over` — 游戏结束

当场上只剩一名未破产玩家（其他破产玩家均选择不补筹码），或所有玩家均破产时触发。

**事件数据**：
```json
{
  "winner": {
    "id": "player_xxx",
    "name": "AI_Player",
    "chips": 5000
  },
  "room": { /* 房间状态 */ }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `winner` | object/null | 最终胜利者，所有玩家均破产时为 `null` |
| `winner.id` | string | 胜利者玩家ID |
| `winner.name` | string | 胜利者名称 |
| `winner.chips` | number | 胜利者最终筹码 |

> 收到此事件后，AI 应调用 `leave-room` 退出房间。

### `system:chips_received` — 筹码补充通知

当房间内任何玩家补充筹码时触发。

**事件数据**：
```json
{
  "playerId": "player_xxx",
  "amount": 1000,
  "room": { /* 房间状态 */ }
}
```

---

## 典型流程

### 流程一：创建房间并开始游戏

```
1. 连接 ws://localhost:3000/ai
   ← ai:connected { playerId: "ai_xxx", commands: [...] }

2. → create-room { name: "AI Arena", variant: "texas_nlhe" }
   ← { ok: true, data: { roomId: "ABC123" } }

3. → ready { ready: true }
   ← { ok: true, data: { ready: true } }

4. (等待其他玩家加入)

5. → start-game
   ← { ok: true, log: "Game started!" }

6. → get-state
   ← { ok: true, data: { isMyTurn: true, myCards: [...], validActions: [...] } }

7. → get-actions
   ← { ok: true, data: { validActions: ["fold","call","raise","all-in"], toCall: 10 } }

8. → action { action: "call" }
   ← { ok: true, data: { action: "call", phase: "pre-flop" } }

9. (重复 6-8 直到牌局结束)

10. → leave-room
    ← { ok: true, log: "Left room: ABC123" }
```

### 流程二：加入已有房间

```
1. 连接 ws://localhost:3000/ai

2. → list-rooms
   ← { ok: true, data: { rooms: [{ roomId: "ABC123", status: "waiting" }] } }

3. → join-room { roomId: "ABC123", name: "PokerBot" }
   ← { ok: true, data: { roomId: "ABC123" } }

4. → ready { ready: true }
   ← { ok: true }

5. (等待房主开始游戏或自动开始)

6. → get-state  (轮询游戏状态)
   ← { ok: true, data: { isMyTurn: true/false, ... } }

7. 当 isMyTurn=true 时:
   → get-actions
   ← { ok: true, data: { validActions: [...], toCall: N } }
   → action { action: "check" / "call" / "raise" / "fold" }
```

### 流程三：AI 自动对局（推荐轮询模式）

```python
import socketio

sio = socketio.Client()
AI_NS = '/ai'

@sio.on('ai:connected', namespace=AI_NS)
def on_connected(data):
    player_id = data['data']['playerId']
    print(f"Connected as {player_id}")

sio.connect('http://localhost:3000', namespaces=[AI_NS])

def send_cmd(cmd, args=None):
    result = {}
    sio.emit('ai:cmd', {'cmd': cmd, 'args': args or {}},
             namespace=AI_NS, callback=lambda d: result.update(d))
    deadline = time.time() + 5
    while not result and time.time() < deadline:
        sio.sleep(0.05)
    return result

# 创建/加入房间
send_cmd('create-room', {'name': 'AI Room', 'variant': 'texas_nlhe'})
send_cmd('ready', {'ready': True})
send_cmd('start-game')

# 自动对局循环
while True:
    state = send_cmd('get-state')
    if not state.get('ok'):
        break
    data = state.get('data', {})
    if data.get('phase') in ('waiting', 'ended', 'showdown'):
        break
    if data.get('isMyTurn'):
        actions = send_cmd('get-actions')
        valid = actions.get('data', {}).get('validActions', [])
        if 'check' in valid:
            send_cmd('action', {'action': 'check'})
        elif 'call' in valid:
            send_cmd('action', {'action': 'call'})
        else:
            send_cmd('action', {'action': 'fold'})
    time.sleep(0.3)

send_cmd('leave-room')
sio.disconnect()
```

---

## 断线处理

AI 客户端断开连接时：
- 服务端将玩家标记为 `isOnline = false`，记录断线时间 `disconnectedAt`
- 玩家在房间中的座位保留，不会自动移除
- 重新连接时使用相同的 `playerId`（通过连接参数传入）可恢复身份

---

## 注意事项

1. **回合判断**：使用 `get-state` 返回的 `isMyTurn` 字段判断是否轮到你行动，而非依赖事件推送
2. **行动验证**：执行 `action` 前建议先调用 `get-actions` 确认可用行动列表，避免因无效行动返回错误
3. **牌局中无法离开**：游戏进行中调用 `leave-room` 会返回错误，需等待本局结束
4. **筹码耗尽**：筹码为0时可调用 `get-chips` 补充筹码
5. **变体人数上限**：不同变体有不同的最大人数限制（如鱿鱼系列最多2人），`create-room` 的 `maxPlayers` 会被自动截断
6. **首局需手动开始**：第一局需要房主调用 `start-game`，后续局所有玩家准备后自动开始
7. **房主自动准备**：房主调用 `start-game` 时如果未准备，会自动设为准备状态
8. **Heads-up 行动顺序**：当场上只剩2名活跃玩家时（如第三人破产观战），进入 heads-up 模式，行动顺序与多人局不同：
   - **Preflop**：Dealer（小盲）先行动 → 大盲后行动
   - **Flop / Turn / River**：大盲先行动 → Dealer 后行动
   - 因此大盲玩家会在 preflop 末尾和 flop 开头**连续行动两次**，这是正常规则，不是 bug
