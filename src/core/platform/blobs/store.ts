export interface BlobObject {
  text: string;
  contentType: string | null;
  eTag: string;
}

export interface BlobBytes {
  bytes: ArrayBuffer;
  contentType: string | null;
}

export interface BlobStore {
  getText(key: string): Promise<BlobObject | null>;
  putText(key: string, text: string, contentType: string): Promise<void>;
  putTextConditionally(key: string, text: string, contentType: string, condition: { eTag: string | null }): Promise<boolean>;
  getBytes(key: string): Promise<BlobBytes | null>;
  putBytes(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
}
