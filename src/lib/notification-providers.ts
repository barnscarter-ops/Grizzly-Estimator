import "server-only";

type EmailSendInput = {
  to: string[];
  subject: string;
  text: string;
};

type ProviderSendResult = {
  id?: string;
  count: number;
};

function trimEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function getResendApiKey() {
  return trimEnv("RESEND_API_KEY");
}

function getResendFromEmail() {
  return trimEnv("RESEND_FROM_EMAIL") || "Grizzly Estimator <notifications@grizzlyelectrical.net>";
}

export function getNotificationProviderConfigurationErrors() {
  const missing: string[] = [];

  if (!getResendApiKey()) {
    missing.push("RESEND_API_KEY");
  }

  return missing;
}

async function parseProviderError(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
      message?: string;
    };

    if (typeof payload.error === "string" && payload.error) {
      return payload.error;
    }

    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return payload.error.message;
    }

    if (payload.message) {
      return payload.message;
    }
  }

  const text = await response.text().catch(() => "");
  return text || fallback;
}

export async function sendResendEmail(
  input: EmailSendInput,
): Promise<ProviderSendResult> {
  const apiKey = getResendApiKey();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  if (input.to.length === 0) {
    throw new Error("At least one email recipient is required.");
  }

  console.info("[notifications/email] Sending via Resend", {
    recipients: input.to,
    subject: input.subject,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getResendFromEmail(),
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseProviderError(response, `Resend failed with status ${response.status}.`),
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { id?: string };
  console.info("[notifications/email] Resend accepted email", {
    id: payload.id,
    recipients: input.to,
  });

  return {
    id: payload.id,
    count: input.to.length,
  };
}
