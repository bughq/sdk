// Ambient shims for Nuxt/Nitro virtual modules (`#app`, `#imports`) so the
// runtime plugins typecheck standalone under `tsc --noEmit` in this repo. At
// build time Nuxt/Nitro resolve the real modules; these declarations only exist
// to satisfy the type checker outside of a Nuxt app's generated types.
declare module '#app' {
  export function defineNuxtPlugin<T = unknown>(plugin: T): T
  export function useRuntimeConfig(): { public: Record<string, unknown> } & Record<string, unknown>
}

declare module '#imports' {
  export function defineNitroPlugin<T = unknown>(plugin: T): T
  export function useRuntimeConfig(): { public: Record<string, unknown> } & Record<string, unknown>
}
