import { Card, Suit, Rank, SUITS, RANKS } from '../types/poker';

export class Deck {
  private cards: Card[] = [];
  private customRanks: Rank[];

  constructor(ranks?: Rank[]) {
    this.customRanks = ranks || [...RANKS];
    this.reset();
  }

  reset(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of this.customRanks) {
        this.cards.push({
          suit,
          rank,
          code: `${rank}${suit[0].toUpperCase()}`,
        });
      }
    }
    this.shuffle();
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(): Card {
    const card = this.cards.pop();
    if (!card) {
      throw new Error('Deck is empty');
    }
    return card;
  }

  dealMultiple(count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.deal());
    }
    return cards;
  }

  remaining(): number {
    return this.cards.length;
  }

  burn(): void {
    this.deal();
  }
}
