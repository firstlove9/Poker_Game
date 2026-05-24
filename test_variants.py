"""自动测试每种玩法的1局游戏，验证流程正确性"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json

SERVER_URL = "http://localhost:3000"

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


class SimpleAI:
    def __init__(self, name, sio):
        self.name = name
        self.sio = sio
        self.player_id = None
        self.room_id = None

    def send_cmd(self, cmd, args=None):
        args = args or {}
        try:
            result = self.sio.call("command", {"cmd": cmd, "args": args}, namespace="/ai", timeout=15)
            return result
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

    def play_turn_auto(self, state):
        if not state:
            return "error"
        phase = state.get("phase", "")
        current_id = state.get("currentPlayerId", "")

        if current_id != self.player_id:
            return "not_my_turn"

        players = state.get("players", [])
        for p in players:
            if p.get("id") == self.player_id:
                if p.get("status") != "playing":
                    return f"status={p.get('status')}"

        valid_actions = state.get("validActions", [])
        if not valid_actions:
            return "no_actions"

        if phase == "discard":
            r = self.send_cmd("action", {"action": "discard", "cardIndex": 0})
            return "discard"

        if phase == "draw":
            r = self.send_cmd("draw", {"indices": "0,1"})
            return "draw"

        if "run-it-twice-choice" in phase:
            r = self.send_cmd("run-it-twice-choice", {"choice": "twice"})
            return "rit_twice"

        if "call" in valid_actions:
            self.send_cmd("action", {"action": "call"})
            return "call"
        if "check" in valid_actions:
            self.send_cmd("action", {"action": "check"})
            return "check"
        if "fold" in valid_actions:
            self.send_cmd("action", {"action": "fold"})
            return "fold"
        if "all-in" in valid_actions:
            self.send_cmd("action", {"action": "all-in"})
            return "all-in"

        return "no_valid_action"


def test_variant(variant_id, variant_name, num_players):
    print(f"\n{'='*60}")
    print(f"  测试: {variant_name} ({variant_id}) | {num_players}人")
    print(f"{'='*60}")

    players = []
    sio_list = []

    for i in range(num_players):
        sio = socketio.Client()
        ai = SimpleAI(f"P{i+1}", sio)
        players.append(ai)
        sio_list.append(sio)

    try:
        for i, (ai, sio) in enumerate(zip(players, sio_list)):
            sio.connect(SERVER_URL, namespaces=["/ai"], wait_timeout=10)
            time.sleep(0.2)
            r = sio.call("command", {"cmd": "connect", "args": {"name": ai.name}}, namespace="/ai", timeout=10)
            if r and r.get("ok"):
                ai.player_id = r["data"]["playerId"]
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
        print(f"  房间: {host.room_id}")

        for ai in players[1:]:
            r = ai.send_cmd("join-room", {"roomId": host.room_id})
            if not r or not r.get("ok"):
                print(f"  [FAIL] {ai.name} join: {r}")
                return False
            ai.room_id = host.room_id

        for ai in players:
            ai.send_cmd("ready", {"ready": True})

        r = host.send_cmd("start-game")
        if not r or not r.get("ok"):
            err = r.get("error", r) if r else "no response"
            print(f"  [FAIL] start-game: {err}")
            return False

        print(f"  游戏开始！")

        hand_complete = False
        loop_count = 0
        max_loops = 300
        last_phase = ""

        while loop_count < max_loops:
            loop_count += 1

            state = None
            for ai in players:
                sd = ai.get_state()
                if sd:
                    state = sd
                    ai.handle_busted_and_ready(sd)

            if not state:
                time.sleep(0.5)
                continue

            phase = state.get("phase", "")
            if phase != last_phase:
                last_phase = phase

            if phase == "ended" or (phase in ("waiting", None) and state.get("lastShowdownResult")):
                winners = state.get("lastShowdownResult", {}).get("winners", [])
                if winners:
                    w_names = [w.get("playerName", w.get("playerId", "?")) for w in winners]
                    w_amounts = [w.get("winAmount", 0) for w in winners]
                    print(f"  PASS 局结束! 赢家: {', '.join(w_names)} (金额: {w_amounts})")
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
                    ai.play_turn_auto(state)
                    break

            time.sleep(0.15)

        if not hand_complete:
            print(f"  [FAIL] 超时! phase={last_phase}, loops={loop_count}")
            return False

        return True

    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        import traceback
        traceback.print_exc()
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
    print("  玩法自动化测试")
    print(f"  Server: {SERVER_URL}")
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
