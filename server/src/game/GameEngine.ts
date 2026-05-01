import { v4 as uuidv4 } from 'uuid';
import {
  Card,
  GamePhase,
  PlayerAction,
  PlayerStatus,
  PlayerRole,
  HandRank,
  HandEvaluation,
} from '../types/poker';
import {
  GameState,
  RoomPlayer,
  Pot,
  PlayerActionRecord,
  WinnerInfo,
  PlayerHandInfo,
  PotResult,
} from '../types/room';
import { Deck } from '../poker/Deck';
import { HandEvaluator } from '../poker/HandEvaluator';

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  actionTimeout: number;
}

export class GameEngine {
  private state: GameState;
  private deck: Deck;
  private players: RoomPlayer[];
  private config: GameConfig;
  private hasActedThisRound: Set<string> = new Set();
  private lastAggressorIndex: number = -1;
  private actionCount: number = 0;

  constructor(players: RoomPlayer[], dealerIndex: number, config: GameConfig) {
    this.players = players.filter(p => p.isReady && p.chips > 0);
    this.config = config;
    this.deck = new Deck();

    const playerIds = this.players.map(p => p.id);

    this.state = {
      handId: uuidv4(),
      phase: GamePhase.WAITING,
      deck: [],
      communityCards: [],
      pots: [],
      currentPlayerIndex: -1,
      currentPlayerId: '',
      dealerIndex,
      smallBlindIndex: (dealerIndex + 1) % this.players.length,
      bigBlindIndex: (dealerIndex + 2) % this.players.length,
      lastRaiseIndex: -1,
      currentBet: 0,
      minRaise: config.bigBlind,
      roundBets: {},
      playerCards: {},
      playerStatus: Object.fromEntries(playerIds.map(id => [id, PlayerStatus.WAITING])),
      playerRoles: {},
      actions: [],
      startTime: Date.now(),
    };
  }

  start(): GameState {
    if (this.players.length < 2) {
      throw new Error('至少需要2名玩家才能开始游戏');
    }

    this.deck = new Deck();
    this.deck.shuffle();
    this.state.communityCards = [];
    this.state.pots = [];
    this.state.roundBets = {};
    this.state.currentBet = 0;
    this.state.lastRaiseIndex = -1;
    this.state.actions = [];
    this.hasActedThisRound = new Set();
    this.lastAggressorIndex = -1;
    this.actionCount = 0;

    for (const player of this.players) {
      this.state.playerStatus[player.id] = PlayerStatus.PLAYING;
      this.state.roundBets[player.id] = 0;
    }

    this.state.phase = GamePhase.PRE_FLOP;

    this.initPlayerRoles();
    this.dealHoleCards();
    this.postBlinds();

    this.state.currentPlayerIndex = this.getNextActivePlayerIndex(this.state.bigBlindIndex);
    this.state.currentPlayerId = this.players[this.state.currentPlayerIndex]?.id || '';

    return this.state;
  }

  private initPlayerRoles(): void {
    this.state.playerRoles = {};
    const n = this.players.length;
    const dealer = this.players[this.state.dealerIndex % n];
    const sb = this.players[this.state.smallBlindIndex % n];
    const bb = this.players[this.state.bigBlindIndex % n];

    if (dealer) this.state.playerRoles[dealer.id] = PlayerRole.DEALER;
    if (sb) this.state.playerRoles[sb.id] = PlayerRole.SB;
    if (bb) this.state.playerRoles[bb.id] = PlayerRole.BB;
  }

  private dealHoleCards(): void {
    for (const player of this.players) {
      this.state.playerCards[player.id] = [
        this.deck.deal(),
        this.deck.deal(),
      ];
    }
  }

