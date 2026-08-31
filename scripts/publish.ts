import { $ } from 'bun'

// Publish in dependency order (sdk before the framework packages). `bun publish`
// replaces `workspace:*` with the real version in the published tarball.
//
// Keep this in step with `scripts/build.ts`. They drifted once: `stacks` was
// added to the build order and not to this one, so @bughq/stacks was built on
// every release and published on none — its README told people to install a
// package that 404'd.
const order = ['sdk', 'vue', 'nuxt', 'stx', 'stacks']

for (const name of order) {
  console.info(`\n▸ publishing @bughq/${name}`)
  await $`bun publish --access public`.cwd(`packages/${name}`)
}

console.info('\n✓ published all packages')
