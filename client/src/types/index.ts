export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string;
  code: string;
}

export enum GameVariant {
  TEXAS_NLHE = 'texas_nlhe',
  TEXAS_LHE = 'texas_lhe',
  TEXAS_PLO = 'texas_plo',
  SIX_PLUS = 'six_plus',
  PINEAPPLE = 'pineapple',
  CRAZY_PINEAPPLE = 'crazy_pineapple',
  TEXAS_DOUBLE_BOARD = 'texas_double_board',
  OMAHA_PLO = 'omaha_plo',
  OMAHA_HI_LO = 'omaha_hi_lo',
  OMAHA_PLO5 = 'omaha_plo5',
  OMAHA_PLO6 = 'omaha_plo6',
  OMAHA_DOUBLE_BOARD = 'omaha_double_board',
  OMAHA_THREE_BOARD = 'omaha_three_board',
  FIVE_CARD_DRAW = 'five_card_draw',
  SEVEN_CARD_STUD = 'seven_card_stud',
  SQUID_HOLDEM = 'squid_holdem',
  SQUID_DALGONA_SUIT = 'squid_dalgona_suit',
  SQUID_GLASS_BRIDGE = 'squid_glass_bridge',
}

export enum GameModifier {
  NONE = 'none',
  BOMB_POT = 'bomb_pot',
  BOMB_POT_DOUBLE = 'bomb_pot_double',
  ALL_IN_NO_FOLD = 'all_in_no_fold',
  ALL_IN_ALL_ROUND = 'all_in_all_round',
  BLIND_SHOWDOWN = 'blind_showdown',
}

export enum HandRank {
  ROYAL_FLUSH = 10,
  STRAIGHT_FLUSH = 9,
  FOUR_OF_A_KIND = 8,
  FULL_HOUSE = 7,
  FLUSH = 6,
  STRAIGHT = 5,
  THREE_OF_A_KIND = 4,
  TWO_PAIR = 3,
  ONE_PAIR = 2,
  HIGH_CARD = 1,
}

export interface ModifierInfo {
  id: GameModifier;
  name: string;
  icon: string;
  shortDesc: string;
  fullDesc: string;
  specialRules: string[];
  needsBaseVariant: boolean;
}

export interface MixedRotationConfig {
  variants: GameVariant[];
  handsPerVariant: number;
}

export interface VariantRuleInfo {
  id: GameVariant;
  name: string;
  icon: string;
  category: string;
  shortDesc: string;
  fullDesc: string;
  holeCardCount: number;
  communityCardCount: number;
  boardCount: number;
  deckRanks: string[];
  handRankOrder: HandRank[];
  isPotLimit: boolean;
  isFixedLimit: boolean;
  specialRules: string[];
  forceCombination?: 'free' | '2+3' | '3+2';
  maxPlayers: number;
}

export const VARIANT_CATEGORIES: Record<string, string> = {
  texas_series: '德州系',
  omaha_series: '奥马哈系',
  stud_draw_series: '梭哈/换牌系',
  squid_game_series: '鱿鱼游戏系',
};

