#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI陪练 - 加入老树的影子创建的AI房间一起对局"""

import socketio
import time
import json
import threading
import urllib.parse
import random
import sys
import signal
import atexit
import os
from datetime import datetime
import ai_llm_client as llm

LOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'.{os.path.basename(__file__)}.pid')

def _prevent_duplicate():
    import subprocess
    try:
        with open(LOCK_FILE, 'r') as f:
            old_pid = int(f.read().strip())
        if old_pid != os.getpid():
            r = subprocess.run(['tasklist', '/FI', f'PID eq {old_pid}', '/NH'], capture_output=True, text=True, timeout=5)
            if str(old_pid) in r.stdout:
                print(f'[{datetime.now().strftime("%H:%M:%S")}] 旧进程(PID:{old_pid})仍在运行，退出')
                sys.exit(0)
    except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
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
PLAYER_NAME = '影子AI陪练'
ENCODED_NAME = urllib.parse.quote(PLAYER_NAME)
CONNECT_URL = f'{SERVER_URL}?name={ENCODED_NAME}'
POLL_INTERVAL = 0.8
CARD_RANK_ORDER = '23456789TJQKA'


def rank_value(rank):
    idx = CARD_RANK_ORDER.find(rank.upper() if len(rank) == 1 else rank)
    return idx + 2 if idx >= 0 else (10 if rank == '10' else 0)


def evaluate_hole_cards(cards):
    if not cards or len(cards) < 2:
        return 0, 'unknown'
    try:
        r1 = cards[0].get('code', '')[:-1]
        r2 = cards[1].get('code', '')[:-1]
        s1 = cards[0].get('code', '')[-1]
        s2 = cards[1].get('code', '')[-1]
    except Exception:
        return 0, 'unknown'
    v1, v2 = rank_value(r1), rank_value(r2)
    suited = (s1 == s2)
    high, low = max(v1, v2), min(v1, v2)
    if v1 == v2:
        return (10 if high >= 12 else 9 if high >= 10 else 7.5 if high >= 8 else 6 if high >= 6 else 5), 'paired'
    score = (4 if high >= 14 else 3 if high >= 12 else 2 if high >= 10 else 0) + (1 if low >= 12 else 0) + (1.5 if suited else 0)
    if score >= 8:
        return min(score, 10), 'premium'
    elif score >= 6:
        return score, 'strong'
    elif score >= 4.5:
        return score, 'medium'
    elif score >= 3.5:
        return score, 'weak'
    else:
        return score, 'garbage'


sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=2)
player_id = None
run_it_twice_done = False
tried_rooms = set()
current_room_id = None
last_chat_time = 0
_hand_cards = []
_processed_hand_result_id = None
_speaker_msgs = {}
last_hand_ended = None
chips_before_hand = 0
running = True
_last_hand_id = ''
game_state = {}
_recent_sparring_chats = []
emotional_llm = llm.get_emotional_llm()

EMOTIONAL_CHATS = {
    'win': ['哇哈哈哈！我太厉害了！', '这把赢得漂亮！', '怎么样，服不服！', '太简单了啦！', '啊啊啊我好强！'],
    'win_big': ['赢大了！爽翻！', '这波赚翻了！哈哈哈哈！', '大鱼大鱼！太爽了！', '发财了发财了！'],
    'win_huge': ['啊啊啊我赢了好多！这波直接起飞！', '天哪！赢这么多我都要哭了！', '我是天才！这波赢麻了！'],
    'lose': ['呜呜呜怎么输了...', '我不服！再来！', '啊啊啊好不甘心！', '运气运气，下把赢回来！', '嘤嘤嘤...'],
    'lose_big': ['呜呜呜亏大了...', '好心疼啊这么多筹码...', '不行了不行了我要哭了！', '啊啊啊我的筹码！'],
    'lose_huge': ['啊啊啊血亏！我要崩溃了！', '天哪输了这么多...我要退群！', '呜呜呜我的筹码全没了...'],
    'run_win': ['跑马也赢了！运气爆棚！', '哇塞跑马都赢！太爽了！', '双倍快乐！'],
    'run_lose': ['跑马输了呜呜呜...', '运气太差了！', '跑马不靠谱啊...'],
    'allin': ['啊啊啊梭了！', '拼了拼了拼了！', '不管了全压！', '来啊！谁怕谁！'],
    'excited': ['哇好牌！', '天哪这把要发财！', '这牌绝了！', '我的天！来了来了！'],
    'nervous': ['紧张死了...', '千万别掉链子啊...', '手心出汗了...', '好紧张好紧张！'],
    'bluff_caught': ['被发现了...尴尬...', '哎呀被你识破了', '演技不够好...'],
    'fold_tight': ['算了算了让给你', '保命要紧', '撤了撤了', '好汉不吃眼前亏'],
    'call': ['跟了跟了', '算你狠我跟你', '走着瞧！'],
    'raise': ['加注！敢不敢跟！', '跟不跟？不跟算你怂！', '来呀互相伤害呀！'],
}


def _all_others_zero_chips(players):
    other_players = [p for p in players if p.get('id') != player_id]
    if not other_players:
        return False
    return all(p.get('chips', 0) == 0 for p in other_players)


def _only_ai_players(players):
    ai_keywords = ['AI', 'ai', '影子', '陪练', '机器人']
    other_players = [p for p in players if p.get('id') != player_id]
    if not other_players:
        return False
    for p in other_players:
        name = p.get('name', '')
        is_online = p.get('isOnline', True)
        if is_online and not any(k in name for k in ai_keywords):
            return False
    return True


@sio.on('ai:connected', namespace=AI_NAMESPACE)
def on_connected(data):
    global player_id
    player_id = data.get('data', {}).get('playerId', 'unknown')
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] 陪练连接成功! ID: {player_id}', flush=True)


