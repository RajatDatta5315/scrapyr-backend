# SCRAPYR — AI Web Data Extraction API

> Extract structured data from any website. AI-powered, schedule-ready, no code needed.

Part of [KRYV Network](https://kryv.network)

## Setup

```bash
# 1. Create KV namespace
wrangler kv:namespace create scrapyr_kv
# Copy the ID into wrangler.toml [[kv_namespaces]] id

# 2. Create D1 database
wrangler d1 create scrapyr-db
# Copy the ID into wrangler.toml [[d1_databases]] database_id

# 3. Run schema
wrangler d1 execute scrapyr-db --file=schema.sql

# 4. Set secrets
wrangler secret put GROQ_API_KEY

# 5. Deploy
wrangler deploy
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /extract | Extract data from URL |
| GET | /jobs/:id | Check job status |
| GET | /download/:id.json | Download as JSON |
| GET | /download/:id.csv | Download as CSV |
| GET | /scheduled | List scheduled jobs |

## KRYV Integrations
- **NodeMeld** → calls `/extract` to discover new indie SaaS from Reddit/PH
- **VELQA** → calls `/extract` to audit competitor sites for GEO gaps  
- **KRYVLayer** → calls `/extract` to pull competitor keywords for page generation
