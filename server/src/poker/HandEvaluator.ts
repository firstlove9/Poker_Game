import { Card, HandRank, HandEvaluation, HandRankNames, RANKS } from '../types/poker';

export class HandEvaluator {
  private static readonly RANK_VALUES: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  };

  static evaluate(cards: Card[], handRankOrder?: HandRank[]): HandEvaluation {
    if (cards.length < 5) {
      throw new Error('Need at least 5 cards to evaluate');
    }

    const rankOrder = handRankOrder || [
      HandRank.ROYAL_FLUSH, HandRank.STRAIGHT_FLUSH, HandRank.FOUR_OF_A_KIND,
      HandRank.FULL_HOUSE, HandRank.FLUSH, HandRank.STRAIGHT,
      HandRank.THREE_OF_A_KIND, HandRank.TWO_PAIR, HandRank.ONE_PAIR, HandRank.HIGH_CARD,
    ];

    const combinations = this.getCombinations(cards, 5);
    
    let bestHand: Card[] = [];
    let bestRank = HandRank.HIGH_CARD;
    let bestValue = 0;

    for (const combo of combinations) {
      const { rank, value } = this.evaluateFiveCards(combo);
      const cmp = this.compareRankValue(rank, value, bestRank, bestValue, rankOrder);
      if (cmp > 0) {
        bestRank = rank;
        bestValue = value;
        bestHand = combo;
      }
    }

    const holeCards = cards.slice(0, 2);
    const communityCards = cards.slice(2);
    const holeCardsUsed = bestHand.filter(card => 
      holeCards.some(hc => hc.code === card.code)
    );
    const communityCardsUsed = bestHand.filter(card =>
      communityCards.some(cc => cc.code === card.code)
    );

    return {
      rank: bestRank,
      rankName: HandRankNames[bestRank],
      cards: bestHand,
      holeCardsUsed,
      communityCardsUsed,
      description: this.getDescription(bestHand, bestRank),
      value: bestValue,
    };
  }

  static evaluateOmaha(holeCards: Card[], communityCards: Card[], handRankOrder?: HandRank[]): HandEvaluation {
    if (holeCards.length < 4 || communityCards.length < 3) {
      throw new Error('Omaha needs at least 4 hole cards and 3 community cards');
    }

    const rankOrder = handRankOrder || [
      HandRank.ROYAL_FLUSH, HandRank.STRAIGHT_FLUSH, HandRank.FOUR_OF_A_KIND,
      HandRank.FULL_HOUSE, HandRank.FLUSH, HandRank.STRAIGHT,
      HandRank.THREE_OF_A_KIND, HandRank.TWO_PAIR, HandRank.ONE_PAIR, HandRank.HIGH_CARD,
    ];

    const holeCombos = this.getCombinations(holeCards, 2);
    const communityCombos = this.getCombinations(communityCards, 3);

    let bestHand: Card[] = [];
    let bestRank = HandRank.HIGH_CARD;
    let bestValue = 0;
    let bestHoleUsed: Card[] = [];
    let bestCommunityUsed: Card[] = [];

    for (const hc of holeCombos) {
      for (const cc of communityCombos) {
        const combo = [...hc, ...cc];
        const { rank, value } = this.evaluateFiveCards(combo);
        const cmp = this.compareRankValue(rank, value, bestRank, bestValue, rankOrder);
        if (cmp > 0) {
          bestRank = rank;
          bestValue = value;
          bestHand = combo;
          bestHoleUsed = hc;
          bestCommunityUsed = cc;
        }
      }
    }

    return {
      rank: bestRank,
      rankName: HandRankNames[bestRank],
      cards: bestHand,
      holeCardsUsed: bestHoleUsed,
      communityCardsUsed: bestCommunityUsed,
      description: this.getDescription(bestHand, bestRank),
      value: bestValue,
    };
  }

  static evaluateCrazyPineapple(holeCards: Card[], communityCards: Card[], handRankOrder?: HandRank[]): HandEvaluation {
    if (holeCards.length < 3 || communityCards.length < 2) {
      throw new Error('Crazy Pineapple needs at least 3 hole cards and 2 community cards');
    }

    const rankOrder = handRankOrder || [
      HandRank.ROYAL_FLUSH, HandRank.STRAIGHT_FLUSH, HandRank.FOUR_OF_A_KIND,
      HandRank.FULL_HOUSE, HandRank.FLUSH, HandRank.STRAIGHT,
      HandRank.THREE_OF_A_KIND, HandRank.TWO_PAIR, HandRank.ONE_PAIR, HandRank.HIGH_CARD,
    ];

    const allCards = [...holeCards, ...communityCards];
    const combinations = this.getCombinations(allCards, 5);

    let bestHand: Card[] = [];
    let bestRank = HandRank.HIGH_CARD;
    let bestValue = 0;

    for (const combo of combinations) {
      const { rank, value } = this.evaluateFiveCards(combo);
      const cmp = this.compareRankValue(rank, value, bestRank, bestValue, rankOrder);
      if (cmp > 0) {
        bestRank = rank;
        bestValue = value;
        bestHand = combo;
      }
    }

    const holeCardsUsed = bestHand.filter(card =>
      holeCards.some(hc => hc.code === card.code)
    );
    const communityCardsUsed = bestHand.filter(card =>
      communityCards.some(cc => cc.code === card.code)
    );

    return {
      rank: bestRank,
      rankName: HandRankNames[bestRank],
      cards: bestHand,
      holeCardsUsed,
      communityCardsUsed,
      description: this.getDescription(bestHand, bestRank),
      value: bestValue,
    };
  }

  private static evaluateFiveCards(cards: Card[]): { rank: HandRank; value: number } {
    const isFlush = this.isFlush(cards);
    const isStraight = this.isStraight(cards);
    const isWheelStraight = this.isWheelStraight(cards);
    const counts = this.getCardCounts(cards);
    const sortedRanks = this.getSortedRanks(cards);

    if (isFlush && (isStraight || isWheelStraight)) {
      if (isWheelStraight) {
        return {
          rank: HandRank.STRAIGHT_FLUSH,
          value: this.calculateValue([5, 4, 3, 2, 1]),
        };
      }
      const isRoyal = sortedRanks[0] === 14 && sortedRanks[4] === 10;
      const baseRank = isRoyal ? HandRank.ROYAL_FLUSH : HandRank.STRAIGHT_FLUSH;
      return {
        rank: baseRank,
        value: this.calculateValue(sortedRanks),
      };
    }

    if (counts.includes(4)) {
      return {
        rank: HandRank.FOUR_OF_A_KIND,
        value: this.calculateValueWithCounts(sortedRanks, counts, 4),
      };
    }

    if (counts.includes(3) && counts.includes(2)) {
      return {
        rank: HandRank.FULL_HOUSE,
        value: this.calculateValueWithCounts(sortedRanks, counts, 3, 2),
      };
    }

    if (isFlush) {
      return {
        rank: HandRank.FLUSH,
        value: this.calculateValue(sortedRanks),
      };
    }

    if (isStraight || isWheelStraight) {
      if (isWheelStraight) {
        return {
          rank: HandRank.STRAIGHT,
          value: this.calculateValue([5, 4, 3, 2, 1]),
        };
      }
      return {
        rank: HandRank.STRAIGHT,
        value: this.calculateValue(sortedRanks),
      };
    }

    if (counts.includes(3)) {
      return {
        rank: HandRank.THREE_OF_A_KIND,
        value: this.calculateValueWithCounts(sortedRanks, counts, 3),
      };
    }

    if (counts.filter(c => c === 2).length === 2) {
      return {
        rank: HandRank.TWO_PAIR,
        value: this.calculateValueWithCounts(sortedRanks, counts, 2),
      };
    }

    if (counts.includes(2)) {
      return {
        rank: HandRank.ONE_PAIR,
        value: this.calculateValueWithCounts(sortedRanks, counts, 2),
      };
    }

    return {
      rank: HandRank.HIGH_CARD,
      value: this.calculateValue(sortedRanks),
    };
  }

  private static compareRankValue(
    rank1: HandRank, value1: number,
    rank2: HandRank, value2: number,
    rankOrder: HandRank[]
  ): number {
    const idx1 = rankOrder.indexOf(rank1);
    const idx2 = rankOrder.indexOf(rank2);
    const order1 = idx1 === -1 ? rank1 : idx1;
    const order2 = idx2 === -1 ? rank2 : idx2;
    if (order1 !== order2) {
      return order2 - order1;
    }
    return value1 - value2;
  }

  private static isFlush(cards: Card[]): boolean {
    const suits = new Set(cards.map(c => c.suit));
    return suits.size === 1;
  }

  private static isStraight(cards: Card[]): boolean {
    const ranks = this.getSortedRanks(cards);
    for (let i = 0; i < ranks.length - 1; i++) {
      if (ranks[i] - ranks[i + 1] !== 1) {
        return false;
      }
    }
    return true;
  }

  private static isWheelStraight(cards: Card[]): boolean {
    const ranks = this.getSortedRanks(cards);
    return ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2;
  }

  private static getCardCounts(cards: Card[]): number[] {
    const rankCounts: Record<number, number> = {};
    for (const card of cards) {
      const value = this.RANK_VALUES[card.rank];
      rankCounts[value] = (rankCounts[value] || 0) + 1;
    }
    return Object.values(rankCounts).sort((a, b) => b - a);
  }

  private static getSortedRanks(cards: Card[]): number[] {
    return cards
      .map(c => this.RANK_VALUES[c.rank])
      .sort((a, b) => b - a);
  }

  private static getCombinations<T>(array: T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (array.length < k) return [];
    const result: T[][] = [];
    function backtrack(start: number, current: T[]) {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < array.length; i++) {
        current.push(array[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    }
    backtrack(0, []);
    return result;
  }

  private static calculateValue(ranks: number[]): number {
    let value = 0;
    for (let i = 0; i < ranks.length; i++) {
      value = value * 100 + ranks[i];
    }
    return value;
  }

  private static calculateValueWithCounts(
    ranks: number[], 
    counts: number[], 
    primaryCount: number,
    secondaryCount?: number
  ): number {
    const rankCounts: Record<number, number> = {};
    for (const rank of ranks) {
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
    }
    const groups: number[][] = [];
    for (let i = 4; i >= 1; i--) {
      const group = Object.entries(rankCounts)
        .filter(([_, count]) => count === i)
        .map(([rank, _]) => parseInt(rank))
        .sort((a, b) => b - a);
      if (group.length > 0) {
        groups.push(group);
      }
    }
    let value = 0;
    for (const group of groups) {
      for (const rank of group) {
        value = value * 100 + rank;
      }
    }
    return value;
  }

  private static getDescription(cards: Card[], rank: HandRank): string {
    const ranks = this.getSortedRanks(cards);
    const rankNames = ranks.map(r => {
      if (r === 14) return 'A';
      if (r === 13) return 'K';
      if (r === 12) return 'Q';
      if (r === 11) return 'J';
      return r.toString();
    });

    const suit = cards[0].suit;
    const suitName = {
      hearts: '红桃',
      diamonds: '方块',
      clubs: '梅花',
      spades: '黑桃',
    }[suit];

    const rankCounts: Record<number, number> = {};
    for (const r of ranks) {
      rankCounts[r] = (rankCounts[r] || 0) + 1;
    }

    const getRankName = (v: number) => {
      if (v === 14) return 'A';
      if (v === 13) return 'K';
      if (v === 12) return 'Q';
      if (v === 11) return 'J';
      return v.toString();
    };

    switch (rank) {
      case HandRank.ROYAL_FLUSH:
        return `${suitName}皇家同花顺 A-K-Q-J-10`;
      case HandRank.STRAIGHT_FLUSH: {
        if (this.isWheelStraight(cards)) {
          return `${suitName}同花顺 5-4-3-2-A`;
        }
        return `${suitName}同花顺 ${rankNames.join('-')}`;
      }
      case HandRank.FOUR_OF_A_KIND: {
        const fourRank = Object.entries(rankCounts).find(([_, c]) => c === 4);
        const kickerRank = Object.entries(rankCounts).find(([_, c]) => c === 1);
        const fourName = fourRank ? getRankName(parseInt(fourRank[0])) : rankNames[0];
        const kickerName = kickerRank ? getRankName(parseInt(kickerRank[0])) : '';
        return kickerName ? `四条 ${fourName}（踢脚${kickerName}）` : `四条 ${fourName}`;
      }
      case HandRank.FULL_HOUSE: {
        const threeRank = Object.entries(rankCounts).find(([_, c]) => c === 3);
        const twoRank = Object.entries(rankCounts).find(([_, c]) => c === 2);
        const threeName = threeRank ? getRankName(parseInt(threeRank[0])) : rankNames[0];
        const twoName = twoRank ? getRankName(parseInt(twoRank[0])) : rankNames[3];
        return `葫芦 ${threeName}带${twoName}`;
      }
      case HandRank.FLUSH:
        return `${suitName}同花 ${rankNames.slice(0, 5).join('-')}`;
      case HandRank.STRAIGHT: {
        if (this.isWheelStraight(cards)) {
          return `顺子 5-4-3-2-A`;
        }
        return `顺子 ${rankNames.join('-')}`;
      }
      case HandRank.THREE_OF_A_KIND: {
        const threeRank = Object.entries(rankCounts).find(([_, c]) => c === 3);
        const threeName = threeRank ? getRankName(parseInt(threeRank[0])) : rankNames[0];
        return `三条 ${threeName}`;
      }
      case HandRank.TWO_PAIR: {
        const pairRanks = Object.entries(rankCounts)
          .filter(([_, c]) => c === 2)
          .map(([r, _]) => parseInt(r))
          .sort((a, b) => b - a);
        const kickerRank = Object.entries(rankCounts).find(([_, c]) => c === 1);
        const highPairName = pairRanks.length > 0 ? getRankName(pairRanks[0]) : rankNames[0];
        const lowPairName = pairRanks.length > 1 ? getRankName(pairRanks[1]) : rankNames[2];
        const kickerName = kickerRank ? getRankName(parseInt(kickerRank[0])) : '';
        return kickerName ? `两对 ${highPairName}和${lowPairName}（踢脚${kickerName}）` : `两对 ${highPairName}和${lowPairName}`;
      }
      case HandRank.ONE_PAIR: {
        const pairRank = Object.entries(rankCounts).find(([_, c]) => c === 2);
        const pairName = pairRank ? getRankName(parseInt(pairRank[0])) : rankNames[0];
        const kickers = Object.entries(rankCounts)
          .filter(([_, c]) => c === 1)
          .map(([r, _]) => parseInt(r))
          .sort((a, b) => b - a)
          .map(r => getRankName(r));
        return kickers.length > 0 ? `一对 ${pairName}（踢脚${kickers.join('-')}）` : `一对 ${pairName}`;
      }
      default:
        return `高牌 ${rankNames.join('-')}`;
    }
  }

  static compareHands(hand1: HandEvaluation, hand2: HandEvaluation, rankOrder?: HandRank[]): number {
    if (rankOrder) {
      const idx1 = rankOrder.indexOf(hand1.rank);
      const idx2 = rankOrder.indexOf(hand2.rank);
      const order1 = idx1 === -1 ? hand1.rank : idx1;
      const order2 = idx2 === -1 ? hand2.rank : idx2;
      if (order1 !== order2) {
        return order2 - order1;
      }
    } else {
      if (hand1.rank !== hand2.rank) {
        return hand2.rank - hand1.rank;
      }
    }
    return hand1.value - hand2.value;
  }
}
