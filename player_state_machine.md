# 玩家状态机设计文档

## 一、当前问题分析

### 1.1 现有状态定义

| 维度 | 枚举/字段 | 值域 |
|------|-----------|------|
| 房间状态 | `RoomStatus` | `WAITING` / `PLAYING` / `ENDED` |
| 玩家游戏状态 | `PlayerStatus` | `EMPTY` / `WAITING` / `PLAYING` / `FOLDED` / `ALL_IN` / `AWAY` |
| 游戏阶段 | `GamePhase` | `WAITING` / `PRE_FLOP` / `FLOP` / `TURN` / `RIVER` / `SHOWDOWN` / `ENDED` / ... |
| 玩家房间字段 | `RoomPlayer` | `isReady` / `isOnline` / `hasPlayedHand` / `chips` / `disconnectedAt` |

### 1.2 核心缺陷

| # | 缺陷 | 影响 |
|---|------|------|
| 1 | **无观战状态**：`RoomPlayer` 没有"观战"概念，游戏进行中加入的玩家被当作普通玩家，获得座位和筹码 | 观战者无法正确区分，离开逻辑混乱 |
| 2 | **`hasPlayedHand` 语义模糊**：仅表示"曾经拿过手牌"，无法区分"正在参与牌局"和"牌局间等待" | 离开房间投票条件判断不精确 |
| 3 | **`spectators` 数组未使用**：`Room` 类型定义了 `spectators: string[]` 但从未写入 | 观战者管理缺失 |
| 4 | **离开条件分散**：`leaveRoom`、`VOTE_LEAVE`、前端 `handleLeaveGame` 各自判断，逻辑不一致 | 边界场景（观战离开、筹码清空离开）处理不一致 |
| 5 | **断线玩家状态不清**：`isOnline=false` + `disconnectedAt` 仅标记断线，但30秒后是否踢出、是否阻止开始，逻辑分散 | 断线玩家可能阻止游戏开始 |

---

## 二、重新设计的状态机

### 2.1 房间状态（RoomStatus）

保持不变，但明确每个状态的含义：

```
WAITING ──→ PLAYING ──→ WAITING（牌局结束，循环）
  │                        │
  └──→ ENDED（房间解散）   └──→ ENDED（投票离开通过）
```

| 状态 | 含义 | 玩家可执行操作 |
|------|------|----------------|
| `WAITING` | 牌局间等待，无活跃牌局 | 准备、取消准备、开始游戏、离开房间、补充筹码 |
| `PLAYING` | 牌局进行中 | 扑克行动（弃牌/过牌/跟注/加注/全下）、观战者可离开 |
| `ENDED` | 房间已解散（过渡态） | 无（所有玩家被移出） |

### 2.2 玩家在房间中的角色（PlayerRoomRole）— **新增**

这是本次设计的核心新增概念，明确玩家在房间中的身份：

```
SPECTATOR ──→ SEATED ──→ ACTIVE ──→ BUSTED
                │                        │
                │←───────────────────────┘（补充筹码 / get-chips）
                │                        │
                │←── decline-rebuy ──────┘（拒绝补筹码，变为观战者）
```

| 角色 | 含义 | 进入条件 | 离开条件 |
|------|------|----------|----------|
| `SPECTATOR` | **观战者**：在牌局进行中加入，不占座位，不参与牌局 | 房间 `PLAYING` 时加入 | **随时可离开**，无需投票 |
| `SEATED` | **已入座**：占座位，有筹码，但未参与过任何牌局 | 房间 `WAITING` 时加入，或观战者在牌局结束后自动转为此状态 | **随时可离开**（`hasPlayedHand=false`），无需投票 |
| `ACTIVE` | **活跃玩家**：参与过至少一局牌局，当前有筹码 | 牌局中拿到手牌，且筹码 > 0 | 牌局进行中需**投票离开**；牌局间可直接离开 |
| `BUSTED` | **破产玩家**：筹码为0，曾经参与过牌局 | 牌局结算后筹码归零 | **随时可离开**，无需投票（已无利益牵涉）；可选择补筹码（→ACTIVE）或拒绝补筹码（→SPECTATOR） |

