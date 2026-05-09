import { v4 as uuidv4 } from 'uuid';
import {
  Card,
  GamePhase,
  PlayerAction,
  PlayerStatus,
  PlayerRole,
  HandRank,
  HandEvaluation,
  RunItTwiceChoice,
  GameVariant,
  GameModifier,
  VariantRuleInfo,
  VARIANT_RULES,
  SHORT_DECK_RANKS,
} from '../types/poker';
import {
  GameState,
  RoomPlayer,
  Pot,
  PlayerActionRecord,
  WinnerInfo,
  PlayerHandInfo,
  PotResult,
  RunItTwiceDiceResult,
  RunItTwiceRoundResult,
} from '../types/room';
import { Deck } from '../poker/Deck';
import { HandEvaluator } from '../poker/HandEvaluator';

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  actionTimeout: number;
  variant: GameVariant;
  modifier?: GameModifier;
}

export class GameEngine {
  private state: GameState;
  private deck: Deck;
  private players: RoomPlayer[];
  private config: GameConfig;
  private variantRules: VariantRuleInfo;
  private hasActedThisRound: Set<string> = new Set();
  private lastAggressorIndex: number = -1;
  private actionCount: number = 0;
  private playerInitialChips: Map<string, number> = new Map();

  constructor(players: RoomPlayer[], dealerIndex: number, config: GameConfig) {
    this.players = players.filter(p => p.isReady && p.chips > 0);
    this.config = config;
    this.variantRules = VARIANT_RULES[config.variant || GameVariant.TEXAS_NLHE];
    this.deck = new Deck(this.variantRules.deckRanks);

    const playerIds = this.players.map(p => p.id);
    const n = this.players.length;
    const isHeadsUp = n === 2;

    let smallBlindIndex: number;
    let bigBlindIndex: number;

    if (isHeadsUp) {
      smallBlindIndex = dealerIndex % n;
      bigBlindIndex = (dealerIndex + 1) % n;
    } else {
      smallBlindIndex = (dealerIndex + 1) % n;
      bigBlindIndex = (dealerIndex + 2) % n;
    }

    this.state = {
      handId: uuidv4(),
      phase: GamePhase.WAITING,
      deck: [],
      communityCards: [],
      boardCards: [],
      pots: [],
      totalPot: 0,
      currentPlayerIndex: -1,
      currentPlayerId: '',
      dealerIndex,
      smallBlindIndex,
      bigBlindIndex,
      lastRaiseIndex: -1,
      currentBet: 0,
      minRaise: config.bigBlind,
      roundBets: {},
      playerCards: {},
      playerStatus: Object.fromEntries(playerIds.map(id => [id, PlayerStatus.WAITING])),
      playerRoles: {},
      actions: [],
      startTime: Date.now(),
      isHeadsUpAllIn: false,
      runItTwiceChoices: {},
      runItTwiceDiceResult: null,
      runItTwiceDiceReady: {},
      runItTwiceBoard: [],
      runItTwiceResults: [],
      lastShowdownResult: null,
    };
  }

  start(): GameState {
    if (this.players.length < 2) {
      throw new Error('至少需要2名玩家才能开始游戏');
    }

    this.deck = new Deck(this.variantRules.deckRanks);
    this.deck.shuffle();
    this.state.communityCards = [];
    this.state.boardCards = this.variantRules.boardCount > 1
      ? Array.from({ length: this.variantRules.boardCount }, () => [])
      : [];
    this.state.pots = [];
    this.state.totalPot = 0;
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
      this.playerInitialChips.set(player.id, player.chips);
    }

    this.state.phase = GamePhase.PRE_FLOP;

    this.initPlayerRoles();
    this.dealHoleCards();
    this.postBlinds();

    const isHeadsUp = this.players.length === 2;
    if (isHeadsUp) {
      this.state.currentPlayerIndex = this.state.smallBlindIndex;
    } else {
      this.state.currentPlayerIndex = this.getNextActivePlayerIndex(this.state.bigBlindIndex);
    }
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
    const count = this.variantRules.holeCardCount;
    for (const player of this.players) {
      const cards: Card[] = [];
      for (let i = 0; i < count; i++) {
        cards.push(this.deck.deal());
      }
      this.state.playerCards[player.id] = cards as any;
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
      if (sb.chips === 0) {
        this.state.playerStatus[sb.id] = PlayerStatus.ALL_IN;
      }
    }

    if (bb) {
      const bbAmount = Math.min(this.config.bigBlind, bb.chips);
      bb.chips -= bbAmount;
      this.state.roundBets[bb.id] = bbAmount;
      this.state.currentBet = bbAmount;
      if (bb.chips === 0) {
        this.state.playerStatus[bb.id] = PlayerStatus.ALL_IN;
      }
    }

    this.state.minRaise = this.config.bigBlind;
    this.lastAggressorIndex = this.state.bigBlindIndex % n;
    this.state.totalPot = this.calcTotalPot();
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
        let raiseAmount = amount;
        if (this.variantRules.isPotLimit) {
          const maxRaise = this.getPotLimitRaise();
          if (raiseAmount > maxRaise) {
            raiseAmount = maxRaise;
          }
        }
        const totalRaiseAmount = raiseAmount;
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

