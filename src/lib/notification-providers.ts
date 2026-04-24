import "server-only";

type EmailSendInput = {
  to: string[];
  subject: string;
  text: string;
};

type SmsSendInput = {
  to: string[];
  body: string;
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

function getTwilioAccountSid() {
  return trimEnv("TWILIO_ACCOUNT_SID");
}

function getTwilioAuthToken() {
  return trimEnv("TWILIO_AUTH_TOKEN");
}

function getTwilioPhoneNumber() {
  return trimEnv("TWILIO_PHONE_NUMBER");
}

export function getNotificationProviderConfigurationErrors() {
  const missing: string[] = [];

  if (!getResendApiKey()) {
    missing.push("RESEND_API_KEY");
  }

  if (!getTwilioAccountSid()) {
    missing.push("TWILIO_ACCOUNT_SID");
  }

  if (!getTwilioAuthToken()) {
    missing.push("TWILIO_AUTH_TOKEN");
  }

  if (!getTwilioPhoneNumber()) {
    missing.push("TWILIO_PHONE_NUMBER");
  }

  return missing;
}

export function normalizeUsPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (value.startsWith("+") && digits.length >= 10) {
    return `+${digits}`;
  }

  throw new Error(`Phone number "${value}" is not a valid US/E.164 number.`);
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

export async function sendTwilioSms(
  input: SmsSendInput,
): Promise<ProviderSendResult> {
  const accountSid = getTwilioAccountSid();
  const authToken = getTwilioAuthToken();
  const from = getTwilioPhoneNumber();

  if (!accountSid || !authToken || !from) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be configured.",
    );
  }

  if (input.to.length === 0) {
    throw new Error("At least one SMS recipient is required.");
  }

  const normalizedFrom = normalizeUsPhoneNumber(from);
  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const messageIds: string[] = [];

  for (const rawRecipient of input.to) {
    const normalizedTo = normalizeUsPhoneNumber(rawRecipient);
    console.info("[notifications/sms] Sending via Twilio", {
      to: normalizedTo,
    });

    const body = new URLSearchParams({
      To: normalizedTo,
      From: normalizedFrom,
      Body: input.body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      throw new Error(
        await parseProviderError(response, `Twilio failed with status ${response.status}.`),
      );
    }

    const payload = (await response.json().catch(() => ({}))) as { sid?: string };
    if (payload.sid) {
      messageIds.push(payload.sid);
    }
  }

  console.info("[notifications/sms] Twilio accepted messages", {
    count: input.to.length,
    ids: messageIds,
  });

  return {
    id: messageIds[0],
    count: input.to.length,
  };
}