### 2.3 玩家完整状态矩阵

将 `PlayerRoomRole` × `RoomStatus` × `isOnline` 组合，得到完整的玩家状态矩阵：

#### 2.3.1 核心状态表

| # | PlayerRoomRole | RoomStatus | isOnline | 典型场景 | 可执行操作 |
|---|----------------|------------|----------|----------|------------|
| 1 | `SPECTATOR` | `PLAYING` | `true` | 游戏中观战 | **离开房间**、聊天 |
| 2 | `SPECTATOR` | `WAITING` | `true` | 牌局刚结束，观战者等待 | **离开房间**、准备、聊天 |
| 3 | `SEATED` | `WAITING` | `true` | 新加入玩家等待开始 | **离开房间**、准备/取消准备、聊天 |
| 4 | `SEATED` | `PLAYING` | `true` | *(不应出现)* 新玩家不应在PLAYING时被SEATED | — |
| 5 | `ACTIVE` | `WAITING` | `true` | 牌局间等待下一局 | **离开房间**、准备/取消准备、补充筹码、聊天 |
| 6 | `ACTIVE` | `PLAYING` | `true` | 正在参与牌局 | 扑克行动、聊天、**投票离开** |
| 7 | `ACTIVE` | `PLAYING` | `false` | 参与牌局但断线 | 自动弃牌/过牌（超时），重连恢复 |
| 8 | `BUSTED` | `WAITING` | `true` | 筹码清空，等待补充 | **离开房间**、补充筹码、拒绝补筹码（→SPECTATOR）、聊天 |
| 9 | `BUSTED` | `PLAYING` | `true` | *(不应出现)* 破产玩家不在牌局中 | — |
| 10 | `BUSTED` | `WAITING` | `false` | 破产且断线 | 30秒后可被跳过 |

#### 2.3.2 状态转换图

```
                          ┌─────────────────────────────────────────┐
                          │            房间 (WAITING)               │
                          │                                         │
    加入房间(WAITING)      │  SEATED ←── 自动转换 ─── SPECTATOR     │
  ─────────────────→      │    │                        │            │
                          │    │ 准备+开始游戏           │ 准备+开始   │
                          │    ↓                        ↓            │
                          │  ACTIVE ──── 游戏开始 ────→ ACTIVE      │
                          │    │                        │            │
                          │    │ 筹码归零               │ 牌局结束    │
                          │    ↓                        ↓            │
                          │  BUSTED ←── 自动转换 ─── BUSTED         │
                          │    │          ↘              │            │
                          │    │ 补充筹码   decline-rebuy │            │
                          │    ↓           ↘            ↓            │
                          │  ACTIVE      SPECTATOR   SPECTATOR      │
                          └─────────────────────────────────────────┘
                                      ↕ 牌局开始/结束
                          ┌─────────────────────────────────────────┐
                          │            牌局中 (PLAYING)              │
                          │                                         │
    加入房间(PLAYING)      │  SPECTATOR（观战，不参与）              │
  ─────────────────→      │                                         │
                          │  ACTIVE（参与牌局，有手牌）              │
                          │    │ 弃牌/全下被淘汰                      │
                          │    ↓                                     │
                          │  ACTIVE(FOLDED)（仍在牌局，但已弃牌）     │
                          │                                         │
                          │  ACTIVE(ALL_IN)（全下，等待摊牌）        │
                          └─────────────────────────────────────────┘
```

### 2.4 离开房间决策树

**核心原则**：只有对牌局结果有利益牵涉的玩家才需要投票离开。

