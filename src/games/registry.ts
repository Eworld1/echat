import type { Engine, GameId } from './engine';
import { ticTacToe } from './tictactoe';
import { checkers } from './checkers';
import { chess } from './chess';
import { ludo } from './ludo';

/** All turn-based game engines (pure rules, no Firebase) — used online and vs the computer. */
export type AnyEngine = Engine<unknown, unknown>;
export const ENGINES: Record<GameId, AnyEngine> = {
  tictactoe: ticTacToe as unknown as AnyEngine,
  chess: chess as unknown as AnyEngine,
  checkers: checkers as unknown as AnyEngine,
  ludo: ludo as unknown as AnyEngine
};
