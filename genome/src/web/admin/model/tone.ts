/**
 * Visual tone of every status the console shows. The palette is
 * monochrome on purpose; the one colour, oxblood red (#8A1C1C), is kept for
 * the few facts that demand immediate action (CRITICAL anomalies, a stored
 * code that no longer verifies, a broken audit chain).
 *
 *   solid    filled black mark: in force (ACTIVE, OWNED, AUTHENTIC)
 *   outline  hollow mark: pending / in progress (ISSUED, OPEN, NOT STARTED)
 *   muted    grey: historical (RETIRED, SUPERSEDED, RESOLVED, EXPIRED)
 *   alert    rotated square (diamond) and a bold label: needs attention (REVOKED, LOST, SUSPICIOUS)
 *   critical red: act now
 */
export type Tone = 'solid' | 'outline' | 'muted' | 'alert' | 'critical';

const PRODUCT: Record<string, Tone> = {
  RESERVED: 'outline',
  ISSUED: 'outline',
  ACTIVATED: 'solid',
  REGISTERED: 'solid',
  OWNED: 'solid',
  TRANSFERRED: 'solid',
  SERVICED: 'outline',
  RESOLD: 'solid',
  RETIRED: 'muted',
  REVOKED: 'alert',
  COUNTERFEIT_FLAGGED: 'alert',
  LOST: 'alert',
  STOLEN: 'alert',
};

const CODE: Record<string, Tone> = { ACTIVE: 'solid', SUPERSEDED: 'muted', REVOKED: 'alert' };
const KEY: Record<string, Tone> = { ACTIVE: 'solid', RETIRED: 'muted', REVOKED: 'alert' };
const SEVERITY: Record<string, Tone> = { LOW: 'muted', MEDIUM: 'outline', HIGH: 'alert', CRITICAL: 'critical' };
const ANOMALY_STATUS: Record<string, Tone> = { OPEN: 'alert', ACKNOWLEDGED: 'outline', RESOLVED: 'muted', DISMISSED: 'muted' };
const WARRANTY: Record<string, Tone> = { NOT_STARTED: 'outline', ACTIVE: 'solid', EXPIRED: 'muted', VOID: 'alert' };
const OWNERSHIP: Record<string, Tone> = { UNREGISTERED: 'outline', REGISTERED: 'solid', OWNED: 'solid', TRANSFER_PENDING: 'outline' };
const SERVICE: Record<string, Tone> = { OPEN: 'outline', COMPLETED: 'muted', CANCELLED: 'muted' };
/** A client's account: a LOCKED one cannot sign in until ORBES Client Services unlocks it. */
const ACCOUNT: Record<string, Tone> = { ACTIVE: 'solid', LOCKED: 'alert', DELETED: 'muted' };
/** A case of the Cases queue: an open one waits for staff, as an open anomaly does. */
const CASE: Record<string, Tone> = { OPEN: 'alert', CLOSED: 'muted' };
/**
 * A category or model of the catalogue: an inactive one issues no new piece, its pieces verify as before; a
 * discontinued model (P-R06) is inactive for good, until an ADMIN reinstates it.
 */
const CATALOGUE: Record<string, Tone> = { ACTIVE: 'solid', INACTIVE: 'muted', DISCONTINUED: 'muted' };
/** A model's place in the lookbook (P-R02): shown to everyone, to the owners of a piece only, or nowhere. */
const LOOKBOOK: Record<string, Tone> = { PUBLIC: 'solid', RESERVED: 'outline', HIDDEN: 'muted' };
/**
 * A drop (P-R03): open to entries, or drawn, in force; a draft, announced or closed (its draw follows), pending;
 * cancelled, historical.
 */
const DROP: Record<string, Tone> = { DRAFT: 'outline', UPCOMING: 'outline', OPEN: 'solid', CLOSED: 'outline', DRAWN: 'solid', CANCELLED: 'muted' };
/**
 * An entry of a drop (P-R03): a place held waits for ORBES Client Services, as an open case does; a sale concluded is in
 * force; an entry or the waiting list pending; a lapse or a withdrawal, historical.
 */
const DROP_ENTRY: Record<string, Tone> = { ENTERED: 'outline', SELECTED: 'alert', WAITLISTED: 'outline', CONFIRMED: 'solid', LAPSED: 'muted', WITHDRAWN: 'muted' };
/**
 * A LIVE RELEASE: live, in force; a draft, scheduled, announced or its room open, pending; ended or cancelled, historical.
 */
const LIVE_PHASE: Record<string, Tone> = { DRAFT: 'outline', HIDDEN: 'outline', ANNOUNCED: 'outline', ROOM: 'solid', LIVE: 'solid', ENDED: 'muted', CANCELLED: 'muted' };
/**
 * An entry of a LIVE RELEASE: a hold waits for PAY, as an open case does; a turn and a confirmation in force; the room and
 * the line pending; out of it, historical (a removal, needing attention).
 */
