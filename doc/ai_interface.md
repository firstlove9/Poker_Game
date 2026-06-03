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
    "commands": [/* 完整指令注册表，包含所有20条指令的定义 */]
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
| `fixedHands` | number | 否 | 0 | 固定局数（0=无限，最少3局） |
| `maxRebuyCount` | number | 否 | 3 | 最大补码次数（-1=无限，0=不允许） |
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

开始游戏。房主可调用；当房主离线时，任意玩家也可调用。如果调用者未准备，会自动准备。

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
        "isAfk": false,
        "status": "playing",
        "role": "sb",
        "roundBet": 20,
        "playerRoomRole": "active"
      },
      {
        "id": "ai_1709123457_def",
        "name": "PokerBot",
        "chips": 990,
        "isReady": true,
        "isOnline": true,
        "isAfk": false,
        "status": "playing",
        "role": "bb",
        "roundBet": 10,
        "playerRoomRole": "active"
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
| `phase` | string | 当前阶段：`discard` / `pre-flop` / `flop` / `turn` / `river` / `run-it-twice-choice` / `run-it-twice-executing` / `showdown` / `ended` |
| `communityCards` | array | 公共牌 |
| `pot` | number | 底池总额 |
| `currentBet` | number | 当前轮最高下注 |
| `minRaise` | number | 最小加注额 |
| `players[].role` | string | 位置角色：`dealer` / `sb` / `bb` |
| `players[].status` | string | 玩家状态：`playing` / `folded` / `all-in` / `discard` |
| `players[].roundBet` | number | 当前轮下注额 |
| `players[].isAfk` | boolean | 是否挂机 |
| `players[].playerRoomRole` | string | 房间角色：`active` / `busted` / `spectator` / `seated` |
| `lastResult` | object | 上一局结果（仅牌局结束后存在） |
| `hostId` | string | 房主玩家ID |

> `discard` 阶段仅出现在 `pineapple`（大菠萝）变体中，玩家需选择弃掉一张底牌。

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

执行一个扑克行动（弃牌、过牌、跟注、加注、全下、弃底牌）。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | **是** | 行动类型：`fold` / `check` / `call` / `raise` / `all-in` / `discard` |
| `amount` | number | 否 | 加注金额（`raise` 时必填），弃牌索引（`discard` 时为要弃掉的底牌索引，0-based） |

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
```json
{ "cmd": "action", "args": { "action": "discard", "amount": 2 } }
```

> `discard` 行动仅在大菠萝（pineapple）变体的 `discard` 阶段可用，`amount` 指定要弃掉的底牌索引（0-based）。

**响应示例（行动成功，牌局继续）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "action": "call",
    "amount": null,
    "phase": "pre-flop",
    "isMyTurn": false,
    "pot": 50,
    "currentBet": 20
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

当玩家破产（BUSTED）时，补充筹码到初始买入金额，角色从 BUSTED 变回 ACTIVE。补充筹码后自动设为准备状态（`isReady = true`），等同于已点击"准备下一局"。

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
- `400` — 玩家未破产 / 已达最大补筹码次数 / 不在任何房间

> 补充筹码后：
> 1. 房间内其他玩家会收到 `system:chips_received` 事件通知
> 2. 你的 `isReady` 自动设为 `true`，无需再调用 `ready`
> 3. 如果所有玩家都已准备，游戏会自动开始

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
        "icon": "🤠",
        "category": "texas_series",
        "shortDesc": "2张底牌，无限制下注",
        "fullDesc": "标准德州扑克（NLHE），最经典的扑克玩法...",
        "holeCardCount": 2,
        "communityCardCount": 5,
        "boardCount": 1,
        "isPotLimit": false,
        "isFixedLimit": false,
        "specialRules": ["自由组合2张底牌与5张公共牌", "无限制下注", "A可当5组成A-6-7-8-9最小顺子"],
        "forceCombination": "free",
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
        "icon": "",
        "shortDesc": "不使用特殊修饰",
        "fullDesc": "不使用任何特殊修饰，按基础玩法规则进行。",
        "specialRules": [],
        "needsBaseVariant": false
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
    "id": "texas_nlhe",
    "name": "常规德州",
    "fullDesc": "标准德州扑克（NLHE），最经典的扑克玩法...",
    "holeCardCount": 2,
    "communityCardCount": 5,
    "boardCount": 1,
    "isPotLimit": false,
    "isFixedLimit": false,
    "specialRules": ["自由组合2张底牌与5张公共牌", "无限制下注", "A可当5组成A-6-7-8-9最小顺子"],
    "maxPlayers": 10,
    "handRankOrder": ["royal_flush", "straight_flush", "four_of_a_kind", "..."],
    "modifier": null
  },
  "log": "Rules for texas_nlhe: 标准德州扑克（NLHE）..."
}
```

**错误场景**：
- `400` — 无效的变体名 / 不在房间中且未指定 variant
- `404` — 变体不存在

---

### 17. `whoami` — 查看身份信息

查看自己的玩家ID、当前房间和状态。

**参数**：无

**请求示例**：
```json
{ "cmd": "whoami", "args": {} }
```

**响应示例（在房间中）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "playerId": "ai_1709123456_abc",
    "roomId": "XYZ789",
    "room": {
      "roomId": "XYZ789",
      "roomName": "AI Arena",
      "isHost": true,
      "variant": "texas_nlhe",
      "modifier": "none",
      "chips": 980,
      "isReady": true,
      "playerCount": 3,
      "maxPlayers": 6
    }
  },
  "log": "You are AI_Player (ai_1709123456_abc), in room AI Arena (XYZ789), host=true, ready=true"
}
```

