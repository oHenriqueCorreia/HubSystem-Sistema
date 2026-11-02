// Build da Vercel. Em produção, aplica as migrations antes de gerar o site: se uma
// falhar, o deploy para e a versão atual continua no ar. Pré-visualizações não tocam no banco.
import { spawnSync } from "node:child_process";

function run(args) {
  const { status } = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}

if (process.env.VERCEL_ENV === "production") run(["scripts/db.mjs", "migrate"]);
run(["node_modules/next/dist/bin/next", "build"]);
