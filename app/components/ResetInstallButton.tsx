"use client";

import { useState } from "react";

/**
 * Zera a instalação do ambiente ativo (`POST /api/setup/reset`) para reinstalar
 * do zero. Confirma no clique porque descarta as credenciais do merchant —
 * depois disso, só reinstalando.
 */
export default function ResetInstallButton({ environment }: { environment: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function reset() {
    const confirmed = window.confirm(
      `Zerar a instalação de ${environment}?\n\nIsso apaga o external_id e as credenciais do merchant deste ambiente. Você vai precisar rodar a instalação de novo.`
    );
    if (!confirmed) return;

    setState("working");
    setMessage(null);
    try {
      const res = await fetch("/api/setup/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState("done");
      setMessage(data.message);
      // Recarrega para refletir o status novo (a página é Server Component).
      window.location.reload();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Erro ao zerar a instalação.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={reset}
        disabled={state === "working"}
        className="inline-flex w-fit items-center rounded-full border border-am-danger-text/40 px-4 py-2 text-sm font-medium text-am-danger-text hover:bg-am-danger-bg disabled:opacity-40"
      >
        {state === "working" ? "Zerando…" : "Zerar instalação deste ambiente"}
      </button>
      {message && (
        <p
          className={`text-xs ${
            state === "error" ? "text-am-danger-text" : "text-am-ink-muted"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
