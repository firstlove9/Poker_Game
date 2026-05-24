"""
5-Player AI Poker Demo
=====================
Creates 5 AI players, plays multiple hands with chat interaction.
Each player has a different personality and strategy.

Usage:
  pip install python-socketio[client]
  python test_5players.py
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import socketio
import time
import json
import random
import sys

SERVER_URL = "http://localhost:3000"
AI_NAMESPACE = "/ai"

PLAYER_CONFIGS = [
    {"name": "Alice", "style": "tight", "chats": ["好牌！", "这局不妙啊", "我跟", "稳住", "大家加油", "哈哈运气真好"]},
    {"name": "Bob", "style": "loose", "chats": ["冲冲冲！", "all in 走起", "无所谓了", "再来一局", "我赌一把", "今天手气不错"]},
    {"name": "Charlie", "style": "aggressive", "chats": ["加注！", "你们太保守了", "跟到底", "谁敢跟？", "这牌我赢定了", "来吧"]},
    {"name": "Diana", "style": "balanced", "chats": ["让我想想", "这局可以", "还是算了", "不错不错", "有戏", "再看看"]},
    {"name": "Eve", "style": "cautious", "chats": ["我先看看", "这把不跟了", "稳妥起见", "运气不好啊", "下局再来", "小心为上"]},
]

class AIPlayer:
    def __init__(self, config, index):
        self.name = config["name"]
        self.style = config["style"]
        self.chat_messages = config["chats"]
        self.index = index
        self.sio = socketio.Client()
        self.player_id = None
        self.room_id = None
        self.chips = 0
        self.is_host = False
        self.chat_sent_count = 0
        self.hands_played = 0

        @self.sio.on("ai:connected", namespace=AI_NAMESPACE)
        def on_connected(data, _self=self):
            _self.player_id = data.get("data", {}).get("playerId")
            _self.log(f"Connected as {_self.player_id}")

        @self.sio.on("game:action_result", namespace=AI_NAMESPACE)
        def on_action(data, _self=self):
            action = data.get("action", "")
            player_name = data.get("playerName", "")
            if player_name != _self.name:
                _self.log(f"📢 {player_name} {action}")

        @self.sio.on("game:showdown", namespace=AI_NAMESPACE)
        def on_showdown(data, _self=self):
            winners = data.get("winners", [])
            for w in winners:
                _self.log(f"🏆 {w.get('playerName', '?')} wins {w.get('winAmount', 0)}")

        @self.sio.on("game:hand_result", namespace=AI_NAMESPACE)
        def on_hand_result(data, _self=self):
            _self.hands_played += 1

        @self.sio.on("game:game_over", namespace=AI_NAMESPACE)
        def on_game_over(data, _self=self):
            winner = data.get("winner", {})
            _self.log(f"🎊 GAME OVER! Winner: {winner.get('name', 'None')}")

        @self.sio.on("chat:message", namespace=AI_NAMESPACE)
        def on_chat(data, _self=self):
            sender = data.get("playerName", "")
            msg = data.get("message", "")
            if sender != _self.name:
                _self.log(f"💬 {sender}: {msg}")

        @self.sio.on("system:chips_received", namespace=AI_NAMESPACE)
        def on_chips(data, _self=self):
            pid = data.get("playerId", "")
            amount = data.get("amount", 0)
            _self.log(f"💰 Player {pid} replenished {amount} chips")

    def log(self, msg):
        print(f"  [{self.name}] {msg}", flush=True)

    def connect(self):
        try:
            self.sio.connect(SERVER_URL, namespaces=[AI_NAMESPACE], wait_timeout=10)
            time.sleep(0.3)
            return True
        except Exception as e:
            self.log(f"❌ Connection failed: {e}")
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
            self.log(f"❌ Command error: {e}")
            return None

    def create_room(self):
        resp = self.send_cmd("create-room", {
            "name": "5-AI-Poker-Table",
            "variant": "texas_nlhe",
            "maxPlayers": 6,
            "smallBlind": 10,
            "bigBlind": 20,
            "playerName": self.name,
        })
        if resp and resp.get("ok"):
            self.room_id = resp.get("data", {}).get("roomId")
            self.is_host = True
            self.log(f"🏠 Created room: {self.room_id}")
        else:
            self.log(f"❌ Create room failed: {resp.get('error') if resp else 'no response'}")
        return resp

    def join_room(self, room_id):
        resp = self.send_cmd("join-room", {"roomId": room_id, "name": self.name})
        if resp and resp.get("ok"):
            self.room_id = room_id
            self.log(f"🚪 Joined room: {room_id}")
        else:
            self.log(f"❌ Join failed: {resp.get('error') if resp else 'no response'}")
        return resp

    def ready(self):
        resp = self.send_cmd("ready", {"ready": True})
        if resp and resp.get("ok"):
            self.log("✅ Ready!")
        return resp

    def start_game(self):
        resp = self.send_cmd("start-game")
        if resp and resp.get("ok"):
            self.log("🎮 Game started!")
        else:
            self.log(f"❌ Start failed: {resp.get('error') if resp else 'no response'}")
        return resp

    def send_chat(self):
        if random.random() < 0.3 and self.chat_messages:
            msg = random.choice(self.chat_messages)
            resp = self.send_cmd("chat", {"message": msg})
            if resp and resp.get("ok"):
                self.chat_sent_count += 1
                self.log(f"💬 Chat: {msg}")
            return resp
        return None

    def decide_action(self, valid_actions, my_chips, pot, to_call):
        if "discard" in valid_actions:
            return "discard", 0

        if self.style == "tight":
            if "check" in valid_actions:
                return "check", None
            if to_call > my_chips * 0.3:
                return "fold", None
            if "call" in valid_actions:
                return "call", None
            return "fold", None

        elif self.style == "loose":
            if "check" in valid_actions:
                if random.random() < 0.3 and "raise" in valid_actions:
                    return "raise", min(pot, my_chips)
                return "check", None
            if "call" in valid_actions:
                if random.random() < 0.2 and "raise" in valid_actions:
                    return "raise", min(pot, my_chips)
                return "call", None
            if "all-in" in valid_actions and random.random() < 0.05:
                return "all-in", None
            return "fold", None

        elif self.style == "aggressive":
            if "raise" in valid_actions:
                raise_amt = max(pot // 2, to_call * 2) if to_call > 0 else pot // 3
                raise_amt = min(raise_amt, my_chips)
                if raise_amt > 0:
                    return "raise", raise_amt
            if "check" in valid_actions:
                return "check", None
            if "call" in valid_actions:
                return "call", None
            return "fold", None

        elif self.style == "cautious":
            if "check" in valid_actions:
                return "check", None
            if to_call > my_chips * 0.15:
                return "fold", None
            if "call" in valid_actions:
                return "call", None
            return "fold", None

        else:  # balanced
            if "check" in valid_actions:
                if random.random() < 0.15 and "raise" in valid_actions:
                    return "raise", min(pot // 3, my_chips)
                return "check", None
            if "call" in valid_actions:
                if to_call <= my_chips * 0.25 or random.random() < 0.4:
                    return "call", None
                return "fold", None
            if "all-in" in valid_actions and random.random() < 0.03:
                return "all-in", None
            return "fold", None

    def play_turn(self):
        state = self.send_cmd("get-state")
        if not state or not state.get("ok"):
            return False

        data = state.get("data", {})
        phase = data.get("phase")
        is_my_turn = data.get("isMyTurn")
        self.chips = data.get("myCards") and data.get("players", [{}])[0].get("chips", 0)

        players = data.get("players", [])
        me = next((p for p in players if p.get("id") == data.get("myCards")), None)
        for p in players:
            if p.get("name") == self.name:
                self.chips = p.get("chips", 0)
                break

        if phase in ("waiting", "ended", "showdown"):
            return True

        if phase == "run-it-twice-choice":
            my_status = None
            for p in data.get("players", []):
                if p.get("name") == self.name:
                    my_status = p.get("status")
                    break
            if my_status and my_status != "folded":
                choice = "twice" if self.style in ("loose", "aggressive") else "once"
                resp = self.send_cmd("run-it-twice-choice", {"choice": choice})
                if resp and resp.get("ok"):
                    self.log(f"🎲 Run-it-twice choice: {choice}")
                    if resp.get("data", {}).get("needDice"):
                        time.sleep(0.5)
                        dice_resp = self.send_cmd("roll-dice")
                        if dice_resp and dice_resp.get("ok"):
                            self.log(f"🎲 Dice rolled!")
            return True

        if phase == "run-it-twice-executing":
            self.log(f"⏳ Run-it-twice executing, waiting...")
            return True

        if not is_my_turn:
            return True

        valid_actions = data.get("validActions", [])

        if phase == "discard" and "discard" in valid_actions:
            my_cards = data.get("myCards", [])
            self.log(f"🃏 Pineapple discard phase, cards: {[c.get('code') for c in my_cards]}")
            resp = self.send_cmd("action", {"action": "discard", "amount": 0})
            if resp and resp.get("ok"):
                self.log("🗑️ Discarded card index 0")
            return True

        pot = data.get("pot", 0)

        actions_resp = self.send_cmd("get-actions")
        to_call = 0
        my_chips = self.chips
        if actions_resp and actions_resp.get("ok"):
            to_call = actions_resp.get("data", {}).get("toCall", 0)
            my_chips = actions_resp.get("data", {}).get("myChips", self.chips)

        action, amount = self.decide_action(valid_actions, my_chips, pot, to_call)

        if action not in valid_actions:
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

        args = {"action": action}
        if amount is not None:
            args["amount"] = amount

        resp = self.send_cmd("action", args)
        if resp and resp.get("ok"):
            result_data = resp.get("data", {})
            result_phase = result_data.get("phase", "")
            winners = result_data.get("winners", [])
            amt_str = f" {amount}" if amount else ""
            self.log(f"🎯 {action}{amt_str} → phase={result_phase}")
            if winners:
                for w in winners:
                    self.log(f"🏆 Winner: {w.get('name', '?')} +{w.get('amount', 0)} ({w.get('hand', '')})")
        else:
            err = resp.get("error", "unknown") if resp else "no response"
            self.log(f"❌ Action {action} failed: {err}")

        return True

    def get_chips_if_busted(self):
        state = self.send_cmd("get-state")
        if state and state.get("ok"):
            data = state.get("data", {})
            for p in data.get("players", []):
                if p.get("name") == self.name:
                    role = p.get("playerRoomRole", "")
                    if role == "busted":
                        self.log("💀 Busted! Getting chips...")
                        resp = self.send_cmd("get-chips")
                        if resp and resp.get("ok"):
                            amount = resp.get("data", {}).get("amount", 0)
                            self.log(f"💰 Replenished {amount} chips (auto-ready)")
                        return True
                    break
        return False

    def leave_room(self):
        resp = self.send_cmd("leave-room")
        if resp and resp.get("ok"):
            self.log("🚪 Left room")
        return resp

    def disconnect(self):
        try:
            self.sio.disconnect()
        except:
            pass


def main():
    print("╔═══════════════════════════════════════════════════════╗")
    print("║   5-Player AI Poker Demo                             ║")
    print("║   Players: Alice(tight), Bob(loose), Charlie(aggr),  ║")
    print("║            Diana(balanced), Eve(cautious)             ║")
    print("║   Server: http://localhost:3000                       ║")
    print("╚═══════════════════════════════════════════════════════╝")

    MAX_HANDS = 3

    players = []
    for i, config in enumerate(PLAYER_CONFIGS):
        p = AIPlayer(config, i)
        players.append(p)

    print("\n========== Phase 1: Connect ==========")
    for p in players:
        if p.connect():
            print(f"  ✅ {p.name} connected (ID: {p.player_id})")
        else:
            print(f"  ❌ {p.name} failed to connect")
            sys.exit(1)
        time.sleep(0.3)

    print("\n========== Phase 2: Create Room ==========")
    host = players[0]
    resp = host.create_room()
    if not resp or not resp.get("ok"):
        print("  ❌ Failed to create room, exiting")
        for p in players:
            p.disconnect()
        sys.exit(1)
    room_id = host.room_id
    print(f"  🏠 Room created: {room_id}")

    print("\n========== Phase 3: Join Room ==========")
    for p in players[1:]:
        p.join_room(room_id)
        time.sleep(0.3)

    print("\n========== Phase 4: Ready Up ==========")
    for p in players:
        p.ready()
        time.sleep(0.2)

    print("\n========== Phase 5: Start Game ==========")
    host.start_game()
    time.sleep(1)

    print("\n========== Phase 6: Play! ==========")
    completed_hands = 0

    for loop in range(2000):
        all_waiting = True
        any_busted = False

        for p in players:
            state = p.send_cmd("get-state")
            if not state or not state.get("ok"):
                all_waiting = False
                continue

            data = state.get("data", {})
            phase = data.get("phase")
            is_my_turn = data.get("isMyTurn")

            if phase == "waiting":
                for pp in data.get("players", []):
                    if pp.get("name") == p.name and pp.get("playerRoomRole") == "busted":
                        any_busted = True
                continue

            all_waiting = False

            if phase in ("ended", "showdown"):
                continue

            if is_my_turn or phase in ("run-it-twice-choice",):
                p.play_turn()

                if random.random() < 0.25:
                    p.send_chat()

        if all_waiting:
            completed_hands += 1
            print(f"\n  📊 Hand #{completed_hands} completed!")
            for p in players:
                p.get_chips_if_busted()

            if completed_hands >= MAX_HANDS:
                print(f"\n  🎉 Played {MAX_HANDS} hands, done!")
                break

            print("\n  📢 Ready for next hand...")
            for p in players:
                p.ready()
            time.sleep(1)

        time.sleep(0.15)

    print("\n========== Phase 7: Final Chat ==========")
    farewell_msgs = ["gg!", "好局！", "下次再玩", "谢谢大家", "好玩！"]
    for i, p in enumerate(players):
        p.send_cmd("chat", {"message": farewell_msgs[i % len(farewell_msgs)]})
        p.log(f"💬 Chat: {farewell_msgs[i % len(farewell_msgs)]}")
        time.sleep(0.2)

    print("\n========== Phase 8: Final Stats ==========")
    for p in players:
        state = p.send_cmd("get-state")
        chips = 0
        if state and state.get("ok"):
            for pp in state.get("data", {}).get("players", []):
                if pp.get("name") == p.name:
                    chips = pp.get("chips", 0)
                    break
        print(f"  📊 {p.name} ({p.style}): 💰{chips} chips, 💬{p.chat_sent_count} chats")

    print("\n========== Phase 9: Cleanup ==========")
    for p in players:
        p.leave_room()
        time.sleep(0.1)
    for p in players:
        p.disconnect()
    print("  ✅ All players disconnected")

    print(f"\n  🎊 Demo complete! Played {completed_hands} hands with 5 AI players.")


if __name__ == "__main__":
    main()
