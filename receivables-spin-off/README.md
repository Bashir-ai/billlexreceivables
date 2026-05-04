# Proposal & Billing Application

A user-friendly application for preparing and sending proposals to clients, and billing accordingly.

## Features

- Multiple billing formats: Hourly, Lump Sum, Subject Basis, Success Fee
- Role-based access control: Admin, Manager, Staff, Client
- Approval workflow system
- Clean, light, and intuitive interface

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. Set up the database:
```bash
npx prisma generate
npx prisma db push
```

4. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

### Share local dev (HTTPS tunnel)

Dev server uses **port 3001**. Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to your tunnel origin (no trailing slash). See [docs/TUNNEL_DEV.md](docs/TUNNEL_DEV.md).

```bash
npm run tunnel:env -- --write-env-tunnel https://your-tunnel-host.example
npm run dev:tunnel
```

Or print lines to paste into `.env.local`: `npm run tunnel:env -- https://...`

## Tech Stack

- Next.js 14+ (App Router)
- TypeScript
- PostgreSQL + Prisma
- NextAuth.js
- Tailwind CSS
- shadcn/ui components
