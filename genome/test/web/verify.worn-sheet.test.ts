/**
 * WORN at the foot of a model's sheet in the collector app (lot MACRO M2, plan §2.3, step M2.11; macro scope D31 G3 to
 * G5), in vitest's node environment:
 *
 *  - the photographs as the sheet shows them: each credited with exactly the first name and the country (plus the
 *    Instagram name when its owner chose it, a link to its page), never a variant, a serial or anything else the answer
 *    carries, as the console writes a credit; one without its own address, a name or a country left out;
 *  - none at all while the sheet has none (the section is not drawn); a dot chosen keeps the group's WORN;
 *  - the first ones (6 on a phone, 8 on a computer), SHOW MORE 12 more, the next page read only when needed, and each
 *    photograph once when a page shifted;
 *  - the next pages' calls: the public sheet's for everyone, the club's for a RESERVED sheet, a wrong answer refused.
 */
import { describe, expect, it } from "vitest";
import { WORN_PAGE_SIZE as SERVER_PAGE_SIZE } from "../../src/server/services/worn.js";
import { creditLine as consoleCreditLine } from "../../src/web/admin/model/worn.js";
import { ApiClient } from "../../src/web/verify/api.js";
import { WORN } from "../../src/web/verify/copy.js";
import { selectDot, sheetModel } from "../../src/web/verify/lookbook-model.js";
import type {
  LookbookSheet,
  SheetWornPhoto,
} from "../../src/web/verify/types.js";
import {
  sheetWornItems,
  sheetWornModel,
  withPage,
  WORN_FIRST_DESK,
  WORN_FIRST_PHONE,
  WORN_MORE,
  WORN_PAGE_SIZE,
  wornPageToRead,
  wornTarget,
} from "../../src/web/verify/worn-model.js";

const id = (n: number) =>
  `6f1c7a54-3b1e-4c2a-9a55-${String(n).padStart(12, "0")}`;

function shot(
  n: number,
  credit: Partial<SheetWornPhoto["credit"]> = {},
): SheetWornPhoto {
  return {
    id: id(n),
    url: `/api/v1/worn/${id(n)}/photo`,
    width: 1600,
    height: 2000,
    credit: {
      firstName: "Camille",
      country: "France",
      instagram: null,
      ...credit,
    },
  };
}

describe("WORN on the sheet: the photographs and their credits (G3)", () => {
  it("credits exactly the first name and the country, plus the Instagram name when chosen, as the console does", () => {
    const [a, b] = sheetWornItems([
      shot(1, { instagram: "camille.m" }),
      shot(2, { firstName: "Léa", country: "Italy" }),
    ]);
    expect(a!.credit).toEqual({
      line: "CAMILLE · FRANCE",
      handle: "@camille.m",
      href: "https://www.instagram.com/camille.m/",
    });
    expect(a!.credit.line).toBe(
      consoleCreditLine({
        firstName: "Camille",
        country: "France",
        instagram: "camille.m",
      }).line,
    );
    expect(a!.instagramLabel).toBe(
      "@camille.m on Instagram (opens in a new tab)",
    );
    expect(a!.alt).toBe("Worn by Camille, France");
    expect(a!.open).toBe("Open the photograph worn by Camille, France");
    expect(b!.credit).toEqual({
      line: "LÉA · ITALY",
      handle: null,
      href: null,
    });
    expect(b!.instagramLabel).toBeNull();
  });

  it("never shows a variant, a serial or anything else an answer carries", () => {
    const extra = {
      ...shot(1),
      variant: "Gold",
      productId: "O26-J-00184",
      credit: {
        firstName: "Camille",
        country: "France",
        instagram: null,
        variant: "Gold",
      },
    } as unknown as SheetWornPhoto;
    const [item] = sheetWornItems([extra]);
    expect(Object.keys(item!).sort()).toEqual([
      "alt",
      "credit",
      "id",
      "instagramLabel",
      "open",
      "src",
    ]);
    expect(JSON.stringify(item)).not.toMatch(/Gold|O26-J/);
  });

  it("leaves out a photograph from elsewhere, or without a name or a country, and an Instagram name not of its shape", () => {
    const items = sheetWornItems([
      { ...shot(1), url: "https://elsewhere.example/a.jpg" },
      { ...shot(2), url: `/api/v1/worn/${id(2)}/photo?x=1` },
      shot(3, { firstName: "  " }),
      shot(4, { country: "" }),
      shot(5, { instagram: "javascript:alert(1)" }),
      null,
      "nothing",
    ]);
    expect(items.map((i) => i.id)).toEqual([id(5)]);
    expect(items[0]!.credit.handle).toBeNull();
    expect(sheetWornItems(undefined)).toEqual([]);
  });

  it("has no WORN while the sheet has no photograph, and counts at least those it read", () => {
    expect(sheetWornModel(undefined)).toEqual({ items: [], total: 0 });
    expect(sheetWornModel({ photos: [], total: 3 })).toEqual({
      items: [],
      total: 0,
    });
    expect(sheetWornModel({ photos: [shot(1), shot(2)], total: 1 }).total).toBe(
      2,
    );
    expect(sheetWornModel({ photos: [shot(1)], total: 40 }).total).toBe(40);
  });

  it("carries the sheet’s WORN whichever dot is chosen (the whole group’s, every variant alike)", () => {
    const sheet = {
      slug: "monolithe",
      lookbook: "PUBLIC",
      name: "MONOLITHE",
      type: "BRACELET",
      category: { code: "J", name: "Jewelry" },
      collection: "ORBITAL",
      coverUrl: null,
      gallery: [],
      story: null,
      specs: [],
      care: null,
      discontinuedYear: null,
      variant: { slug: "monolithe", label: "Steel", swatch: "#9D9B96" },
      variants: [
        {
          slug: "monolithe",
          label: "Steel",
          swatch: "#9D9B96",
          selected: true,
          name: "MONOLITHE",
          type: "BRACELET",
          coverUrl: null,
          gallery: [],
          story: null,
          specs: [],
          care: null,
          discontinuedYear: null,
        },
        {
          slug: "monolithe-gold",
          label: "Gold",
          swatch: "#B88A3A",
          selected: false,
          name: "MONOLITHE",
          type: "BRACELET",
          coverUrl: null,
          gallery: [],
          story: null,
          specs: [],
          care: null,
          discontinuedYear: null,
        },
      ],
      worn: { photos: [shot(1), shot(2)], total: 2 },
    } as unknown as LookbookSheet;
    const m = sheetModel(sheet);
    expect(m.worn.items.map((i) => i.id)).toEqual([id(1), id(2)]);
    expect(selectDot(m, "monolithe-gold").worn).toBe(m.worn);
    expect(sheetModel({ ...sheet, worn: undefined }).worn).toEqual({
      items: [],
      total: 0,
    });
  });
});

