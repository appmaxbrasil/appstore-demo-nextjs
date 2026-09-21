"use client";

import { useCallback, useEffect, useState } from "react";

type Environment = "sandbox" | "production";

type CredentialRow = {
  environment: Environment;
  appUuid: string | null;
  appNumericalId: string | null;
  appClientId: string | null;
  appClientSecret: string | null; // já vem mascarado do backend
  externalKey: string | null;
  externalId: string | null;
  applePayDomain: string | null;
  merchantClientId: string | null;
  merchantClientSecret: string | null; // já vem mascarado do backend
  updatedAt: string | null;
};

const emptyRow = (environment: Environment): CredentialRow => ({
  environment,
  appUuid: null,
  appNumericalId: null,
  appClientId: null,
  appClientSecret: null,
  externalKey: null,
  externalId: null,
  applePayDomain: null,
  merchantClientId: null,
  merchantClientSecret: null,
  updatedAt: null,
});

const FIELDS: {
  key: keyof CredentialRow;
  label: string;
  secret?: boolean;
  hint?: string;
}[] = [
  { key: "appUuid", label: "APPMAX_APP_UUID" },
  { key: "appNumericalId", label: "APPMAX_APP_NUMERICAL_ID" },
  { key: "appClientId", label: "APPMAX_APP_CLIENT_ID" },
  { key: "appClientSecret", label: "APPMAX_APP_CLIENT_SECRET", secret: true },
  {
    key: "externalKey",
    label: "APPMAX_EXTERNAL_KEY",
    hint: "identifica esta instalação (equivalente a um store_id)",
  },
  {
    key: "externalId",
    label: "external_id",
    hint: "gerado no health check e lido SÓ daqui (sem fallback de env var) — o front bloqueia o checkout se estiver vazio",
  },
  {
    key: "applePayDomain",
    label: "domínio do Apple Pay",
    hint: "enviado como domain_name em /app/authorize, na instalação. Só o domínio, sem https:// nem caminho. Salvar vazio volta a detectar pelo host da requisição",
  },
  { key: "merchantClientId", label: "APPMAX_MERCHANT_CLIENT_ID" },
  { key: "merchantClientSecret", label: "APPMAX_MERCHANT_CLIENT_SECRET", secret: true },
];

/**
 * Edita as credenciais da Appmax sem mexer em `.env` nem fazer redeploy —
 * salva no SQLite local, que tem prioridade sobre as env vars.
 *
 * ⚠️ Os segredos ficam em texto plano no `.db`, e esta tela não tem
 * autenticação. Ver o aviso no README antes de expor isto publicamente.
 */
