"""LLM驱动的多玩法自动测试 - 参考test_5players_llm.py的架构"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import os
import threading
from openai import OpenAI

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "llm_config.json")
def _load_llm_config():
    if os.path.exists(_CONFIG_FILE):
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

_llm_cfg = _load_llm_config()

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", _llm_cfg.get("LLM_BASE_URL", "https://api.openai.com/v1"))
LLM_MODEL = os.environ.get("LLM_MODEL", _llm_cfg.get("LLM_MODEL", "gpt-4o-mini"))
LLM_API_KEY = os.environ.get("LLM_API_KEY", _llm_cfg.get("LLM_API_KEY", ""))

if LLM_BASE_URL.endswith("/chat/completions"):
    LLM_BASE_URL = LLM_BASE_URL[: -len("/chat/completions")]
elif LLM_BASE_URL.endswith("/v1/chat/completions"):
    LLM_BASE_URL = LLM_BASE_URL[: -len("/chat/completions")]

llm_client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)

VARIANTS_TO_TEST = [
    ("texas_nlhe", "常规德州", 2),
    ("texas_lhe", "限注德州", 2),
    ("texas_plo", "底池限注德州", 2),
    ("six_plus", "短牌", 2),
    ("pineapple", "大菠萝", 2),
    ("crazy_pineapple", "疯狂菠萝", 2),
    ("texas_double_board", "双排面德州", 2),
    ("omaha_plo", "奥马哈", 2),
    ("omaha_hi_lo", "奥马哈高低", 2),
    ("omaha_plo5", "五张奥马哈", 2),
    ("omaha_plo6", "六张奥马哈", 2),
    ("omaha_double_board", "双排面奥马哈", 2),
    ("omaha_three_board", "三板面奥马哈", 2),
    ("five_card_draw", "五张换牌", 2),
    ("seven_card_stud", "七张梭哈", 2),
    ("squid_dalgona_suit", "椪糖花色局", 3),
]


class LLMClient:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance.client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)
        return cls._instance

    def chat(self, messages, temperature=0.7, max_tokens=200):
        try:
            resp = self.client.chat.completions.create(
                model=LLM_MODEL, messages=messages,
                temperature=temperature, max_tokens=max_tokens,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"    [LLM ERROR] {e}", flush=True)
            return f"ERROR: {e}"


class TestPlayer:
    def __init__(self, name, index, variant_id):
        self.name = name
        self.index = index
        self.variant_id = variant_id
        self.sio = socketio.Client()
        self.player_id = None
        self.room_id = None
        self.llm = LLMClient()

        @self.sio.on("ai:connected", namespace=AI_NAMESPACE)
        def on_connected(data, _self=self):
            _self.player_id = data.get("data", {}).get("playerId") or data.get("playerId")

    def log(self, msg):
        print(f"    [{self.name}] {msg}", flush=True)

    def connect(self):
        try:
            self.sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=10)
            time.sleep(0.3)
            if not self.player_id:
                r = self.send_cmd("whoami")
                if r and r.get("ok"):
                    self.player_id = r.get("data", {}).get("playerId")
            return self.player_id is not None
        except Exception as e:
            self.log(f"Connection failed: {e}")
            return False

    def send_cmd(self, cmd, args=None, timeout=15):
        args = args or {}
        req_id = f"{self.index}_{int(time.time()*1000)}"
        payload = {"cmd": cmd, "args": args, "reqId": req_id}
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
            self.log(f"cmd error {cmd}: {e}")
            return None

    def get_state(self):
        resp = self.send_cmd("get-state")
        if resp and resp.get("ok"):
            return resp.get("data", {})
        return None

    def create_room(self, variant_id):
        short_name = variant_id[:8] if len(variant_id) > 8 else variant_id
        resp = self.send_cmd("create-room", {
            "name": short_name,
            "variant": variant_id,
            "maxPlayers": 6,
            "playerName": self.name,
        })
        if resp and resp.get("ok"):
            self.room_id = resp.get("data", {}).get("roomId")
        return resp

    def join_room(self, room_id):
        resp = self.send_cmd("join-room", {"roomId": room_id, "name": self.name})
        if resp and resp.get("ok"):
            self.room_id = room_id
        return resp

    def ready(self):
        return self.send_cmd("ready", {"ready": True})

    def start_game(self):
        return self.send_cmd("start-game")

    def handle_busted_and_ready(self, state_data):
        if not state_data:
            return
        my_role = None
        my_ready = False
        for p in state_data.get("players", []):
            if p.get("id") == self.player_id or p.get("name") == self.name:
                my_role = p.get("playerRoomRole", "")
                my_ready = p.get("isReady", False)
                break
        if my_role == "busted":
            self.log("破产! 补筹码...")
            resp = self.send_cmd("get-chips")
            if resp and resp.get("ok"):
                time.sleep(0.1)
        if not my_ready:
            self.ready()

    def llm_decide_action(self, state_data, variant_name):
        phase = state_data.get("phase", "")
        valid_actions = state_data.get("validActions", [])
        my_cards = state_data.get("myCards", []) or state_data.get("playerCards", [])
        pot = state_data.get("totalPot", 0) or state_data.get("pot", 0)
        current_bet = state_data.get("currentBet", 0)

        card_str = " ".join([c.get("rank", "?") + c.get("suit", "?") for c in my_cards]) if my_cards else "none"
        community = state_data.get("communityCards", [])
        comm_str = " ".join([c.get("rank", "?") + c.get("suit", "?") for c in community]) if community else "none"

        if phase == "draw":
            prompt = f"""You are playing Five Card Draw. Your cards: [{card_str}]