describe("WORN on the sheet: the first ones, SHOW MORE and the pages (G4)", () => {
  it("pages as the server does, and shows 6 on a phone, 8 on a computer, then 12 more each time", () => {
    expect(WORN_PAGE_SIZE).toBe(SERVER_PAGE_SIZE);
    expect([WORN_FIRST_PHONE, WORN_FIRST_DESK, WORN_MORE]).toEqual([6, 8, 12]);
    expect(wornTarget(40, false, 0)).toBe(6);
    expect(wornTarget(40, false, 1)).toBe(18);
    expect(wornTarget(40, true, 1)).toBe(20);
    expect(wornTarget(40, false, 3)).toBe(40);
    expect(wornTarget(8, false, 0)).toBe(6);
    expect(wornTarget(8, true, 0)).toBe(8);
    expect(wornTarget(1, false, 0)).toBe(1);
  });

  it("reads the next page only when the photographs to show are not read yet, never past the last", () => {
    // The sheet brought page 1 (12 of 40): SHOW MORE on a phone shows 18, page 2 is read.
    expect(wornPageToRead(12, 1, 6, 40)).toBeNull();
    expect(wornPageToRead(12, 1, 18, 40)).toBe(2);
    expect(wornPageToRead(24, 2, 30, 40)).toBe(3);
    expect(wornPageToRead(36, 3, 40, 40)).toBe(4);
    // Eight in all: the sheet has them all.
    expect(wornPageToRead(8, 1, 8, 8)).toBeNull();
    // A photograph left WORN since: every page read, nothing more asked.
    expect(wornPageToRead(23, 2, 24, 24)).toBeNull();
  });

  it("adds a page after the photographs read, each once (one published meanwhile shifts the pages)", () => {
    const first = sheetWornItems([shot(1), shot(2), shot(3)]);
    const next = sheetWornItems([shot(3), shot(4)]);
    expect(withPage(first, next).map((i) => i.id)).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
    ]);
  });

  it("says WORN, its sentence and its states in the house’s words", () => {
    expect(WORN.sheet.title).toBe("WORN");
    expect(WORN.sheet.lead).toBe("Worn by the owners of ORBES pieces.");
    expect([
      WORN.sheet.more,
      WORN.sheet.loading,
      WORN.sheet.retry,
      WORN.sheet.close,
    ]).toEqual(["SHOW MORE", "ONE MOMENT…", "TRY AGAIN", "CLOSE"]);
    expect(
      (Object.values(WORN.sheet) as unknown[])
        .filter((v): v is string => typeof v === "string")
        .join(" "),
    ).not.toMatch(/!|atelier|handmade|craft|product/i);
  });
});

describe("WORN on the sheet: its next pages (api.ts)", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  function fakeApi(responses: (() => Response)[]) {
    const calls: {
      url: string;
      method: string;
      cache: RequestCache | undefined;
    }[] = [];
    const api = new ApiClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          cache: init?.cache,
        });
        const r = responses.shift();
        if (!r) throw new Error(`unexpected request ${String(input)}`);
        return r();
      }) as typeof fetch,
    });
    return { api, calls };
  }

  it("reads a PUBLIC sheet’s page for everyone, a RESERVED one’s through the club, and refuses a wrong answer", async () => {
    const page = { photos: [shot(13)], total: 13, page: 2, pageSize: 12 };
    const { api, calls } = fakeApi([
      () => json(200, page),
      () => json(200, page),
      () => json(200, { photos: "no" }),
    ]);
    expect(await api.sheetWorn("monolithe", 2)).toEqual(page);
    expect(calls[0]).toMatchObject({
      url: "/api/v1/lookbook/monolithe/worn?page=2",
      method: "GET",
    });
    expect(await api.sheetWorn("zenith", 2, { club: true })).toEqual(page);
    expect(calls[1]).toMatchObject({
      url: "/api/v1/club/lookbook/zenith/worn?page=2",
      method: "GET",
    });
    await expect(api.sheetWorn("monolithe", 3)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});
