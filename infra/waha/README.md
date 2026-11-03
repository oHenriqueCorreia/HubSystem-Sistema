# WAHA local do HubSystem

O WhatsApp por QR Code precisa de um processo contínuo fora da Vercel. Esta configuração roda o WAHA no computador Windows, acessível somente em `127.0.0.1:3031`. O site alcança o WAHA pelo endereço HTTPS fixo da conta ngrok. Um Cloudflare Tunnel também pode ser usado quando houver um domínio próprio na Cloudflare.

## Iniciar

1. Instale e inicie o Docker Desktop.
2. Crie `infra/waha/.env` com `WAHA_API_KEY` (chave aleatória), `WAHA_API_KEY_HASH=sha512:<SHA-512 da chave>`, `NGROK_AUTHTOKEN` e `NGROK_URL=https://<domínio da conta>.ngrok-free.dev`. O arquivo é ignorado pelo Git.
3. Nesta pasta, execute `docker compose --profile tunnel up -d`. Os dois contêineres usam `restart: unless-stopped`.
4. Na Vercel Production, configure `WAHA_URL` com `NGROK_URL` e `WAHA_API_KEY` com a chave original. Faça novo deploy.

O banco mantém o endereço e a chave criptografada por número conectado. As credenciais e sessões do WhatsApp ficam no volume Docker `waha_waha_sessions`; inclua esse volume no plano de backup. O volume `waha_waha_media` armazena mídias temporárias. Não publique a porta 3031 diretamente na internet. O plano grátis do ngrok tem limites de requisições e tráfego; acompanhe o consumo no painel para decidir quando migrar para uma hospedagem própria.

## Verificação

`docker compose ps` deve mostrar `hub-waha` ativo. `GET http://127.0.0.1:3031/api/sessions` deve responder 401 sem `X-Api-Key` e 200 com a chave. No site, o gestor abre **Atendimento → Números conectados → Conectar por QR Code**; o estado deve mudar de `SCAN_QR_CODE` para `WORKING` após o escaneamento no celular.
