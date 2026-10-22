/**
 * WORN at the foot of a model's sheet (lot M2, macro scope D31 G3 to G5; plan §2.3, step M2.11): the photographs the
 * owners of the model's pieces sent and ORBES published, the same for everyone (signed out, signed in, any tier; a
 * RESERVED sheet to those who reach it), after PAIRS WELL WITH. Not drawn at all while the sheet has no photograph.
 *
 *   WORN                                       its heading on the margin, and its sentence
 *   Worn by the owners of ORBES pieces.
 *   ┌────────┐ ┌────────┐                      a phone: two columns, each photograph cropped 4:5, its credit under it
 *   │        │ │        │                      in the label face: exactly the first name and the country, and the
 *   └────────┘ └────────┘                      Instagram name when its owner chose it (a link opened apart); never a
 *   CAMILLE · FRANCE   LÉA · ITALY             variant: the photographs of every variant of the model alike
 *   @camille.m
 *   …                                          the first 6 (8 on a computer, four columns), then SHOW MORE: 12 more,
 *          SHOW MORE                           the next page read when needed (ONE MOMENT…; unreadable: its sentence
 *                                              and TRY AGAIN)
 *
 * A photograph opens whole: on a phone a full-screen modal, the photograph and its credit, closed by CLOSE, Escape or
 * the back gesture (its own history entry, `pushEntry`); on a computer the sheet's viewer (views/desktop-model.ts), its
 * credit under it, PREVIOUS and NEXT, ←, →. In the grid the arrow keys move between the photographs. CSP-safe: h()
 * only; places by class (verify/styles.css, shared/desktop.css, shared/desktop-pointer.css).
 */
import { isDesktop, onDesktopChange } from "../../shared/desktop.js";
import { h } from "../../shared/dom.js";
import { ApiError, type ApiClient } from "../api.js";
import { WORN } from "../copy.js";
import {
  sheetWornItems,
  withPage,
  wornPageToRead,
  wornTarget,
  type SheetWornItem,
  type SheetWornModel,
} from "../worn-model.js";
import { openPhotoViewer } from "./desktop-model.js";
import { messageOf } from "./forms.js";
import { icon, textLink } from "./nocturne.js";

export interface WornSheetDeps {
  api: Pick<ApiClient, "sheetWorn">;
  /** The sheet the next pages are read from: the dot shown, through the club when it is RESERVED. */
  source(): { slug: string; club: boolean };
  /** A change of the grid made silently in the sheet's live region (its own line says what changed). */
  quietly(change: () => void): void;
  /** A phone's photograph opened whole: its own history entry, so the back gesture closes it. */
  pushEntry?(): void;
}

/** The next page: none asked, being read, or unreadable (with the reason). */
type More =
  { kind: "idle" } | { kind: "loading" } | { kind: "failed"; message: string };

/** The marker of a phone's opened photograph in its history entry. */
const ENTRY_MARK = "wornPhoto";

export class WornSheet {
  readonly root: HTMLElement;
  private readonly grid = h("ul", {
    class: "n-model__worn-grid",
    attrs: { role: "list" },
  });
  private readonly foot = h("div", { class: "n-px n-model__worn-foot" });
  private items: SheetWornItem[];
  private total: number;
  /** Pages read (the sheet brought the first), and SHOW MORE pressed. */
  private pages = 1;
  private more = 0;
  private state: More = { kind: "idle" };
  private disposed = false;
  private readonly offDesktop: () => void;
  private phone: PhoneViewer | null = null;

