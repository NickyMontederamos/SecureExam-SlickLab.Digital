import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Root route — was the unedited `create-next-app` boilerplate (Vercel/Next.js
 * marketing links, "To get started, edit page.tsx") until this pass, meaning
 * anyone landing on the bare domain saw a generic template instead of this
 * app. Routes straight to the right place instead of ever rendering anything
 * itself.
 */
export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/dashboard" : "/login");
}
