import type { BlobStore } from "../../platform/blobs/store";
import type { HousePalette } from "./palette.ts";
import type { MomentSubject } from "./style.ts";
import type { BusinessSummary } from "./subject.ts";

/** A house style that was made: what the page shows, and everything it was made from. */
export interface HouseStyleMade {
  signature: string;
  madeAt: string;
  styleVersion: string;
  model: string;
  modelName: string;
  seed: number;
  business: BusinessSummary;
  subject: MomentSubject & { model: string; ms: number };
  palette: HousePalette;
  prompt: string;
  /** `key` is the cut-out the page shows; `sourceKey` the model's own picture, kept for the operator. */
  picture: { key: string; sourceKey: string; width: number; height: number; cordX: number | null; bytes: number; cutEdge: number; source: { width: number; height: number; box: { x: number; y: number; width: number; height: number }; edgeWhite: number } };
  /** What the check model says the picture shows, for the operator. */
  seen: string;
  /** Pictures drawn for this make: one, or two when the first failed its checks. */
  pictures: number;
  timings: { readMs: number; subjectMs: number; imageMs: number; cutMs: number; checkMs: number; totalMs: number };
  priceUsd: number;
}

/** The house style's latest attempt, and the house style the page shows. `made` is the last one made, kept while a
 *  newer one is being made or could not be made. Without one, the page shows the chosen template and says why. */
export interface HouseStyleRecord {
  /** making: a make holds the record. ready: the latest make succeeded. failed: it could not make a picture that
   *  passed its checks. refused: the install's AI budget had no picture left for it. */
  state: "making" | "ready" | "failed" | "refused";
  /** The brand the latest attempt was made for. */
  signature: string;
  /** The image seed of the latest picture: 1 for a new brand, one more for each further picture of the same brand. */
  seed: number;
  at: string;
  /** One sentence a person can read: why the latest attempt failed or was refused. */
  reason: string | null;
  /** The make that holds the record while it is making: `started` once a runner is drawing it. Another runner may
   *  take it over once `until` has passed, or when its queued job hasn't started in time. */
  lease: { id: string; until: string; started: boolean } | null;
  made: HouseStyleMade | null;
  /** When each picture of the last day was reserved: the install's durable picture budget. */
  pictures: string[];
}

const RECORD_KEY = "house-style/current.json";

export interface StoredHouseStyle {
  record: HouseStyleRecord;
  eTag: string;
}

export interface HouseStyleRepository {
  get(): Promise<StoredHouseStyle | null>;
  /** Writes the record only if it is still the version read (`eTag`, null when there was none); false when another
   *  writer got there first. */
  put(record: HouseStyleRecord, eTag: string | null): Promise<boolean>;
  putPicture(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  picture(key: string): Promise<ArrayBuffer | null>;
}

/** Kept in the install's own object storage (R2) beside the logo; made once per brand, never per visit. */
export function createHouseStyleRepository(blobs: BlobStore): HouseStyleRepository {
  return {
    async get() {
      const object = await blobs.getText(RECORD_KEY);
      return object ? { record: JSON.parse(object.text) as HouseStyleRecord, eTag: object.eTag } : null;
    },
    put(record, eTag) {
      return blobs.putTextConditionally(RECORD_KEY, JSON.stringify(record), "application/json; charset=utf-8", { eTag });
    },
    async putPicture(key, bytes, contentType) {
      await blobs.putBytes(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType);
    },
    async picture(key) {
      return (await blobs.getBytes(key))?.bytes ?? null;
    },
  };
}
