import Link from "next/link";
import { createLoginRedirect, getSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { getProjectById } from "@/lib/local-store";
import { validateProposalShareToken } from "@/lib/proposal-share";
import CustomerApprovalForm from "@/components/customer-approval-form";
import { formatCurrency, formatPercent } from "@/lib/utils";

type ProposalPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ style?: string; token?: string }>;
};

export default async function ProposalPage({
  params,
  searchParams,
}: ProposalPageProps) {
  const { projectId } = await params;
  const { style, token } = await searchParams;
  const project = await getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const proposal =
    project.proposalVariants.find((variant) => variant.style === style) ??
    project.proposalVariants[0];
  const session = await getSession();
  const hasShareAccess =
    session || validateProposalShareToken(token, project.id, proposal.style);

  if (!hasShareAccess) {
    notFound();
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {session ? (
            <Link
              href="/"
              className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm text-[#5a4d44] transition hover:border-black/20"
            >
              Back to workspace
            </Link>
          ) : (
            <Link
              href={createLoginRedirect(`/proposal/${project.id}?style=${proposal.style}`)}
              className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm text-[#5a4d44] transition hover:border-black/20"
            >
              Team sign in
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.print();
              }
            }}
            className="rounded-full bg-[#1f1a17] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#3a2f2a]"
          >
            Save as PDF
          </button>
        </div>

        <section className="panel overflow-hidden rounded-[32px]">
          <div className="panel-dark px-6 py-8 sm:px-10">
            <p className="eyebrow text-[#f1c8ad]">Proposal Variant</p>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {proposal.title}
                </h1>
                <p className="mt-3 text-sm leading-7 text-[#f2e4d9] sm:text-base">
                  {proposal.intro}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/8 px-5 py-4 text-sm">
                <p className="text-[#f7d7c0]">{project.customer.name}</p>
                <p className="mt-1 text-[#fdf7f2]">{project.customer.address}</p>
                <p className="mt-2 font-mono text-xs tracking-[0.16em] text-[#f7d7c0]">
                  {proposal.style.toUpperCase()} STYLE
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-8">
              <section>
                <p className="eyebrow">Scope Highlights</p>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-[#3f352f]">
                  {proposal.bulletHighlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="rounded-[20px] border border-black/8 bg-white/55 px-4 py-3"
                    >
                      {highlight}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="eyebrow">Estimate By Area</p>
                <div className="mt-4 space-y-4">
                  {project.estimateDraft.areaGroups.map((group) => (
                    <div
                      key={group.area}
                      className="rounded-[24px] border border-black/8 bg-white/55 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">{group.area}</h2>
                        <span className="font-mono text-xs text-[#735c4f]">
                          {formatCurrency(group.subtotal)}
                        </span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {group.lineItems.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-[20px] border border-black/6 bg-[#fbf8f3] px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{item.name}</p>
                                <p className="mt-1 text-xs leading-6 text-[#6d5a50]">
                                  {item.description}
                                </p>
                              </div>
                              <p className="text-sm font-semibold">
                                {formatCurrency(item.sellPrice)}
                              </p>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] tracking-[0.14em] text-[#7c6656]">
                              <span>{item.quantity}x</span>
                              <span>{item.laborHours} labor hrs</span>
                              <span>{formatPercent(item.confidence)}</span>
                              <span>{item.status.replaceAll("_", " ")}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-[28px] border border-black/8 bg-[#fff8f1] p-5">
                <p className="eyebrow">Pricing Summary</p>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[#6d5a50]">Material cost</span>
                    <span>{formatCurrency(project.estimateDraft.materialTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#6d5a50]">Labor allowance</span>
                    <span>
                      {project.estimateDraft.totalLaborHours} hrs at{" "}
                      {formatCurrency(project.estimateDraft.laborRate)}/hr
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#6d5a50]">Review status</span>
                    <span>{project.estimateDraft.reviewStatus.replaceAll("_", " ")}</span>
                  </div>
                  <div className="border-t border-black/8 pt-3">
                    <div className="flex items-center justify-between text-lg font-semibold">
                      <span>Total proposal</span>
                      <span>{formatCurrency(project.estimateDraft.grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[28px] border border-black/8 bg-[#fff8f1] p-5">
                <p className="eyebrow">Approval Workflow</p>
                <p className="mt-4 text-sm leading-7 text-[#574a41]">
                  {proposal.depositRequired
                    ? `This proposal includes a recommended deposit of ${formatCurrency(proposal.depositAmount)} before materials are released.`
                    : "This proposal can be approved without a deposit requirement."}
                </p>
                <div className="mt-4 rounded-[20px] border border-black/8 bg-white/70 px-4 py-3 text-sm text-[#574a41]">
                  Current status: {project.proposalWorkflow.status.replaceAll("_", " ")}
                </div>
              </section>

              <section className="rounded-[28px] border border-black/8 bg-[#fff8f1] p-5">
                <p className="eyebrow">Walkthrough Findings</p>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-[#574a41]">
                  {project.analysisSummary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>

              {!session && token ? (
                <CustomerApprovalForm
                  projectId={project.id}
                  proposalStyle={proposal.style}
                  token={token}
                  customerName={project.customer.name}
                  customerEmail={project.customer.email}
                  initialWorkflow={project.proposalWorkflow}
                />
              ) : project.proposalWorkflow.customerSignature ? (
                <section className="rounded-[28px] border border-emerald-900/10 bg-emerald-50 p-5">
                  <p className="eyebrow text-emerald-900">Signature On File</p>
                  <p className="mt-4 text-sm leading-7 text-emerald-950">
                    Signed by {project.proposalWorkflow.customerSignature.signedByName} on{" "}
                    {new Date(
                      project.proposalWorkflow.customerSignature.signedAt,
                    ).toLocaleString()}
                    .
                  </p>
                  <p className="mt-2 text-sm text-emerald-950">
                    Typed signature:{" "}
                    <strong>{project.proposalWorkflow.customerSignature.signatureText}</strong>
                  </p>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
