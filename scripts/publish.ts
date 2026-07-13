/* eslint-disable no-console -- publish script logs progress to stdout */
import { $ } from 'bun'

// Publish in dependency order (sdk before the framework packages). `bun publish`
// replaces `workspace:*` with the real version in the published tarball.
const order = ['sdk', 'vue', 'nuxt', 'stx']

for (const name of order) {
  console.log(`\n▸ publishing @bughq/${name}`)
  await $`bun publish --access public`.cwd(`packages/${name}`)
}

console.log('\n✓ published all packages')
