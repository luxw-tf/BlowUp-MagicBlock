import type { AbilityId, CharacterId } from './types';

export const GAME_TITLE = 'BlowUp';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  color: string;
  accent: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'frog', name: 'Sharky', color: '#5fbf4a', accent: '#f2e9c9' },
  { id: 'cat', name: 'Anne', color: '#f08a3c', accent: '#fff2e0' },
  { id: 'blob', name: 'Mako', color: '#a678ff', accent: '#e8dcff' },
  { id: 'rat', name: 'Henry', color: '#9aa1ad', accent: '#f4a7b9' },
  { id: 'duck', name: 'Barbarossa', color: '#ffd23f', accent: '#ff8c1a' },
  { id: 'creature', name: 'Bones', color: '#2f3b4f', accent: '#7cf9e0' },
];

export const characterDef = (id: CharacterId): CharacterDef => CHARACTERS.find((c) => c.id === id)!;

export const BOT_NAMES = [
  'Salty Pete',
  'One-Eyed Mo',
  'Barnacle Bea',
  "Cap'n Crumbs",
  'Long Gary',
  'Mad Maud',
  'Pickles',
  'Squid Vicious',
  'Old Tom',
  'Rusty Kate',
  'Bilge',
  'Lucky Nell',
  'Peg-Leg Ted',
  'Dread Doris',
  'Gully',
  'Marlow',
  'Tidewater Jo',
];

export interface AbilityDef {
  id: AbilityId;
  name: string;
  blurb: string;
  color: string;
  /** an icon name from ui/Icon */
  glyph: string;
}

export const ABILITY_DEFS: Record<AbilityId, AbilityDef> = {
  returnToSender: { id: 'returnToSender', name: 'Return to Sender', blurb: 'Reflect the next incoming bomb (0.75s)', color: '#ff5fa2', glyph: 'reflect' },
  notToday: { id: 'notToday', name: 'Not Today', blurb: 'Block the next incoming bomb (1.25s)', color: '#4fc3ff', glyph: 'shield' },
  outtaHere: { id: 'outtaHere', name: 'Full Sail', blurb: 'A long emergency dash', color: '#7dff6b', glyph: 'sprint' },
  plotTwist: { id: 'plotTwist', name: 'Plot Twist', blurb: 'Swap places with the pirate nearest your cursor', color: '#c38bff', glyph: 'swap' },
  skillIssue: { id: 'skillIssue', name: 'Dead Weight', blurb: 'Slow the pirate nearest your cursor by 35%', color: '#ffb347', glyph: 'slow' },
  timeTheft: { id: 'timeTheft', name: 'Time Theft', blurb: '+2s on the active fuse (round cap applies)', color: '#ffe066', glyph: 'clock' },
};

export const CALLOUTS = {
  firstElimination: 'first one overboard',
  missedThrow: 'missed!',
  reflection: 'sent it back',
  finalTwo: 'last two standing',
  closeCall: 'close shave!',
  victory: 'you win!',
  eliminatedByBot: 'overboard',
  disconnect: 'jumped ship',
};
