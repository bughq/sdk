/* eslint-disable no-console -- build script logs progress to stdout */
import { $ } from 'bun'

// Build sdk first — vue/nuxt/stx generate their .d.ts against its built types.
const order = ['sdk', 'vue', 'nuxt', 'stx']

for (const name of order) {
  console.log(`\n▸ building @bughq/${name}`)
  await $`bun run build`.cwd(`packages/${name}`)
}

console.log('\n✓ all packages built')