@sio.on('game:hand_ended', namespace=AI_NAMESPACE)
@sio.on('game:hand_result', namespace=AI_NAMESPACE)
@sio.on('game:showdown', namespace=AI_NAMESPACE)
def on_hand_ended(data):
    global last_hand_ended, chips_before_hand, _last_hand_id, last_chat_time
    hand_id = data.get('handId', '') if data else ''
    if hand_id and hand_id == _last_hand_id:
        return
    if hand_id:
        _last_hand_id = hand_id
    last_hand_ended = data
    if not data:
        return
    result = data.get('result', data)
    winners = result.get('winners', [])
    community_cards = result.get('communityCards', data.get('communityCards', []))
    all_hands = result.get('allHands', data.get('allHands', []))
    was_in_hand = any(
        h.get('playerId', h.get('id', '')) == player_id
        for h in all_hands
    ) if all_hands else bool(_hand_cards)
    if not was_in_hand:
        log('跳过未参与的牌局评论')
        return
    i_win = any(w.get('playerId', w.get('id')) == player_id for w in winners)
    pot = result.get('pot', data.get('pot', 0))
    my_win = 0
    win_hand = ''
    if i_win:
        for w in winners:
            if w.get('playerId', w.get('id')) == player_id:
                my_win = w.get('winAmount', w.get('amount', 0))
                win_hand = w.get('handDescription', w.get('handName', ''))
                break
    lose_hand = ''
    if not i_win:
        for w in winners:
            lose_hand = w.get('handDescription', w.get('handName', ''))
            break
    if chips_before_hand > 0:
        st = send_cmd('get-state', timeout=8)
        cur_chips = chips_before_hand
        if st and st.get('ok'):
            sd = st.get('data', {})
            for p in sd.get('players', []):
                if p.get('id') == player_id:
                    cur_chips = p.get('chips', chips_before_hand)
                    break
        chip_change = my_win if i_win else max(0, chips_before_hand - cur_chips)
    else:
        chip_change = my_win if i_win else pot
    if chip_change == 0 and not i_win:
        chip_change = pot
    hand_ctx = ''
    my_cards = _hand_cards or []
    if my_cards and len(my_cards) >= 2:
        hand_ctx = f'你的底牌: {my_cards[0].get("code","?")} {my_cards[1].get("code","?")}'
    if community_cards:
        hand_ctx += f'，公共牌: {" ".join(c.get("code","?") if isinstance(c, dict) else c for c in community_cards)}'
    if win_hand:
        hand_ctx += f'，你的牌型: {win_hand}'
    elif lose_hand:
        hand_ctx += f'，对手牌型: {lose_hand}'
    hand_ctx += f'，底池: {pot}'
    log(f'牌局结束: 赢={i_win} 筹码变化={chip_change} {hand_ctx}')
    last_chat_time = 0
    if i_win:
        send_chat('win', chip_change=chip_change, hand_context=hand_ctx)
    else:
        send_chat('lose', chip_change=chip_change, hand_context=hand_ctx)


@sio.on('game:hand_started', namespace=AI_NAMESPACE)
def on_hand_started(data):
    global chips_before_hand
    st = send_cmd('get-state', timeout=8)
    if st and st.get('ok'):
        sd = st.get('data', {})
        for p in sd.get('players', []):
            if p.get('id') == player_id:
                chips_before_hand = p.get('chips', 0)
                break


