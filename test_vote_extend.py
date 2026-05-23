import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import threading

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

req_counter = 0
lock = threading.Lock()


def next_req_id():
    global req_counter
    with lock:
        req_counter += 1
        return str(req_counter)


class AIPlayer:
    def __init__(self, name):
        self.name = name
        self.sio = socketio.Client()
        self.player_id = None
        self.room_id = None
        self.vote_extend_ended = threading.Event()
        self.vote_extend_approved = None
        self.new_fixed_hands = None

        @self.sio.on("ai:connected", namespace=AI_NAMESPACE)
        def on_connected(data):
            self.player_id = data.get("data", {}).get("playerId")
            print(f"  [{self.name}] Connected! ID: {self.player_id}")

        @self.sio.on("room:vote_extend_hands_started", namespace=AI_NAMESPACE)
        def on_vote_started(data):
            print(f"  [{self.name}] Vote extend STARTED! initiator={data.get('initiatorName')}")

        @self.sio.on("room:vote_extend_hands_ended", namespace=AI_NAMESPACE)
        def on_vote_ended(data):
            approved = data.get('approved')
            new_fh = data.get('newFixedHands')
            print(f"  [{self.name}] Vote extend ENDED! approved={approved}, newFixedHands={new_fh}")
            self.vote_extend_approved = approved
            self.new_fixed_hands = new_fh
            self.vote_extend_ended.set()

        @self.sio.on("room:vote_extend_hands_response", namespace=AI_NAMESPACE)
        def on_vote_response(data):
            print(f"  [{self.name}] Vote response: playerId={data.get('playerId')}, approve={data.get('approve')}")

        @self.sio.on("game:game_started", namespace=AI_NAMESPACE)
        def on_game_started(data):
            print(f"  [{self.name}] Game STARTED!")

    def connect(self):
        self.sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=5)
        time.sleep(0.3)

    def send_cmd(self, cmd, args=None, timeout=5):
        req_id = next_req_id()
        payload = {"cmd": cmd, "args": args or {}, "reqId": req_id}
        result = {"response": None}
        def on_response(data):
            result["response"] = data
        self.sio.emit("ai:cmd", payload, namespace=AI_NAMESPACE, callback=on_response)
        deadline = time.time() + timeout
        while result["response"] is None and time.time() < deadline:
            self.sio.sleep(0.05)
        return result["response"]

    def get_state(self):
        return self.send_cmd("get-state")

    def play_turn(self):
        state = self.get_state()
        if not state or not state.get("ok"):
            return False
        data = state.get("data", {})
        if not data.get("isMyTurn"):
            return False
        valid = data.get("validActions", [])
        if "discard" in valid:
            self.send_cmd("action", {"action": "discard", "amount": 0})
        elif "check" in valid:
            self.send_cmd("action", {"action": "check"})
        elif "call" in valid:
            self.send_cmd("action", {"action": "call"})
        elif "fold" in valid:
            self.send_cmd("action", {"action": "fold"})
        return True

    def disconnect(self):
        try:
            self.sio.disconnect()
        except:
            pass


def play_one_hand(players, hand_num):
    print(f"\n--- Playing hand {hand_num} ---")
    for _ in range(300):
        any_acted = False
        for p in players:
            if p.play_turn():
                any_acted = True
        if not any_acted:
            time.sleep(0.3)
        state = players[0].get_state()
        if not state or not state.get("ok"):
            break
        phase = state.get("data", {}).get("phase")
        if phase in ("ended", "showdown", "waiting"):
            print(f"  Hand {hand_num} ended (phase={phase})")
            return True
    return False


def wait_for_next_hand(players, max_wait=20):
    for _ in range(max_wait):
        for p in players:
            p.send_cmd("ready", {"ready": True})
        time.sleep(1)
        state = players[0].get_state()
        if state and state.get("ok"):
            phase = state.get("data", {}).get("phase")
            if phase not in ("ended", "showdown", "waiting"):
                return True
    return False


