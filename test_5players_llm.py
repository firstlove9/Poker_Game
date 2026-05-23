"""
LLM-Powered 5-Player AI Poker Demo
====================================
5 AI players driven by LLM (OpenAI-compatible API).
- Each player thinks before acting (5-6 seconds minimum)
- Players respond to chat messages related to them
- 30 hands played with fixedHands mode

Usage:
  pip install python-socketio[client] openai
  set LLM_API_KEY=your-api-key
  set LLM_BASE_URL=https://api.openai.com/v1
  set LLM_MODEL=gpt-4o-mini
  python test_5players_llm.py
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import os
import threading
import random
from openai import OpenAI

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

LLM_API_KEY = os.environ.get("LLM_API_KEY", "REDACTED_KEY")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://aiproxy.geeknest.net/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "my-glm5.1")

if LLM_BASE_URL.endswith("/chat/completions"):
    LLM_BASE_URL = LLM_BASE_URL[: -len("/chat/completions")]
elif LLM_BASE_URL.endswith("/v1/chat/completions"):
    LLM_BASE_URL = LLM_BASE_URL[: -len("/chat/completions")]

MAX_HANDS = 30

PLAYER_CONFIGS = [
    {
        "name": "Alice",
        "personality": "冷静理性的扑克高手，喜欢分析赔率和对手行为。说话简洁有力，偶尔冷幽默。用中文聊天。",
        "style": "TAG（紧凶型），只在有好牌时入池，但一旦入池就积极下注",
    },
    {
        "name": "Bob",
        "personality": "大胆激进的赌徒，喜欢全下施压。嘴上从不认输，输了也嘴硬。用中文聊天。",
        "style": "LAG（松凶型），经常入池，喜欢加注和全下",
    },
    {
        "name": "Charlie",
        "personality": "喜欢虚张声势的诈唬王，经常bluff但偶尔也有真牌。话多，喜欢挑衅对手。用中文聊天。",
        "style": "LAG（松凶型），经常bluff，喜欢在弱牌时假装强牌",
    },
    {
        "name": "Diana",
        "personality": "温柔但精明的女玩家，善于观察对手模式。说话温柔但暗藏杀机。用中文聊天。",
        "style": "TAG（紧凶型），选择性强，但读人能力极强",
    },
    {
        "name": "Eve",
        "personality": "谨慎保守的数学家型选手，凡事讲概率。偶尔会冒出一句数据分析。用中文聊天。",
        "style": "Rock（石头型），非常紧，只在极好牌时入池，但绝不bluff",
    },
]


class LLMClient:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance.client = OpenAI(
                    api_key=LLM_API_KEY,
                    base_url=LLM_BASE_URL,
                )
        return cls._instance

    def chat(self, messages, temperature=0.7, max_tokens=300):
        try:
            response = self.client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"  [LLM ERROR] {e}", flush=True)
            return f"ERROR: {e}"


class LLMAIPlayer:
    def __init__(self, config, index):
        self.name = config["name"]
        self.personality = config["personality"]
        self.style = config["style"]
        self.index = index
        self.sio = socketio.Client()
        self.player_id = None
        self.room_id = None
        self.chips = 0
        self.is_host = False
        self.game_log = []
        self.pending_chats = []
        self.llm = LLMClient()

        @self.sio.on("ai:connected", namespace=AI_NAMESPACE)
        def on_connected(data, _self=self):
            _self.player_id = data.get("data", {}).get("playerId")
            _self.log(f"Connected as {_self.player_id}")

        @self.sio.on("game:action_result", namespace=AI_NAMESPACE)
        def on_action(data, _self=self):
            player_name = data.get("playerName", "")
            action = data.get("action", "")
            amount = data.get("amount")
            amt_str = f" {amount}" if amount else ""
            if player_name != _self.name:
                _self.game_log.append(f"{player_name} {action}{amt_str}")

        @self.sio.on("game:hand_result", namespace=AI_NAMESPACE)
        def on_hand_result(data, _self=self):
            winners = data.get("winners", [])
            for w in winners:
                _self.game_log.append(f"WIN {w.get('playerName', '?')} {w.get('winAmount', 0)}")

        @self.sio.on("game:game_over", namespace=AI_NAMESPACE)
        def on_game_over(data, _self=self):
            winner = data.get("winner", {})
            _self.log(f"GAME OVER! Winner: {winner.get('name', 'None')}")

        @self.sio.on("chat:message", namespace=AI_NAMESPACE)
        def on_chat(data, _self=self):
            sender = data.get("playerName", "")
            msg = data.get("message", "")
            if sender != _self.name:
                _self.log(f"[CHAT] {sender}: {msg}")
                _self.pending_chats.append({"sender": sender, "message": msg, "time": time.time()})

        @self.sio.on("system:chips_received", namespace=AI_NAMESPACE)
        def on_chips(data, _self=self):
            pid = data.get("playerId", "")
            amount = data.get("amount", 0)
            _self.log(f"Player {pid} replenished {amount} chips")

        @self.sio.on("room:vote_extend_hands_started", namespace=AI_NAMESPACE)
        def on_vote_started(data, _self=self):
            _self.log(f"Vote extend hands started by {data.get('initiatorName')}")

        @self.sio.on("room:vote_extend_hands_ended", namespace=AI_NAMESPACE)
        def on_vote_ended(data, _self=self):
            approved = data.get('approved')
            new_fh = data.get('newFixedHands')
            _self.log(f"Vote extend ended: approved={approved}, newFixedHands={new_fh}")

    def log(self, msg):
        print(f"  [{self.name}] {msg}", flush=True)

    def connect(self):
        try:
            self.sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=10)
            time.sleep(0.3)
            return True
        except Exception as e:
            self.log(f"Connection failed: {e}")
            return False

    def send_cmd(self, cmd, args=None, timeout=10):
        req_id = f"{self.index}_{int(time.time()*1000)}"
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
            self.log(f"Command error: {e}")
            return None

    def create_room(self):
        resp = self.send_cmd("create-room", {
            "name": "LLM-Poker-Table",
            "variant": "texas_nlhe",
            "maxPlayers": 6,
            "smallBlind": 10,
            "bigBlind": 20,
            "playerName": self.name,
            "fixedHands": MAX_HANDS,
        })
        if resp and resp.get("ok"):
            self.room_id = resp.get("data", {}).get("roomId")
            self.is_host = True
            self.log(f"Created room: {self.room_id}")
        return resp

    def join_room(self, room_id):
        resp = self.send_cmd("join-room", {"roomId": room_id, "name": self.name})
        if resp and resp.get("ok"):
            self.room_id = room_id
            self.log(f"Joined room: {room_id}")
        return resp

    def ready(self):
        return self.send_cmd("ready", {"ready": True})

    def start_game(self):
        resp = self.send_cmd("start-game")
        if resp and resp.get("ok"):
            self.log("Game started!")
        return resp

    def get_state(self):
        resp = self.send_cmd("get-state")
        if resp and resp.get("ok"):
            return resp.get("data", {})
        return None

    def build_game_context(self, state_data):
        ctx = f"# 你的身份\n你是 {self.name}，{self.personality}\n打法风格：{self.style}\n\n"

        phase = state_data.get("phase", "?")
        ctx += f"# 当前局势\n"
        ctx += f"- 阶段: {phase}\n"
        ctx += f"- 底池: {state_data.get('pot', 0)}\n"
        ctx += f"- 当前下注: {state_data.get('currentBet', 0)}\n\n"

        my_cards = state_data.get("myCards", [])
        if my_cards:
            cards_str = " ".join(c.get("code", "?") for c in my_cards)
            ctx += f"# 你的手牌\n{cards_str}\n\n"

        ctx += "# 所有玩家\n"
        for p in state_data.get("players", []):
            status = p.get("status", "?")
            chips = p.get("chips", 0)
            round_bet = p.get("roundBet", 0)
            role = p.get("role", "")
            me_marker = " ←你" if p.get("name") == self.name else ""
            role_str = f"[{role}]" if role else ""
            ctx += f"- {p.get('name', '?')}{role_str}: 筹码={chips}, 下注={round_bet}, 状态={status}{me_marker}\n"

        community = state_data.get("communityCards", [])
        if community:
            ctx += f"\n# 公共牌\n{' '.join(c.get('code', '?') for c in community)}\n"

        if self.game_log:
            recent = self.game_log[-8:]
            ctx += f"\n# 近期操作\n" + "\n".join(f"- {l}" for l in recent) + "\n"

        return ctx

    def llm_decide_action(self, state_data):

        ctx = self.build_game_context(state_data)
        valid_actions = state_data.get("validActions", [])
        phase = state_data.get("phase", "")

        if phase == "discard" and "discard" in valid_actions:
            my_cards = state_data.get("myCards", [])
            cards_str = ", ".join(c.get("code", "?") for c in my_cards)
            prompt = f"""{ctx}
