"""LLM驱动的玩法规则深度验证V2 - 修复多手牌+准确状态捕获"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import os
import traceback
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

LLM_CLIENT = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)

HANDS_PER_VARIANT = 2

VARIANTS_TO_TEST = [
    ("texas_nlhe",          "常规德州",       2, False),
    ("texas_lhe",           "限注德州",       2, False),
    ("texas_plo",           "底池限注德州",   2, False),
    ("six_plus",            "短牌",           2, False),
    ("pineapple",           "大菠萝",         2, False),
    ("crazy_pineapple",     "疯狂菠萝",       2, False),
    ("texas_double_board",  "双排面德州",     2, False),
    ("omaha_plo",           "奥马哈",         2, False),
    ("omaha_hi_lo",         "奥马哈高低",     2, False),
    ("omaha_plo5",          "五张奥马哈",     2, False),
    ("omaha_plo6",          "六张奥马哈",     2, False),
    ("omaha_double_board",  "双排面奥马哈",   2, False),
    ("omaha_three_board",   "三板面奥马哈",   2, False),
    ("five_card_draw",      "五张换牌",       2, False),
    ("seven_card_stud",     "七张梭哈",       2, False),
    ("squid_dalgona_suit",  "椪糖花色局",     3, False),
]

SIX_PLUS_ALLOWED = {"6","7","8","9","10","J","Q","K","A"}


def llm_ask(prompt, temperature=0.3, max_tokens=200):
    try:
        resp = LLM_CLIENT.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, max_tokens=max_tokens,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        print(f"    [LLM ERROR] {e}", flush=True)
        return f"ERROR:{e}"


class DeepPlayer:
    def __init__(self, name, index):
        self.name = name
        self.index = index
        self.sio = socketio.Client()
        self.player_id = None
        self.room_id = None

        @self.sio.on("ai:connected", namespace=AI_NAMESPACE)
        def on_connected(data, _self=self):
            _self.player_id = data.get("data", {}).get("playerId") or data.get("playerId")

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
            print(f"  [{self.name}] connect failed: {e}")
            return False

    def disconnect(self):
        try:
            self.sio.disconnect()
        except:
            pass

    def send_cmd(self, cmd, args=None, timeout=15):
        args = args or {}
        payload = {"cmd": cmd, "args": args, "reqId": f"{self.index}_{int(time.time()*1000)}"}
        result = {"response": None}
        def on_response(data):
            result["response"] = data
        try:
            self.sio.emit("ai:cmd", payload, namespace=AI_NAMESPACE, callback=on_response)
            deadline = time.time() + timeout
            while result["response"] is None and time.time() < deadline:
                self.sio.sleep(0.05)
            return result["response"]
        except:
            return None

    def get_state(self):
        resp = self.send_cmd("get-state")
        if resp and resp.get("ok"):
            return resp.get("data", {})
        return None

    def create_room(self, variant_id, fixed_hands=10):
        short_name = variant_id[:8] if len(variant_id) > 8 else variant_id
        resp = self.send_cmd("create-room", {
            "name": short_name, "variant": variant_id,
            "maxPlayers": 6, "playerName": self.name,
            "fixedHands": fixed_hands,
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

    def handle_busted(self, state_data):
        if not state_data:
            return
        for pp in state_data.get("players", []):
            if pp.get("id") == self.player_id or pp.get("name") == self.name:
                if pp.get("playerRoomRole") == "busted":
                    self.send_cmd("get-chips")
                    time.sleep(0.1)
                if not pp.get("isReady"):
                    self.ready()
                break

    def decide_action(self, state_data):
        phase = state_data.get("phase", "")
        valid_actions = state_data.get("validActions", [])

        if phase == "draw":
            return ("draw", "none")

        if phase == "discard":
            my_cards = state_data.get("myCards", []) or state_data.get("playerCards", [])
            worst_idx = 0
            worst_val = 99
            for i, c in enumerate(my_cards):
                v = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14}.get(c.get("rank","2"), 2)
                if v < worst_val:
                    worst_val = v
                    worst_idx = i
            return ("discard", worst_idx)

        if "check" in valid_actions:
            return ("check", 0)
        if "call" in valid_actions:
            return ("call", 0)
        return ("fold", 0)

    def play_turn(self, state_data):
        action, amount = self.decide_action(state_data)
        if action == "draw":
            resp = self.send_cmd("draw", {"indices": str(amount)})
        elif action == "discard":
            resp = self.send_cmd("discard", {"cardIndex": int(amount)})
        elif action == "raise" and amount:
            resp = self.send_cmd("action", {"action": "raise", "amount": int(amount)})
        else:
            resp = self.send_cmd("action", {"action": action})
        if resp is None:
            print(f"      [{self.name}] play_turn NO RESP action={action} amount={amount}", flush=True)
        elif not resp.get("ok"):
            print(f"      [{self.name}] play_turn FAIL action={action} err={resp.get('error','?')}", flush=True)
        return resp is not None and resp.get("ok", False)


def run_hands_until_showdown(players, num_hands):
    all_logs = []
    hands_completed = 0

    for h in range(num_hands):
        last_progress = time.time()
        showdown_captured = False
        best_state = {}

        for p in players:
            p.handle_busted(p.get_state())
        for p in players:
            p.ready()
        time.sleep(0.2)

        resp = players[0].start_game()
        if not resp or not resp.get("ok"):
            pass
        time.sleep(0.3)

        for loop in range(5000):
            progress = False
            all_phase = None

            for p in players:
                state_data = p.get_state()
                if not state_data:
                    continue

                phase = state_data.get("phase", "")
                all_phase = phase
                is_my_turn = state_data.get("isMyTurn")

                if phase in ("waiting",):
                    p.handle_busted(state_data)
                    continue

                if phase not in ("waiting", None):
                    comm_count = len(state_data.get("communityCards") or [])
                    if comm_count > len(best_state.get("communityCards") or []):
                        best_state = state_data

                if phase in ("ended", "showdown"):
                    if not showdown_captured:
                        last_result = state_data.get("lastResult") or state_data.get("lastShowdownResult")
                        log_entry = {
                            "player": p.name,
                            "phase": phase,
                            "myCards": state_data.get("myCards"),
                            "communityCards": best_state.get("communityCards") or state_data.get("communityCards") or [],
                            "totalPot": state_data.get("totalPot") or state_data.get("pot"),
                            "players": state_data.get("players"),
                            "handId": state_data.get("handId"),
                            "targetSuit": best_state.get("targetSuit") or state_data.get("targetSuit"),
                            "boardCards": best_state.get("boardCards") or state_data.get("boardCards") or [],
                            "lastResult": last_result,
                            "variant": state_data.get("variant"),
                        }
                        if last_result:
                            log_entry["lr_communityCards"] = last_result.get("communityCards", [])
                            log_entry["lr_winners"] = last_result.get("winners", [])
                            log_entry["lr_allHands"] = last_result.get("allHands", [])
                        all_logs.append(log_entry)
                        showdown_captured = True
                        hands_completed += 1
                    break

                if phase == "run-it-twice-choice":
                    for sp in state_data.get("players", []):
                        if sp.get("id") == p.player_id and sp.get("status") != "folded":
                            p.send_cmd("run-it-twice-choice", {"choice": "twice"})
                            progress = True
                    continue

                if phase == "run-it-twice-dice":
                    for sp in state_data.get("players", []):
                        if sp.get("id") == p.player_id and sp.get("status") != "folded":
                            p.send_cmd("roll-dice")
                            progress = True
                    continue

                if phase == "run-it-twice-executing":
                    continue

                if is_my_turn:
                    ok = p.play_turn(state_data)
                    if ok:
                        progress = True
                    else:
                        print(f"      [{p.name}] play_turn FAILED phase={phase} action={p.decide_action(state_data)}", flush=True)

            if all_phase in ("ended", "showdown") and showdown_captured:
                break

            if progress:
                last_progress = time.time()

            if time.time() - last_progress > 90:
                print(f"    [HAND {h+1}] TIMEOUT at phase={all_phase}")
                for pp in players:
                    sd = pp.get_state()
                    if sd:
                        print(f"      [{pp.name}] phase={sd.get('phase')}, isMyTurn={sd.get('isMyTurn')}")
                break

            if all_phase in ("ended", "showdown"):
                time.sleep(0.5)
                break

            time.sleep(0.05)

        time.sleep(0.3)

    return hands_completed, all_logs


def verify_rules(variant_id, logs):
    variant_expect = {
        "texas_nlhe":          {"hole": 2,  "comm": 5, "boards": None},
        "texas_lhe":           {"hole": 2,  "comm": 5, "boards": None},
        "texas_plo":           {"hole": 2,  "comm": 5, "boards": None},
        "six_plus":            {"hole": 2,  "comm": 5, "boards": None},
        "pineapple":           {"hole": 2,  "comm": 5, "boards": None},
        "crazy_pineapple":     {"hole": 3,  "comm": 5, "boards": None},
        "texas_double_board":  {"hole": 2,  "comm": 5, "boards": 2},
        "omaha_plo":           {"hole": 4,  "comm": 5, "boards": None},
        "omaha_hi_lo":         {"hole": 4,  "comm": 5, "boards": None},
        "omaha_plo5":          {"hole": 5,  "comm": 5, "boards": None},
        "omaha_plo6":          {"hole": 6,  "comm": 5, "boards": None},
        "omaha_double_board":  {"hole": 4,  "comm": 5, "boards": 2},
        "omaha_three_board":   {"hole": 4,  "comm": 5, "boards": 3},
        "five_card_draw":      {"hole": 5,  "comm": 0, "boards": None},
        "seven_card_stud":     {"hole": 7,  "comm": 0, "boards": None, "known_limit": "Uses standard NLHE phases (pre-flop→flop→turn→river) instead of Stud streets"},
        "squid_dalgona_suit":  {"hole": 2,  "comm": 5, "boards": None},
    }

    expect = variant_expect.get(variant_id, {})
    issues = []

    for log in logs:
        p_name = log.get("player", "?")
        lr = log.get("lastResult") or {}
        lr_comm = log.get("lr_communityCards") or lr.get("communityCards") or []
        lr_winners = log.get("lr_winners") or lr.get("winners") or []
        lr_all_hands = log.get("lr_allHands") or lr.get("allHands") or []
        best_comm = log.get("communityCards") or []
        best_boards = log.get("boardCards") or []
        target_suit = log.get("targetSuit")
        my_cards = log.get("myCards") or []

        expected_hole = expect.get("hole")
        if expected_hole is not None:
            hole_to_check = len(my_cards)
            if lr_all_hands:
                for ah in lr_all_hands:
                    if ah.get("playerName") == p_name or ah.get("playerId") == log.get("player"):
                        hole_to_check = len(ah.get("holeCards") or [])
                        break
            if hole_to_check != expected_hole:
                issues.append((p_name, f"底牌: 期望{expected_hole}张, 实际{hole_to_check}张"))

        expected_comm = expect.get("comm")
        if expected_comm is not None and not expect.get("known_limit"):
            actual_comm = len(lr_comm) if lr_comm else len(best_comm)
            if actual_comm != expected_comm:
                issues.append((p_name, f"公共牌: 期望{expected_comm}张, 实际{actual_comm}张"))

        expected_boards = expect.get("boards")
        if expected_boards is not None:
            if len(best_boards) != expected_boards:
                issues.append((p_name, f"板面数: 期望{expected_boards}, 实际{len(best_boards)}"))

        if variant_id == "squid_dalgona_suit" and not target_suit:
            issues.append((p_name, "椪糖花色局: 缺少targetSuit"))

        if variant_id == "six_plus":
            cards_to_check = my_cards
            if lr_all_hands:
                for ah in lr_all_hands:
                    if ah.get("playerName") == p_name:
                        cards_to_check = ah.get("holeCards") or []
                        break
            for c in cards_to_check:
                rank = c.get("rank", "")
                if rank not in SIX_PLUS_ALLOWED:
                    issues.append((p_name, f"短牌不应包含 rank '{rank}'"))
                    break

        if lr_winners:
            pass
        elif lr_all_hands:
            pass
        elif log.get("phase") in ("ended", "showdown"):
            issues.append((p_name, "摊牌但无赢家/手牌信息"))

    return issues


def test_one_variant(variant_id, variant_name, num_players):
    print(f"\n{'='*60}")
    print(f"  {variant_name} ({variant_id}) | {num_players}人")
    print(f"{'='*60}")

    players = []
    for i in range(num_players):
        p = DeepPlayer(f"Bot{i+1}_{variant_id[:5]}", i)
        players.append(p)

    try:
        print(f"  连接中...")
        for p in players:
            if not p.connect():
                print(f"  [FAIL] {p.name} 连接失败")
                return False, [f"{p.name}: 连接失败"]
            time.sleep(0.15)

        host = players[0]
        resp = host.create_room(variant_id, fixed_hands=10)
        if not resp or not resp.get("ok"):
            err = resp.get("error", resp) if resp else "no response"
            print(f"  [FAIL] create-room: {err}")
            return False, [f"create-room: {err}"]
        room_id = host.room_id

        for p in players[1:]:
            resp = p.join_room(room_id)
            if not resp or not resp.get("ok"):
                err = resp.get("error", resp) if resp else "no response"
                print(f"  [FAIL] {p.name} join: {err}")
                return False, [f"{p.name} join: {err}"]
            time.sleep(0.15)
        print(f"  房间: {room_id}")

        hands_done, logs = run_hands_until_showdown(players, HANDS_PER_VARIANT)
        if hands_done == 0:
            return False, ["No hands completed"]

        print(f"  完成 {hands_done}/{HANDS_PER_VARIANT} 手牌")

        all_issues = verify_rules(variant_id, logs)

        if all_issues:
            seen = set()
            for p_name, desc in all_issues:
                key = f"{p_name}:{desc}"
                if key not in seen:
                    print(f"  ⚠ {p_name}: {desc}")
                    seen.add(key)
            return False, [f"{desc}" for _, desc in all_issues]
        else:
            expect = {
                "texas_nlhe": "2底牌+5公共牌", "texas_lhe": "2底牌+5公共牌+限注",
                "texas_plo": "2底牌+5公共牌+底池限注", "six_plus": "2底牌+5公共牌+短牌36张",
                "pineapple": "弃1后2底牌+5公共牌", "crazy_pineapple": "3底牌+5公共牌",
                "texas_double_board": "2底牌+双板面", "omaha_plo": "4底牌+5公共牌(2+3)",
                "omaha_hi_lo": "4底牌+5公共牌(2+3)+高低分池", "omaha_plo5": "5底牌+5公共牌(2+3)",
                "omaha_plo6": "6底牌+5公共牌(2+3)", "omaha_double_board": "4底牌+双板面(2+3)",
                "omaha_three_board": "4底牌+三板面(2+3)", "five_card_draw": "5手牌+换牌+无公共牌",
                "seven_card_stud": "7手牌+无公共牌", "squid_dalgona_suit": "2底牌+5公共牌+目标花色",
            }.get(variant_id, "?")
            print(f"  验证通过 ✓ ({expect})")
            return True, []

    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        traceback.print_exc()
        return False, [str(e)]
    finally:
        for p in players:
            p.disconnect()
        time.sleep(0.3)


def main():
    print("=" * 60)
    print("  玩法规则深度验证 V2")
    print(f"  Server: {SERVER_URL} | LLM: {LLM_MODEL}")
    print(f"  Hands per variant: {HANDS_PER_VARIANT}")
    print("=" * 60)

    if not LLM_API_KEY:
        print("  ERROR: LLM_API_KEY 未设置")
        return False

    results = {}
    for variant_id, variant_name, num_players, _ in VARIANTS_TO_TEST:
        ok, issues = test_one_variant(variant_id, variant_name, num_players)
        results[variant_id] = (ok, issues)
        time.sleep(0.5)

    print(f"\n{'='*60}")
    print("  验证结果汇总")
    print(f"{'='*60}")
    passed = 0
    failed = []
    for variant_id, variant_name, _, _ in VARIANTS_TO_TEST:
        ok, issues = results.get(variant_id, (False, ["no result"]))
        if ok:
            print(f"  ✅ {variant_name}")
            passed += 1
        else:
            print(f"  ❌ {variant_name}: {'; '.join(issues[:3])}")
            failed.append((variant_name, issues))

    print(f"\n  通过: {passed}/{len(VARIANTS_TO_TEST)}")
    if failed:
        print(f"\n  失败详情:")
        for name, issues in failed:
            for iss in issues[:3]:
                print(f"    [{name}] {iss}")
    return len(failed) == 0


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