  private postBlinds(): void {
    const n = this.players.length;
    const sb = this.players[this.state.smallBlindIndex % n];
    const bb = this.players[this.state.bigBlindIndex % n];

    if (sb) {
      const sbAmount = Math.min(this.config.smallBlind, sb.chips);
      sb.chips -= sbAmount;
      this.state.roundBets[sb.id] = sbAmount;
    }

    if (bb) {
      const bbAmount = Math.min(this.config.bigBlind, bb.chips);
      bb.chips -= bbAmount;
      this.state.roundBets[bb.id] = bbAmount;
      this.state.currentBet = bbAmount;
    }

    this.state.minRaise = this.config.bigBlind;
    this.lastAggressorIndex = this.state.bigBlindIndex % n;
  }

  private getNextActivePlayerIndex(fromIndex: number): number {
    const n = this.players.length;
    let index = (fromIndex + 1) % n;
    let checks = 0;

    while (checks < n) {
      const player = this.players[index];
      const status = this.state.playerStatus[player.id];

      if (status === PlayerStatus.PLAYING) {
        return index;
      }

      index = (index + 1) % n;
      checks++;
    }

    return -1;
  }

  performAction(playerId: string, action: PlayerAction, amount?: number): { success: boolean; error?: string } {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      return { success: false, error: '玩家不存在' };
    }

    const player = this.players[playerIndex];
    if (this.state.playerStatus[player.id] !== PlayerStatus.PLAYING) {
      return { success: false, error: '玩家不在游戏中' };
    }

    if (playerIndex !== this.state.currentPlayerIndex) {
      return { success: false, error: '不是你的回合' };
    }

    const myBet = this.state.roundBets[player.id] || 0;
    const toCall = this.state.currentBet - myBet;

    switch (action) {
      case PlayerAction.FOLD:
        this.state.playerStatus[player.id] = PlayerStatus.FOLDED;
        break;

      case PlayerAction.CHECK:
        if (toCall > 0) {
          return { success: false, error: '前面有人下注，不能过牌' };
        }
        break;

      case PlayerAction.CALL: {
        if (toCall <= 0) {
          return { success: false, error: '没有需要跟注的金额' };
        }
        const callAmount = Math.min(toCall, player.chips);
        player.chips -= callAmount;
        this.state.roundBets[player.id] = myBet + callAmount;
        if (player.chips === 0) {
          this.state.playerStatus[player.id] = PlayerStatus.ALL_IN;
        }
        break;
      }

      case PlayerAction.RAISE: {
        if (!amount || amount <= 0) {
          return { success: false, error: '加注金额必须大于0' };
        }
        const totalRaiseAmount = amount;
        const callPlusRaise = toCall + totalRaiseAmount;
        const actualAmount = Math.min(callPlusRaise, player.chips);
        player.chips -= actualAmount;
        this.state.roundBets[player.id] = myBet + actualAmount;
        this.state.currentBet = myBet + actualAmount;
        this.state.minRaise = totalRaiseAmount;
        this.lastAggressorIndex = playerIndex;
        this.hasActedThisRound.add(player.id);
        if (player.chips === 0) {
          this.state.playerStatus[player.id] = PlayerStatus.ALL_IN;
        }
        break;
      }

      case PlayerAction.ALL_IN: {
        const allInAmount = player.chips;
        player.chips = 0;
        this.state.roundBets[player.id] = myBet + allInAmount;
        if (myBet + allInAmount > this.state.currentBet) {
          this.state.currentBet = myBet + allInAmount;
          this.lastAggressorIndex = playerIndex;
        }
        this.state.playerStatus[player.id] = PlayerStatus.ALL_IN;
        this.hasActedThisRound.add(player.id);
        break;
      }

      default:
        return { success: false, error: '无效的动作' };
    }

    if (action !== PlayerAction.RAISE && action !== PlayerAction.ALL_IN) {
      this.hasActedThisRound.add(player.id);
    }

    this.actionCount++;

    this.state.actions.push({
      playerId,
      playerName: player.name,
      action: action.toString(),
      amount: amount || 0,
      timestamp: Date.now(),
      phase: this.state.phase,
    });

