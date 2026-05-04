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

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Share local dev (HTTPS tunnel)

Default dev port is **3000**. To give testers a public URL, align NextAuth with the tunnel origin:

```bash
npm run tunnel:env -- --write-env-tunnel https://YOUR_TUNNEL_ORIGIN
npm run dev:tunnel
```

`npm run tunnel:env --` also supports `--exports`, `--windows-cmd`, and `--powershell`. The receivables app under `receivables-spin-off/` uses port **3001** and has the same scripts plus [receivables-spin-off/docs/TUNNEL_DEV.md](receivables-spin-off/docs/TUNNEL_DEV.md).

## Tech Stack

- Next.js 14+ (App Router)
- TypeScript
- PostgreSQL + Prisma
- NextAuth.js
- Tailwind CSS
- shadcn/ui components
# billlexreceivables
