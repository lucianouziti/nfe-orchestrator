# NF-e Orchestrator

Serviço responsável por iniciar o ciclo de sincronização de NF-es. Lê os tenants ativos do MongoDB, divide em shards e enfileira jobs na fila `nfe-sync` para que o **nfe-fetch-service** faça a consulta na SEFAZ.

## Visão geral do pipeline

```
MongoDB Master
  (tenants ativos)
        │
        ▼
┌─────────────────┐   fila: nfe-sync    ┌──────────────────┐   fila: nfe-import   ┌─────────────────┐
│  nfe-orchestrator│ ─────────────────► │ nfe-fetch-service │ ──────────────────► │ nfe-import-service│
│    (porta 3001)  │                    │   (porta 3002)    │                     │   (porta 3003)   │
└─────────────────┘                    └──────────────────┘                     └─────────────────┘
                                               │                                         │
                                               ▼                                         ▼
                                           SEFAZ                                      ERP API
                                        (DistDFeInt)                              (POST /nfe/import)
```

1. **Orchestrator** — lê todos os tenants ativos, divide em shards e enfileira um job por CNPJ na fila `nfe-sync`.
2. **Fetch Service** — consome a fila `nfe-sync`, consulta a SEFAZ com mTLS e enfileira cada NF-e encontrada na fila `nfe-import`.
3. **Import Service** — consome a fila `nfe-import`, verifica idempotência e envia o XML para a API do ERP.

---

## Pré-requisitos

- **Node.js** 22+
- **Redis** — filas BullMQ, locks distribuídos e chaves de idempotência
- **MongoDB** — base master com a coleção `tenants`
- **Serviço de certificados** — endpoint HTTP que retorna o certificado PEM por `certificateId`
- **ERP API** — endpoint que recebe os XMLs importados

---

## Configuração dos serviços

### 1. nfe-orchestrator

```bash
cd nfe-orchestrator
cp .env.example .env   # ajuste as variáveis abaixo
npm install
npm run start:dev
```

**.env mínimo:**

```env
MONGODB_URI_MASTER=mongodb://localhost:27017/master
REDIS_URL=redis://localhost:6379

# Cron: a cada 45 min entre 6h e 20h (padrão)
SYNC_CRON=*/45 6-20 * * *

# Quantidade de CNPJs por shard (padrão: 100)
SHARD_SIZE=100

# Janela de distribuição dos shards em minutos (padrão: 14)
SYNC_WINDOW_MINUTES=14
```

Para **disparar o ciclo imediatamente** sem aguardar o cron, ajuste `SYNC_CRON` para um intervalo curto durante os testes:

```env
SYNC_CRON=* * * * *   # dispara a cada 1 minuto
```

---

### 2. nfe-fetch-service

```bash
cd nfe-fetch-service
cp .env.example .env
npm install
npm run start:dev
```

**.env mínimo:**

```env
MONGODB_URI_MASTER=mongodb://localhost:27017/master
REDIS_URL=redis://localhost:6379
CERTIFICATE_URL=http://localhost:3040

# 1 = Produção, 2 = Homologação (padrão: 2)
SEFAZ_AMBIENTE=2
```

---

### 3. nfe-import-service

```bash
cd nfe-import-service
cp .env.example .env
npm install
npm run start:dev
```

**.env mínimo:**

```env
REDIS_URL=redis://localhost:6379
ERP_NFE_IMPORT_URL=http://localhost:3000/api/nfe/import
ERP_API_TOKEN=seu-token-aqui
```

---

## Testando o fluxo completo

### Passo 1 — Subir a infraestrutura

```bash
# Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# MongoDB
docker run -d --name mongo -p 27017:27017 mongo:7
```

### Passo 2 — Criar um tenant de teste no MongoDB

Conecte ao MongoDB e insira um tenant de homologação:

```js
use master

db.tenants.insertOne({
  cnpj: "12345678000195",
  status: "ACTIVE",
  database: "tenant_test",
  uf: "SP",
  ambiente: 2,                          // 2 = homologação SEFAZ
  certificateId: "cert-id-do-tenant",
  lastNsu: "000000000000000",           // NSU inicial
  lastNfeSync: null
})
```

> O campo `lastNsu` controla de onde a consulta SEFAZ continua. Inicie com zeros para buscar desde o começo.

### Passo 3 — Subir os três serviços

Em terminais separados (ou via `npm run start:dev` em cada pasta):

```bash
# Terminal 1
cd nfe-orchestrator && npm run start:dev

# Terminal 2
cd nfe-fetch-service && npm run start:dev

# Terminal 3
cd nfe-import-service && npm run start:dev
```

### Passo 4 — Disparar o ciclo manualmente

O Orchestrator dispara automaticamente no cron definido. Para forçar imediatamente, use uma das opções:

**Opção A — Alterar o cron no .env:**

```env
SYNC_CRON=* * * * *   # dispara a cada 1 minuto
```

Reinicie o serviço após a alteração.

**Opção B — Chamar o endpoint de trigger (se existir):**

```bash
curl -X POST http://localhost:3001/sync/trigger
```

### Passo 5 — Verificar a propagação nas filas

