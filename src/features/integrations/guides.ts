export type GuideLink = { label: string; href: string };
export type GuideStep = { title: string; detail: string; links?: GuideLink[] };
export type GuideProblem = { problem: string; solution: string; links?: GuideLink[] };

export type IntegrationGuideData = {
  id: IntegrationId;
  name: string;
  purpose: string;
  /** Onde o botão Conectar fica no sistema. */
  href: string;
  permission: string;
  before: string[];
  steps: GuideStep[];
  problems: GuideProblem[];
};

export type IntegrationId = "meta_social" | "meta_ads" | "google_ads" | "google_calendar" | "whatsapp";

const META_APPS: GuideLink = { label: "Abrir integrações comerciais do Facebook", href: "https://www.facebook.com/settings?tab=business_tools" };
const GOOGLE_PERMISSIONS: GuideLink = { label: "Abrir acessos da sua conta Google", href: "https://myaccount.google.com/permissions" };

const META_NOT_RELEASED: GuideProblem = {
  problem: "O Facebook diz que o aplicativo não está disponível ou que você não tem acesso.",
  solution: "Isso não é erro seu: a liberação do aplicativo para a sua conta é feita pelo nosso suporte. Fale com a gente pelo botão abaixo e informe o e-mail da sua conta do Facebook.",
};

const GOOGLE_NOT_RELEASED: GuideProblem = {
  problem: "O Google mostra “O Google não verificou este app” ou “Acesso bloqueado”.",
  solution: "A liberação do aplicativo para a sua conta é feita pelo nosso suporte. Fale com a gente pelo botão abaixo e informe o e-mail Google que você quer conectar.",
};

