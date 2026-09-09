import esbuild from 'esbuild'

const options = {
  entryPoints: ['ui/index.html', 'ui/page.ts', 'ui/styles.css'],
  bundle: true,
  format: 'esm',
  loader: { '.html': 'copy' },
  outdir: 'dist/ui',
  logLevel: 'info',
}

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('[ui] watching HTML, TypeScript and CSS files')
} else {
  await esbuild.build(options)
}
