import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/features/legal/components/legal-document";
import { LEGAL, mailto } from "@/features/legal/config";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "Regras de uso do Hub System: acesso, responsabilidades, integrações com Meta e Google, dados e encerramento.",
};

const SECTIONS: LegalSection[] = [
  {
    id: "aceite",
    title: "Aceitação",
    content: (
      <p>
        Ao acessar o {LEGAL.product}, você concorda com estes Termos e com a <Link href="/privacidade">Política de Privacidade</Link>. Se usa o sistema em nome de uma empresa, você declara ter autorização para aceitá-los por ela.
      </p>
    ),
  },
  {
    id: "servico",
    title: "O serviço",
    content: (
      <p>
        O {LEGAL.product}, operado por {LEGAL.company}, reúne CRM e funil de vendas, atendimento pelo WhatsApp, cadências, tarefas, agenda, contratos, financeiro, painéis e relatórios de anúncios da Meta e do Google. As funções disponíveis podem mudar com o tempo.
      </p>
    ),
  },
  {
    id: "acesso",
    title: "Acesso e contas",
    content: (
      <ul>
        <li>O acesso é feito somente por convite de um administrador, que define o papel e as permissões de cada pessoa.</li>
        <li>A conta é pessoal. Mantenha sua senha em sigilo e avise o administrador se suspeitar de uso indevido.</li>
        <li>O administrador da empresa responde pelos convites que envia e pelas permissões que concede.</li>
      </ul>
    ),
  },
  {
    id: "uso",
    title: "Uso permitido",
    content: (
      <>
        <p>Você se compromete a usar o sistema de acordo com a lei e a não:</p>
        <ul>
          <li>cadastrar dados pessoais sem base legal ou enviar mensagens a quem não consentiu ou pediu para parar;</li>
          <li>enviar spam, conteúdo ilegal, enganoso ou que viole direitos de terceiros;</li>
          <li>descumprir as políticas do WhatsApp Business, da Meta ou do Google;</li>
          <li>tentar acessar dados de outras empresas, burlar permissões ou comprometer a segurança do sistema.</li>
        </ul>
        <p>Quem cadastra dados de clientes e leads é responsável por tê-los obtido de forma lícita e por respeitar os direitos dos titulares.</p>
      </>
    ),
  },
  {
    id: "integracoes",
    title: "Integrações com Meta e Google",
    content: (
      <ul>
        <li>As integrações usam as APIs oficiais e dependem da sua autorização. Você pode desconectar a qualquer momento.</li>
        <li>Os relatórios de anúncios são somente leitura: o sistema não cria, altera nem pausa campanhas.</li>
        <li>O uso do WhatsApp, do Facebook, do Instagram e do Google continua sujeito aos termos dessas empresas. Mudanças, limites ou indisponibilidade nas plataformas delas podem afetar o funcionamento das integrações.</li>
      </ul>
    ),
  },
  {
    id: "dados",
    title: "Seus dados",
    content: (
      <p>
        Os dados cadastrados pela sua empresa pertencem a ela. Tratamos esses dados conforme a <Link href="/privacidade">Política de Privacidade</Link>. A exclusão pode ser pedida a qualquer momento, como explicado em <Link href="/exclusao-de-dados">Exclusão de dados</Link>.
      </p>
    ),
  },
  {
    id: "disponibilidade",
    title: "Disponibilidade",
    content: <p>Trabalhamos para manter o sistema estável e seguro, mas pode haver interrupções por manutenção, falhas de fornecedores ou motivos fora do nosso controle. Sempre que possível, manutenções programadas serão avisadas com antecedência.</p>,
  },
  {
    id: "propriedade",
    title: "Propriedade intelectual",
    content: <p>O software, a marca {LEGAL.product} e os elementos visuais do sistema pertencem a {LEGAL.company}. Estes Termos não transferem nenhum direito sobre eles, apenas permitem o uso enquanto o acesso estiver ativo.</p>,
  },
  {
    id: "responsabilidade",
    title: "Responsabilidade",
    content: <p>Na extensão permitida pela lei, não respondemos por decisões tomadas com base nos relatórios, por dados informados pelas plataformas de terceiros nem por danos causados pelo uso do sistema em desacordo com estes Termos. Nada aqui limita direitos garantidos pelo Código de Defesa do Consumidor quando ele for aplicável.</p>,
  },
  {
    id: "encerramento",
    title: "Suspensão e encerramento",
    content: <p>O acesso pode ser suspenso em caso de violação destes Termos ou risco à segurança. A empresa pode encerrar o uso a qualquer momento e pedir a exportação ou a exclusão dos seus dados.</p>,
  },
  {
    id: "alteracoes",
    title: "Alterações",
    content: <p>Podemos atualizar estes Termos. A data no topo indica a versão em vigor, e mudanças relevantes serão avisadas dentro do sistema.</p>,
  },
  {
    id: "lei",
    title: "Lei aplicável e contato",
    content: (
      <p>
        Estes Termos seguem as leis brasileiras. Dúvidas: <a href={mailto("Termos de uso · Hub System")}>{LEGAL.email}</a>.
      </p>
    ),
  },
];

export default function TermosPage() {
  return <LegalDocument title="Termos de Uso" intro={<p>Estas são as regras para usar o {LEGAL.product}. Elas valem para todas as pessoas que acessam o sistema.</p>} sections={SECTIONS} />;
}
