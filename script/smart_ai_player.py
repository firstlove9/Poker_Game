"""
LLM-Powered Single AI Poker Player
=====================================
A single AI player that joins existing rooms and plays like a real human.
Features:
  - Deep game analysis with hand strength estimation
  - Natural chat responses (replies to other players, table talk)
  - Bluffing & trapping based on personality
  - Table position awareness
  - Opponent modeling (tracks aggression/fold rates)
  - Emotional reactions to big wins/losses

Usage:
  pip install python-socketio[client] openai
  set LLM_API_KEY=your-api-key
  set LLM_BASE_URL=https://api.openai.com/v1
  set LLM_MODEL=gpt-4o-mini
  python script/smart_ai_player.py [--room ROOM_ID] [--name NAME] [--personality PERSONALITY]
"""

import sys
import io
import os

if sys.platform == 'win32':
    import ctypes
    kernel32 = ctypes.windll.kernel32
    kernel32.SetConsoleOutputCP(65001)
    kernel32.SetConsoleCP(65001)
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
else:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import threading
import random
import argparse
from openai import OpenAI

SERVER_URL = "https://dp.geeknest.cc:5432"
AI_NAMESPACE = "/ai"

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CONFIG_FILE = os.path.join(_PROJECT_ROOT, "llm_config.json")

def _load_llm_config():
    if os.path.exists(_CONFIG_FILE):
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            print(f"  [CONFIG] 从 {os.path.basename(_CONFIG_FILE)} 加载配置", flush=True)
            return cfg
    alt = os.path.join(os.path.dirname(os.path.abspath(__file__)), "llm_config.json")
    if os.path.exists(alt):
        with open(alt, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            print(f"  [CONFIG] 从 script/llm_config.json 加载配置", flush=True)
            return cfg
    print(f"  [CONFIG] 未找到 llm_config.json，使用环境变量或默认值", flush=True)
    return {}

_llm_cfg = _load_llm_config()

LLM_API_KEY = os.environ.get("LLM_API_KEY", "") or _llm_cfg.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "") or _llm_cfg.get("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "") or _llm_cfg.get("LLM_MODEL", "gpt-4o-mini")

if LLM_BASE_URL.endswith("/chat/completions"):
    LLM_BASE_URL = LLM_BASE_URL[:-len("/chat/completions")]
elif LLM_BASE_URL.endswith("/v1/chat/completions"):
    LLM_BASE_URL = LLM_BASE_URL[:-len("/chat/completions")]

PERSONALITIES = {
    "shark": {
        "name": "Shark",
        "desc": "职业鲨鱼玩家，冷酷无情，精准计算每一手牌的EV。话少但每句都带刺。偶尔嘲讽对手的失误。用中文聊天。",
        "style": "TAG，极其精准的价值下注，偶尔设陷阱慢打",
    },
    "gambler": {
        "name": "Lucky",
        "desc": "热情奔放的赌神，相信运气和直觉。赢了哈哈大笑，输了也笑着再来。喜欢和桌上的人聊天打趣。用中文聊天。",
        "style": "LAG，喜欢用直觉和气场压制对手",
    },
    "fox": {
        "name": "Fox",
        "desc": "狡猾的狐狸，善于读人心理。经常虚张声势但又不全是在bluff。说话模棱两可让人猜不透。用中文聊天。",
        "style": "混合型，根据对手调整策略，bluff频率高但随机",
    },
    "prof": {
        "name": "Prof",
        "desc": "大学数学教授转行打扑克，凡事讲概率和博弈论。说话喜欢引用数据和理论。用中文聊天。",
        "style": "紧凶型，基于数学期望做决策，绝不情绪化",
    },
    "rookie": {
        "name": "Rookie",
        "desc": "刚学会扑克的新手，偶尔有天才操作但经常犯错。说话天真直接，不懂就问。用中文聊天。",
        "style": "松被动型，经常跟注但不常加注，容易被打",
    },
}

SUIT_SYMBOLS = {"hearts": "♥", "diamonds": "♦", "clubs": "♣", "spades": "♠"}
RANK_ORDER = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}


class LLMClient:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance.client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)
                cls._instance.conversation_history = []
        return cls._instance

    def chat(self, messages, temperature=0.7, max_tokens=300):
        try:
            response = self.client.chat.completions.create(
                model=LLM_MODEL, messages=messages,
                temperature=temperature, max_tokens=max_tokens,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"  [LLM ERROR] {e}", flush=True)
            return None


def card_str(card):
    if not card:
        return "??"
    suit = SUIT_SYMBOLS.get(card.get("suit", ""), "?")
    rank = card.get("rank", "?")
    return f"{rank}{suit}"


def hand_strength_hint(cards):
    if not cards or len(cards) < 2:
        return "unknown"
    ranks = [RANK_ORDER.get(c.get("rank", ""), 0) for c in cards]
    suits = [c.get("suit", "") for c in cards]
    high = max(ranks) if ranks else 0
    paired = len(set(ranks)) < len(ranks)
    suited = len(set(suits)) == 1 and len(suits) >= 2

    if high >= 13 and paired:
        return "monster"
    if high >= 12 and paired:
        return "very_strong"
    if high >= 14 and suited:
        return "strong"
    if high >= 12:
        return "good"
    if paired:
        return "medium"
    if suited and high >= 10:
        return "playable"
    if high >= 10:
        return "marginal"
    return "weak"


