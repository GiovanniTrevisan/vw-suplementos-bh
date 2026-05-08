// Carrinho persistido em localStorage com pub/sub simples.
// Sobrevive a reloads e é compartilhado entre abas (via evento 'storage').

import { STORAGE_KEYS } from './config';
import type { Product } from './api';

export interface CartItem {
  id: string;
  nome: string;
  preco: number;
  imagem: string;
  categoria: string;
  qty: number;
}

type Listener = (items: CartItem[]) => void;
const listeners = new Set<Listener>();

function read(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cart);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i) => i && typeof i.id === 'string' && i.qty > 0);
  } catch {
    return [];
  }
}

function write(items: CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(items));
  } catch {
    /* quota — silently */
  }
  emit(items);
}

function emit(items: CartItem[]): void {
  listeners.forEach((fn) => {
    try {
      fn(items);
    } catch {
      /* ignore listener errors */
    }
  });
}

export const cart = {
  get(): CartItem[] {
    return read();
  },

  count(): number {
    return read().reduce((s, i) => s + i.qty, 0);
  },

  subtotal(): number {
    return read().reduce((s, i) => s + i.preco * i.qty, 0);
  },

  add(product: Product, qty = 1): void {
    if (!product || !product.id) return;
    const items = read();
    const existing = items.find((i) => i.id === product.id);
    if (existing) {
      existing.qty += qty;
    } else {
      items.push({
        id: product.id,
        nome: product.nome,
        preco: product.preco,
        imagem: product.imagem,
        categoria: product.categoria,
        qty: Math.max(1, qty),
      });
    }
    write(items);
  },

  setQty(id: string, qty: number): void {
    const items = read();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (qty <= 0) {
      write(items.filter((i) => i.id !== id));
    } else {
      item.qty = qty;
      write(items);
    }
  },

  inc(id: string): void {
    const item = read().find((i) => i.id === id);
    if (item) this.setQty(id, item.qty + 1);
  },

  dec(id: string): void {
    const item = read().find((i) => i.id === id);
    if (item) this.setQty(id, item.qty - 1);
  },

  remove(id: string): void {
    write(read().filter((i) => i.id !== id));
  },

  clear(): void {
    write([]);
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(read());
    return () => listeners.delete(fn);
  },
};

// Sincroniza entre abas
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.cart) emit(read());
  });
}
