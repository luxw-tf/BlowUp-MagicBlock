/**
 * The commentary. Big callouts for you, words slammed all over the screen, speech bubbles for the bots, flavour
 * for the kill feed and the results. Every pool is a shuffled bag, so lines don't repeat until the pool runs dry.
 * `{name}` gets filled in.
 */

export const LINES = {
  // ── big callouts (you) ──
  youStart: [
    'YOU SPAWNED IN OHIO',
    'THE FUSE CHOSE YOU',
    'RNG SAID SKILL ISSUE',
    'DAY ONE COOKED',
    'MAIN CHARACTER (DOOMED)',
    'BRO GOT DRAFTED',
    'TUNG TUNG TUNG... YOU',
    'CONGRATS, YOU ARE THE BOMB',
  ],
  youGot: [
    'BRO GOT FANUM TAXED',
    'CHAT WE ARE COOKED',
    'PASS IT. PASS IT. PASS IT.',
    'NOT THE BOMB 😭',
    'HOT POTATO ERA',
    'THIS IS SO OHIO',
    'TICK TOCK UNC',
    'WHO SENT THIS 💀',
    'BOMBARDIRO CROCODILO',
    'SKIBIDI BOMB BOP',
    'IT IS GIVING EXPLOSIVE',
    'BRO IS THE DELIVERY GUY',
    'NAH THIS IS CRAZY',
    'LOCK IN. NOW.',
  ],
  youPassed: ['YEET', 'NOT MY PROBLEM', 'DELIVERED, NO TIP', 'CATCH UNC', 'FANUM TAXED IT BACK', 'BYE BYE 👋', 'RETURN TO SENDER'],
  youClutch: [
    'PLOT ARMOUR',
    '+1000 AURA',
    'CLUTCH OR KICK',
    'FRAME PERFECT FR',
    'THAT WAS ILLEGAL',
    'ABSOLUTE CINEMA',
    'HIM BEHAVIOUR',
    'BRO IS BUILT DIFFERENT',
    'SHEEEESH',
    'WE ARE SO BACK',
  ],
  youMissed: [
    'AIRBALL',
    'BRO THREW LIKE AN NPC',
    'AIM ASSIST WHERE',
    'CAUGHT IN 4K MISSING',
    'THAT WAS FOR THE FISH',
    'THROWING. LITERALLY.',
    '-500 AURA',
    'MID THROW NGL',
  ],
  youReflected: ['NO U', 'UNO REVERSE', 'RETURN TO SENDER', 'REFLECTED + RATIO', 'NOT IN MY HOUSE'],
  youBlocked: ['NOT TODAY', 'DENIED UNC', 'BLOCKED AND REPORTED', 'SHIELD GO BRRR'],
  youSlowed: ['LEGS: BUFFERING', 'SKILL ISSUE APPLIED', 'WALKING IN OHIO MUD', 'BRO IS ON 0.5X'],
  youSwapped: ['PLOT TWIST FR', 'TELEPORTED TO OHIO', 'WAIT WHERE AM I'],
  youCritical: ['PASS IT PASS IT PASS IT', 'YOU ARE SO COOKED', 'ITS SO OVER', 'OH NO OH NO OH NO', 'BRO IS ABOUT TO CRASH OUT', 'FINAL AURA CHECK'],
  youItem: ['FREE ITEM NO CAP', 'LOOT GOBLIN', 'W PICKUP', 'MYSTERY BOX RIZZ'],
  firstOut: ['FIRST OF ALL, SKILL ISSUE', 'FIRST ONE TO OHIO', 'SOMEONE ATE THE L', 'F IN THE CHAT', 'AURA: DELETED', 'AND SO IT BEGINS'],
  survived: ['SURVIVED. BARELY.', 'STILL HERE, STILL GOATED', 'AURA INTACT', 'LIVING RENT FREE', 'NOT COOKED YET', 'LOCKED IN'],
  finalTwo: ['GENERATIONAL BEEF', '1V1 ME BRO', 'FINAL BOSS MUSIC', 'ONLY ONE AURA SURVIVES', 'BRR BRR PATAPIM TIME', 'TRALALERO TRALALA'],
  youOutBot: ['UNINSTALL', 'BOT DIFF', 'OUTPLAYED BY AN NPC', 'SKELETON MOGGED YOU', '-1000 AURA', 'THE SKELETON HAS RIZZ'],
  youOut: ['YOU GOT COOKED', 'RATIO + EXPLODED', 'SENT TO THE SHADOW REALM', 'L + BOOM', 'TOUCH GRASS', 'CRASHED OUT. LITERALLY.'],
  youWon: ['UNFORTUNATELY, YOU COOKED', 'ABSOLUTE CINEMA', 'SIGMA BEHAVIOUR', 'AURA: INFINITE', 'YOU ARE HIM', 'W W W W W'],
  theyWon: ['{name} COOKED', '{name} IS HIM', '{name} ATE, NO CRUMBS', '{name} MOGGED THE LOBBY', '{name} SAID GG EZ'],

  // ── words slammed onto the screen ──
  wordsGot: ['💀', 'COOKED', 'NAH', 'BRUH', 'OHIO', 'L', '😭', 'FANUM TAX', 'RUN', 'PANIK', 'TICK TOCK', 'UNLUCKY'],
  wordsPass: ['YEET', 'BYE', 'W', 'EZ', 'NOT ME', 'CATCH', 'SKIBIDI', 'ZOOM'],
  wordsClutch: ['+1000 AURA', 'W', 'SHEESH', 'HIM', 'CINEMA', 'GOATED', 'CLUTCH', '🔥', 'LOCK IN', 'SIGMA', 'NO CAP'],
  wordsMiss: ['AIRBALL', 'L', 'BRUH', 'NPC', 'MID', '-500 AURA', '💀', 'WHIFF', 'LAG?'],
  wordsBoom: [
    'L',
    '💀',
    'RATIO',
    'RIP BOZO',
    'COOKED',
    'SKILL ISSUE',
    'GG',
    'OOF',
    'KABOOM',
    '-1000 AURA',
    'F',
    'BOMBARDIRO CROCODILO',
    'TUNG TUNG TUNG SAHUR',
    'OHIO',
    'CRASHOUT',
    'MOGGED',
    '6 7',
    'BRO EXPLODED',
  ],
  wordsCritical: ['PASS IT', 'RUN', 'PANIK', '1 SEC', 'OH NO', 'BRO', '😭', 'ITS OVER'],
  wordsFinal: ['1V1', 'BEEF', 'FINAL BOSS', 'LOCK IN', 'AURA FARMING', 'NO CAP', 'TRALALERO TRALALA', 'BRR BRR PATAPIM'],
  wordsWin: ['W', 'GOATED', 'HIM', 'SIGMA', 'GG EZ', '🔥', 'CINEMA', '+∞ AURA', 'CHAMPION', 'RIZZ', 'BUSSIN', 'NO CAP'],
  wordsLose: ['L', 'RATIO', '💀', 'UNLUCKY', 'NPC', 'TOUCH GRASS', 'COOKED', 'MID'],
  wordsReflect: ['NO U', 'UNO REVERSE', 'DENIED', 'BLOCKED', 'NOPE'],

  // ── bot speech bubbles ──
  botGot: [
    'nah not me',
    'who sent this',
    'bro why me',
    'this is SO unfair',
    'I did not ask for this',
    'hold my aura',
    'chat is this real',
    'ok who threw that',
    'not the bomb 😭',
    'my bones are shaking',
    'tung tung tung NO',
    'I am literally a skeleton',
  ],
  botPassed: ['yeet', 'hot potato!', 'byeee', 'your problem now', 'catch, unc', 'fanum tax', 'skibidi pass', 'special delivery', 'sending it', 'ratio + bomb'],
  botClutch: ['CLUTCH', 'plot armour', 'too ez', 'diff', '+1000 aura', 'did you see that', 'I am HIM'],
  botGotLate: ['NAH THATS CRAZY', 'I am cooked', 'not like this', 'bro passed me a nuke', 'tell my mom', 'AAAAAAA'],
  botMissed: ['my bad', 'lag', 'the wind did that', 'aim was on vacation', 'that was a warning', 'my bones slipped'],
  botBlocked: ['not today', 'nope', 'denied', 'shield up, bozo'],
  botReflected: ['no u', 'uno reverse', 'return to sender'],
  botWitness: [
    'RIP bozo',
    'F',
    'he was so real for that',
    'gone but not forgotten',
    'L',
    'aura: deleted',
    'Ohio claimed another',
    'press F',
    'skill issue tbh',
    'that could be me',
    'LMAOOO',
    'bro became confetti',
    '6 7',
  ],
  botWon: ['GG EZ', 'sigma grindset', 'absolute cinema', 'bones too strong', 'skeleton supremacy'],
  botSlowed: ['my legs', 'why am I slow', 'who did that'],

  // ── kill feed: "<name> ..." ──
  feedOut: [
    'blew up',
    'got sent to the shadow realm',
    'exploded (skill issue)',
    'got fanum taxed by the fuse',
    'is now in Ohio',
    'went kaboom, no cap',
    "got Bombardiro Crocodilo'd",
    'lost all aura',
    'crashed out. literally.',
    'got cooked medium rare',
    'became confetti',
    'logged off permanently',
    'got tung tung tung sahur-ed',
  ],
} satisfies Record<string, string[]>;

