import { createUlid, nowIso } from "../../shared/ids";
import type { SiteRead, SiteReadResult } from "../../platform/site-reader/index.ts";
import { brandSignature, businessSummary, type BrandInputs } from "./brief.ts";
import { namePicture, sameObject } from "./check.ts";
import { IMAGE_MODEL, IMAGE_MODEL_NAME, imageFrom, imageInputs, imagePrice, type AiRunner } from "./image-models.ts";
import { housePalette } from "./palette.ts";
import { cutOut } from "./picture.ts";
import { houseReference } from "./reference.ts";
import type { HouseStyleMade, HouseStyleRecord, HouseStyleRepository, StoredHouseStyle } from "./repository.ts";
import { HOUSE_STYLE_VERSION, momentPrompt } from "./style.ts";
import { chooseSubject } from "./subject.ts";

const SIZE = 1024;
const LEASE_MS = 5 * 60_000;
/** A claim's queued job starts within seconds. One that hasn't by then is made by the minute Cron, or by request-time
 *  due work while Cron is quiet, as a lost job would be. */
const START_WITHIN_MS = 30_000;
const DAY_MS = 24 * 60 * 60_000;
/** Pictures a day: a brand change, one retry and one "Make again", with one to spare (L18 build spec, section 6). */
export const PICTURES_PER_DAY = 4;
/** A make draws one more picture, with the next seed, only when the first fails its checks. */
const PICTURES_PER_MAKE = 2;

export interface HouseStyleView {
  /** Whether this install has a Workers AI binding to make house styles with. */
  connected: boolean;
  record: HouseStyleRecord | null;
  /** Pictures the install's budget still allows in the last day. */
  picturesLeft: number;
}

export interface HouseStyleForPage {
  connected: boolean;
  record: HouseStyleRecord | null;
  picture: ArrayBuffer | null;
}

export interface HouseStyleService {
  view(): Promise<HouseStyleView>;
  /** The cut-out the page shows; null before one is made. */
  picture(): Promise<ArrayBuffer | null>;
  /** What each snapshot publishes: the stored record and its cut-out, read from R2 and never made per visit. */
  forPage(): Promise<HouseStyleForPage>;
  /** After a save or Setup: queues one make when House style is chosen and the brand differs from the one made. */
  queueIfChanged(): Promise<void>;
  /** Settings' "Make again": queues a make with the next seed, whatever is stored. */
  queueAgain(): Promise<HouseStyleView>;
  /** The queued job: makes the house style its claim names. */
  runQueued(leaseId: string): Promise<void>;
  /** The minute cron: takes over a make whose job was lost, and makes one for a brand that changed without one. */
  ensureCurrent(): Promise<void>;
}

export interface HouseStyleDependencies {
  /** The install's Workers AI binding, held to the house style's models; null when the install has none. */
  ai: AiRunner | null;
  repository: HouseStyleRepository;
  /** True once Setup is stored and House style is the chosen template. */
  wanted(): Promise<boolean>;
  inputs(): Promise<BrandInputs | null>;
  /** The site reader, or null where this install cannot read websites. */
  readSite: ((url: string) => Promise<SiteReadResult>) | null;
  componentNames(): Promise<string[]>;
  /** Publishes the page again; every state change is shown on it. */
  rebuild(): Promise<void>;
  enqueue(leaseId: string): Promise<void>;
}

export class HouseStyleUnavailableError extends Error {}
class HouseStyleStepError extends Error {}
/** A picture that failed one of its checks: drawn again once with the next seed. */
class PictureCheckError extends HouseStyleStepError {}

