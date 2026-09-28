# Rate limit e limite de corpo nas superfícies públicas

**Status:** Aprovado para planejamento (2026-09-28)
**Contexto:** o PublyFlow está em produção (`https://publyflow.vercel.app`, Vercel Hobby, Postgres do
Supabase via pooler). A spec de envio de proposta (`2026-09-25-proposal-sending-design.md` §4)
registrou "sem rate limit na V1" como risco conhecido. Esta spec fecha esse item.

## 1. Problema e escopo

Duas superfícies não exigem login e tocam o banco:

| Superfície | O que faz |
|---|---|
| `POST /api/public/proposals/[token]/responses` | grava a resposta do cliente (Aceitar / Pedir ajustes / Recusar) |
| página `/p/[token]` | lê e renderiza a proposta publicada |

O que já protege:
- a resposta é única por publicação (`unique(publication_id)`), então repetir o POST não grava duas respostas;
- o token tem alta entropia, então adivinhar links por força bruta é inviável.

O que falta proteger:
- volume abusivo (robôs martelando as duas superfícies, consumindo invocações da Vercel e conexões do Postgres);
- corpos grandes no POST. Hoje `request.json()` lê tudo; só o teto da plataforma, de cerca de 4,5 MB, segura.

**Em escopo:** rate limit por IP nas duas superfícies; limite de tamanho do corpo no POST;
retenção dos contadores.

**Fora de escopo:** rotas autenticadas; limite por token; bloqueio permanente de IP; regras no
firewall da Vercel; CAPTCHA; normalizar IPv6 para o prefixo /64. Ficam para quando houver abuso
real observado.

## 2. Decisões

- **Contadores no Postgres existente**, não em memória (inútil em serverless) nem num fornecedor
  novo (Upstash) ou no firewall da Vercel. Não há conta, chave ou variável de ambiente nova.
- **Janela fixa**, por simplicidade e custo: uma única instrução atômica por acesso.
- **Chave por IP**, com o IP pseudonimizado (SHA-256), nunca em texto. Retenção entre 24 e 48 h
  (limpeza diária do que tem mais de 24 h).
- **Fail-open:** se a checagem falhar (erro de banco), a requisição passa e o erro vai para o log.
  O rate limit nunca é a causa de a página do cliente cair.

## 3. Modelo de dados — migration 0019

```sql
create table rate_limit_buckets (
  key          text        not null,  -- '<scope>:<sha256(ip) em hex>'
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);
create index rate_limit_buckets_window_idx on rate_limit_buckets (window_start);
```

- Tabela global: sem `organization_id` e sem RLS, porque não guarda dado de tenant.
- No Supabase, os privilégios padrão já revogados de `anon` e `authenticated` cobrem a tabela
  nova. O controller confirma depois de aplicar.

## 4. Componentes

### 4.1 `RateLimitRepository` (`src/repositories/rate-limit.repository.ts`)
- `hit(db, key, windowStart): Promise<number>` executa
  `insert into rate_limit_buckets (key, window_start, count) values ($1, $2, 1)
   on conflict (key, window_start) do update set count = rate_limit_buckets.count + 1
   returning count`.
- `purgeOlderThan(db, cutoff: Date): Promise<number>` apaga as janelas com `window_start < cutoff`
  e devolve quantas apagou.

### 4.2 `checkRateLimit` (`src/lib/rate-limit.ts`)
```ts
checkRateLimit(db, {
  scope: string;          // ex.: "public-response", "public-page"
  ip: string | null;
  limit: number;
  windowSeconds: number;
  now?: Date;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }>
```
- A janela começa em `floor(now / windowSeconds) * windowSeconds`.
- A chave é `${scope}:${sha256(ip ?? "unknown")}`.
- `allowed = count <= limit`.
- `retryAfterSeconds` é o tempo até o fim da janela, arredondado para cima, com mínimo 1.
- Qualquer erro do repositório vira `{ allowed: true, retryAfterSeconds: 0 }` mais `console.error`.

### 4.3 `clientIp(headers)` (`src/lib/client-ip.ts`)
- Devolve `x-real-ip`; senão o primeiro valor de `x-forwarded-for` (sem espaços); senão `null`.
- Na Vercel, os dois cabeçalhos são definidos pela plataforma e o cliente não consegue forjá-los.