**响应示例（不在房间中）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "playerId": "ai_1709123456_abc",
    "roomId": null,
    "room": null
  },
  "log": "You are ai_1709123456_abc, not in any room"
}
```

---

### 18. `run-it-twice-choice` — 选择是否发两次牌

当场上只剩两名玩家且有人全下时，进入 `run-it-twice-choice` 阶段。两名活跃玩家需各自选择是否发两次公共牌。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `choice` | string | **是** | 选择：`once`（发一次）或 `twice`（发两次） |

**请求示例**：
```json
{ "cmd": "run-it-twice-choice", "args": { "choice": "once" } }
```
```json
{ "cmd": "run-it-twice-choice", "args": { "choice": "twice" } }
```

**响应示例（等待对手选择）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "choice": "twice", "waitingForOther": true },
  "log": "Run-it-twice choice: twice, waiting for opponent"
}
```

**响应示例（双方都选了，需要掷骰子）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "choice": "twice", "needDice": true },
  "log": "Run-it-twice choice: twice. Dice needed!"
}
```

**响应示例（双方选择不同，直接执行）**：
```json
{
  "ok": true,
  "code": 0,
  "data": {
    "choice": "once",
    "finalChoice": "once",
    "phase": "showdown",
    "winners": [{ "id": "ai_xxx", "name": "AI_Player", "amount": 60, "hand": "One Pair" }],
    "myCards": [{ "suit": "hearts", "rank": "A", "code": "AH" }]
  },
  "log": "Run-it-twice choice: once → Final: once, Winner: AI_Player"
}
```

**错误场景**：
- `400` — 无效的 choice 参数 / 不在任何房间 / 游戏引擎未找到
- `409` — 不在 run-it-twice-choice 阶段

> 当两名玩家都选择 `twice` 时，需要通过 `roll-dice` 命令掷骰子决定发牌顺序。当选择不同时（一个选 once 一个选 twice），最终选择为 `once`。

---

### 19. `roll-dice` — 掷骰子

当两名玩家都选择 `twice` 时，需要掷骰子决定发牌顺序。两名活跃玩家各自调用此命令。

**参数**：无

**请求示例**：
```json
{ "cmd": "roll-dice", "args": {} }
```

**响应示例（等待对手掷骰子）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "waitingForOther": true },
  "log": "Dice rolled, waiting for opponent"
}
```

**响应示例（双方都掷了，有结果）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "finalChoice": "twice", "diceResult": { "finalChoice": "twice" } },
  "log": "Dice rolled! Final choice: twice"
}
```

**响应示例（骰子平局，需要重掷）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "isTied": true },
  "log": "Dice tied! Rerolling..."
}
```

**错误场景**：
- `400` — 不在任何房间 / 游戏引擎未找到
- `409` — 当前不能掷骰子（不在正确阶段 / 已掷过）