export default function ConfiguracaoPage() {
  const [rows, setRows] = useState<Record<Environment, CredentialRow>>({
    sandbox: emptyRow("sandbox"),
    production: emptyRow("production"),
  });
  // Ambiente que esta tela está EDITANDO (a aba) — diferente do ambiente ATIVO
  // do app (`activeEnvironment`), que é o que o checkout realmente usa.
  const [selectedEnv, setSelectedEnvState] = useState<Environment>("sandbox");
  const [activeEnvironment, setActiveEnvironment] = useState<Environment | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Trocar de aba descarta o rascunho, senão um valor digitado no sandbox
  // apareceria por cima dos campos de produção.
  const setSelectedEnv = useCallback((next: Environment) => {
    setSelectedEnvState(next);
    setDraft({});
  }, []);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    const [credsRes, envRes] = await Promise.all([
      fetch("/api/configuracao"),
      fetch("/api/environment"),
    ]);
    const creds = await credsRes.json();
    const env = await envRes.json();
    const next = { sandbox: emptyRow("sandbox"), production: emptyRow("production") };
    for (const row of creds.environments as CredentialRow[]) {
      next[row.environment] = row;
    }
    setRows(next);
    setActiveEnvironment(env.environment);
  }, []);

  useEffect(() => {
    // O setState roda no .catch, depois do fetch — a regra não distingue.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setMessage("Não foi possível carregar as credenciais salvas."));
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/configuracao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: selectedEnv, ...draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar.");
      setDraft({});
      setMessage("Salvo! Os novos valores já valem pra próxima requisição.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function activateSelectedEnv() {
    setSwitching(true);
    setMessage(null);
    try {
      const res = await fetch("/api/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: selectedEnv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao trocar de ambiente.");
      // Reload completo, não só o state local: o seletor "Ambiente" no
      // Header é um componente separado que só busca o valor atual ao
      // montar — sem isso ele ficaria mostrando o ambiente antigo até a
      // próxima navegação (mesmo comportamento do EnvironmentSwitcher).
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao trocar de ambiente.");
      setSwitching(false);
    }
  }

  const row = rows[selectedEnv];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Configuração</h1>
        <p className="text-sm text-am-ink-muted">
          Credenciais da Appmax por ambiente, salvas em{" "}
          <code>.appmax/appmax.db</code> (SQLite local) e usadas com prioridade
          sobre as env vars — troque de app/merchant sem redeploy. Veja{" "}
          <a href="/setup" className="underline">
            /setup
          </a>{" "}
          para o passo a passo de instalação.
        </p>
      </header>

      <section className="rounded-lg border border-am-warn-text/30 bg-am-warn-bg p-4 text-sm text-am-warn-text">
        ⚠️ Segredos ficam em texto plano no arquivo SQLite local. Não exponha
        essa tela nem esse arquivo publicamente fora de um ambiente de teste.
      </section>

      <div className="flex gap-2">
        {(["sandbox", "production"] as const).map((env) => (
          <button
            key={env}
            type="button"
            onClick={() => {
              setSelectedEnv(env);
              setDraft({});
            }}
            className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium ${
              selectedEnv === env
                ? env === "production"
                  ? "border-am-danger-text bg-am-danger-bg text-am-danger-text"
                  : "border-am-purple bg-am-purple-soft text-am-purple-hover"
                : "border-am-border text-am-ink-muted"
            }`}
          >
            {env === "sandbox" ? "Sandbox" : "Produção"}
            {activeEnvironment === env && " · ativo"}
          </button>
        ))}
      </div>

      {activeEnvironment !== null && activeEnvironment !== selectedEnv && (
        <div className="flex items-center justify-between rounded-lg border border-am-border bg-am-purple-soft-2 p-3 text-sm text-am-ink">
          <span>
            Você está editando <strong>{selectedEnv}</strong>, mas o app está
            rodando em <strong>{activeEnvironment}</strong> agora.
          </span>
          <button
            type="button"
            onClick={activateSelectedEnv}
            disabled={switching}
            className="whitespace-nowrap rounded-full bg-am-purple px-4 py-1.5 text-xs font-medium text-white hover:bg-am-purple-hover disabled:opacity-40"
          >
            {switching ? "Trocando…" : `Usar ${selectedEnv} agora`}
          </button>
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="flex flex-col gap-3 rounded-lg border border-am-border bg-am-card p-5"
      >
        {row.updatedAt && (
          <p className="text-xs text-am-ink-muted">
            Última atualização: {new Date(row.updatedAt).toLocaleString("pt-BR")}
          </p>
        )}
        {FIELDS.map(({ key, label, secret, hint }) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span className="text-am-ink-muted">
              {label}
              {hint && <span className="text-am-ink-muted/70"> — {hint}</span>}
            </span>
            <input
              type={secret ? "password" : "text"}
              // Campo normal vem PREENCHIDO com o que está salvo; só segredo
              // fica vazio com o valor mascarado no placeholder.
              //
              // Antes todo campo renderizava vazio e o valor salvo aparecia
              // só como placeholder cinza. Isso fazia a tela inteira parecer
              // "não salvou nada" mesmo com o banco cheio — e como o POST
              // ignora string vazia de propósito (pra não apagar segredo que
              // chega mascarado), clicar em Salvar de fato não mudava nada,
              // reforçando a impressão. O dado sempre esteve lá; quem mentia
              // era a tela.
              placeholder={
                secret
                  ? ((row[key] as string | null) ?? "não definido")
                  : "não definido"
              }
              value={draft[key] ?? (secret ? "" : ((row[key] as string | null) ?? ""))}
              onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
              className="rounded border border-am-border bg-white px-3 py-2 font-mono text-xs text-am-ink"
            />
            {secret && row[key] && (
              <span className="text-[11px] text-am-ink-muted/70">
                já salvo — deixe em branco para manter
              </span>
            )}
          </label>
        ))}

        <button
          type="submit"
          disabled={saving}
          className="mt-2 rounded-full bg-am-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-am-purple-hover disabled:opacity-40"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        {message && <p className="text-sm">{message}</p>}
      </form>
    </div>
  );
}