  constructor(
    first: SheetWornModel,
    private readonly deps: WornSheetDeps,
  ) {
    this.items = first.items;
    this.total = first.total;
    this.root = h(
      "section",
      {
        class: "n-sec n-model__worn",
        attrs: { "aria-labelledby": "sheet-worn" },
      },
      h(
        "div",
        { class: "n-px" },
        h("h2", {
          class: "n-g n-t3 n-model__heading",
          id: "sheet-worn",
          text: WORN.sheet.title,
        }),
        h("p", { class: "n-sm n-model__worn-lead", text: WORN.sheet.lead }),
      ),
      this.grid,
      this.foot,
    );
    this.grid.addEventListener("keydown", (ev) => this.onGridKey(ev));
    // Across the breakpoint, the first ones are a phone's or a computer's.
    this.offDesktop = onDesktopChange(() => this.draw());
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    this.offDesktop();
    this.phone?.close({ back: false, focus: false });
  }

  /** How many are shown now. */
  private shownCount(): number {
    return Math.min(
      this.items.length,
      wornTarget(this.total, isDesktop(), this.more),
    );
  }

  private draw(): void {
    const shown = this.items.slice(0, this.shownCount());
    const had = this.grid.contains(document.activeElement)
      ? [...this.grid.querySelectorAll(".n-model__worn-open")].indexOf(
          document.activeElement as Element,
        )
      : -1;
    this.grid.classList.toggle("n-model__worn-grid--one", shown.length === 1);
    this.grid.replaceChildren(...shown.map((item, i) => this.tile(item, i)));
    if (had >= 0)
      this.grid
        .querySelectorAll<HTMLElement>(".n-model__worn-open")
        [had]?.focus({ preventScroll: true });
    this.drawFoot();
  }

  /** A photograph, its button over it (it opens whole), its credit under it. */
  private tile(item: SheetWornItem, i: number): HTMLElement {
    const img = h("img", {
      class: "n-model__worn-img",
      attrs: {
        src: item.src,
        alt: item.alt,
        decoding: "async",
        loading: "lazy",
      },
    });
    const frame = h("div", { class: "n-model__worn-frame" }, img);
    // A photograph that cannot be read leaves its plate, its credit kept: nothing broken is drawn.
    img.addEventListener("error", () => img.remove(), { once: true });
    const open = h(
      "button",
      {
        class: "n-model__worn-open",
        attrs: {
          type: "button",
          "aria-label": item.open,
          "aria-haspopup": "dialog",
        },
        data: { at: i },
        on: { click: () => this.open(i) },
      },
      frame,
    );
    return h(
      "li",
      { class: "n-model__worn-item" },
      open,
      creditView(item, "n-model__worn-"),
    );
  }

  /** SHOW MORE, ONE MOMENT… while the next page is read, or its sentence and TRY AGAIN. */
  private drawFoot(): void {
    const st = this.state;
    const canMore = this.shownCount() < this.total;
    if (st.kind === "loading") {
      this.foot.replaceChildren(
        h("p", {
          class: "n-g n-lb n-model__worn-loading",
          attrs: { role: "status" },
          text: WORN.sheet.loading,
        }),
      );
    } else if (st.kind === "failed") {
      this.foot.replaceChildren(
        h(
          "div",
          { class: "n-model__worn-failed", attrs: { role: "alert" } },
          h("p", {
            class: "n-sm n-model__worn-failed-text",
            text: WORN.sheet.failed,
          }),
          st.message
            ? h("p", {
                class: "n-sm n-model__worn-failed-reason",
                text: st.message,
              })
            : null,
          textLink(WORN.sheet.retry, {
            onOpen: () => void this.showMore(),
            extraClass: "n-model__worn-retry",
          }),
        ),
      );
    } else if (canMore) {
      this.foot.replaceChildren(
        textLink(WORN.sheet.more, {
          onOpen: () => void this.showMore(),
          extraClass: "n-model__worn-more",
        }),
      );
    } else {
      this.foot.replaceChildren();
    }
    this.foot.hidden = this.foot.childElementCount === 0;
  }