你有3张牌: {cards_str}
你需要丢弃1张牌。

请思考哪张牌最弱，然后回复JSON:
{{"thinking": "你的思考过程", "discard_index": 0}}
0=第一张, 1=第二张, 2=第三张。只回复JSON。"""

            resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=100)
            try:
                cleaned = resp_text.replace("```json", "").replace("```", "").strip()
                data = json.loads(cleaned)
                thinking = data.get("thinking", "")
                idx = int(data.get("discard_index", 0))
                self.log(f"思考: {thinking[:50]} -> 丢弃第{idx+1}张")
                return "discard", idx
            except:
                return "discard", 0

        actions_str = ", ".join(valid_actions)

        actions_resp = self.send_cmd("get-actions")
        to_call = 0
        my_chips = self.chips
        min_raise = 0
        if actions_resp and actions_resp.get("ok"):
            ad = actions_resp.get("data", {})
            to_call = ad.get("toCall", 0)
            my_chips = ad.get("myChips", self.chips)
            min_raise = ad.get("minRaise", 0)

        prompt = f"""{ctx}
# 你的回合
可用操作: [{actions_str}]
跟注需要: {to_call}, 你的筹码: {my_chips}, 最小加注: {min_raise}

请仔细分析局势，考虑你的手牌强度、底池赔率、对手可能的手牌范围，然后做出决策。

