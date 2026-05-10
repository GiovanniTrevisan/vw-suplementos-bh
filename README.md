# VW Suplementos BH — E-commerce D2C com Catálogo Dinâmico e Checkout via WhatsApp

> **Projeto de validação real** desenvolvido para a [VW Suplementações BH](https://www.instagram.com/vwsuplementacoesbh/), loja física de suplementos localizada no bairro Castelo, Belo Horizonte/MG. O objetivo foi levar a loja para o digital com uma solução de baixo custo operacional, alta performance e fluxo de vendas integrado ao WhatsApp.

---

## Visão Geral

A VW Suplementos já tinha uma base de clientes consolidada e operação física rodando. O desafio era digitalizar o catálogo e criar um canal de vendas online sem depender de plataformas caras (Shopify, VTEX) ou de um backend complexo para gerenciar estoque. A solução precisava ser leve, fácil de manter pelo próprio lojista e centrada no WhatsApp — canal onde os clientes já compravam.

**Stack principal:** Astro 6 · TypeScript · Google Apps Script · GitHub Actions · Cloudflare Workers

**Site em produção:** [giovannitrevisan.github.io/vw-suplementos-bh](https://giovannitrevisan.github.io/vw-suplementos-bh/)

---

## Destaques Técnicos

- **Zero lock-in de plataforma** — backend em Google Apps Script + planilha, frontend estático buildado com Astro. Custo operacional de R$ 0/mês.
- **Cache em três camadas** com deduplicação de requisições e fallback a cache antigo em falha de rede ([api.ts](src/lib/api.ts)).
- **Estado global sem framework** — pub/sub manual sobre `localStorage`, sincronizado entre abas ([cart.ts](src/lib/cart.ts)).
- **Estado de filtros na URL** — categoria sobrevive a navegação e refresh, sem libs de routing ([catalogo.astro](src/pages/catalogo.astro)).
- **Deploy multi-target** — mesmo build roda em GitHub Pages e Cloudflare Workers via flag de ambiente ([astro.config.mjs](astro.config.mjs)).
- **Design system próprio** — tokens em CSS custom properties, tipografia fluida com `clamp()`, sem Tailwind ou CSS-in-JS ([global.css](src/styles/global.css)).
- **CI/CD automatizado** — push em `master` dispara build + deploy via GitHub Actions ([deploy.yml](.github/workflows/deploy.yml)).

---

## Páginas

| Página | Descrição |
|---|---|
| **Home** ([/](src/pages/index.astro)) | Hero, categorias, mais vendidos, diferenciais, reviews, localização e CTA |
| **Catálogo** ([/catalogo](src/pages/catalogo.astro)) | Listagem com busca, filtros (categoria, faixa de preço), ordenação e paginação "carregar mais" |
| **Produto** ([/produto](src/pages/produto.astro)) | PDP com galeria, ficha técnica, qty controls, add-to-cart e CTA direto para WhatsApp |
| **Checkout** ([/checkout](src/pages/checkout.astro)) | Resumo do pedido, dados do cliente, opção de entrega e envio formatado via WhatsApp |
| **Confirmação** ([/confirmacao](src/pages/confirmacao.astro)) | Tela de pós-envio com instruções de próximos passos |

---

## Contexto de Negócio

| Aspecto | Detalhe |
|---|---|
| **Cliente** | VW Suplementações BH |
| **Modelo** | D2C — Loja física com canal digital |
| **Canal de venda** | WhatsApp Business |
| **Público-alvo** | Atletas e praticantes de musculação em BH |
| **Diferenciais** | Produto original c/ NF · Entrega no mesmo dia · Atendimento técnico |

O checkout não é automático por design: o cliente monta o carrinho no site, envia um pedido pré-formatado via WhatsApp e o atendente confirma estoque, frete e pagamento em tempo real. Isso reduz fricção e aproveita a força do WhatsApp na jornada de compra local.

---

## Desafios e Soluções

### 1. Catálogo dinâmico sem backend dedicado

**Desafio:** O lojista precisava atualizar preços e produtos com frequência, sem depender de um developer para cada mudança. Um CMS pago ou banco de dados eram inviáveis para o porte do negócio.

**Solução:** O catálogo é mantido em uma planilha Google Sheets. Um Google Apps Script expõe os dados como uma API REST pública, retornando JSON com produtos, categorias e metadados. O site consome esse endpoint em [src/lib/api.ts](src/lib/api.ts) com um sistema de cache em camadas e fallback a cache antigo em caso de falha de rede.

```
Google Sheets → Apps Script (GAS) → fetch no cliente → cache multi-tier
```

```typescript
// src/lib/api.ts
let memoryCache: { ts: number; data: CatalogResponse } | null = null;
let inflight: Promise<CatalogResponse> | null = null;

export async function fetchCatalog(force = false): Promise<CatalogResponse> {
  if (!force) {
    // 1. Memória (mais rápido — vive enquanto a página estiver aberta)
    if (memoryCache && Date.now() - memoryCache.ts < CATALOG_CACHE_TTL_MS) {
      return memoryCache.data;
    }
    // 2. sessionStorage (sobrevive a reloads e navegação entre páginas da loja)
    const cached = readSessionCache();
    if (cached) {
      memoryCache = { ts: Date.now(), data: cached };
      return cached;
    }
  }
  // 3. Deduplicação: se já existe um fetch em voo, reaproveita
  if (inflight) return inflight;

  inflight = fetch(GAS_URL)
    .then(/* parse + valida + grava cache */)
    .catch(() => readSessionCache() ?? errorPayload) // fallback para cache antigo
    .finally(() => { inflight = null; });

  return inflight;
}
```

**Impacto:** O lojista atualiza a planilha e o site reflete em até 5 minutos, sem deploy.

---

### 2. Carrinho sem framework reativo

**Desafio:** Astro é um framework de componentes estáticos — não há estado global reativo como no React/Vue. O carrinho precisava ser compartilhado entre componentes isolados (header, página de produto, checkout) e persistir entre navegações.

**Solução:** Módulo singleton em [src/lib/cart.ts](src/lib/cart.ts) que persiste em `localStorage` com um padrão pub/sub manual. Qualquer componente pode se inscrever via `cart.subscribe()`, e o listener nativo do evento `storage` sincroniza o carrinho entre abas abertas.

```typescript
// src/lib/cart.ts
type Listener = (items: CartItem[]) => void;
const listeners = new Set<Listener>();

export const cart = {
  add(product: Product, qty = 1): void {
    const items = read();
    const existing = items.find((i) => i.id === product.id);
    if (existing) existing.qty += qty;
    else items.push({ /* snapshot do produto + qty */ });
    write(items); // persiste no localStorage e notifica subscribers
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(read());                                 // dispara estado inicial
    return () => listeners.delete(fn);          // unsubscribe
  },
};

// Sincroniza entre abas (escutado uma única vez no módulo)
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEYS.cart) listeners.forEach((fn) => fn(read()));
});
```

**Impacto:** Badge do carrinho no header e botão "Adicionar" na página de produto ficam sincronizados sem nenhuma lib de estado.

---

### 3. Filtros avançados com estado na URL

**Desafio:** O catálogo tem filtros de categoria, faixa de preço, ordenação e busca em tempo real. O estado dos filtros precisava ser preservado ao navegar de volta de uma página de produto, sem usar React Query ou Zustand.

**Solução:** O estado da categoria é serializado nos query params da URL ([src/pages/catalogo.astro](src/pages/catalogo.astro)). Ao carregar a página, o filtro inicial é lido de `?categoria=Nome`. Ao alterar a categoria, a URL é atualizada via `history.replaceState()` sem recarregar a página, mantendo o histórico de navegação limpo.

```typescript
// src/pages/catalogo.astro — script inline
const urlParams = new URLSearchParams(location.search);
const initialCat = urlParams.get('categoria') || '';

function selectCategory(name: string) {
  activeCategory = name;
  const url = new URL(location.href);
  if (name) url.searchParams.set('categoria', name);
  else      url.searchParams.delete('categoria');
  history.replaceState(null, '', url);   // atualiza URL sem recarregar
  renderCategoryPills();
  resetPaging();
  render();                               // aplica busca + categoria + preço + sort
}
```

**Impacto:** Links de categoria na homepage (ex: `/catalogo?categoria=Creatina`) abrem o catálogo já filtrado, preservando contexto de navegação.

---

### 4. Checkout formatado para WhatsApp

**Desafio:** Transformar um carrinho de e-commerce em uma mensagem de WhatsApp legível, que facilitasse o trabalho do atendente sem parecer um dump de dados técnicos.

**Solução:** Dois níveis de abstração — um helper genérico em `src/lib/format.ts` que só monta o link `wa.me` com a mensagem encodada, e um `buildMessage()` específico em `src/pages/checkout.astro` que monta o conteúdo da mensagem com formatação Markdown do WhatsApp (`*negrito*`, listas com `•`).

```typescript
// src/lib/format.ts — helper reutilizável
export function buildWhatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
```

```typescript
// src/pages/checkout.astro — builder específico do checkout
function buildMessage(items: CartItem[]): string {
  const nome    = (nomeInput?.value || '').trim();
  const entrega = entregaRadio?.value || 'A combinar';
  const total   = items.reduce((s, i) => s + i.preco * i.qty, 0);

  const lines = ['*Olá! Quero finalizar este pedido pelo site:*', '', '*ITENS*'];
  items.forEach((i) => {
    lines.push(`• Categoria: ${i.categoria}`);
    lines.push(`  Produto: ${i.nome}`);
    lines.push(`  Qtd: ${i.qty} × ${formatBRL(i.preco)} = ${formatBRL(i.preco * i.qty)}`);
    lines.push('');
  });
  lines.push(`*TOTAL ESTIMADO:* ${formatBRL(total)}`);
  lines.push(`*ENTREGA:* ${entrega}`);
  if (nome) lines.push('', `*NOME:* ${nome}`);
  return lines.join('\n');
}

sendBtn.addEventListener('click', () => {
  const url = buildWhatsAppLink(WHATSAPP_NUMBER, buildMessage(cart.get()));
  window.open(url, '_blank');
});
```

**Impacto:** O atendente recebe uma mensagem estruturada e pronta para confirmar. Zero fricção de interpretação. O helper genérico é reusável em CTAs do header, do hero e do footer.

---

### 5. Deploy condicional para GitHub Pages

**Desafio:** GitHub Pages exige um `base` path (`/vw-suplementos-bh/`) para todos os assets e links internos. Rodar localmente com esse base quebra tudo. Era preciso que o mesmo código funcionasse nos dois ambientes sem condicionais espalhados pelo projeto.

**Solução:** A variável de ambiente `DEPLOY_TARGET` define o alvo do build. O [astro.config.mjs](astro.config.mjs) lê essa variável e aplica `site` e `base` condicionalmente. Os componentes usam `import.meta.env.BASE_URL` (injetado pelo Astro) em vez de strings hardcoded — o mesmo código serve para `localhost:4321/`, `vw-suplementos-bh/` no GitHub Pages e o root no Cloudflare Workers.

```javascript
// astro.config.mjs
const isGithubPages = process.env.DEPLOY_TARGET === 'github-pages';

export default defineConfig({
  site: isGithubPages ? 'https://giovannitrevisan.github.io' : undefined,
  base: isGithubPages ? '/vw-suplementos-bh/' : undefined,
});
```

```yaml
# .github/workflows/deploy.yml
- name: Build
  env:
    DEPLOY_TARGET: github-pages
    PUBLIC_GAS_URL: ${{ vars.PUBLIC_GAS_URL }}
    PUBLIC_WHATSAPP_NUMBER: ${{ vars.PUBLIC_WHATSAPP_NUMBER }}
  run: npm run build
```

**Impacto:** `npm run dev` funciona localmente sem nenhuma config extra. O CI cuida do resto.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                        Cliente                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐             │
│  │ Homepage │  │ Catálogo  │  │ Checkout │  ...        │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘             │
│       │               │              │                   │
│  ┌────▼───────────────▼──────────────▼────────────────┐ │
│  │           lib/ (módulos TypeScript)                 │ │
│  │  api.ts · cart.ts · format.ts · config.ts           │ │
│  └────────────────────────┬────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
   ┌──────▼──────┐  ┌───────▼──────┐  ┌──────▼──────┐
   │ Google Apps │  │  localStorage│  │  WhatsApp   │
   │   Script    │  │   (carrinho) │  │    API      │
   │  (catálogo) │  └──────────────┘  └─────────────┘
   └─────────────┘
```

---

## Estrutura do Projeto

```
src/
├── components/
│   ├── Header.astro          # Navbar sticky, carrinho dinâmico, menu mobile
│   ├── Hero.astro            # Banner com CTA dupla
│   ├── TrustBar.astro        # Barra de confiança abaixo do hero
│   ├── Categorias.astro      # Grid de categorias (dados do GAS)
│   ├── MaisVendidos.astro    # Best sellers com add-to-cart
│   ├── SobreDiferenciais.astro # Diferenciais da loja
│   ├── Reviews.astro         # Social proof
│   ├── Localizacao.astro     # Endereço e mapa
│   ├── CtaFinal.astro        # Call-to-action final
│   └── Footer.astro
├── pages/
│   ├── index.astro           # Homepage
│   ├── catalogo.astro        # Listagem com filtros avançados
│   ├── produto.astro         # PDP com galeria e ficha técnica
│   ├── checkout.astro        # Carrinho + envio via WhatsApp
│   ├── confirmacao.astro
│   └── 404.astro
├── lib/
│   ├── api.ts                # Fetch + cache multi-tier do catálogo
│   ├── cart.ts               # Carrinho com pub/sub e persistência
│   ├── format.ts             # formatBRL, slugify, buildWhatsAppLink
│   └── config.ts             # Variáveis de ambiente centralizadas
├── layouts/
│   └── Layout.astro          # Layout base com meta tags e scroll reveal
└── styles/
    └── global.css            # Design system (tokens, animações, utilitários)
```

---

## Design System

O projeto tem um design system próprio centralizado em [src/styles/global.css](src/styles/global.css), sem dependências de CSS-in-JS ou Tailwind. Tudo via custom properties + classes utilitárias.

**Paleta** — light theme em off-white quente, com preto profundo para texto e laranja vibrante para CTAs.

| Token | Valor | Uso |
|---|---|---|
| `--c-paper` | `#F5F0E8` | Fundo principal (off-white quente) |
| `--c-ink` | `#0A0A09` | Texto principal (preto profundo) |
| `--c-mid` | `#2A2A28` | Texto secundário e seções dark |
| `--c-master` | `#EE4444` | CTAs e destaques (laranja-vermelho) |
| `--c-line` / `--c-line-hard` | `#0A0A091F` / `#0A0A0959` | Separadores leves e médios |

**Tipografia**
- `Barlow Condensed` — Headlines e títulos de seção (700/800, com itálico)
- `DM Sans` — Body text e UI (400/500/700)
- `JetBrains Mono` — Preços, contagens e metadados

**Layout fluido**
- `--max-w: 1440px` — conteúdo centralizado em ultrawide
- `--gutter: clamp(20px, 5vw, 80px)` — gutter responsivo sem media queries
- `--section-y: clamp(60px, 9vw, 110px)` — espaçamento vertical de seções

**Animações**
- `data-reveal` e `data-reveal-stagger` — scroll reveal via `IntersectionObserver`
- Respeita `prefers-reduced-motion`
- Easing custom: `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` para saídas snappy
- Tokens de timing: `--t-fast: 180ms`, `--t-med: 320ms`, `--t-slow: 600ms`

---

## Como Rodar Localmente

```bash
# Clone o repositório
git clone https://github.com/giovannitrevisan/vw-suplementos-bh.git
cd vw-suplementos-bh

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com a URL do Apps Script e o número do WhatsApp

# Inicie o servidor de desenvolvimento
npm run dev
```

**Variáveis necessárias (`.env`):**
```env
PUBLIC_GAS_URL=https://script.google.com/macros/s/{ID}/exec
PUBLIC_WHATSAPP_NUMBER=5531XXXXXXXXX
```

---

## Deploy

O projeto tem dois alvos de deploy configurados:

**GitHub Pages (primário)** — Feito automaticamente via GitHub Actions ao fazer push em `master`.

**Cloudflare Workers (alternativo)**
```bash
npm run build
npx wrangler deploy
```

---

## O que aprendi com esse projeto

- **Astro é ideal para conteúdo semi-estático:** páginas geradas no build com dados dinâmicos carregados no cliente via fetch — o melhor dos dois mundos para um catálogo de loja.
- **Google Sheets como backend é subestimado:** para catálogos pequenos, é uma solução pragmática que o próprio cliente consegue operar sem nenhum conhecimento técnico.
- **Estado sem framework é viável:** pub/sub manual com `localStorage` foi suficiente para o carrinho, sem adicionar React ou Solid ao bundle.
- **Checkout via WhatsApp reduz abandono:** remover campos de endereço, cartão e dados de pagamento do fluxo online diminui a fricção para o público local e aproveita um canal que os clientes já dominam.

---

## Tecnologias

![Astro](https://img.shields.io/badge/Astro-6.3-BC52EE?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?logo=github-actions&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare_Workers-deploy-F38020?logo=cloudflare&logoColor=white)
![Google Apps Script](https://img.shields.io/badge/Google_Apps_Script-backend-34A853?logo=google&logoColor=white)

---

## Autor

**Giovanni B. Trevisan**
Desenvolvedor Full Stack · [github.com/giovannitrevisan](https://github.com/giovannitrevisan)