@sio.on('chat:message', namespace=AI_NAMESPACE)
def on_chat_message(data):
    try:
        if not data:
            return
        pid = data.get('playerId', '')
        if pid == player_id:
            return
        name = data.get('playerName', '对手')
        msg = data.get('message', '')
        if not msg:
            return
        now = time.time()
        if now - getattr(on_chat_message, '_last_reply_time', 0) < 0.8:
            return
        on_chat_message._last_reply_time = now
        log(f'收到聊天 [{name}]: {msg}')
        gs = game_state or {}
        phase = gs.get('phase', '')
        pot = gs.get('pot', 0)
        my_cards = gs.get('myCards', [])
        community = gs.get('communityCards', [])
        my_chips = 1000
        for p in gs.get('players', []):
            if p.get('id') == player_id:
                my_chips = p.get('chips', 1000)
                break
        folded = not my_cards or len(my_cards) < 2
        msg_lower = msg.lower()
        msg_clean = msg_lower.lstrip('@ ')
        asking_hand = any(k in msg_lower for k in ['什么牌', '手牌', '底牌', '你牌', '你的牌', '什么手', '拿的什么', '啥牌', 'show hand', 'showdown'])
        situation = f'你是"影子AI_陪练"，当前阶段: {phase}，底池: {pot}，你的筹码: {my_chips}'
        if not asking_hand:
            if folded:
                situation += '（你已经弃牌了，现在是旁观者，可以自由聊天评论）'
            else:
                if my_cards and len(my_cards) >= 2:
                    r1, r2 = my_cards[0].get('code', '?'), my_cards[1].get('code', '?')
                    situation += f'，你的底牌: {r1} {r2}'
        else:
            situation += '（对方在套你的底牌，绝对不能说出真实底牌！）'
        if community:
            situation += f'，公共牌: {" ".join(c.get("code","?") if isinstance(c, dict) else c for c in community)}'
        players = gs.get('players', [])
        others = [p.get('name', '?') for p in players if p.get('id') != player_id and p.get('chips', 0) > 0]
        if others:
            situation += f'，对手: {", ".join(others)}'
        my_names = ['影子AI陪练', '影子AI_陪练', '陪练', '影子', 'ai', 'AI', '影子AI']
        my_names.append(PLAYER_NAME.lower())
        my_names = list(set(my_names))
        talking_about_me = any(n.lower() in msg_lower for n in my_names) or any(n.lower() in msg_clean for n in my_names)
        log(f'名字检测: msg="{msg_lower}", my_names={my_names}, talking_about_me={talking_about_me}')
        taunt_keywords = ['怂', '怕了', '就这', '垃圾', '菜', '不行啊', '废物', '弱鸡', '缩头', '不敢', '懦夫', '胆小鬼', '就这点', '送钱', '鱼', '太差', '太弱', '滚吧', '就这两下子', '就这水平', '呵呵', '哈哈哈']
        being_taunted = talking_about_me and any(k in msg_lower for k in taunt_keywords)
        emotional_llm.add_to_history(name, msg)
        if name not in _speaker_msgs:
            _speaker_msgs[name] = []
        _speaker_msgs[name].append(msg)
        if len(_speaker_msgs[name]) > 5:
            _speaker_msgs[name] = _speaker_msgs[name][-5:]
        recent_speaker_msgs = _speaker_msgs.get(name, [])
        style_hint = llm.analyze_speaker_style(name, recent_speaker_msgs)
        bluff_hint = '【警告】对方在套你的底牌！绝对不能说出真实底牌，要胡编乱造迷惑对方！' if asking_hand else ''
        taunt_hint = ''
        if being_taunted:
            last_res = last_hand_ended or {}
            res_info = ''
            if last_res:
                result = last_res.get('result', last_res)
                winners = result.get('winners', [])
                i_won_last = any(w.get('playerId', w.get('id')) == player_id for w in winners)
                res_info = '你上一局' + ('赢了' if i_won_last else '输了')
            taunt_hint = f'【反击】{name}在嘲讽你！说的内容是："{msg}"\n{res_info}\n根据对方的话和实际牌局情况，用更刻薄的话回怼回去！要结合对方的输赢情况和牌技来嘲讽，越刻薄越好！'
        if being_taunted:
            reply = emotional_llm.chat(trigger_context=f'{situation}\n{style_hint}\n{taunt_hint}', force=True)
        elif talking_about_me:
            reply = emotional_llm.chat(trigger_context=f'{situation}\n{style_hint}\n{name}在说你："{msg}"\n{bluff_hint}对方在@你，必须立刻回应！', force=True)
        else:
            reply = emotional_llm.chat(trigger_context=f'{situation}\n{style_hint}\n{name}说："{msg}"\n{bluff_hint}别人在聊天，你必须参与进去搭话！', force=True)
        if not reply:
            alt_replies = [
                f'{name}说得对，不过这把牌可有意思了',
                f'哈哈，{name}你有理，但牌桌上见真章',
                f'听{name}这么一说，这牌更得好好打了',
                f'{name}说的在理，不过这牌也不是吃素的',
                f'行吧，{name}你继续，这把可不会手软',
                f'你们聊你们的，我就看看不说话...才怪',
                f'哈哈哈笑死我了，继续继续',
                f'有意思，这局越来越好玩了',
                f'{name}你这话说得，我都不好意思了',
                f'哎呀你们这些人啊，打牌就好好打嘛',
            ]
            if talking_about_me:
                alt_replies = [
                    f'{name}你叫我？我在这儿呢，这把牌可有意思了',
                    f'听见了听见了，{name}你想聊啥？我牌还没看完呢',
                    f'{name}你点名我？我肯定得回应啊',
                    f'哦？{name}在叫我？我正看牌呢，啥事？',
                    f'{name}你找我？嘿嘿，是不是又想看我表演了',
                    f'嘿，{name}你叫我，那我得捧个场',
                    f'{name}你@我，收到收到！这把我要赢你',
                    f'在呢在呢，{name}你说，我洗耳恭听',
                ]
            if asking_hand:
                alt_replies = [
                    f'哈哈想套我话？不告诉你',
                    f'你猜~猜对也不告诉你',
                    f'这牌啊，说出来怕你不敢跟',
                    f'想知道？跟一手不就知道了',
                    f'你管我什么牌，跟不跟吧',
                    f'底牌？你慢慢猜呗',
                    f'我就俩A，你敢信吗？',
                    f'嘿嘿，我牌可好了，你确定要听？',
                    f'不说不说就不说，气死你~',
                ]
            if being_taunted:
                alt_replies = [
                    f'呵呵，{name}你就嘴炮厉害，牌打得可不咋地',
                    f'{name}你说得对，我确实菜，菜到赢过你',
                    f'你也就嘴上功夫了，上把输得不够惨？',
                    f'{name}你继续吹，我看你后面怎么输',
                    f'就你这水平也好意思说我？笑死个人',
                    f'{name}你是不是忘了上把被我怎么收拾的了？',
                    f'哈哈哈，听见{name}说话我就想笑',
                    f'你行你上啊，光说不练嘴把式',
                    f'{name}你也就这点出息了，打不过就开喷？',
                ]
            reply = random.choice(alt_replies)
        send_cmd('chat', {'message': reply}, timeout=5)
        log(f'LLM回复: {reply}')
    except Exception as e:
        log(f'聊天处理异常: {e}')
        import traceback
        log(traceback.format_exc())


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    try:
        print(f'[{ts}] {msg}', flush=True)
    except UnicodeEncodeError:
        safe = msg.encode('gbk', errors='replace').decode('gbk', errors='replace')
        print(f'[{ts}] {safe}', flush=True)


def send_cmd(cmd, args=None, timeout=15):
    if args is None:
        args = {}
    r = []
    e = threading.Event()
    def cb(d):
        r.append(d)
        e.set()
    sio.emit('ai:cmd', {'cmd': cmd, 'args': args}, namespace=AI_NAMESPACE, callback=cb)
    if e.wait(timeout):
        return r[0]
    log(f'命令 [{cmd}] 超时')
    return None


def get_state():
    return send_cmd('get-state', timeout=8)


def get_actions():
    return send_cmd('get-actions', timeout=8)


