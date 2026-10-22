export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageError";
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new PackageError("A media file inside this package is damaged (it is not valid base64).");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type TypedArrayCtor = { new (buffer: ArrayBuffer): ArrayBufferView; BYTES_PER_ELEMENT: number };
export const TYPED_ARRAYS: Record<string, TypedArrayCtor> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

export function viewBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

