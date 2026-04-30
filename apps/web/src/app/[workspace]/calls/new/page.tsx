import { PageHeader } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { NewCallForm } from "./new-call-form";

export default async function NewCallPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  await resolveWorkspaceBySlug(slug); // gates access

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="New call" description="Log an appointment or call." />
      <NewCallForm slug={slug} />
    </div>
  );
}
