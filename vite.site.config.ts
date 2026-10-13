import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { docsSite } from './src/site/docs/build/plugin.ts';

// The run site's build (`rer build --site`, src/site/pages.tsx): the docs virtual modules, React and the Tailwind the
// app's root styles use. Never the app's vite.config.ts, whose Worker plugins do not run in Node.
export default defineConfig({ plugins: [docsSite(), react(), tailwindcss()] });
