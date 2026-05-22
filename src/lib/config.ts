// Centraliza variáveis de ambiente expostas ao cliente.
// Astro injeta tudo com prefixo PUBLIC_ no bundle do navegador via import.meta.env.
// Mantenha sem segredos — qualquer valor aqui é visível no browser.

const env = (import.meta as any).env || {};

export const GAS_URL: string = (env.PUBLIC_GAS_URL || '').trim();

export const WHATSAPP_NUMBER: string =
  (env.PUBLIC_WHATSAPP_NUMBER || '5531989795391').replace(/\D/g, '');

export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min no navegador

export const STORAGE_KEYS = {
  cart: 'vw_cart_v1',
  catalogCache: 'vw_catalog_cache_v2',
} as const;

export function isConfigured(): boolean {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(GAS_URL);
}
