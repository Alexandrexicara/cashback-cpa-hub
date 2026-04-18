# CPA Hub Pro - Sistema de Afiliados

Sistema profissional de tracking CPA com PostgreSQL para deploy no Render.

## Como funciona

1. **Cadastro**: Usuários se registram com email e chave Pix
2. **Ofertas**: Acessam ofertas disponíveis com valores de recompensa
3. **Conversões**: Clicam e completam ações para ganhar dinheiro
4. **Saque**: Solicitam saque via Pix quando atingem R$ 10,00

## Tecnologias

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: HTML5 + CSS3 + JavaScript
- **Autenticação**: JWT + bcrypt
- **Deploy**: Render

## Variáveis de Ambiente

Copie `.env.example` para `.env`:

```bash
DATABASE_URL=postgresql://username:password@host:5432/database_name
JWT_SECRET=sua-chave-secreta
PORT=3000
NODE_ENV=production
```

## Instalação Local

```bash
# Instalar dependências
npm install

# Criar banco PostgreSQL
createdb cpahub

# Iniciar servidor
npm start
```

Acesse: http://localhost:3000

## Deploy no Render

1. Faça push do código para GitHub
2. Conecte o repositório no Render
3. Configure as variáveis de ambiente
4. Deploy automático

## Estrutura do Banco

```sql
users - Usuários cadastrados
offers - Ofertas disponíveis  
clicks - Tracking de cliques
conversions - Conversões confirmadas
withdrawals - Solicitações de saque
```

## Rotas da API

- `POST /register` - Registrar usuário
- `POST /login` - Login
- `POST /reset-password` - Redefinir senha
- `GET /offers` - Listar ofertas
- `GET /click/:offerId/:subid` - Tracking de clique
- `POST /postback` - Receber conversões
- `GET /dashboard` - Dashboard usuário
- `POST /withdraw` - Solicitar saque
- `GET /admin/stats` - Estatísticas admin
- `POST /admin/offers` - Adicionar oferta
- `GET /admin/withdrawals` - Saques pendentes
- `POST /admin/withdrawals/:id/process` - Processar saque

## Segurança

- Senhas com bcrypt
- Tokens JWT com expiração
- Validação de inputs
- CORS configurado
- SSL em produção