```
玩家请求离开房间
    │
    ├─ PlayerRoomRole = SPECTATOR?
    │   └─ ✅ 直接离开（观战者无利益牵涉）
    │
    ├─ PlayerRoomRole = SEATED?
    │   └─ ✅ 直接离开（未参与过任何牌局）
    │
    ├─ PlayerRoomRole = BUSTED?
    │   └─ ✅ 直接离开（筹码为0，无利益牵涉）
    │
    └─ PlayerRoomRole = ACTIVE?
        │
        ├─ RoomStatus = WAITING?
        │   └─ ✅ 直接离开（牌局间，无进行中的利益）
        │
        └─ RoomStatus = PLAYING?
            │
            ├─ 不在当前手牌中（gameState.playerStatus 无此玩家）?
            │   └─ ✅ 直接离开（虽是ACTIVE但本局未参与）
            │
            └─ 在当前手牌中?
                │
                ├─ 已弃牌（playerStatus = FOLDED）?
                │   └─ ✅ 直接离开（已弃牌，无利益牵涉）
                │
                └─ 仍在牌局中（PLAYING / ALL_IN）?
                    └─ ❌ 需要投票离开（有利益牵涉）
```

### 2.5 加入房间决策树

```
玩家请求加入房间
    │
    ├─ 已在其他房间?
    │   └─ ❌ 拒绝："你已在其他房间中，请先离开当前房间"
    │
    ├─ 房间不存在?
    │   └─ ❌ 拒绝："房间不存在"
    │
    ├─ 房间已满（players.length >= maxPlayers）?
    │   └─ ❌ 拒绝："房间已满"
    │
    ├─ 密码错误?
    │   └─ ❌ 拒绝："房间密码错误"
    │
    ├─ 昵称重复?
    │   └─ ❌ 拒绝："该昵称已被使用"
    │
    └─ 通过验证
        │
        ├─ RoomStatus = WAITING?
        │   └─ ✅ 以 SEATED 身份加入（占座位，有筹码，可准备）
        │
        └─ RoomStatus = PLAYING?
            └─ ✅ 以 SPECTATOR 身份加入（不占座位，不参与牌局，可观战）
                └─ 牌局结束后自动转为 SEATED（占座位，可准备下一局）
```

### 2.6 开始游戏决策树

```
房主/自动触发开始游戏
    │
    ├─ RoomStatus = PLAYING?
    │   └─ ❌ 拒绝："游戏正在进行中"
    │
    ├─ 准备且有筹码的玩家 < minPlayers?
    │   └─ ❌ 拒绝："至少需要N名玩家准备"
    │
    └─ 通过验证
        │
        ├─ 筛选参与玩家：
        │   - isReady = true
        │   - chips > 0
        │   - isOnline = true，或断线未超30秒
        │   - PlayerRoomRole ≠ SPECTATOR（观战者不参与）
        │
        └─ ✅ 开始牌局
            - 参与玩家：PlayerRoomRole → ACTIVE，hasPlayedHand = true
            - 观战者：保持 SPECTATOR，不参与
```

---

## 三、观战者（SPECTATOR）详细设计

### 3.1 观战者特征

| 属性 | 值 | 说明 |
|------|-----|------|
| `playerRoomRole` | `SPECTATOR` | 身份标识 |
| `seatIndex` | `-1` | 不占座位 |
| `chips` | `0` | 无筹码（不参与下注） |
| `isReady` | `false` | 无需准备 |
| `hasPlayedHand` | `false` | 未拿过手牌 |
| `playerStatus` | 不存在于 `gameState.playerStatus` | 不在游戏引擎中 |

### 3.2 观战者可见信息

- ✅ 公共牌（communityCards）
- ✅ 底池金额（pot）
- ✅ 玩家列表及筹码
- ✅ 玩家行动（fold/call/raise等）
- ✅ 摊牌结果（showdown）
- ❌ 其他玩家的底牌（playerCards）
- ❌ 牌堆（deck）

### 3.3 观战者 → 已入座（SEATED）转换

**触发时机**：牌局结束（showdown），`room.status` 变为 `WAITING`

**转换动作**：
1. 分配座位：找到最小空 seatIndex
2. 赋予筹码：`chips = room.config.buyInMin`
3. 更新角色：`playerRoomRole = SEATED`
4. 广播：通知房间内玩家有新玩家入座

