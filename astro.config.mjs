// @ts-check
import { defineConfig } from 'astro/config';

const isGithubPages = process.env.DEPLOY_TARGET === 'github-pages';

// https://astro.build/config
export default defineConfig({
  site: isGithubPages ? 'https://giovannitrevisan.github.io' : undefined,
  base: isGithubPages ? '/vw-suplementos-bh/' : undefined,
});
