"use client";

import { useEffect, useState } from "react";

type Environment = "sandbox" | "production";

/**
 * Seletor de ambiente ativo. A troca vale para o app inteiro (instalação,
 * checkout, /configuracao), sem redeploy — ver `lib/db/settings.ts`.
 *
 * O valor vem de `GET /api/environment` e não de uma prop de Server Component
 * porque `/` e `/configuracao` são pré-renderizadas: um valor lido no servidor
 * ficaria congelado no ambiente do build.
 *
 * Produção em vermelho de propósito: é onde clicar errado custa dinheiro.
 */
export default function EnvironmentSwitcher() {
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/environment")
      .then((res) => res.json())
      .then((data) => setEnvironment(data.environment))
      .catch(() => {});
  }, []);

  async function switchTo(next: Environment) {
    if (next === environment || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error ?? "Falha ao trocar de ambiente.");
        return;
      }
      setEnvironment(next);
      // Reload completo, não `router.refresh()`: o appmax.min.js já carregado
      // é o bundle do ambiente antigo, e o SDK não suporta troca em runtime.
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b9b6d6]">
        Ambiente
      </span>
      <div className="flex overflow-hidden rounded-full border border-white/20">
        <button
          type="button"
          disabled={loading || environment === null}
          onClick={() => switchTo("sandbox")}
          className={`px-3 py-1 text-xs font-bold tracking-wide disabled:opacity-60 ${
            environment === "sandbox"
              ? "bg-[#8a5a00] text-white"
              : "bg-transparent text-[#b9b6d6] hover:text-white"
          }`}
        >
          SANDBOX
        </button>
        <button
          type="button"
          disabled={loading || environment === null}
          onClick={() => switchTo("production")}
          className={`px-3 py-1 text-xs font-bold tracking-wide disabled:opacity-60 ${
            environment === "production"
              ? "bg-[#8c1420] text-white"
              : "bg-transparent text-[#b9b6d6] hover:text-white"
          }`}
        >
          PRODUÇÃO
        </button>
      </div>
    </div>
  );
}
