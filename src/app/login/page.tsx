import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { createLoginRedirect, getAuthConfigurationError, getSession } from "@/lib/auth";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

function errorMessage(errorCode?: string) {
  if (errorCode === "invalid") {
    return "Sign-in failed. Check the email and password, then try again.";
  }

  return "";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const session = await getSession();
  const nextPath = params.next && params.next.startsWith("/") ? params.next : "/";
  const configError = getAuthConfigurationError();

  if (session) {
    redirect(nextPath);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="panel-dark rounded-[36px] px-6 py-8 sm:px-8 sm:py-10">
          <p className="eyebrow text-[#f1c8ad]">Secure Workspace</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Grizzly Estimator
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-8 text-[#f5e5d8] sm:text-base">
            The workspace is now protected behind sign-in so customer records, walkthrough
            media, proposal drafts, and Housecall Pro actions stay private.
          </p>
          <ul className="mt-8 space-y-4 text-sm leading-7 text-[#f5e5d8]">
            <li>Only signed-in staff can open the dashboard, uploads, and sync actions.</li>
            <li>Customer proposal links now use signed share tokens instead of guessable IDs.</li>
            <li>Uploaded videos, blueprints, photos, and notes are no longer public routes.</li>
          </ul>
        </section>

        <section className="panel rounded-[36px] px-6 py-8 sm:px-8 sm:py-10">
          <div className="max-w-md">
            <p className="eyebrow">Team Sign-In</p>
            <h2 className="mt-3 text-2xl font-semibold">Open the estimating workspace</h2>
            <p className="mt-3 text-sm leading-7 text-[#5c4f46]">
              Use your configured admin credentials to access projects, uploads, and proposal
              sharing tools.
            </p>
          </div>

          {configError ? (
            <div className="mt-6 rounded-[24px] border border-rose-900/10 bg-rose-50 px-5 py-4 text-sm leading-7 text-rose-900">
              {configError}
            </div>
          ) : null}

          <LoginForm
            nextPath={nextPath}
            initialError={errorMessage(params.error)}
            disabled={Boolean(configError)}
          />

          <p className="mt-5 text-sm leading-7 text-[#67584d]">
            Customer-facing proposal links still work when they include a valid signed share
            token.
          </p>
          <p className="mt-3 text-sm text-[#67584d]">
            <Link
              href={createLoginRedirect("/")}
              className="underline decoration-black/20 underline-offset-4"
            >
              Return to workspace entry
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
