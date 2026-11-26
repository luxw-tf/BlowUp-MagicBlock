/**
 * The tutorial: a real offline match against one practice dummy that stands still, with a coach card walking you
 * through the moves. Each step finishes when the game sees you do it. The fuse is kept from running out, so
 * nobody blows up while you learn.
 */
import { useEffect, useRef, useState } from 'react';
import { CHARACTERS } from '../game/content';
import { GameSession } from '../game/session';
import { getPlayer } from '../game/sim';
import type { CharacterId, MatchState, PlayerId } from '../game/types';
import type { Profile } from '../state/settings';

const DUMMY: PlayerId = 'dummy';

/** A two-player match: you, and a dummy with no brain (no bot, no input, so it just stands there). */
export function createTutorialSession(p: Profile): GameSession {
  const other: CharacterId = CHARACTERS.find((c) => c.id !== p.character)!.id;
  return new GameSession([
    { id: 'p0', name: p.name, character: p.character, isBot: false },
    { id: DUMMY, name: 'Practice Dummy', character: other, isBot: false },
  ]);
}

/** Put the bomb in someone's hands with a fresh, long fuse (the tutorial's own hand, not a pass). */
function handTo(s: MatchState, id: PlayerId) {
  const b = s.bomb;
  b.holderId = id;
  b.projectile = null;
  b.protectedId = null;
  b.lastGiverId = null;
  b.fuseDuration = 12;
  b.fuseSetAt = s.time;
  b.fuseDeadline = s.time + 12;
  const p = getPlayer(s, id);
  if (p) p.recoverUntil = 0;
}

interface Step {
  title: string;
  body: React.ReactNode;
}
const STEPS: Step[] = [
  { title: 'Move around', body: <>Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>.</> },
  { title: 'Dash', body: <>Press <kbd>Space</kbd> for a quick burst of speed. It recharges after a moment.</> },
  {
    title: 'Throw the bomb',
    body: (
      <>
        You have the bomb. Aim at the dummy with the mouse and <kbd>Left click</kbd> to throw. Throws can miss, so
        line it up.
      </>
    ),
  },
  { title: 'Tag it back', body: <>It came back to you! Walk right up to the dummy and <kbd>Right click</kbd> to tag. A throw reaches far but can miss; a tag never misses and leaves them dazed for a moment, but you must be close.</> },
  { title: 'Use an item', body: <>Walk over a glowing mystery crate to pick up an item, then press <kbd>E</kbd> to use it.</> },
  {
    title: 'You are ready',
    body: (
      <>
        Nobody knows how long the fuse is. When it starts hissing, pass it fast: whoever holds it when it blows is out.
        Last one standing wins.
      </>
    ),
  },
];

export function TutorialCoach({ session, onPlay, onExit }: { session: GameSession; onPlay: () => void; onExit: () => void }) {
  const [step, setStep] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const stepRef = useRef(0);
  const startPos = useRef<{ x: number; z: number } | null>(null);
  const tagGiven = useRef(false);
  stepRef.current = step;

  const advance = (from: number) =>
    setStep((cur) => {
      if (cur !== from) return cur;
      setNote(null);
      return cur + 1;
    });

  // Watch what you do.
  useEffect(
    () =>
      session.subscribe((events) => {
        const cur = stepRef.current;
        for (const e of events) {
          if (cur === 1 && e.type === 'dash' && e.id === session.localId) advance(1);
          if (cur === 2 && e.type === 'transfer' && e.from === session.localId && e.method === 'throw') advance(2);
          if (cur === 2 && e.type === 'miss' && e.from === session.localId) setNote('Missed! Grab it back and try again.');
          if (cur === 3 && e.type === 'transfer' && e.from === session.localId && e.method === 'tag') advance(3);
          if (cur === 4 && (e.type === 'abilityUsed' || e.type === 'abilityFailed') && e.id === session.localId) advance(4);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );

  // Keep the round going, hand the bomb over when a step needs it, and check movement.
  useEffect(() => {
    const t = setInterval(() => {
      const s = session.state;
      if (s.phase !== 'active') return;
      // nobody blows up in the tutorial
      s.roundDeadline = Math.max(s.roundDeadline, s.time + 40);
      if (s.bomb.fuseDeadline !== null && s.bomb.fuseDeadline - s.time < 6) {
        s.bomb.fuseDeadline = s.time + 12;
        s.bomb.fuseDuration = 12;
        s.bomb.fuseSetAt = s.time;
      }
      const me = getPlayer(s, session.localId);
      const cur = stepRef.current;
      if (cur === 0 && me) {
        startPos.current ??= { ...me.pos };
        if (Math.hypot(me.pos.x - startPos.current.x, me.pos.z - startPos.current.z) > 3) advance(0);
      }
      // steps 2 and 3 need the bomb in your hands
      if (cur === 2 && s.bomb.holderId === DUMMY && !s.bomb.projectile) handTo(s, session.localId);
      if (cur === 2 && s.bomb.holderId !== session.localId && s.bomb.holderId !== DUMMY) handTo(s, session.localId);
      if (cur === 3 && !tagGiven.current && s.bomb.holderId === DUMMY && !s.bomb.projectile) {
        tagGiven.current = true;
        setTimeout(() => handTo(session.state, session.localId), 900);
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const done = step >= STEPS.length - 1;
  const st = STEPS[Math.min(step, STEPS.length - 1)];
  return (
    <div className="coach" role="dialog" aria-label="Tutorial">
      <div className="coach-head">
        <span className="coach-count">
          {done ? 'All done' : `Step ${step + 1} of ${STEPS.length - 1}`}
        </span>
        <div className="coach-dots" aria-hidden>
          {STEPS.slice(0, -1).map((_, i) => (
            <i key={i} className={i < step ? 'done' : i === step ? 'on' : ''} />
          ))}
        </div>
      </div>
      <h3 key={step}>{st.title}</h3>
      <p>{st.body}</p>
      {note && <p className="coach-note">{note}</p>}
      <div className="coach-actions">
        {done ? (
          <>
            <button className="btn primary" onClick={onPlay}>
              Play for real
            </button>
            <button className="btn plank" onClick={onExit}>
              Menu
            </button>
          </>
        ) : (
          <button className="coach-skip" onClick={onExit}>
            Skip tutorial
          </button>
        )}
      </div>
    </div>
  );
}
