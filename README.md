# RAG-next

Node full-stack rewrite of the original `RAG-cy` project.

## Current status

Stage 2 is ready for functional acceptance:
- monorepo scaffold is stable
- legacy `chunked_reports` import works
- batch migration script exists
- PDF upload calls a configurable MinerU parser command
- MinerU Markdown is converted to legacy-compatible chunks
- uploaded chunks are embedded and stored through the same pgvector repository path
- QA flow runs from imported chunks
- vector retrieval path is wired through embeddings and pgvector SQL
- web workbench can import legacy data, upload PDFs, and submit questions

## Environment

### Database and storage

This project is configured to use Docker Compose with data on `D:`.

- Postgres data: `D:\rag-cy\postgres-data`
- Storage root: `D:\rag-cy\storage`

### Model providers

Supported values for `EMBEDDING_PROVIDER`:
- `deterministic`
- `openai`
- `dashscope`

Supported values for `CHAT_PROVIDER`:
- `extractive`
- `openai`
- `dashscope`

Default embedding is `deterministic`; default chat is `extractive`. In normal local development for this project, use the `.env` file and set both providers to `dashscope`.

DashScope uses the OpenAI-compatible API shape:

```env
EMBEDDING_PROVIDER=dashscope
CHAT_PROVIDER=dashscope
DASHSCOPE_API_KEY=your-key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v3
DASHSCOPE_EMBEDDING_DIMENSION=1024
DASHSCOPE_CHAT_MODEL=qwen3.6-plus
```

The database schema stores embeddings as `vector(1536)`. DashScope `text-embedding-v3` is requested with 1024 dimensions and the API pads vectors to 1536 before writing them to pgvector, so do not set `DASHSCOPE_EMBEDDING_DIMENSION=1536`.

If you want OpenAI embeddings and chat, set:

```env
EMBEDDING_PROVIDER=openai
CHAT_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4.1-mini
```

### MinerU parser

PDF upload is implemented as a parser adapter around an external MinerU command. Configure the command in `.env`:

```env
MINERU_API_KEY=your-key
MINERU_PARSER=cloud
MINERU_API_BASE_URL=https://mineru.net/api/v4
MINERU_PDF_URL_BASE=https://ossbucketfiles.oss-cn-beijing.aliyuncs.com
MINERU_OUTPUT_DIR=.tmp\mineru
MINERU_POLL_INTERVAL_MS=5000
MINERU_TIMEOUT_MS=300000
```

The argument template supports these placeholders:
- `{input}`: saved PDF path
- `{output}`: per-document MinerU output directory
- `{fileName}`: original uploaded file name
- `{documentId}`: SHA-1 based document id

The parser submits the saved PDF file name to MinerU as a public OSS URL base + file name, then polls until `state=done`, downloads `full_zip_url`, and reads `full.md` from the result zip. The upload service stores:
- original PDF: `STORAGE_ROOT\documents\<documentId>\original.pdf`
- parsed Markdown: `STORAGE_ROOT\documents\<documentId>\parsed.md`
- generated chunks: `STORAGE_ROOT\documents\<documentId>\chunks.json`
- raw MinerU artifacts: `STORAGE_ROOT\documents\<documentId>\mineru\...`

## Commands

### Install

```bash
pnpm install
```

### Verify

```bash
pnpm test
pnpm typecheck
pnpm build
```

### Start API and web

```bash
pnpm --filter @rag-next/api dev
pnpm --filter @rag-next/web dev
```

### Start database

Requires Docker Desktop to be installed and running.

```bash
pnpm db:start
```

## Production Docker deployment

Create a production environment file from the template:

```bash
cp .env.production.example .env.production
```

Update `.env.production` with strong database credentials and real DashScope/MinerU keys. The production compose file wires the API to the `postgres` service internally, so keep provider keys in `.env.production` and let `docker-compose.prod.yml` generate `DATABASE_URL` for the container. The web image is built with `VITE_API_BASE_URL=/api` and served by Nginx.

If your server cannot reliably pull from Docker Hub, point the production images at your own registry in `.env.production`:

```bash
POSTGRES_IMAGE=registry.cn-hangzhou.aliyuncs.com/<namespace>/pgvector:pg16
NODE_IMAGE=registry.cn-hangzhou.aliyuncs.com/<namespace>/node:22-bookworm-slim
NGINX_IMAGE=registry.cn-hangzhou.aliyuncs.com/<namespace>/nginx:1.27-alpine
```

The production Dockerfile reads `NODE_IMAGE` and `NGINX_IMAGE` as build args, and `docker-compose.prod.yml` reads `POSTGRES_IMAGE` for the database service. Leave these defaults unchanged if Docker Hub is reachable from your deployment environment.

Start the production stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Useful operations:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

To validate the compose file with the example environment file:

```bash
ENV_FILE=.env.production.example docker compose -f docker-compose.prod.yml --env-file .env.production.example config
```

The production stack contains:
- `postgres`: pgvector Postgres 16 with `db/init/*.sql` loaded on first startup
- `api`: Nest API on container port `3000`
- `web`: Nginx on host port `80`, serving the built React app and proxying `/api/*` to the API

Persistent Docker volumes:
- `postgres-data`: database files
- `storage-data`: uploaded PDFs, parsed Markdown, chunks, and MinerU artifacts under `/data/rag-next/storage`

Important: the current MinerU cloud parser submits `MINERU_PDF_URL_BASE + uploaded file name` to MinerU. Before production acceptance, make sure uploaded PDFs are available at that public OSS URL, or add an OSS upload step before creating the MinerU task.

### Import legacy chunk directory

Default source directory points to the sibling `RAG-cy` project.

```bash
pnpm migrate:legacy
```

You can also pass a custom source directory and API base URL:

```bash
pnpm migrate:legacy -- "D:\path\to\chunked_reports" "http://localhost:3000" 10
```

### Upload a PDF

Start the API, then upload a PDF through the web workbench or call the API directly:

```bash
curl -F "companyName=中芯国际" -F "file=@D:\path\to\report.pdf" http://localhost:3000/documents/upload
```

The response should contain `status: "completed"`, `source: "upload"`, and `result.chunkCount`.

If MinerU is not ready yet, you can still verify the RAG-next upload pipeline with the included fake parser:

```powershell
$env:MINERU_PARSER="command"
$env:MINERU_COMMAND="node"
$env:MINERU_ARGS_TEMPLATE="scripts/fake-mineru.cjs -p {input} -o {output}"
pnpm --filter @rag-next/api dev
```

Then upload a PDF from the web workbench or with `curl`. This fake parser does not validate MinerU quality; it only verifies file upload, artifact storage, Markdown chunking, embedding, database import, and QA retrieval.

## Acceptance checklist

You can currently verify these items:
- `pnpm test` passes
- `pnpm typecheck` passes
- `pnpm build` passes
- importing legacy JSON through the web UI works
- uploading a PDF through the web UI or `POST /documents/upload` creates `original.pdf`, `parsed.md`, `chunks.json`, and `mineru` artifacts under `STORAGE_ROOT`
- `/qa/ask` returns answers from imported chunks
- pgvector SQL path is implemented in the repository layer

## Remaining external blocker

Docker is not installed on this machine yet, so live Postgres/pgvector startup has not been executed in this environment.
Once Docker Desktop is installed, run:

```bash
pnpm db:start
```

Then continue with:

```bash
pnpm --filter @rag-next/api dev
pnpm migrate:legacy
```
