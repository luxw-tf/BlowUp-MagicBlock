import type { AbilityId, CharacterId } from './types';

export const GAME_TITLE = 'BlowUp';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  color: string;
  accent: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'frog', name: 'Ranger', color: '#4fbf6e', accent: '#f2e9c9' },
  { id: 'cat', name: 'Barbarian', color: '#e8713c', accent: '#fff2e0' },
  { id: 'blob', name: 'Mage', color: '#d2475b', accent: '#e8dcff' },
  { id: 'rat', name: 'Knight', color: '#5b84e0', accent: '#e6eefc' },
  { id: 'duck', name: 'Rogue', color: '#8a5bd6', accent: '#ff8c1a' },
  { id: 'creature', name: 'Shade', color: '#b04aa0', accent: '#d8fffb' },
  { id: 'skull', name: 'Bones', color: '#e0a82e', accent: '#fff4d6' },
];

/** The colours a bot can wear: never Bones' gold, so a gold skeleton on the dock is always a player. */
export const BOT_CHARACTERS = CHARACTERS.filter((c) => c.id !== 'skull');

export const characterDef = (id: CharacterId): CharacterDef => CHARACTERS.find((c) => c.id === id)!;

/** Bots are the undead crew. */
export const BOT_NAMES = [
  'Rattlebones',
  'Old Marrow',
  'Grimjaw',
  'Hollow Jack',
  'Mortimer',
  'Wormwood',
  'Ashgrin',
  'Knucklebones',
  'Sorrowbone',
  'Creak',
  'Gravesend',
  'Dustjaw',
  'Sir Ribcage',
  'Cinder',
  'Thimbleskull',
  'Marrowmere',
  'Lantern Lou',
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
  timeTheft: { id: 'timeTheft', name: 'Time Theft', blurb: 'Holding the bomb: +2s on the fuse. Not holding: 1.5s off it', color: '#ffe066', glyph: 'clock' },
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