### 4.4 `readJsonWithLimit(request, maxBytes)` (`src/lib/read-json-with-limit.ts`)
- Se `Content-Length` existir e for maior que `maxBytes`: lança `PayloadTooLargeError` sem ler o corpo.
- Caso contrário, lê o stream acumulando bytes; se passar de `maxBytes`, cancela a leitura e lança
  `PayloadTooLargeError`.
- No fim, decodifica como UTF-8 e faz `JSON.parse`. JSON inválido devolve `null`, o mesmo
  comportamento de hoje (`.catch(() => null)`).

## 5. Limites e comportamento

| Superfície | Limite por IP | Onde checa | Ao estourar |
|---|---|---|---|
| `POST …/responses` | 10 por janela de 10 min (`scope: "public-response"`) | na rota | 429, `{ "error": "Muitas tentativas. Tente novamente em alguns minutos." }`, `Retry-After`, `Cache-Control: no-store` |
| `/p/[token]` | 60 por janela de 60 s (`scope: "public-page"`) | no `src/proxy.ts`, só em caminhos que começam com `/p/` | 429, `text/plain; charset=utf-8`: "Muitas requisições. Aguarde um minuto e recarregue a página.", `Retry-After`, `Cache-Control: no-store` |

**Ordem no POST:**
1. `Content-Length` acima de **16 KB (16384 bytes)** → 413 `{ "error": "Requisição muito grande." }`,
   sem tocar no banco;
2. rate limit (429);
3. leitura do corpo com teto (413 se passar);
4. validação zod e o fluxo atual, sem mudança.

**Por que 16 KB:** a maior resposta legítima fica abaixo de 9 KB. São 2000 caracteres de mensagem,
até 4 bytes cada em UTF-8, mais nome, e-mail, ids e a estrutura do JSON.

**Proxy:** o proxy do Next 16 roda em Node.js, então acessa o Postgres. A checagem acontece antes
da chamada ao Supabase Auth, e só para `/p/…`. Nenhum outro caminho chama `checkRateLimit`.

## 6. Experiência do cliente

- No formulário público (`src/components/presentation/public-proposal-view.tsx`), um **429** mostra
  "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo." com `reload: false`.
  Os valores digitados continuam no formulário e o botão volta a ficar ativo.
- Um **413** cai na mensagem genérica que já existe ("Não foi possível registrar sua resposta.
  Tente novamente."). Na prática não acontece, porque os campos do formulário já têm limite.

## 7. Retenção

A rota do cron (`/api/internal/events/drain`, diária) também chama
`RateLimitRepository.purgeOlderThan(now − 24 h)` depois de processar os eventos. Uma falha na
limpeza vai para o log e não muda a resposta da rota. Os disparos pós-resposta
(`scheduleEventDrain`) não fazem limpeza.

## 8. Testes

- **`checkRateLimit`** (banco de teste):
  - libera até o limite e bloqueia no acesso seguinte;
  - `retryAfterSeconds` correto dentro da janela;
  - uma janela nova zera a contagem;
  - IPs e escopos diferentes são independentes;
  - a chave gravada não contém o IP em texto;
  - um erro do repositório deixa passar.
- **`clientIp`:** prioridade `x-real-ip` → primeiro `x-forwarded-for` → `null`.
- **`readJsonWithLimit`:**
  - `Content-Length` grande → erro sem ler;
  - stream grande sem `Content-Length` → erro;
  - JSON válido dentro do teto → objeto;
  - JSON inválido → `null`.
- **Rota POST:**
  - 413 por cabeçalho sem consultar o banco;
  - 413 por stream;
  - a 11ª requisição do mesmo IP dá 429 com `Retry-After`;
  - os testes atuais continuam verdes.
- **Proxy:** `/p/x` acima do limite dá 429 com `Retry-After`; outro caminho não chama o rate limit.
- **Formulário público:** 429 mostra a mensagem e mantém os valores.
- **Retenção:** `purgeOlderThan` apaga só as janelas antigas; a rota do cron chama a limpeza.

## 9. Deploy

1. O controller aplica a migration 0019 no Supabase de produção **antes** do push, porque o código
   novo consulta a tabela. A mudança é aditiva: o código antigo funciona com a tabela nova.
2. O controller confirma que `anon` e `authenticated` não têm privilégio em `rate_limit_buckets`.
3. Push para `main`, feito pelo usuário. Não há variáveis novas na Vercel.