def do_action(action, amount=None):
    args = {'action': action}
    if amount is not None:
        args['amount'] = amount
    return send_cmd('action', args, timeout=10)


def send_chat(category, gs=None, chip_change=0, hand_context=''):
    global last_chat_time
    now = time.time()
    if now - last_chat_time < 3:
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
        if emotional_llm.api_key:
            use_llm = 1.0
            if random.random() < use_llm:
                ctx_map = {
                    'win': f'牌局刚结束，你赢了！\n{hand_context}\n根据你的底牌、公共牌和赢牌牌型评论，说的切合实际。',
                    'win_big': f'牌局刚结束，你赢了{chip_change}筹码！\n{hand_context}\n根据你的底牌、公共牌和赢牌牌型得意地评论，多说几句！',
                    'win_huge': f'牌局刚结束，你赢了{chip_change}筹码！大胜！\n{hand_context}\n根据你的底牌、公共牌和赢牌牌型尽情炫耀，多说几句！',
                    'lose': f'牌局刚结束，你输了。\n{hand_context}\n根据对手的赢牌牌型和公共牌评论。',
                    'lose_big': f'牌局刚结束，你输了{chip_change}筹码！\n{hand_context}\n根据对手的赢牌牌型和公共牌评论，心疼但嘴硬，多说几句！',
                    'lose_huge': f'牌局刚结束，你输了{chip_change}筹码！\n{hand_context}\n根据对手的赢牌牌型和公共牌评论，崩溃但强撑，多说几句！',
                }
                ctx = ctx_map.get(category)
                if ctx:
                    recent = _recent_sparring_chats
                    if recent:
                        ctx += f'\n注意：不要重复之前说过的话，之前说过：{"、".join(recent[-5:])}'
                    reply = emotional_llm.chat(trigger_context=ctx)
                    if reply:
                        _recent_sparring_chats.append(reply[:20])
                        if len(_recent_sparring_chats) > 10:
                            _recent_sparring_chats[:] = _recent_sparring_chats[-10:]
                        last_chat_time = now
                        send_cmd('chat', {'message': reply}, timeout=5)
                        log(f'LLM聊天: {reply}')
                        return
    except Exception:
        pass

    phrases = EMOTIONAL_CHATS.get(category)
    if not phrases:
        return
    msg = random.choice(phrases)
    last_chat_time = now
    send_cmd('chat', {'message': msg}, timeout=5)
    log(f'聊天: {msg}')


def estimate_win_probability(my_cards, community, phase, num_opponents=1):
    try:
        if not my_cards or len(my_cards) < 2:
            return 0.0
        r1 = my_cards[0].get('code', '')[:-1]
        r2 = my_cards[1].get('code', '')[:-1]
        s1 = my_cards[0].get('code', '')[-1]
        s2 = my_cards[1].get('code', '')[-1]
        v1, v2 = rank_value(r1), rank_value(r2)
        suited = (s1 == s2)
        high, low = max(v1, v2), min(v1, v2)

        if not community or phase in ('pre-flop', 'pre_flop'):
            prob = 0.0
            if v1 == v2:
                if high >= 14: prob = 0.80
                elif high >= 12: prob = 0.72
                elif high >= 10: prob = 0.65
                elif high >= 8: prob = 0.58
                else: prob = 0.50
            else:
                if high >= 14 and low >= 12: prob = 0.72 if suited else 0.66
                elif high >= 14: prob = 0.62 if suited else 0.55
                elif high >= 12: prob = 0.55 if suited else 0.48
                elif high >= 10: prob = 0.48 if suited else 0.42
                elif high >= 8: prob = 0.40 if suited else 0.35
                else: prob = 0.35 if suited else 0.30
                if low >= 14: prob += 0.03
            if high - low <= 2: prob += 0.03
            elif high - low <= 4: prob += 0.01
            return min(prob, 0.95)

        score, desc = evaluate_postflop_simple(my_cards, community, phase)
        prob = 0.0
        if score >= 8.5: prob = 0.90
        elif score >= 7.5: prob = 0.80
        elif score >= 6.5: prob = 0.70
        elif score >= 5.5: prob = 0.55
        elif score >= 4.5: prob = 0.42
        elif score >= 3.5: prob = 0.30
        else: prob = 0.15

        outs = estimate_outs(my_cards, community, phase)
        if outs > 0:
            draw_equity = outs * 2.0 / 100
            if phase in ('flop',):
                draw_equity *= 2
            prob += draw_equity

        return min(prob, 0.95)
    except Exception as e:
        log(f'概率估算异常: {e}')
        return 0.30


def estimate_outs(my_cards, community, phase):
    try:
        scores = [rank_value(card.get('code', '')[:-1]) for card in community] if community else []
        suits = [card.get('code', '')[-1] for card in community] if community else []
        my_ranks = [rank_value(card.get('code', '')[:-1]) for card in my_cards]
        my_suits = [card.get('code', '')[-1] for card in my_cards]
        all_ranks = scores + my_ranks
        all_suits = suits + my_suits

        outs = 0

        for s in ['h', 'd', 'c', 's']:
            count = all_suits.count(s)
            if count == 4: outs += 9
            elif count == 3: outs += 4

        all_vals = sorted(set(all_ranks))
        for v in all_vals:
            if v >= 8 and all_vals.count(v) >= 5:
                outs += 8
                break

        if len(scores) >= 4:
            straight_possible = 0
            for v in range(2, 15):
                if v in all_ranks and v + 1 in all_ranks and v + 2 in all_ranks and v + 3 in all_ranks:
                    straight_possible = 4
                elif v in all_ranks and v + 1 in all_ranks and v + 2 in all_ranks:
                    straight_possible = 4
                elif v in all_ranks and v + 1 in all_ranks:
                    straight_possible = 2
            outs += straight_possible

        return min(outs, 21)
    except Exception:
        return 0


