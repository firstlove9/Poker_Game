"""LLM驱动的多玩法自动测试 - 使用正确的ai:cmd事件"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import os
from openai import OpenAI

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "llm_config.json")
def _load_llm_config():
    if os.path.exists(_CONFIG_FILE):
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

_llm_cfg = _load_llm_config()

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", _llm_cfg.get("LLM_BASE_URL", "https://api.openai.com/v1"))
LLM_MODEL = os.environ.get("LLM_MODEL", _llm_cfg.get("LLM_MODEL", "gpt-4o-mini"))
LLM_API_KEY = os.environ.get("LLM_API_KEY", _llm_cfg.get("LLM_API_KEY", ""))

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


def llm_decide(prompt):
    try:
        resp = llm_client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=200,
        )
        text = resp.choices[0].message.content.strip()
        return text
    except Exception as e:
        print(f"    LLM error: {e}")
        return None


def parse_llm_json(text):
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except:
        idx = text.find("{")
        if idx >= 0:
            try:
                return json.loads(text[idx:])
            except:
                pass
    return None


class LLMAI:
    def __init__(self, name, sio):
        self.name = name
        self.sio = sio
        self.player_id = None
        self.room_id = None

    def send_cmd(self, cmd, args=None, timeout=10):
        args = args or {}
        req_id = f"{self.name}_{int(time.time()*1000)}"
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
            print(f"    [{self.name}] cmd error {cmd}: {e}")
            return None

    def get_state(self):
        r = self.send_cmd("get-state")
        if r and r.get("ok"):
            return r.get("data", {}).get("state")
        return None

    def handle_busted_and_ready(self, state):
        if not state:
            return
        players = state.get("players", [])
        for p in players:
            if p.get("id") == self.player_id:
                role = p.get("playerRoomRole", "")
                if role == "busted":
                    print(f"    [{self.name}] 破产！补筹码...")
                    r = self.send_cmd("get-chips")
                    if r and r.get("ok"):
                        time.sleep(0.3)
                        self.send_cmd("ready", {"ready": True})
                elif role in ("seated", "active") and not p.get("isReady"):
                    self.send_cmd("ready", {"ready": True})

    def llm_decide_action(self, state, variant_name):
        phase = state.get("phase", "")
        valid = state.get("validActions", [])
        cards = state.get("playerCards", [])
        pot = state.get("totalPot", 0)
        current_bet = state.get("currentBet", 0)

        card_str = " ".join([c.get("rank", "?") + c.get("suit", "?") for c in cards]) if cards else "none"
        community = state.get("communityCards", [])
        comm_str = " ".join([c.get("rank", "?") + c.get("suit", "?") for c in community]) if community else "none"

        prompt = f"""You are playing {variant_name} poker. Decide your action.
Phase: {phase}, Your cards: [{card_str}], Community: [{comm_str}], Pot: {pot}, Current bet: {current_bet}
Valid actions: {valid}
Reply ONLY in JSON: {{"action": "fold|check|call|raise|all-in", "amount": 0}}"""

        text = llm_decide(prompt)
        data = parse_llm_json(text)
        if data and "action" in data:
            action = data["action"].lower().replace(" ", "")
            if action in valid:
                amount = data.get("amount", 0)
                return action, amount
        for pref in ["check", "call", "fold"]:
            if pref in valid:
                return pref, 0
        return valid[0] if valid else ("fold", 0)

    def play_turn(self, state, variant_name):
        if not state:
            return "error"
        phase = state.get("phase", "")
        current_id = state.get("currentPlayerId", "")
        if current_id != self.player_id:
            return "not_my_turn"

        players = state.get("players", [])
        for p in players:
            if p.get("id") == self.player_id and p.get("status") != "playing":
                return f"status={p.get('status')}"

        valid_actions = state.get("validActions", [])
        if not valid_actions:
            return "no_actions"

        if phase == "discard":
            cards = state.get("playerCards", [])
            if cards and len(cards) == 3:
                ranks = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14}
                worst_idx = 0
                worst_val = 15
                for i, c in enumerate(cards):
                    v = ranks.get(c.get("rank", "2"), 2)
                    if v < worst_val:
                        worst_val = v
                        worst_idx = i
                self.send_cmd("action", {"action": "discard", "cardIndex": worst_idx})
                return "discard"

        if phase == "draw":
            cards = state.get("playerCards", [])
            card_str = " ".join([c.get("rank", "?") + c.get("suit", "?") for c in cards]) if cards else "none"
            prompt = f"""You are playing Five Card Draw. Your cards: [{card_str}]
