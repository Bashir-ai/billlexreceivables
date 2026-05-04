#!/usr/bin/env node
/**
 * Merges .env.tunnel into the environment then starts Next dev.
 * Tunnel vars override .env.local values for this process (fixes NextAuth URL).
 *
 * Prerequisites:
 *   npm run tunnel:env -- --write-env-tunnel https://YOUR_TUNNEL_ORIGIN
 */
import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, "..")

function parseDotEnv(content) {
  const out = {}
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i <= 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function main() {
  const tunnelPath = path.join(projectRoot, ".env.tunnel")
  if (!fs.existsSync(tunnelPath)) {
    console.error(
      "Missing .env.tunnel. Create it with:\n" +
        "  npm run tunnel:env -- --write-env-tunnel https://YOUR_TUNNEL_HOST\n" +
        "Then run npm run dev:tunnel again."
    )
    process.exit(1)
  }

  const tunnelVars = parseDotEnv(fs.readFileSync(tunnelPath, "utf8"))
  const merged = { ...process.env, ...tunnelVars }

  const pkgPath = path.join(projectRoot, "package.json")
  let devScript = "next dev"
  try {
    devScript = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts?.dev || devScript
  } catch {
    /* noop */
  }

  if (/\bWATCHPACK_POLLING\s*=\s*true\b/.test(devScript)) {
    merged.WATCHPACK_POLLING = merged.WATCHPACK_POLLING || "true"
  }

  const withoutPrefix = devScript.includes("next dev")
    ? devScript.slice(devScript.indexOf("next dev")).trim()
    : "next dev"
  const parts = withoutPrefix.split(/\s+/).filter(Boolean)

  let nextCli
  try {
    nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next")
    if (!fs.existsSync(nextCli)) throw new Error("missing next bin")
  } catch {
    console.error("Could not find next in node_modules. Run npm install.")
    process.exit(1)
  }

  const child = spawn(process.execPath, [nextCli, ...parts.slice(1)], {
    cwd: projectRoot,
    env: merged,
    stdio: "inherit",
    windowsHide: false,
  })

  child.on("exit", (code) => process.exit(code ?? 1))
}

main()