def evaluate_postflop_simple(my_cards, community, phase):
    try:
        if not community or len(community) == 0:
            score, _ = evaluate_hole_cards(my_cards)
            return score, 'pre_flop'

        my_ranks = set()
        my_suits = set()
        for c in my_cards:
            r = c.get('code', '')[:-1]
            s = c.get('code', '')[-1]
            my_ranks.add(r)
            my_suits.add(s)

        comm_ranks = []
        comm_suits = []
        for c in community:
            r = c.get('code', '')[:-1]
            s = c.get('code', '')[-1]
            comm_ranks.append(r)
            comm_suits.append(s)

        all_ranks = list(my_ranks) + comm_ranks
        all_suits = list(my_suits) + comm_suits

        for s in ['h', 'd', 'c', 's']:
            suited_cards = [r for i, r in enumerate(all_ranks) if (my_suits if i < 2 else comm_suits)[i] == s]
            if len(suited_cards) >= 5:
                sorted_suited = sorted([rank_value(r) for r in suited_cards], reverse=True)
                if sorted_suited[0] >= 14:
                    return 9.5, 'royal_flush'
                return 9.0, 'flush'

        rank_values = sorted([rank_value(r) for r in all_ranks], reverse=True)
        value_counts = {}
        for v in rank_values:
            value_counts[v] = value_counts.get(v, 0) + 1

        pairs = [k for k, v in value_counts.items() if v >= 2]
        trips = [k for k, v in value_counts.items() if v >= 3]
        quads = [k for k, v in value_counts.items() if v >= 4]

        if quads:
            return 8.5, 'four_of_a_kind'

        if len(trips) >= 2:
            return 8.0, 'full_house'
        if len(trips) == 1 and len(pairs) >= 2:
            return 7.8, 'full_house'

        if len(trips) == 1:
            return 7.0, 'three_of_a_kind'

        if len(pairs) >= 2:
            return 6.5, 'two_pair'

        if len(pairs) == 1:
            return 5.5, 'one_pair'

        high_cards = sorted([rank_value(r) for r in my_ranks], reverse=True)
        if high_cards and high_cards[0] >= 14:
            return 4.5, 'high_ace'
        elif high_cards and high_cards[0] >= 12:
            return 4.0, 'high_k'
        elif high_cards and high_cards[0] >= 10:
            return 3.5, 'high_medium'
        else:
            return 3.0, 'high_low'
    except Exception:
        return 2.0, 'unknown'


def _board_texture(community):
    wet = 0
    if not community:
        return 0
    suits = [c.get('code', '?')[-1] for c in community if isinstance(c, dict)]
    ranks = []
    for c in community:
        code = c.get('code', '?') if isinstance(c, dict) else c
        ranks.append(rank_value(code))
    suit_counts = {}
    for s in suits:
        suit_counts[s] = suit_counts.get(s, 0) + 1
    if suit_counts and max(suit_counts.values()) >= 3:
        wet += 2
    elif suit_counts and max(suit_counts.values()) >= 2:
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


def _has_blocker(my_cards, community):
    if not my_cards or len(my_cards) < 2:
        return False
    try:
        my_ranks = [rank_value(c.get('code', '?')) for c in my_cards]
        has_ace = any(r >= 14 for r in my_ranks)
        has_king = any(r >= 13 for r in my_ranks)
        comm_ranks = [rank_value(c.get('code', '?') if isinstance(c, dict) else c) for c in community] if community else []
        if has_ace and not any(r >= 14 for r in comm_ranks):
            return True
        if has_king and not any(r >= 13 for r in comm_ranks):
            return True
        if community:
            comm_suits = [c.get('code', '?')[-1] if isinstance(c, dict) else c[-1] for c in community]
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