    if (this.checkOnlyOnePlayerLeft()) {
      this.endHand();
    } else if (this.isBettingRoundComplete()) {
      this.advancePhase();
    } else {
      this.advanceToNextPlayer();
    }

    return { success: true };
  }

  private checkOnlyOnePlayerLeft(): boolean {
    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.PLAYING
    );
    const allInPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.ALL_IN
    );
    return activePlayers.length + allInPlayers.length <= 1;
  }

  private isBettingRoundComplete(): boolean {
    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.PLAYING
    );

    if (activePlayers.length === 0) {
      return true;
    }

    for (const player of activePlayers) {
      const myBet = this.state.roundBets[player.id] || 0;
      if (myBet < this.state.currentBet) {
        return false;
      }
      if (!this.hasActedThisRound.has(player.id)) {
        return false;
      }
    }

    return true;
  }

  private advanceToNextPlayer(): void {
    const nextIndex = this.getNextActivePlayerIndex(this.state.currentPlayerIndex);
    if (nextIndex === -1) {
      this.state.currentPlayerIndex = -1;
      this.state.currentPlayerId = '';
      this.advancePhase();
      return;
    }
    this.state.currentPlayerIndex = nextIndex;
    this.state.currentPlayerId = this.players[nextIndex]?.id || '';
  }

  private advancePhase(): void {
    this.collectBets();
    this.hasActedThisRound = new Set();
    this.lastAggressorIndex = -1;
    this.state.currentBet = 0;
    this.state.roundBets = {};
    this.actionCount = 0;

    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.PLAYING ||
      this.state.playerStatus[p.id] === PlayerStatus.ALL_IN
    );

    if (activePlayers.length <= 1) {
      this.endHand();
      return;
    }

    const playingPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.PLAYING
    );

    switch (this.state.phase) {
      case GamePhase.PRE_FLOP:
        this.state.phase = GamePhase.FLOP;
        this.deck.deal();
        this.state.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
        break;
      case GamePhase.FLOP:
        this.state.phase = GamePhase.TURN;
        this.deck.deal();
        this.state.communityCards.push(this.deck.deal());
        break;
      case GamePhase.TURN:
        this.state.phase = GamePhase.RIVER;
        this.deck.deal();
        this.state.communityCards.push(this.deck.deal());
        break;
      case GamePhase.RIVER:
        this.endHand();
        return;
      default:
        return;
    }

    if (playingPlayers.length <= 1) {
      this.dealRemainingCommunityCards();
      this.endHand();
      return;
    }

    const nextIndex = this.getNextActivePlayerIndex(this.state.dealerIndex);
    if (nextIndex === -1) {
      this.dealRemainingCommunityCards();
      this.endHand();
      return;
    }

    this.state.currentPlayerIndex = nextIndex;
    this.state.currentPlayerId = this.players[nextIndex]?.id || '';
  }

  private dealRemainingCommunityCards(): void {
    while (this.state.communityCards.length < 5) {
      this.deck.deal();
      this.state.communityCards.push(this.deck.deal());
    }
    this.state.phase = GamePhase.RIVER;
  }

  private collectBets(): void {
    let totalBets = 0;
    for (const player of this.players) {
      const bet = this.state.roundBets[player.id] || 0;
      totalBets += bet;
    }

    if (totalBets > 0) {
      const eligiblePlayers = this.players
        .filter(p => this.state.playerStatus[p.id] !== PlayerStatus.FOLDED)
        .map(p => p.id);

      this.state.pots.push({
        id: uuidv4(),
        amount: totalBets,
        eligiblePlayers,
      });
    }
  }

  private endHand(): void {
    this.collectBets();

    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    if (activePlayers.length === 0) {
      this.state.phase = GamePhase.SHOWDOWN;
      return;
    }

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
      winner.chips += totalPot;
      this.state.phase = GamePhase.SHOWDOWN;
      return;
    }

    this.determineWinners();
    this.state.phase = GamePhase.SHOWDOWN;
  }

  private determineWinners(): void {
    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    if (activePlayers.length === 0) return;

    const playerHands: Map<string, { hand: HandEvaluation; cards: Card[] }> = new Map();

    for (const player of activePlayers) {
      const holeCards = this.state.playerCards[player.id];
      const communityCards = this.state.communityCards;

      if (holeCards && communityCards.length >= 3) {
        const allCards = [...holeCards, ...communityCards];
        const hand = HandEvaluator.evaluate(allCards);
        playerHands.set(player.id, { hand, cards: allCards });
      }
    }

    let bestHand: HandEvaluation | null = null;
    let winnerIds: string[] = [];

    for (const [playerId, { hand }] of playerHands) {
      if (!bestHand || hand.rank > bestHand.rank ||
        (hand.rank === bestHand.rank && hand.value > bestHand.value)) {
        bestHand = hand;
        winnerIds = [playerId];
      } else if (hand.rank === bestHand.rank && hand.value === bestHand.value) {
        winnerIds.push(playerId);
      }
    }

    const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
    const winAmount = Math.floor(totalPot / winnerIds.length);

    for (const winnerId of winnerIds) {
      const winner = this.players.find(p => p.id === winnerId);
      if (winner) {
        winner.chips += winAmount;
      }
    }
  }

  showdown(): { winners: WinnerInfo[]; potResults: PotResult[]; allHands: PlayerHandInfo[] } {
    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    const winners: WinnerInfo[] = [];
    const potResults: PotResult[] = [];
    const allHands: PlayerHandInfo[] = [];

    if (activePlayers.length === 0) {
      this.state.phase = GamePhase.ENDED;
      return { winners, potResults, allHands };
    }

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
      winners.push({
        playerId: winner.id,
        playerName: winner.name,
        winAmount: totalPot,
        potType: 'main',
        handRank: 'win',
        handDescription: '其他玩家弃牌',
        winningCards: this.state.playerCards[winner.id] || [],
        holeCards: this.state.playerCards[winner.id] || [],
        explanation: `${winner.name}获胜，其他玩家弃牌`,
      });
      potResults.push({
        potId: 'pot-0',
        amount: totalPot,
        winners: [winner.id],
        splitAmount: totalPot,
      });
      allHands.push({
        playerId: winner.id,
        playerName: winner.name,
        holeCards: this.state.playerCards[winner.id] || [],
        handRank: 'win',
        handDescription: '其他玩家弃牌',
        isWinner: true,
        winAmount: totalPot,
      });
      this.state.phase = GamePhase.ENDED;
      return { winners, potResults, allHands };
    }

    const playerHands: Map<string, { hand: HandEvaluation; cards: Card[] }> = new Map();

    for (const player of activePlayers) {
      const holeCards = this.state.playerCards[player.id];
      const communityCards = this.state.communityCards;

      if (holeCards && communityCards.length >= 3) {
        const allCards = [...holeCards, ...communityCards];
        const hand = HandEvaluator.evaluate(allCards);
        playerHands.set(player.id, { hand, cards: allCards });
      }
    }

    const rankNames: Record<number, string> = {
      [HandRank.HIGH_CARD]: '高牌',
      [HandRank.ONE_PAIR]: '一对',
      [HandRank.TWO_PAIR]: '两对',
      [HandRank.THREE_OF_A_KIND]: '三条',
      [HandRank.STRAIGHT]: '顺子',
      [HandRank.FLUSH]: '同花',
      [HandRank.FULL_HOUSE]: '葫芦',
      [HandRank.FOUR_OF_A_KIND]: '四条',
      [HandRank.STRAIGHT_FLUSH]: '同花顺',
      [HandRank.ROYAL_FLUSH]: '皇家同花顺',
    };

    const winnerIdSet = new Set<string>();

    for (const pot of this.state.pots) {
      const eligiblePlayers = activePlayers.filter(p =>
        pot.eligiblePlayers.includes(p.id)
      );

      if (eligiblePlayers.length === 0) continue;

      let bestHand: HandEvaluation | null = null;
      let potWinnerIds: string[] = [];

      for (const player of eligiblePlayers) {
        const handData = playerHands.get(player.id);
        if (!handData) continue;
        const hand = handData.hand;

        if (!bestHand || hand.rank > bestHand.rank ||
          (hand.rank === bestHand.rank && hand.value > bestHand.value)) {
          bestHand = hand;
          potWinnerIds = [player.id];
        } else if (hand.rank === bestHand.rank && hand.value === bestHand.value) {
          potWinnerIds.push(player.id);
        }
      }

      const splitAmount = Math.floor(pot.amount / potWinnerIds.length);

      for (const winnerId of potWinnerIds) {
        winnerIdSet.add(winnerId);
        const winner = this.players.find(p => p.id === winnerId);
        const hand = playerHands.get(winnerId)?.hand;

        if (winner) {
          winners.push({
            playerId: winner.id,
            playerName: winner.name,
            winAmount: splitAmount,
            potType: pot.id === this.state.pots[0]?.id ? 'main' : 'side',
            handRank: hand ? rankNames[hand.rank] || '未知' : '未知',
            handDescription: hand?.description || '未知',
            winningCards: playerHands.get(winnerId)?.hand.cards || [],
            holeCards: this.state.playerCards[winnerId] || [],
            explanation: `${winner.name}以${hand ? rankNames[hand.rank] : '未知'}获胜`,
          });
        }
      }

      potResults.push({
        potId: pot.id,
        amount: pot.amount,
        winners: potWinnerIds,
        splitAmount,
      });
    }

    for (const player of activePlayers) {
      const handData = playerHands.get(player.id);
      const hand = handData?.hand;
      const isWinner = winnerIdSet.has(player.id);
      const totalWin = winners
        .filter(w => w.playerId === player.id)
        .reduce((sum, w) => sum + w.winAmount, 0);

      allHands.push({
        playerId: player.id,
        playerName: player.name,
        holeCards: this.state.playerCards[player.id] || [],
        handRank: hand ? rankNames[hand.rank] || '未知' : '未知',
        handDescription: hand?.description || '未知',
        isWinner,
        winAmount: isWinner ? totalWin : undefined,
      });
    }

    this.state.phase = GamePhase.ENDED;
    return { winners, potResults, allHands };
  }

  getPotAmount(): number {
    return this.state.pots.reduce((sum, p) => sum + p.amount, 0) +
      Object.values(this.state.roundBets).reduce((sum, b) => sum + (b || 0), 0);
  }

  getState(): GameState {
    return { ...this.state };
  }

  getPlayerCards(playerId: string): [Card, Card] | undefined {
    return this.state.playerCards[playerId];
  }

  getPlayers(): RoomPlayer[] {
    return this.players.map(p => ({ ...p }));
  }

  getCurrentPlayerId(): string | undefined {
    if (this.state.currentPlayerIndex < 0 || this.state.currentPlayerIndex >= this.players.length) {
      return undefined;
    }
    return this.players[this.state.currentPlayerIndex]?.id;
  }

  getValidActions(playerId: string): string[] {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return [];

    const status = this.state.playerStatus[playerId];
    if (status !== PlayerStatus.PLAYING) return [];

    const myBet = this.state.roundBets[playerId] || 0;
    const toCall = this.state.currentBet - myBet;

    const actions: string[] = ['fold'];

    if (toCall === 0) {
      actions.push('check');
    } else if (player.chips >= toCall) {
      actions.push('call');
    }

    if (player.chips > toCall) {
      actions.push('raise');
    }

    if (player.chips > 0) {
      actions.push('all-in');
    }

    return actions;
  }
}