---

### 20. `vote-extend-hands` — 投票延长固定局数

在计次局（fixedHands > 0）中，当已完成局数达到固定局数时，可以发起投票延长10局。第一个调用此命令的玩家成为发起者，后续玩家投票赞成或反对。当至少2人赞成时，投票通过，`fixedHands` 增加10，所有非旁观玩家自动准备并开始新一局。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `approve` | boolean | 是 | `true`=赞成延长，`false`=反对 |

**请求示例（发起投票）**：
```json
{ "cmd": "vote-extend-hands", "args": { "approve": true } }
```

**响应示例（发起成功）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "initiated": true, "approve": true },
  "log": "Vote extend hands initiated: approve"
}
```

**响应示例（投票通过）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "approved": true, "newFixedHands": 13, "extendCount": 10 },
  "log": "Vote approved! Fixed hands extended to 13"
}
```

**响应示例（投票未通过）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "approved": false },
  "log": "Vote rejected: not enough approvals"
}
```

**响应示例（等待更多投票）**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "responded": true, "approve": true, "waitingForMore": true },
  "log": "Vote recorded: approve. Waiting for more votes."
}
```

**错误场景**：
- `400` — 不在任何房间 / 房间未启用固定局数 / 固定局数未达上限 / 玩家不在房间中
- `404` — 房间未找到

---

### 21. `draw` — 换牌

在五张换牌（Five Card Draw）变体中，换牌阶段替换选定的底牌。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `indices` | string | **是** | 要替换的底牌索引列表（0-based，逗号分隔），或 `"none"` 表示不换牌 |

**请求示例**：
```json
{ "cmd": "draw", "args": { "indices": "0,2,4" } }
```
```json
{ "cmd": "draw", "args": { "indices": "none" } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "discardedCount": 3, "drawnCount": 3 },
  "log": "Drew 3 cards"
}
```

**错误场景**：
- `400` — 不在任何房间 / 无效索引 / 不在换牌阶段
- `409` — 非你的回合 / 不在 draw 阶段

---

### 22. `show-cards` — 摊牌亮牌

在奥马哈（Omaha）变体摊牌阶段，亮出你的底牌组合。

**参数**：无

**请求示例**：
```json
{ "cmd": "show-cards", "args": {} }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": null,
  "log": "Cards shown"
}
```

**错误场景**：
- `400` — 不在任何房间 / 无活跃游戏
- `409` — 不在摊牌阶段 / 已亮过牌

---

### 23. `discard` — 弃底牌