Decide which cards to replace (by index 0-{len(cards)-1 if cards else 0}).
Reply ONLY in JSON: {{"indices": "0,2" or "none"}}"""
            text = llm_decide(prompt)
            data = parse_llm_json(text)
            indices_str = "none"
            if data and "indices" in data:
                indices_str = str(data["indices"])
            self.send_cmd("draw", {"indices": indices_str})
            return f"draw({indices_str})"

        action, amount = self.llm_decide_action(state, variant_name)
        if action == "raise" and amount > 0:
            self.send_cmd("action", {"action": "raise", "amount": amount})
        else:
            self.send_cmd("action", {"action": action})
        return action


def test_variant(variant_id, variant_name, num_players):
    print(f"\n{'='*60}")
    print(f"  测试: {variant_name} ({variant_id}) | {num_players}人")
    print(f"{'='*60}")

    players = []
    sio_list = []

    for i in range(num_players):
        sio = socketio.Client()
        ai = LLMAI(f"P{i+1}", sio)
        players.append(ai)
        sio_list.append(sio)

    try:
        for i, (ai, sio) in enumerate(zip(players, sio_list)):
            sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=10)
            time.sleep(0.3)
            r = ai.send_cmd("connect", {"name": ai.name})
            if r and r.get("ok"):
                ai.player_id = r["data"]["playerId"]
                print(f"  {ai.name} 连接成功 (ID: {ai.player_id[:12]}...)")
            else:
                print(f"  [FAIL] {ai.name} connect: {r}")
                return False

        host = players[0]
        r = host.send_cmd("create-room", {"roomName": f"test_{variant_id}", "variant": variant_id, "maxPlayers": 6})
        if not r or not r.get("ok"):
            err = r.get("error", r) if r else "no response"
            print(f"  [FAIL] create-room: {err}")
            return False
        host.room_id = r["data"]["roomId"]
        print(f"  房间: {host.room_id[:8]}...")

        for ai in players[1:]:
            r = ai.send_cmd("join-room", {"roomId": host.room_id})
            if not r or not r.get("ok"):
                err = r.get("error", r) if r else "no response"
                print(f"  [FAIL] {ai.name} join: {err}")
                return False
            ai.room_id = host.room_id

        for ai in players:
            ai.send_cmd("ready", {"ready": True})
        time.sleep(0.2)

        r = host.send_cmd("start-game")
        if not r or not r.get("ok"):
            err = r.get("error", r) if r else "no response"
            print(f"  [FAIL] start-game: {err}")
            return False
        print(f"  游戏开始！")

        hand_complete = False
        loop_count = 0
        max_loops = 400
        last_phase = ""
        error_info = ""

        while loop_count < max_loops:
            loop_count += 1

            state = None
            for ai in players:
                sd = ai.get_state()
                if sd:
                    state = sd
                    ai.handle_busted_and_ready(sd)

            if not state:
                time.sleep(0.3)
                continue

            phase = state.get("phase", "")
            if phase != last_phase:
                print(f"    phase: {last_phase} -> {phase}")
                last_phase = phase

            if phase == "ended" or (phase in ("waiting", None) and state.get("lastShowdownResult")):
                winners = state.get("lastShowdownResult", {}).get("winners", [])
                if winners:
                    w_info = []
                    for w in winners:
                        w_info.append(f"{w.get('playerName','?')}({w.get('winAmount',0)})")
                    print(f"  PASS 局结束! 赢家: {', '.join(w_info)}")
                    hand_complete = True
                    break
                elif phase == "ended":
                    print(f"  PASS 局结束(无showdown)")
                    hand_complete = True
                    break

            if phase == "waiting":
                time.sleep(0.5)
                for ai in players:
                    sd2 = ai.get_state()
                    if sd2:
                        ai.handle_busted_and_ready(sd2)
                continue

            current_id = state.get("currentPlayerId", "")
            if not current_id:
                time.sleep(0.3)
                continue

            for ai in players:
                if ai.player_id == current_id:
                    try:
                        action = ai.play_turn(state, variant_name)
                    except Exception as e:
                        error_info = f"play_turn error for {ai.name}: {e}"
                        print(f"    [ERROR] {error_info}")
                    break

            time.sleep(0.15)

        if not hand_complete:
            print(f"  [FAIL] 超时! phase={last_phase}, loops={loop_count}")
            return False

        return True

    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        import traceback
        with open("test_error.log", "a", encoding="utf-8") as f:
            f.write(f"\n[{variant_id}] Exception: {e}\n")
            traceback.print_exc(file=f)
        return False
    finally:
        for sio in sio_list:
            try:
                sio.disconnect()
            except:
                pass
        time.sleep(0.3)


def main():
    print("=" * 60)
    print("  LLM驱动的玩法自动化测试")
    print(f"  Server: {SERVER_URL}")
    print(f"  LLM: {LLM_MODEL} @ {LLM_BASE_URL}")
    print("=" * 60)

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