回复JSON格式:
{{"thinking": "你的详细思考过程（分析手牌、赔率、对手行为）", "action": "操作名", "amount": 加注金额(仅raise时需要)}}

操作选项:
- fold: 弃牌
- check: 过牌（无需跟注时）
- call: 跟注
- raise: 加注（需指定amount）
- all-in: 全下

只回复JSON，不要其他内容。"""

        resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=200)
        try:
            cleaned = resp_text.replace("```json", "").replace("```", "").strip()
            data = json.loads(cleaned)
            thinking = data.get("thinking", "")
            action = data.get("action", "fold")
            amount = data.get("amount")

            self.log(f"思考: {thinking[:80]}... -> 决定: {action}" + (f" {amount}" if amount else ""))

            if action not in valid_actions:
                self.log(f"  [{action}] 不在可用操作中，降级处理...")
                if "check" in valid_actions:
                    action = "check"
                    amount = None
                elif "call" in valid_actions:
                    action = "call"
                    amount = None
                elif "fold" in valid_actions:
                    action = "fold"
                    amount = None
                else:
                    action = valid_actions[0] if valid_actions else "fold"
                    amount = None

            return action, amount
        except Exception as e:
            self.log(f"LLM解析错误: {e}, 原文: {resp_text[:100]}")
            if "check" in valid_actions:
                return "check", None
            elif "call" in valid_actions:
                return "call", None
            return "fold", None

    def llm_respond_to_chat(self, chat_msg, sender):
        prompt = f"""你是 {self.name}，{self.personality}

在扑克牌桌上，{sender} 说了: "{chat_msg}"

如果这句话跟你有关系（提到了你、对你说的、或者你觉得需要回应），请用中文简短回复（15字以内）。
如果跟你没关系，回复空字符串。

