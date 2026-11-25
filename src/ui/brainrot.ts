/**
 * The commentary: big callouts for you, speech bubbles for the bots, flavour for the kill feed and the results.
 * Every pool is a shuffled bag, so lines don't repeat until the pool runs dry. `{name}` and `{by}` get filled in.
 */

export const LINES = {
  // ── big callouts (you) ──
  youStart: [
    'you spawned in Ohio',
    'the fuse chose you',
    'RNG said skill issue',
    'day one bomb holder',
    'you started cooked',
    'main character syndrome',
    'bro got drafted',
    'the bomb picked its fav',
  ],
  youGot: [
    'its giving explosive',
    'not the bomb again',
    'bro got fanum taxed',
    'hot potato era',
    'pass it. PASS IT.',
    'chat, we are cooked',
    'tick tock, unc',
    'this is so Ohio',
    'aura check incoming',
    'who sent this',
    'certified bomb moment',
    'holding it is not sigma',
    'bro is the delivery guy',
    'skibidi bomb bop',
  ],
  youPassed: [
    'yeet',
    'not my problem now',
    'its their problem now',
    'hot potato diff',
    'delivered. no tip.',
    'fanum taxed it back',
    'catch, unc',
    'free bomb, no cap',
  ],
  youClutch: [
    'PLOT ARMOUR',
    'clutch or kick',
    '+1000 AURA',
    'frame perfect fr',
    'that was illegal',
    'lowkey cinema',
    'the audacity',
    'HIM behaviour',
    'certified clutch',
    'bro has plot armour',
  ],
  youMissed: [
    'AIRBALL',
    'bro threw like an NPC',
    'aim assist where',
    'mid throw ngl',
    'caught missing in 4K',
    'the aim is on vacation',
    'that was for the fish',
    'throwing. literally.',
  ],
  youReflected: ['RETURN TO SENDER', 'NO U', 'uno reverse', 'reflected. ratio.', 'deflect diff', 'not in my house'],
  youBlocked: ['NOT TODAY', 'denied, unc', 'shield go brr', 'no bombs allowed', 'blocked and reported'],
  youSlowed: ['skill issue applied', 'legs: buffering', 'you got slowed. L.', 'walking in Ohio mud'],
  youSwapped: ['plot twist fr', 'teleported to Ohio', 'swap diff', 'wait where am I'],
  youCritical: ['PASS IT', 'you are SO cooked', 'its so over', 'OH NO OH NO', 'bro is about to crash out', 'final aura check'],
  youItem: ['free item, no cap', 'loot goblin moment', 'W pickup', 'mystery box rizz'],
  firstOut: [
    'first of all, skill issue',
    'first one to Ohio',
    'and so it begins',
    'someone ate the L',
    'first L of the day',
    'F in the chat',
    'aura: deleted',
  ],
  survived: [
    'survived. barely.',
    'still here, still goated',
    'aura intact',
    'living rent free',
    'next round, same rizz',
    'not cooked yet',
    'certified survivor',
  ],
  finalTwo: [
    'GENERATIONAL BEEF',
    '1v1 me bro',
    'final boss music',
    'only one aura survives',
    'its giving final round',
    'Bombardiro Crocodilo time',
  ],
  youOutBot: ['uninstall', 'bot diff', 'outplayed by an NPC', 'skeleton mogged you', '-1000 aura', 'the skeleton has rizz'],
  youOut: ['you got cooked', 'ratio + exploded', 'sent to the shadow realm', 'L + boom', 'touch grass, respawn never', 'crashed out. literally.'],
  youWon: [
    'UNFORTUNATELY, YOU COOKED',
    'absolute cinema',
    'sigma behaviour',
    'built different',
    'aura: infinite',
    'W rizz W bomb',
    'you are HIM',
  ],
  theyWon: ['{name} cooked', '{name} is HIM', '{name} ate, no crumbs', '{name} has aura', '{name} mogged the lobby', '{name} said GG EZ'],

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
    'not the bomb',
    'my bones are shaking',
  ],
  botPassed: ['yeet', 'hot potato!', 'byeee', 'your problem now', 'catch, unc', 'fanum tax', 'skibidi pass', 'special delivery', 'sending it'],
  botClutch: ['CLUTCH', 'plot armour', 'too ez', 'diff', '+1000 aura', 'did you see that'],
  botGotLate: ['NAH THATS CRAZY', 'I am cooked', 'not like this', 'bro passed me a nuke', 'tell my mom'],
  botMissed: ['my bad', 'lag', 'the wind did that', 'aim was on vacation', 'that was a warning'],
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
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** A verdict for the results screen, by your finishing place. */
export function verdict(place: number | null | undefined): string {
  switch (place) {
    case 1:
      return 'Absolute cinema. Nobody else had aura.';
    case 2:
      return 'So close. Generational beef with the winner.';
    case 3:
      return 'Bronze. Mid, but respectable mid.';
    case 4:
      return 'Fourth. The NPC of the podium.';
    case 5:
      return 'Fifth. Lowkey cooked.';
    default:
      return 'Last. First of all, skill issue.';
  }
}
