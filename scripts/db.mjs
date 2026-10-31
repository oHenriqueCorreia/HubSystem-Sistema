// Migrations e testes de banco sem Docker.
//   node scripts/db.mjs migrate   → aplica supabase/migrations/*.sql ainda não aplicadas
//   node scripts/db.mjs test      → roda supabase/tests/database/*.test.sql (sempre com ROLLBACK)
//   node scripts/db.mjs status    → lista migrations aplicadas
// Requer SUPABASE_DB_URL em .env.local (Supabase → Connect → Session pooler).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Defina SUPABASE_DB_URL em .env.local (Supabase → Connect → Session pooler, com a senha do banco).");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 1, onnotice: () => {} });
const cmd = process.argv[2] ?? "status";

async function ensureTable() {
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (
    version text primary key, name text, statements text[]
  )`;
}

// Versões e nomes já aplicados (migrations aplicadas pelo painel/MCP recebem
// outra versão, mas mantêm o nome).
async function applied() {
  const rows = await sql`select version, name from supabase_migrations.schema_migrations`;
  return new Set(rows.flatMap((r) => [r.version, `name:${r.name}`]));
}

async function migrate() {
  await ensureTable();
  const done = await applied();
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (done.has(version) || done.has(`name:${rest.join("_")}`)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    process.stdout.write(`→ ${file} … `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${rest.join("_")})`;
    });
    console.log("ok");
    count++;
  }
  console.log(count ? `${count} migration(s) aplicada(s).` : "Banco já está atualizado.");
}

async function test() {
  const dir = "supabase/tests/database";
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.sql")).sort();
  let failed = 0;
  let total = 0;
  for (const file of files) {
    // Cada arquivo roda numa transação; capturamos a saída TAP de cada SELECT.
    const body = readFileSync(join(dir, file), "utf8")
      .replace(/^\s*begin;\s*/im, "")
      .replace(/\s*rollback;\s*$/im, "");
    const lines = [];
    try {
      await sql.begin(async (tx) => {
        const results = await tx.unsafe(body).simple();
        for (const r of results.flat()) {
          for (const v of Object.values(r ?? {})) if (typeof v === "string") lines.push(v);
        }
        throw new Error("__rollback__");
      });
    } catch (e) {
      if (e.message !== "__rollback__") {
        console.error(`✗ ${file}: ${e.message}`);
        failed++;
        continue;
      }
    }
    const tap = lines.filter((l) => /^(not )?ok \d+/.test(l));
    const bad = tap.filter((l) => l.startsWith("not ok"));
    total += tap.length;
    failed += bad.length;
    console.log(`${bad.length ? "✗" : "✓"} ${file}: ${tap.length - bad.length}/${tap.length}`);
    for (const l of lines.filter((l) => l.startsWith("not ok") || l.startsWith("#"))) console.log("   ", l);
  }
  console.log(`\n${total - failed}/${total} testes passaram.`);
  if (failed) process.exitCode = 1;
}

async function status() {
  await ensureTable();
  const rows = await sql`select version, name from supabase_migrations.schema_migrations order by version`;
  for (const r of rows) console.log(r.version, r.name);
}

try {
  if (cmd === "migrate") await migrate();
  else if (cmd === "test") await test();
  else await status();
} catch (e) {
  console.error("Erro:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
