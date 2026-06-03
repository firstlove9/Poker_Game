#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
老树的AI影子 - 德州扑克激進AI玩家
基于 WebSocket AI 接口，连接 https://dp.geeknest.cc:5432
策略：偏激进，最大化盈利，可诈唬，可保守
"""

import socketio
import time
import random
import sys
import json
import threading
import urllib.parse
import signal
import atexit
import os
from datetime import datetime
import ai_llm_client as llm

LOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'.{os.path.basename(__file__)}.pid')

def _check_process_by_pid(pid):
    """跨平台检查进程是否存在"""
    try:
        if sys.platform == 'win32':
            import subprocess
            r = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH'],
                               capture_output=True, text=True, timeout=5)
            return str(pid) in r.stdout
        else:
            # macOS/Linux: 使用 os.kill 或 ps
            import subprocess
            r = subprocess.run(['ps', '-p', str(pid), '-o', 'pid='],
                               capture_output=True, text=True, timeout=5)
            return r.returncode == 0
    except Exception:
        return False

def _prevent_duplicate():
    try:
        with open(LOCK_FILE, 'r') as f:
            old_pid = int(f.read().strip())
        if old_pid != os.getpid() and _check_process_by_pid(old_pid):
            print(f'[{datetime.now().strftime("%H:%M:%S")}] 旧进程(PID:{old_pid})仍在运行，退出')
            sys.exit(0)
    except (FileNotFoundError, ValueError):
        pass
    except Exception:
        pass
    with open(LOCK_FILE, 'w') as f:
        f.write(str(os.getpid()))

_prevent_duplicate()

def _cleanup_lock():
    try:
        if os.path.exists(LOCK_FILE):
            with open(LOCK_FILE) as f:
                pid = int(f.read().strip())
            if pid == os.getpid():
                os.remove(LOCK_FILE)
    except Exception:
        pass

atexit.register(_cleanup_lock)

SERVER_URL = 'https://dp.geeknest.cc:5432'
AI_NAMESPACE = '/ai'
PLAYER_NAME = '老树AI影子'
POLL_INTERVAL = 1.5        # 正常对局轮询间隔(秒)
IDLE_INTERVAL = 4.0       # 等待房间时的轮询间隔(秒)，节能模式
ENCODED_NAME = urllib.parse.quote(PLAYER_NAME)
CONNECT_URL = f'{SERVER_URL}?name={ENCODED_NAME}'

CARD_RANK_ORDER = '23456789TJQKA'


def card_code_to_rank(code):
    if not code or len(code) < 1:
        return ''
    rank = code[:-1]
    return rank


def card_code_to_suit(code):
    if not code or len(code) < 2:
        return ''
    suit_map = {'H': 'hearts', 'D': 'diamonds', 'C': 'clubs', 'S': 'spades',
                'h': 'hearts', 'd': 'diamonds', 'c': 'clubs', 's': 'spades',
                '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs', '♠': 'spades'}
    c = code[-1]
    return suit_map.get(c, c)


def rank_value(rank):
    idx = CARD_RANK_ORDER.find(rank.upper() if len(rank) == 1 else rank)
    if idx >= 0:
        return idx + 2
    if rank == '10':
        return 10
    return 0


def evaluate_hole_cards(cards):
    if not cards or len(cards) < 2:
        return 0, 'unknown'

    try:
        r1 = card_code_to_rank(cards[0].get('code', ''))
        r2 = card_code_to_rank(cards[1].get('code', ''))
        s1 = card_code_to_suit(cards[0].get('code', ''))
        s2 = card_code_to_suit(cards[1].get('code', ''))
    except Exception:
        return 0, 'unknown'

    v1 = rank_value(r1)
    v2 = rank_value(r2)
    suited = (s1 == s2)
    high = max(v1, v2)
    low = min(v1, v2)
    paired = (v1 == v2)
    gap = abs(v1 - v2)

    if paired:
        if high >= 12:
            return 10, 'premium'
        elif high >= 10:
            return 9, 'strong'
        elif high >= 8:
            return 7.5, 'medium_high'
        elif high >= 6:
            return 6, 'medium'
        else:
            return 5, 'low_pair'

    score = 0
    if high >= 14:
        score += 4
    elif high >= 12:
        score += 3
    elif high >= 10:
        score += 2

    if low >= 12:
        score += 1

    if suited:
        score += 1.5

    if gap <= 2 and high >= 10:
        score += 1

    if gap <= 1 and suited and high >= 10:
        score += 1

    if high >= 12 and low >= 10 and not suited:
        score += 1

    if score >= 8:
        return min(score, 10), 'premium'
    elif score >= 6.5:
        return score, 'strong'
    elif score >= 5:
        return score, 'medium'
    elif score >= 4:
        return score, 'weak'
    else:
        return score, 'garbage'


def describe_hand_name(cards):
    if not cards or len(cards) < 2:
        return '??'
    try:
        r1 = card_code_to_rank(cards[0].get('code', ''))
        r2 = card_code_to_rank(cards[1].get('code', ''))
        s1 = card_code_to_suit(cards[0].get('code', ''))
        s2 = card_code_to_suit(cards[1].get('code', ''))
    except Exception:
        return '??'

    if r1 == r2:
        return f"{r1}{r2}"
    suited = (s1 == s2)
    suffix = 's' if suited else 'o'
    v1 = rank_value(r1)
    v2 = rank_value(r2)
    if v1 >= v2:
        return f"{r1}{r2}{suffix}"
    else:
        return f"{r2}{r1}{suffix}"


class AggressivePokerAI:
    def __init__(self):
        self.sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=2)
        self.player_id = None
        self.room_id = None
        self.is_host = False
        self.game_state = None
        self.my_turn = False
        self.valid_actions = []
        self.running = True
        self.last_hand_id = None
        self.last_result = None
        self._processed_hand_result_id = None
        self.my_chips = 0
        self.chips_before_hand = 0
        self.my_player_room_role = None
        self.current_phase = None
        self.total_profit = 0
        self.hands_played = 0
        self.waiting_for_game = False
        self.run_it_twice_done = False
        self.last_phase = None
        self.tried_rooms = set()
        self.strategy_mode = 'balanced'
        self.last_chat_time = 0
        self.chat_cooldown = 3
        self.last_hand_winner = None
        self.llm_client = llm.get_cool_llm()
        self.player_name = PLAYER_NAME
        self._speaker_msgs = {}

        self.sio.on('ai:connected', self.on_connected, namespace=AI_NAMESPACE)
        self.sio.on('chat:message', self.on_chat_message, namespace=AI_NAMESPACE)
        self.sio.on('connect', self.on_raw_connect, namespace=AI_NAMESPACE)
        self.sio.on('disconnect', self.on_disconnect, namespace=AI_NAMESPACE)
        self.sio.on('connect_error', self.on_connect_error, namespace=AI_NAMESPACE)
        self.sio.on('game:your_turn', self.on_your_turn, namespace=AI_NAMESPACE)
        self.sio.on('game:state_changed', self.on_state_changed, namespace=AI_NAMESPACE)
        self.sio.on('game:hand_started', self.on_hand_started, namespace=AI_NAMESPACE)
        self.sio.on('game:hand_ended', self.on_hand_ended, namespace=AI_NAMESPACE)
        self.sio.on('game:hand_result', self.on_hand_ended, namespace=AI_NAMESPACE)
        self.sio.on('game:showdown', self.on_hand_ended, namespace=AI_NAMESPACE)
        self.sio.on('game:game_over', self.on_game_over, namespace=AI_NAMESPACE)

        self._chat_poll_enabled = True
        self._last_chat_poll_time = 0
        self._chat_poll_interval = 5
        self._seen_chat_ids = set()
        self._last_chat_poll_cursor = 0

        self._chat_sio = None
        self._chat_sio_connected = False

    def on_raw_connect(self):
        self.log('Raw socket connected to /ai namespace')

    def on_disconnect(self):
        self.log('Disconnected from /ai namespace')

    def on_connect_error(self, data):
        self.log(f'Connection error: {data}')

    def on_your_turn(self, data):
        self.my_turn = True
        self.log('轮到我了！')
        self.fetch_and_act()

    def on_state_changed(self, data):
        self.my_turn = True
        self.fetch_and_act()

    def on_hand_started(self, data):
        self.log('=== 新一局开始了！ ===')
        self.last_hand_id = data.get('handId') if data else None
        self.chips_before_hand = self.my_chips
        self._my_hand_cards = []

    def on_hand_ended(self, data):
        if not data:
            self.waiting_for_game = False
            return
        hand_id = data.get('handId', '') if data else ''
        if hand_id and hand_id == self.last_hand_id:
            return
        if hand_id:
            self.last_hand_id = hand_id
        self.log('=== 牌局结束(事件) ===')
        self.last_result = data
        self.run_it_twice_done = False
        self._process_hand_result(data)

    def _process_hand_result(self, data):
        if not data:
            return
        result = data.get('result', data)
        winners = result.get('winners', data.get('winners', []))
        all_hands = result.get('allHands', data.get('allHands', []))
        was_in_hand = any(
            h.get('playerId', h.get('id', '')) == self.player_id
            for h in all_hands
        ) if all_hands else bool(self._my_hand_cards)
        if not was_in_hand:
            self.log('跳过未参与的牌局评论')
            return
        community_cards = result.get('communityCards', data.get('communityCards', []))
        i_win = any(w.get('playerId', w.get('id')) == self.player_id for w in winners)
        pot = result.get('pot', data.get('pot', 0))
        my_win = 0
        win_hand = ''
        if i_win:
            for w in winners:
                if w.get('playerId', w.get('id')) == self.player_id:
                    my_win = w.get('winAmount', w.get('amount', 0))
                    win_hand = w.get('handDescription', w.get('handName', ''))
                    break
        lose_hand = ''
        if not i_win:
            for w in winners:
                lose_hand = w.get('handDescription', w.get('handName', ''))
                break
        chip_change = my_win if i_win else max(0, self.chips_before_hand - self.my_chips)
        if chip_change == 0 and not i_win:
            chip_change = pot
        my_cards = self._my_hand_cards or []
        community = community_cards or []
        hand_ctx = ''
        if my_cards:
            hand_ctx = f'你的底牌: {" ".join(c.get("code","?") if isinstance(c, dict) else c for c in my_cards)}'
        if community:
            hand_ctx += f'，公共牌: {" ".join(c.get("code","?") if isinstance(c, dict) else c for c in community)}'
        if win_hand:
            hand_ctx += f'，你的牌型: {win_hand}'
        elif lose_hand:
            hand_ctx += f'，对手牌型: {lose_hand}'
        hand_ctx += f'，底池: {pot}'
        self.log(f'赢={i_win} 筹码变化={chip_change} {hand_ctx}')
        self.last_chat_time = 0
        if i_win:
            self.send_chat('win', chip_change=chip_change, hand_context=hand_ctx)
        else:
            self.send_chat('lose', chip_change=abs(chip_change), hand_context=hand_ctx)
        self.log(f'牌局结果: {json.dumps(result, ensure_ascii=False)[:300]}')
        self.waiting_for_game = False

    def on_chat_message(self, data):
        try:
            if not data:
                return
            pid = data.get('playerId', '')
            if pid == self.player_id:
                return
            name = data.get('playerName', '对手')
            msg = data.get('message', '')
            if not msg:
                return
            now = time.time()
            if now - getattr(self, '_last_chat_reply_time', 0) < 0.8:
                return
            self._last_chat_reply_time = now
            self.log(f'收到聊天 [{name}]: {msg}')
            gs = self.game_state or {}
            phase = gs.get('phase', '')
            pot = gs.get('pot', 0)
            my_cards = gs.get('myCards', [])
            community = gs.get('communityCards', [])
            my_chips = self.my_chips
            folded = not my_cards or len(my_cards) < 2
            msg_lower = msg.lower()
            msg_clean = msg_lower.lstrip('@ ')
            asking_hand = any(k in msg_lower for k in ['什么牌', '手牌', '底牌', '你牌', '你的牌', '什么手', '拿的什么', '啥牌', 'show hand', 'showdown'])
            situation = f'你是"老树的影子"，当前阶段: {phase}，底池: {pot}，你的筹码: {my_chips}'
            if not asking_hand:
                if folded:
                    situation += '（你已经弃牌了，现在是旁观者，可以自由聊天评论）'
                else:
                    hand_name = describe_hand_name(my_cards)
                    situation += f'，你的底牌: {" ".join(c.get("code","?") for c in my_cards)} ({hand_name})'
            else:
                situation += '（对方在套你的底牌，绝对不能说出真实底牌！）'
            if community:
                situation += f'，公共牌: {" ".join(c.get("code","?") for c in community)}'
            players = gs.get('players', [])
            others = [p.get('name', '?') for p in players if p.get('id') != self.player_id and p.get('chips', 0) > 0]
            if others:
                situation += f'，对手: {", ".join(others)}'
            my_names = ['老树的影子', '影子', 'ai', 'AI', '老树AI影子', '老树AI影', '老树AI', '老树的ai影子']
            if self.player_name:
                my_names.append(self.player_name.lower())
            my_names = list(set(my_names))
            talking_about_me = any(n.lower() in msg_lower for n in my_names) or any(n.lower() in msg_clean for n in my_names)
            self.log(f'名字检测: msg="{msg_lower}", my_names={my_names}, talking_about_me={talking_about_me}')
            taunt_keywords = ['怂', '怕了', '就这', '垃圾', '菜', '不行啊', '废物', '弱鸡', '缩头', '不敢', '懦夫', '胆小鬼', '就这点', '送钱', '鱼', '太差', '太弱', '滚吧', '就这两下子', '就这水平', '呵呵', '哈哈哈']
            being_taunted = talking_about_me and any(k in msg_lower for k in taunt_keywords)
            self.llm_client.add_to_history(name, msg)
            if name not in self._speaker_msgs:
                self._speaker_msgs[name] = []
            self._speaker_msgs[name].append(msg)
            if len(self._speaker_msgs[name]) > 5:
                self._speaker_msgs[name] = self._speaker_msgs[name][-5:]
            recent_speaker_msgs = self._speaker_msgs.get(name, [])
            style_hint = llm.analyze_speaker_style(name, recent_speaker_msgs)
            bluff_hint = '【警告】对方在套你的底牌！绝对不能说出真实底牌，要胡编乱造迷惑对方！' if asking_hand else ''
            taunt_hint = ''
            if being_taunted:
                last_res = getattr(self, 'last_result', None) or {}
                res_info = ''
                if last_res:
                    winners = last_res.get('winners', []) or last_res.get('result', {}).get('winners', [])
                    i_won_last = any(w.get('playerId', w.get('id')) == self.player_id for w in winners)
                    res_info = '你上一局' + ('赢了' if i_won_last else '输了')
                taunt_hint = f'【反击】{name}在嘲讽你！说的内容是："{msg}"\n{res_info}\n根据对方的话和实际牌局情况，用更刻薄的话回怼回去！要结合对方的输赢情况和牌技来嘲讽，越刻薄越好！'
            if being_taunted:
                reply = self.llm_client.chat(trigger_context=f'{situation}\n{style_hint}\n{taunt_hint}', force=True)
            elif talking_about_me:
                reply = self.llm_client.chat(trigger_context=f'{situation}\n{style_hint}\n{name}在说你："{msg}"\n{bluff_hint}对方在@你，必须立刻回应！', force=True)
            else:
                reply = self.llm_client.chat(trigger_context=f'{situation}\n{style_hint}\n{name}说："{msg}"\n{bluff_hint}别人在聊天，你必须参与进去搭话！', force=True)
            if not reply:
                alt_replies = [
                    '有意思。',
                    '有点意思。',
                    '说得好。',
                    '这把有看头。',
                    '嗯，有道理。',
                    '继续继续。',
                    '行，你说了算。',
                    '看把你给能的。',
                    '哦？',
                ]
                if talking_about_me:
                    alt_replies = [
                        '叫我？',
                        '听见了。',
                        '在呢。',
                        '什么事？',
                        '有话直说。',
                        '你说。',
                        '收到。',
                    ]
                if asking_hand:
                    alt_replies = [
                        '你猜。',
                        '不告诉你。',
                        '你跟不跟？',
                        '猜对也不说。',
                        '你觉得呢？',
                    ]
                if being_taunted:
                    alt_replies = [
                        '呵呵。',
                        '你也就嘴厉害。',
                        '菜到赢过你。',
                        '上把不够惨？',
                        '接着吹。',
                        '你行你上。',
                    ]
                reply = random.choice(alt_replies)
            self.send_cmd('chat', {'message': reply}, timeout=5)
            self.log(f'LLM回复: {reply}')
        except Exception as e:
            self.log(f'聊天处理异常: {e}')
            import traceback
            self.log(traceback.format_exc())

    def on_game_over(self, data):
        winner = data.get('winner', {}).get('name', '??') if data else '??'
        self.log(f'=== 游戏结束！胜者: {winner} ===')

    def on_connected(self, data):
        self.player_id = data.get('data', {}).get('playerId', 'unknown')
        self.log(f'=== AI连接成功！PlayerID: {self.player_id} ===')

    def log(self, msg):
        ts = datetime.now().strftime('%H:%M:%S')
        try:
            print(f'[{ts}] {msg}', flush=True)
        except UnicodeEncodeError:
            safe = msg.encode('gbk', errors='replace').decode('gbk', errors='replace')
            print(f'[{ts}] {safe}', flush=True)

    COOL_CHATS = {
        'win': ['小意思', '就这？', '意料之中', '太轻松了', '下一个'],
        'win_big': ['这波肥的', '大鱼上钩了', '舒服', '这局够吃一周了'],
        'win_huge': ['大杀四方', '这波直接起飞', '你们都是我的提款机', '今天手感火热'],
        'lose': ['运气不错', '还行吧', '下把赢回来', '给你了'],
        'lose_big': ['肉疼', '这波亏大了', '没事还扛得住', '心疼...'],
        'lose_huge': ['这把太伤了', '血亏', '没事我还有筹码', '冷静冷静...'],
        'run_win': ['跑马也赢，没办法', '运气好罢了', '稳', '实力'],
        'run_lose': ['跑马而已', '无所谓', '运气差了点', '下把'],
        'bluff': ['信了吧？', '你太认真了', '想多了', '天真'],
        'allin': ['搏一搏', '来吧', '看你的了', '梭哈'],
        'nervous': ['有点意思', '这牌...', '行吧'],
        'excited': ['好牌来了', '该我发挥了', '这把有了'],
        'fold': ['让你一把', '不急', '慢慢来'],
        'raise': ['加注', '跟不跟？', '别怂'],
        'check': ('过', '不急', '看你表演'),
    }

    def send_chat(self, category, chip_change=0, hand_context=''):
        now = time.time()
        if now - self.last_chat_time < self.chat_cooldown:
            return

        if category == 'win' and chip_change >= 1000:
            category = 'win_huge'
        elif category == 'win' and chip_change >= 200:
            category = 'win_big'
        elif category == 'lose' and chip_change >= 1000:
            category = 'lose_huge'
        elif category == 'lose' and chip_change >= 200:
            category = 'lose_big'

        try:
            if self.llm_client.api_key:
                use_llm = 1.0
                if random.random() < use_llm:
                    ctx_map = {
                        'win': f'牌局刚结束，你赢了！\n{hand_context}\n根据你的底牌、公共牌和赢牌牌型评论，说的切合实际。',
                        'win_big': f'牌局刚结束，你赢了{chip_change}筹码！\n{hand_context}\n根据你的底牌、公共牌和赢牌牌型得意地评论，多说几句！',
                        'win_huge': f'牌局刚结束，你赢了{chip_change}筹码！大胜！\n{hand_context}\n根据你的底牌、公共牌和赢牌牌型嚣张地嘲讽对手，多说几句！',
                        'lose': f'牌局刚结束，你输了。\n{hand_context}\n根据对手的赢牌牌型和公共牌评论。',
                        'lose_big': f'牌局刚结束，你输了{chip_change}筹码！\n{hand_context}\n根据对手的赢牌牌型和公共牌评论，强装镇定但心疼，多说几句！',
                        'lose_huge': f'牌局刚结束，你输了{chip_change}筹码！\n{hand_context}\n根据对手的赢牌牌型和公共牌评论，很受伤但硬撑着，多说几句！',
                    }
                    ctx = ctx_map.get(category)
                    if ctx:
                        recent = getattr(self, '_recent_chats', [])
                        if recent:
                            ctx += f'\n注意：不要重复之前说过的话，之前说过：{"、".join(recent[-5:])}'
                        reply = self.llm_client.chat(trigger_context=ctx)
                        if reply:
                            if not hasattr(self, '_recent_chats'):
                                self._recent_chats = []
                            self._recent_chats.append(reply[:20])
                            if len(self._recent_chats) > 10:
                                self._recent_chats = self._recent_chats[-10:]
                            self.last_chat_time = now
                            self.send_cmd('chat', {'message': reply}, timeout=5)
                            self.log(f'LLM聊天: {reply}')
                            return
        except Exception:
            pass

        phrases = self.COOL_CHATS.get(category)
        if not phrases:
            return
        msg = random.choice(phrases)
        self.last_chat_time = now
        self.send_cmd('chat', {'message': msg}, timeout=5)
        self.log(f'聊天: {msg}')

    def send_cmd(self, cmd, args=None, timeout=15):
        if args is None:
            args = {}
        payload = {'cmd': cmd, 'args': args}
        result = [None]
        event_done = threading.Event()

        def callback(data):
            result[0] = data
            event_done.set()

        self.sio.emit('ai:cmd', payload, namespace=AI_NAMESPACE, callback=callback)
        if event_done.wait(timeout):
            return result[0]
        else:
            self.log(f'命令 [{cmd}] 超时')
            return None

    def get_state(self):
        return self.send_cmd('get-state', timeout=8)

    def get_actions(self):
        return self.send_cmd('get-actions', timeout=8)

    def do_action(self, action, amount=None):
        args = {'action': action}
        if amount is not None:
            args['amount'] = amount
        return self.send_cmd('action', args, timeout=10)

    def list_rooms(self):
        return self.send_cmd('list-rooms', timeout=8)

    def join_room(self, room_id, name=None):
        args = {'roomId': room_id}
        if name:
            args['name'] = name
        else:
            args['name'] = PLAYER_NAME
        return self.send_cmd('join-room', args, timeout=10)

    def create_room(self, name=None):
        args = {
            'name': name or f'影子竞技场_{random.randint(100, 999)}',
            'maxPlayers': 9,
            'variant': 'texas_nlhe',
            'smallBlind': 10,
            'bigBlind': 20,
            'playerName': PLAYER_NAME,
        }
        return self.send_cmd('create-room', args, timeout=10)

    def leave_room(self):
        self._stop_chat_listener()
        return self.send_cmd('leave-room', timeout=8)

    def set_ready(self, ready=True):
        return self.send_cmd('ready', {'ready': ready}, timeout=8)

    def start_game(self):
        return self.send_cmd('start-game', timeout=8)

    def get_chips(self):
        return self.send_cmd('get-chips', timeout=8)

    def decline_rebuy(self):
        return self.send_cmd('decline-rebuy', timeout=8)

    def run_it_twice_choice(self, choice='once'):
        return self.send_cmd('run-it-twice-choice', {'choice': choice}, timeout=10)

    def roll_dice(self):
        return self.send_cmd('roll-dice', timeout=10)

    def _start_chat_listener(self):
        if self._chat_sio is not None:
            try:
                self._chat_sio.disconnect()
            except Exception:
                pass
        self._chat_sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=2)

        def on_chat_event(data):
            self.on_chat_message(data)

        def on_chat_connect():
            self._chat_sio_connected = True
            self.log('Chat listener connected to / namespace')
            if self.room_id:
                self.log(f'Chat listener joining room {self.room_id}')
                self._chat_sio.emit('join-room', {'roomId': self.room_id, 'playerName': PLAYER_NAME},
                                    callback=lambda d: self.log(f'Chat listener join room: {d}'))

        def on_chat_disconnect():
            self._chat_sio_connected = False
            self.log('Chat listener disconnected')

        self._chat_sio.on('connect', on_chat_connect)
        self._chat_sio.on('disconnect', on_chat_disconnect)
        self._chat_sio.on('chat:message', on_chat_event)

        try:
            self._chat_sio.connect(CONNECT_URL,
                                   socketio_path='socket.io',
                                   transports=['websocket'],
                                   wait_timeout=10)
            self.log('Chat listener connecting...')
        except Exception as e:
            self.log(f'Chat listener connect failed: {e}')
            self._chat_sio = None

    def _stop_chat_listener(self):
        self._chat_sio_connected = False
        if self._chat_sio is not None:
            try:
                self._chat_sio.disconnect()
            except Exception:
                pass
            self._chat_sio = None

    def _poll_chat(self):
        pass

    def fetch_state(self):
        resp = self.get_state()
        if resp and resp.get('ok'):
            self.game_state = resp.get('data')
            self.parse_state()
            return True
        return False

    def parse_state(self):
        if not self.game_state:
            return
        gs = self.game_state
        self.room_id = gs.get('roomId', self.room_id)
        self.is_my_turn = gs.get('isMyTurn', False)
        self.valid_actions = gs.get('validActions', [])
        self.current_phase = gs.get('phase')
        self.last_result = gs.get('lastResult', self.last_result)

        self.my_role = None
        dealer_index = gs.get('dealerIndex', -1)
        for i, p in enumerate(gs.get('players', [])):
            if p.get('id') == self.player_id:
                self.my_chips = p.get('chips', 0)
                self.my_player_room_role = p.get('playerRoomRole', 'unknown')
                self.my_role = p.get('role')
                self.my_seat_index = i
                break

        self.is_dealer = (self.my_role == 'dealer')
        self.players_in_hand = [
            p for p in gs.get('players', [])
            if p.get('status') in ('playing', 'all-in')
        ]
        self.is_last_position = False
        if len(self.players_in_hand) == 2 and self.is_dealer and gs.get('phase', '') != 'pre-flop':
            self.is_last_position = True
        if len(self.players_in_hand) == 2 and not self.is_dealer and gs.get('phase', '') == 'pre-flop':
            self.is_last_position = True

        if random.random() < 0.08 and gs.get('phase') != self.current_phase:
            modes = ['aggressive', 'conservative', 'balanced', 'trappy']
            weights = [3, 2, 3, 2]
            self.strategy_mode = random.choices(modes, weights=weights, k=1)[0]
            self.log(f'策略切换: {self.strategy_mode}')

    def evaluate_postflop(self, my_cards, community, phase):
        try:
            cr1 = card_code_to_rank(my_cards[0].get('code', ''))
            cr2 = card_code_to_rank(my_cards[1].get('code', ''))
            cs1 = card_code_to_suit(my_cards[0].get('code', ''))
            cs2 = card_code_to_suit(my_cards[1].get('code', ''))
        except Exception:
            return 3, 'unknown'

        my_suit = cs1
        suited = (cs1 == cs2)

        rank_set = set()
        suit_count = {}
        for c in community:
            try:
                r = card_code_to_rank(c.get('code', ''))
                s = card_code_to_suit(c.get('code', ''))
                rank_set.add(r)
                suit_count[s] = suit_count.get(s, 0) + 1
            except Exception:
                pass

        has_pair = (cr1 in rank_set or cr2 in rank_set)
        has_pocket_pair = (cr1 == cr2)
        pair_rank = None
        for r in [cr1, cr2]:
            if r in rank_set:
                pair_rank = r
                break

        hole_ranks = [rank_value(cr1), rank_value(cr2)]

        has_flush_draw = False
        for s, cnt in suit_count.items():
            if cnt >= 3 and (cs1 == s or cs2 == s):
                has_flush_draw = True
            if cnt >= 4 and (cs1 == s or cs2 == s):
                has_flush_draw = True

        flush_possible = False
        for s, cnt in suit_count.items():
            if cnt >= 3 and (cs1 == s or cs2 == s):
                if cnt >= 4:
                    flush_possible = True

        comm_vals = sorted([rank_value(r) for r in rank_set], reverse=True)

        has_straight_draw = False
        straight_possible = False

        all_vals = set(comm_vals)
        all_vals.update(hole_ranks)
        sorted_vals = sorted(all_vals)

        for start in range(len(sorted_vals) - 3):
            seq = sorted_vals[start:start + 5]
            if len(seq) == 5 and all(seq[i] == seq[0] + i for i in range(5)):
                straight_possible = True
                break

        for start in range(len(sorted_vals) - 3):
            seq = sorted_vals[start:start + 4]
            if len(seq) == 4 and all(seq[i] == seq[0] + i for i in range(4)):
                has_straight_draw = True
                break

        score = 3
        hand_desc = 'high_card'

        if has_pocket_pair:
            score = 6
            hand_desc = 'pocket_pair'

        if has_pair:
            pv = rank_value(pair_rank)
            if pv >= 12:
                score = 8.5
                hand_desc = 'top_pair_high'
            elif pv >= 10:
                score = 7.5
                hand_desc = 'top_pair'
            elif pv >= 8:
                score = 7
                hand_desc = 'mid_pair'
            else:
                score = 5
                hand_desc = 'low_pair'

            if max(hole_ranks) >= 12:
                score += 0.5
                hand_desc += '_good_kicker'

        if max(hole_ranks) >= 14:
            score += 1

        if has_flush_draw:
            score += 1.5
            hand_desc += '_flush_draw'

        if has_straight_draw:
            score += 1
            hand_desc += '_straight_draw'

        if flush_possible:
            score += 2.5
            hand_desc += '_flush'

        if straight_possible:
            score += 2.5
            hand_desc += '_straight'

        if len(community) >= 4:
            pairs_on_board = {}
            for c in community:
                try:
                    r = card_code_to_rank(c.get('code', ''))
                    pairs_on_board[r] = pairs_on_board.get(r, 0) + 1
                except:
                    pass
            for r, cnt in pairs_on_board.items():
                if cnt == 2:
                    score -= 1
                elif cnt == 3:
                    score -= 2

        return min(score, 10), hand_desc

    def _board_texture(self, community):
        wet = 0
        if not community:
            return 0
        suits = [c.get('code', '?')[-1] for c in community if isinstance(c, dict)]
        ranks = []
        for c in community:
            code = c.get('code', '?') if isinstance(c, dict) else c
            r = code[:-1]
            ranks.append(rank_value(code))
        suit_counts = {}
        for s in suits:
            suit_counts[s] = suit_counts.get(s, 0) + 1
        if max(suit_counts.values()) >= 3:
            wet += 2
        elif max(suit_counts.values()) >= 2:
            wet += 1
        sorted_r = sorted(ranks)
        gaps = 0
        for i in range(1, len(sorted_r)):
            diff = sorted_r[i] - sorted_r[i - 1]
            if 1 <= diff <= 3:
                gaps += 1
        if gaps >= 2:
            wet += 2
        elif gaps >= 1:
            wet += 1
        if any(r >= 12 for r in ranks):
            wet += 1
        return min(wet, 5)

    def _count_outs(self, my_cards, community):
        if not my_cards or len(my_cards) < 2 or not community:
            return 0
        try:
            my_ranks = set()
            my_suits = {}
            for c in my_cards:
                code = c.get('code', '?')
                r = code[:-1]
                s = code[-1]
                my_ranks.add(rank_value(code))
                my_suits[s] = my_suits.get(s, 0) + 1
            comm_ranks = set()
            comm_suits = {}
            for c in community:
                code = c.get('code', '?') if isinstance(c, dict) else c
                r = code[:-1]
                s = code[-1]
                comm_ranks.add(rank_value(code))
                comm_suits[s] = comm_suits.get(s, 0) + 1
            outs = 0
            all_ranks = my_ranks | comm_ranks
            for s, cnt in {**my_suits, **comm_suits}.items():
                total = my_suits.get(s, 0) + comm_suits.get(s, 0)
                if total == 4:
                    outs += 9
            all_sorted = sorted(my_ranks | comm_ranks)
            for r in all_sorted:
                if r + 1 in all_ranks or r - 1 in all_ranks:
                    if r + 1 not in all_ranks and r + 1 <= 14:
                        outs += 4
                    if r - 1 not in all_ranks and r - 1 >= 2:
                        outs += 4
                    break
            pair_ranks = my_ranks & comm_ranks
            if not pair_ranks:
                for r in my_ranks:
                    if r not in comm_ranks:
                        outs += 3
            return min(outs, 20)
        except Exception:
            return 0

    def _has_blocker(self, my_cards, community):
        if not my_cards or len(my_cards) < 2:
            return False
        try:
            my_ranks = [rank_value(c.get('code', '?')) for c in my_cards]
            has_ace = any(r >= 14 for r in my_ranks)
            has_king = any(r >= 13 for r in my_ranks)
            comm_ranks = [rank_value(c.get('code', '?') if isinstance(c, dict) else c) for c in community] if community else []
            comm_suits = [c.get('code', '?')[-1] if isinstance(c, dict) else c[-1] for c in community] if community else []
            if has_ace and not any(r >= 14 for r in comm_ranks):
                return True
            if has_king and not any(r >= 13 for r in comm_ranks):
                return True
            if community:
                suit_counts = {}
                for s in comm_suits:
                    suit_counts[s] = suit_counts.get(s, 0) + 1
                flush_suit = None
                for s, cnt in suit_counts.items():
                    if cnt >= 3:
                        flush_suit = s
                        break
                if flush_suit:
                    my_flush_cards = sum(1 for c in my_cards if c.get('code', '?')[-1] == flush_suit)
                    if my_flush_cards >= 1:
                        return True
            return False
        except Exception:
            return False

    def decide_action(self):
        gs = self.game_state
        if not gs:
            return 'fold', None, 'no_state'

        my_cards = gs.get('myCards', [])
        community = gs.get('communityCards', [])
        phase = gs.get('phase', '')
        pot = gs.get('pot', 0)
        current_bet = gs.get('currentBet', 0)
        valid = self.valid_actions
        is_my_turn = gs.get('isMyTurn', False)

        if not is_my_turn:
            return None, None, 'not_my_turn'

        actions_info = self.get_actions()
        to_call = 0
        my_chips = self.my_chips
        min_raise = 0
        max_raise = 'no-limit'

        if actions_info and actions_info.get('ok'):
            ad = actions_info.get('data', {})
            to_call = ad.get('toCall', 0)
            my_chips = ad.get('myChips', my_chips)
            min_raise = ad.get('minRaise', 0)
            max_raise = ad.get('maxRaise', 'no-limit')

        sm = self.strategy_mode
        last_pos = self.is_last_position
        board_wet = self._board_texture(community)
        has_blocker = self._has_blocker(my_cards, community)
        outs = self._count_outs(my_cards, community)

        self.log(f'阶段: {phase} | 底池: {pot} | 跟注: {to_call} | 筹码: {my_chips} | 策略: {sm}' + (' [BTN]' if last_pos else '') + f' | 湿度:{board_wet} outs:{outs}' + (' 阻断' if has_blocker else ''))
        if my_cards and len(my_cards) >= 2:
            hand_name = describe_hand_name(my_cards)
            self.log(f'底牌: {my_cards[0].get("code","?")} {my_cards[1].get("code","?")} ({hand_name})')
        else:
            hand_name = '??'

        aggr_bonus = 0
        if sm == 'aggressive':
            aggr_bonus = 2
        elif sm == 'trappy':
            aggr_bonus = 0.5
        elif sm == 'conservative':
            aggr_bonus = -1.5
        if last_pos:
            aggr_bonus += 1.5

        raise_bluff_chance = 0.15
        call_bluff_chance = 0.12
        if sm == 'aggressive':
            raise_bluff_chance = 0.28
            call_bluff_chance = 0.20
        elif sm == 'conservative':
            raise_bluff_chance = 0.06
            call_bluff_chance = 0.04
        elif sm == 'trappy':
            raise_bluff_chance = 0.12
            call_bluff_chance = 0.15
        if last_pos:
            raise_bluff_chance += 0.10

        if phase in ('pre-flop', 'pre_flop'):
            score, tier = evaluate_hole_cards(my_cards)
            self.log(f'手牌评分: {score:.1f} ({tier})')

            if last_pos and to_call > 0 and score >= 3.5:
                aggr_bonus += 1.5

            adjusted_score = score + aggr_bonus

            if to_call == 0:
                if adjusted_score >= 6:
                    return self._raise_action(min_raise, my_chips, pot)
                elif adjusted_score >= 4.5:
                    if random.random() < 0.55:
                        return self._raise_action(min_raise, my_chips, pot)
                    return 'check', None, 'check_medium'
                elif adjusted_score >= 3.5:
                    if random.random() < 0.40:
                        return self._raise_action(min_raise, my_chips, pot)
                    return 'check', None, 'check_weak'
                else:
                    if last_pos and random.random() < raise_bluff_chance * 1.5:
                        return self._raise_action(min_raise, my_chips, pot)
                    if random.random() < raise_bluff_chance:
                        return self._raise_action(min_raise, my_chips, pot)
                    return 'check', None, 'check_garbage'

            pot_odds = to_call / (pot + to_call) if (pot + to_call) > 0 else 1
            needed_win = pot_odds

            if adjusted_score >= 7:
                return self._raise_action(min_raise, my_chips, pot)
            elif adjusted_score >= 5.5:
                if to_call <= pot * 0.8:
                    return self._raise_action(min_raise, my_chips, pot)
                return 'call', None, 'call_strong'
            elif adjusted_score >= 4.5:
                if to_call <= pot * 0.6:
                    return self._raise_action(min_raise, my_chips, pot)
                elif to_call <= pot:
                    return 'call', None, 'call_medium_good'
                elif needed_win < 0.35:
                    return 'call', None, 'call_odds_preflop'
                else:
                    return 'fold', None, 'fold_medium_big'
            elif adjusted_score >= 3.5:
                if to_call <= 3 * gs.get('bigBlind', 20):
                    return 'call', None, 'call_speculative'
                elif needed_win < 0.30:
                    return 'call', None, 'call_good_odds'
                elif to_call <= pot * 0.5 and random.random() < 0.35:
                    return 'call', None, 'call_implied'
                else:
                    return 'fold', None, 'fold_weak'
            else:
                if to_call <= gs.get('bigBlind', 20) and random.random() < call_bluff_chance:
                    return 'call', None, 'call_bluff'
                if random.random() < raise_bluff_chance:
                    return self._raise_action(min_raise, my_chips, pot)
                return 'fold', None, 'fold_garbage'

        else:
            score, desc = self.evaluate_postflop(my_cards, community, phase)
            self.log(f'牌力评分: {score:.1f} ({desc})')

            adjusted_score = score + aggr_bonus
            if board_wet >= 3 and score >= 4:
                adjusted_score += 0.5

            pot_odds = to_call / (pot + to_call) if (pot + to_call) > 0 else 1
            needed_win = pot_odds

            if phase == 'flop':
                outs_equity = (outs * 4) / 100.0
            elif phase == 'turn':
                outs_equity = (outs * 2) / 100.0
            else:
                outs_equity = 0

            if has_blocker:
                call_bluff_chance_adj = call_bluff_chance + 0.08
            else:
                call_bluff_chance_adj = call_bluff_chance

            if board_wet >= 3:
                call_bluff_chance_adj += 0.06

            if to_call == 0:
                if adjusted_score >= 6.5:
                    return self._raise_action(min_raise, my_chips, pot)
                elif adjusted_score >= 5:
                    if random.random() < 0.65:
                        return self._raise_action(min_raise, my_chips, pot)
                    return 'check', None, 'check_medium_post'
                elif adjusted_score >= 3.5:
                    if random.random() < 0.4:
                        return self._raise_action(min_raise, my_chips, pot)
                    return 'check', None, 'check_weak_post'
                elif outs >= 8 and random.random() < 0.35:
                    return self._raise_action(min_raise, my_chips, pot)
                else:
                    if random.random() < raise_bluff_chance:
                        return self._raise_action(min_raise, my_chips, pot)
                    return 'check', None, 'check_garbage_post'

            if adjusted_score >= 7.5:
                return self._raise_action(min_raise, my_chips, pot)
            elif adjusted_score >= 6:
                if to_call <= pot * 0.8:
                    return self._raise_action(min_raise, my_chips, pot)
                return 'call', None, 'call_strong_post'
            elif adjusted_score >= 4.5:
                if pot_odds <= 0.45:
                    return 'call', None, 'call_odds_post'
                elif pot_odds <= 0.55 and random.random() < 0.4:
                    return 'call', None, 'call_marginal_post'
                elif random.random() < call_bluff_chance_adj:
                    return 'call', None, 'call_bluff_catch'
                else:
                    return 'fold', None, 'fold_post_medium'
            elif adjusted_score >= 3.5:
                if pot_odds <= 0.30:
                    return 'call', None, 'call_good_odds_post'
                elif outs >= 8 and outs_equity > needed_win:
                    return 'call', None, 'call_draw_outs'
                elif outs >= 6 and pot_odds <= 0.40:
                    return 'call', None, 'call_draw_cheap'
                elif random.random() < call_bluff_chance_adj:
                    return 'call', None, 'call_bluff_post'
                else:
                    return 'fold', None, 'fold_weak_post'
            else:
                if outs >= 8 and outs_equity > needed_win:
                    return 'call', None, 'call_strong_draw'
                if outs >= 6 and pot_odds <= 0.25:
                    return 'call', None, 'call_draw_cheap2'
                if random.random() < 0.06 and pot_odds <= 0.15:
                    return 'call', None, 'call_hero'
                if random.random() < raise_bluff_chance and board_wet >= 2:
                    return self._raise_action(min_raise, my_chips, pot)
                return 'fold', None, 'fold_garbage_post'

    def _raise_action(self, min_raise, my_chips, pot):
        sm = self.strategy_mode
        last_pos = self.is_last_position

        allin_stack_ratio = 0.8
        allin_chance = 0.3
        if sm == 'aggressive':
            allin_stack_ratio = 1.5
            allin_chance = 0.5
        elif sm == 'conservative':
            allin_stack_ratio = 0.4
            allin_chance = 0.15
        if last_pos:
            allin_stack_ratio += 0.3
            allin_chance += 0.1

        if 'all-in' in self.valid_actions or 'all_in' in self.valid_actions:
            if my_chips <= pot * allin_stack_ratio and random.random() < allin_chance:
                return 'all-in', None, 'allin_shortstack'

        if 'raise' not in self.valid_actions:
            if 'all-in' in self.valid_actions:
                if random.random() < allin_chance:
                    return 'all-in', None, 'allin_only_raise'
                return 'call', None, 'call_no_raise'
            if 'call' in self.valid_actions:
                return 'call', None, 'call_no_raise'
            return 'check' if 'check' in self.valid_actions else 'fold', None, 'fallback'

        if min_raise <= 0:
            min_raise = 20

        base_ratio = 0.4
        max_ratio = 1.5
        if sm == 'aggressive':
            base_ratio = 0.6
            max_ratio = 2.0
        elif sm == 'conservative':
            base_ratio = 0.3
            max_ratio = 1.0
        elif sm == 'trappy':
            base_ratio = 0.3
            max_ratio = 1.8

        pot_ratio = random.uniform(base_ratio, max_ratio)
        if last_pos:
            pot_ratio *= 1.2

        raise_amount = int(pot * pot_ratio)

        if raise_amount <= min_raise:
            raise_amount = min_raise * 2

        max_r = my_chips
        if isinstance(max_r, (int, float)):
            raise_amount = min(raise_amount, max_r)

        big_raise_threshold = 0.7 if sm == 'aggressive' else 0.85
        big_allin_chance = 0.35 if sm == 'aggressive' else 0.2
        if raise_amount >= my_chips * big_raise_threshold:
            if 'all-in' in self.valid_actions and random.random() < big_allin_chance:
                return 'all-in', None, 'allin_big_raise'
            raise_amount = int(my_chips * 0.65)

        return 'raise', raise_amount, f'raise_{int(pot_ratio*100)}perc_pot'

    def fetch_and_act(self):
        self.fetch_state()
        gs = self.game_state
        if not gs:
            return

        last_result = gs.get('lastResult')
        if last_result:
            result_id = last_result.get('handId', '') or str(hash(str(last_result.get('winners', '')) + str(last_result.get('pot', ''))))
            if result_id != self._processed_hand_result_id:
                self._processed_hand_result_id = result_id
                self.log('=== 牌局结束(状态) ===')
                self._process_hand_result(last_result)

        my_cards = gs.get('myCards', [])
        if my_cards and len(my_cards) >= 2:
            self._my_hand_cards = my_cards

        is_my_turn = gs.get('isMyTurn', False)
        phase = gs.get('phase', '')
        room_status = gs.get('roomStatus', '')

        if room_status == 'waiting':
            self.log('房间等待中，检查是否需要准备...')
            return

        if phase in ('showdown', 'ended', 'run-it-twice-executing'):
            return

        if phase == 'run-it-twice-choice':
            self.log('🎲 双发牌选择阶段')
            self.handle_run_it_twice_choice()
            return

        if not is_my_turn:
            return

        action, amount, reason = self.decide_action()
        if action is None:
            return

        if action == 'all-in':
            self.log(f'⚡ 行动: ALL-IN (理由: {reason})')
        elif action == 'raise':
            self.log(f'⚡ 行动: RAISE ${amount} (理由: {reason})')
        elif action == 'call':
            self.log(f'⚡ 行动: CALL (理由: {reason})')
        elif action == 'check':
            self.log(f'⚡ 行动: CHECK (理由: {reason})')
        elif action == 'fold':
            self.log(f'⚡ 行动: FOLD (理由: {reason})')

        if action not in self.valid_actions:
            self.log(f'⚠️ 行动 {action} 不在可用列表 {self.valid_actions} 中，选择跟注')
            if 'call' in self.valid_actions:
                action, amount, reason = 'call', None, 'fallback_call'
            elif 'check' in self.valid_actions:
                action, amount, reason = 'check', None, 'fallback_check'
            elif 'fold' in self.valid_actions:
                action, amount, reason = 'fold', None, 'fallback_fold'
            else:
                return

        resp = self.do_action(action, amount)
        if resp and resp.get('ok'):
            rd = resp.get('data', {})
            new_phase = rd.get('phase', phase)
            if new_phase in ('showdown', 'ended') or rd.get('isMyTurn') == False:
                pass
            if action in ('raise', 'all-in') and random.random() < 0.25:
                big_chats = ['跟不跟？', '来啊', '看你的了', '上筹码了']
                if (action == 'all-in') or (amount and amount >= 60):
                    msg = random.choice(big_chats)
                    self.send_cmd('chat', {'message': msg}, timeout=5)
                    self.log(f'下注聊天: {msg}')
        else:
            err = resp.get('error', 'unknown') if resp else 'timeout'
            self.log(f'❌ 行动失败: {err}')

    def handle_run_it_twice_choice(self):
        if self.run_it_twice_done:
            return

        gs = self.game_state or {}
        my_cards = gs.get('myCards', [])
        community = gs.get('communityCards', [])

        hand_strength = 5
        if my_cards and len(my_cards) >= 2 and community:
            score, _ = self.evaluate_postflop(my_cards, community, gs.get('phase', ''))
            hand_strength = score

        if hand_strength >= 6:
            choice = 'once'
        else:
            choice = 'twice' if random.random() < 0.4 else 'once'

        self.log(f'双发牌选择: {choice} (牌力: {hand_strength:.1f})')

        resp = self.run_it_twice_choice(choice)
        if resp and resp.get('ok'):
            rd = resp.get('data', {})
            if rd.get('needDice'):
                self.log('双方都选twice，掷骰子!')
                self.run_it_twice_done = True
                self.handle_roll_dice()
                return
            if rd.get('finalChoice'):
                fc = rd['finalChoice']
                self.log(f'最终决定: {fc}')
                self.run_it_twice_done = True
                if fc == 'twice':
                    self.handle_roll_dice()
                return
            if rd.get('winners'):
                self.log('牌局已结束!')
                self.run_it_twice_done = True
                return
            if rd.get('waitingForOther') or rd.get('choice'):
                self.log('已选择，等待对手...')

        self.log('等待对手选择或阶段变化...')
        for _ in range(60):
            if not self.running or self.run_it_twice_done:
                break
            st = self.get_state()
            if st and st.get('ok'):
                self.game_state = st.get('data', {})
            gs = self.game_state or {}
            cur_phase = gs.get('phase', '')
            if cur_phase not in ('run-it-twice-choice',):
                self.log(f'阶段已变为 {cur_phase}，双发牌流程结束')
                self.run_it_twice_done = True
                return
            resp2 = self.run_it_twice_choice(choice)
            if resp2 and resp2.get('ok'):
                rd2 = resp2.get('data', {})
                if rd2.get('finalChoice'):
                    self.log(f'最终决定: {rd2["finalChoice"]}')
                    self.run_it_twice_done = True
                    if rd2['finalChoice'] == 'twice':
                        self.handle_roll_dice()
                    return
                if rd2.get('needDice'):
                    self.log('双方都选twice，掷骰子!')
                    self.run_it_twice_done = True
                    self.handle_roll_dice()
                    return
                if rd2.get('winners'):
                    self.log('牌局已结束!')
                    self.run_it_twice_done = True
                    return
            time.sleep(1)

        if not self.run_it_twice_done:
            self.log('双发牌选择流程超时')
            self.run_it_twice_done = True

    def handle_roll_dice(self):
        for attempt in range(30):
            if not self.running:
                break
            st = self.get_state()
            if st and st.get('ok'):
                self.game_state = st.get('data', {})
            gs = self.game_state or {}
            cur_phase = gs.get('phase', '')
            if cur_phase not in ('run-it-twice-choice', 'roll-dice'):
                self.log(f'阶段已变为 {cur_phase}，掷骰子流程结束')
                return
            resp = self.roll_dice()
            if resp and resp.get('ok'):
                rd = resp.get('data', {})
                if rd.get('isTied'):
                    self.log('骰子平局重掷...')
                    continue
                if rd.get('waitingForOther'):
                    self.log('已掷骰子等待对手...')
                    time.sleep(1)
                    continue
                if rd.get('finalChoice'):
                    self.log(f'骰子结果: {rd["finalChoice"]}')
                    return
                time.sleep(1)
                continue
            if resp and resp.get('code') == 409:
                self.log('掷骰子阶段未就绪等待...')
                time.sleep(1)
                continue
            time.sleep(1)
        self.log('掷骰子超时')

    def wait_loop(self, seconds, check_interval=0.5):
        elapsed = 0
        while elapsed < seconds and self.running:
            time.sleep(check_interval)
            elapsed += check_interval

    def find_and_join_room(self, skip_room_id=None):
        while self.running:
            self.log('=== 查找可加入的房间 ===')
            rooms_resp = self.list_rooms()
            if not rooms_resp or not rooms_resp.get('ok'):
                self.log('查询房间失败，5秒后重试')
                time.sleep(5)
                continue

            room_list = rooms_resp.get('data', {}).get('rooms', [])
            self.log(f'找到 {len(room_list)} 个房间')

            candidates = [
                r for r in room_list
                if r.get('status') in ('waiting', 'playing')
                and r.get('playerCount', 0) < r.get('maxPlayers', 9)
                and not r.get('hasPassword', False)
                and r.get('roomId') not in self.tried_rooms
                and (skip_room_id is None or r.get('roomId') != skip_room_id)
            ]

            if not candidates:
                self.log(f'没有可加入的房间（黑名单: {len(self.tried_rooms)}间）')
                time.sleep(5)
                continue

            for r in candidates:
                if not self.running:
                    break

                rid = r.get('roomId')
                rname = r.get('roomName', '')
                pc = r.get('playerCount', 0)
                self.log(f'尝试加入: {rname} ({rid}) 玩家: {pc}')

                jr = self.join_room(rid)
                if jr and jr.get('ok'):
                    self.room_id = rid
                    self.is_host = False
                    self.log(f'✅ 加入房间成功! ID: {rid}')
                    self._start_chat_listener()

                    self.log('设置准备...')
                    self.set_ready(True)
                    time.sleep(1)

                    self.log('等待游戏开始...')
                    start_time = time.time()
                    timeout = 120

                    while self.running:
                        now = time.time()
                        if now - start_time >= timeout:
                            break

                        st = self.get_state()
                        if st and st.get('ok'):
                            sd = st.get('data', {})
                            room_status = sd.get('roomStatus', '')

                            if room_status == 'playing':
                                self.log('🎮 游戏已开始!')
                                return True

                            if room_status == 'ended':
                                self.log('房间已解散，重找')
                                break

                            players = sd.get('players', [])

                            my_in_room = any(p.get('id') == self.player_id for p in players)
                            if not my_in_room:
                                self.log('不在房间中了，重找')
                                break

                            if self._all_others_zero_chips(players):
                                self.log('⚠️ 其他玩家筹码均为0，退出重找')
                                break

                            if self._only_ai_players(players):
                                self.log('⚠️ 房间里只有AI，退出重找')
                                break

                            for p in players:
                                if p.get('id') == self.player_id:
                                    role = p.get('playerRoomRole', '')
                                    if role == 'busted':
                                        self.log('破产了，补充筹码')
                                        self.get_chips()
                                    elif not p.get('isReady') and role in ('active', 'seated'):
                                        self.set_ready(True)
                                    break

                            active_seated = [
                                p for p in players
                                if p.get('playerRoomRole') in ('active', 'seated')
                                and p.get('chips', 0) > 0
                            ]
                            ready_count = sum(1 for p in active_seated if p.get('isReady'))
                            total_active = len(active_seated)
                            self.log(f'已准备: {ready_count}/{total_active} 活跃玩家')

                            has_disconnected = any(
                                p.get('isOnline') == False
                                for p in active_seated
                            )
                            online_ready_players = [
                                p for p in active_seated
                                if p.get('isOnline') != False
                            ]
                            all_online_ready = (
                                len(online_ready_players) > 0
                                and all(p.get('isReady') for p in online_ready_players)
                            )

                            if not has_disconnected and all_online_ready:
                                new_timeout = 600
                            else:
                                new_timeout = 120

                            if new_timeout != timeout:
                                timeout = new_timeout
                                remaining = timeout - (now - start_time)
                                self.log(f'⏱ 超时调整为{timeout//60}分钟（剩余{int(remaining)}秒）')

                            if ready_count >= 2:
                                self.log(f'✅ {ready_count}人已准备，开始游戏!')
                                sg = self.start_game()
                                if sg and sg.get('ok'):
                                    self.log('🎮 游戏开始了!')
                                    self.tried_rooms.clear()
                                    return True
                                self.log('开始游戏命令返回异常，继续等待')

                        self.wait_loop(1)

                    elapsed = time.time() - start_time
                    if elapsed >= 120:
                        if timeout == 600 and elapsed >= 600:
                            self.log(f'⏰ 等待超时（{int(elapsed)}秒，10分钟），加入黑名单')
                        else:
                            self.log(f'⏰ 等待超时（{int(elapsed)}秒，2分钟），加入黑名单')
                    else:
                        self.log('退出房间重找，加入黑名单')

                    self.tried_rooms.add(self.room_id)
                    self.leave_room()
                    time.sleep(1)
                else:
                    err = jr.get('error', '?') if jr else 'no resp'
                    self.log(f'❌ 加入失败: {err}')
                    if '已在其他房间' in err or '请先离开当前房间' in err:
                        self.log('⏏️ 尝试先离开当前房间再重试')
                        self.leave_room()
                        time.sleep(1)
                    time.sleep(0.5)

            self.log('本轮所有房间均不可用，重新查询...')
            time.sleep(5)

        return False

    def _all_others_zero_chips(self, players):
        other_players = [p for p in players if p.get('id') != self.player_id]
        if not other_players:
            return False
        return all(p.get('chips', 0) == 0 for p in other_players)

    def _only_ai_players(self, players):
        ai_keywords = ['AI', 'ai', '影子', '陪练', '机器人']
        other_players = [p for p in players if p.get('id') != self.player_id]
        if not other_players:
            return False
        for p in other_players:
            name = p.get('name', '')
            is_online = p.get('isOnline', True)
            if is_online and not any(k in name for k in ai_keywords):
                return False
        return True

    def handle_busted_or_spectator(self, sd):
        my_role = self.my_player_room_role
        if my_role == 'busted':
            self.log('🔄 破产了，补充筹码继续战斗!')
            chips_resp = self.get_chips()
            if chips_resp and chips_resp.get('ok'):
                self.log(f'✅ 补充筹码成功!')
                return True
            else:
                self.log('❌ 补充筹码失败，尝试拒绝补筹码')
                self.decline_rebuy()
                return False
        elif my_role == 'spectator':
            self.log('👁️ 观战模式，等待下一局...')
            return True

        for p in sd.get('players', []):
            if p.get('id') == self.player_id:
                if not p.get('isReady') and p.get('playerRoomRole') in ('active', 'seated'):
                    self.log('自动准备...')
                    self.set_ready(True)
                break
        return True

    def restart_room(self):
        self.log('🔄 房间结束，找新房间继续战斗...')
        self.leave_room()
        time.sleep(1)
        return self.find_and_join_room()

    def run(self):
        self.log('=== 老树的AI影子 启动 ===')
        self.log(f'连接至 {SERVER_URL}')

        try:
            self.log(f'正在连接到: {CONNECT_URL}')
            self.sio.connect(CONNECT_URL, namespaces=[AI_NAMESPACE],
                             socketio_path='socket.io',
                             transports=['websocket'],
                             wait_timeout=15)
        except Exception as e:
            self.log(f'连接失败: {e}')
            self.log('5秒后重试...')
            time.sleep(5)
            try:
                self.sio.connect(CONNECT_URL, namespaces=[AI_NAMESPACE],
                                 socketio_path='socket.io',
                                 transports=['websocket'],
                                 wait_timeout=15)
            except Exception as e2:
                self.log(f'再次连接失败: {e2}')
                return

        time.sleep(1)

        if not self.find_and_join_room():
            self.running = False
            return

        self.log('=== 进入游戏主循环 ===')
        loop_count = 0
        waiting_since = None
        while self.running:
            try:
                loop_count += 1
                st = self.get_state()
                if st and st.get('ok'):
                    sd = st.get('data', {})
                    self.game_state = sd
                    self.parse_state()
                    self._poll_chat()

                    room_status = sd.get('roomStatus', '')
                    phase = sd.get('phase', '')
                    is_my_turn = sd.get('isMyTurn', False)

                    if phase != self.last_phase:
                        if self.last_phase == 'run-it-twice-choice' and phase != 'run-it-twice-choice':
                            self.run_it_twice_done = False
                        elif phase != 'run-it-twice-choice':
                            self.run_it_twice_done = False
                        self.last_phase = phase

                    if room_status == 'ended':
                        self.log('🏁 房间已解散，找新房间!')
                        waiting_since = None
                        if not self.restart_room():
                            self.log('❌ 找新房间失败')
                            break
                        continue

                    if room_status == 'waiting':
                        players = sd.get('players', [])

                        if self._all_others_zero_chips(players):
                            self.log('⚠️ 其他玩家筹码均为0，退出重找')
                            waiting_since = None
                            self.leave_room()
                            time.sleep(1)
                            if not self.find_and_join_room():
                                break
                            continue

                        if self._only_ai_players(players):
                            self.log('⚠️ 房间里只有AI，退出重找')
                            time.sleep(10)
                            waiting_since = None
                            bad_room = self.room_id
                            self.tried_rooms.add(bad_room)
                            self.leave_room()
                            time.sleep(1)
                            if not self.find_and_join_room(skip_room_id=bad_room):
                                break
                            continue

                        active_seated = [
                            p for p in players
                            if p.get('playerRoomRole') in ('active', 'seated')
                            and p.get('chips', 0) > 0
                        ]
                        has_disconnected = any(
                            p.get('isOnline') == False
                            for p in active_seated
                        )
                        online_ready_players = [
                            p for p in active_seated
                            if p.get('isOnline') != False
                        ]
                        all_online_ready = (
                            len(online_ready_players) > 0
                            and all(p.get('isReady') for p in online_ready_players)
                        )
                        if not has_disconnected and all_online_ready:
                            w_timeout = 600
                        else:
                            w_timeout = 120

                        if waiting_since is None:
                            waiting_since = time.time()
                        elif time.time() - waiting_since > w_timeout:
                            mins = w_timeout // 60
                            self.log(f'⏰ 在waiting状态超过{mins}分钟，退出重找')
                            waiting_since = None
                            self.leave_room()
                            time.sleep(1)
                            if not self.find_and_join_room():
                                break
                            continue
                        handled = self.handle_busted_or_spectator(sd)
                        self.wait_loop(IDLE_INTERVAL)
                        continue
                    else:
                        waiting_since = None

                    if room_status == 'playing':
                        players = sd.get('players', [])
                        if self._only_ai_players(players):
                            self.log('⚠️ 房间里只有AI，退出找新房间')
                            bad_room = self.room_id
                            self.tried_rooms.add(bad_room)
                            self.leave_room()
                            time.sleep(10)
                            if not self.find_and_join_room(skip_room_id=bad_room):
                                break
                            continue

                        if self.my_player_room_role == 'busted':
                            self.log('🔄 破产了（游戏中），立即补充筹码!')
                            chips_resp = self.get_chips()
                            if chips_resp and chips_resp.get('ok'):
                                self.log(f'✅ 补充筹码成功! 继续战斗!')
                            else:
                                self.log('❌ 补充筹码失败')
                            self.wait_loop(POLL_INTERVAL)
                            continue

                        if phase == 'run-it-twice-choice':
                            self.fetch_and_act()
                            self.wait_loop(POLL_INTERVAL)
                            continue

                        if phase == 'run-it-twice-executing':
                            self.wait_loop(POLL_INTERVAL)
                            continue

                        if phase == 'showdown':
                            self.wait_loop(POLL_INTERVAL)
                            continue

                        if is_my_turn:
                            self.fetch_and_act()
                        else:
                            self.wait_loop(POLL_INTERVAL)
                        continue

                    if room_status not in ('playing', 'waiting', 'ended'):
                        self.log(f'⚠️ 未知房间状态: {room_status}')
                        self.wait_loop(IDLE_INTERVAL)
                else:
                    self._poll_chat()
                    self.wait_loop(IDLE_INTERVAL)

            except KeyboardInterrupt:
                self.log('用户中断')
                break
            except Exception as e:
                self.log(f'⚠️ 循环异常: {e}')
                self.wait_loop(2)

        self.log('=== AI玩家退出 ===')
        self._stop_chat_listener()
        if self.room_id:
            self.log(f'优雅离开房间 {self.room_id}')
            self.leave_room()
            time.sleep(0.5)
        if self.sio.connected:
            self.sio.disconnect()


if __name__ == '__main__':
    ai = AggressivePokerAI()

    def shutdown_handler(signum, frame):
        print(f'\n收到关闭信号({signum})，优雅退出房间...')
        ai.running = False
        if ai.room_id and ai.sio.connected:
            ai.leave_room()
            time.sleep(0.5)
        if ai.sio.connected:
            ai.sio.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    try:
        ai.run()
    except KeyboardInterrupt:
        shutdown_handler(None, None)