Use o [Bull Dashboard](https://github.com/felixmosh/bull-board) ou o Redis CLI para acompanhar as filas:

```bash
# Ver jobs na fila nfe-sync
redis-cli LLEN bull:nfe-sync:wait

# Ver jobs na fila nfe-import
redis-cli LLEN bull:nfe-import:wait

# Ver jobs na DLQ (falhas permanentes)
redis-cli LLEN bull:nfe-import-dlq:wait
```

### Passo 6 — Acompanhar os logs

Cada serviço loga o progresso com o prefixo do CNPJ:

| Serviço | O que observar |
|---------|---------------|
| `nfe-orchestrator` | `Enqueued shard X/Y — N CNPJs` |
| `nfe-fetch-service` | `Fetched N NF-es for CNPJ {cnpj}`, erros de lock ou certificado |
| `nfe-import-service` | `Imported chaveNFe {chave}`, erros de idempotência ou ERP |

---

## Fluxo esperado por CNPJ

```
Orchestrator enfileira job { cnpj, lastNsu, certificateId, ... }
        │
        ▼
Fetch Service adquire lock Redis (key: lock:cnpj:{cnpj})
        │
        ▼
Busca certificado PEM no serviço de certificados
        │
        ▼
Faz SOAP request para SEFAZ DistDFeInt com mTLS
        │
        ├─► Para cada NF-e encontrada:
        │       Enfileira job na fila nfe-import
        │
        ▼
Atualiza lastNsu no MongoDB (cursor de paginação)
        │
        ▼
Libera lock Redis
        │
        ▼
Import Service verifica idempotência (Redis key: idempotency:{chaveNFe})
        │
        ▼
POST XML para ERP API
        │
        ├─► 2xx → marca chave como DONE (TTL 7 dias)
        ├─► 4xx → move para nfe-import-dlq (falha permanente)
        └─► 5xx → retenta com backoff exponencial
```

---

## Troubleshooting

### Nenhum job aparece na fila `nfe-sync`

- Verifique se existem tenants com `status: "ACTIVE"` no MongoDB master.
- Confira a variável `SYNC_CRON` — pode estar aguardando o próximo ciclo.
- Verifique logs do Orchestrator para erros de conexão com MongoDB ou Redis.

### Fetch Service não processa os jobs

- Confirme que `NFE_SYNC_QUEUE` no Fetch Service bate com `NFE_SYNC_QUEUE` no Orchestrator (padrão: `nfe-sync`).
- Verifique se o serviço de certificados está acessível via `CERTIFICATE_URL`.
- Em homologação (`SEFAZ_AMBIENTE=2`), confirme que o certificado é válido para o ambiente de homologação da SEFAZ.

### Import Service retorna erros 4xx (DLQ)

- O job vai para `nfe-import-dlq`. Inspecione o payload no Redis para entender o motivo da rejeição pelo ERP.
- Verifique se `ERP_API_TOKEN` está correto e se a `ERP_NFE_IMPORT_URL` está acessível.

### Jobs duplicados

- A idempotência é garantida por chave Redis com TTL de 7 dias (padrão). Se a chave expirou, o job pode ser reprocessado — isso é esperado.
- Para checar a chave: `redis-cli GET idempotency:{chaveNFe}`

### Lock preso (CNPJ não processa)

- O lock expira automaticamente após `LOCK_TTL_SECONDS` (padrão: 120s).
- Para forçar liberação em ambiente de teste: `redis-cli DEL lock:cnpj:{cnpj}`

---

## Variáveis de ambiente — referência completa

### nfe-orchestrator

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `MONGODB_URI_MASTER` | — | URI do MongoDB master (obrigatório) |
| `REDIS_URL` | `redis://localhost:6379` | URL do Redis |
| `SYNC_CRON` | `*/45 6-20 * * *` | Expressão cron do ciclo de sync |
| `SHARD_SIZE` | `100` | CNPJs por shard |
| `SYNC_WINDOW_MINUTES` | `14` | Janela de distribuição dos shards |
| `NFE_SYNC_QUEUE` | `nfe-sync` | Nome da fila de saída |
| `JOB_MAX_RETRIES` | `3` | Tentativas por job |

### nfe-fetch-service

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `MONGODB_URI_MASTER` | — | URI do MongoDB master (obrigatório) |
| `REDIS_URL` | `redis://localhost:6379` | URL do Redis |
| `CERTIFICATE_URL` | — | URL do serviço de certificados (obrigatório) |
| `SEFAZ_AMBIENTE` | `2` | 1=Produção, 2=Homologação |
| `NFE_SYNC_QUEUE` | `nfe-sync` | Fila de entrada |
| `NFE_IMPORT_QUEUE` | `nfe-import` | Fila de saída |
| `WORKER_CONCURRENCY` | `5` | Jobs paralelos por instância |
| `LOCK_TTL_SECONDS` | `120` | TTL do lock distribuído |
| `CB_FAILURE_THRESHOLD` | `5` | Falhas para abrir o circuit breaker |

### nfe-import-service

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `REDIS_URL` | `redis://localhost:6379` | URL do Redis |
| `ERP_NFE_IMPORT_URL` | — | Endpoint do ERP (obrigatório) |
| `ERP_API_TOKEN` | — | Token Bearer para o ERP |
| `NFE_IMPORT_QUEUE` | `nfe-import` | Fila de entrada |
| `NFE_IMPORT_DLQ` | `nfe-import-dlq` | Fila de falhas permanentes |
| `WORKER_CONCURRENCY` | `10` | Jobs paralelos por instância |
| `IDEMPOTENCY_TTL_SECONDS` | `604800` | TTL da chave de idempotência (7 dias) |
| `ERP_MAX_RETRIES` | `5` | Tentativas para o ERP |
