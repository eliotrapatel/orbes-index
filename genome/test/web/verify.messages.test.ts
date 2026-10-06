/**
 * WRITE TO ORBES CLIENT SERVICES and MESSAGES in the collector app (plan NEXT-NINE of 2026-10-06, §3.1 CS-01): the pure
 * model (messages-model.ts). The context and label of each kind of button, the ids sent by kind (never a label), the
 * words checked before the server checks them (its own words), the conversation as MESSAGES lists it (staff never
 * named, a scan without a link), the places a message's link opens, and NOW's line while an answer is unread.
 */
import { describe, expect, it } from 'vitest';
import { MESSAGE_LIMITS } from '../../src/server/services/messages.js';
import { orderReference as serverOrderReference } from '../../src/server/services/orders.js';
import { MESSAGES } from '../../src/web/verify/copy.js';
import {
  concerningTarget,
  contextInput,
  messageProblem,
  modelContext,
  nowMessagesLine,
  orderContext,
  orderReference,
  pieceContext,
  referenceWords,
  releaseContext,
  scanContext,
  threadModel,
  warrantyContext,
} from '../../src/web/verify/messages-model.js';

const SCAN = '5a864af8-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const ORDER = '3f9a21c4-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const DROP = '8b2c4d3e-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const MODEL = '9c1d2e3f-1b2c-4d3e-8f90-a1b2c3d4e5f6';

describe('the context each button attaches', () => {
  it('labels a scan, its warranty, a piece, an order, a release and a salon request as the server does, and sends only the kind and id', () => {
    const scan = scanContext(SCAN, '5A864AF8', 'INVALID_SIGNATURE');
    expect(scan).toEqual({ kind: 'SCAN', id: SCAN, label: 'REF 5A864AF8 · INVALID SIGNATURE' });
    expect(contextInput(scan)).toEqual({ kind: 'SCAN', id: SCAN });
    const warranty = warrantyContext(SCAN, '5A864AF8', 'AUTHENTIC_REGISTERED');
    expect(warranty.label).toBe('REF 5A864AF8 · AUTHENTIC REGISTERED · WARRANTY NO LONGER VALID');
    expect(contextInput(warranty)).toEqual({ kind: 'SCAN', id: SCAN, about: 'WARRANTY' });
    expect(pieceContext({ productId: 'O26-J-00184', model: 'Monolithe' })).toEqual({ kind: 'PIECE', id: 'O26-J-00184', label: 'MONOLITHE · O26-J-00184' });
    expect(pieceContext({ productId: 'O26-J-00184', model: 'MONOLITHE', modelVariant: 'Blue' }).label).toBe('MONOLITHE IN BLUE · O26-J-00184');
    expect(orderReference(ORDER)).toBe(serverOrderReference(ORDER));
    expect(orderContext({ id: ORDER, model: 'MONOLITHE' })).toEqual({ kind: 'ORDER', id: ORDER, label: 'ORDER OR-3F9A21C4 · MONOLITHE' });
    expect(releaseContext(DROP, 'Monolithe in steel', 'CONFIRMED', referenceWords('LR-8K2M4Q'))).toEqual({
      kind: 'RELEASE',
      id: DROP,
      label: 'MONOLITHE IN STEEL · CONFIRMED · REFERENCE LR-8K2M4Q',
    });
    expect(releaseContext(DROP, 'MONOLITHE, THE OCTOBER DRAW', null, '').label).toBe('MONOLITHE, THE OCTOBER DRAW');
    expect(modelContext(MODEL, 'Eclipse')).toEqual({ kind: 'MODEL', id: MODEL, label: 'ECLIPSE · PRIVATE SALON REQUEST' });
    expect(contextInput(modelContext(MODEL, 'Eclipse'))).toEqual({ kind: 'MODEL', id: MODEL });
    expect(contextInput(null)).toBeNull();
  });

  it('checks the words as the server does, with its words', () => {
    expect(MESSAGES.max).toBe(MESSAGE_LIMITS.collector);
    expect(messageProblem('   ')).toBe('Write your message.');
    expect(messageProblem('x'.repeat(2001))).toBe('Your message is limited to 2,000 characters.');
    expect(messageProblem(` ${'x'.repeat(2000)} `)).toBeNull();
  });
});

