import type { CadenceTemplateValues } from "./schemas";

export type CadencePreset = {
  id: string;
  label: string;
  summary: string;
  whenToUse: string;
  values: CadenceTemplateValues;
};

/** Editable starting points. Messages are suggestions; every send stays manual. */
export const CADENCE_PRESETS: CadencePreset[] = [
  {
    id: "consultiva",
    label: "Prospecção consultiva",
    summary: "Abordagem com contexto, diagnóstico e encerramento respeitoso.",
    whenToUse: "Primeiro contato com uma empresa que ainda não conhece o seu serviço.",
    values: {
      name: "Prospecção consultiva",
      description: "Primeiro contato, diagnóstico, proposta de conversa e encerramento.",
      isActive: true,
      steps: [
        {
          dayOffset: 0, timeOfDay: "09:30", channel: "whatsapp", title: "Abertura personalizada",
          instruction: "Pesquise a empresa antes de enviar. Cite um fato específico e faça uma pergunta simples. Registre a resposta no lead.",
          message: "Olá, {nome}! Sou da HubSystem. Conheci a {empresa} e queria entender como vocês estão cuidando de [processo relevante]. Posso te fazer uma pergunta rápida?",
        },
        {
          dayOffset: 2, timeOfDay: "10:30", channel: "ligacao", title: "Diagnóstico breve",
          instruction: "Pergunte sobre objetivo, processo atual e principal dificuldade. Ouça antes de apresentar uma solução; anote necessidades e próximo passo.",
          message: "Olá, {nome}. Retomo nosso contato sobre a {empresa}. Queria entender o cenário de vocês e verificar se faz sentido conversarmos por alguns minutos.",
        },
        {
          dayOffset: 5, timeOfDay: "14:00", channel: "email", title: "Valor com próximo passo",
          instruction: "Envie somente se houver um benefício concreto para o contexto do lead. Proponha uma conversa curta com objetivo definido.",
          message: "Assunto: Uma ideia para a {empresa}\n\nOlá, {nome}. A partir do que observei sobre a {empresa}, acredito que podemos ajudar com [oportunidade específica]. Posso te mostrar uma sugestão objetiva em 15 minutos?",
        },
        {
          dayOffset: 9, timeOfDay: "10:00", channel: "whatsapp", title: "Fechamento do contato",
          instruction: "Respeite a ausência de resposta. Confirme se o tema é prioridade e encerre a sequência se não houver interesse.",
          message: "Olá, {nome}. Encerrando meu contato para não ocupar seu tempo. Se [tema] for uma prioridade para a {empresa} mais adiante, fico à disposição. Obrigado!",
        },
      ],
    },
  },
  {
    id: "reativacao",
    label: "Reativação de oportunidade",
    summary: "Retome uma conversa anterior com uma razão clara para voltar.",
    whenToUse: "Leads que demonstraram interesse, mas pausaram a negociação.",
    values: {
      name: "Reativação de oportunidade",
      description: "Retomada contextual de leads que pausaram uma conversa.",
      isActive: true,
      steps: [
        {
          dayOffset: 0, timeOfDay: "09:00", channel: "email", title: "Retomar o contexto",
          instruction: "Releia o histórico. Mencione o objetivo anterior, confirme se ele continua atual e ofereça uma atualização útil.",
          message: "Assunto: Retomando nossa conversa sobre [tema]\n\nOlá, {nome}. Na nossa última conversa, a {empresa} estava avaliando [objetivo]. Isso continua nos planos? Se fizer sentido, posso compartilhar uma atualização breve.",
        },
        {
          dayOffset: 4, timeOfDay: "11:00", channel: "ligacao", title: "Validar prioridade",
          instruction: "Pergunte se o momento mudou, qual decisão falta e quem participa dela. Não pressione por resposta imediata.",
          message: "Olá, {nome}. Liguei para saber se [objetivo] ainda está entre as prioridades da {empresa} e se posso ajudar com alguma informação.",
        },
        {
          dayOffset: 8, timeOfDay: "15:00", channel: "whatsapp", title: "Confirmar próximo passo",
          instruction: "Ofereça uma saída simples: agendar uma conversa, adiar o contato ou encerrar a oportunidade.",
          message: "Olá, {nome}. Deixo este último contato sobre [tema]. Prefere que a gente converse agora, retome em outra data ou encerre por enquanto?",
        },
      ],
    },
  },
  {
    id: "pos_reuniao",
    label: "Acompanhamento após reunião",
    summary: "Registre combinados e acompanhe uma decisão com clareza.",
    whenToUse: "Depois de uma reunião de diagnóstico ou apresentação de proposta.",
    values: {
      name: "Acompanhamento após reunião",
      description: "Resumo, esclarecimento de dúvidas e decisão após reunião.",
      isActive: true,
      steps: [
        {
          dayOffset: 0, timeOfDay: "16:00", channel: "email", title: "Resumo e combinados",
          instruction: "Personalize com decisões, responsáveis e prazo acordados. Confira se o resumo representa o que o cliente disse.",
          message: "Assunto: Resumo da nossa conversa\n\nOlá, {nome}. Obrigado pelo tempo hoje. Entendi que a {empresa} busca [objetivo]. Combinamos [próximo passo] até [data]. Se eu tiver deixado algo de fora, por favor me avise.",
        },
        {
          dayOffset: 2, timeOfDay: "10:00", channel: "ligacao", title: "Esclarecer dúvidas",
          instruction: "Confirme o recebimento da proposta ou resumo e identifique dúvidas, critérios de decisão e eventuais envolvidos.",
          message: "Olá, {nome}. Queria confirmar se o material ficou claro e se existe alguma dúvida que eu possa resolver para a {empresa}.",
        },
        {
          dayOffset: 6, timeOfDay: "10:00", channel: "whatsapp", title: "Alinhar a decisão",
          instruction: "Retome o prazo combinado. Registre a decisão ou negocie uma nova data, sem repetir mensagens sem contexto.",
          message: "Olá, {nome}. Conforme combinamos, volto sobre [proposta]. Vocês já conseguiram avaliar os próximos passos? Posso ajudar em algum ponto?",
        },
      ],
    },
  },
];