只回复内容，不加引号。"""

        resp = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.9, max_tokens=50)
        if resp and resp != '""' and resp != '' and not resp.startswith("ERROR"):
            cleaned = resp.strip().strip('"').strip("'")
            if cleaned:
                return cleaned[:30]
        return None

    def llm_generate_chat(self, state_data, trigger="spontaneous"):
        if not state_data:
            return None
        phase = state_data.get("phase", "")
        if phase in ("waiting", "ended", "run-it-twice-choice", "run-it-twice-dice", "run-it-twice-executing"):
            return None

        ctx = f"你是 {self.name}，{self.personality}\n"
        ctx += f"阶段: {phase}, 底池: {state_data.get('pot', 0)}\n"
        my_cards = state_data.get("myCards", [])
        if my_cards:
            ctx += f"你的手牌: {' '.join(c.get('code', '?') for c in my_cards)}\n"

        if trigger == "good_hand":
            prompt = f"{ctx}\n你拿到了好牌！在牌桌上说一句得意的话（中文，15字以内）。只回复内容。"
        elif trigger == "bad_beat":
            prompt = f"{ctx}\n你刚输了一手大牌！抱怨一句（中文，15字以内）。只回复内容。"
        elif trigger == "bluff":
            prompt = f"{ctx}\n你在bluff！说一句虚张声势的话（中文，15字以内）。只回复内容。"
        else:
            prompt = f"{ctx}\n在牌桌上随口说一句（中文，15字以内）。可以聊聊牌局、对手、或者闲聊。如果没什么想说的就回复空。只回复内容。"

        resp = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.9, max_tokens=40)
        if resp and resp != '""' and resp != '' and not resp.startswith("ERROR"):
            cleaned = resp.strip().strip('"').strip("'")
            if cleaned and len(cleaned) > 0:
                return cleaned[:30]
        return None

    def process_pending_chats(self, state_data):
        chats_to_process = self.pending_chats[:3]
        self.pending_chats = self.pending_chats[3:]

        for chat_info in chats_to_process:
            sender = chat_info["sender"]
            msg = chat_info["message"]
            age = time.time() - chat_info["time"]
            if age > 30:
                continue

            if self.name in msg or any(kw in msg for kw in ["大家", "各位", "所有人", "你们", "谁"]):
                reply = self.llm_respond_to_chat(msg, sender)
                if reply:
                    self.send_cmd("chat", {"message": reply})
                    self.log(f"回复{sender}: {reply}")
            elif random.random() < 0.25:
                reply = self.llm_respond_to_chat(msg, sender)
                if reply:
                    self.send_cmd("chat", {"message": reply})
                    self.log(f"回应{sender}: {reply}")

    def play_turn(self, data):
        phase = data.get("phase")
        is_my_turn = data.get("isMyTurn")

        for p in data.get("players", []):
            if p.get("name") == self.name:
                self.chips = p.get("chips", 0)
                break

        if phase in ("waiting", "ended", "showdown", "run-it-twice-choice", "run-it-twice-dice", "run-it-twice-executing"):
            return True

        if not is_my_turn:
            return True

        action, amount = self.llm_decide_action(data)

        if action == "discard":
            args = {"action": "discard", "amount": amount if amount is not None else 0}
        else:
            args = {"action": action}
            if amount is not None and action == "raise":
                args["amount"] = amount

        resp = self.send_cmd("action", args)
        if resp and resp.get("ok"):
            result_data = resp.get("data", {})
            result_phase = result_data.get("phase", "")
            winners = result_data.get("winners", [])
            amt_str = f" {amount}" if amount else ""
            self.log(f"行动: {action}{amt_str} -> phase={result_phase}")
            if winners:
                for w in winners:
                    self.log(f"Winner: {w.get('name', '?')} +{w.get('amount', 0)} ({w.get('hand', '')})")
            self.game_log.append(f"Me: {action}{amt_str}")
        else:
            err = resp.get("error", "unknown") if resp else "no response"
            self.log(f"行动 {action} 失败: {err}")

        return True

    def handle_busted_and_ready(self, state_data):
        if not state_data:
            return
        my_role = None
        my_ready = False
        for p in state_data.get("players", []):
            if p.get("name") == self.name:
                my_role = p.get("playerRoomRole", "")
                my_ready = p.get("isReady", False)
                break
        if my_role == "busted":
            self.log("破产了！补筹码...")
            resp = self.send_cmd("get-chips")
            if resp and resp.get("ok"):
                amount = resp.get("data", {}).get("amount", 0)
                self.log(f"补充了 {amount} 筹码")
            time.sleep(0.1)
        if not my_ready:
            self.ready()

    def leave_room(self):
        return self.send_cmd("leave-room")

    def disconnect(self):
        try:
            self.sio.disconnect()
        except:
            pass


def main():
    print("=" * 60)
    print("  LLM-Powered 5-Player AI Poker Demo")
    print(f"  {MAX_HANDS} Hands | No artificial delay")
    print("  Server: http://localhost:3000")
    print("=" * 60)
    print(f"\n  LLM Config:")
    print(f"    Base URL: {LLM_BASE_URL}")
    print(f"    Model:    {LLM_MODEL}")
    print(f"    API Key:  {'***' + LLM_API_KEY[-4:] if len(LLM_API_KEY) > 4 else '(not set)'}")

    if not LLM_API_KEY:
        print("\n  ERROR: LLM_API_KEY not set!")
        sys.exit(1)

    players = []
    for i, config in enumerate(PLAYER_CONFIGS):
        p = LLMAIPlayer(config, i)
        players.append(p)

    print("\n--- Phase 1: Connect ---")
    for p in players:
        if p.connect():
            print(f"  OK {p.name} connected (ID: {p.player_id})")
        else:
            print(f"  FAIL {p.name} failed to connect")
            sys.exit(1)
        time.sleep(0.3)

    print("\n--- Phase 2: Create Room ---")
    host = players[0]
    resp = host.create_room()
    if not resp or not resp.get("ok"):
        print("  FAIL: Could not create room")
        for p in players:
            p.disconnect()
        sys.exit(1)
    room_id = host.room_id
    print(f"  Room: {room_id}")

    print("\n--- Phase 3: Join Room ---")
    for p in players[1:]:
        p.join_room(room_id)
        time.sleep(0.3)

    print("\n--- Phase 4: Ready Up ---")
    for p in players:
        p.ready()
        time.sleep(0.2)

    print("\n--- Phase 5: Start Game ---")
    host.start_game()
    time.sleep(1)

    print(f"\n--- Phase 6: Play {MAX_HANDS} Hands! ---")
    completed_hands = 0
    chat_cooldown = {p.name: 0 for p in players}
    last_completed_hand_id = None
    inter_hand = False
    hand_ready_done = False
    rit_choice_done = set()
    rit_dice_done = set()
    last_progress_time = time.time()
    vote_extend_done = False

    for loop in range(10000):
        if inter_hand and not hand_ready_done:
            if completed_hands >= MAX_HANDS:
                print(f"\n  已打完 {MAX_HANDS} 局!")

                if not vote_extend_done:
                    print(f"\n  --- 发起投票延长10局 ---")
                    for p in players[:2]:
                        resp = p.send_cmd("vote-extend-hands", {"approve": True})
                        if resp and resp.get("ok"):
                            p.log(f"投票延长: ok, data={resp.get('data')}")
                        else:
                            p.log(f"投票延长失败: {resp.get('error') if resp else 'no resp'}")
                        time.sleep(0.5)
                    vote_extend_done = True
                    time.sleep(3)
                    sd = host.get_state()
                    if sd and sd.get("phase") and sd.get("phase") not in ("waiting", None, "ended", "showdown"):
                        print(f"  投票通过！游戏继续！phase={sd.get('phase')}")
                    else:
                        print(f"  投票结果未确定，准备手动重启...")
                        break
                else:
                    break

            print(f"\n  --- 准备下一局 (第{completed_hands + 1}局) ---")

            for p in players:
                state_data = p.get_state()
                p.handle_busted_and_ready(state_data)
                time.sleep(0.1)

            time.sleep(1)
            host.start_game()

            print(f"  等待下一局开始...")
            wait_start = time.time()
            while time.time() - wait_start < 30:
                sd = host.get_state()
                if sd and sd.get("phase") and sd.get("phase") not in ("waiting", None, "ended", "showdown"):
                    print(f"  新一局开始! phase={sd.get('phase')}")
                    break
                for p in players:
                    sd2 = p.get_state()
                    if sd2:
                        p.handle_busted_and_ready(sd2)
                time.sleep(2)

            last_completed_hand_id = None
            hand_ready_done = True
            inter_hand = False
            continue

        any_progress = False

        for p in players:
            state_data = p.get_state()
            if not state_data:
                continue

            phase = state_data.get("phase")
            is_my_turn = state_data.get("isMyTurn")
            hand_id = state_data.get("handId")

            if phase in ("waiting", None):
                if p.pending_chats:
                    p.process_pending_chats(state_data)
                continue

            if phase in ("showdown", "ended"):
                if hand_id and hand_id != last_completed_hand_id:
                    last_completed_hand_id = hand_id
                    completed_hands += 1
                    any_progress = True
                    last_result = state_data.get("lastResult")
                    rit_choice_done.clear()
                    rit_dice_done.clear()
                    print(f"\n  {'='*40}")
                    print(f"  第 {completed_hands}/{MAX_HANDS} 局结束! (handId: {hand_id})")
                    print(f"  {'='*40}")
                    if last_result:
                        winners = last_result.get("winners", [])
                        for w in winners:
                            print(f"    WINNER: {w.get('playerName', '?')} wins {w.get('winAmount', 0)} ({w.get('hand', '')})")
                        rit_results = last_result.get("runItTwiceResults", [])
                        if rit_results:
                            print(f"    RIT results: {rit_results}")
                    inter_hand = True
                    hand_ready_done = False
                    p.game_log.clear()
                continue

            if phase == "run-it-twice-choice":
                my_status = None
                for pp in state_data.get("players", []):
                    if pp.get("name") == p.name:
                        my_status = pp.get("status")
                        break
                if my_status and my_status != "folded" and p.name not in rit_choice_done:
                    ctx = p.build_game_context(state_data)
                    prompt = f"""{ctx}