Decide which cards to replace (by index 0-{len(my_cards)-1 if my_cards else 0}).
Reply ONLY in JSON: {{"indices": "0,2" or "none"}}"""
            resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=80)
            try:
                cleaned = resp_text.replace("```json", "").replace("```", "").strip()
                data = json.loads(cleaned)
                return "draw", data.get("indices", "none")
            except:
                return "draw", "none"

        if phase == "discard":
            ranks = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14}
            worst_idx = 0
            worst_val = 15
            for i, c in enumerate(my_cards):
                v = ranks.get(c.get("rank", "2"), 2)
                if v < worst_val:
                    worst_val = v
                    worst_idx = i
            return "discard", worst_idx

        prompt = f"""You are playing {variant_name} poker. Decide your action.
Phase: {phase}, Your cards: [{card_str}], Community: [{comm_str}], Pot: {pot}, Current bet: {current_bet}
Valid actions: {valid_actions}
Reply ONLY in JSON: {{"action": "fold|check|call|raise|all-in", "amount": 0}}"""

        resp_text = self.llm.chat([{"role": "user", "content": prompt}], temperature=0.5, max_tokens=150)
        try:
            cleaned = resp_text.replace("```json", "").replace("```", "").strip()
            data = json.loads(cleaned)
            action = data.get("action", "fold").lower().replace(" ", "")
            amount = data.get("amount", 0)
            if action in valid_actions:
                return action, amount
        except:
            pass
        for pref in ["check", "call", "fold"]:
            if pref in valid_actions:
                return pref, 0
        return valid_actions[0] if valid_actions else ("fold", 0)

    def play_turn(self, state_data, variant_name):
        action, amount = self.llm_decide_action(state_data, variant_name)

        if action == "draw":
            resp = self.send_cmd("draw", {"indices": str(amount)})
        elif action == "discard":
            resp = self.send_cmd("discard", {"cardIndex": int(amount)})
        elif action == "raise" and amount:
            resp = self.send_cmd("action", {"action": "raise", "amount": int(amount)})
        else:
            resp = self.send_cmd("action", {"action": action})

        if resp and resp.get("ok"):
            self.log(f"{action}{' ' + str(amount) if amount else ''} -> ok")
        else:
            err = resp.get("error", "?") if resp else "no resp"
            self.log(f"{action} failed: {err}")
        return True

    def disconnect(self):
        try:
            self.sio.disconnect()
        except:
            pass


def test_variant(variant_id, variant_name, num_players):
    print(f"\n{'='*60}")
    print(f"  测试: {variant_name} ({variant_id}) | {num_players}人")
    print(f"{'='*60}")

    players = []
    for i in range(num_players):
        p = TestPlayer(f"Bot{i+1}_{variant_id[:5]}", i, variant_id)
        players.append(p)

    try:
        print(f"  连接中...")
        for p in players:
            if p.connect():
                print(f"  {p.name} OK (ID: {p.player_id[:15]}...)")
            else:
                print(f"  [FAIL] {p.name} 连接失败")
                return False
            time.sleep(0.2)

        host = players[0]
        resp = host.create_room(variant_id)
        if not resp or not resp.get("ok"):
            err = resp.get("error", resp) if resp else "no response"
            print(f"  [FAIL] create-room: {err}")
            return False
        room_id = host.room_id
        print(f"  房间: {room_id}")

        for p in players[1:]:
            resp = p.join_room(room_id)
            if not resp or not resp.get("ok"):
                err = resp.get("error", resp) if resp else "no response"
                print(f"  [FAIL] {p.name} join: {err}")
                return False
            time.sleep(0.2)

        for p in players:
            p.ready()
        time.sleep(0.2)

        resp = host.start_game()
        if not resp or not resp.get("ok"):
            err = resp.get("error", resp) if resp else "no response"
            print(f"  [FAIL] start-game: {err}")
            return False
        print(f"  游戏开始！")

        hand_complete = False
        last_progress_time = time.time()

        for loop in range(2000):
            any_progress = False

            for p in players:
                state_data = p.get_state()
                if not state_data:
                    continue

                phase = state_data.get("phase")
                is_my_turn = state_data.get("isMyTurn")

                if phase in ("waiting", None):
                    p.handle_busted_and_ready(state_data)
                    continue

                if phase in ("ended", "showdown"):
                    winners = state_data.get("lastShowdownResult", {}).get("winners", [])
                    if winners:
                        w_info = [f"{w.get('playerName','?')}({w.get('winAmount',0)})" for w in winners]
                        print(f"  PASS 局结束! 赢家: {', '.join(w_info)}")
                    else:
                        print(f"  PASS 局结束(无showdown)")
                    hand_complete = True
                    any_progress = True
                    break

                if phase == "run-it-twice-choice":
                    my_status = None
                    for pp in state_data.get("players", []):
                        if pp.get("id") == p.player_id or pp.get("name") == p.name:
                            my_status = pp.get("status")
                            break
                    if my_status and my_status != "folded":
                        p.send_cmd("run-it-twice-choice", {"choice": "twice"})
                    any_progress = True
                    continue

                if phase == "run-it-twice-dice":
                    my_status = None
                    for pp in state_data.get("players", []):
                        if pp.get("id") == p.player_id or pp.get("name") == p.name:
                            my_status = pp.get("status")
                            break
                    if my_status and my_status != "folded":
                        p.send_cmd("roll-dice")
                    any_progress = True
                    continue

                if phase == "run-it-twice-executing":
                    continue

                if is_my_turn:
                    p.play_turn(state_data, variant_name)
                    any_progress = True

            if hand_complete:
                break

            if any_progress:
                last_progress_time = time.time()

            if time.time() - last_progress_time > 120:
                print(f"  [FAIL] 2分钟无进展!")
                for p in players:
                    sd = p.get_state()
                    if sd:
                        print(f"    [{p.name}] phase={sd.get('phase')}, isMyTurn={sd.get('isMyTurn')}")
                return False

            time.sleep(0.1)

        if not hand_complete:
            print(f"  [FAIL] 超时!")
            return False

        return True

    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        import traceback
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test_error.log"), "a", encoding="utf-8") as f:
            f.write(f"\n[{variant_id}] Exception: {e}\n")
            traceback.print_exc(file=f)
        return False
    finally:
        for p in players:
            p.disconnect()
        time.sleep(0.3)


def main():
    print("=" * 60)
    print("  LLM驱动的玩法自动化测试")
    print(f"  Server: {SERVER_URL}")
    print(f"  LLM: {LLM_MODEL} @ {LLM_BASE_URL}")
    print(f"  API Key: {'***' + LLM_API_KEY[-4:] if len(LLM_API_KEY) > 4 else '(not set)'}")
    print("=" * 60)

    if not LLM_API_KEY:
        print("\n  ERROR: LLM_API_KEY 未设置！请在 llm_config.json 中配置")
        return False

    results = {}
    for variant_id, variant_name, num_players in VARIANTS_TO_TEST:
        ok = test_variant(variant_id, variant_name, num_players)
        results[variant_id] = ok
        time.sleep(0.5)

    print(f"\n{'='*60}")
    print("  测试结果汇总")
    print(f"{'='*60}")
    passed = 0
    failed_list = []
    for variant_id, variant_name, _ in VARIANTS_TO_TEST:
        ok = results.get(variant_id, False)
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed_list.append(variant_name)
        print(f"  {status}  {variant_name} ({variant_id})")

    total = len(VARIANTS_TO_TEST)
    print(f"\n  通过: {passed}/{total}")
    if failed_list:
        print(f"  失败: {', '.join(failed_list)}")
    return len(failed_list) == 0


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