  /**
   * SHOW MORE (or TRY AGAIN): 12 more, the next page read first when they are not read yet; the focus then on the first
   * photograph added (or kept on its line while it reads, and on TRY AGAIN if it fails).
   */
  private async showMore(): Promise<void> {
    if (this.state.kind === "loading") return;
    const before = this.shownCount();
    const more = this.more + 1;
    const target = wornTarget(this.total, isDesktop(), more);
    const page = wornPageToRead(
      this.items.length,
      this.pages,
      target,
      this.total,
    );
    if (page !== null) {
      this.state = { kind: "loading" };
      this.deps.quietly(() => this.drawFoot());
      const waiting = this.foot.querySelector<HTMLElement>(
        ".n-model__worn-loading",
      );
      if (waiting) {
        waiting.tabIndex = -1;
        waiting.focus({ preventScroll: true });
      }
      try {
        const src = this.deps.source();
        const r = await this.deps.api.sheetWorn(src.slug, page, {
          club: src.club,
        });
        if (this.disposed) return;
        const next = sheetWornItems(r.photos);
        this.items = withPage(this.items, next);
        this.pages = page;
        // A page with nothing new: every photograph is read (some left WORN since the sheet was read).
        this.total =
          next.length === 0
            ? this.items.length
            : Math.max(r.total, this.items.length);
      } catch (e) {
        if (this.disposed) return;
        this.state = {
          kind: "failed",
          message: e instanceof ApiError ? messageOf(e) : "",
        };
        this.deps.quietly(() => this.drawFoot());
        this.foot
          .querySelector<HTMLElement>(".n-model__worn-retry")
          ?.focus({ preventScroll: true });
        return;
      }
    }
    this.more = more;
    this.state = { kind: "idle" };
    this.deps.quietly(() => this.draw());
    const added = this.grid.querySelectorAll<HTMLElement>(
      ".n-model__worn-open",
    )[before];
    if (added) added.focus({ preventScroll: false });
    else
      this.foot
        .querySelector<HTMLElement>(".n-model__worn-more")
        ?.focus({ preventScroll: true });
  }

  /** The arrow keys move between the photographs: ← → one, ↑ ↓ a row (two columns on a phone, four on a computer). */
  private onGridKey(ev: KeyboardEvent): void {
    const buttons = [
      ...this.grid.querySelectorAll<HTMLElement>(".n-model__worn-open"),
    ];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const row = isDesktop() ? 4 : 2;
    const by =
      ev.key === "ArrowRight"
        ? 1
        : ev.key === "ArrowLeft"
          ? -1
          : ev.key === "ArrowDown"
            ? row
            : ev.key === "ArrowUp"
              ? -row
              : ev.key === "Home"
                ? -i
                : ev.key === "End"
                  ? buttons.length - 1 - i
                  : 0;
    if (by === 0) return;
    const to = buttons[Math.min(buttons.length - 1, Math.max(0, i + by))];
    if (!to || to === buttons[i]) return;
    ev.preventDefault();
    to.focus();
  }

  /** A photograph opened whole: the sheet's viewer on a computer, a full-screen modal on a phone. */
  private open(at: number): void {
    const shown = this.items.slice(0, this.shownCount());
    const item = shown[at];
    if (!item) return;
    const opener = (k: number): HTMLElement | null =>
      this.grid.querySelectorAll<HTMLElement>(".n-model__worn-open")[k] ?? null;
    if (isDesktop()) {
      openPhotoViewer({
        photos: shown.map((p) => ({
          src: p.src,
          alt: p.alt,
          caption: () => creditView(p, "d-viewer__"),
        })),
        at,
        label: WORN.sheet.title,
        opener,
        extraClass: "d-viewer--worn",
      });
      return;
    }
    this.phone?.close({ back: false, focus: false });
    this.phone = new PhoneViewer(
      item,
      () => opener(at),
      this.deps.pushEntry,
      () => {
        this.phone = null;
      },
    );
  }
}