const LIVE_ENTRY: Record<string, Tone> = {
  WAITING: 'outline',
  QUEUED: 'outline',
  TURN: 'solid',
  SECURED: 'alert',
  CONFIRMED: 'solid',
  MISSED: 'muted',
  EXPIRED: 'muted',
  RELEASED: 'muted',
  LEFT: 'muted',
  REMOVED: 'alert',
  ENDED: 'muted',
};
/**
 * An order (plan LIVE RELEASE+): reserved, it waits for its payment; paid, shipped and delivered, in force; cancelled or
 * returned, historical. A late one stands out as needing attention (the board's own mark).
 */
const ORDER: Record<string, Tone> = { RESERVED: 'outline', PAID: 'solid', SHIPPED: 'solid', DELIVERED: 'solid', CANCELLED: 'muted', RETURNED: 'muted' };
/** A piece to make: to make, pending; in progress, in force; done or cancelled, historical. */
const BENCH: Record<string, Tone> = { TO_MAKE: 'outline', IN_PROGRESS: 'solid', DONE: 'muted', CANCELLED: 'muted' };
/** A post of the circle (P-X01): in force once published; pending while it is not. */
const CIRCLE: Record<string, Tone> = { PUBLISHED: 'solid', UNPUBLISHED: 'outline' };
/** A request of the private salon (P-X08): an open one waits for ORBES Client Services, as an open case does. */
const SHOP_REQUEST: Record<string, Tone> = { OPEN: 'alert', CLOSED: 'muted' };
/** A conversation of the Messages board (CS-01): one to answer waits for ORBES Client Services, as an open case does. */
const CONVERSATION: Record<string, Tone> = { TO_ANSWER: 'alert', ANSWERED: 'solid', CLOSED: 'muted' };
/** A yearly care (BP-19 T6): to act on while ORBES holds the next step, solid once done. */
const CARE: Record<string, Tone> = { REQUESTED: 'alert', LABEL_SENT: 'outline', RECEIVED: 'alert', RETURNING: 'outline', DONE: 'solid', CANCELLED: 'muted' };
/**
 * THE HOUSE'S GUARANTEE (IN-01): waiting for a release or set aside, pending; entered, in force; used, historical in
 * force; expired, historical; revoked, needing attention as a revocation does.
 */
const GUARANTEE: Record<string, Tone> = { WAITING: 'outline', SET_ASIDE: 'outline', ENTERED: 'solid', USED: 'solid', EXPIRED: 'muted', REVOKED: 'alert' };
/** An answer to an invitation of the circle (P-X01): a place taken, or declined. */
const CIRCLE_ANSWER: Record<string, Tone> = { YES: 'solid', NO: 'muted' };
const VERIFICATION: Record<string, Tone> = {
  AUTHENTIC: 'solid',
  AUTHENTIC_FIRST_REGISTRATION: 'solid',
  AUTHENTIC_REGISTERED: 'solid',
  AUTHENTIC_OWNERSHIP_VERIFIED: 'solid',
  SUSPICIOUS_ACTIVITY: 'alert',
  REVOKED: 'alert',
  UNKNOWN: 'alert',
  INVALID_SIGNATURE: 'critical',
  MALFORMED_CODE: 'muted',
  PENDING: 'outline',
};

export type ToneDomain =
  | 'product'
  | 'code'
  | 'key'
  | 'severity'
  | 'anomaly'
  | 'warranty'
  | 'ownership'
  | 'service'
  | 'verification'
  | 'case'
  | 'account'
  | 'catalogue'
  | 'lookbook'
  | 'drop'
  | 'dropEntry'
  | 'circle'
  | 'circleAnswer'
  | 'shopRequest'
  | 'conversation'
  | 'care'
  | 'guarantee'
  | 'livePhase'
  | 'liveEntry'
  | 'order'
  | 'bench';

const TABLES: Record<ToneDomain, Record<string, Tone>> = {
  product: PRODUCT,
  code: CODE,
  key: KEY,
  severity: SEVERITY,
  anomaly: ANOMALY_STATUS,
  warranty: WARRANTY,
  ownership: OWNERSHIP,
  service: SERVICE,
  verification: VERIFICATION,
  case: CASE,
  account: ACCOUNT,
  catalogue: CATALOGUE,
  lookbook: LOOKBOOK,
  drop: DROP,
  dropEntry: DROP_ENTRY,
  circle: CIRCLE,
  circleAnswer: CIRCLE_ANSWER,
  shopRequest: SHOP_REQUEST,
  conversation: CONVERSATION,
  care: CARE,
  guarantee: GUARANTEE,
  livePhase: LIVE_PHASE,
  liveEntry: LIVE_ENTRY,
  order: ORDER,
  bench: BENCH,
};

export function toneOf(domain: ToneDomain, value: string | null | undefined): Tone {
  if (!value) return 'muted';
  return TABLES[domain][value] ?? 'outline';
}
