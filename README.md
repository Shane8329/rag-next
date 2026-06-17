# RAG-next

Node full-stack rewrite of the original `RAG-cy` project.

## Current status

Stage 1 is ready for functional acceptance:
- monorepo scaffold is stable
- legacy `chunked_reports` import works
- batch migration script exists
- QA flow runs from imported chunks
- vector retrieval path is wired through embeddings and pgvector SQL
- web workbench can import data and submit questions

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
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v4
DASHSCOPE_EMBEDDING_DIMENSION=1024
DASHSCOPE_CHAT_MODEL=qwen3.6-plus
```

If you want OpenAI embeddings and chat, set:

```env
EMBEDDING_PROVIDER=openai
CHAT_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4.1-mini
```

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

### Import legacy chunk directory

Default source directory points to the sibling `RAG-cy` project.

```bash
pnpm migrate:legacy
```

You can also pass a custom source directory and API base URL:

```bash
pnpm migrate:legacy -- "D:\path\to\chunked_reports" "http://localhost:3000" 10
```

## Acceptance checklist

You can currently verify these items:
- `pnpm test` passes
- `pnpm typecheck` passes
- `pnpm build` passes
- importing legacy JSON through the web UI works
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
