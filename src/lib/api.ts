// Camada de acesso ao catálogo. Faz fetch ao Apps Script com cache em memória + sessionStorage,
// fallback para a resposta anterior em caso de erro de rede.

import { GAS_URL, CATALOG_CACHE_TTL_MS, STORAGE_KEYS, isConfigured } from './config';

export interface Product {
  id: string;
  nome: string;
  preco: number;
  descricao: string;
  imagem: string;
  categoria: string;
  ativo: boolean;
  descricao_produto?: string;
  info_nutricional?: string;
  modo_uso?: string;
  sobre_marca?: string;
}

export interface CategoryInfo {
  name: string;
  count: number;
}

export interface CatalogResponse {
  ok: boolean;
  count: number;
  categories: CategoryInfo[];
  products: Product[];
  generatedAt: string;
  error?: string;
}

let memoryCache: { ts: number; data: CatalogResponse } | null = null;
let inflight: Promise<CatalogResponse> | null = null;

function readSessionCache(): CatalogResponse | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.catalogCache);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - parsed.ts > CATALOG_CACHE_TTL_MS) return null;
    return parsed.data as CatalogResponse;
  } catch {
    return null;
  }
}

function writeSessionCache(data: CatalogResponse): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEYS.catalogCache,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    /* quota exceeded — ok to ignore */
  }
}

export async function fetchCatalog(force = false): Promise<CatalogResponse> {
  if (!isConfigured()) {
    return {
      ok: false,
      count: 0,
      categories: [],
      products: [],
      generatedAt: new Date().toISOString(),
      error:
        'PUBLIC_GAS_URL não configurada. Defina a URL do Apps Script no .env do projeto.',
    };
  }

  if (!force) {
    if (memoryCache && Date.now() - memoryCache.ts < CATALOG_CACHE_TTL_MS) {
      return memoryCache.data;
    }
    const cached = readSessionCache();
    if (cached) {
      memoryCache = { ts: Date.now(), data: cached };
      return cached;
    }
  }

  if (inflight) return inflight;

  const url = force ? `${GAS_URL}?fresh=1&_=${Date.now()}` : GAS_URL;

  inflight = fetch(url, { method: 'GET', redirect: 'follow' })
    .then(async (r) => {
      const text = await r.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Resposta inválida da API (não é JSON).');
      }
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido na API.');
      const data = json as CatalogResponse;
      memoryCache = { ts: Date.now(), data };
      writeSessionCache(data);
      return data;
    })
    .catch((err): CatalogResponse => {
      // Fallback: devolve cache antigo se houver, senão erro estruturado.
      const cached = readSessionCache();
      if (cached) return cached;
      return {
        ok: false,
        count: 0,
        categories: [],
        products: [],
        generatedAt: new Date().toISOString(),
        error: String(err && err.message ? err.message : err),
      };
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export async function findProduct(id: string): Promise<Product | null> {
  const data = await fetchCatalog();
  if (!data.ok) return null;
  return data.products.find((p) => p.id === id) || null;
}

export function relatedProducts(
  all: Product[],
  current: Product,
  limit = 4
): Product[] {
  return all
    .filter((p) => p.id !== current.id && p.categoria === current.categoria)
    .slice(0, limit);
}
