#!/usr/bin/env node
/**
 * NextAuth + public URL must match your tunnel origin (no trailing slash).
 *
 * Usage:
 *   npm run tunnel:env -- https://xxxx.ngrok-free.app
 *   npm run tunnel:env -- --url=https://xxxx.ngrok-free.app
 *   npm run tunnel:env -- --write-env-tunnel https://...   # writes .env.tunnel (gitignored)
 *   npm run tunnel:env -- --exports https://...          # bash/zsh: eval "$(npm run tunnel:env --silent --exports -- https://...)"
 *   npm run tunnel:env -- --windows-cmd https://...
 *   npm run tunnel:env -- --powershell https://...
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, "..")

const argv = process.argv.slice(2)
const silent = argv.includes("--silent")
const wantExports = argv.includes("--exports")
const wantWindowsCmd = argv.includes("--windows-cmd")
const wantPwsh = argv.includes("--powershell")
const wantWrite = argv.includes("--write-env-tunnel") || argv.includes("--write")

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const urlEq = argv.find((a) => a.startsWith("--url="))
const positional = argv.find((a) => !a.startsWith("-") && !a.includes("="))
const arg = urlEq ? urlEq.slice("--url=".length) : positional

if (!arg) {
  fail(
    "Missing tunnel URL.\n" +
      "  npm run tunnel:env -- https://YOUR-HOST\n" +
      "  npm run tunnel:env -- --url=https://YOUR-HOST\n" +
      "Flags: --exports | --windows-cmd | --powershell | --write-env-tunnel (--write)"
  )
}

let u
try {
  u = new URL(arg.trim())
} catch {
  fail("Invalid URL (need full URL, e.g. https://abc123.ngrok-free.app)")
}

if (u.protocol !== "https:" && u.protocol !== "http:") {
  fail("URL must start with https: or http:")
}

const base = `${u.protocol}//${u.host}`.replace(/\/$/, "")

function parseDevScript(pkgPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    const dev = pkg.scripts?.dev ?? ""
    if (/\bWATCHPACK_POLLING\s*=\s*true\b/.test(dev)) {
      process.env.WATCHPACK_POLLING = process.env.WATCHPACK_POLLING || "true"
    }
    const m = dev.match(/\s-p\s+(\d+)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function devPortHint() {
  const p = parseDevScript(path.join(projectRoot, "package.json"))
  return p || "3000"
}

if (wantWrite) {
  const outPath = path.join(projectRoot, ".env.tunnel")
  const content =
    `# Auto-generated for tunnel dev — do not commit (see .gitignore).\n` +
    `# Regenerate: npm run tunnel:env -- --write-env-tunnel ${base}\n` +
    `NEXTAUTH_URL=${base}\n` +
    `NEXT_PUBLIC_APP_URL=${base}\n`
  fs.writeFileSync(outPath, content, "utf8")
  if (!silent) {
    console.error(`Wrote ${outPath}`)
    console.error(`Start with: npm run dev:tunnel  (loads .env.tunnel over localhost defaults)`)
  }
  process.exit(0)
}

if (wantExports) {
  console.log(`export NEXTAUTH_URL="${base}"`)
  console.log(`export NEXT_PUBLIC_APP_URL="${base}"`)
  process.exit(0)
}

if (wantWindowsCmd) {
  console.log(`set "NEXTAUTH_URL=${base}"`)
  console.log(`set "NEXT_PUBLIC_APP_URL=${base}"`)
  process.exit(0)
}

if (wantPwsh) {
  console.log(`$env:NEXTAUTH_URL="${base}"`)
  console.log(`$env:NEXT_PUBLIC_APP_URL="${base}"`)
  process.exit(0)
}

if (!silent) {
  console.log(`
# Paste into .env.local (then restart npm run dev), or use:
#   npm run tunnel:env -- --write-env-tunnel ${base}
#   npm run dev:tunnel
NEXTAUTH_URL="${base}"
NEXT_PUBLIC_APP_URL="${base}"
`)
  const port = devPortHint()
  console.log(`# Dev server: port ${port} (from package.json "dev" script, or Next default).
# Tunnel forward: ngrok http ${port}`)
}