describe('MESSAGES', () => {
  const at = (iso: string) => `2026-10-06T${iso}:00.000Z`;

  it('lists the conversation oldest first, each author line in this phone\'s time, staff signed ORBES CLIENT SERVICES, the collector\'s context linked but a scan\'s', () => {
    const t = threadModel(
      {
        unread: true,
        messages: [
          { id: 'm1', from: 'YOU', body: 'My clasp.\nIt slips.', at: at('12:02'), concerning: { kind: 'PIECE', label: 'MONOLITHE · O26-J-00184', path: '/verify/pieces/O26-J-00184' } },
          { id: 'm2', from: 'YOU', body: 'This scan.', at: at('12:10'), concerning: { kind: 'SCAN', label: 'REF 5A864AF8 · INVALID SIGNATURE', path: null } },
          { id: 'm3', from: 'ORBES_CLIENT_SERVICES', body: 'We will look at it.', at: at('14:40'), concerning: null },
        ],
      },
      120,
    );
    expect(t.items.map((i) => i.author)).toEqual(['YOU · 6 OCT 2026 · 14:02', 'YOU · 6 OCT 2026 · 14:10', 'ORBES CLIENT SERVICES · 6 OCT 2026 · 16:40']);
    expect(t.items[0]).toMatchObject({ mine: true, body: 'My clasp.\nIt slips.', concerning: { label: 'MONOLITHE · O26-J-00184', target: { to: 'piece', id: 'O26-J-00184' } } });
    expect(t.items[1]!.concerning).toEqual({ kind: 'SCAN', label: 'REF 5A864AF8 · INVALID SIGNATURE', target: null });
    expect(t.items[2]).toMatchObject({ mine: false, concerning: null });
    expect(t).toMatchObject({ empty: null, replyLabel: 'YOUR REPLY', readUpTo: at('14:40') });
    const empty = threadModel({ unread: false, messages: [] }, 0);
    expect(empty).toEqual({ items: [], empty: MESSAGES.emptyThread, replyLabel: 'YOUR MESSAGE', readUpTo: null });
    expect(MESSAGES.emptyThread).toBe('You may write to ORBES Client Services here, or from a piece, an order or a release, which is then attached to your message.');
  });

  it('opens the place a message concerned: a piece, an order on MY PIECES\' ORDERS, a release, a model; nothing else', () => {
    expect(concerningTarget('/verify/pieces/o26-j-00184')).toEqual({ to: 'piece', id: 'O26-J-00184' });
    expect(concerningTarget(`/verify/pieces?order=${ORDER}`)).toEqual({ to: 'order', id: ORDER });
    expect(concerningTarget('/verify/pieces')).toEqual({ to: 'pieces' });
    expect(concerningTarget(`/verify/releases/${DROP}`)).toEqual({ to: 'release', id: DROP });
    expect(concerningTarget('/verify/lookbook/eclipse')).toEqual({ to: 'sheet', slug: 'eclipse' });
    for (const bad of [null, '', 'https://example.com/verify/pieces', '/verify/releases/x', '/legal', 'javascript:alert(1)']) expect(concerningTarget(bad), String(bad)).toBeNull();
  });

  it('says on NOW, while an answer is unread, that ORBES Client Services has answered, with READ', () => {
    expect(nowMessagesLine(true)).toEqual({ label: 'MESSAGES', sentence: 'ORBES Client Services has answered you.', action: 'READ' });
    expect(nowMessagesLine(false)).toBeNull();
  });

  it('writes its words calmly: no exclamation mark, the button and the sheet as the plan names them', () => {
    const words = JSON.stringify(MESSAGES);
    expect(words).not.toContain('!');
    expect(MESSAGES.write).toBe('WRITE TO ORBES CLIENT SERVICES');
    expect(MESSAGES.sentText).toBe('Your message is with ORBES Client Services. Their answer will appear in your account, under MESSAGES.');
    expect(MESSAGES.signedOut).toBe('Sign in or create an ORBES account to write to ORBES Client Services. Their answer will appear in your account.');
    expect(MESSAGES.hint).toBe('Please leave out passwords and card numbers.');
  });
});