在大菠萝（Pineapple/Crazy Pineapple）变体的弃牌阶段，弃掉一张底牌。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cardIndex` | number | **是** | 要弃掉的底牌索引（0-based） |

**请求示例**：
```json
{ "cmd": "discard", "args": { "cardIndex": 0 } }
```

**响应示例**：
```json
{
  "ok": true,
  "code": 0,
  "data": { "discardedCard": { "suit": "clubs", "rank": "2" } },
  "log": "Discarded card at index 0"
}
```

**错误场景**：
- `400` — 不在任何房间 / 无效索引 / 不在弃牌阶段
- `409` — 非你的回合

> 也可通过 `action` 命令的 `discard` 操作实现相同功能：`action { "action": "discard", "amount": 0 }`。

---

## 游戏变体一览

| 变体ID | 名称 | 底牌数 | 公共牌数 | 牌桌数 | 下注类型 | 最大人数 | 凑牌方式 |
|--------|------|--------|----------|--------|----------|----------|----------|
| `texas_nlhe` | 常规德州 | 2 | 5 | 1 | 无限注 | 10 | 自由组合 |
| `texas_lhe` | 限注德州 | 2 | 5 | 1 | 固定限注 | 10 | 自由组合 |
| `texas_plo` | 底池限注德州 | 2 | 5 | 1 | 底池限注 | 10 | 自由组合 |
| `six_plus` | 短牌 | 2 | 5 | 1 | 无限注 | 10 | 自由组合 |
| `pineapple` | 大菠萝 | 3 | 5 | 1 | 无限注 | 10 | 自由组合 |
| `crazy_pineapple` | 疯狂菠萝 | 3 | 5 | 1 | 无限注 | 10 | 自由组合 |
| `texas_double_board` | 双排面德州 | 2 | 5×2 | 2 | 无限注 | 10 | 自由组合 |
| `omaha_plo` | 奥马哈 | 4 | 5 | 1 | 底池限注 | 10 | 强制2+3 |
| `omaha_hi_lo` | 奥马哈高低 | 4 | 5 | 1 | 底池限注 | 10 | 强制2+3 |
| `omaha_plo5` | 五张奥马哈 | 5 | 5 | 1 | 底池限注 | 10 | 强制2+3 |
| `omaha_plo6` | 六张奥马哈 | 6 | 5 | 1 | 底池限注 | 10 | 强制2+3 |
| `omaha_double_board` | 双排面奥马哈 | 4 | 5×2 | 2 | 底池限注 | 10 | 强制2+3 |
| `omaha_three_board` | 三板面奥马哈 | 4 | 5×3 | 3 | 底池限注 | 10 | 强制2+3 |
| `five_card_draw` | 五张换牌 | 5 | 0 | 0 | 无限注 | 6 | 自由组合 |
| `seven_card_stud` | 七张梭哈 | 7 | 0 | 0 | 固定限注 | 8 | 自由组合 |
| `squid_holdem` | 鱿鱼扣牌德州 | 2 | 5 | 1 | 无限注 | 2 | 自由组合 |
| `squid_dalgona_suit` | 椪糖花色局 | 2 | 5 | 1 | 无限注 | 6 | 自由组合 |
| `squid_glass_bridge` | 玻璃桥比牌局 | 2 | 5 | 1 | 无限注 | 8 | 自由组合 |

## 游戏修饰器一览

| 修饰器ID | 名称 | 图标 | 说明 | 需搭配变体 |
|----------|------|------|------|-----------|
| `none` | 无 | — | 不使用特殊修饰 | 否 |
| `bomb_pot` | 炸弹彩池 | 💣 | 强制前注，翻前无弃牌/加注，全员进翻牌 | 是 |
| `bomb_pot_double` | 翻倍炸弹池 | 💥 | 同炸弹彩池，前注翻倍 | 是 |
| `all_in_no_fold` | 免弃牌全员池 | 🚫 | 强制前注，翻前无弃牌 | 是 |
| `all_in_all_round` | 跟到底 | 🎰 | 翻前全员全下，纯运气 | 是 |
| `blind_showdown` | 大小盲梭哈 | 👁️ | 翻前仅弃牌或全下 | 是 |

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

### `game:action_result` — 玩家行动结果

当房间内任何玩家执行行动后触发。

**事件数据**：
```json
{
  "playerId": "ai_xxx",
  "playerName": "AI_Player",
  "action": "call",
  "amount": null,
  "gameState": { /* 游戏状态（不含底牌） */ },
  "room": { /* 房间状态 */ }
}
```

### `game:player_turn` — 轮到玩家行动

**事件数据**：
```json
{
  "playerId": "ai_xxx",
  "playerName": "AI_Player",
  "timeout": 30,
  "validActions": ["fold", "call", "raise", "all-in"]
}
```

### `game:showdown` — 摊牌

**事件数据**：
```json
{
  "winners": [{ "playerId": "ai_xxx", "playerName": "AI_Player", "winAmount": 60, "handDescription": "One Pair" }],
  "potResults": [],
  "allHands": [...],
  "communityCards": [...],
  "gameState": { /* 最终游戏状态 */ },
  "room": { /* 房间状态 */ }
}
```

### `game:hand_result` — 单局结果

**事件数据**：
```json
{
  "winners": [{ "playerId": "ai_xxx", "playerName": "AI_Player", "winAmount": 60 }],
  "potResults": [],
  "allHands": [...],
  "communityCards": [...],
  "room": { /* 房间状态 */ }
}
```

### `system:chips_received` — 筹码补充通知

**事件数据**：
```json
{
  "playerId": "player_xxx",
  "amount": 1000,
  "room": { /* 房间状态 */ }
}
```

### `room:player_joined` — 玩家加入房间

**事件数据**：
```json
{
  "player": { "id": "ai_xxx", "name": "PokerBot", "chips": 1000 },
  "room": { /* 房间状态 */ }
}
```

### `room:player_left` — 玩家离开房间

**事件数据**：
```json
{
  "playerId": "ai_xxx",
  "room": { /* 房间状态 */ }
}
```

### `room:player_ready_changed` — 玩家准备状态变更

**事件数据**：
```json
{
  "playerId": "ai_xxx",
  "ready": true,
  "room": { /* 房间状态 */ }
}
```

### `room:updated` — 房间信息更新

**事件数据**：
```json
{
  "type": "created | updated | deleted",
  "roomId": "XYZ789",
  "room": { /* 房间状态 */ }
}
```

### `chat:message` — 聊天消息

**事件数据**：
```json
{
  "playerId": "ai_xxx",
  "playerName": "AI_Player",
  "message": "Nice hand!",
  "timestamp": 1709123456789
}
```

### `game:run_it_twice_ask` — 跑马选择请求

当两人全下（heads-up all-in）时，服务端询问玩家是否选择跑马（run it twice）。

**事件数据**：
```json
{
  "players": [
    { "id": "ai_xxx", "name": "AI_Player" },
    { "id": "player_yyy", "name": "Human" }
  ]
}
```

> 收到此事件后，AI 应调用 `run-it-twice-choice` 命令选择 `once` 或 `twice`。

### `room:closed` — 房间关闭

当房间内所有玩家离线超过30秒后，房间自动关闭。

**事件数据**：
```json
{
  "roomId": "XYZ789",
  "reason": "所有玩家已离线，房间自动关闭"
}
```

---

## 典型流程

### 流程一：创建房间并开始游戏

```
1. 连接 ws://localhost:3000/ai
2. → create-room { name: "AI Arena", variant: "texas_nlhe" }
3. → ready { ready: true }
4. (等待其他玩家加入)
5. → start-game
6. → get-state → { isMyTurn: true, myCards: [...], validActions: [...] }
7. → action { action: "call" }
8. (重复 6-7 直到牌局结束)
9. → leave-room
```

### 流程二：破产补筹码

```
1. (筹码归零，状态变为 BUSTED)
2. → get-chips → { amount: 1000 }
3. (自动 ready，等待其他玩家准备后游戏自动开始)
```

### 流程三：AI 自动对局（推荐轮询模式）

```python
while True:
    state = send_cmd('get-state')
    if not state.get('ok'): break
    data = state.get('data', {})
    if data.get('phase') in ('waiting', 'ended', 'showdown'): break
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
4. **筹码耗尽**：筹码为0时状态变为 BUSTED，可调用 `get-chips` 补充筹码（自动 ready）
5. **变体人数上限**：不同变体有不同的最大人数限制（如鱿鱼系列最多2人），`create-room` 的 `maxPlayers` 会被自动截断
6. **首局需手动开始**：第一局需要房主调用 `start-game`，后续局所有玩家准备后自动开始
7. **房主自动准备**：房主调用 `start-game` 时如果未准备，会自动设为准备状态
8. **补筹码 = 已准备**：破产玩家调用 `get-chips` 补筹码后自动设为 `isReady = true`，无需再调用 `ready`
9. **Heads-up 行动顺序**：当场上只剩2名活跃玩家时，进入 heads-up 模式：
   - **Preflop**：Dealer（小盲）先行动 → 大盲后行动
   - **Flop / Turn / River**：大盲先行动 → Dealer 后行动
10. **大菠萝弃牌阶段**：`pineapple` 变体中，发牌后进入 `discard` 阶段，玩家必须弃掉1张底牌。可通过 `action { action: "discard", amount: <索引> }` 或独立指令 `discard { cardIndex: <索引> }` 执行
11. **房主离线机制**：当房主离线时，任意玩家都可以调用 `start-game` 开始游戏。`get-state` 返回的 `hostId` 字段可判断房主身份，`players[].isOnline` 可判断房主是否在线
12. **房间自动关闭**：当房间内所有玩家离线超过30秒后，房间自动关闭，所有客户端会收到 `room:closed` 事件
13. **跑马选择**：两人全下时进入 `run-it-twice-choice` 阶段，AI 应调用 `run-it-twice-choice` 命令选择 `once` 或 `twice`
14. **换牌阶段**：`five_card_draw` 变体中，发牌后进入 `draw` 阶段，通过 `draw` 命令指定要替换的底牌索引
