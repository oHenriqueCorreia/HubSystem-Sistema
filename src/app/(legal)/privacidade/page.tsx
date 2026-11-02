import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/features/legal/components/legal-document";
import { LEGAL, mailto } from "@/features/legal/config";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como o Hub System trata dados pessoais: o que coletamos, para quê, com quem compartilhamos e como exercer seus direitos (LGPD).",
};

const Email = () => <a href={mailto("Privacidade · Hub System")}>{LEGAL.email}</a>;

const SUMMARY: [string, string, string][] = [
  ["Conta da equipe: nome, e-mail, papel e permissões", "Dar acesso ao sistema e controlar o que cada pessoa vê", "Banco de dados em São Paulo (Brasil)"],
  ["Leads e clientes: nome, telefone, e-mail, empresa, endereço e histórico de atendimento", "Gestão comercial, atendimento, contratos e cobrança", "Banco de dados em São Paulo (Brasil)"],
  ["Mensagens do WhatsApp trocadas com a empresa", "Atendimento pela API oficial do WhatsApp", "Banco de dados em São Paulo; arquivos de mídia na Meta"],
  ["Anúncios (Meta Ads e Google Ads): contas, campanhas, criativos e métricas", "Relatórios de desempenho, somente leitura", "Banco de dados em São Paulo (Brasil)"],
  ["Agenda Google: eventos e horários livres", "Sincronizar compromissos com a agenda do usuário", "Google e banco de dados em São Paulo"],
];