/** Says which step failed in words an operator can act on; the cause's own message follows. */
async function step<T>(name: string, run: () => Promise<T>, failure: typeof HouseStyleStepError = HouseStyleStepError): Promise<T> {
  try { return await run(); }
  catch (cause) {
    if (cause instanceof HouseStyleStepError) throw cause;
    throw new failure(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

const recentPictures = (pictures: string[] | undefined, now = Date.now()) => (pictures ?? []).filter((at) => now - Date.parse(at) < DAY_MS);
const leaseHeld = (record: HouseStyleRecord | null | undefined) => record?.state === "making" && record.lease !== null && Date.parse(record.lease.until) > Date.now();
const unstarted = (record: HouseStyleRecord | null | undefined) => record?.state === "making" && record.lease !== null && !record.lease.started && Date.now() - Date.parse(record.at) > START_WITHIN_MS;

export function createHouseStyleService(deps: HouseStyleDependencies): HouseStyleService {
  const { repository } = deps;

  async function signatureNow() {
    const inputs = await deps.inputs();
    return inputs ? { inputs, signature: brandSignature(inputs, IMAGE_MODEL) } : null;
  }

  /** Takes the record for one make, unless another make holds it. Returns the make's lease id. */
  async function claim(signature: string, again: boolean, takeOver = false): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stored = await repository.get();
      const previous = stored?.record ?? null;
      if (leaseHeld(previous) && !(takeOver && unstarted(previous))) return null;
      // A new brand starts at seed 1; making again for the same brand draws the next picture.
      const continuing = previous?.signature === signature && (again || takeOver);
      const id = createUlid();
      const claimed: HouseStyleRecord = {
        state: "making", signature, seed: continuing ? previous.seed + (takeOver && previous.state === "making" ? 0 : 1) : 1, at: nowIso(), reason: null,
        lease: { id, until: new Date(Date.now() + LEASE_MS).toISOString(), started: false },
        made: previous?.made ?? null, pictures: recentPictures(previous?.pictures),
      };
      if (await repository.put(claimed, stored?.eTag ?? null)) return id;
    }
    throw new Error("The house style changed too often to start a make.");
  }

  async function held(leaseId: string): Promise<StoredHouseStyle | null> {
    const stored = await repository.get();
    return stored?.record.lease?.id === leaseId ? stored : null;
  }

  /** Marks a claim as being drawn by this runner; null when another runner took it or already started it. */
  async function start(leaseId: string): Promise<HouseStyleRecord | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stored = await held(leaseId);
      if (!stored || stored.record.lease?.started) return null;
      const record: HouseStyleRecord = { ...stored.record, lease: { id: leaseId, until: new Date(Date.now() + LEASE_MS).toISOString(), started: true } };
      if (await repository.put(record, stored.eTag)) return record;
    }
    throw new Error("The house style changed too often to start a make.");
  }

  /** Reserves one picture in the install's budget, durably, before it is drawn. False when the day has none left. */
  async function reserve(leaseId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stored = await held(leaseId);
      if (!stored) throw new HouseStyleStepError("Drawing the picture: another make took over.");
      const recent = recentPictures(stored.record.pictures);
      if (recent.length >= PICTURES_PER_DAY) return false;
      if (await repository.put({ ...stored.record, pictures: [...recent, nowIso()] }, stored.eTag)) return true;
    }
    throw new Error("The house style changed too often to reserve a picture.");
  }

  /** Writes the make's outcome if it still holds the record, keeping the budget's reservations. */
  async function settle(leaseId: string, outcome: Omit<HouseStyleRecord, "lease" | "pictures">) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stored = await held(leaseId);
      if (!stored) return false;
      if (await repository.put({ ...outcome, lease: null, pictures: stored.record.pictures }, stored.eTag)) return true;
    }
    throw new Error("The house style changed too often to record a make.");
  }

  async function make(ai: AiRunner, leaseId: string, claimed: HouseStyleRecord): Promise<Omit<HouseStyleRecord, "lease" | "pictures">> {
    const kept = claimed.made;
    const now = await signatureNow();
    if (!now) return { state: "failed", signature: claimed.signature, seed: claimed.seed, at: nowIso(), reason: "Making the house style: page settings are not configured.", made: kept };
    const { inputs, signature } = now;
    const firstSeed = signature === claimed.signature ? claimed.seed : 1;
    const started = Date.now();
    let lastFailure: string | null = null;
    try {
      let site: SiteRead | null = null;
      if (inputs.website && deps.readSite) {
        // A site that can't be read now leaves the page's own words; it never fails the make.
        const read = await deps.readSite(inputs.website).catch(() => null);
        if (read?.ok) site = read.site;
      }
      const readMs = Date.now() - started;
      const business = businessSummary(inputs, site, await deps.componentNames());
      const palette = housePalette(inputs.accentColor.toLowerCase(), site?.colours ?? []);
      const subject = await step("Choosing the picture's object", () => chooseSubject(ai, business));
      const prompt = momentPrompt(subject, palette);
      const reference = houseReference();
      for (let drawn = 0; drawn < PICTURES_PER_MAKE; drawn += 1) {
        const seed = firstSeed + drawn;
        if (!(await reserve(leaseId))) {
          const budget = `Today's AI budget for house styles (${PICTURES_PER_DAY} pictures a day) is used up.`;
          return drawn === 0
            ? { state: "refused", signature, seed: firstSeed - 1, at: nowIso(), reason: `${budget} Lamp makes it once the day has a picture left.`, made: kept }
            : { state: "failed", signature, seed: seed - 1, at: nowIso(), reason: `${lastFailure} ${budget}`, made: kept };
        }
        const request = { prompt, width: SIZE, height: SIZE, seed, reference };
        const imageStarted = Date.now();
        const image = await step("Drawing the picture", async () => imageFrom(await ai.run(IMAGE_MODEL, imageInputs(request))));
        const imageMs = Date.now() - imageStarted;
        try {
          if (image.contentType !== "image/jpeg") throw new PictureCheckError(`Checking the picture: the model returned ${image.contentType}; Lamp reads JPEG pictures.`);
          const cutStarted = Date.now();
          const picture = await step("Checking the picture", async () => cutOut(image.bytes, subject.placement), PictureCheckError);
          const cutMs = Date.now() - cutStarted;
          const check = await step("Checking the picture", () => namePicture(ai, image.bytes));
          const verdict = await step("Checking the picture", () => sameObject(ai, subject.object, check.seen));
          if (!verdict.same) throw new PictureCheckError(`Checking the picture: it shows ${check.seen}, not ${subject.object}.`);
          const id = createUlid();
          const key = `house-style/pictures/${id}.jpg`, sourceKey = `house-style/pictures/${id}-source.jpg`;
          await step("Storing the picture", async () => { await repository.putPicture(sourceKey, image.bytes, image.contentType); await repository.putPicture(key, picture.bytes, picture.contentType); });
          const made: HouseStyleMade = {
            signature, madeAt: nowIso(), styleVersion: HOUSE_STYLE_VERSION, model: IMAGE_MODEL, modelName: IMAGE_MODEL_NAME, seed,
            business, subject, palette, prompt,
            picture: { key, sourceKey, width: picture.width, height: picture.height, cordX: picture.cordX, bytes: picture.bytes.byteLength, cutEdge: picture.cutEdge, source: picture.source },
            seen: check.seen,
            pictures: drawn + 1,
            timings: { readMs, subjectMs: subject.ms, imageMs, cutMs, checkMs: check.ms + verdict.ms, totalMs: Date.now() - started },
            priceUsd: Math.round(imagePrice(request) * (drawn + 1) * 100000) / 100000,
          };
          return { state: "ready", signature, seed, at: nowIso(), reason: null, made };
        } catch (cause) {
          if (!(cause instanceof PictureCheckError)) throw cause;
          lastFailure = cause.message;
        }
      }
      return { state: "failed", signature, seed: firstSeed + PICTURES_PER_MAKE - 1, at: nowIso(), reason: lastFailure, made: kept };
    } catch (cause) {
      const reason = cause instanceof HouseStyleStepError ? cause.message : `Making the house style: ${cause instanceof Error ? cause.message : String(cause)}`;
      return { state: "failed", signature, seed: firstSeed, at: nowIso(), reason, made: kept };
    }
  }

  async function run(leaseId: string) {
    const record = await start(leaseId);
    if (!record) return;
    // The page says its house style is being made while it has none to show.
    if (!record.made) await deps.rebuild();
    const outcome = deps.ai
      ? await make(deps.ai, leaseId, record)
      : { state: "failed" as const, signature: record.signature, seed: record.seed, at: nowIso(), reason: "This install isn't connected to Workers AI.", made: record.made };
    if (!(await settle(leaseId, outcome))) return;
    await deps.rebuild();
    // The brand may have changed while the picture was drawn; that change gets its own make.
    await queueIfChanged();
  }

  async function queueIfChanged() {
    if (!deps.ai || !(await deps.wanted())) return;
    const now = await signatureNow();
    if (!now) return;
    const record = (await repository.get())?.record ?? null;
    // An unchanged brand queues nothing, whatever its last attempt came to: Make again is the owner's retry.
    if (record?.signature === now.signature) return;
    const id = await claim(now.signature, false);
    if (id) await deps.enqueue(id);
  }

  async function view(): Promise<HouseStyleView> {
    const record = (await repository.get())?.record ?? null;
    return { connected: Boolean(deps.ai), record, picturesLeft: Math.max(0, PICTURES_PER_DAY - recentPictures(record?.pictures).length) };
  }

  return {
    view,
    async picture() {
      const made = (await repository.get())?.record.made;
      return made ? repository.picture(made.picture.key) : null;
    },
    async forPage() {
      const record = (await repository.get())?.record ?? null;
      const picture = record?.made ? await repository.picture(record.made.picture.key) : null;
      if (record?.made && !picture) throw new Error("The stored house style's picture is missing from object storage.");
      return { connected: Boolean(deps.ai), record, picture };
    },
    queueIfChanged,
    async queueAgain() {
      if (!deps.ai) throw new HouseStyleUnavailableError("Lamp makes house styles with Workers AI, which this install isn't connected to.");
      if (!(await deps.wanted())) throw new HouseStyleUnavailableError("Choose House style and save your settings first.");
      const now = await signatureNow();
      if (!now) throw new HouseStyleUnavailableError("Save your page settings first.");
      const id = await claim(now.signature, true);
      if (id) await deps.enqueue(id);
      return view();
    },
    runQueued: run,
    async ensureCurrent() {
      if (!deps.ai) return;
      const record = (await repository.get())?.record ?? null;
      if (record?.state === "making") {
        // A make whose job never started, or whose runner was lost once its lease ran out, is made here.
        if (leaseHeld(record) && !unstarted(record)) return;
        const id = await claim(record.signature, false, true);
        if (id) await run(id);
        return;
      }
      if (!(await deps.wanted())) return;
      const now = await signatureNow();
      if (!now) return;
      // A refused make is made once the day has a picture left; a failed one waits for the owner's Make again.
      const settled = record?.signature === now.signature && (record.state !== "refused" || recentPictures(record.pictures).length >= PICTURES_PER_DAY);
      if (settled) return;
      const id = await claim(now.signature, false, record?.signature === now.signature);
      if (id) await run(id);
    },
  };
}
