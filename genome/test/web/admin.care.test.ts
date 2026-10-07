/**
 * The console's Yearly care board (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6): its pure parts. The tabs in the order
 * of the steps, each step's words, what an OPERATOR may do at each step (an AUDITOR nothing), the label's check (a PDF
 * of at most 2 MiB, the server's limit), the Messages board's link to an open request, and its place in the sidebar.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARE_LABEL_MAX_BYTES as SERVER_LABEL_MAX } from '../../src/server/services/care.js';
import { CARE_REQUEST_STATUSES } from '../../src/server/db/schema.js';
import { CARE_LABEL_MAX_BYTES, CARE_STATUS_LABELS, CARE_TABS, careActions, careHref, careLinkText, careTab, labelFileProblem, shipmentText } from '../../src/web/admin/model/care.js';
import { CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';

describe('the Yearly care board (BP-19 T6)', () => {
  it('has a tab per step, in their order, Requested by default', () => {
    expect(CARE_TABS.map((t) => t.value)).toEqual([...CARE_REQUEST_STATUSES]);
    expect(CARE_TABS.map((t) => t.label)).toEqual(['Requested', 'Label sent', 'At the atelier', 'On its way back', 'Done', 'Cancelled']);
    expect(careTab({})).toBe('REQUESTED');
    expect(careTab({ status: 'RETURNING' })).toBe('RETURNING');
    expect(careTab({ status: 'NOPE' })).toBe('REQUESTED');
    expect(CARE_REQUEST_STATUSES.map((s) => toneOf('care', s))).toEqual(['alert', 'outline', 'alert', 'outline', 'solid', 'muted']);
    expect(Object.keys(CARE_STATUS_LABELS)).toEqual([...CARE_REQUEST_STATUSES]);
  });

  it('offers an OPERATOR each step in turn, CANCEL until the piece is shipped back; an AUDITOR nothing', () => {
    expect(CAPABILITY_MIN_ROLE.manageCare).toBe('OPERATOR');
    expect(careActions('REQUESTED', 'OPERATOR')).toEqual(['label', 'cancel']);
    expect(careActions('LABEL_SENT', 'ADMIN')).toEqual(['receive', 'cancel']);
    expect(careActions('RECEIVED', 'OPERATOR')).toEqual(['return', 'cancel']);
    expect(careActions('RETURNING', 'OPERATOR')).toEqual(['complete']);
    expect(careActions('DONE', 'ADMIN')).toEqual([]);
    expect(careActions('CANCELLED', 'ADMIN')).toEqual([]);
    for (const s of CARE_REQUEST_STATUSES) {
      expect(careActions(s, 'AUDITOR')).toEqual([]);
      expect(careActions(s, 'RETAIL')).toEqual([]);
    }
  });

  it('takes a label that is a PDF of at most 2 MB, the server\'s limit', () => {
    expect(CARE_LABEL_MAX_BYTES).toBe(SERVER_LABEL_MAX);
    expect(labelFileProblem(null)).toBe('Choose the label, a PDF.');
    expect(labelFileProblem({ type: 'image/png', size: 100, name: 'label.png' })).toBe('Send the label itself, as a PDF.');
    expect(labelFileProblem({ type: 'application/pdf', size: CARE_LABEL_MAX_BYTES + 1, name: 'label.pdf' })).toBe('The label is limited to 2 MB.');
    expect(labelFileProblem({ type: '', size: 2_000, name: 'LABEL.PDF' })).toBeNull();
    expect(labelFileProblem({ type: 'application/pdf', size: CARE_LABEL_MAX_BYTES, name: 'label.pdf' })).toBeNull();
  });

  it('links a client\'s open request from the Messages board as `Yearly care · O26-J-00184`', () => {
    expect(careLinkText({ serial: 'O26-J-00184' })).toBe('Yearly care · O26-J-00184');
    expect(careHref({ id: 'abc' })).toBe('#/care/abc');
    expect(shipmentText(null)).toBe('—');
    expect(shipmentText({ carrier: { id: 'c', name: 'Colissimo' }, tracking: '6A12345678901', trackingUrl: 'https://x/6A12345678901', at: '2026-10-07T09:00:00Z', pdf: true })).toBe('Colissimo · 6A12345678901');
  });

  it('sits in the sidebar under Clients, after Warranties', () => {
    const main = readFileSync(new URL('../../src/web/admin/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/\{ route: 'warranties', label: 'Warranties' \},\n\s+\{ route: 'care', label: 'Yearly care' \},\n\s+\{ route: 'retailers', label: 'Points of sale' \}/);
  });
});
