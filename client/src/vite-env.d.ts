/// <reference types="vite/client" />

declare module "virtual:pwa-register" {
  export type RegisterSWOptions = {
    immediate?: boolean;
  };

  export function registerSW(options?: RegisterSWOptions): (
    reloadPage?: boolean
  ) => Promise<void>;
}
