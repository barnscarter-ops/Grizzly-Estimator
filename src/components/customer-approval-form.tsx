"use client";

import { useState } from "react";
import type { ProjectRecord, ProposalStyle } from "@/lib/types";

type CustomerApprovalFormProps = {
  projectId: string;
  proposalStyle: ProposalStyle;
  token: string;
  customerName: string;
  customerEmail?: string;
  initialWorkflow: ProjectRecord["proposalWorkflow"];
};

export default function CustomerApprovalForm({
  projectId,
  proposalStyle,
  token,
  customerName,
  customerEmail,
  initialWorkflow,
}: CustomerApprovalFormProps) {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [formState, setFormState] = useState({
    signedByName: customerName,
    signedByEmail: customerEmail ?? "",
    signatureText: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/proposals/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          proposalStyle,
          token,
          signedByName: formState.signedByName,
          signedByEmail: formState.signedByEmail,
          signatureText: formState.signatureText,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        project?: ProjectRecord;
      };

      if (!response.ok || !payload.project) {
        setError(payload.error ?? payload.message ?? "Approval failed.");
        return;
      }

      setWorkflow(payload.project.proposalWorkflow);
      setMessage(payload.message ?? "Proposal approved.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (workflow.status === "customer_approved" && workflow.customerSignature) {
    return (
      <section className="rounded-[28px] border border-emerald-900/10 bg-emerald-50 p-5">
        <p className="eyebrow text-emerald-900">Customer Approval Recorded</p>
        <p className="mt-4 text-sm leading-7 text-emerald-950">
          Signed by {workflow.customerSignature.signedByName} on{" "}
          {new Date(workflow.customerSignature.signedAt).toLocaleString()}.
        </p>
        <p className="mt-2 text-sm text-emerald-950">
          Typed signature: <strong>{workflow.customerSignature.signatureText}</strong>
        </p>
      </section>
    );
  }

  if (workflow.status !== "sent_to_customer") {
    return (
      <section className="rounded-[28px] border border-amber-900/10 bg-amber-50 p-5">
        <p className="eyebrow text-amber-900">Approval Not Open Yet</p>
        <p className="mt-4 text-sm leading-7 text-amber-950">
          This proposal can be reviewed right now, but approval is only enabled after the
          owner sends it to the customer.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-black/8 bg-[#fff8f1] p-5">
      <p className="eyebrow">Approve This Proposal</p>
      <p className="mt-4 text-sm leading-7 text-[#574a41]">
        To approve, enter your name and email, then type your full name exactly again in
        the signature field. That typed signature will be saved with the approval record.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm">
          <span className="mb-2 block text-[#69584c]">Signer name</span>
          <input
            required
            value={formState.signedByName}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                signedByName: event.target.value,
              }))
            }
            className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-2 block text-[#69584c]">Signer email</span>
          <input
            required
            type="email"
            value={formState.signedByEmail}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                signedByEmail: event.target.value,
              }))
            }
            className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-2 block text-[#69584c]">Typed signature</span>
          <input
            required
            value={formState.signatureText}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                signatureText: event.target.value,
              }))
            }
            className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
          />
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-full bg-[#d96a28] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#c65c1c] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Recording approval..." : "Approve and sign"}
        </button>
      </form>

      {message ? <p className="mt-4 text-sm text-emerald-900">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-rose-900">{error}</p> : null}
    </section>
  );
}
