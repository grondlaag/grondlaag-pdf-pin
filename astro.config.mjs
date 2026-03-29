// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

const isBuild = process.argv.includes('build');

export default defineConfig({
	site: 'https://grondlaag.github.io',
	base: isBuild ? '/grondlaag-pdf-pin' : '/',
	integrations: [react()],
	vite: {
		resolve: {
			dedupe: ['react', 'react-dom'],
		},
		optimizeDeps: {
			include: [
				'react',
				'react/jsx-runtime',
				'react/jsx-dev-runtime',
				'react-dom',
				'react-dom/client',
			],
			needsInterop: ['react', 'react-dom', 'react-dom/client'],
		},
	},
});
