import { defineConfig } from 'vitest/config'

export default defineConfig({
  // electron-vite builds `./x?modulePath` as its own entry and gives its path. Tests only need
  // the path, never the module: running a process entry here would fail.
  plugins: [
    {
      name: 'module-path',
      load: (id) => (id.endsWith('?modulePath') ? `export default ${JSON.stringify(id)}` : null)
    }
  ],
  test: { include: ['src/**/*.test.ts', 'raycast/src/**/*.test.ts'] }
})