/** A credit: exactly the first name and the country in the label face, then the Instagram name, a link opened apart. */
function creditView(item: SheetWornItem, prefix: string): HTMLElement {
  const c = item.credit;
  return h(
    "p",
    { class: `${prefix}credit` },
    h("span", { class: `n-g n-lb n-ivc ${prefix}name`, text: c.line }),
    c.handle && c.href
      ? h(
          "a",
          {
            class: `n-sm ${prefix}handle`,
            attrs: {
              href: c.href,
              target: "_blank",
              rel: "noopener noreferrer",
              "aria-label": item.instagramLabel ?? c.handle,
            },
          },
          ...breakable(c.handle),
        )
      : null,
  );
}

/** An Instagram name that may break after its dots and underscores (a long one in a phone's narrow column), never inside a word. */
function breakable(name: string): (string | HTMLElement)[] {
  return name
    .split(/(?<=[._])/)
    .flatMap((part, i) => (i === 0 ? [part] : [h("wbr"), part]));
}

/**
 * A phone's photograph opened whole: the whole screen on the mode's ground, CLOSE at the top right, the photograph whole
 * and its credit under it. A modal (the page under it inert, the focus on CLOSE and back on the photograph after);
 * closed by CLOSE, Escape, or the back gesture, through its own history entry.
 */
class PhoneViewer {
  private readonly el: HTMLElement;
  private readonly inerted: HTMLElement[] = [];
  private readonly onPop = (): void => {
    if (
      (history.state as Record<string, unknown> | null)?.[ENTRY_MARK] !== true
    )
      this.close({ back: false, focus: true });
  };
  private pushed = false;
  private closed = false;

  constructor(
    item: SheetWornItem,
    private readonly opener: () => HTMLElement | null,
    pushEntry: (() => void) | undefined,
    private readonly onClosed: () => void,
  ) {
    const close = h(
      "button",
      {
        class: "n-account__close n-wv__close",
        attrs: { type: "button", "aria-label": WORN.sheet.close },
        on: { click: () => this.close({ back: true, focus: true }) },
      },
      icon("close"),
    );
    this.el = h(
      "div",
      {
        class: "n-wv",
        attrs: {
          role: "dialog",
          "aria-modal": "true",
          "aria-label": WORN.sheet.title,
        },
      },
      h("div", { class: "n-wv__head" }, close),
      h(
        "figure",
        { class: "n-wv__figure" },
        h("img", {
          class: "n-wv__photo",
          attrs: { src: item.src, alt: item.alt, decoding: "async" },
        }),
        creditView(item, "n-wv__"),
      ),
    );
    this.el.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.close({ back: true, focus: true });
      } else if (ev.key === "Tab") {
        const list = [
          ...this.el.querySelectorAll<HTMLElement>("button, a[href]"),
        ];
        const i = list.indexOf(document.activeElement as HTMLElement);
        const to = ev.shiftKey
          ? i <= 0
            ? list.length - 1
            : i - 1
          : i === list.length - 1
            ? 0
            : i + 1;
        ev.preventDefault();
        list[to]?.focus();
      }
    });
    for (const child of [...document.body.children]) {
      if (child instanceof HTMLElement && !child.inert) {
        child.inert = true;
        this.inerted.push(child);
      }
    }
    document.body.append(this.el);
    document.documentElement.classList.add("n-locked");
    if (pushEntry) {
      pushEntry();
      this.pushed = true;
      window.addEventListener("popstate", this.onPop);
    }
    close.focus({ preventScroll: true });
  }

  /** Closed: by CLOSE or Escape (`back`: its history entry taken back), by the back gesture, or as the sheet goes. */
  close(o: { back: boolean; focus: boolean }): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("popstate", this.onPop);
    this.el.remove();
    for (const el of this.inerted) el.inert = false;
    document.documentElement.classList.remove("n-locked");
    if (
      o.back &&
      this.pushed &&
      (history.state as Record<string, unknown> | null)?.[ENTRY_MARK] === true
    )
      history.back();
    this.onClosed();
    const to = o.focus ? this.opener() : null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  }
}

/** The state a phone's opened photograph adds to its sheet's history entry (main.ts pushes it). */
export const WORN_ENTRY_MARK = ENTRY_MARK;