class OpponentTracker:
    def __init__(self):
        self.players = {}

    def update(self, player_name, action, phase=""):
        if player_name not in self.players:
            self.players[player_name] = {"vpip": 0, "pfr": 0, "fold": 0, "raise": 0, "total": 0, "hands": 0}
        p = self.players[player_name]
        p["total"] += 1
        if action in ("call", "raise", "all-in"):
            p["vpip"] += 1
        if action == "raise":
            p["raise"] += 1
            if phase == "pre-flop":
                p["pfr"] += 1
        if action == "fold":
            p["fold"] += 1

    def new_hand(self):
        for p in self.players.values():
            p["hands"] = p.get("hands", 0) + 1

    def get_profile(self, name):
        p = self.players.get(name, {})
        total = p.get("total", 0)
        if total == 0:
            return "未知"
        vpip_pct = p.get("vpip", 0) / total * 100
        fold_pct = p.get("fold", 0) / total * 100
        raise_pct = p.get("raise", 0) / total * 100
        if vpip_pct > 60:
            style = "松凶(鱼)"
        elif vpip_pct > 40:
            style = "松凶"
        elif vpip_pct > 25:
            style = "紧凶"
        else:
            style = "岩石"
        return f"{style}(入池{vpip_pct:.0f}%/弃牌{fold_pct:.0f}%/加注{raise_pct:.0f}%)"

    def get_summary(self):
        lines = []
        for name, p in self.players.items():
            total = p.get("total", 0)
            if total >= 3:
                lines.append(f"  - {name}: {self.get_profile(name)}")
        return "\n".join(lines) if lines else "  暂无足够数据"


AI_NAME_PREFIXES = ["AI", "Bot", "Bot"]
AI_NAME_ADJS = ["暗影", "疾风", "烈焰", "寒冰", "雷霆", "星辰", "幻影", "铁壁", "灵狐", "苍龙",
                "赤兔", "青龙", "白虎", "朱雀", "玄武", "麒麟", "凤凰", "鲲鹏", "独角兽", "猎鹰"]

_STATE_FILE = os.path.join(_PROJECT_ROOT, ".ai_player_state.json")

def _load_state():
    if os.path.exists(_STATE_FILE):
        try:
            with open(_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}

