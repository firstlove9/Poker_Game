const { GameEngine } = require('./server/dist/game/GameEngine');
const { GameVariant, GameModifier, GamePhase, PlayerAction, PlayerStatus } = require('./server/dist/types/poker');

const players = [
  { id: 'A', name: 'Player A', chips: 1000, isReady: true, seatIndex: 0 },
  { id: 'B', name: 'Player B', chips: 1000, isReady: true, seatIndex: 1 },
];

const config = {
  smallBlind: 10,
  bigBlind: 20,
  actionTimeout: 30,
  variant: GameVariant.OMAHA_DOUBLE_BOARD,
  modifier: GameModifier.BOMB_POT,
};

const engine = new GameEngine(players, 0, config);
const state = engine.start();

console.log('=== Game Started ===');
console.log('Phase:', state.phase);
console.log('Current player:', state.currentPlayerId);
console.log('Player status:', state.playerStatus);
console.log('Current bet:', state.currentBet);
console.log('Round bets:', state.roundBets);
console.log('Dealer:', state.dealerIndex, 'SB:', state.smallBlindIndex, 'BB:', state.bigBlindIndex);
console.log('Hole cards A:', state.playerCards['A']?.length, 'B:', state.playerCards['B']?.length);

function doAction(playerId, action, amount) {
  console.log(`\n--- ${playerId} ${action} ${amount || ''} ---`);
  const result = engine.performAction(playerId, action, amount);
  console.log('Result:', result.success, result.error || '');
  const s = engine.getState();
  console.log('Phase:', s.phase);
  console.log('Current player:', s.currentPlayerId);
  console.log('Player status:', s.playerStatus);
  console.log('Current bet:', s.currentBet);
  console.log('Round bets:', s.roundBets);
  console.log('Community cards:', s.communityCards.length);
  return s;
}

// Preflop: BOMB_POT - no fold, no raise
// A is SB, B is BB
// In heads-up, SB acts first preflop
let s = doAction('A', PlayerAction.CALL); // A calls (completes SB to BB)
s = doAction('B', PlayerAction.CHECK); // B checks (already has BB)

// Flop
console.log('\n=== FLOP ===');
s = doAction('B', PlayerAction.CHECK); // B checks (BB acts first post-flop in current code)
s = doAction('A', PlayerAction.CHECK); // A checks

// Turn
console.log('\n=== TURN ===');
s = doAction('B', PlayerAction.CHECK); // B checks
s = doAction('A', PlayerAction.CHECK); // A checks

// River
console.log('\n=== RIVER ===');
console.log('Phase after turn checks:', s.phase);
console.log('Current player:', s.currentPlayerId);
