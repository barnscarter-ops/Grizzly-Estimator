"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type LoginFormProps = {
  nextPath: string;
  initialError?: string;
  disabled?: boolean;
};

type LoginResponse = {
  ok?: boolean;
  error?: string;
  redirectTo?: string;
};

export default function LoginForm({
  nextPath,
  initialError = "",
  disabled = false,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(initialError);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          next: nextPath,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as LoginResponse;

      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.error ?? "Sign-in failed. Check the email and password, then try again.");
        return;
      }

      router.push(payload.redirectTo ?? nextPath);
      router.refresh();
    } catch {
      setErrorMessage("Sign-in failed because the server could not be reached.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {errorMessage ? (
        <div className="mt-6 rounded-[24px] border border-amber-900/12 bg-amber-50 px-5 py-4 text-sm leading-7 text-amber-900">
          {errorMessage}
        </div>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <input type="hidden" name="next" value={nextPath} />
        <label className="block text-sm">
          <span className="mb-2 block text-[#69584c]">Email</span>
          <input
            required
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-[#d96a28]"
            placeholder="owner@grizzlyelectric.com"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-2 block text-[#69584c]">Password</span>
          <input
            required
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-[#d96a28]"
            placeholder="Enter your workspace password"
          />
        </label>
        <button
          type="submit"
          disabled={disabled || isSubmitting}
          className="w-full rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </>
  );
}
