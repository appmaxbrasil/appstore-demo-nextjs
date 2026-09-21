import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * SQLite local com as credenciais editadas em /configuracao, uma linha por
 * ambiente. Existe só para trocar de app/merchant sem editar `.env` nem
 * reiniciar o servidor.
 *
 * NÃO é padrão de produção: os segredos ficam em texto plano no `.db`, e o
 * arquivo não sobrevive a deploys serverless com filesystem somente-leitura —
 * ali use env vars.
 */

const DB_DIR = path.join(process.cwd(), ".appmax");
const DB_FILE = path.join(DB_DIR, "appmax.db");

let instance: Database.Database | null = null;
let triedAndFailed = false;

/**
 * Retorna `null` em vez de lançar quando o filesystem não permite abrir o
 * arquivo. Quem chama trata `null` como "sem banco, cai pra env var" — isso não
 * pode derrubar uma rota que precisa responder 200, como o health check.
 */
export function getDb(): Database.Database | null {
  if (instance) return instance;
  if (triedAndFailed) return null;

  try {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
    instance = new Database(DB_FILE);
    instance.pragma("journal_mode = WAL");
    instance.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        environment TEXT PRIMARY KEY,
        app_uuid TEXT,
        app_numerical_id TEXT,
        app_client_id TEXT,
        app_client_secret TEXT,
        external_key TEXT,
        external_id TEXT,
        apple_pay_domain TEXT,
        merchant_client_id TEXT,
        merchant_client_secret TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migração para bancos criados antes desta coluna existir: `CREATE TABLE
    // IF NOT EXISTS` não altera tabela já existente.
    const colunas = instance
      .prepare("PRAGMA table_info(credentials)")
      .all() as { name: string }[];
    if (!colunas.some((c) => c.name === "apple_pay_domain")) {
      instance.exec("ALTER TABLE credentials ADD COLUMN apple_pay_domain TEXT");
    }

    return instance;
  } catch (error) {
    triedAndFailed = true;
    console.warn(
      "[appmax/db] não foi possível abrir .appmax/appmax.db (filesystem provavelmente somente-leitura neste runtime — normal na Vercel). Credenciais devem vir de env vars.",
      error
    );
    return null;
  }
}