export const GUIDES: Record<IntegrationId, IntegrationGuideData> = {
  meta_social: {
    id: "meta_social",
    name: "Facebook e Instagram",
    purpose: "Para agendar e publicar posts e stories da sua Página e do seu Instagram direto pelo Estúdio.",
    href: "/conteudo?aba=contas",
    permission: "content.publish",
    before: [
      "Uma conta do Facebook com controle total da Página.",
      "Um Instagram profissional (empresa ou criador de conteúdo). Conta pessoal não funciona.",
      "O Instagram conectado à Página do Facebook.",
    ],
    steps: [
      {
        title: "Deixe o Instagram como conta profissional",
        detail: "No aplicativo do Instagram, abra Configurações, procure por tipo de conta e mude para conta profissional. Se já for profissional, pule esta etapa.",
        links: [{ label: "Ver a ajuda do Instagram", href: "https://help.instagram.com/502981923235522" }],
      },
      {
        title: "Conecte o Instagram à sua Página",
        detail: "Na sua Página do Facebook, vá em Configurações, depois em Contas vinculadas, e conecte o Instagram. Sem essa ligação, o Instagram não aparece no sistema.",
        links: [{ label: "Ver como conectar o Instagram à Página", href: "https://help.instagram.com/570895513091465" }],
      },
      {
        title: "Toque em “Conectar conta Meta”",
        detail: "Aqui no sistema, abra Conteúdo, depois Contas, e toque no botão. Você vai para a tela de login do Facebook.",
      },
      {
        title: "Entre com a conta que controla a Página",
        detail: "Confira o nome que aparece na tela antes de continuar. Se for outra pessoa, saia e entre com a conta certa.",
      },
      {
        title: "Marque as Páginas e os Instagrams",
        detail: "Na tela de escolha, marque todas as Páginas e contas que vai usar e deixe todas as permissões ligadas. O que ficar desmarcado não aparece no sistema.",
      },
      {
        title: "Escolha as contas no sistema",
        detail: "Ao voltar, a lista de contas aparece em Conteúdo, Contas. Deixe ativas as que você quer usar para publicar.",
      },
    ],
    problems: [
      META_NOT_RELEASED,
      {
        problem: "Minha Página ou meu Instagram não aparece.",
        solution: "Quase sempre ficou desmarcado na tela do Facebook. Remova o HubSystem nas integrações comerciais do Facebook e conecte de novo, marcando tudo. Confira também se o Instagram é profissional e está conectado à Página.",
        links: [META_APPS],
      },
      {
        problem: "Conectou, mas agora aparece “requer reconexão”.",
        solution: "O acesso do Facebook vence depois de um tempo, ou a senha foi trocada. Toque em Reconectar, e o sistema volta a publicar sem perder nada.",
      },
    ],
  },
  meta_ads: {
    id: "meta_ads",
    name: "Facebook Ads",
    purpose: "Para ver campanhas, gastos e resultados dos anúncios do Facebook e do Instagram nos relatórios do sistema.",
    href: "/anuncios/contas",
    permission: "ads.manage",
    before: ["Uma conta do Facebook com acesso à conta de anúncios.", "Se a conta de anúncios é de uma empresa, o seu usuário precisa estar liberado no portfólio empresarial dela."],
    steps: [
      {
        title: "Confira se você enxerga a conta de anúncios",
        detail: "Abra o Gerenciador de Anúncios com a mesma conta do Facebook. Se a conta de anúncios aparece lá, ela também vai aparecer aqui.",
        links: [{ label: "Abrir o Gerenciador de Anúncios", href: "https://business.facebook.com/adsmanager" }],
      },
      {
        title: "Se não aparecer, peça acesso",
        detail: "Peça a quem administra o portfólio empresarial para liberar o seu usuário na conta de anúncios, em Configurações do negócio.",
        links: [{ label: "Abrir Configurações do negócio", href: "https://business.facebook.com/settings" }],
      },
      {
        title: "Toque em “Conectar” no cartão Facebook Ads",
        detail: "Aqui no sistema, abra Anúncios, depois Contas.",
      },
      {
        title: "Marque os negócios e as contas de anúncios",
        detail: "Entre no Facebook e, na tela de escolha, marque tudo que vai acompanhar e deixe as permissões ligadas. O sistema só lê os dados: ele não altera as suas campanhas.",
      },
      {
        title: "Escolha as contas e ligue cada uma ao cliente",
        detail: "Ao voltar, marque quais contas entram nos relatórios e, se quiser, ligue cada uma ao cliente dela. Os dados aparecem depois da primeira sincronização.",
      },
    ],
    problems: [
      META_NOT_RELEASED,
      {
        problem: "A conta de anúncios não aparece na lista.",
        solution: "Ela ficou desmarcada na tela do Facebook, ou o seu usuário não tem acesso a ela. Confira no Gerenciador de Anúncios, remova o HubSystem nas integrações comerciais e conecte de novo.",
        links: [META_APPS, { label: "Abrir o Gerenciador de Anúncios", href: "https://business.facebook.com/adsmanager" }],
      },
      {
        problem: "Aparece “Não foi possível concluir a conexão”.",
        solution: "Tente de novo deixando todas as permissões ligadas. Se repetir, fale com o suporte e diga em qual tela parou.",
      },
    ],
  },
  google_ads: {
    id: "google_ads",
    name: "Google Ads",
    purpose: "Para ver campanhas, gastos e resultados do Google Ads nos relatórios do sistema.",
    href: "/anuncios/contas",
    permission: "ads.manage",
    before: ["Um e-mail Google com acesso à conta do Google Ads.", "O número da conta (ID de cliente) à mão, caso tenha mais de uma."],
    steps: [
      {
        title: "Confira qual e-mail tem acesso",
        detail: "Abra o Google Ads e veja com qual e-mail você entra. É com esse mesmo e-mail que você vai conectar.",
        links: [
          { label: "Abrir o Google Ads", href: "https://ads.google.com/aw/overview" },
          { label: "Ver como achar o ID de cliente", href: "https://support.google.com/google-ads/answer/1704344" },
        ],
      },
      {
        title: "Se precisar, peça acesso",
        detail: "Quem é administrador da conta consegue convidar o seu e-mail em Administrador, Acesso e segurança.",
        links: [{ label: "Ver como liberar o acesso", href: "https://support.google.com/google-ads/answer/6372672" }],
      },
      {
        title: "Toque em “Conectar” no cartão Google Ads",
        detail: "Aqui no sistema, abra Anúncios, depois Contas.",
      },
      {
        title: "Escolha o e-mail e marque todas as caixas",
        detail: "Na tela do Google, selecione o e-mail certo e marque todas as permissões pedidas. Sem isso, a conexão não termina.",
      },
      {
        title: "Escolha as contas e ligue cada uma ao cliente",
        detail: "Ao voltar, marque quais contas entram nos relatórios e, se quiser, ligue cada uma ao cliente dela.",
      },
    ],
    problems: [
      GOOGLE_NOT_RELEASED,
      {
        problem: "Aparece “O Google não concedeu acesso contínuo”.",
        solution: "Remova o HubSystem dos acessos da sua conta Google e conecte de novo, marcando todas as caixas.",
        links: [GOOGLE_PERMISSIONS],
      },
      {
        problem: "Conectou, mas nenhuma conta aparece.",
        solution: "O e-mail usado não tem acesso a nenhuma conta do Google Ads. Desconecte e entre com o e-mail certo, ou peça o acesso ao administrador da conta.",
        links: [{ label: "Ver como liberar o acesso", href: "https://support.google.com/google-ads/answer/6372672" }],
      },
    ],
  },
  google_calendar: {
    id: "google_calendar",
    name: "Google Agenda",
    purpose: "Para manter eventos e tarefas iguais nos dois lados, convidar pessoas por e-mail e ver seus horários livres.",
    href: "/configuracoes/integracoes",
    permission: "calendar.manage",
    before: ["Um e-mail Google (Gmail ou da empresa).", "Cada pessoa da equipe conecta a própria agenda."],
    steps: [
      {
        title: "Toque em “Conectar Google Agenda”",
        detail: "Em Configurações, Integrações, toque no botão. Você vai para a tela do Google.",
      },
      {
        title: "Escolha o e-mail da sua agenda",
        detail: "Se aparecerem vários, escolha aquele em que seus compromissos estão.",
        links: [{ label: "Abrir o Google Agenda para conferir", href: "https://calendar.google.com" }],
      },
      {
        title: "Marque todas as caixas de permissão",
        detail: "O Google mostra uma caixa para cada permissão. Marque todas e toque em Continuar.",
      },
      {
        title: "Confira se conectou",
        detail: "Ao voltar, o e-mail e a data da última sincronização aparecem na tela. Depois, crie um evento de teste na Agenda do sistema e veja se ele aparece no Google.",
      },
    ],
    problems: [
      GOOGLE_NOT_RELEASED,
      {
        problem: "Aparece “O Google não concedeu acesso contínuo”.",
        solution: "Remova o HubSystem dos acessos da sua conta Google e conecte de novo, marcando todas as caixas.",
        links: [GOOGLE_PERMISSIONS],
      },
      {
        problem: "A solicitação expirou.",
        solution: "A tela do Google ficou aberta por muito tempo. Volte e toque em Conectar de novo.",
      },
      {
        problem: "O botão não aparece.",
        solution: "O seu perfil não tem permissão para conectar a agenda. Peça ao administrador do sistema para liberar.",
      },
    ],
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp",
    purpose: "Para conversar com clientes e leads no Atendimento, trazer o histórico e ligar tudo aos funis.",
    href: "/atendimento",
    permission: "inbox.manage",
    before: ["O celular com o WhatsApp do número, em mãos e com internet.", "Uma vaga de aparelho conectado: o WhatsApp permite até quatro."],
    steps: [
      {
        title: "Abra os números no Atendimento",
        detail: "Em Atendimento, toque no ícone de celular, no alto da lista de conversas, e depois em “Conectar por QR Code”.",
      },
      {
        title: "No celular, abra “Aparelhos conectados”",
        detail: "No WhatsApp, abra Configurações (no Android, os três pontos) e toque em Aparelhos conectados, depois em Conectar um aparelho.",
        links: [{ label: "Ver a ajuda do WhatsApp", href: "https://faq.whatsapp.com/1317564962315842" }],
      },
      {
        title: "Leia o QR Code ou use o código de 8 letras",
        detail: "Aponte a câmera para o QR Code da tela. Se estiver usando o sistema no próprio celular, escolha o código: no WhatsApp, toque em “Conectar com número de telefone” e digite as letras.",
        links: [{ label: "Ver como conectar com o número", href: "https://faq.whatsapp.com/1324084875126592" }],
      },
      {
        title: "Toque em compilar",
        detail: "Depois de conectar, toque em compilar para trazer as conversas e os grupos. As conversas só aparecem no sistema depois disso, e pode levar alguns minutos.",
      },
    ],
    problems: [
      {
        problem: "O QR Code não funciona ou expirou.",
        solution: "O código dura pouco. Espere aparecer um novo e leia de novo. Se continuar, use o código de 8 letras.",
      },
      {
        problem: "O WhatsApp diz que não dá para conectar mais aparelhos.",
        solution: "O limite é de quatro aparelhos. No celular, em Aparelhos conectados, desconecte um que você não usa.",
      },
      {
        problem: "Conectou, mas não vejo as conversas.",
        solution: "Falta compilar. Toque em compilar no aviso que aparece na lista de conversas.",
      },
      {
        problem: "O número desconectou sozinho.",
        solution: "O WhatsApp desconecta aparelhos quando o celular fica muito tempo sem abrir o aplicativo. Abra o WhatsApp no celular de vez em quando e conecte de novo se precisar.",
        links: [{ label: "Ver a ajuda do WhatsApp", href: "https://faq.whatsapp.com/1317564962315842" }],
      },
    ],
  },
};

export const GUIDE_LIST = [GUIDES.meta_social, GUIDES.meta_ads, GUIDES.google_ads, GUIDES.google_calendar, GUIDES.whatsapp];

/** Mensagens prontas para o suporte: quem responde já sabe onde a pessoa parou. */
export const supportMessage = (name: string) => `Olá! Preciso de ajuda para conectar ${name} no HubSystem.`;
export const meetingMessage = (name: string) => `Olá! Quero marcar uma reunião de suporte para conectar ${name} no HubSystem.`;
