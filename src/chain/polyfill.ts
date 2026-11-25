// web3.js / Anchor expect Node's Buffer in the browser.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
