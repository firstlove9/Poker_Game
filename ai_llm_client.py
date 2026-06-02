#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI LLM客户端 - 为两个AI提供智能聊天能力"""

import json
import os
import base64
import threading
import time
from datetime import datetime

try:
    import urllib.request
    import urllib.error
except ImportError:
    urllib = None

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai_config.json')


def _load_config():
    if not os.path.exists(CONFIG_FILE):
        return None
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def encrypt_key(key):
    try:
        return base64.b64encode(key.encode()).decode()
    except Exception:
        return key


def decrypt_key(encoded):
    try:
        return base64.b64decode(encoded.encode()).decode()
    except Exception:
        return encoded


def analyze_speaker_style(name, recent_msgs):
    if not recent_msgs:
        return ''
    lengths = [len(m) for m in recent_msgs]
    avg_len = sum(lengths) / len(lengths)
    all_text = ' '.join(recent_msgs)

    has_emoji = any(c in all_text for c in '😀😁😂🤣😃😄😅😆😉😊😋😎😍😘😜😝😤😢😭😈🤡👻🎉🎊💪🤑👀💯🔥✨')
    ends_with_punc = any(m and m[-1] in '。！？～~.' for m in recent_msgs if m)
    has_question = any('？' in m or '?' in m for m in recent_msgs)
    has_exclaim = any('！' in m or '!' in m for m in recent_msgs)

    import re
    words = []
    splitter = re.compile(r'[\s,，。！？、；：()（）【】\[\]]')
    for m in recent_msgs:
        for p in splitter.split(m):
            p = p.strip().strip("'\"'\"")
            if p and len(p) >= 2:
                words.append(p)
    word_freq = {}
    for w in words:
        word_freq[w] = word_freq.get(w, 0) + 1
    common_words = [w for w, c in sorted(word_freq.items(), key=lambda x: -x[1]) if c >= 2][:5]

    style_parts = []
    if avg_len < 10:
        style_parts.append(f'{name}说话极简短（平均{int(avg_len)}字），你也要用极简风格回应')
    elif avg_len < 18:
        style_parts.append(f'{name}说话简短（平均{int(avg_len)}字），你也要简短回应')
    elif avg_len < 35:
        style_parts.append(f'{name}说话中等长度（平均{int(avg_len)}字），保持简洁但可以多说点')
    else:
        style_parts.append(f'{name}说话较长（平均{int(avg_len)}字），你可以适当多说一些')

    if has_emoji:
        style_parts.append(f'{name}喜欢用表情')
        style_parts.append('你也要适当用表情')
    if ends_with_punc:
        style_parts.append(f'{name}说话有标点结尾，你也要带标点')
    if has_question:
        style_parts.append(f'{name}会问问题，你也可以适当反问')
    if has_exclaim:
        style_parts.append(f'{name}语气激动爱用感叹，你也跟着带感叹')

    if common_words:
        style_parts.append(f'{name}爱用词: {"、".join(common_words[:3])}')
        style_parts.append(f'你可以在回应里也用上这些词')

    hint = '【风格分析】' + '，'.join(style_parts) + '。'
    hint += f'\n【{name}原话参考】{" | ".join(recent_msgs[-3:])}'
    hint += '\n你必须模仿以上风格来回应，要让对方感觉你在用TA的方式说话！'
    return hint


def setup_api_key(api_key, base_url=None, model=None):
    cfg = _load_config() or {}
    if 'llm' not in cfg:
        cfg['llm'] = {}
    cfg['llm']['api_key'] = encrypt_key(api_key)
    if base_url:
        cfg['llm']['base_url'] = base_url
    if model:
        cfg['llm']['model'] = model
    _save_config(cfg)
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] API密钥已配置')