export const MODIFIER_INFO: Record<GameModifier, ModifierInfo> = {
  [GameModifier.NONE]: {
    id: GameModifier.NONE, name: '无', icon: '', shortDesc: '不使用特殊修饰',
    fullDesc: '不使用任何特殊修饰，按基础玩法规则进行。', specialRules: [], needsBaseVariant: false,
  },
  [GameModifier.BOMB_POT]: {
    id: GameModifier.BOMB_POT, name: '炸弹彩池', icon: '💣', shortDesc: '强制前注，翻前无弃牌/加注',
    fullDesc: '炸弹彩池（Bomb Pot），无大小盲，所有玩家强制缴纳固定前注（Ante）。翻前无弃牌、无加注、无跟注，全员直接进入翻牌圈，翻牌后按基础玩法正常行动。',
    specialRules: ['无大小盲，强制缴纳固定前注', '翻前无弃牌、无加注、无跟注', '全员直接进入翻牌圈', '翻牌后按基础玩法正常行动', '可配置前注金额'], needsBaseVariant: true,
  },
  [GameModifier.BOMB_POT_DOUBLE]: {
    id: GameModifier.BOMB_POT_DOUBLE, name: '翻倍炸弹池', icon: '💥', shortDesc: '翻倍前注，翻前无弃牌/加注',
    fullDesc: '翻倍炸弹池（Double Bomb Pot），与炸弹彩池相同，但前注为普通炸弹池的2倍。波动更大、底池更高。',
    specialRules: ['前注为普通炸弹池的2倍', '翻前无弃牌、无加注、无跟注', '全员直接进入翻牌圈', '翻牌后按基础玩法正常行动'], needsBaseVariant: true,
  },
  [GameModifier.ALL_IN_NO_FOLD]: {
    id: GameModifier.ALL_IN_NO_FOLD, name: '免弃牌全员池', icon: '🚫', shortDesc: '强制前注，翻前无弃牌',
    fullDesc: '免弃牌全员池（All-In No Fold），无大小盲，所有玩家强制缴纳固定前注。翻前无弃牌、无加注，全员直接进入翻牌圈。一局一触发，不影响后续手牌。',
    specialRules: ['无大小盲，强制缴纳固定前注', '翻前无弃牌、无加注', '全员直接进入翻牌圈', '一局一触发，不影响后续手牌'], needsBaseVariant: true,
  },
  [GameModifier.ALL_IN_ALL_ROUND]: {
    id: GameModifier.ALL_IN_ALL_ROUND, name: '跟到底', icon: '🎰', shortDesc: '全员翻前全下，纯运气',
    fullDesc: '跟到底（All-In All Round），翻前无弃牌、无加注，所有玩家直接全下。全下后依次发放所有公共牌，摊牌比大小。纯运气比拼，无技巧性。',
    specialRules: ['翻前无弃牌、无加注', '所有玩家直接全下', '全下后发放所有公共牌', '纯运气比拼，无技巧性'], needsBaseVariant: true,
  },
  [GameModifier.BLIND_SHOWDOWN]: {
    id: GameModifier.BLIND_SHOWDOWN, name: '大小盲梭哈', icon: '👁️', shortDesc: '翻前仅弃牌或全下',
    fullDesc: '大小盲梭哈（Blind Showdown），翻前仅两种选择：弃牌或直接全下。无跟注、加注。全下后发放所有公共牌，简化对局流程。',
    specialRules: ['翻前仅弃牌或全下', '无跟注、加注', '全下后发放所有公共牌', '简化对局流程，节省时间'], needsBaseVariant: true,
  },
};

const STD_RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SHORT_RANKS = ['6','7','8','9','10','J','Q','K','A'];
const STD_ORDER = [HandRank.ROYAL_FLUSH, HandRank.STRAIGHT_FLUSH, HandRank.FOUR_OF_A_KIND, HandRank.FULL_HOUSE, HandRank.FLUSH, HandRank.STRAIGHT, HandRank.THREE_OF_A_KIND, HandRank.TWO_PAIR, HandRank.ONE_PAIR, HandRank.HIGH_CARD];
const SHORT_ORDER = [HandRank.ROYAL_FLUSH, HandRank.STRAIGHT_FLUSH, HandRank.FOUR_OF_A_KIND, HandRank.FLUSH, HandRank.FULL_HOUSE, HandRank.STRAIGHT, HandRank.THREE_OF_A_KIND, HandRank.TWO_PAIR, HandRank.ONE_PAIR, HandRank.HIGH_CARD];

