# Pendências do envio de proposta — erros por campo, UUID nas rotas e estado atualizado antes de reenviar

**Status:** Aprovado para planejamento (2026-09-28)
**Origem:** follow-ups adiados da spec `2026-09-25-proposal-sending-design.md` (revisão final da Spec 2).
Não há mudança de banco nem na API pública.

## 1. Erros por campo no formulário público de resposta

**Hoje:**
- `POST /api/public/proposals/[token]/responses` devolve, num 400, `{ errors: { name?: string[], email?: string[], message?: string[], publicationId?: string[], action?: string[] } }` (zod `flattenError(...).fieldErrors`).
- O formulário (`src/components/presentation/public-proposal-view.tsx` + `response-dialog.tsx`) ignora esse detalhe e mostra só "Confira os dados informados.".

**Depois:**
- No 400, o formulário lê `errors`. Para `name`, `email` e `message`, mostra a **primeira** mensagem do campo **logo abaixo dele**, com `aria-invalid="true"` no campo e `aria-describedby` apontando para o texto do erro.
- Se o 400 trouxer erros só em campos não visíveis (`publicationId`, `action`) ou vier sem `errors`, continua a mensagem geral atual: "Confira os dados informados." (`reload: false`).
- Se houver erro em algum campo visível, a mensagem geral não aparece; os erros ficam só nos campos.
- Ao editar um campo, o erro de servidor **daquele campo** some. Os outros permanecem até o próximo envio.
- Um novo envio limpa todos os erros de servidor antes de chamar a API.
- A validação atual feita no navegador não muda.

## 2. Validação de UUID nas rotas `[id]`

**Hoje:**
- 4 rotas validam o id com cópias próprias de `UUID_RE`: `notifications/[id]`, `proposals/[id]/send-state`, `proposals/[id]/share-info` e `proposals/[id]/publications`.
- As outras 17 rotas `[id]` passam o id direto ao Postgres. Um id malformado gera erro 22P02 e responde **500**.

**Depois:**
- Novo `src/lib/uuid.ts` com `isUuid(value: string): boolean`, usando o mesmo padrão case-insensitive de hoje: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
- As 4 rotas passam a usar `isUuid`, e as cópias de `UUID_RE` são removidas.
- Todas as outras rotas em `src/app/api/**/[id]/**/route.ts`, em **todos os métodos**, checam `isUuid(id)` logo depois da autenticação e antes de qualquer consulta ou leitura do corpo. Id inválido → **404** com o **mesmo corpo** que a rota já devolve quando o recurso não existe. Por exemplo, `proposals/[id]` usa `{ error: new ProposalNotFoundError(id).message }`. Se uma rota não tiver resposta de "não encontrado", usa `{ error: "Não encontrado." }`.
- A ordem da checagem é: sessão (401) → `isUuid` (404) → o resto. Assim um id malformado sem sessão continua respondendo 401.
- Cada rota alterada ganha um teste: id malformado → 404, sem erro 500.

## 3. Estado atualizado antes de reenviar

**Hoje:** `ProposalSendPanel` (`src/components/proposals/proposal-send-panel.tsx`) decide se mostra a confirmação "Abrir nova rodada?" com base no send-state carregado antes. Se o cliente aceitou ou recusou depois disso, o clique em **Enviar** reenvia sem confirmação.

**Depois:** ao clicar em **Enviar**, o painel:
1. desabilita o botão e chama o `refetch()` da query `useProposalSendState(proposalId)`;
2. decide com base no **estado recarregado**:
   - `canSend === false`: não envia (o painel já mostra o estado novo);
   - status `APPROVED` ou `REJECTED`: abre a confirmação atual com o texto do status novo;
   - caso contrário: envia (`publish`);
3. se o `refetch` falhar, mostra `toast.error("Não foi possível verificar o estado da proposta. Tente novamente.")` e não envia.

Enquanto o `refetch` roda, o botão continua desabilitado. A confirmação e o envio em si não mudam.

## 4. Testes

- **Formulário público:**
  - 400 com `errors.email` mostra a mensagem sob o campo E-mail, com `aria-invalid`, e sem a mensagem geral;
  - editar o e-mail remove esse erro;
  - 400 só com `errors.publicationId` mostra a mensagem geral;
  - um novo envio limpa os erros anteriores.
- **`isUuid`:** aceita um UUID minúsculo e um maiúsculo; rejeita vazio, `"abc"`, um UUID sem hífens e um UUID com um caractere a mais.
- **Rotas:** para cada rota alterada, id `not-a-uuid` com sessão dá 404 com o corpo de "não encontrado" da rota. As 4 rotas que já validavam continuam passando nos testes atuais.
- **Painel de envio:**
  - estado inicial SENT, recarregado APPROVED: abre a confirmação e não publica;
  - estado inicial SENT, recarregado SENT: publica sem confirmação;
  - recarregado com `canSend: false`: não publica;
  - falha no recarregamento mostra o toast e não publica;
  - o botão fica desabilitado durante o recarregamento.

## 5. Fora de escopo

- Mudar as mensagens de validação do zod.
- Validar UUID em rotas sem `[id]`, como ids que vêm no corpo; o zod já cobre esses casos.
- Atualização em tempo real do send-state (polling ou websocket).
