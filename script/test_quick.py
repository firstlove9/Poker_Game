"""快速测试单个玩法"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json

SERVER_URL = "http://localhost:3000"

variant_id = sys.argv[1] if len(sys.argv) > 1 else "texas_nlhe"
variant_name = sys.argv[2] if len(sys.argv) > 2 else variant_id
num_players = int(sys.argv[3]) if len(sys.argv) > 3 else 2

print(f"Testing: {variant_name} ({variant_id}) with {num_players} players")

players = []
sio_list = []

for i in range(num_players):
    sio = socketio.Client()
    players.append({"name": f"P{i+1}", "sio": sio, "player_id": None, "room_id": None})
    sio_list.append(sio)

try:
    for p in players:
        print(f"  Connecting {p['name']}...")
        p["sio"].connect(SERVER_URL, namespaces=["/ai"], wait_timeout=10)
        time.sleep(0.2)
        r = p["sio"].call("command", {"cmd": "connect", "args": {"name": p["name"]}}, namespace="/ai", timeout=10)
        print(f"  connect result: {r}")
        if r and r.get("ok"):
            p["player_id"] = r["data"]["playerId"]
        else:
            print(f"  FAIL connect")
            sys.exit(1)

    host = players[0]
    r = host["sio"].call("command", {"cmd": "create-room", "args": {"roomName": f"test_{variant_id}", "variant": variant_id, "maxPlayers": 6}}, namespace="/ai", timeout=10)
    print(f"  create-room result: {r}")
    if not r or not r.get("ok"):
        print(f"  FAIL create-room")
        sys.exit(1)
    host["room_id"] = r["data"]["roomId"]

    for p in players[1:]:
        r = p["sio"].call("command", {"cmd": "join-room", "args": {"roomId": host["room_id"]}}, namespace="/ai", timeout=10)
        print(f"  {p['name']} join: {r}")
        p["room_id"] = host["room_id"]

    for p in players:
        p["sio"].call("command", {"cmd": "ready", "args": {"ready": True}}, namespace="/ai", timeout=10)

    r = host["sio"].call("command", {"cmd": "start-game", "args": {}}, namespace="/ai", timeout=10)
    print(f"  start-game result: {r}")

    loop = 0
    while loop < 300:
        loop += 1
        for p in players:
            sio = p["sio"]
            try:
                r = sio.call("command", {"cmd": "get-state", "args": {}}, namespace="/ai", timeout=10)
            except:
                continue
            if not r or not r.get("ok"):
                continue
            state = r.get("data", {}).get("state", {})
            phase = state.get("phase", "")
            current_id = state.get("currentPlayerId", "")
            valid = state.get("validActions", [])

            if phase == "ended" or state.get("lastShowdownResult"):
                winners = state.get("lastShowdownResult", {}).get("winners", [])
                if winners:
                    print(f"  PASS! Winners: {winners}")
                else:
                    print(f"  PASS (ended, no showdown)")
                sys.exit(0)

            if current_id == p["player_id"] and valid:
                if phase == "draw":
                    action_cmd = "draw"
                    action_args = {"indices": "none"}
                elif phase == "discard":
                    action_cmd = "action"
                    action_args = {"action": "discard", "cardIndex": 0}
                elif "check" in valid:
                    action_cmd = "action"
                    action_args = {"action": "check"}
                elif "call" in valid:
                    action_cmd = "action"
                    action_args = {"action": "call"}
                elif "fold" in valid:
                    action_cmd = "action"
                    action_args = {"action": "fold"}
                elif "all-in" in valid:
                    action_cmd = "action"
                    action_args = {"action": "all-in"}
                else:
                    continue
                try:
                    r2 = sio.call("command", {"cmd": action_cmd, "args": action_args}, namespace="/ai", timeout=10)
                    print(f"    {p['name']} {action_cmd} {action_args} -> {r2.get('ok') if r2 else 'None'}")
                except Exception as e2:
                    print(f"    {p['name']} action error: {e2}")
        time.sleep(0.1)

    print(f"  FAIL: timeout after {loop} loops")

except Exception as e:
    print(f"  Exception: {e}")
    import traceback
    traceback.print_exc()
finally:
    for sio in sio_list:
        try:
            sio.disconnect()
        except:
            pass
