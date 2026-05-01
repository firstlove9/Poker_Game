import { Pot } from '../types/room';

export class PotManager {
  private pots: Pot[] = [];
  private contributions: Map<string, number> = new Map();

  // 记录玩家下注
  addBet(playerId: string, amount: number): void {
    const current = this.contributions.get(playerId) || 0;
    this.contributions.set(playerId, current + amount);
  }

  // 获取玩家当前下注额
  getContribution(playerId: string): number {
    return this.contributions.get(playerId) || 0;
  }

  // 计算底池
  calculatePots(activePlayers: string[]): void {
    this.pots = [];
    const sortedContributions = Array.from(this.contributions.entries())
      .filter(([playerId]) => activePlayers.includes(playerId))
      .sort((a, b) => a[1] - b[1]);

    if (sortedContributions.length === 0) return;

    let previousAmount = 0;
    
    for (let i = 0; i < sortedContributions.length; i++) {
      const [playerId, amount] = sortedContributions[i];
      const diff = amount - previousAmount;

      if (diff > 0) {
        const eligiblePlayers = sortedContributions
          .slice(i)
          .map(([id]) => id);

        this.pots.push({
          id: `pot-${this.pots.length}`,
          amount: diff * eligiblePlayers.length,
          eligiblePlayers,
        });

        previousAmount = amount;
      }
    }
  }

  // 获取所有底池
  getPots(): Pot[] {
    return this.pots;
  }

  // 获取总底池金额
  getTotalPot(): number {
    return this.pots.reduce((sum, pot) => sum + pot.amount, 0);
  }

  // 重置
  reset(): void {
    this.pots = [];
    this.contributions.clear();
  }

  // 新一轮下注开始时，保留主池，清除边池
  newRound(): void {
    // 将所有贡献合并到主池
    if (this.pots.length > 0) {
      const mainPot = this.pots[0];
      // 保留主池信息，用于后续计算
    }
    // 清除当前轮次的贡献记录
    this.contributions.clear();
  }
}
