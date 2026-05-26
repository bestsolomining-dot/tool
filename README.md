# NiceHash v2 Toolbox

This project is a React + Vite application with a backend proxy for NiceHash API v2.

The frontend uses `/api/v2/*` routes, and the backend server in `index.js` forwards requests to NiceHash using your API key, secret, and organization ID.

## Features

- `GET /api/v2/time` — NiceHash server time
- `GET /api/v2/algorithms` — Mining algorithms
- `GET /api/v2/accounting/balances` — Account balances
- `GET /api/v2/accounting/balance/:currency` — Single currency balance
- `GET /api/v2/mining/rigs` — Mining rig list
- `GET /api/v2/mining/address` — Mining address
- `GET /api/v2/hashpower/order-book` — Hashpower order book

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Set your NiceHash credentials in `.env`:

- `NICEHASH_API_KEY`
- `NICEHASH_API_SECRET`
- `NICEHASH_ORG_ID`
- `NICEHASH_ENVIRONMENT` (optional, default: `production`)

4. Start the backend server:

```bash
npm run backend
```

5. In another terminal, start the frontend:

```bash
npm run dev
```

6. Open the app in your browser:

```text
http://localhost:5173
```

## Notes

The Vite development server proxies `/api` requests to `http://localhost:3000`, so the frontend can use the same origin for NiceHash queries.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