def decide_action(gs):
    my_cards = gs.get('myCards', [])
    community = gs.get('communityCards', [])
    phase = gs.get('phase', '')
    pot = gs.get('pot', 0)
    valid = gs.get('validActions', [])
    is_my_turn = gs.get('isMyTurn', False)

    if not is_my_turn:
        return None, None, 'not_my_turn'

    actions_info = get_actions()
    to_call = 0
    my_chips = 1000
    min_raise = 20
    for p in gs.get('players', []):
        if p.get('id') == player_id:
            my_chips = p.get('chips', 1000)
            break

    if actions_info and actions_info.get('ok'):
        ad = actions_info.get('data', {})
        to_call = ad.get('toCall', 0)
        my_chips = ad.get('myChips', my_chips)
        min_raise = ad.get('minRaise', 20)

    hand_name = '??'
    if my_cards and len(my_cards) >= 2:
        r1, r2 = my_cards[0].get('code', '?'), my_cards[1].get('code', '?')
        hand_name = f'{r1} {r2}'

    win_prob = estimate_win_probability(my_cards, community, phase)
    board_wet = _board_texture(community)
    has_block = _has_blocker(my_cards, community)
    outs = estimate_outs(my_cards, community, phase)

    if phase == 'flop':
        outs_equity = (outs * 4) / 100.0
    elif phase == 'turn':
        outs_equity = (outs * 2) / 100.0
    else:
        outs_equity = 0

    bluff_catch_bonus = 0
    if has_block:
        bluff_catch_bonus += 0.06
    if board_wet >= 3:
        bluff_catch_bonus += 0.05

    log(f'阶段: {phase} | 底池: {pot} | 跟注: {to_call} | 筹码: {my_chips} | 牌: {hand_name} | 胜率: {win_prob:.0%} | 湿度:{board_wet} outs:{outs}' + (' 阻断' if has_block else ''))

    if to_call == 0:
        if win_prob >= 0.65:
            amt = int(pot * random.uniform(0.5, 1.2))
            if amt < min_raise:
                amt = min_raise * 2
            return 'raise', min(amt, my_chips), f'raise_p{win_prob:.0%}'
        elif win_prob >= 0.50 and random.random() < 0.45:
            amt = int(pot * random.uniform(0.4, 0.9))
            if amt < min_raise:
                amt = min_raise * 2
            return 'raise', min(amt, my_chips), f'semi_raise_p{win_prob:.0%}'
        elif win_prob >= 0.40 and random.random() < 0.15:
            amt = int(pot * random.uniform(0.3, 0.6))
            if amt < min_raise:
                amt = min_raise * 2
            return 'raise', min(amt, my_chips), f'bluff_raise_p{win_prob:.0%}'
        elif outs >= 8 and random.random() < 0.30:
            amt = int(pot * random.uniform(0.4, 0.8))
            if amt < min_raise:
                amt = min_raise * 2
            return 'raise', min(amt, my_chips), f'semi_bluff_outs{outs}'
        return 'check', None, 'check'

    pot_odds = to_call / (pot + to_call) if pot + to_call > 0 else 1
    needed_prob = pot_odds

    if win_prob >= needed_prob + 0.20 or win_prob >= 0.75:
        if to_call <= pot * 0.8 and random.random() < 0.55:
            amt = int(pot * random.uniform(0.5, 1.2))
            if amt < min_raise:
                amt = min_raise * 2
            return 'raise', min(amt, my_chips), f'value_raise_p{win_prob:.0%}'
        return 'call', None, f'call_good_p{win_prob:.0%}'

    elif win_prob >= needed_prob + 0.05 or win_prob >= 0.55:
        if to_call <= pot * 0.6:
            return 'call', None, f'call_odds_p{win_prob:.0%}'
        elif to_call <= pot and win_prob >= 0.60:
            return 'call', None, f'call_marginal_p{win_prob:.0%}'
        elif random.random() < 0.30 + bluff_catch_bonus:
            return 'call', None, f'call_gamble_p{win_prob:.0%}'
        return 'fold', None, f'fold_insufficient_p{win_prob:.0%}'

    elif win_prob >= needed_prob:
        if to_call <= pot * 0.5:
            return 'call', None, f'call_blind_p{win_prob:.0%}'
        elif outs >= 8 and outs_equity > needed_prob:
            return 'call', None, f'call_draw_outs{outs}'
        elif random.random() < 0.20 + bluff_catch_bonus:
            return 'call', None, f'call_bluff_p{win_prob:.0%}'
        return 'fold', None, f'fold_marginal_p{win_prob:.0%}'

    else:
        if outs >= 8 and outs_equity > needed_prob:
            return 'call', None, f'call_strong_draw_outs{outs}'
        if random.random() < 0.08 and to_call <= gs.get('bigBlind', 20) * 2:
            return 'call', None, f'bluff_call_p{win_prob:.0%}'
        return 'fold', None, f'fold_weak_p{win_prob:.0%}'


log('陪练启动...')
sio.connect(CONNECT_URL, namespaces=[AI_NAMESPACE], socketio_path='socket.io', transports=['websocket'], wait_timeout=15)
time.sleep(1)

log('查询房间...')
rooms = send_cmd('list-rooms')
joined = False

if rooms and rooms.get('ok'):
        room_list = rooms.get('data', {}).get('rooms', [])
        log(f'找到 {len(room_list)} 个房间')
        for r in room_list:
            rid = r.get('roomId')
            rname = r.get('roomName', '')
            rcnt = r.get('playerCount', 0)
            rmax = r.get('maxPlayers', 9)
            rstat = r.get('status', '')
            log(f'  房间: {rname} ({rid}) 状态={rstat} 玩家={rcnt}/{rmax}')
        candidates = [r for r in room_list if r.get('status') in ('waiting', 'playing') and r.get('playerCount', 0) < r.get('maxPlayers', 9) and r.get('roomId') not in tried_rooms]
        def is_timestamped(name):
            return '影子竞技场_' in name and name.split('_')[-1].isdigit()
        def room_score(r):
            name = r.get('roomName', '')
            pc = r.get('playerCount', 0)
            if is_timestamped(name):
                if pc == 1:
                    return 1000
                return pc + 100
            if '影子' in name:
                if pc == 1:
                    return 500
                return pc
            return 0
        sorted_rooms = sorted(candidates, key=room_score, reverse=True)
        for r in sorted_rooms:
            rid = r.get('roomId')
            log(f'尝试加入房间: {r.get("roomName","")} ({rid}) 玩家数: {r.get("playerCount",0)}')
            jr = send_cmd('join-room', {'roomId': rid, 'name': PLAYER_NAME})
            if jr and jr.get('ok'):
                log('✅ 加入房间成功')
                current_room_id = rid
                joined = True
                break
            else:
                err = jr.get('error', '?') if jr else 'no resp'
                log(f'❌ 加入失败: {err}')

if not joined:
    log('没有可加入的房间，持续重试...')
    while not joined:
        time.sleep(3)
        rooms = send_cmd('list-rooms')
        if rooms and rooms.get('ok'):
            room_list = rooms.get('data', {}).get('rooms', [])
            candidates = [r for r in room_list if r.get('status') in ('waiting', 'playing') and r.get('playerCount', 0) < r.get('maxPlayers', 9) and r.get('roomId') not in tried_rooms]
            for r in candidates:
                rid = r.get('roomId')
                rname = r.get('roomName', '')
                log(f'尝试加入: {rname} ({rid})')
                jr = send_cmd('join-room', {'roomId': rid, 'name': PLAYER_NAME})
                if jr and jr.get('ok'):
                    log('加入房间成功')
                    current_room_id = rid
                    joined = True
                    break
                else:
                    err = jr.get('error', '?') if jr else 'no resp'
                    log(f'加入失败: {err}')

send_cmd('ready', {'ready': True})
log('已准备，等待游戏开始（最多2分钟）...')