    this.state.totalPot = this.calcTotalPot();

    if (this.checkOnlyOnePlayerLeft()) {
      this.endHand();
    } else if (this.isBettingRoundComplete()) {
      if (this.checkHeadsUpAllIn()) {
        this.enterRunItTwiceChoice();
      } else {
        this.advancePhase();
      }
    } else {
      this.advanceToNextPlayer();
    }

    return { success: true };
  }

  private checkHeadsUpAllIn(): boolean {
    if (this.state.phase === GamePhase.RIVER) return false;

    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.PLAYING
    );
    const allInPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.ALL_IN
    );

    const nonFoldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    if (nonFoldedPlayers.length !== 2) return false;
    if (allInPlayers.length === 0) return false;
    if (activePlayers.length > 1) return false;

    return true;
  }

  private enterRunItTwiceChoice(): void {
    this.collectBets();
    this.hasActedThisRound = new Set();
    this.lastAggressorIndex = -1;
    this.state.currentBet = 0;
    this.state.roundBets = {};
    this.actionCount = 0;
    this.state.totalPot = this.calcTotalPot();
    this.state.isHeadsUpAllIn = true;
    this.state.phase = GamePhase.RUN_IT_TWICE_CHOICE;
    this.state.runItTwiceChoices = {};
    this.state.runItTwiceDiceResult = null;
    this.state.runItTwiceDiceReady = {};
    this.state.runItTwiceBoard = [];
    this.state.runItTwiceResults = [];
    this.state.currentPlayerIndex = -1;
    this.state.currentPlayerId = '';
  }

  submitRunItTwiceChoice(playerId: string, choice: RunItTwiceChoice): { success: boolean; error?: string; bothSubmitted?: boolean; finalChoice?: RunItTwiceChoice; needDice?: boolean } {
    const nonFoldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    if (nonFoldedPlayers.length !== 2) {
      return { success: false, error: '当前不是2人对决' };
    }

    if (!nonFoldedPlayers.find(p => p.id === playerId)) {
      return { success: false, error: '你不是参与对决的玩家' };
    }

    if (this.state.phase !== GamePhase.RUN_IT_TWICE_CHOICE) {
      return { success: false, error: '当前不是选择阶段' };
    }

    if (this.state.runItTwiceChoices[playerId]) {
      return { success: false, error: '你已经做出选择' };
    }

    this.state.runItTwiceChoices[playerId] = choice;

    const p1 = nonFoldedPlayers[0];
    const p2 = nonFoldedPlayers[1];
    const c1 = this.state.runItTwiceChoices[p1.id];
    const c2 = this.state.runItTwiceChoices[p2.id];

    if (!c1 || !c2) {
      return { success: true, bothSubmitted: false };
    }

    if (c1 === c2) {
      return { success: true, bothSubmitted: true, finalChoice: c1, needDice: false };
    }

    this.state.phase = GamePhase.RUN_IT_TWICE_DICE;
    this.state.runItTwiceDiceReady = {};
    this.state.runItTwiceDiceResult = null;
    return { success: true, bothSubmitted: true, needDice: true };
  }

  submitDiceRoll(playerId: string): { success: boolean; error?: string; bothReady?: boolean; diceResult?: RunItTwiceDiceResult } {
    const nonFoldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    if (nonFoldedPlayers.length !== 2) {
      return { success: false, error: '当前不是2人对决' };
    }

    if (!nonFoldedPlayers.find(p => p.id === playerId)) {
      return { success: false, error: '你不是参与对决的玩家' };
    }

    if (this.state.phase !== GamePhase.RUN_IT_TWICE_DICE) {
      return { success: false, error: '当前不是掷骰子阶段' };
    }

    if (this.state.runItTwiceDiceReady[playerId]) {
      return { success: false, error: '你已经掷过骰子了' };
    }

    this.state.runItTwiceDiceReady[playerId] = true;

    const p1 = nonFoldedPlayers[0];
    const p2 = nonFoldedPlayers[1];

    if (!this.state.runItTwiceDiceReady[p1.id] || !this.state.runItTwiceDiceReady[p2.id]) {
      return { success: true, bothReady: false };
    }

    const v1 = Math.floor(Math.random() * 6) + 1;
    const v2 = Math.floor(Math.random() * 6) + 1;

    const c1 = this.state.runItTwiceChoices[p1.id]!;
    const c2 = this.state.runItTwiceChoices[p2.id]!;

    let finalChoice: RunItTwiceChoice;
    if (v1 === v2) {
      finalChoice = 'once';
    } else if (v1 > v2) {
      finalChoice = c1;
    } else {
      finalChoice = c2;
    }

    const diceResult: RunItTwiceDiceResult = {
      player1: { id: p1.id, value: v1 },
      player2: { id: p2.id, value: v2 },
      finalChoice,
    };

    this.state.runItTwiceDiceResult = diceResult;

    if (v1 === v2) {
      this.state.runItTwiceDiceReady = {};
    }

    return { success: true, bothReady: true, diceResult };
  }

  isDiceTied(): boolean {
    if (!this.state.runItTwiceDiceResult) return false;
    return this.state.runItTwiceDiceResult.player1.value === this.state.runItTwiceDiceResult.player2.value;
  }

  resetDiceForReroll(): void {
    this.state.runItTwiceDiceReady = {};
    this.state.runItTwiceDiceResult = null;
  }

  executeRunItTwice(): { winners: WinnerInfo[]; potResults: PotResult[]; allHands: PlayerHandInfo[] } {
    const finalChoice = this.getFinalRunItTwiceChoice();
    const rounds = finalChoice === 'once' ? 1 : 2;
    return this.executeRunItTwiceLogic(rounds);
  }

  getFinalRunItTwiceChoice(): RunItTwiceChoice {
    const nonFoldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );
    const c1 = this.state.runItTwiceChoices[nonFoldedPlayers[0]?.id];
    const c2 = this.state.runItTwiceChoices[nonFoldedPlayers[1]?.id];

    if (c1 && c2 && c1 === c2) return c1;
    if (this.state.runItTwiceDiceResult) return this.state.runItTwiceDiceResult.finalChoice;
    return 'once';
  }

  private executeRunItTwiceLogic(rounds: number): { winners: WinnerInfo[]; potResults: PotResult[]; allHands: PlayerHandInfo[] } {
    const activePlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] !== PlayerStatus.FOLDED
    );

    const existingCommunityCards = [...this.state.communityCards];
    const neededCards = 5 - existingCommunityCards.length;

    const boards: Card[][] = [];
    for (let r = 0; r < rounds; r++) {
      const board: Card[] = [...existingCommunityCards];
      if (neededCards > 0) {
        this.deck.deal();
        for (let i = 0; i < neededCards; i++) {
          board.push(this.deck.deal());
        }
      }
      boards.push(board);
    }

    this.state.runItTwiceBoard = boards;

    const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
    const potPerRound = Math.floor(totalPot / rounds);
    const remainder = totalPot - potPerRound * rounds;

    const roundResults: RunItTwiceRoundResult[] = [];
    const roundWinnings: Map<string, number> = new Map();

    for (const player of activePlayers) {
      roundWinnings.set(player.id, 0);
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

    for (let round = 0; round < rounds; round++) {
      const board = boards[round];
      const potForRound = round === 0 ? potPerRound + remainder : potPerRound;

      const playerHands: Map<string, { hand: HandEvaluation; cards: Card[] }> = new Map();
      for (const player of activePlayers) {
        const holeCards = this.state.playerCards[player.id];
        if (holeCards && board.length >= 3) {
          let hand: HandEvaluation;
          const variant = this.config.variant || GameVariant.TEXAS_NLHE;
          const omahaVariants = [GameVariant.OMAHA_PLO, GameVariant.OMAHA_HI_LO, GameVariant.OMAHA_PLO5, GameVariant.OMAHA_PLO6, GameVariant.OMAHA_DOUBLE_BOARD, GameVariant.OMAHA_THREE_BOARD];
          if (omahaVariants.includes(variant)) {
            hand = HandEvaluator.evaluateOmaha(holeCards, board, this.variantRules.handRankOrder);
          } else if (variant === GameVariant.CRAZY_PINEAPPLE) {
            hand = HandEvaluator.evaluateCrazyPineapple(holeCards, board, this.variantRules.handRankOrder);
          } else {
            const allCards = [...holeCards, ...board];
            hand = HandEvaluator.evaluate(allCards, this.variantRules.handRankOrder);
          }
          playerHands.set(player.id, { hand, cards: [...holeCards, ...board] });
        }
      }

      let bestHand: HandEvaluation | null = null;
      let winnerIds: string[] = [];

      for (const player of activePlayers) {
        const handData = playerHands.get(player.id);
        if (!handData) continue;
        const hand = handData.hand;

        if (!bestHand || HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) > 0) {
          bestHand = hand;
          winnerIds = [player.id];
        } else if (HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) === 0) {
          winnerIds.push(player.id);
        }
      }

      const splitAmount = Math.floor(potForRound / winnerIds.length);
      const potRemainder = potForRound - splitAmount * winnerIds.length;

      const handRanks: Record<string, string> = {};
      for (const player of activePlayers) {
        const handData = playerHands.get(player.id);
        handRanks[player.id] = handData ? rankNames[handData.hand.rank] || '未知' : '未知';
      }

      roundResults.push({
        communityCards: board,
        winnerIds,
        winAmount: splitAmount,
        potAmount: potForRound,
        handRanks,
      });

      for (let i = 0; i < winnerIds.length; i++) {
        const wid = winnerIds[i];
        const win = splitAmount + (i === 0 ? potRemainder : 0);
        roundWinnings.set(wid, (roundWinnings.get(wid) || 0) + win);
        const winner = this.players.find(p => p.id === wid);
        if (winner) {
          winner.chips += win;
        }
      }
    }

    this.state.runItTwiceResults = roundResults;
    this.state.communityCards = boards[0];
    this.state.phase = GamePhase.SHOWDOWN;

    return this.buildRunItTwiceShowdownResult(activePlayers, roundResults, roundWinnings);
  }

  private buildRunItTwiceShowdownResult(
    activePlayers: RoomPlayer[],
    roundResults: RunItTwiceRoundResult[],
    roundWinnings: Map<string, number>
  ): { winners: WinnerInfo[]; potResults: PotResult[]; allHands: PlayerHandInfo[] } {
    const winners: WinnerInfo[] = [];
    const potResults: PotResult[] = [];
    const allHands: PlayerHandInfo[] = [];

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

    for (let round = 0; round < roundResults.length; round++) {
      const result = roundResults[round];
      const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
      const halfPot = Math.floor(totalPot / 2);
      const remainder = totalPot - halfPot * 2;
      const potForRound = round === 0 ? halfPot + remainder : halfPot;

      for (const wid of result.winnerIds) {
        const winner = this.players.find(p => p.id === wid);
        if (winner) {
          winners.push({
            playerId: winner.id,
            playerName: winner.name,
            winAmount: result.winAmount,
            potType: round === 0 ? 'main' : 'side',
            handRank: result.handRanks[wid] || '未知',
            handDescription: `第${round + 1}轮获胜`,
            winningCards: this.state.playerCards[wid] || [],
            holeCards: this.state.playerCards[wid] || [],
            explanation: `${winner.name}第${round + 1}轮以${result.handRanks[wid] || '未知'}获胜`,
          });
        }
      }

      potResults.push({
        potId: `run-it-twice-round-${round + 1}`,
        amount: potForRound,
        winners: result.winnerIds,
        splitAmount: result.winAmount,
        remainder: 0,
      });
    }

    for (const player of activePlayers) {
      const initialChips = this.playerInitialChips.get(player.id) || 0;
      const totalWin = roundWinnings.get(player.id) || 0;
      const netWin = player.chips - initialChips;

      let wonAnyRound = false;
      let lostAnyRound = false;
      for (const rr of roundResults) {
        if (rr.winnerIds.includes(player.id)) {
          if (rr.winnerIds.length === 1) {
            wonAnyRound = true;
          }
        } else {
          lostAnyRound = true;
        }
      }
      const isWinner = wonAnyRound || (!lostAnyRound && netWin > 0);

      const roundHandRanks: string[] = [];
      for (let r = 0; r < roundResults.length; r++) {
        roundHandRanks.push(roundResults[r]?.handRanks[player.id] || '未知');
      }

      const isTie = !wonAnyRound && !lostAnyRound;

      allHands.push({
        playerId: player.id,
        playerName: player.name,
        holeCards: this.state.playerCards[player.id] || [],
        handRank: roundHandRanks.join(' / '),
        handDescription: isWinner ? `跑两轮获胜 +${totalWin}` : isTie ? `跑两轮平局` : `跑两轮失利`,
        isWinner,
        winAmount: isWinner ? netWin : undefined,
        potType: isWinner ? 'both' : undefined,
        netWin,
        roundHandRanks,
      });
    }

    const foldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.FOLDED
    );
    for (const fp of foldedPlayers) {
      const initialChips = this.playerInitialChips.get(fp.id) || 0;
      allHands.push({
        playerId: fp.id,
        playerName: fp.name,
        holeCards: [],
        handRank: '弃牌',
        handDescription: '弃牌',
        isWinner: false,
        netWin: fp.chips - initialChips,
      });
    }

    this.state.phase = GamePhase.ENDED;
    return { winners, potResults, allHands };
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
    const fromIndex = this.state.currentPlayerIndex;
    const nextIndex = this.getNextActivePlayerIndex(fromIndex);
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
    this.state.totalPot = this.calcTotalPot();

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

    const boardCount = this.variantRules.boardCount || 1;
    const isMultiBoard = boardCount > 1;

    switch (this.state.phase) {
      case GamePhase.PRE_FLOP:
        this.state.phase = GamePhase.FLOP;
        if (isMultiBoard) {
          for (let b = 0; b < boardCount; b++) {
            this.deck.deal();
            this.state.boardCards[b].push(this.deck.deal(), this.deck.deal(), this.deck.deal());
          }
          this.state.communityCards = [...this.state.boardCards[0]];
        } else {
          this.deck.deal();
          this.state.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
        }
        break;
      case GamePhase.FLOP:
        this.state.phase = GamePhase.TURN;
        if (isMultiBoard) {
          for (let b = 0; b < boardCount; b++) {
            this.deck.deal();
            this.state.boardCards[b].push(this.deck.deal());
          }
          this.state.communityCards = [...this.state.boardCards[0]];
        } else {
          this.deck.deal();
          this.state.communityCards.push(this.deck.deal());
        }
        break;
      case GamePhase.TURN:
        this.state.phase = GamePhase.RIVER;
        if (isMultiBoard) {
          for (let b = 0; b < boardCount; b++) {
            this.deck.deal();
            this.state.boardCards[b].push(this.deck.deal());
          }
          this.state.communityCards = [...this.state.boardCards[0]];
        } else {
          this.deck.deal();
          this.state.communityCards.push(this.deck.deal());
        }
        break;
      case GamePhase.RIVER:
        this.endHand();
        return;
      default:
        return;
    }

    if (playingPlayers.length <= 1) {
      if (this.checkHeadsUpAllIn()) {
        this.enterRunItTwiceChoice();
        return;
      }
      this.dealRemainingCommunityCards();
      this.endHand();
      return;
    }

    const nextIndex = this.getNextActivePlayerIndex(this.state.dealerIndex);
    if (nextIndex === -1) {
      if (this.checkHeadsUpAllIn()) {
        this.enterRunItTwiceChoice();
        return;
      }
      this.dealRemainingCommunityCards();
      this.endHand();
      return;
    }

    this.state.currentPlayerIndex = nextIndex;
    this.state.currentPlayerId = this.players[nextIndex]?.id || '';
  }

  private dealRemainingCommunityCards(): void {
    const boardCount = this.variantRules.boardCount || 1;
    const isMultiBoard = boardCount > 1;

    if (isMultiBoard) {
      for (let b = 0; b < boardCount; b++) {
        const needed = 5 - this.state.boardCards[b].length;
        if (needed <= 0) continue;
        if (this.state.boardCards[b].length === 0) {
          this.deck.deal();
          this.state.boardCards[b].push(this.deck.deal(), this.deck.deal(), this.deck.deal());
        }
        while (this.state.boardCards[b].length < 5) {
          this.deck.deal();
          this.state.boardCards[b].push(this.deck.deal());
        }
      }
      this.state.communityCards = [...this.state.boardCards[0]];
    } else {
      const needed = 5 - this.state.communityCards.length;
      if (needed <= 0) return;

      if (this.state.communityCards.length === 0) {
        this.deck.deal();
        this.state.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
      }
      if (this.state.communityCards.length < 5) {
        this.deck.deal();
        this.state.communityCards.push(this.deck.deal());
      }
      if (this.state.communityCards.length < 5) {
        this.deck.deal();
        this.state.communityCards.push(this.deck.deal());
      }
    }
    this.state.phase = GamePhase.RIVER;
  }

  private collectBets(): void {
    const allBets: { playerId: string; bet: number; folded: boolean }[] = [];
    for (const player of this.players) {
      const bet = this.state.roundBets[player.id] || 0;
      if (bet > 0) {
        allBets.push({
          playerId: player.id,
          bet,
          folded: this.state.playerStatus[player.id] === PlayerStatus.FOLDED,
        });
      }
    }

    if (allBets.length === 0) return;

    const uniqueLevels = [...new Set(allBets.map(b => b.bet))].sort((a, b) => a - b);

    let prevLevel = 0;

    for (const level of uniqueLevels) {
      const levelDiff = level - prevLevel;
      let potAmount = 0;
      const eligibleIds: string[] = [];

      for (const entry of allBets) {
        if (entry.bet >= level) {
          potAmount += levelDiff;
          if (!entry.folded) {
            eligibleIds.push(entry.playerId);
          }
        }
      }

      if (potAmount > 0 && eligibleIds.length > 0) {
        this.state.pots.push({
          id: uuidv4(),
          amount: potAmount,
          eligiblePlayers: eligibleIds,
        });
      }

      prevLevel = level;
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

    const boardCount = this.variantRules.boardCount || 1;
    const isMultiBoard = boardCount > 1;

    if (isMultiBoard) {
      this.determineMultiBoardWinners(activePlayers, boardCount);
      return;
    }

    const playerHands: Map<string, { hand: HandEvaluation; cards: Card[] }> = new Map();

    for (const player of activePlayers) {
      const holeCards = this.state.playerCards[player.id];
      const communityCards = this.state.communityCards;

      if (holeCards && communityCards.length >= 3) {
        let hand: HandEvaluation;
        const variant = this.config.variant || GameVariant.TEXAS_NLHE;
        const omahaVariants = [GameVariant.OMAHA_PLO, GameVariant.OMAHA_HI_LO, GameVariant.OMAHA_PLO5, GameVariant.OMAHA_PLO6, GameVariant.OMAHA_DOUBLE_BOARD, GameVariant.OMAHA_THREE_BOARD];
        if (omahaVariants.includes(variant)) {
          hand = HandEvaluator.evaluateOmaha(holeCards, communityCards, this.variantRules.handRankOrder);
        } else if (variant === GameVariant.CRAZY_PINEAPPLE) {
          hand = HandEvaluator.evaluateCrazyPineapple(holeCards, communityCards, this.variantRules.handRankOrder);
        } else {
          const allCards = [...holeCards, ...communityCards];
          hand = HandEvaluator.evaluate(allCards, this.variantRules.handRankOrder);
        }
        playerHands.set(player.id, { hand, cards: [...holeCards, ...communityCards] });
      }
    }

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

        if (!bestHand || HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) > 0) {
          bestHand = hand;
          potWinnerIds = [player.id];
        } else if (HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) === 0) {
          potWinnerIds.push(player.id);
        }
      }

      const splitAmount = Math.floor(pot.amount / potWinnerIds.length);
      const remainder = pot.amount - splitAmount * potWinnerIds.length;

      for (let i = 0; i < potWinnerIds.length; i++) {
        const winner = this.players.find(p => p.id === potWinnerIds[i]);
        if (winner) {
          winner.chips += splitAmount + (i === 0 ? remainder : 0);
        }
      }
    }
  }

  private determineMultiBoardWinners(activePlayers: RoomPlayer[], boardCount: number): void {
    const isOmaha = [GameVariant.OMAHA_DOUBLE_BOARD, GameVariant.OMAHA_THREE_BOARD].includes(
      this.config.variant || GameVariant.TEXAS_NLHE
    );

    const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
    const baseShare = Math.floor(totalPot / boardCount);
    const remainder = totalPot - baseShare * boardCount;

    for (let b = 0; b < boardCount; b++) {
      const board = this.state.boardCards[b];
      const potForBoard = b === 0 ? baseShare + remainder : baseShare;

      const playerHands: Map<string, HandEvaluation> = new Map();
      for (const player of activePlayers) {
        const holeCards = this.state.playerCards[player.id];
        if (holeCards && board.length >= 3) {
          let hand: HandEvaluation;
          if (isOmaha) {
            hand = HandEvaluator.evaluateOmaha(holeCards, board, this.variantRules.handRankOrder);
          } else {
            const allCards = [...holeCards, ...board];
            hand = HandEvaluator.evaluate(allCards, this.variantRules.handRankOrder);
          }
          playerHands.set(player.id, hand);
        }
      }

      let bestHand: HandEvaluation | null = null;
      let winnerIds: string[] = [];

      for (const player of activePlayers) {
        const hand = playerHands.get(player.id);
        if (!hand) continue;

        if (!bestHand || HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) > 0) {
          bestHand = hand;
          winnerIds = [player.id];
        } else if (HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) === 0) {
          winnerIds.push(player.id);
        }
      }

      const splitAmount = Math.floor(potForBoard / winnerIds.length);
      const potRemainder = potForBoard - splitAmount * winnerIds.length;

      for (let i = 0; i < winnerIds.length; i++) {
        const winner = this.players.find(p => p.id === winnerIds[i]);
        if (winner) {
          winner.chips += splitAmount + (i === 0 ? potRemainder : 0);
        }
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
      const initialChips = this.playerInitialChips.get(winner.id) || 0;
      const netWin = winner.chips - initialChips;
      winners.push({
        playerId: winner.id,
        playerName: winner.name,
        winAmount: netWin,
        potType: 'main',
        handRank: 'win',
        handDescription: '其他玩家弃牌',
        winningCards: [],
        holeCards: [],
        explanation: `${winner.name}获胜，其他玩家弃牌`,
      });
      potResults.push({
        potId: 'pot-0',
        amount: totalPot,
        winners: [winner.id],
        splitAmount: totalPot,
        remainder: 0,
      });
      allHands.push({
        playerId: winner.id,
        playerName: winner.name,
        holeCards: [],
        handRank: 'win',
        handDescription: '其他玩家弃牌',
        isWinner: true,
        winAmount: netWin,
      });

      const foldedPlayers = this.players.filter(p =>
        this.state.playerStatus[p.id] === PlayerStatus.FOLDED
      );
      for (const fp of foldedPlayers) {
        const initialChips = this.playerInitialChips.get(fp.id) || 0;
        allHands.push({
          playerId: fp.id,
          playerName: fp.name,
          holeCards: [],
          handRank: '弃牌',
          handDescription: '弃牌',
          isWinner: false,
          netWin: fp.chips - initialChips,
        });
      }

      this.state.phase = GamePhase.ENDED;
      return { winners, potResults, allHands };
    }

    const playerHands: Map<string, { hand: HandEvaluation; cards: Card[] }> = new Map();

    const boardCount = this.variantRules.boardCount || 1;
    const isMultiBoard = boardCount > 1;

    if (isMultiBoard) {
      return this.multiBoardShowdown(activePlayers, boardCount);
    }

    for (const player of activePlayers) {
      const holeCards = this.state.playerCards[player.id];
      const communityCards = this.state.communityCards;

      if (holeCards && communityCards.length >= 3) {
        let hand: HandEvaluation;
        const variant = this.config.variant || GameVariant.TEXAS_NLHE;
        const omahaVariants = [GameVariant.OMAHA_PLO, GameVariant.OMAHA_HI_LO, GameVariant.OMAHA_PLO5, GameVariant.OMAHA_PLO6, GameVariant.OMAHA_DOUBLE_BOARD, GameVariant.OMAHA_THREE_BOARD];
        if (omahaVariants.includes(variant)) {
          hand = HandEvaluator.evaluateOmaha(holeCards, communityCards, this.variantRules.handRankOrder);
        } else if (variant === GameVariant.CRAZY_PINEAPPLE) {
          hand = HandEvaluator.evaluateCrazyPineapple(holeCards, communityCards, this.variantRules.handRankOrder);
        } else {
          const allCards = [...holeCards, ...communityCards];
          hand = HandEvaluator.evaluate(allCards, this.variantRules.handRankOrder);
        }
        playerHands.set(player.id, { hand, cards: [...holeCards, ...communityCards] });
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
    const winnerGrossWin = new Map<string, number>();

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

        if (!bestHand || HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) > 0) {
          bestHand = hand;
          potWinnerIds = [player.id];
        } else if (HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) === 0) {
          potWinnerIds.push(player.id);
        }
      }

      const splitAmount = Math.floor(pot.amount / potWinnerIds.length);
      const remainder = pot.amount - splitAmount * potWinnerIds.length;

      for (let i = 0; i < potWinnerIds.length; i++) {
        const winnerId = potWinnerIds[i];
        winnerIdSet.add(winnerId);
        const winner = this.players.find(p => p.id === winnerId);
        const hand = playerHands.get(winnerId)?.hand;
        const actualWin = splitAmount + (i === 0 ? remainder : 0);
        winnerGrossWin.set(winnerId, (winnerGrossWin.get(winnerId) || 0) + actualWin);

        if (winner) {
          winners.push({
            playerId: winner.id,
            playerName: winner.name,
            winAmount: actualWin,
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
        remainder,
      });
    }

    const winnerPotTypes = new Map<string, Set<string>>();
    for (const w of winners) {
      if (!winnerPotTypes.has(w.playerId)) {
        winnerPotTypes.set(w.playerId, new Set());
      }
      winnerPotTypes.get(w.playerId)!.add(w.potType);
    }

    for (const player of activePlayers) {
      const handData = playerHands.get(player.id);
      const hand = handData?.hand;
      const initialChips = this.playerInitialChips.get(player.id) || 0;
      const netWin = player.chips - initialChips;
      const isWinner = netWin > 0;

      let potType: 'main' | 'side' | 'both' | undefined;
      if (isWinner && winnerIdSet.has(player.id)) {
        const types = winnerPotTypes.get(player.id);
        if (types) {
          if (types.has('both')) {
            potType = 'both';
          } else if (types.has('side') && types.has('main')) {
            potType = 'both';
          } else if (types.has('side')) {
            potType = 'side';
          } else {
            potType = 'main';
          }
        }
      }

      allHands.push({
        playerId: player.id,
        playerName: player.name,
        holeCards: this.state.playerCards[player.id] || [],
        handRank: hand ? rankNames[hand.rank] || '未知' : '未知',
        handDescription: hand?.description || '未知',
        isWinner,
        winAmount: isWinner ? netWin : undefined,
        potType,
        netWin,
      });
    }

    const foldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.FOLDED
    );
    for (const fp of foldedPlayers) {
      const initialChips = this.playerInitialChips.get(fp.id) || 0;
      allHands.push({
        playerId: fp.id,
        playerName: fp.name,
        holeCards: [],
        handRank: '弃牌',
        handDescription: '弃牌',
        isWinner: false,
        netWin: fp.chips - initialChips,
      });
    }

    this.state.phase = GamePhase.ENDED;
    return { winners, potResults, allHands };
  }

  getPotAmount(): number {
    return this.calcTotalPot();
  }

  private calcTotalPot(): number {
    return this.state.pots.reduce((sum, p) => sum + p.amount, 0) +
      Object.values(this.state.roundBets).reduce((sum, b) => sum + (b || 0), 0);
  }

  private multiBoardShowdown(
    activePlayers: RoomPlayer[],
    boardCount: number
  ): { winners: WinnerInfo[]; potResults: PotResult[]; allHands: PlayerHandInfo[] } {
    const winners: WinnerInfo[] = [];
    const potResults: PotResult[] = [];
    const allHands: PlayerHandInfo[] = [];

    const isOmaha = [GameVariant.OMAHA_DOUBLE_BOARD, GameVariant.OMAHA_THREE_BOARD].includes(
      this.config.variant || GameVariant.TEXAS_NLHE
    );

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

    const boardLabels = ['A', 'B', 'C'];
    const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
    const baseShare = Math.floor(totalPot / boardCount);
    const remainder = totalPot - baseShare * boardCount;

    const playerTotalWin = new Map<string, number>();
    for (const p of activePlayers) {
      playerTotalWin.set(p.id, 0);
    }

    const playerBestHand = new Map<string, HandEvaluation>();

    for (let b = 0; b < boardCount; b++) {
      const board = this.state.boardCards[b];
      const potForBoard = b === 0 ? baseShare + remainder : baseShare;

      const playerHands: Map<string, HandEvaluation> = new Map();
      for (const player of activePlayers) {
        const holeCards = this.state.playerCards[player.id];
        if (holeCards && board.length >= 3) {
          let hand: HandEvaluation;
          if (isOmaha) {
            hand = HandEvaluator.evaluateOmaha(holeCards, board, this.variantRules.handRankOrder);
          } else {
            const allCards = [...holeCards, ...board];
            hand = HandEvaluator.evaluate(allCards, this.variantRules.handRankOrder);
          }
          playerHands.set(player.id, hand);
          if (!playerBestHand.has(player.id) || HandEvaluator.compareHands(hand, playerBestHand.get(player.id)!, this.variantRules.handRankOrder) > 0) {
            playerBestHand.set(player.id, hand);
          }
        }
      }

      let bestHand: HandEvaluation | null = null;
      let winnerIds: string[] = [];

      for (const player of activePlayers) {
        const hand = playerHands.get(player.id);
        if (!hand) continue;

        if (!bestHand || HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) > 0) {
          bestHand = hand;
          winnerIds = [player.id];
        } else if (HandEvaluator.compareHands(hand, bestHand, this.variantRules.handRankOrder) === 0) {
          winnerIds.push(player.id);
        }
      }

      const splitAmount = Math.floor(potForBoard / winnerIds.length);
      const potRemainder = potForBoard - splitAmount * winnerIds.length;

      for (let i = 0; i < winnerIds.length; i++) {
        const wid = winnerIds[i];
        const actualWin = splitAmount + (i === 0 ? potRemainder : 0);
        playerTotalWin.set(wid, (playerTotalWin.get(wid) || 0) + actualWin);

        const winner = this.players.find(p => p.id === wid);
        const hand = playerHands.get(wid);
        if (winner) {
          winners.push({
            playerId: wid,
            playerName: winner.name,
            winAmount: actualWin,
            potType: b === 0 ? 'main' : 'side',
            handRank: hand ? `${boardLabels[b]}板:${rankNames[hand.rank] || '未知'}` : '未知',
            handDescription: hand?.description || '未知',
            winningCards: hand?.cards || [],
            holeCards: this.state.playerCards[wid] || [],
            explanation: `${winner.name}在${boardLabels[b]}板以${hand ? rankNames[hand.rank] : '未知'}获胜`,
          });
        }
      }

      potResults.push({
        potId: `board-${boardLabels[b]}`,
        amount: potForBoard,
        winners: winnerIds,
        splitAmount,
        remainder: potRemainder,
      });
    }

    for (const player of activePlayers) {
      const initialChips = this.playerInitialChips.get(player.id) || 0;
      const netWin = player.chips - initialChips;
      const isWinner = netWin > 0;
      const hand = playerBestHand.get(player.id);

      allHands.push({
        playerId: player.id,
        playerName: player.name,
        holeCards: this.state.playerCards[player.id] || [],
        handRank: hand ? rankNames[hand.rank] || '未知' : '未知',
        handDescription: hand?.description || '未知',
        isWinner,
        winAmount: isWinner ? netWin : undefined,
        netWin,
      });
    }

    const foldedPlayers = this.players.filter(p =>
      this.state.playerStatus[p.id] === PlayerStatus.FOLDED
    );
    for (const fp of foldedPlayers) {
      const initialChips = this.playerInitialChips.get(fp.id) || 0;
      allHands.push({
        playerId: fp.id,
        playerName: fp.name,
        holeCards: [],
        handRank: '弃牌',
        handDescription: '弃牌',
        isWinner: false,
        netWin: fp.chips - initialChips,
      });
    }

    this.state.phase = GamePhase.ENDED;
    return { winners, potResults, allHands };
  }

  getState(): GameState {
    return { ...this.state };
  }

  getVariantRules(): VariantRuleInfo {
    return this.variantRules;
  }

  getMaxRaise(playerId: string): number {
    if (!this.variantRules.isPotLimit) return Infinity;
    return this.getPotLimitRaise();
  }

  getPlayerCards(playerId: string): Card[] | undefined {
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

    const actions: string[] = [];

    const modifier = this.config.modifier || GameModifier.NONE;
    const isPreflop = this.state.phase === GamePhase.PRE_FLOP;
    const noFoldPreflop = isPreflop && (
      modifier === GameModifier.BOMB_POT ||
      modifier === GameModifier.BOMB_POT_DOUBLE ||
      modifier === GameModifier.ALL_IN_NO_FOLD ||
      modifier === GameModifier.ALL_IN_ALL_ROUND
    );
    const noRaisePreflop = isPreflop && (
      modifier === GameModifier.BOMB_POT ||
      modifier === GameModifier.BOMB_POT_DOUBLE ||
      modifier === GameModifier.ALL_IN_NO_FOLD ||
      modifier === GameModifier.ALL_IN_ALL_ROUND ||
      modifier === GameModifier.BLIND_SHOWDOWN
    );
    const forceAllInPreflop = isPreflop && modifier === GameModifier.ALL_IN_ALL_ROUND;
    const blindShowdownPreflop = isPreflop && modifier === GameModifier.BLIND_SHOWDOWN;

    if (!noFoldPreflop) {
      actions.push('fold');
    }

    if (forceAllInPreflop) {
      if (player.chips > 0) {
        actions.push('all-in');
      }
      return actions;
    }

    if (blindShowdownPreflop) {
      actions.push('all-in');
      return actions;
    }

    if (toCall <= 0) {
      actions.push('check');
    } else if (player.chips >= toCall) {
      actions.push('call');
    }

    if (toCall > 0 && player.chips > 0 && player.chips <= toCall) {
      actions.push('all-in');
    }

    if (!noRaisePreflop) {
      const isPotLimit = this.variantRules.isPotLimit;
      const canRaise = isPotLimit
        ? player.chips > toCall && this.getPotLimitRaise() > toCall
        : player.chips > toCall;

      if (canRaise) {
        actions.push('raise');
      }
    }

    if (player.chips > 0 && player.chips > toCall) {
      actions.push('all-in');
    }

    return actions;
  }

  private getPotLimitRaise(): number {
    const pot = this.state.totalPot;
    const currentPlayer = this.players[this.state.currentPlayerIndex];
    const myBet = currentPlayer ? (this.state.roundBets[currentPlayer.id] || 0) : 0;
    const callAmount = this.state.currentBet - myBet;
    return pot + callAmount + this.state.currentBet;
  }
}