export type Pool = keyof typeof LINES;

const bags = new Map<Pool, string[]>();
const lastLine = new Map<Pool, string>();

/** Next line from a pool, shuffled bag style (no repeats until the pool is used up). */
export function line(pool: Pool, vars: Record<string, string> = {}): string {
  let bag = bags.get(pool);
  if (!bag || bag.length === 0) {
    bag = [...LINES[pool]];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // never the same line twice in a row across a refill
    if (bag.length > 1 && bag[bag.length - 1] === lastLine.get(pool)) bag.unshift(bag.pop()!);
    bags.set(pool, bag);
  }
  const text = bag.pop()!;
  lastLine.set(pool, text);
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? '').toUpperCase());
}

/** A verdict for the results screen, by your finishing place. */
export function verdict(place: number | null | undefined): string {
  switch (place) {
    case 1:
      return 'ABSOLUTE CINEMA. NOBODY ELSE HAD AURA.';
    case 2:
      return 'SO CLOSE. GENERATIONAL BEEF WITH THE WINNER.';
    case 3:
      return 'BRONZE. MID, BUT RESPECTABLE MID.';
    case 4:
      return 'FOURTH. THE NPC OF THE PODIUM.';
    case 5:
      return 'FIFTH. LOWKEY COOKED.';
    default:
      return 'LAST. FIRST OF ALL, SKILL ISSUE.';
  }
}
