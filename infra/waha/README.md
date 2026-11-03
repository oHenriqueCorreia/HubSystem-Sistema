# WAHA local do HubSystem

O WhatsApp por QR Code precisa de um processo contínuo fora da Vercel. Esta configuração roda o WAHA no computador Windows, acessível somente em `127.0.0.1:3031`. O site deve alcançá-lo por um Cloudflare Tunnel com hostname HTTPS fixo.

## Iniciar

1. Instale e inicie o Docker Desktop.
2. Crie `infra/waha/.env` com `WAHA_API_KEY` (chave aleatória) e `WAHA_API_KEY_HASH=sha512:<SHA-512 da chave>`. O arquivo é ignorado pelo Git.
3. Nesta pasta, execute `docker compose up -d`.
4. Configure no Cloudflare Tunnel um hostname público para `http://127.0.0.1:3031` e mantenha o conector ativo após reinicializações.
5. Na Vercel Production, configure `WAHA_URL` com esse hostname HTTPS e `WAHA_API_KEY` com a chave original. Faça novo deploy.

O banco mantém o endereço e a chave criptografada por número conectado. As credenciais e sessões do WhatsApp ficam no volume Docker `waha_waha_sessions`; inclua esse volume no plano de backup. O volume `waha_waha_media` armazena mídias temporárias. Não publique a porta 3031 diretamente na internet.

## Verificação

`docker compose ps` deve mostrar `hub-waha` ativo. `GET http://127.0.0.1:3031/api/sessions` deve responder 401 sem `X-Api-Key` e 200 com a chave. No site, o gestor abre **Atendimento → Números conectados → Conectar por QR Code**; o estado deve mudar de `SCAN_QR_CODE` para `WORKING` após o escaneamento no celular.