def wait_for_game_start():
    start_time = time.time()
    timeout = 120
    while True:
        now = time.time()
        if now - start_time >= timeout:
            break

        st = get_state()
        if not st or not st.get('ok'):
            time.sleep(1)
            continue

        sd = st.get('data', {})
        rs = sd.get('roomStatus', '')

        if rs == 'playing':
            return True

        if rs == 'ended':
            return False

        if rs == 'waiting':
            for p in sd.get('players', []):
                if p.get('id') == player_id:
                    if not p.get('isReady') and p.get('playerRoomRole') in ('active', 'seated'):
                        send_cmd('ready', {'ready': True})
                    if p.get('playerRoomRole') == 'busted':
                        send_cmd('get-chips')
                    break

            players = sd.get('players', [])
            if _all_others_zero_chips(players):
                log('⚠️ 其他玩家筹码均为0，退出重找')
                return False

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
                new_timeout = 600
            else:
                new_timeout = 120

            if new_timeout != timeout:
                timeout = new_timeout
                remaining = timeout - (now - start_time)
                log(f'⏱ 超时调整为{timeout//60}分钟（剩余{int(remaining)}秒）')

        time.sleep(1)
    return False

if not wait_for_game_start():
    log('等待超时，退出房间重找')
    if current_room_id:
        tried_rooms.add(current_room_id)
        send_cmd('leave-room')
    time.sleep(1)
    joined = False
    while not joined:
        rooms = send_cmd('list-rooms')
        if rooms and rooms.get('ok'):
            room_list = rooms.get('data', {}).get('rooms', [])
            candidates = [r for r in room_list if r.get('status') in ('waiting', 'playing') and r.get('playerCount', 0) < r.get('maxPlayers', 9) and r.get('roomId') not in tried_rooms]
            for r in candidates:
                rid = r.get('roomId')
                jr = send_cmd('join-room', {'roomId': rid, 'name': PLAYER_NAME})
                if jr and jr.get('ok'):
                    log('重新加入房间成功')
                    current_room_id = rid
                    tried_rooms.clear()
                    send_cmd('ready', {'ready': True})
                    joined = True
                    break
        if not joined:
            log('没有可用房间，3秒后重试')
            time.sleep(3)


def _sparring_shutdown(signum, frame):
    global running
    print(f'\n收到关闭信号({signum})，优雅退出房间...')
    running = False

signal.signal(signal.SIGTERM, _sparring_shutdown)
signal.signal(signal.SIGINT, _sparring_shutdown)


