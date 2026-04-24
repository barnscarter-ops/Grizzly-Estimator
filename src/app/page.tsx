import AppShell from "@/components/app-shell";
import { createLoginRedirect, getSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/local-store";
import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{ projectId?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const session = await getSession();

  if (!session) {
    redirect(createLoginRedirect("/"));
  }

  const { projectId } = await searchParams;
  const dashboard = await getDashboardData();

  return <AppShell initialData={dashboard} initialSelectedProjectId={projectId} />;
}