def main():
    print("=" * 60)
    print("  TEST: Fixed Hands Vote Extend Bug")
    print("  After voting to extend 10 hands, game should auto-start")
    print("=" * 60)

    players = []
    for name in ["Alice", "Bob", "Charlie"]:
        p = AIPlayer(name)
        p.connect()
        players.append(p)
    time.sleep(0.5)

    print("\n--- Creating room with fixedHands=3 ---")
    resp = players[0].send_cmd("create-room", {
        "name": "FixedHandsTest",
        "variant": "texas_nlhe",
        "maxPlayers": 6,
        "smallBlind": 10,
        "bigBlind": 20,
        "fixedHands": 3,
    })
    if not resp or not resp.get("ok"):
        print(f"  FAIL: create-room failed: {resp}")
        for p in players:
            p.disconnect()
        return
    room_id = resp.get("data", {}).get("roomId")
    print(f"  Room created: {room_id}, fixedHands=3")

    for p in players:
        p.room_id = room_id

    print("\n--- Other players joining ---")
    for p in players[1:]:
        resp = p.send_cmd("join-room", {"roomId": room_id, "name": p.name})
        if resp and resp.get("ok"):
            print(f"  [{p.name}] Joined room")
        else:
            print(f"  [{p.name}] Join FAILED: {resp}")
            for p in players:
                p.disconnect()
            return
    time.sleep(0.3)

    print("\n--- All players ready ---")
    for p in players:
        resp = p.send_cmd("ready", {"ready": True})
        print(f"  [{p.name}] Ready: ok={resp.get('ok') if resp else False}")
    time.sleep(1)

    print("\n--- Starting game ---")
    resp = players[0].send_cmd("start-game")
    print(f"  start-game: ok={resp.get('ok') if resp else False}")
    time.sleep(1)

    play_one_hand(players, 1)
    if not wait_for_next_hand(players):
        print("  FAIL: Could not start hand 2")
        for p in players:
            p.disconnect()
        return

    play_one_hand(players, 2)
    if not wait_for_next_hand(players):
        print("  FAIL: Could not start hand 3")
        for p in players:
            p.disconnect()
        return

    play_one_hand(players, 3)

    print("\n--- Hand 3 done. Now handCount=3 >= fixedHands=3 ---")
    print("  Waiting for room to settle...")
    time.sleep(3)

    state = players[0].get_state()
    if state and state.get("ok"):
        data = state.get("data", {})
        print(f"  Phase: {data.get('phase')}, handId: {data.get('handId')}")

    print("\n--- Initiating vote to extend 10 hands ---")
    resp = players[0].send_cmd("vote-extend-hands", {"approve": True})
    print(f"  [{players[0].name}] vote-extend-hands: ok={resp.get('ok') if resp else False}, data={resp.get('data') if resp else 'N/A'}, error={resp.get('error') if resp else 'N/A'}")

    time.sleep(1)

    print("\n--- Other players voting approve ---")
    for p in players[1:]:
        resp = p.send_cmd("vote-extend-hands", {"approve": True})
        print(f"  [{p.name}] vote approve: ok={resp.get('ok') if resp else False}, data={resp.get('data') if resp else 'N/A'}, error={resp.get('error') if resp else 'N/A'}")
        time.sleep(0.3)

    print("\n--- Waiting for vote result ---")
    vote_deadline = time.time() + 10
    while not players[0].vote_extend_ended.is_set() and time.time() < vote_deadline:
        time.sleep(0.5)

    if players[0].vote_extend_ended.is_set():
        print(f"  Vote ended! approved={players[0].vote_extend_approved}, newFixedHands={players[0].new_fixed_hands}")
    else:
        print("  TIMEOUT: Vote did not end within 10 seconds")

    print("\n--- Checking if game auto-starts after vote approval ---")
    game_started = False
    check_deadline = time.time() + 20
    while time.time() < check_deadline:
        state = players[0].get_state()
        if state and state.get("ok"):
            phase = state.get("data", {}).get("phase")
            hand_id = state.get("data", {}).get("handId")
            if phase not in ("waiting", "ended", "showdown"):
                print(f"  SUCCESS! Game auto-started! phase={phase}, handId={hand_id}")
                game_started = True
                break
            else:
                print(f"  Still waiting... phase={phase}")
        time.sleep(1)

    if not game_started:
        print("\n  FAIL: Game did NOT auto-start after vote approval!")
        print("  Let's check player states...")
        for p in players:
            who = p.send_cmd("whoami")
            if who and who.get("ok"):
                room_info = who.get("data", {}).get("room", {})
                print(f"  [{p.name}] isReady={room_info.get('isReady')}, chips={room_info.get('chips')}")
    else:
        print("\n  Playing hand 4 (first hand after extension)...")
        play_one_hand(players, 4)
        print("\n  SUCCESS: Vote extend hands bug is FIXED!")

    print("\n--- Cleanup ---")
    for p in players:
        p.disconnect()

    print("\n" + "=" * 60)
    if game_started:
        print("  RESULT: PASS - Game auto-starts after vote extend approval")
    else:
        print("  RESULT: FAIL - Game does NOT auto-start after vote extend approval")
    print("=" * 60)


if __name__ == "__main__":
    main()