---

## 四、断线玩家处理

### 4.1 断线状态

| 场景 | 处理 |
|------|------|
| `WAITING` 期间断线 | 标记 `isOnline=false`，30秒后跳过该玩家（不阻止开始） |
| `PLAYING` 期间断线 | 标记 `isOnline=false`，超时自动弃牌/过牌 |
| 断线后重连 | `isOnline=true`，恢复到断线前状态 |

### 4.2 断线踢出规则

```
玩家断线（isOnline = false, disconnectedAt = now）
    │
    ├─ 30秒内重连?
    │   └─ 恢复在线状态
    │
    └─ 30秒未重连
        │
        ├─ PlayerRoomRole = SPECTATOR?
        │   └─ 自动移出房间（清理 playerRooms 映射）
        │
        ├─ PlayerRoomRole = SEATED?
        │   └─ 自动移出房间
        │
        ├─ PlayerRoomRole = BUSTED?
        │   └─ 自动移出房间
        │
        └─ PlayerRoomRole = ACTIVE?
            │
            ├─ RoomStatus = WAITING?
            │   └─ 自动移出房间（不阻止其他玩家继续）
            │
            └─ RoomStatus = PLAYING?
                └─ 保留在房间中（等待牌局结束后移出）
                    └─ 牌局结束时：如果仍不在线，自动移出
```

---

## 五、实现方案

### 5.1 新增 `PlayerRoomRole` 枚举

**文件**：`server/src/types/room.ts`

```typescript
export enum PlayerRoomRole {
  SPECTATOR = 'spectator',   // 观战者
  SEATED = 'seated',         // 已入座（未参与过牌局）
  ACTIVE = 'active',         // 活跃玩家（参与过牌局，有筹码）
  BUSTED = 'busted',         // 破产玩家（参与过牌局，筹码为0）
}
```

### 5.2 `RoomPlayer` 新增字段

```typescript
export interface RoomPlayer {
  // ... 现有字段 ...
  playerRoomRole: PlayerRoomRole;  // 新增：玩家在房间中的角色
}
```

### 5.3 关键逻辑修改点

| 文件 | 修改点 |
|------|--------|
| `RoomManager.joinRoom()` | `PLAYING` 时以 `SPECTATOR` 身份加入，`WAITING` 时以 `SEATED` 身份加入 |
| `RoomManager.leaveRoom()` | 按"离开决策树"判断：SPECTATOR/SEATED/BUSTED 直接离开，ACTIVE+PLAYING 需投票 |
| `RoomManager.setPlayerReady()` | SPECTATOR 和 BUSTED 不能准备（BUSTED 需先补筹码或选择不补） |
| `tryStartGame()` | SPECTATOR 不参与牌局；筛选 `playerRoomRole !== SPECTATOR` 的玩家 |
| `gameHandler.showdown()` | 牌局结束后：SPECTATOR → SEATED（分配座位筹码）；筹码归零的 ACTIVE → BUSTED |
| `roomHandler.DECLINE_REBUY` | BUSTED 玩家选择不补筹码：BUSTED → SPECTATOR（释放座位，筹码归零）；检测是否只剩一名非SPECTATOR玩家，触发 GAME_OVER |
| `roomHandler.VOTE_LEAVE` | 简化：`playerRoomRole !== ACTIVE` 或不在手牌中时直接离开 |
| 前端 `RoomPage` / `GamePage` | 根据 `playerRoomRole` 显示"离开"或"投票离开"按钮 |

### 5.4 向后兼容

- `hasPlayedHand` 保留但语义变为：`playerRoomRole === ACTIVE || playerRoomRole === BUSTED`
- `spectators` 数组废弃，改用 `playerRoomRole === SPECTATOR` 筛选
- 前端 `RoomPlayer` 类型新增 `playerRoomRole` 字段

---

## 六、场景验证

### 场景1：观战进入 → 返回大厅 → 加入其他房间

