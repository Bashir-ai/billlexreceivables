# Share local dev via a tunnel (HTTPS URL)

Your app runs on **port `3001`** in this package (`npm run dev`). Testers cannot use `localhost` on your machine; expose it with a tunnel and align **NextAuth** with the public URL.

## Quick path (recommended)

From `receivables-spin-off/`:

1. Start a tunnel to **3001** (e.g. `ngrok http 3001`) and copy the **HTTPS** origin (no path, no trailing slash).

2. Write tunnel-only env and start dev (tunnel vars override `.env.local` for this process):

   ```bash
   npm run tunnel:env -- --write-env-tunnel https://YOUR-TUNNEL_ORIGIN
   npm run dev:tunnel
   ```

3. Share that same HTTPS URL with testers.

`.env.tunnel` is gitignored and only holds `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`.

## Alternative: paste or export manually

NextAuth uses `NEXTAUTH_URL` for callbacks and cookies; it **must** match the tunnel origin (scheme + host, **no trailing slash**).

### Print lines for `.env.local`

```bash
npm run tunnel:env -- https://YOUR_TUNNEL_ORIGIN
```

### Export in bash/zsh (then `npm run dev`)

```bash
eval "$(npm run tunnel:env --silent --exports -- https://YOUR_TUNNEL_ORIGIN)"
npm run dev
```

### Windows CMD

```cmd
npm run tunnel:env -- --windows-cmd -- https://YOUR_TUNNEL_ORIGIN
```

Then paste the two `set` lines into your terminal before `npm run dev`.

### Windows PowerShell

```powershell
npm run tunnel:env -- --powershell -- https://YOUR_TUNNEL_ORIGIN
```

Use `--url=https://...` if `&` in the URL breaks your shell.

Restart dev whenever the tunnel host changes (e.g. new ngrok subdomain).

## 1. Start the app (without tunnel overlay)

```bash
npm run dev
```

## 2. Tunnel to port 3001

### ngrok

```bash
ngrok http 3001
```

Free tiers may show a browser interstitial once per visitor.

### Cloudflare Tunnel (`cloudflared`)

```bash
cloudflared tunnel --url http://localhost:3001
```

### localtunnel

```bash
npx localtunnel --port 3001
```

## Troubleshooting

- **Redirect loops / CSRF / “Client fetch error”** — `NEXTAUTH_URL` or `NEXT_PUBLIC_APP_URL` does not match the URL in the browser. Prefer `npm run dev:tunnel` after `--write-env-tunnel` so tunnel values override `.env.local`.

- **`localhost` still in emails or links** — ensure `NEXT_PUBLIC_APP_URL` is set to the tunnel origin (included in `--write-env-tunnel`).

- **Database unreachable** — the tunnel only exposes your Next server; DB must still be reachable from your machine.

## Security

Tunnels expose your dev app to the internet. Use strong passwords, dummy data, and stop the tunnel when finished. Do not use production secrets on shared tunnels.
