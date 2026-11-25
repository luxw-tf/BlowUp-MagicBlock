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
  'john pork',
  'freakbob',
  'unregistered hypercam 2',
  'the IRS',
  'herobrine',
  'greg heffley',
  'the fog',
  'Quandale Dingle',
  '2012 honda civic',
  'the hat man',
  'HARAMBE',
  'the creature',
  'evil twin',
  'lebron james',
  'doakes',
  'the industrial revolution',
];

export interface AbilityDef {
  id: AbilityId;
  name: string;
  blurb: string;
  color: string;
  glyph: string;
}

export const ABILITY_DEFS: Record<AbilityId, AbilityDef> = {
  returnToSender: { id: 'returnToSender', name: 'Return to Sender', blurb: 'Reflect the next incoming bomb (0.75s)', color: '#ff5fa2', glyph: '↩' },
  notToday: { id: 'notToday', name: 'Not Today', blurb: 'Block the next incoming bomb (1.25s)', color: '#4fc3ff', glyph: '⛨' },
  outtaHere: { id: 'outtaHere', name: 'Outta Here', blurb: 'Emergency dash, 6 units', color: '#7dff6b', glyph: '»' },
  plotTwist: { id: 'plotTwist', name: 'Plot Twist', blurb: 'Swap places with the player nearest your cursor (8u)', color: '#c38bff', glyph: '⇄' },
  skillIssue: { id: 'skillIssue', name: 'Skill Issue', blurb: 'Slow the player nearest your cursor by 35% (8u)', color: '#ffb347', glyph: '🐌' },
  timeTheft: { id: 'timeTheft', name: 'Time Theft', blurb: '+2s on the active fuse (round cap applies)', color: '#ffe066', glyph: '⏱' },
};

export const CALLOUTS = {
  firstElimination: 'first of all, skill issue',
  missedThrow: 'AIRBALL',
  reflection: 'return to sender',
  finalTwo: 'generational beef',
  closeCall: 'plot armour',
  victory: 'unfortunately, you cooked',
  eliminatedByBot: 'uninstall',
  disconnect: 'bro clocked out',
};
