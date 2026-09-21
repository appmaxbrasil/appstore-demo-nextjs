"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "appmax_external_id_override";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getServerSnapshot() {
  return "";
}

/**
 * Valor salvo no localStorage deste navegador. Sai de `useSyncExternalStore`
 * (e não de um efeito) porque o localStorage não existe no servidor: assim o
 * SSR renderiza `""` e o client corrige na hidratação, sem warning.
 */
export function useExternalIdOverride(): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function apply(next: string) {
    const trimmed = next.trim();
    try {
      if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Navegador com storage bloqueado: o override simplesmente não persiste.
    }
    listeners.forEach((listener) => listener());
  }

  return [value, apply];
}

type Props = {
  /** O que está salvo no banco, só para mostrar como placeholder. */
  externalIdFromDb: string | null;
  value: string;
  onApply: (value: string) => void;
};

/**
 * Ferramenta de desenvolvimento: sobrepõe o `external_id` do banco sem mexer em
 * `/configuracao`, para testar outro valor rápido.
 *
 * O valor só é aplicado no clique em "Aplicar", nunca a cada tecla: trocar o
 * `external_id` depois do `init()` obriga a recarregar a página (o SDK não
 * suporta troca em runtime), então digitar recarregaria no primeiro caractere.
 */
export default function ExternalIdOverride({ externalIdFromDb, value, onApply }: Props) {
  const [draft, setDraft] = useState(value);

  return (
    <details className="rounded-lg border border-am-border bg-am-card p-4 text-sm">
      <summary className="cursor-pointer select-none text-am-ink-muted">
        Configuração avançada
      </summary>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-am-ink-muted">
          external_id (sobrepõe o salvo em /configuracao neste navegador)
        </span>
        <div className="flex gap-2">
          <input
            placeholder={externalIdFromDb ?? "não configurado no banco"}
            className="flex-1 rounded border border-am-border bg-white px-3 py-2 font-mono text-xs text-am-ink"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onApply(draft);
              }
            }}
          />
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-full border border-am-border px-4 py-2 text-xs font-medium text-am-ink hover:bg-am-purple-hover/10"
          >
            Aplicar
          </button>
        </div>
      </label>
    </details>
  );
}
