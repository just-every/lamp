/** Stable event seam for `snapshot.published.v1`. */
export interface SnapshotPublishedEvent {
  version: string;
  generatedAt: string;
}

export interface PublicSnapshotEvents {
  snapshotPublished(event: SnapshotPublishedEvent): Promise<void>;
}

export const defaultPublicSnapshotEvents: PublicSnapshotEvents = {
  async snapshotPublished() {},
};