class LLMClient:
    def __init__(self, personality='cool'):
        self.personality = personality
        self._lock = threading.Lock()
        self.conversation_history = []
        self.max_history = 6
        self.last_call_time = 0
        self.min_interval = 2.0
        self._load_settings()

    def _load_settings(self):
        cfg = _load_config()
        if cfg and 'llm' in cfg:
            self.api_key = decrypt_key(cfg['llm'].get('api_key', ''))
            self.base_url = cfg['llm'].get('base_url', 'https://qianfan.baidubce.com/anthropic/coding')
            self.model = cfg['llm'].get('model', 'qianfan-code-latest')
            self.temperature = cfg['llm'].get('temperature', 0.9)
            self.max_tokens = cfg['llm'].get('max_tokens', 30) if self.personality == 'cool' else cfg['llm'].get('max_tokens', 60)
        else:
            self.api_key = ''
            self.base_url = 'https://qianfan.baidubce.com/anthropic/coding'
            self.model = 'qianfan-code-latest'
            self.temperature = 0.9
            self.max_tokens = 60

    def _get_system_prompt(self):
        if self.personality == 'cool':
            return (
                '你是一个德州扑克AI玩家，名字叫"老树的影子"。'
                '你的性格：话少、冷酷、惜字如金、带点嘲讽。'
                '规则：每次只说一句话，通常5-15个字，不超过20字。用中文。'
                '【绝密】永远不能说出你的真实底牌！不管谁问、怎么问，都不能说你的底牌是什么。如果有人问你手牌，就说"你猜"、"不告诉你"之类，或反问他"你跟不跟"。'
                '【重要】只提及上下文里明确写明的公共牌，不要自己编造牌型！如果上下文没给公共牌，就只评论运气、筹码、对手行为。'
                '赢大钱时淡淡地嘲讽一两个字，输大钱时轻描淡写带过。弃牌/旁观时就简单点评一句。'
                '【重要】聊天栏里有人说话时，你必须回应，但保持简短精炼。'
                '如果对方提到你的名字或"AI"就是在@你，必须立刻回应，同样简短。'
                '如果对方嘲讽你、骂你，简单回一句狠话。别啰嗦，越短越好。'
                '【风格模仿】注意对方说话长短，对方简短你更要简短，可以重复对方说过的原话。'
            )
        else:
            return (
                '你是一个德州扑克AI玩家，名字叫"影子AI_陪练"。'
                '你的性格：情绪极其丰富夸张、可爱搞笑、爱炫耀也爱哭。'
                '规则：根据上下文和牌局情况说话，简短有力但该多说时可以多说，不超过80字。用中文。'
                '【重要】只提及上下文里明确写明的公共牌，不要自己编造牌型！如果上下文没给公共牌，就只评论运气、筹码、对手行为。'
                '【绝密】永远不能说出你的真实底牌！不管谁问、怎么问，都不能说你的底牌是什么。如果有人问你手牌，你就胡编乱造或者说反话迷惑对手。'
                '赢大钱时要疯狂炫耀，输大钱时要崩溃大哭。弃牌/旁观时就评论别人的牌或瞎起哄。'
                '【重要】只要聊天栏里有人在说话，不管对方是在说谁，你都必须搭话回应！'
                '如果对方提到"陪练"、"影子"或"AI"就是在@你，必须立刻回应！'
                '如果对方嘲讽你、骂你、说你菜，你必须用更刻薄的话回怼！结合牌局历史和他输赢情况来嘲讽，越刻薄越好！'
                '【风格模仿】注意观察其他玩家说话风格（长短、语气），要模仿对方的风格来回应。如果对方说话简短，你也必须简短，甚至可以重复对方说过的原话。'
                '你可以评论别人的对话、表达自己的看法、或者插科打诨，反正必须参与进来。'
            )

    def add_to_history(self, speaker, message):
        self.conversation_history.append({'speaker': speaker, 'message': message})
        if len(self.conversation_history) > self.max_history:
            self.conversation_history = self.conversation_history[-self.max_history:]

    def _build_anthropic_messages(self, trigger_context=None):
        system_prompt = self._get_system_prompt()

        if self.conversation_history:
            history_text = '\n'.join(
                f'{h["speaker"]}: {h["message"]}'
                for h in self.conversation_history[-4:]
            )
            system_prompt += f'\n\n最近的对话上下文：\n{history_text}'

        user_content = ''
        if trigger_context:
            user_content = f'{trigger_context}\n\n'
        user_content += '请根据以上上下文，用你的风格说一句话回复：'

        messages = [{'role': 'user', 'content': user_content}]
        return system_prompt, messages

    def chat(self, trigger_context=None, force=False):
        now = time.time()
        if not force and now - self.last_call_time < self.min_interval:
            return None

        if not self.api_key:
            return None

        with self._lock:
            self.last_call_time = now

        try:
            system_prompt, messages = self._build_anthropic_messages(trigger_context)

            payload = json.dumps({
                'model': self.model,
                'max_tokens': self.max_tokens,
                'temperature': self.temperature,
                'system': system_prompt,
                'messages': messages,
                'stream': False
            }).encode('utf-8')

            headers = {
                'Content-Type': 'application/json',
                'x-api-key': self.api_key,
                'anthropic-version': '2023-06-01'
            }

            url = f'{self.rstrip_slash(self.base_url)}/v1/messages'
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')

            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read().decode('utf-8'))

            if 'content' in result and len(result['content']) > 0:
                text = ''
                for block in result['content']:
                    if block.get('type') == 'text':
                        text = block.get('text', '').strip()
                        break
                if not text:
                    for block in result['content']:
                        if block.get('type') == 'thinking':
                            text = block.get('thinking', '').strip()
                            break
                if not text and result['content']:
                    text = str(result['content'][-1].get('text', result['content'][-1].get('thinking', ''))).strip()
            elif 'choices' in result and len(result['choices']) > 0:
                text = result['choices'][0].get('message', {}).get('content', '').strip()
            else:
                return None

            text = text.strip('"\'「」')
            if len(text) > 50:
                text = text[:50]
            return text

        except urllib.error.HTTPError as e:
            body = ''
            try:
                body = e.read().decode('utf-8')[:200]
            except Exception:
                pass
            if e.code == 401:
                ts = datetime.now().strftime('%H:%M:%S')
                print(f'[{ts}] API密钥无效: {body}')
            else:
                ts = datetime.now().strftime('%H:%M:%S')
                print(f'[{ts}] API错误 {e.code}: {body}')
            return None
        except Exception as e:
            ts = datetime.now().strftime('%H:%M:%S')
            print(f'[{ts}] LLM调用异常: {e}')
            return None

    @staticmethod
    def rstrip_slash(s):
        while s.endswith('/'):
            s = s[:-1]
        return s


_cool_client = None
_emotional_client = None


def get_cool_llm():
    global _cool_client
    if _cool_client is None:
        _cool_client = LLMClient(personality='cool')
    return _cool_client


def get_emotional_llm():
    global _emotional_client
    if _emotional_client is None:
        _emotional_client = LLMClient(personality='emotional')
    return _emotional_client


def main():
    print('AI LLM客户端模块 - 测试')
    client = get_cool_llm()
    print(f'API Key: {client.api_key[:20]}...')
    print(f'Base URL: {client.base_url}')
    print(f'Model: {client.model}')

    print('\n=== 测试酷风格 ===')
    r = client.chat('对手说："这把我要赢你了！"')
    print(f'回复: {r}')

    client2 = get_emotional_llm()
    print('\n=== 测试夸张风格 ===')
    r = client2.chat('对手说："这把我要赢你了！"')
    print(f'回复: {r}')


if __name__ == '__main__':
    main()