```
1. 房间A PLAYING，玩家点击"观战"
2. joinRoom → playerRoomRole = SPECTATOR, seatIndex = -1
3. 玩家点击"返回大厅"
4. leaveRoom → SPECTATOR → ✅ 直接离开
5. playerRooms 映射清除
6. 玩家加入房间B → ✅ 成功
```

### 场景2：正常游戏 → 牌局中 → 投票离开

```
1. 房间 WAITING，玩家加入 → playerRoomRole = SEATED
2. 准备 → 开始游戏 → playerRoomRole = ACTIVE
3. 牌局中，玩家点击"离开"
4. leaveRoom → ACTIVE + PLAYING + 在手牌中 → ❌ 需投票
5. 发起投票 → 其他玩家同意 → 房间解散
```

### 场景3：正常游戏 → 牌局中弃牌后 → 直接离开

```
1. 玩家 ACTIVE + PLAYING
2. 玩家弃牌 → playerStatus = FOLDED
3. 玩家点击"离开"
4. leaveRoom → ACTIVE + PLAYING + FOLDED → ✅ 直接离开（已弃牌，无利益）
```

### 场景4：筹码清空 → 离开

```
1. 玩家 ACTIVE，牌局结算后筹码归零 → playerRoomRole = BUSTED
2. 玩家点击"离开"
3. leaveRoom → BUSTED → ✅ 直接离开（无利益牵涉）
```

### 场景5：筹码清空 → 补充筹码 → 继续游戏

```
1. 玩家 BUSTED
2. 玩家点击"补充筹码" → chips = buyInMin → playerRoomRole = ACTIVE
3. 玩家准备 → 下一局开始时参与
```

### 场景5b：筹码清空 → 拒绝补筹码 → 观战 → 后续补筹码

```
1. 玩家 BUSTED
2. 玩家选择"不补（观战）" → playerRoomRole = SPECTATOR, seatIndex = -1, chips = 0
3. 后续牌局中玩家以观战者身份观看
4. 玩家选择"补筹码" → chips = buyInMin, seatIndex = 分配, playerRoomRole = ACTIVE
5. 玩家准备 → 下一局开始时参与
```

### 场景5c：所有玩家破产 → 只剩一人 → 游戏结束

```
1. 三人游戏中，玩家A和B筹码归零 → playerRoomRole = BUSTED
2. 玩家A选择"不补" → playerRoomRole = SPECTATOR
3. 玩家B选择"不补" → playerRoomRole = SPECTATOR
4. 场上只剩玩家C一名非SPECTATOR玩家 → 服务端发送 GAME_OVER 事件
5. 所有玩家看到游戏结束界面，显示玩家C获得最终胜利
```

### 场景6：观战 → 牌局结束 → 自动入座 → 准备 → 参与下一局

```
1. 房间 PLAYING，玩家以 SPECTATOR 加入
2. 牌局结束 → room.status = WAITING
3. SPECTATOR → SEATED（分配座位、筹码）
4. 玩家准备 → isReady = true
5. 下一局开始 → SEATED → ACTIVE（拿到手牌）
```

### 场景7：观战 → 牌局结束前离开

```
1. 房间 PLAYING，玩家以 SPECTATOR 加入
2. 玩家点击"离开"
3. leaveRoom → SPECTATOR → ✅ 直接离开
4. playerRooms 映射清除
```

### 场景8：断线30秒 → 自动踢出

```
1. 玩家 SEATED + WAITING，断线
2. 30秒后未重连 → 自动移出房间
3. 其他玩家不受影响
```

### 场景9：牌局中断线 → 超时弃牌 → 牌局结束 → 踢出

```
1. 玩家 ACTIVE + PLAYING，断线
2. 超时自动弃牌
3. 牌局结束 → room.status = WAITING
4. 玩家仍不在线 → 自动移出房间
```

### 场景10：首局房主未准备直接开始

```
1. 房主 SEATED，点击"开始游戏"
2. 自动设 isReady = true
3. 开始游戏 → 房主 SEATED → ACTIVE
```
