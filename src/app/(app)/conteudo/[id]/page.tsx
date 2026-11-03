import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/dal";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { ContentEditor } from "@/features/content/components/content-editor";
import { getContent } from "@/features/content/queries";

export const metadata: Metadata = { title: "Conteúdo" };

export default async function ConteudoItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("content.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const content = await getContent(id);
  if (!content || !content.task) notFound();
  const canManage = Boolean(user.permissions["content.manage"]);
  const { data: campaigns } = canManage && user.permissions["ads.read"] ? await (await createClient()).from("ad_campaigns").select("id, name").order("name").limit(300) : { data: [] };

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trabalho" }, { label: "Conteúdo", href: "/conteudo" }, { label: content.task.title }]} title={content.task.title} description={content.task.description ?? undefined} />
      <PageBody>
        <ContentEditor
          key={`${content.id}-${content.version}`}
          id={content.id}
          status={content.status}
          format={content.format}
          caption={content.caption}
          version={content.version}
          approvedVersion={content.approved_version}
          lastError={content.last_error}
          title={content.task.title}
          taskId={content.task.id}
          clientName={content.client?.legal_name ?? null}
          board={content.board}
          list={content.list}
          campaignId={content.campaign?.id ?? null}
          campaigns={(campaigns ?? []) as { id: string; name: string }[]}
          assets={content.assets}
          reviews={content.reviews}
          schedules={content.schedules}
          accounts={content.accounts}
          canManage={canManage}
          canPublish={Boolean(user.permissions["content.publish"])}
        />
      </PageBody>
    </>
  );
}
