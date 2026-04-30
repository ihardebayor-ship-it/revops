import { PageHeader } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { NewSaleForm } from "./new-sale-form";

export default async function NewSalePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  await resolveWorkspaceBySlug(slug);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="New sale"
        description="Log a closed-won deal. Recipients are auto-derived from your team's role assignments."
      />
      <NewSaleForm slug={slug} />
    </div>
  );
}