const SECTIONS: LegalSection[] = [
  {
    id: "responsavel",
    title: "Quem é o responsável",
    content: (
      <>
        <p>
          O {LEGAL.product} é um sistema de gestão comercial, operacional e financeira operado por <strong>{LEGAL.company}</strong>, que é a controladora dos dados pessoais tratados nele para a própria empresa.
        </p>
        <p>
          Quando outra empresa usa o {LEGAL.product} para organizar os próprios clientes, ela é a controladora desses dados e nós atuamos como operadora, tratando-os apenas para prestar o serviço, conforme as instruções dela.
        </p>
        <p>
          Canal para assuntos de privacidade e para o titular de dados: <Email />.
        </p>
      </>
    ),
  },
  {
    id: "abrangencia",
    title: "A quem esta política se aplica",
    content: (
      <ul>
        <li>Pessoas que usam o sistema. O acesso é feito somente por convite de um administrador.</li>
        <li>Leads, clientes e contatos cujos dados estão cadastrados no sistema, inclusive quem conversa com a empresa pelo WhatsApp.</li>
        <li>Quem conecta contas da Meta (Facebook, Instagram, WhatsApp, Meta Ads) ou do Google (Agenda, Google Ads) ao sistema.</li>
      </ul>
    ),
  },
  {
    id: "dados",
    title: "Quais dados tratamos",
    content: (
      <>
        <ul>
          <li>
            <strong>Conta de usuário:</strong> nome, e-mail, empresa, papel, permissões e registros de acesso. A senha é guardada pelo provedor de autenticação apenas em formato cifrado (hash); o {LEGAL.product} não tem acesso a ela.
          </li>
          <li>
            <strong>Leads e clientes:</strong> nome, telefone, WhatsApp, e-mail, empresa, endereço, site, perfis públicos em redes sociais, dados públicos do Perfil da Empresa no Google, origem do contato, interesses, anotações, tarefas, compromissos, negócios no funil, contratos e cobranças.
          </li>
          <li>
            <strong>Atendimento pelo WhatsApp:</strong> número de telefone, nome de perfil, conteúdo das mensagens, arquivos enviados, status de entrega, consentimento para receber mensagens e pedidos para não receber mais.
          </li>
          <li>
            <strong>Integrações:</strong> dados recebidos da Meta e do Google, detalhados nas seções 4 e 5, e as chaves de acesso dessas integrações, guardadas cifradas.
          </li>
          <li>
            <strong>Dados técnicos:</strong> cookies de sessão, endereço IP e informações do navegador registrados pela hospedagem para segurança e funcionamento.
          </li>
          <li>
            <strong>Localização:</strong> somente se você permitir no navegador, usada para mostrar o clima da sua cidade na tela inicial. Não guardamos o histórico de localização.
          </li>
        </ul>
        <p>Não tratamos dados pessoais sensíveis de forma intencional. Evite registrar informações desse tipo em anotações e mensagens.</p>
      </>
    ),
  },
  {
    id: "meta",
    title: "Dados recebidos da Meta (Facebook, Instagram e WhatsApp)",
    content: (
      <>
        <p>
          <strong>Meta Ads.</strong> Quando um administrador conecta o Facebook em Anúncios, pedimos somente as permissões <code>ads_read</code> e <code>business_management</code>, de leitura. Com elas recebemos: nome do perfil que conectou, contas de anúncio às quais ele tem acesso (nome, moeda, status, saldo e limite de gasto), campanhas, conjuntos de anúncios, anúncios, o resumo dos criativos (título, texto, miniatura e link de prévia) e as métricas diárias (impressões, alcance, cliques, investimento, conversões e valor das conversões).
        </p>
        <p>
          <strong>WhatsApp.</strong> Pela API oficial do WhatsApp (Cloud API) recebemos as mensagens enviadas ao número da empresa, o nome de perfil e o número de quem escreveu e, quando a conversa começa por um anúncio “Clique para WhatsApp”, a identificação do anúncio de origem.
        </p>
        <p>Usamos esses dados apenas para exibir relatórios e permitir o atendimento dentro do sistema. Não criamos, alteramos nem pausamos anúncios; não usamos os dados para publicidade, não os vendemos e não os repassamos a terceiros além dos operadores listados na seção 7.</p>
        <p>
          Você pode desconectar a qualquer momento e pedir a exclusão do que já foi importado: veja <Link href="/exclusao-de-dados">Exclusão de dados</Link>.
        </p>
      </>
    ),
  },
  {
    id: "google",
    title: "Dados recebidos do Google",
    content: (
      <>
        <p>
          <strong>Google Agenda.</strong> Cada usuário pode conectar a própria conta para sincronizar compromissos. Recebemos o e-mail da conta, a lista de agendas, os eventos e os horários livres e ocupados, e criamos ou atualizamos os eventos que o usuário marca no sistema.
        </p>
        <p>
          <strong>Google Ads.</strong> Quando um administrador conecta o Google Ads, lemos contas, campanhas, grupos de anúncios, anúncios e métricas, apenas para relatórios.
        </p>
        <p>
          O uso e a transferência para qualquer outro aplicativo de informações recebidas das APIs do Google obedecem à{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado. Esses dados não são usados para publicidade, não são vendidos e só são lidos por pessoas com o seu consentimento, para segurança ou quando a lei exigir.
        </p>
      </>
    ),
  },
  {
    id: "finalidades",
    title: "Para que usamos e com qual base legal",
    content: (
      <ul>
        <li>
          <strong>Prestar o serviço</strong> (contas, CRM, atendimento, agenda, financeiro e relatórios de anúncios): execução de contrato e procedimentos preliminares (LGPD, art. 7º, V).
        </li>
        <li>
          <strong>Gestão comercial e relacionamento com leads e clientes:</strong> legítimo interesse (art. 7º, IX), respeitando as expectativas do titular e o direito de oposição.
        </li>
        <li>
          <strong>Mensagens de marketing e cadências automáticas no WhatsApp:</strong> consentimento (art. 7º, I). O sistema registra o consentimento e bloqueia os envios para quem pede para parar.
        </li>
        <li>
          <strong>Registros financeiros, fiscais e de acesso:</strong> cumprimento de obrigação legal ou regulatória (art. 7º, II).
        </li>
        <li>
          <strong>Segurança e prevenção a fraudes:</strong> legítimo interesse e proteção do crédito, quando aplicável.
        </li>
      </ul>
    ),
  },
  {
    id: "compartilhamento",
    title: "Com quem compartilhamos",
    content: (
      <>
        <p>Compartilhamos dados apenas com os fornecedores necessários para o sistema funcionar, que atuam como operadores:</p>
        <ul>
          <li>
            <strong>Supabase:</strong> banco de dados, autenticação e arquivos, hospedados em São Paulo (Brasil).
          </li>
          <li>
            <strong>Vercel:</strong> hospedagem e execução do sistema.
          </li>
          <li>
            <strong>Meta Platforms:</strong> API do WhatsApp e API de Marketing, quando conectadas.
          </li>
          <li>
            <strong>Google:</strong> Agenda, Google Ads e login, quando conectados.
          </li>
          <li>
            <strong>Provedor de e-mail:</strong> envio de convites e de recuperação de senha.
          </li>
          <li>
            <strong>Open-Meteo:</strong> recebe só a cidade ou coordenadas aproximadas para a previsão do tempo, sem identificar você.
          </li>
        </ul>
        <p>Também podemos compartilhar dados com autoridades quando a lei ou uma ordem judicial exigir. Não vendemos dados pessoais.</p>
      </>
    ),
  },
  {
    id: "transferencia",
    title: "Transferência internacional",
    content: (
      <p>
        Os dados ficam armazenados no Brasil, mas alguns fornecedores (Vercel, Meta e Google) podem processá-los em servidores fora do país, como nos Estados Unidos. Essas transferências seguem o art. 33 da LGPD, com as garantias contratuais oferecidas por esses fornecedores.
      </p>
    ),
  },
  {
    id: "retencao",
    title: "Por quanto tempo guardamos",
    content: (
      <ul>
        <li>Conta de usuário: enquanto o acesso estiver ativo. Depois, mantemos apenas os registros que a lei exigir, pelo prazo exigido.</li>
        <li>Leads, clientes e conversas: enquanto houver relação comercial ou interesse legítimo, ou até o titular pedir a exclusão. Itens excluídos vão para a lixeira e podem ser restaurados até a exclusão definitiva.</li>
        <li>Registros financeiros e contratos: pelo prazo exigido pela legislação fiscal (em geral, 5 anos).</li>
        <li>Chaves de acesso de integrações: até a desconexão, quando são apagadas na hora.</li>
        <li>Dados de anúncios importados: enquanto a conta de anúncio estiver conectada, ou até a exclusão ser pedida.</li>
      </ul>
    ),
  },
  {
    id: "seguranca",
    title: "Como protegemos",
    content: (
      <ul>
        <li>Conexões sempre por HTTPS.</li>
        <li>Separação por empresa e controle de permissões aplicado no próprio banco de dados: cada pessoa só vê o que o papel dela permite.</li>
        <li>Chaves de acesso de integrações cifradas com AES-256-GCM.</li>
        <li>Acesso somente por convite, com registro das ações mais sensíveis.</li>
        <li>Validação de assinatura em todas as notificações recebidas da Meta e do Google.</li>
      </ul>
    ),
  },
  {
    id: "direitos",
    title: "Seus direitos e como exercê-los",
    content: (
      <>
        <p>Pela LGPD (art. 18), você pode pedir:</p>
        <ul>
          <li>confirmação de que tratamos seus dados e acesso a eles;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</li>
          <li>portabilidade dos dados;</li>
          <li>informação sobre com quem compartilhamos;</li>
          <li>revogação do consentimento e eliminação dos dados tratados com base nele;</li>
          <li>oposição a tratamentos feitos com base em legítimo interesse.</li>
        </ul>
        <p>
          Envie o pedido para <Email />, informando o telefone ou e-mail ligado aos seus dados. Respondemos em até 15 dias. No WhatsApp, responder “parar” bloqueia novas mensagens da empresa na hora.
        </p>
        <p>O sistema não toma decisões automatizadas que afetem seus interesses.</p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies e armazenamento no navegador",
    content: (
      <ul>
        <li>
          <strong>Cookies essenciais:</strong> mantêm você conectado com segurança e protegem a conexão com a Meta e o Google (um cookie temporário de 10 minutos). Sem eles, o sistema não funciona.
        </li>
        <li>
          <strong>Armazenamento local:</strong> guarda no seu navegador preferências como filtros e a cidade do clima.
        </li>
      </ul>
    ),
  },
  {
    id: "menores",
    title: "Crianças e adolescentes",
    content: <p>O {LEGAL.product} é uma ferramenta de trabalho, destinado a maiores de 18 anos. Não coletamos dados de crianças de forma intencional.</p>,
  },
  {
    id: "alteracoes",
    title: "Alterações nesta política",
    content: <p>Podemos atualizar esta política para refletir mudanças no sistema ou na lei. A data no topo indica a versão em vigor. Mudanças relevantes serão avisadas dentro do sistema.</p>,
  },
  {
    id: "contato",
    title: "Contato e autoridade de proteção de dados",
    content: (
      <p>
        Fale com a gente em <Email />. Se não ficar satisfeito com a resposta, você pode recorrer à Autoridade Nacional de Proteção de Dados (ANPD) em{" "}
        <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer">
          gov.br/anpd
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacidadePage() {
  return (
    <LegalDocument
      title="Política de Privacidade"
      intro={
        <p>
          Esta política explica, em linguagem direta, quais dados pessoais o {LEGAL.product} trata, para quê, com quem compartilha e como você pode exercer seus direitos previstos na Lei Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
      }
      summary={
        <div className="overflow-x-auto rounded-xl border bg-surface">
          <table className="w-full min-w-160 text-left text-sm">
            <caption className="px-4 pt-4 pb-2 text-left text-base font-semibold">Em resumo</caption>
            <thead>
              <tr className="border-y bg-muted/40 text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Dados
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Para quê
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Onde ficam
                </th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY.map(([data, purpose, where]) => (
                <tr key={data} className="border-b last:border-b-0">
                  <th scope="row" className="px-4 py-3 align-top font-medium">
                    {data}
                  </th>
                  <td className="px-4 py-3 align-top">{purpose}</td>
                  <td className="px-4 py-3 align-top text-muted-foreground">{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">Não vendemos dados pessoais e não usamos dados da Meta ou do Google para publicidade.</p>
        </div>
      }
      sections={SECTIONS}
    />
  );
}
