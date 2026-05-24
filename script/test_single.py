"""快速测试单个玩法 - 使用正确事件名"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

variant_id = sys.argv[1] if len(sys.argv) > 1 else "texas_nlhe"
num_players = int(sys.argv[2]) if len(sys.argv) > 2 else 2

print(f"Testing: {variant_id} with {num_players} players")

players_data = []
sio_list = []

for i in range(num_players):
    sio = socketio.Client()
    players_data.append({"name": f"P{i+1}", "sio": sio, "pid": None, "rid": None})
    sio_list.append(sio)

def send_cmd(sio, cmd, args=None, timeout=10):
    args = args or {}
    req_id = f"q_{int(time.time()*1000)}"
    payload = {"cmd": cmd, "args": args, "reqId": req_id}
    result = {"response": None}
    def on_response(data):
        result["response"] = data
    sio.emit("ai:cmd", payload, namespace=AI_NAMESPACE, callback=on_response)
    deadline = time.time() + timeout
    while result["response"] is None and time.time() < deadline:
        sio.sleep(0.05)
    return result["response"]

try:
    for p in players_data:
        print(f"  Connecting {p['name']}...")
        p["sio"].connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=10)
        time.sleep(0.3)
        r = send_cmd(p["sio"], "connect", {"name": p["name"]})
        print(f"  {p['name']} connect: ok={r.get('ok') if r else 'None'}")
        if r and r.get("ok"):
            p["pid"] = r["data"]["playerId"]
        else:
            print(f"  FAIL connect: {r}")
            sys.exit(1)

    host = players_data[0]
    r = send_cmd(host["sio"], "create-room", {"roomName": f"test_{variant_id}", "variant": variant_id, "maxPlayers": 6})
    print(f"  create-room: ok={r.get('ok') if r else 'None'}")
    if not r or not r.get("ok"):
        print(f"  FAIL create-room: {r}")
        sys.exit(1)
    host["rid"] = r["data"]["roomId"]

    for p in players_data[1:]:
        r = send_cmd(p["sio"], "join-room", {"roomId": host["rid"]})
        print(f"  {p['name']} join: ok={r.get('ok') if r else 'None'}")
        p["rid"] = host["rid"]

    for p in players_data:
        send_cmd(p["sio"], "ready", {"ready": True})

    r = send_cmd(host["sio"], "start-game")
    print(f"  start-game: ok={r.get('ok') if r else 'None'}")
    if not r or not r.get("ok"):
        print(f"  FAIL start-game: {r}")
        sys.exit(1)

    print(f"  Game started! Playing...")

    loop = 0
    while loop < 300:
        loop += 1
        for p in players_data:
            r = send_cmd(p["sio"], "get-state")
            if not r or not r.get("ok"):
                continue
            state = r.get("data", {}).get("state", {})
            phase = state.get("phase", "")
            current_id = state.get("currentPlayerId", "")
            valid = state.get("validActions", [])

            if phase == "ended" or state.get("lastShowdownResult"):
                winners = state.get("lastShowdownResult", {}).get("winners", [])
                if winners:
                    for w in winners:
                        print(f"    Winner: {w.get('playerName','?')} amount={w.get('winAmount',0)}")
                print(f"  PASS! (phase={phase}, loops={loop})")
                sys.exit(0)

            if current_id == p["pid"] and valid:
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
                r2 = send_cmd(p["sio"], action_cmd, action_args)
                if r2:
                    print(f"    {p['name']} {action_cmd} -> ok={r2.get('ok')}")
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