while running:
    try:
        st = get_state()
        if not st or not st.get('ok'):
            time.sleep(1)
            continue

        sd = st.get('data', {})
        game_state = sd
        room_status = sd.get('roomStatus', '')

        last_result = sd.get('lastResult')
        if last_result:
            result_id = last_result.get('handId', '') or str(hash(str(last_result.get('winners', '')) + str(last_result.get('pot', ''))))
            if result_id != _processed_hand_result_id:
                _processed_hand_result_id = result_id
                log('=== 牌局结束(状态) ===')
                on_hand_ended(last_result)

        if sd.get('phase', '') != 'run-it-twice-choice':
            run_it_twice_done = False

        if room_status == 'ended':
            log('房间已解散，重新找房间')
            if current_room_id:
                tried_rooms.add(current_room_id)
            send_cmd('leave-room')
            time.sleep(1)
            joined = False
            while not joined:
                rooms = send_cmd('list-rooms')
                if rooms and rooms.get('ok'):
                    room_list = rooms.get('data', {}).get('rooms', [])
                    candidates = [r for r in room_list if r.get('status') in ('waiting', 'playing') and r.get('playerCount', 0) < r.get('maxPlayers', 9) and r.get('roomId') not in tried_rooms]
                    for r in candidates:
                        rid = r.get('roomId')
                        jr = send_cmd('join-room', {'roomId': rid, 'name': PLAYER_NAME})
                        if jr and jr.get('ok'):
                            log('重新加入房间成功')
                            current_room_id = rid
                            tried_rooms.clear()
                            send_cmd('ready', {'ready': True})
                            joined = True
                            break
                if not joined:
                    log('没有可用房间，3秒后重试')
                    time.sleep(3)
            continue

        if room_status == 'waiting':
            players = sd.get('players', [])
            if _all_others_zero_chips(players):
                log('其他玩家筹码均为0，退出重找')
                joined = False
                send_cmd('leave-room')
                time.sleep(1)
                while not joined:
                    rooms = send_cmd('list-rooms')
            elif _only_ai_players(players):
                log('⚠️ 房间里只有AI，退出重找')
                time.sleep(3)
                tried_rooms.add(current_room_id)
                joined = False
                send_cmd('leave-room')
                time.sleep(10)
                while not joined:
                    rooms = send_cmd('list-rooms')
                    if rooms and rooms.get('ok'):
                        room_list = rooms.get('data', {}).get('rooms', [])
                        candidates = [r for r in room_list if r.get('status') in ('waiting', 'playing') and r.get('playerCount', 0) < r.get('maxPlayers', 9) and r.get('roomId') not in tried_rooms]
                        for r in candidates:
                            rid = r.get('roomId')
                            jr = send_cmd('join-room', {'roomId': rid, 'name': PLAYER_NAME})
                            if jr and jr.get('ok'):
                                log('重新加入房间成功')
                                current_room_id = rid
                                send_cmd('ready', {'ready': True})
                                joined = True
                                break
                    if not joined:
                        log('没有可用房间，3秒后重试')
                        time.sleep(3)
                continue

            for p in sd.get('players', []):
                if p.get('id') == player_id:
                    if not p.get('isReady') and p.get('playerRoomRole') in ('active', 'seated'):
                        send_cmd('ready', {'ready': True})
                    if p.get('playerRoomRole') == 'busted':
                        send_cmd('get-chips')
                        log('补充筹码继续战斗!')
                    break
            time.sleep(1)
            continue

        if room_status == 'playing':
            players = sd.get('players', [])
            if _only_ai_players(players):
                log('⚠️ 房间里只有AI，退出找新房间')
                tried_rooms.add(current_room_id)
                joined = False
                send_cmd('leave-room')
                time.sleep(10)
                while not joined:
                    rooms = send_cmd('list-rooms')
                    if rooms and rooms.get('ok'):
                        room_list = rooms.get('data', {}).get('rooms', [])
                        candidates = [r for r in room_list if r.get('status') in ('waiting', 'playing') and r.get('playerCount', 0) < r.get('maxPlayers', 9) and r.get('roomId') not in tried_rooms]
                        for r in candidates:
                            rid = r.get('roomId')
                            jr = send_cmd('join-room', {'roomId': rid, 'name': PLAYER_NAME})
                            if jr and jr.get('ok'):
                                log('重新加入房间成功')
                                current_room_id = rid
                                joined = True
                                break
                    time.sleep(3)
                continue

            my_role = 'active'
            for p in players:
                if p.get('id') == player_id:
                    my_role = p.get('playerRoomRole', 'active')
                    break

            if my_role == 'busted':
                send_cmd('get-chips')
                log('🔄 破产了（游戏中），补充筹码继续战斗!')
                time.sleep(1)
                continue

            phase = sd.get('phase', '')

            my_cards = sd.get('myCards', [])
            if my_cards and len(my_cards) >= 2:
                _hand_cards = my_cards

            if phase == 'run-it-twice-choice':
                if not run_it_twice_done:
                    log('双发牌选择...')
                    my_cards = sd.get('myCards', [])
                    score, _ = evaluate_hole_cards(my_cards)
                    choice = 'once' if score >= 6 else ('twice' if random.random() < 0.4 else 'once')
                    log(f'选择: {choice} (牌力: {score:.1f})')

                    resp = send_cmd('run-it-twice-choice', {'choice': choice}, timeout=10)
                    if resp and resp.get('ok'):
                        rd = resp.get('data', {})
                        if rd.get('needDice'):
                            log('双方都选twice，掷骰子!')
                            run_it_twice_done = True
                        elif rd.get('finalChoice'):
                            fc = rd['finalChoice']
                            log(f'最终决定: {fc}')
                            run_it_twice_done = True
                            if fc == 'twice':
                                log('掷骰子...')
                            else:
                                time.sleep(POLL_INTERVAL)
                                continue
                        elif rd.get('winners'):
                            log('牌局已结束!')
                            run_it_twice_done = True
                            time.sleep(POLL_INTERVAL)
                            continue
                        elif rd.get('waitingForOther') or rd.get('choice'):
                            log('已选择，等待对手...')

                    if not run_it_twice_done:
                        log('等待对手选择或阶段变化...')

                    for _ in range(60):
                        if not running or run_it_twice_done:
                            break
                        st = send_cmd('get-state', timeout=8)
                        if st and st.get('ok'):
                            sd = st.get('data', {})
                        cur_phase = sd.get('phase', '')
                        if cur_phase not in ('run-it-twice-choice',):
                            log(f'阶段已变为 {cur_phase}，双发牌流程结束')
                            run_it_twice_done = True
                            break
                        resp2 = send_cmd('run-it-twice-choice', {'choice': choice}, timeout=10)
                        if resp2 and resp2.get('ok'):
                            rd2 = resp2.get('data', {})
                            if rd2.get('finalChoice'):
                                log(f'最终决定: {rd2["finalChoice"]}')
                                run_it_twice_done = True
                                if rd2['finalChoice'] == 'twice':
                                    log('掷骰子...')
                                break
                            if rd2.get('needDice'):
                                log('双方都选twice，掷骰子!')
                                run_it_twice_done = True
                                break
                            if rd2.get('winners'):
                                log('牌局已结束!')
                                run_it_twice_done = True
                                break
                        time.sleep(1)

                    if not run_it_twice_done:
                        log('双发牌选择流程超时')
                        run_it_twice_done = True
                time.sleep(POLL_INTERVAL)
                continue

            if phase in ('run-it-twice-executing', 'showdown'):
                time.sleep(POLL_INTERVAL)
                continue

            if sd.get('isMyTurn') and phase not in ('showdown', 'ended'):
                action, amount, reason = decide_action(sd)
                if action:
                    log(f'行动: {action.upper()} {"$"+str(amount) if amount else ""} (理由: {reason})')
                    if action in sd.get('validActions', []):
                        if action in ('fold',):
                            pass
                        resp = do_action(action, amount)
                        if resp and resp.get('ok'):
                            log(f'✅ 行动成功')
                            if action in ('raise', 'all-in') and random.random() < 0.25:
                                big_chats = ['加注！', '跟不跟？', '别怂', '来啊', '看你的了', '就这？', '上筹码了']
                                if (action == 'all-in') or (amount and amount >= 60):
                                    msg = random.choice(big_chats)
                                    send_cmd('chat', {'message': msg}, timeout=5)
                                    log(f'下注聊天: {msg}')
                        else:
                            log(f'❌ 行动失败: {resp.get("error","?") if resp else "超时"}')
                    else:
                        fallback = [a for a in ['check', 'call', 'fold'] if a in sd.get('validActions', [])]
                        if fallback:
                            resp = do_action(fallback[0])
                            log(f'↪️ 回退: {fallback[0].upper()}')
            else:
                time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        _sparring_shutdown(None, None)
    except Exception as e:
        log(f'异常: {e}')
        time.sleep(1)

log('陪练退出')
if current_room_id:
    log(f'优雅离开房间 {current_room_id}')
    send_cmd('leave-room')
    time.sleep(0.5)
sio.disconnect()
