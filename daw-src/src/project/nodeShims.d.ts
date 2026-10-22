// The demo render test writes its WAV files with Node's fs. The app itself never runs in Node, so these are
// the only Node declarations the project needs, kept here instead of pulling @types/node into browser code.
declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: Uint8Array): void;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