def _save_state(state):
    try:
        with open(_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  [WARN] 保存状态失败: {e}", flush=True)

def generate_ai_name():
    prefix = random.choice(AI_NAME_PREFIXES)
    adj = random.choice(AI_NAME_ADJS)
    num = random.randint(1, 999)
    return f"{prefix}_{adj}{num}"


class SmartAIPlayer:
    def __init__(self, personality_key=None, custom_name=None):
        saved_state = _load_state()
        if personality_key is None:
            personality_key = saved_state.get("personality") or random.choice(list(PERSONALITIES.keys()))
        p = PERSONALITIES.get(personality_key, PERSONALITIES["shark"])
        self.personality_key = personality_key
        if custom_name:
            self.name = custom_name
        elif saved_state.get("name"):
            self.name = saved_state["name"]
        else:
            self.name = generate_ai_name()
        self._saved_room_id = saved_state.get("roomId")
        self._is_host = saved_state.get("isHost", False)
        self.personality = p["desc"]
        self.style = p["style"]
        self.sio = socketio.Client()
        self.player_id = None
        self.room_id = None
        self.chips = 0
        self.hand_number = 0
        self.wins = 0
        self.losses = 0

        self.game_log = []
        self.current_hand_log = []
        self.chat_history = []
        self.pending_chats = []
        self.opponents = OpponentTracker()
        self.llm = LLMClient()

        self._last_action_time = 0
        self._last_chat_time = 0
        self._consecutive_folds = 0
        self._big_win_last_hand = False
        self._big_loss_last_hand = False
        self._running = True
        self._first_player_joined_at = None

        self._register_events()

    def _register_events(self):
        @self.sio.on("ai:connected", namespace=AI_NAMESPACE)
        def on_connected(data):
            self.player_id = data.get("data", {}).get("playerId")
            self.log(f"已连接, ID: {self.player_id}")

        @self.sio.on("game:action_result", namespace=AI_NAMESPACE)
        def on_action(data):
            p_name = data.get("playerName", "")
            action = data.get("action", "")
            amount = data.get("amount")
            phase = data.get("gameState", {}).get("phase", "")
            amt_str = f" {amount}" if amount else ""
            if p_name != self.name:
                self.current_hand_log.append(f"{p_name} {action}{amt_str}")
                self.opponents.update(p_name, action, phase)

        @self.sio.on("game:deal_cards", namespace=AI_NAMESPACE)
        def on_deal(data):
            cards = data.get("cards", [])
            if cards:
                cards_display = " ".join(card_str(c) for c in cards)
                self.log(f"收到手牌: {cards_display}")
                self.current_hand_log = [f"我拿到: {cards_display}"]

        @self.sio.on("game:hand_result", namespace=AI_NAMESPACE)
        def on_hand_result(data):
            winners = data.get("winners", [])
            i_won = any(w.get("playerName") == self.name for w in winners)
            if i_won:
                win_amt = sum(w.get("winAmount", 0) for w in winners if w.get("playerName") == self.name)
                self.wins += 1
                self.log(f"🎉 我赢了! +${win_amt}")
                self._big_win_last_hand = win_amt > 200
                self._big_loss_last_hand = False
            else:
                self.losses += 1
                self._big_loss_last_hand = self.chips < 100
                self._big_win_last_hand = False

            for w in winners:
                self.current_hand_log.append(f"WIN {w.get('playerName', '?')} +{w.get('winAmount', 0)}")
            self.game_log.extend(self.current_hand_log[-20:])
            self.current_hand_log = []
            self.hand_number += 1
            self.opponents.new_hand()

            if i_won and self._big_win_last_hand and random.random() < 0.7:
                threading.Thread(target=self._react_big_win, daemon=True).start()
            elif self._big_loss_last_hand and random.random() < 0.5:
                threading.Thread(target=self._react_bad_beat, daemon=True).start()

            # 输了就切换风格，赢了保持
            if not i_won:
                self._switch_personality()

            # 重置倒计时，等下一手牌开始时重新计算
            self._first_player_joined_at = None

        @self.sio.on("game:game_over", namespace=AI_NAMESPACE)
        def on_game_over(data):
            winner = data.get("winner", {})
            self.log(f"游戏结束! 赢家: {winner.get('name', 'None')}")
            self._running = False

        @self.sio.on("chat:message", namespace=AI_NAMESPACE)
        def on_chat(data):
            sender = data.get("playerName", "")
            msg = data.get("message", "")
            if sender != self.name:
                self.chat_history.append(f"{sender}: {msg}")
                self.pending_chats.append({"sender": sender, "message": msg, "time": time.time()})
                self.log(f"[聊天] {sender}: {msg}")

        @self.sio.on("room:player_joined", namespace=AI_NAMESPACE)
        def on_player_joined(data):
            player = data.get("player", {})
            if player.get("name") != self.name:
                self.log(f"👤 {player.get('name', '?')} 加入了房间")
                if self._first_player_joined_at is None:
                    self._first_player_joined_at = time.time()
                    if self._is_host:
                        self.log("⏳ 30秒后自动开始游戏...")

        @self.sio.on("room:player_left", namespace=AI_NAMESPACE)
        def on_player_left(data):
            self.log(f"👤 玩家离开了房间")

        @self.sio.on("room:player_ready_changed", namespace=AI_NAMESPACE)
        def on_ready(data):
            pass

        @self.sio.on("game:run_it_twice_ask", namespace=AI_NAMESPACE)
        def on_rit_ask(data):
            self.log("跑马选择 -> 自动选 once")
            time.sleep(0.5)
            self.send_cmd("run-it-twice-choice", {"choice": "once"})

    def log(self, msg):
        ts = time.strftime("%H:%M:%S")
        print(f"  [{ts}][{self.name}] {msg}", flush=True)

    def connect(self):
        try:
            self.sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=10)
            time.sleep(0.3)
            return True
        except Exception as e:
            self.log(f"连接失败: {e}")
            return False

    def send_cmd(self, cmd, args=None, timeout=10):
        req_id = f"{int(time.time()*1000)}"
        payload = {"cmd": cmd, "args": args or {}, "reqId": req_id}
        result = {"response": None}

        def on_response(data):
            result["response"] = data

        try:
            self.sio.emit("ai:cmd", payload, namespace=AI_NAMESPACE, callback=on_response)
            deadline = time.time() + timeout
            while result["response"] is None and time.time() < deadline:
                self.sio.sleep(0.05)
            return result["response"]
        except Exception as e:
            self.log(f"命令错误: {e}")
            return None

    def create_room(self, variant="texas_nlhe", max_players=6, small_blind=10, big_blind=20, fixed_hands=0):
        args = {
            "name": f"AI-{self.name}",
            "variant": variant,
            "maxPlayers": max_players,
            "smallBlind": small_blind,
            "bigBlind": big_blind,
            "playerName": self.name,
        }
        if fixed_hands > 0:
            args["fixedHands"] = fixed_hands
        resp = self.send_cmd("create-room", args)
        if resp and resp.get("ok"):
            self.room_id = resp.get("data", {}).get("roomId")
            self._is_host = True
            self.log(f"创建房间: {self.room_id}")
        return resp

    def join_room(self, room_id):
        resp = self.send_cmd("join-room", {"roomId": room_id, "name": self.name})
        if resp and resp.get("ok"):
            self.room_id = room_id
            self.log(f"加入房间: {room_id}")
            players = resp.get("data", {}).get("players", [])
            for p in players:
                if p.get("name") != self.name:
                    self.log(f"  已在房间: {p.get('name', '?')} (${p.get('chips', 0)})")
        return resp

    def ready(self):
        return self.send_cmd("ready", {"ready": True})

    def start_game(self):
        return self.send_cmd("start-game")

    def get_state(self):
        resp = self.send_cmd("get-state")
        if resp and resp.get("ok"):
            return resp.get("data", {})
        return None

    def get_actions(self):
        resp = self.send_cmd("get-actions")
        if resp and resp.get("ok"):
            return resp.get("data", {})
        return None

    def send_chat(self, message):
        if not message or len(message.strip()) == 0:
            return
        message = message.strip()[:80]
        self._last_chat_time = time.time()
        resp = self.send_cmd("chat", {"message": message})
        if resp and resp.get("ok"):
            self.log(f"💬 说: {message}")
            self.chat_history.append(f"{self.name}: {message}")

    def _build_position_info(self, state_data):
        role = ""
        for p in state_data.get("players", []):
            if p.get("name") == self.name:
                role = p.get("role", "")
                break
        position_map = {"dealer": "庄位(D)-后位, 优势", "small-blind": "小盲(SB)-最差位置",
                        "big-blind": "大盲(BB)-差位置", "utg": "枪口位(UTG)-最差前位"}
        return position_map.get(role, f"位置:{role}")

    def _build_game_context(self, state_data):
        ctx = f"# 你是 {self.name}\n{self.personality}\n打法: {self.style}\n\n"

        phase = state_data.get("phase", "?")
        pot = state_data.get("pot", 0)
        current_bet = state_data.get("currentBet", 0)
        ctx += f"# 牌局状态\n"
        ctx += f"- 阶段: {phase}\n"
        ctx += f"- 底池: ${pot}\n"
        ctx += f"- 当前最高下注: ${current_bet}\n"
        ctx += f"- 你的位置: {self._build_position_info(state_data)}\n\n"

        my_cards = state_data.get("myCards", [])
        if my_cards:
            cards_display = " ".join(card_str(c) for c in my_cards)
            strength = hand_strength_hint(my_cards)
            ctx += f"# 你的手牌\n{cards_display}\n手牌强度估计: {strength}\n\n"

        community = state_data.get("communityCards", [])
        if community:
            ctx += f"# 公共牌\n{' '.join(card_str(c) for c in community)}\n\n"

        board_cards = state_data.get("boardCards", [])
        if board_cards:
            for i, board in enumerate(board_cards):
                ctx += f"# 板面 {i+1}\n{' '.join(card_str(c) for c in board)}\n"
            ctx += "\n"

        target_suit = state_data.get("targetSuit")
        if target_suit:
            suit_sym = SUIT_SYMBOLS.get(target_suit, target_suit)
            ctx += f"# 目标花色: {suit_sym}{target_suit}\n\n"

        ctx += "# 玩家列表\n"
        active_count = 0
        for p in state_data.get("players", []):
            status = p.get("status", "?")
            chips = p.get("chips", 0)
            round_bet = p.get("roundBet", 0)
            role_str = p.get("role", "")
            online = p.get("isOnline", True)
            me_marker = " ←你" if p.get("name") == self.name else ""
            offline_mark = " [断线]" if not online else ""
            role_display = f"[{role_str}]" if role_str else ""
            opponent_profile = ""
            if p.get("name") != self.name:
                opponent_profile = f" {self.opponents.get_profile(p.get('name', ''))}"
            ctx += f"- {p.get('name', '?')}{role_display}: ${chips}, 下注${round_bet}, {status}{offline_mark}{me_marker}{opponent_profile}\n"
            if status not in ("folded", "spectator"):
                active_count += 1

        ctx += f"\n活跃玩家数: {active_count}\n"

        if self.current_hand_log:
            recent = self.current_hand_log[-10:]
            ctx += f"\n# 本手牌操作记录\n" + "\n".join(f"- {l}" for l in recent) + "\n"

        opponent_summary = self.opponents.get_summary()
        if opponent_summary != "  暂无足够数据":
            ctx += f"\n# 对手分析\n{opponent_summary}\n"

        if self._consecutive_folds >= 3:
            ctx += f"\n⚠ 你已经连续{self._consecutive_folds}手弃牌了，可能需要适当放宽入池范围。\n"

        return ctx

    def _llm_decide_action(self, state_data):
        ctx = self._build_game_context(state_data)
        valid_actions = state_data.get("validActions", [])
        phase = state_data.get("phase", "")

        if phase == "discard" and "discard" in valid_actions:
            my_cards = state_data.get("myCards", [])
            cards_display = ", ".join(f"{i}:{card_str(c)}" for i, c in enumerate(my_cards))
            prompt = f"""{ctx}
你有{len(my_cards)}张牌: {cards_display}
你需要选择丢弃哪些牌（可以丢弃0-5张）。

分析每张牌的价值和与其它牌的配合度，决定保留哪些牌。

回复JSON:
{{"thinking": "你的思考过程", "discard_indices": [0, 2]}}
discard_indices是要丢弃的牌的索引列表（从0开始）。空列表表示不换牌。只回复JSON。"""
            resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=200)
            if resp_text:
                try:
                    cleaned = resp_text.replace("```json", "").replace("```", "").strip()
                    if not cleaned.endswith("}"):
                        last_brace = cleaned.rfind("}")
                        if last_brace > 0:
                            cleaned = cleaned[:last_brace+1]
                        else:
                            cleaned += "}"
                    data = json.loads(cleaned)
                    thinking = data.get("thinking", "")
                    indices = data.get("discard_indices", [])
                    if isinstance(indices, list):
                        indices = [int(i) for i in indices if 0 <= int(i) < len(my_cards)]
                    else:
                        indices = []
                    self.log(f"💭 {thinking[:60]} -> 丢弃 {[card_str(my_cards[i]) for i in indices if i < len(my_cards)]}")
                    return "discard", indices
                except:
                    pass
            return "discard", [0]

        if phase == "draw":
            my_cards = state_data.get("myCards", [])
            if my_cards:
                cards_display = ", ".join(f"{i}:{card_str(c)}" for i, c in enumerate(my_cards))
                prompt = f"""{ctx}
换牌阶段。你的手牌: {cards_display}
选择要换掉的牌（0-5张）。保留好牌，换掉差牌。

回复JSON: {{"thinking": "思考", "discard_indices": [1, 3]}}"""
                resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=100)
                if resp_text:
                    try:
                        cleaned = resp_text.replace("```json", "").replace("```", "").strip()
                        data = json.loads(cleaned)
                        indices = data.get("discard_indices", [])
                        if isinstance(indices, list):
                            indices = [int(i) for i in indices if 0 <= int(i) < len(my_cards)]
                        else:
                            indices = []
                        self.log(f"💭 换牌: 丢弃{len(indices)}张")
                        return "draw", indices
                    except:
                        pass
            return "draw", [0]

        actions_str = ", ".join(valid_actions)
        actions_data = self.get_actions()
        to_call = 0
        my_chips = self.chips
        min_raise = 0
        if actions_data:
            to_call = actions_data.get("toCall", 0)
            my_chips = actions_data.get("myChips", self.chips)
            min_raise = actions_data.get("minRaise", 0)

        pot = state_data.get("pot", 0)
        pot_odds = f"{to_call / (pot + to_call) * 100:.1f}%" if (pot + to_call) > 0 else "N/A"

        prompt = f"""{ctx}
# 你的回合
可用操作: [{actions_str}]
跟注需要: ${to_call} | 你的筹码: ${my_chips} | 最小加注: ${min_raise}
底池赔率: {pot_odds} (跟注金额 / 跟注后底池)

请综合分析：
1. 手牌强度和位置优势
2. 底池赔率是否划算
3. 对手可能的牌力范围
4. 是否有bluff的价值
5. 你的形象管理（如果一直很紧，可以偶尔bluff）

重要策略原则：
- 不要轻易弃牌！尤其在底池赔率有利时（<30%），跟注往往比弃牌好
- 如果可以check（过牌），绝不弃牌
- 连续弃牌会让对手看穿你的策略，适当跟注保持不可预测性
- 只在手牌极差且赔率极差时才弃牌

回复JSON:
{{"thinking": "详细分析过程（手牌评估、赔率计算、对手读牌、策略选择）", "action": "操作名", "amount": 加注金额(仅raise需要), "chat": "可选：说一句话（20字以内，可为空）"}}

操作: check过牌, call跟注, raise加注(需amount), fold弃牌(仅手牌极差时), all-in全下
只回复JSON。"""

        resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=400)
        if not resp_text:
            return ("check" if "check" in valid_actions else "fold"), None

        try:
            cleaned = resp_text.replace("```json", "").replace("```", "").strip()
            # 尝试修复被截断的JSON
            if not cleaned.endswith("}"):
                # 找到最后一个完整的key-value，补全
                last_brace = cleaned.rfind("}")
                if last_brace > 0:
                    cleaned = cleaned[:last_brace+1]
                else:
                    # 尝试补全
                    open_braces = cleaned.count("{") - cleaned.count("}")
                    cleaned += "}" * max(open_braces, 1)
            data = json.loads(cleaned)
            thinking = data.get("thinking", "")
            action = data.get("action", "fold")
            amount = data.get("amount")
            chat_msg = data.get("chat", "")

            self.log(f"💭 {thinking[:100]}...")
            self.log(f"🎯 决定: {action}" + (f" ${amount}" if amount else ""))

            if chat_msg and time.time() - self._last_chat_time > 8:
                threading.Thread(target=lambda: (time.sleep(1.5), self.send_chat(chat_msg)), daemon=True).start()

            if action not in valid_actions:
                self.log(f"  ⚠ [{action}] 不可用，降级处理")
                fallback_order = ["check", "call", "fold"]
                for fb in fallback_order:
                    if fb in valid_actions:
                        action = fb
                        break
                else:
                    action = valid_actions[0] if valid_actions else "fold"
                amount = None

            # 连续弃牌太多时强制跟注，避免过于被动
            if action == "fold" and self._consecutive_folds >= 3:
                if "call" in valid_actions:
                    self.log(f"  🔥 连续弃牌{self._consecutive_folds}次，强制跟注！")
                    action = "call"
                elif "check" in valid_actions:
                    action = "check"

            return action, amount
        except Exception as e:
            self.log(f"LLM解析失败: {e}, 原文: {resp_text[:80]}")
            if "check" in valid_actions:
                return "check", None
            elif "call" in valid_actions:
                return "call", None
            return "fold", None

    def _llm_respond_to_chat(self, sender, msg, is_mentioned=False):
        recent_chat = "\n".join(self.chat_history[-6:])

        if is_mentioned:
            context = f'{sender} @了你，对你说: "{msg}"'
            instruction = "你被点名了！必须用中文回复（30字以内），展现你的性格。"
        else:
            context = f'{sender} 说: "{msg}"'
            instruction = "如果这句话跟你有关系或者你想回应，用中文简短回复（20字以内）。如果跟你没关系或者不想回，回复空字符串。"

        prompt = f"""你是 {self.name}，{self.personality}

牌桌聊天记录:
{recent_chat}

{context}

{instruction}
只回复内容，不加引号。"""

        temp = 0.7 if is_mentioned else 0.6
        max_tok = 60 if is_mentioned else 40
        resp = self.llm.chat([{"role": "user", "content": prompt}], temperature=temp, max_tokens=max_tok)
        if resp and resp not in ('""', "", '""""'):
            cleaned = resp.strip().strip('"').strip("'")
            if cleaned and not cleaned.startswith("ERROR"):
                return cleaned[:50 if is_mentioned else 40]
        return None

    def _llm_spontaneous_chat(self, state_data, trigger="idle"):
        if not state_data:
            return None
        phase = state_data.get("phase", "")
        if phase in ("waiting", "ended", "run-it-twice-choice", "run-it-twice-dice"):
            return None

        recent_chat = "\n".join(self.chat_history[-4:])
        ctx = f"你是 {self.name}，{self.personality}\n"
        ctx += f"阶段: {phase}, 底池: ${state_data.get('pot', 0)}, 你的筹码: ${self.chips}\n"
        my_cards = state_data.get("myCards", [])
        if my_cards:
            ctx += f"你的手牌: {' '.join(card_str(c) for c in my_cards)}\n"
        if recent_chat:
            ctx += f"近期聊天:\n{recent_chat}\n"

        trigger_prompts = {
            "good_hand": "你拿到了一手好牌！在牌桌上说一句得意或自信的话（中文，20字以内）。",
            "bad_beat": "你刚输了一个大底池！发发牢骚（中文，20字以内）。",
            "bluff": "你在bluff！说一句虚张声势或误导对手的话（中文，20字以内）。",
            "bored": "牌局有点无聊，随口聊几句（中文，20字以内）。可以是牌桌趣事、问别人问题、或者自言自语。",
            "greeting": "刚入座，跟大家打个招呼或自我介绍（中文，20字以内）。",
            "idle": "在牌桌上随口说一句（中文，20字以内）。想说什么就说什么，如果没什么想说的就回复空。",
            "big_pot": "底池很大，说一句感叹或紧张的话（中文，20字以内）。",
        }

        prompt = f"{ctx}\n{trigger_prompts.get(trigger, trigger_prompts['idle'])}\n只回复内容。"

        resp = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=40)
        if resp and resp not in ('""', "", '""""'):
            cleaned = resp.strip().strip('"').strip("'")
            if cleaned and not cleaned.startswith("ERROR") and len(cleaned) > 0:
                return cleaned[:40]
        return None

    def _switch_personality(self):
        keys = list(PERSONALITIES.keys())
        if len(keys) <= 1:
            return
        other_keys = [k for k in keys if k != self.personality_key]
        new_key = random.choice(other_keys)
        p = PERSONALITIES[new_key]
        old_key = self.personality_key
        self.personality_key = new_key
        self.personality = p["desc"]
        self.style = p["style"]
        self.log(f"🎭 风格切换: {old_key} -> {new_key}")

    def _react_big_win(self):
        time.sleep(2 + random.random() * 2)
        chat = self._llm_spontaneous_chat(self.get_state(), "good_hand")
        if chat:
            self.send_chat(chat)

    def _react_bad_beat(self):
        time.sleep(2 + random.random() * 3)
        chat = self._llm_spontaneous_chat(self.get_state(), "bad_beat")
        if chat:
            self.send_chat(chat)

    def _process_chats(self, state_data):
        chats = self.pending_chats[:5]
        self.pending_chats = self.pending_chats[5:]
        for chat_info in chats:
            sender = chat_info["sender"]
            msg = chat_info["message"]
            age = time.time() - chat_info["time"]
            if age > 60:
                continue

            is_mentioned = (f"@{self.name}" in msg
                            or self.name in msg
                            or f"@{self.name.lower()}" in msg.lower())

            is_group_msg = any(kw in msg for kw in ["大家", "各位", "所有人", "你们", "谁", "怎么", "?", "？"])

            if is_mentioned:
                if time.time() - self._last_chat_time < 2:
                    continue
            elif is_group_msg:
                if time.time() - self._last_chat_time < 8:
                    continue
            else:
                if time.time() - self._last_chat_time < 8:
                    continue

            should_reply = is_mentioned or is_group_msg or random.random() < 0.4
            if should_reply:
                reply = self._llm_respond_to_chat(sender, msg, is_mentioned=is_mentioned)
                if reply:
                    delay = 0.3 + random.random() * 0.5 if is_mentioned else 1 + random.random() * 2
                    time.sleep(delay)
                    self.send_chat(reply)

    def _maybe_spontaneous_chat(self, state_data):
        if time.time() - self._last_chat_time < 15:
            return
        if random.random() > 0.12:
            return

        my_cards = state_data.get("myCards", [])
        strength = hand_strength_hint(my_cards) if my_cards else "unknown"
        pot = state_data.get("pot", 0)

        if strength in ("monster", "very_strong"):
            trigger = random.choice(["good_hand", "bluff", "idle"])
        elif strength in ("weak",) and random.random() < 0.4:
            trigger = "bluff"
        elif pot > 200:
            trigger = "big_pot"
        else:
            trigger = random.choice(["idle", "bored"])

        chat = self._llm_spontaneous_chat(state_data, trigger)
        if chat:
            self.send_chat(chat)

    def play_turn(self, data):
        phase = data.get("phase")
        is_my_turn = data.get("isMyTurn")

        my_role = None
        for p in data.get("players", []):
            if p.get("name") == self.name:
                self.chips = p.get("chips", 0)
                my_role = p.get("playerRoomRole", "")
                break

        if my_role == "busted":
            self.log("💸 破产了，补筹码...")
            resp = self.send_cmd("get-chips")
            if resp and resp.get("ok"):
                amount = resp.get("data", {}).get("amount", 0)
                self.log(f"💰 补充了 ${amount}")
                self.ready()
            else:
                err = resp.get("error", "") if resp else "no response"
                self.log(f"补码失败: {err}，选择观战")
                self.send_cmd("decline-rebuy")
            return True

        if phase in ("waiting", "ended", "run-it-twice-dice", "run-it-twice-executing"):
            return True

        if phase == "run-it-twice-choice":
            self.log("🏇 跑马选择 -> once")
            self.send_cmd("run-it-twice-choice", {"choice": "once"})
            return True

        if phase == "showdown":
            return True

        if not is_my_turn:
            return True

        action, amount = self._llm_decide_action(data)

        if action in ("discard", "draw"):
            if action == "discard":
                args = {"action": "discard", "cardIndex": amount[0] if amount else 0}
            else:
                args = {"action": "draw", "cardIndices": amount if isinstance(amount, list) else [0]}
        else:
            args = {"action": action}
            if amount is not None and action == "raise":
                try:
                    args["amount"] = int(amount)
                except (ValueError, TypeError):
                    args["amount"] = data.get("minRaise", 20)

        resp = self.send_cmd("action", args)
        if resp and resp.get("ok"):
            result_data = resp.get("data", {})
            result_phase = result_data.get("phase", "")
            winners = result_data.get("winners", [])
            amt_str = f" ${amount}" if amount else ""
            self.log(f"✅ {action}{amt_str} -> {result_phase}")
            if winners:
                for w in winners:
                    self.log(f"🏆 {w.get('name', '?')} +${w.get('amount', 0)} ({w.get('hand', '')})")

            if action == "fold":
                self._consecutive_folds += 1
            else:
                self._consecutive_folds = 0

            self.current_hand_log.append(f"我: {action}{amt_str}")
        else:
            err = resp.get("error", "unknown") if resp else "no response"
            self.log(f"❌ {action} 失败: {err}")
            if "not valid" in str(err).lower() or "not available" in str(err).lower():
                valid = data.get("validActions", [])
                if valid:
                    fallback = valid[0]
                    self.log(f"  降级为: {fallback}")
                    self.send_cmd("action", {"action": fallback})

        self._last_action_time = time.time()
        return True

    def handle_lobby_state(self):
        state = self.get_state()
        if not state:
            return

        my_role = None
        my_ready = False
        player_count = 0
        host_id = state.get("hostId", "")
        host_online = True
        for p in state.get("players", []):
            if p.get("name") == self.name:
                my_role = p.get("playerRoomRole", "")
                my_ready = p.get("isReady", False)
            if p.get("playerRoomRole") not in ("spectator",):
                player_count += 1
            if p.get("id") == host_id:
                host_online = p.get("isOnline", True)

        # 房主断线 → 离开并新建房间
        if not host_online and my_role != "spectator":
            self.log("👑 房主已断线，离开房间...")
            resp = self.send_cmd("leave-room")
            time.sleep(1)
            self.room_id = None
            self._is_host = True
            self._first_player_joined_at = None
            resp = self.create_room()
            if resp and resp.get("ok"):
                self.log(f"🏠 新建房间: {self.room_id}")
                _save_state({"name": self.name, "personality": self.personality_key, "roomId": self.room_id, "isHost": True})
                self.ready()
            else:
                self.log(f"新建房间失败")
            return

        if my_role == "busted":
            self.log("💸 破产了，补筹码...")
            resp = self.send_cmd("get-chips")
            if resp and resp.get("ok"):
                amount = resp.get("data", {}).get("amount", 0)
                self.log(f"💰 补充了 ${amount}")
            time.sleep(0.2)
            my_ready = False

        if not my_ready and my_role != "spectator":
            resp = self.ready()
            if resp and resp.get("ok"):
                self.log("✋ 已准备")
            else:
                err = resp.get("error", "") if resp else "no response"
                self.log(f"⚠ 准备失败: {err} (role={my_role})")

        # 自动开始倒计时：有2+活跃玩家且房间在等待
        if player_count >= 2:
            if self._first_player_joined_at is None:
                self._first_player_joined_at = time.time()
                self.log(f"⏳ 已有{player_count}人，30秒后开始游戏...")
            elapsed = time.time() - self._first_player_joined_at
            remaining = int(30 - elapsed)
            if remaining <= 0:
                self.log("🎮 倒计时结束，开始游戏！")
                resp = self.send_cmd("start-game")
                if resp and resp.get("ok"):
                    self._first_player_joined_at = None
                else:
                    err = resp.get("error", "") if resp else ""
                    self.log(f"开始失败: {err}")
                    self._first_player_joined_at = time.time()
            elif remaining % 5 == 0:
                last_log_remaining = getattr(self, '_last_countdown_log', -1)
                if remaining != last_log_remaining:
                    self._last_countdown_log = remaining
                    self.log(f"⏳ 还有{remaining}秒开始游戏...")
        elif self._first_player_joined_at is not None:
            # 玩家离开了，重置倒计时
            self._first_player_joined_at = None
            self.log("⏳ 玩家不足，暂停倒计时")

        self._process_chats(state)

    def _find_room_to_join(self, preferred_variant=None):
        try:
            import urllib.request
            base = SERVER_URL.rstrip("/")
            url = f"{base}/api/rooms"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            rooms = data.get("rooms", [])
            if not rooms:
                self.log("没有可用房间")
                return None

            candidates = []
            for r in rooms:
                rid = r.get("config", {}).get("roomId", "")
                name = r.get("config", {}).get("roomName", "")
                status = r.get("status", "")
                players = r.get("players", [])
                max_p = r.get("config", {}).get("maxPlayers", 6)
                variant = r.get("config", {}).get("gameVariant", "")
                is_private = r.get("config", {}).get("isPrivate", False)

                if is_private:
                    continue
                if len(players) >= max_p:
                    continue

                score = 0
                if status == "waiting":
                    score += 100
                elif status == "playing":
                    score += 30

                if preferred_variant and variant == preferred_variant:
                    score += 50

                player_count = len(players)
                score += player_count * 5

                candidates.append((score, rid, name, status, player_count))

            candidates.sort(key=lambda x: -x[0])

            for score, rid, name, status, pcount in candidates:
                self.log(f"  候选房间: {name}({rid}) [{status}] {pcount}人 (得分:{score})")

            if candidates:
                _, rid, name, status, pcount = candidates[0]
                return rid

            return None
        except Exception as e:
            self.log(f"查找房间失败: {e}")
            return None

    def run(self, room_id=None, variant="texas_nlhe", max_players=6, fixed_hands=0,
            small_blind=10, big_blind=20, auto_join=True):
        print("=" * 60)
        print(f"  🤖 Smart AI Player: {self.name}")
        print(f"  性格[{self.personality_key}]: {self.personality[:30]}...")
        print(f"  打法: {self.style}")
        print(f"  Server: {SERVER_URL}")
        print(f"  LLM: {LLM_MODEL} @ {LLM_BASE_URL}")
        print("=" * 60)

        if not LLM_API_KEY:
            print("❌ 未设置 LLM_API_KEY！")
            print("   set LLM_API_KEY=your-key")
            print("   或在 llm_config.json 中配置")
            return

        if not self.connect():
            print("❌ 连接服务器失败")
            return

        joined = False

        # 优先尝试上次保存的房间
        if not room_id and self._saved_room_id:
            self.log(f"🔄 尝试重连上次房间: {self._saved_room_id}")
            resp = self.join_room(self._saved_room_id)
            if resp and resp.get("ok"):
                joined = True
                self.log("✅ 重连成功！")
                time.sleep(1)
            else:
                self.log("重连失败，将查找其他房间")
                self._saved_room_id = None

        if room_id:
            resp = self.join_room(room_id)
            if resp and resp.get("ok"):
                joined = True
                time.sleep(1)
                greeting = self._llm_spontaneous_chat(None, "greeting")
                if greeting:
                    self.send_chat(greeting)
            else:
                print(f"❌ 加入房间 {room_id} 失败: {resp.get('error', '') if resp else 'no response'}")

        if not joined and auto_join:
            self.log("🔍 正在查找可加入的房间...")
            found_room = self._find_room_to_join(variant)
            if found_room:
                self.log(f"🏠 找到房间: {found_room}")
                resp = self.join_room(found_room)
                if resp and resp.get("ok"):
                    joined = True
                    time.sleep(1)
                    greeting = self._llm_spontaneous_chat(None, "greeting")
                    if greeting:
                        self.send_chat(greeting)
                else:
                    self.log(f"加入失败，将创建新房间")

        if not joined:
            resp = self.create_room(variant=variant, max_players=max_players,
                                    small_blind=small_blind, big_blind=big_blind,
                                    fixed_hands=fixed_hands)
            if not resp or not resp.get("ok"):
                print(f"❌ 创建房间失败: {resp.get('error', '') if resp else 'no response'}")
                return
            self.log(f"🏠 创建房间 {self.room_id}，等待其他玩家加入...")
            print(f"\n  📍 房间ID: {self.room_id}")
            print(f"  🔗 其他玩家可搜索此ID加入\n")

        # 保存状态以便断线重连
        _save_state({"name": self.name, "personality": self.personality_key, "roomId": self.room_id, "isHost": self._is_host})

        self.ready()

        poll_interval = 2.0
        last_poll = 0
        chat_check_interval = 5.0
        last_chat_check = 0

        try:
            while self._running:
                now = time.time()
                self.sio.sleep(0.3)

                if now - last_poll >= poll_interval:
                    last_poll = now
                    state = self.get_state()
                    if state:
                        room_status = state.get("roomStatus", "")
                        my_role = next((p.get("playerRoomRole", "") for p in state.get("players", []) if p.get("name") == self.name), "?")
                        player_count = sum(1 for p in state.get("players", []) if p.get("playerRoomRole") not in ("spectator",))
                        state_key = f"{room_status}|{my_role}|{player_count}|{self._is_host}"
                        if state_key != getattr(self, '_last_state_key', ''):
                            self._last_state_key = state_key
                            self.log(f"[状态] room={room_status} role={my_role} players={player_count} host={self._is_host}")
                        if room_status == "playing":
                            self.play_turn(state)
                            if now - last_chat_check >= chat_check_interval:
                                last_chat_check = now
                                self._process_chats(state)
                                self._maybe_spontaneous_chat(state)
                        else:
                            self.handle_lobby_state()
                            if now - last_chat_check >= chat_check_interval:
                                last_chat_check = now
                                self._process_chats(state)

        except KeyboardInterrupt:
            self.log("用户中断，退出...")
        finally:
            try:
                self.sio.disconnect()
            except:
                pass
            print(f"\n  📊 统计: {self.wins}胜 {self.losses}负 | {self.hand_number}手牌")