export const VARIANT_RULES: Record<GameVariant, VariantRuleInfo> = {
  [GameVariant.TEXAS_NLHE]: {
    id: GameVariant.TEXAS_NLHE, name: '常规德州', icon: '🤠', category: 'texas_series',
    shortDesc: '2张底牌，无限制下注',
    fullDesc: '标准德州扑克（NLHE），最经典的扑克玩法。2张底牌+5张公共牌，自由组合最佳5张牌型，无限制下注。是所有德州系玩法的基础模板。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['自由组合2张底牌与5张公共牌', '无限制下注', 'A可当5组成A-6-7-8-9最小顺子'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.TEXAS_LHE]: {
    id: GameVariant.TEXAS_LHE, name: '限注德州', icon: '📏', category: 'texas_series',
    shortDesc: '2张底牌，限注下注',
    fullDesc: '限注德州（LHE），2张底牌+5张公共牌，自由组合凑牌。每轮下注有固定上限，打法偏稳健，波动较低。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: true, specialRules: ['2张底牌，自由组合凑牌', '每轮下注有固定上限', '打法偏稳健', '波动较低'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.TEXAS_PLO]: {
    id: GameVariant.TEXAS_PLO, name: '底池限注德州', icon: '🏊', category: 'texas_series',
    shortDesc: '2张底牌，底池限注',
    fullDesc: '底池限注德州（PLO Texas），2张底牌+5张公共牌，自由组合凑牌。下注规则介于无限注和限注之间，最大下注=当前底池总额。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['2张底牌，自由组合凑牌', '底池限注（最大下注=当前底池）', '下注规则介于无限注和限注之间'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.SIX_PLUS]: {
    id: GameVariant.SIX_PLUS, name: '短牌', icon: '⚡', category: 'texas_series',
    shortDesc: '去掉2-5，同花>葫芦',
    fullDesc: '短牌德州（Six Plus Hold\'em），去掉2-5仅保留36张牌。2张底牌+5张公共牌，同花大于葫芦，A可当5组成最小顺子。波动更大、成牌率更高。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: SHORT_RANKS, handRankOrder: SHORT_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['牌库仅36张（去掉2-5）', '同花 > 葫芦（区别于标准德州）', 'A可当5组成A-6-7-8-9最小顺子', '无限制下注'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.PINEAPPLE]: {
    id: GameVariant.PINEAPPLE, name: '大菠萝', icon: '🍍', category: 'texas_series',
    shortDesc: '3张底牌，翻前弃1张',
    fullDesc: '大菠萝德州（Pineapple），发3张底牌，翻牌前必须弃掉1张，剩余2张按常规德州规则进行。增加了起手牌选择空间。',
    holeCardCount: 3, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['发3张底牌', '翻牌前必须弃掉1张底牌', '剩余2张按常规德州规则', '无限制下注'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.CRAZY_PINEAPPLE]: {
    id: GameVariant.CRAZY_PINEAPPLE, name: '疯狂菠萝', icon: '🤪', category: 'texas_series',
    shortDesc: '3张底牌，3+2自由凑牌',
    fullDesc: '疯狂菠萝（Crazy Pineapple），发3张底牌，全程保留3张。可用3张底牌+2张公共牌或自由组合凑出最佳5张牌型。牌力普遍偏高，成牌概率大。',
    holeCardCount: 3, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['发3张底牌，全程保留', '3张底牌+2张公共牌自由组合', '牌力普遍偏高', '无限制下注'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.TEXAS_DOUBLE_BOARD]: {
    id: GameVariant.TEXAS_DOUBLE_BOARD, name: '双排面德州', icon: '🎴', category: 'texas_series',
    shortDesc: '2张底牌，双板面各5张公共牌',
    fullDesc: '拆分底池双德州（Double Board Texas），2张底牌+两套板面各5张公共牌。两套板面独立发牌、独立比牌，底池平分给两套板面的赢家。自由组合凑牌。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 2, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['两套板面独立发牌、独立比牌', '底池平分（A板50%+B板50%）', '自由组合凑牌', '无限制下注'], forceCombination: 'free', maxPlayers: 10,
  },
  [GameVariant.OMAHA_PLO]: {
    id: GameVariant.OMAHA_PLO, name: '奥马哈', icon: '🎪', category: 'omaha_series',
    shortDesc: '4张底牌，强制2+3，底池限注',
    fullDesc: '常规奥马哈（PLO），4张底牌+5张公共牌，强制使用恰好2张底牌+3张公共牌组成牌型。底池限注（最大下注=当前底池总额）。更多起手组合，波动更大。',
    holeCardCount: 4, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['4张底牌', '强制2张底牌+3张公共牌凑牌', '底池限注（最大下注=当前底池）', '不可多拿或少拿底牌'], forceCombination: '2+3', maxPlayers: 10,
  },
  [GameVariant.OMAHA_HI_LO]: {
    id: GameVariant.OMAHA_HI_LO, name: '奥马哈高低', icon: '↕️', category: 'omaha_series',
    shortDesc: '4张底牌，高低分池，底池限注',
    fullDesc: '奥马哈高低（PLO8/Hi-Lo），4张底牌+5张公共牌，强制2+3凑牌。底池平分为高池和低池，高池给最大牌型，低池给最小牌型（低牌要求≤8且无顺子同花）。单玩家可同时赢高池+低池。',
    holeCardCount: 4, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['4张底牌，强制2+3凑牌', '底池平分：高池50%+低池50%', '低池要求：牌点≤8且无顺子同花', '不满足低池条件则全归高池', '底池限注'], forceCombination: '2+3', maxPlayers: 10,
  },
  [GameVariant.OMAHA_PLO5]: {
    id: GameVariant.OMAHA_PLO5, name: '五张奥马哈', icon: '🖐️', category: 'omaha_series',
    shortDesc: '5张底牌，强制2+3，底池限注',
    fullDesc: '五张奥马哈（PLO5），5张底牌+5张公共牌，强制2+3凑牌。比常规PLO多一张起手牌选择，组合更多，波动更高。',
    holeCardCount: 5, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['5张底牌，强制2+3凑牌', '比常规PLO多一张起手牌', '底池限注', '组合更多波动更高'], forceCombination: '2+3', maxPlayers: 10,
  },
  [GameVariant.OMAHA_PLO6]: {
    id: GameVariant.OMAHA_PLO6, name: '六张奥马哈', icon: '🎲', category: 'omaha_series',
    shortDesc: '6张底牌，强制2+3，底池限注',
    fullDesc: '六张奥马哈（PLO6），6张底牌+5张公共牌，强制2+3凑牌。起手牌选择极多，波动极高，适合追求刺激的玩家。',
    holeCardCount: 6, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['6张底牌，强制2+3凑牌', '起手牌选择极多', '底池限注', '波动极高'], forceCombination: '2+3', maxPlayers: 10,
  },
  [GameVariant.OMAHA_DOUBLE_BOARD]: {
    id: GameVariant.OMAHA_DOUBLE_BOARD, name: '双排面奥马哈', icon: '🎯', category: 'omaha_series',
    shortDesc: '4张底牌，双板面，底池限注',
    fullDesc: '双排面奥马哈（Double Board Omaha），4张底牌+两套板面各5张公共牌，强制2+3凑牌。两套板面独立发牌、独立比牌，底池平分。',
    holeCardCount: 4, communityCardCount: 5, boardCount: 2, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['4张底牌，强制2+3凑牌', '两套板面独立发牌、独立比牌', '底池平分（A板50%+B板50%）', '底池限注'], forceCombination: '2+3', maxPlayers: 10,
  },
  [GameVariant.OMAHA_THREE_BOARD]: {
    id: GameVariant.OMAHA_THREE_BOARD, name: '三板面奥马哈', icon: '🎯', category: 'omaha_series',
    shortDesc: '4张底牌，三板面，底池限注',
    fullDesc: '三板面奥马哈（Three Board Omaha），4张底牌+三套板面各5张公共牌，强制2+3凑牌。三套板面独立发牌、独立比牌，底池分三份。',
    holeCardCount: 4, communityCardCount: 5, boardCount: 3, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: true, isFixedLimit: false, specialRules: ['4张底牌，强制2+3凑牌', '三套板面独立发牌、独立比牌', '底池分三份（每板面1/3）', '底池限注'], forceCombination: '2+3', maxPlayers: 10,
  },
  [GameVariant.FIVE_CARD_DRAW]: {
    id: GameVariant.FIVE_CARD_DRAW, name: '五张换牌', icon: '🔄', category: 'stud_draw_series',
    shortDesc: '5张手牌，可换牌，无公共牌',
    fullDesc: '五张换牌扑克（5 Card Draw），5张手牌，无公共牌。发牌后可选择更换任意数量手牌（0-5张），换牌后直接摊牌比大小。纯手牌比拼，无翻牌/转牌/河牌轮次。',
    holeCardCount: 5, communityCardCount: 0, boardCount: 0, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['5张手牌，无公共牌', '可更换0-5张手牌', '换牌后直接摊牌比大小', '无翻牌/转牌/河牌轮次'], forceCombination: 'free', maxPlayers: 6,
  },
  [GameVariant.SEVEN_CARD_STUD]: {
    id: GameVariant.SEVEN_CARD_STUD, name: '七张梭哈', icon: '🃏', category: 'stud_draw_series',
    shortDesc: '7张手牌（4明3暗），无公共牌',
    fullDesc: '七张梭哈（Stud 7），7张手牌（4张明牌+3张暗牌），逐张发放。从7张手牌中选择5张组成最佳牌型比大小。无公共牌，需根据对手明牌判断手牌实力。',
    holeCardCount: 7, communityCardCount: 0, boardCount: 0, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['7张手牌（4明3暗）', '逐张发放、逐轮下注', '无公共牌', '需根据对手明牌判断实力'], forceCombination: 'free', maxPlayers: 8,
  },
  [GameVariant.SQUID_HOLDEM]: {
    id: GameVariant.SQUID_HOLDEM, name: '鱿鱼扣牌德州', icon: '🦑', category: 'squid_game_series',
    shortDesc: '1v1对抗，扣牌加倍，无平局',
    fullDesc: '鱿鱼扣牌德州（Squid Holdem），仅支持2人对决。无大小盲，强制缴纳等额初始底池。翻牌前可选择"扣牌"隐藏1张底牌，扣牌后本轮下注加倍。河牌后未扣牌玩家先摊牌，扣牌玩家可先看对手牌型再摊牌。平局时重新发牌，贴合鱿鱼游戏"无平局"规则。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['仅支持2人桌（1v1对抗）', '无大小盲，强制缴纳等额初始底池', '翻牌前可选择扣牌（隐藏1张底牌）', '扣牌后本轮下注需加倍', '河牌后未扣牌玩家先摊牌', '平局时重新发牌（无平局规则）', '输家扣除底池50%筹码'], forceCombination: 'free', maxPlayers: 2,
  },
  [GameVariant.SQUID_DALGONA_SUIT]: {
    id: GameVariant.SQUID_DALGONA_SUIT, name: '椪糖花色局', icon: '🍬', category: 'squid_game_series',
    shortDesc: '目标花色限制，无效即淘汰',
    fullDesc: '椪糖花色局（Squid Dalgona Suit），适配常规德州/短牌。开局随机指定1种花色为"目标花色"，凑牌时需包含至少1张目标花色牌，否则牌型无效直接判弃牌。若所有玩家牌型均无效，底池归庄家。有效牌型玩家可获得额外10%底池奖励。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['开局随机指定目标花色', '凑牌需包含至少1张目标花色', '无效牌型直接判弃牌', '全员无效则底池归庄家', '有效牌型额外奖励10%底池', '翻牌后显示目标花色数量'], forceCombination: 'free', maxPlayers: 6,
  },
  [GameVariant.SQUID_GLASS_BRIDGE]: {
    id: GameVariant.SQUID_GLASS_BRIDGE, name: '玻璃桥比牌局', icon: '🌉', category: 'squid_game_series',
    shortDesc: '前进/后退抉择，过桥费递增',
    fullDesc: '玻璃桥比牌局（Squid Glass Bridge），适配德州系玩法。发牌轮次固定为3轮（翻牌1张→转牌2张→河牌2张），每轮发放后必须选择"前进"（下注）或"后退"（弃牌）。前进需缴纳过桥费（翻牌轮10%、转牌轮20%、河牌轮30%），后退则直接弃牌。坚持到最后且牌型最大者全拿底池。',
    holeCardCount: 2, communityCardCount: 5, boardCount: 1, deckRanks: STD_RANKS, handRankOrder: STD_ORDER,
    isPotLimit: false, isFixedLimit: false, specialRules: ['3轮发牌（翻牌1张→转牌2张→河牌2张）', '每轮选择前进（下注）或后退（弃牌）', '过桥费递增：10%→20%→30%', '后退即弃牌，不参与后续轮次', '超时自动判后退', '坚持到最后且牌型最大者全拿'], forceCombination: 'free', maxPlayers: 8,
  },
};

export type RunItTwiceChoice = 'once' | 'twice';

export interface RunItTwiceDiceResult {
  player1: { id: string; value: number };
  player2: { id: string; value: number };
  finalChoice: RunItTwiceChoice;
}

export interface RunItTwiceRoundResult {
  communityCards: Card[];
  winnerIds: string[];
  winAmount: number;
  potAmount: number;
  handRanks: Record<string, string>;
}

export interface Room {
  config: {
    roomId: string;
    roomName: string;
    hostId: string;
    maxPlayers: number;
    minPlayers: number;
    smallBlind: number;
    bigBlind: number;
    buyInMin: number;
    buyInMax: number;
    isPrivate: boolean;
    gameVariant?: GameVariant;
    gameModifier?: GameModifier;
    mixedRotation?: MixedRotationConfig;
    fixedHands?: number;
    maxRebuyCount?: number;
  };
  status: 'waiting' | 'playing' | 'ended';
  players: RoomPlayer[];
  scoreboardEntries?: ScoreboardEntry[];
  gameState?: GameState;
  handCount?: number;
  playerRebuyCounts?: Record<string, number>;
  voteExtendHands?: {
    initiatorId: string;
    initiatorName: string;
    votes: Record<string, boolean>;
    votedPlayers: number;
    totalPlayers: number;
    createdAt: number;
    extendCount: number;
  };
}

export enum PlayerRoomRole {
  SPECTATOR = 'spectator',
  SEATED = 'seated',
  ACTIVE = 'active',
  BUSTED = 'busted',
}

export interface ScoreboardEntry {
  id: string;
  name: string;
  chips: number;
  totalBuyIn: number;
  leftAt?: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: string;
  seatIndex: number;
  chips: number;
  totalBuyIn: number;
  isReady: boolean;
  isOnline: boolean;
  isNpc?: boolean;
  isAfk?: boolean;
  hasPlayedHand?: boolean;
  playerRoomRole: PlayerRoomRole;
}

export interface GameState {
  handId: string;
  phase: string;
  communityCards: Card[];
  boardCards?: Card[][];
  pots: Pot[];
  totalPot: number;
  currentPlayerIndex: number;
  currentPlayerId: string;
  currentBet: number;
  minRaise: number;
  roundBets: Record<string, number>;
  totalBets: Record<string, number>;
  playerStatus: Record<string, string>;
  playerRoles: Record<string, string>;
  isHeadsUpAllIn?: boolean;
  runItTwiceChoices?: Record<string, RunItTwiceChoice>;
  runItTwiceDiceResult?: RunItTwiceDiceResult | null;
  runItTwiceDiceReady?: Record<string, boolean>;
  runItTwiceBoard?: Card[][];
  runItTwiceResults?: RunItTwiceRoundResult[];
}

export interface Pot {
  id: string;
  amount: number;
}

export interface WinnerInfo {
  playerId: string;
  playerName: string;
  winAmount: number;
  handRank: string;
  handDescription: string;
  explanation: string;
  holeCards: Card[];
  winningCards: Card[];
  potType?: 'main' | 'side' | 'both';
}

export interface PlayerHandInfo {
  playerId: string;
  playerName: string;
  holeCards: Card[];
  handRank: string;
  handDescription: string;
  isWinner: boolean;
  winAmount?: number;
  potType?: 'main' | 'side' | 'both';
  netWin?: number;
  roundHandRanks?: string[];
  initialChips?: number;
  rebuyAmount?: number;
  position?: string;
}

export enum ClientEvents {
  CREATE_ROOM = 'room:create',
  JOIN_ROOM = 'room:join',
  LEAVE_ROOM = 'room:leave',
  PLAYER_READY = 'room:ready',
  START_GAME = 'room:start',
  GET_CHIPS = 'room:get_chips',
  PLAYER_ACTION = 'game:action',
  SEND_CHAT = 'chat:send',
  VOTE_LEAVE = 'room:vote_leave',
  VOTE_LEAVE_RESPONSE = 'room:vote_leave_response',
  RUN_IT_TWICE_CHOICE = 'game:run_it_twice_choice',
  RUN_IT_TWICE_ROLL_DICE = 'game:run_it_twice_roll_dice',
  DECLINE_REBUY = 'room:decline_rebuy',
  AFK = 'room:afk',
  VOTE_EXTEND_HANDS = 'room:vote_extend_hands',
  VOTE_EXTEND_HANDS_RESPONSE = 'room:vote_extend_hands_response',
  SHOW_CARDS = 'game:show_cards',
  DISCARD_CARD = 'game:discard_card',
  REQUEST_MY_CARDS = 'game:request_my_cards',
}

export enum ServerEvents {
  CONNECTED = 'connection:connected',
  ROOM_CREATED = 'room:created',
  ROOM_JOINED = 'room:joined',
  ROOM_UPDATED = 'room:updated',
  PLAYER_JOINED = 'room:player_joined',
  PLAYER_LEFT = 'room:player_left',
  PLAYER_READY_CHANGED = 'room:player_ready_changed',
  GAME_STARTED = 'game:started',
  DEAL_CARDS = 'game:deal_cards',
  PLAYER_TURN = 'game:player_turn',
  ACTION_RESULT = 'game:action_result',
  SHOWDOWN = 'game:showdown',
  HAND_RESULT = 'game:hand_result',
  CHAT_MESSAGE = 'chat:message',
  CHIPS_RECEIVED = 'system:chips_received',
  ROOM_LEFT = 'room:left',
  VOTE_LEAVE_STARTED = 'room:vote_leave_started',
  VOTE_LEAVE_RESPONSE = 'room:vote_leave_response',
  VOTE_LEAVE_ENDED = 'room:vote_leave_ended',
  ROOM_CLOSED = 'room:closed',
  RUN_IT_TWICE_ASK = 'game:run_it_twice_ask',
  RUN_IT_TWICE_CHOICE_RESULT = 'game:run_it_twice_choice_result',
  RUN_IT_TWICE_DICE_RESULT = 'game:run_it_twice_dice_result',
  RUN_IT_TWICE_EXECUTING = 'game:run_it_twice_executing',
  RUN_IT_TWICE_SHOWDOWN = 'game:run_it_twice_showdown',
  RUN_IT_TWICE_DEAL_CARD = 'game:run_it_twice_deal_card',
  RUN_IT_TWICE_ROUND_RESULT = 'game:run_it_twice_round_result',
  GAME_OVER = 'game:game_over',
  AFK_STATUS_CHANGED = 'room:afk_status_changed',
  VOTE_EXTEND_HANDS_STARTED = 'room:vote_extend_hands_started',
  VOTE_EXTEND_HANDS_RESPONSE = 'room:vote_extend_hands_response',
  VOTE_EXTEND_HANDS_ENDED = 'room:vote_extend_hands_ended',
  SHOW_CARDS_RESULT = 'game:show_cards_result',
  ACTION_LOG_SYNC = 'game:action_log_sync',
}
