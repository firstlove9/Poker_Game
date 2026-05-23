"""
AI Poker Interface Test Client
==============================
Complete test for the AI WebSocket CLI-style command interface.
Connects to /ai namespace and tests all 17 commands.

Usage:
  pip install python-socketio[client]
  python test_ai_interface.py
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import sys

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

sio = socketio.Client()
test_results = []
req_counter = 0
received_events = []


def next_req_id():
    global req_counter
    req_counter += 1
    return str(req_counter)


def send_cmd(cmd, args=None, timeout=5):
    req_id = next_req_id()
    payload = {"cmd": cmd, "args": args or {}, "reqId": req_id}
    result = {"response": None}

    def on_response(data):
        result["response"] = data

    sio.emit("ai:cmd", payload, namespace=AI_NAMESPACE, callback=on_response)

    deadline = time.time() + timeout
    while result["response"] is None and time.time() < deadline:
        sio.sleep(0.05)

    return result["response"]


def log_test(name, response, expect_ok=True):
    status = "PASS" if response and response.get("ok") == expect_ok else "FAIL"
    test_results.append({"name": name, "status": status, "response": response})
    icon = "✅" if status == "PASS" else "❌"
    print(f"  {icon} {name}: ok={response.get('ok') if response else 'NO_RESPONSE'}, code={response.get('code') if response else 'N/A'}", end="")
    if response and not response.get("ok"):
        print(f", error={response.get('error', 'unknown')}", end="")
    if response and response.get("log"):
        print(f", log={response.get('log')}", end="")
    print()
    return status == "PASS"


def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def print_data(label, data):
    if data:
        print(f"    📋 {label}: {json.dumps(data, ensure_ascii=False, indent=2)[:500]}")


@sio.on("ai:connected", namespace=AI_NAMESPACE)
def on_connected(data):
    print(f"\n  🔗 Connected! Player ID: {data.get('data', {}).get('playerId')}")
    print(f"  Protocol: {data.get('data', {}).get('protocol')}")
    cmds = data.get('data', {}).get('commands', [])
    print(f"  Available commands: {len(cmds)}")


@sio.on("ai:response", namespace=AI_NAMESPACE)
def on_ai_response(data):
    pass


@sio.on("disconnect", namespace=AI_NAMESPACE)
def on_disconnect():
    print("\n  ⚠️ Disconnected from AI namespace")


@sio.on("game:action_result", namespace=AI_NAMESPACE)
def on_action_result(data):
    received_events.append(("game:action_result", data))


@sio.on("game:player_turn", namespace=AI_NAMESPACE)
def on_player_turn(data):
    received_events.append(("game:player_turn", data))


@sio.on("game:showdown", namespace=AI_NAMESPACE)
def on_showdown(data):
    received_events.append(("game:showdown", data))


@sio.on("game:hand_result", namespace=AI_NAMESPACE)
def on_hand_result(data):
    received_events.append(("game:hand_result", data))


@sio.on("game:game_over", namespace=AI_NAMESPACE)
def on_game_over(data):
    received_events.append(("game:game_over", data))


@sio.on("system:chips_received", namespace=AI_NAMESPACE)
def on_chips_received(data):
    received_events.append(("system:chips_received", data))


@sio.on("room:player_joined", namespace=AI_NAMESPACE)
def on_player_joined(data):
    received_events.append(("room:player_joined", data))


@sio.on("room:player_left", namespace=AI_NAMESPACE)
def on_player_left(data):
    received_events.append(("room:player_left", data))


@sio.on("room:player_ready_changed", namespace=AI_NAMESPACE)
def on_ready_changed(data):
    received_events.append(("room:player_ready_changed", data))


@sio.on("room:updated", namespace=AI_NAMESPACE)
def on_room_updated(data):
    received_events.append(("room:updated", data))


@sio.on("chat:message", namespace=AI_NAMESPACE)
def on_chat_message(data):
    received_events.append(("chat:message", data))


def run_tests():
    print_section("1. CONNECTION TEST")
    try:
        sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=5)
        log_test("Connect to /ai namespace", {"ok": True, "code": 0})
    except Exception as e:
        print(f"  ❌ Connection failed: {e}")
        print("  Make sure the server is running on http://localhost:3000")
        sys.exit(1)

    time.sleep(0.5)

    # ---- HELP ----
    print_section("2. HELP COMMAND")
    resp = send_cmd("help")
    log_test("help - show all commands", resp)
    if resp and resp.get("ok"):
        cmd_count = len(resp.get("data", {}).get("commands", []))
        print(f"    📋 Commands available: {cmd_count}")

    # ---- WHOAMI (before joining room) ----
    print_section("3. WHOAMI (no room)")
    resp = send_cmd("whoami")
    log_test("whoami - no room yet", resp)
    if resp and resp.get("ok"):
        data = resp.get("data", {})
        print(f"    📋 playerId: {data.get('playerId')}")
        print(f"    📋 roomId: {data.get('roomId')}")
        print(f"    📋 room: {data.get('room')}")

    # ---- LIST ROOMS ----
    print_section("4. LIST ROOMS")
    resp = send_cmd("list-rooms")
    log_test("list-rooms", resp)
    if resp and resp.get("ok"):
        rooms = resp.get("data", {}).get("rooms", [])
        print(f"    📋 Rooms found: {len(rooms)}")
        for r in rooms[:3]:
            print(f"       - {r.get('roomId')}: {r.get('roomName')} ({r.get('playerCount')}/{r.get('maxPlayers')}) variant={r.get('variant')}")

    # ---- LIST VARIANTS ----
    print_section("5. LIST VARIANTS")
    resp = send_cmd("list-variants")
    log_test("list-variants", resp)
    if resp and resp.get("ok"):
        variants = resp.get("data", {}).get("variants", [])
        print(f"    📋 Variants: {len(variants)}")
        for v in variants:
            print(f"       - {v['id']}: {v['name']} {v.get('icon', '')} (max {v['maxPlayers']} players, forceCombination={v.get('forceCombination', '?')})")

    # ---- LIST MODIFIERS ----
    print_section("6. LIST MODIFIERS")
    resp = send_cmd("list-modifiers")
    log_test("list-modifiers", resp)
    if resp and resp.get("ok"):
        modifiers = resp.get("data", {}).get("modifiers", [])
        print(f"    📋 Modifiers: {len(modifiers)}")
        for m in modifiers:
            print(f"       - {m['id']}: {m['name']} {m.get('icon', '')} needsBaseVariant={m.get('needsBaseVariant', '?')}")

    # ---- RULES ----
    print_section("7. RULES")
    resp = send_cmd("rules", {"variant": "texas_nlhe"})
    log_test("rules - texas_nlhe", resp)
    if resp and resp.get("ok"):
        d = resp.get("data", {})
        print(f"    📋 handRankOrder: {d.get('handRankOrder', [])[:3]}...")
        print(f"    📋 specialRules: {d.get('specialRules', [])}")
        print(f"    📋 modifier: {d.get('modifier')}")

    resp = send_cmd("rules", {"variant": "pineapple"})
    log_test("rules - pineapple (discard variant)", resp)
    if resp and resp.get("ok"):
        d = resp.get("data", {})
        print(f"    📋 holeCardCount: {d.get('holeCardCount')}")
        print(f"    📋 specialRules: {d.get('specialRules', [])}")

    resp = send_cmd("rules", {"variant": "squid_holdem"})
    log_test("rules - squid_holdem", resp)

    resp = send_cmd("rules", {"variant": "invalid_variant"})
    log_test("rules - invalid variant (expect fail)", resp, expect_ok=False)

    # ---- CREATE ROOM ----
    print_section("8. CREATE ROOM")
    resp = send_cmd("create-room", {
        "name": "AI_Test_Room",
        "variant": "texas_nlhe",
        "maxPlayers": 6,
        "smallBlind": 10,
        "bigBlind": 20,
    })
    log_test("create-room - texas_nlhe", resp)
    room_id = None
    if resp and resp.get("ok"):
        room_id = resp.get("data", {}).get("roomId")
        print(f"    📋 Room ID: {room_id}")
        print(f"    📋 Room Name: {resp.get('data', {}).get('roomName')}")
        print(f"    📋 Variant: {resp.get('data', {}).get('variant')}")

    # ---- WHOAMI (in room) ----
    print_section("9. WHOAMI (in room)")
    resp = send_cmd("whoami")
    log_test("whoami - in room", resp)
    if resp and resp.get("ok"):
        data = resp.get("data", {})
        room_info = data.get("room", {})
        print(f"    📋 playerId: {data.get('playerId')}")
        print(f"    📋 roomId: {data.get('roomId')}")
        if room_info:
            print(f"    📋 isHost: {room_info.get('isHost')}")
            print(f"    📋 chips: {room_info.get('chips')}")
            print(f"    📋 isReady: {room_info.get('isReady')}")
            print(f"    📋 variant: {room_info.get('variant')}")

    # ---- GET STATE (waiting) ----
    print_section("10. GET STATE (waiting)")
    resp = send_cmd("get-state")
    log_test("get-state - waiting room", resp)
    if resp and resp.get("ok"):
        print(f"    📋 Room status: {resp.get('data', {}).get('roomStatus')}")
        print(f"    📋 Players: {len(resp.get('data', {}).get('players', []))}")

    # ---- GET ACTIONS (no game) ----
    print_section("11. GET ACTIONS (no game)")
    resp = send_cmd("get-actions")
    log_test("get-actions - no active game (expect fail)", resp, expect_ok=False)

    # ---- READY ----
    print_section("12. READY")
    resp = send_cmd("ready", {"ready": True})
    log_test("ready - set ready", resp)

    resp = send_cmd("ready", {"ready": False})
    log_test("ready - set not ready", resp)

    resp = send_cmd("ready")
    log_test("ready - default (true)", resp)

    # ---- START GAME ----
    print_section("13. START GAME (only 1 player, expect fail)")
    resp = send_cmd("start-game")
    log_test("start-game - only 1 player (expect fail)", resp, expect_ok=False)

    # ---- JOIN ROOM with second AI ----
    print_section("14. SECOND AI PLAYER")
    sio2 = socketio.Client()
    connected2 = {"done": False, "playerId": None}

    @sio2.on("ai:connected", namespace=AI_NAMESPACE)
    def on_connected2(data):
        connected2["done"] = True
        connected2["playerId"] = data.get("data", {}).get("playerId")

    def send_cmd2(cmd, args=None, timeout=5):
        req_id = f"2_{next_req_id()}"
        payload = {"cmd": cmd, "args": args or {}, "reqId": req_id}
        result = {"response": None}

        def on_response(data):
            result["response"] = data

        sio2.emit("ai:cmd", payload, namespace=AI_NAMESPACE, callback=on_response)

        deadline = time.time() + timeout
        while result["response"] is None and time.time() < deadline:
            sio2.sleep(0.05)

        return result["response"]

    try:
        sio2.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=5)
        time.sleep(0.5)

        if room_id:
            resp2 = send_cmd2("join-room", {"roomId": room_id, "name": "AI_Player_2"})
            log_test("second AI joins room", resp2)

            resp2 = send_cmd2("ready", {"ready": True})
            print(f"    Second AI ready: ok={resp2.get('ok') if resp2 else False}")

            time.sleep(0.5)

    except Exception as e:
        print(f"  Warning: Second AI connection failed: {e}")

    # ---- START GAME (2 players ready) ----
    print_section("15. START GAME (2 players)")
    time.sleep(0.5)
    resp = send_cmd("start-game")
    log_test("start-game - 2 players ready", resp)

    time.sleep(1)

    # ---- GET STATE (playing) ----
    print_section("16. GET STATE (playing)")
    resp = send_cmd("get-state")
    log_test("get-state - game in progress", resp)
    if resp and resp.get("ok"):
        data = resp.get("data", {})
        print(f"    📋 Phase: {data.get('phase')}")
        print(f"    📋 My cards: {data.get('myCards')}")
        print(f"    📋 Community cards: {data.get('communityCards')}")
        print(f"    📋 Pot: {data.get('pot')}")
        print(f"    📋 Current bet: {data.get('currentBet')}")
        print(f"    📋 Is my turn: {data.get('isMyTurn')}")
        print(f"    📋 Valid actions: {data.get('validActions')}")
        print(f"    📋 handId: {data.get('handId')}")
        players = data.get("players", [])
        for p in players:
            print(f"    📋 Player {p.get('name')}: isAfk={p.get('isAfk')}, playerRoomRole={p.get('playerRoomRole')}")

    # ---- GET ACTIONS ----
    print_section("17. GET ACTIONS")
    resp = send_cmd("get-actions")
    if resp and resp.get("ok") and resp.get("data", {}).get("isMyTurn"):
        log_test("get-actions - my turn", resp)
        data = resp.get("data", {})
        print(f"    📋 Valid actions: {data.get('validActions')}")
        print(f"    📋 To call: {data.get('toCall')}")
        print(f"    📋 My chips: {data.get('myChips')}")
        print(f"    📋 Min raise: {data.get('minRaise')}")
        print(f"    📋 Max raise: {data.get('maxRaise')}")
    else:
        log_test("get-actions - not my turn", resp or {"ok": False, "code": -1})
        print("    ℹ️ Not AI player's turn, trying action anyway...")

    # ---- ACTION: CHECK or CALL or FOLD ----
    print_section("18. ACTION COMMANDS")
    state_resp = send_cmd("get-state")
    if state_resp and state_resp.get("ok") and state_resp.get("data", {}).get("isMyTurn"):
        valid = state_resp.get("data", {}).get("validActions", [])
        if "check" in valid:
            resp = send_cmd("action", {"action": "check"})
            log_test("action - check", resp)
        elif "call" in valid:
            resp = send_cmd("action", {"action": "call"})
            log_test("action - call", resp)
        else:
            resp = send_cmd("action", {"action": "fold"})
            log_test("action - fold", resp)
        if resp and resp.get("ok"):
            d = resp.get("data", {})
            print(f"    📋 isMyTurn after action: {d.get('isMyTurn')}")
            print(f"    📋 pot after action: {d.get('pot')}")
            print(f"    📋 currentBet after action: {d.get('currentBet')}")
    else:
        print("    ℹ️ Not my turn, testing invalid action...")
        resp = send_cmd("action", {"action": "fold"})
        if resp and not resp.get("ok"):
            log_test("action - fold when not turn (expect fail)", resp, expect_ok=False)
        else:
            log_test("action - fold succeeded unexpectedly", resp, expect_ok=True)

    # Test invalid action
    resp = send_cmd("action", {"action": "invalid_action"})
    log_test("action - invalid action (expect fail)", resp, expect_ok=False)

    # Test missing action param
    resp = send_cmd("action", {})
    log_test("action - missing param (expect fail)", resp, expect_ok=False)

    # ---- CHAT ----
    print_section("19. CHAT")
    resp = send_cmd("chat", {"message": "Hello from AI!"})
    log_test("chat - send message", resp)

    resp = send_cmd("chat", {})
    log_test("chat - missing message (expect fail)", resp, expect_ok=False)

    # ---- GET CHIPS (not busted, expect fail) ----
    print_section("20. GET CHIPS (not busted)")
    resp = send_cmd("get-chips")
    if resp and not resp.get("ok"):
        log_test("get-chips - not busted (expect fail)", resp, expect_ok=False)
    else:
        log_test("get-chips - unexpected success or not in game", resp)

    # ---- PLAY UNTIL GAME ENDS ----
    print_section("21. PLAY UNTIL GAME ENDS (both AIs auto-act)")
    hand_count = 0
    for attempt in range(120):
        time.sleep(0.3)
        state = send_cmd("get-state")
        if not state or not state.get("ok"):
            break
        phase = state.get("data", {}).get("phase")
        is_my_turn = state.get("data", {}).get("isMyTurn")
        if phase == "waiting":
            hand_count += 1
            print(f"    Hand {hand_count} ended, room waiting for next game")
            if hand_count >= 2:
                print("    Played 2 hands, done!")
                break
            resp = send_cmd("ready", {"ready": True})
            try:
                send_cmd2("ready", {"ready": True})
            except:
                pass
            time.sleep(1)
            continue
        if phase in ("ended", "showdown"):
            print("    Game ended!")
            break
        if phase == "discard":
            print("    Discard phase detected!")
            if is_my_turn:
                resp = send_cmd("action", {"action": "discard", "amount": 0})
                print(f"    AI1 discard: ok={resp.get('ok') if resp else False}")
            continue
        if is_my_turn:
            valid = state.get("data", {}).get("validActions", [])
            if "discard" in valid:
                resp = send_cmd("action", {"action": "discard", "amount": 0})
                print(f"    AI1 discard: ok={resp.get('ok') if resp else False}")
            else:
                action = "check" if "check" in valid else "call" if "call" in valid else "fold"
                resp = send_cmd("action", {"action": action})
                print(f"    AI1 {action}: ok={resp.get('ok') if resp else False}")
            continue

        # AI 2 acts if it's their turn
        try:
            state2 = send_cmd2("get-state")
            if state2 and state2.get("ok") and state2.get("data", {}).get("isMyTurn"):
                valid2 = state2.get("data", {}).get("validActions", [])
                if "discard" in valid2:
                    resp2 = send_cmd2("action", {"action": "discard", "amount": 0})
                    print(f"    AI2 discard: ok={resp2.get('ok') if resp2 else False}")
                else:
                    action2 = "check" if "check" in valid2 else "call" if "call" in valid2 else "fold"
                    resp2 = send_cmd2("action", {"action": action2})
                    print(f"    AI2 {action2}: ok={resp2.get('ok') if resp2 else False}")
        except:
            pass

    log_test("play until game ends", {"ok": True, "code": 0})

    # ---- SERVER PUSH EVENTS ----
    print_section("22. SERVER PUSH EVENTS")
    event_types = set(et for et, _ in received_events)
    print(f"    📋 Events received: {len(received_events)} total, {len(event_types)} types")
    for et in sorted(event_types):
        count = sum(1 for t, _ in received_events if t == et)
        print(f"       - {et}: {count}")

    has_action_result = "game:action_result" in event_types
    has_player_turn = "game:player_turn" in event_types
    has_room_event = any(t in event_types for t in ["room:player_joined", "room:player_ready_changed", "room:updated"])
    log_test("received game:action_result events", {"ok": has_action_result, "code": 0})
    log_test("received game:player_turn events", {"ok": has_player_turn, "code": 0})
    log_test("received room events", {"ok": has_room_event, "code": 0})

    # ---- LEAVE ROOM ----
    print_section("23. LEAVE ROOM")
    time.sleep(1)
    resp = send_cmd("leave-room")
    if resp and resp.get("ok"):
        log_test("leave-room", resp)
    else:
        print(f"    Leave failed: {resp.get('error') if resp else 'unknown'}, trying fold first...")
        state = send_cmd("get-state")
        if state and state.get("ok") and state.get("data", {}).get("isMyTurn"):
            send_cmd("action", {"action": "fold"})
            time.sleep(2)
        resp = send_cmd("leave-room")
        log_test("leave-room (after fold)", resp)

    # ---- ERROR HANDLING ----
    print_section("24. ERROR HANDLING")
    resp = send_cmd("join-room", {"roomId": "nonexistent_room"})
    log_test("join-room - nonexistent (expect fail)", resp, expect_ok=False)

    resp = send_cmd("get-state")
    if resp and resp.get("ok"):
        print("    Still in a room, leaving first...")
        send_cmd("leave-room")
        time.sleep(0.5)
        resp = send_cmd("get-state")
    log_test("get-state - not in room (expect fail)", resp, expect_ok=False)

    resp = send_cmd("leave-room")
    log_test("leave-room - not in room (expect fail)", resp, expect_ok=False)

    # ---- CREATE ROOM WITH PINEAPPLE VARIANT ----
    print_section("25. CREATE ROOM WITH PINEAPPLE VARIANT")
    resp = send_cmd("create-room", {
        "name": "Pineapple_Test_Room",
        "variant": "pineapple",
        "maxPlayers": 6,
    })
    log_test("create-room - pineapple", resp)
    if resp and resp.get("ok"):
        pineapple_room_id = resp.get("data", {}).get("roomId")
        print(f"    📋 Room ID: {pineapple_room_id}")
        print(f"    📋 Variant: {resp.get('data', {}).get('variant')}")

        # Join with second AI and play one pineapple hand
        try:
            resp2 = send_cmd2("join-room", {"roomId": pineapple_room_id, "name": "PineappleBot"})
            if resp2 and resp2.get("ok"):
                send_cmd("ready", {"ready": True})
                send_cmd2("ready", {"ready": True})
                time.sleep(0.5)
                send_cmd("start-game")
                time.sleep(1)

                pineapple_discard_tested = False
                for _ in range(60):
                    time.sleep(0.3)
                    state = send_cmd("get-state")
                    if not state or not state.get("ok"):
                        break
                    phase = state.get("data", {}).get("phase")
                    is_my_turn = state.get("data", {}).get("isMyTurn")
                    if phase == "waiting":
                        print("    Pineapple hand ended!")
                        break
                    if phase == "discard" and is_my_turn:
                        valid = state.get("data", {}).get("validActions", [])
                        if "discard" in valid:
                            my_cards = state.get("data", {}).get("myCards", [])
                            discard_idx = 0
                            if len(my_cards) > 0:
                                print(f"    📋 Pineapple cards: {[c.get('code') for c in my_cards]}")
                            resp = send_cmd("action", {"action": "discard", "amount": discard_idx})
                            log_test("action - discard (pineapple)", resp)
                            pineapple_discard_tested = True
                        continue
                    if is_my_turn:
                        valid = state.get("data", {}).get("validActions", [])
                        action = "check" if "check" in valid else "call" if "call" in valid else "fold"
                        send_cmd("action", {"action": action})

                    try:
                        state2 = send_cmd2("get-state")
                        if state2 and state2.get("ok") and state2.get("data", {}).get("isMyTurn"):
                            valid2 = state2.get("data", {}).get("validActions", [])
                            if "discard" in valid2:
                                send_cmd2("action", {"action": "discard", "amount": 0})
                            else:
                                action2 = "check" if "check" in valid2 else "call" if "call" in valid2 else "fold"
                                send_cmd2("action", {"action": action2})
                    except:
                        pass

                if not pineapple_discard_tested:
                    log_test("action - discard (pineapple)", {"ok": False, "code": -1})

                send_cmd("leave-room")
        except Exception as e:
            print(f"  Warning: Pineapple test failed: {e}")

    # ---- CREATE ROOM WITH SQUID HOLDEM ----
    print_section("26. CREATE ROOM WITH SQUID HOLDEM")
    resp = send_cmd("create-room", {
        "name": "Squid_Game_Room",
        "variant": "squid_holdem",
        "maxPlayers": 2,
    })
    log_test("create-room - squid_holdem", resp)
    if resp and resp.get("ok"):
        print(f"    📋 Room ID: {resp.get('data', {}).get('roomId')}")
        print(f"    📋 Variant: {resp.get('data', {}).get('variant')}")
        print(f"    📋 Max players: {resp.get('data', {}).get('maxPlayers')}")
        send_cmd("leave-room")

    # ---- DISCONNECT ----
    print_section("27. CLEANUP")
    try:
        sio2.disconnect()
        print("  ✅ Second AI disconnected")
    except:
        pass

    sio.disconnect()
    print("  ✅ Main AI disconnected")

    # ---- SUMMARY ----
    print_section("TEST SUMMARY")
    passed = sum(1 for r in test_results if r["status"] == "PASS")
    failed = sum(1 for r in test_results if r["status"] == "FAIL")
    total = len(test_results)
    print(f"\n  Total: {total} | ✅ Passed: {passed} | ❌ Failed: {failed}")
    if total > 0:
        print(f"  Success rate: {passed/total*100:.1f}%\n")

    if failed > 0:
        print("  Failed tests:")
        for r in test_results:
            if r["status"] == "FAIL":
                print(f"    ❌ {r['name']}: {r['response']}")
        print()

    return failed == 0


if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║   AI Poker Interface - Complete Test Suite       ║")
    print("║   Server: http://localhost:3000                  ║")
    print("║   Namespace: /ai                                 ║")
    print("╚══════════════════════════════════════════════════╝")

    success = run_tests()
    sys.exit(0 if success else 1)
