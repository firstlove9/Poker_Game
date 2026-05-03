import { Card, Suit, Rank, SUITS, RANKS } from '../types/poker';

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  // 重置并洗牌
  reset(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({
          suit,
          rank,
          code: `${rank}${suit[0].toUpperCase()}`,
        });
      }
    }
    this.shuffle();
  }

  // 洗牌 (Fisher-Yates算法)
  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  // 发牌
  deal(): Card {
    const card = this.cards.pop();
    if (!card) {
      throw new Error('Deck is empty');
    }
    return card;
  }

  // 发多张牌
  dealMultiple(count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.deal());
    }
    return cards;
  }

  // 查看剩余牌数
  remaining(): number {
    return this.cards.length;
  }

  // 烧牌 (弃牌)
  burn(): void {
    this.deal();
  }
}