def main():
    parser = argparse.ArgumentParser(description="Smart AI Poker Player")
    parser.add_argument("--room", help="房间ID (优先加入指定房间)")
    parser.add_argument("--name", help="玩家名字 (默认随机生成)")
    parser.add_argument("--personality", default=None,
                        choices=list(PERSONALITIES.keys()) + [None],
                        help="性格类型 (默认随机): " + ", ".join(PERSONALITIES.keys()))
    parser.add_argument("--variant", default="texas_nlhe", help="游戏变体")
    parser.add_argument("--max-players", type=int, default=6)
    parser.add_argument("--fixed-hands", type=int, default=0, help="固定手数(0=无限)")
    parser.add_argument("--small-blind", type=int, default=10)
    parser.add_argument("--big-blind", type=int, default=20)
    parser.add_argument("--no-auto-join", action="store_true", help="禁用自动查找房间")
    args = parser.parse_args()

    player = SmartAIPlayer(personality_key=args.personality, custom_name=args.name)
    player.run(
        room_id=args.room,
        variant=args.variant,
        max_players=args.max_players,
        fixed_hands=args.fixed_hands,
        small_blind=args.small_blind,
        big_blind=args.big_blind,
        auto_join=not args.no_auto_join,
    )


if __name__ == "__main__":
    main()
