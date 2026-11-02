import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/features/legal/components/legal-document";
import { LEGAL, mailto } from "@/features/legal/config";

export const metadata: Metadata = {
  title: "Exclusão de dados",
  description: "Como remover o acesso do Hub System ao Facebook ou ao Google e pedir a exclusão dos seus dados.",
};

const REQUEST = mailto("Exclusão de dados · Hub System");

const SECTIONS: LegalSection[] = [
  {
    id: "facebook",
    title: "Se você conectou o Facebook ou o Meta Ads",
    content: (
      <>
        <p>Remova o acesso de um destes jeitos:</p>
        <ol>
          <li>
            No {LEGAL.product}, abra <strong>Anúncios → Contas e alertas</strong> e clique em <strong>Desconectar</strong> no Meta Ads. A permissão é revogada na Meta e a chave de acesso é apagada na hora.
          </li>
          <li>
            Ou, no Facebook, abra{" "}
            <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener noreferrer">
              Configurações → Integrações comerciais
            </a>{" "}
            (ou{" "}
            <a href="https://www.facebook.com/settings?tab=applications" target="_blank" rel="noopener noreferrer">
              Apps e sites
            </a>
            ), escolha <strong>HubSystem</strong> e clique em <strong>Remover</strong>.
          </li>
        </ol>
        <p>
          Os relatórios já importados (contas, campanhas e métricas) continuam disponíveis para a sua empresa. Para apagá-los também, peça por e-mail, como explicado na seção 4.
        </p>
      </>
    ),
  },
  {
    id: "google",
    title: "Se você conectou uma conta Google",
    content: (
      <ol>
        <li>
          No {LEGAL.product}, clique em <strong>Desconectar</strong> em <strong>Configurações → Integrações</strong> (Agenda) ou em <strong>Anúncios → Contas e alertas</strong> (Google Ads). O acesso é revogado e a chave é apagada.
        </li>
        <li>
          Ou remova o acesso em{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </li>
      </ol>
    ),
  },
  {
    id: "contatos",
    title: "Se você é cliente, lead ou falou com a empresa pelo WhatsApp",
    content: (
      <>
        <p>
          Para parar de receber mensagens, responda <strong>“parar”</strong> no WhatsApp. Os envios para o seu número são bloqueados na hora.
        </p>
        <p>Para apagar seus dados (cadastro, histórico de atendimento e conversas), peça por e-mail, como explicado abaixo.</p>
      </>
    ),
  },
  {
    id: "pedido",
    title: "Como pedir a exclusão por e-mail",
    content: (
      <>
        <ol>
          <li>
            Escreva para <a href={REQUEST}>{LEGAL.email}</a> com o assunto “Exclusão de dados”.
          </li>
          <li>Informe o nome e o telefone ou e-mail ligados aos seus dados. Se conectou o Facebook ou o Google, informe também o nome da conta.</li>
          <li>Podemos pedir uma confirmação para ter certeza de que o pedido é seu.</li>
        </ol>
        <p>
          <a
            href={REQUEST}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground! no-underline! hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Pedir exclusão por e-mail
          </a>
        </p>
      </>
    ),
  },
  {
    id: "prazo",
    title: "Prazo e confirmação",
    content: (
      <p>
        Respondemos em até 15 dias e confirmamos por e-mail quando a exclusão for concluída. Dados que a lei obriga a guardar, como registros fiscais de contratos e cobranças, são mantidos apenas pelo prazo legal e depois apagados. Mais detalhes na <Link href="/privacidade">Política de Privacidade</Link>.
      </p>
    ),
  },
];

export default function ExclusaoDeDadosPage() {
  return (
    <LegalDocument
      title="Exclusão de dados"
      intro={<p>Você pode remover o acesso do {LEGAL.product} às suas contas e pedir que seus dados sejam apagados a qualquer momento, sem custo.</p>}
      sections={SECTIONS}
    />
  );
}
