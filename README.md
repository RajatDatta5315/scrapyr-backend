# SCRAPYR Backend — Cloudflare Worker

> AI web data extraction API. Part of KRYV Network.

## D1 database already created
- database_id: `c9811430-0f70-4bb6-bd89-354661d84208`
- Already in wrangler.toml ✅

## Setup (from the scrapyr-backend directory)

```bash
# 1. KV namespace (wrangler 4.x syntax — note: no colon)
wrangler kv namespace create scrapyr_kv
# Copy the printed ID into wrangler.toml [[kv_namespaces]] id field

# 2. Run schema on the D1 that was already created
wrangler d1 execute scrapyr-db --file=schema.sql --remote

# 3. Set secret
wrangler secret put GROQ_API_KEY

# 4. Deploy
wrangler deploy
```

## API Endpoints
- POST /extract
- GET /jobs/:id
- GET /download/:id.json  /download/:id.csv
- GET /scheduled