# 跑马(Run It Twice)选择
你在全下对决中，可以选择发一次牌或两次牌。

请思考你的选择：
- once: 只发一次牌，风险更大但赢就赢全部
- twice: 发两次牌，减少方差，更稳定

回复JSON: {{"thinking": "思考过程", "choice": "once或twice"}}"""

                    resp_text = p.llm.chat([{"role": "user", "content": prompt}], temperature=0.5, max_tokens=80)
                    choice = "twice"
                    try:
                        cleaned = resp_text.replace("```json", "").replace("```", "").strip()
                        data = json.loads(cleaned)
                        choice = data.get("choice", "twice")
                        thinking = data.get("thinking", "")
                        p.log(f"RIT思考: {thinking[:50]} -> 选择: {choice}")
                    except:
                        p.log(f"RIT选择解析失败，默认twice")

                    resp = p.send_cmd("run-it-twice-choice", {"choice": choice})
                    if resp and resp.get("ok"):
                        rit_choice_done.add(p.name)
                        any_progress = True
                    elif resp:
                        err = resp.get("error", "")
                        if "already" in err.lower() or "已经" in err:
                            rit_choice_done.add(p.name)
                        else:
                            p.log(f"RIT choice error: {err}")
                continue

            if phase == "run-it-twice-dice":
                my_status = None
                for pp in state_data.get("players", []):
                    if pp.get("name") == p.name:
                        my_status = pp.get("status")
                        break
                if my_status and my_status != "folded" and p.name not in rit_dice_done:
                    dice_resp = p.send_cmd("roll-dice")
                    if dice_resp and dice_resp.get("ok"):
                        p.log(f"掷骰子!")
                        rit_dice_done.add(p.name)
                        any_progress = True
                    elif dice_resp:
                        err = dice_resp.get("error", "")
                        if "already" in err.lower() or "已经" in err:
                            rit_dice_done.add(p.name)
                        else:
                            p.log(f"Dice error: {err}")
                continue

            if phase == "run-it-twice-executing":
                continue

            if p.pending_chats:
                p.process_pending_chats(state_data)

            if is_my_turn:
                p.play_turn(state_data)
                any_progress = True

                now = time.time()
                if now - chat_cooldown.get(p.name, 0) > 12:
                    my_cards = state_data.get("myCards", [])
                    trigger = "spontaneous"
                    if my_cards:
                        ranks = [c.get("rank", "") for c in my_cards]
                        if len(set(ranks)) == 1:
                            trigger = "good_hand"
                        elif all(r in ("A", "K", "Q") for r in ranks):
                            trigger = "good_hand"
                    chat_msg = p.llm_generate_chat(state_data, trigger)
                    if chat_msg:
                        p.send_cmd("chat", {"message": chat_msg})
                        p.log(f"CHAT: {chat_msg}")
                        chat_cooldown[p.name] = now

        if any_progress:
            last_progress_time = time.time()

        if time.time() - last_progress_time > 180:
            print(f"\n  WARNING: 3分钟无进展! 状态:")
            for p in players:
                sd = p.get_state()
                if sd:
                    print(f"    [{p.name}] phase={sd.get('phase')}, isMyTurn={sd.get('isMyTurn')}, handId={sd.get('handId')}")
                else:
                    print(f"    [{p.name}] 无状态数据")
            break

    print("\n--- Final Stats ---")
    print(f"  总共打了 {completed_hands} 局\n")
    for p in players:
        state_data = p.get_state()
        chips = 0
        if state_data:
            for pp in state_data.get("players", []):
                if pp.get("name") == p.name:
                    chips = pp.get("chips", 0)
                    break
        print(f"  {p.name}: {chips} chips")

    print("\n--- Cleanup ---")
    for p in players:
        p.leave_room()
        time.sleep(0.1)
    for p in players:
        p.disconnect()
    print("  All players disconnected")
    print(f"\n  Demo complete! Played {completed_hands} hands with LLM-driven AI players.")


if __name__ == "__main__":
    main()
