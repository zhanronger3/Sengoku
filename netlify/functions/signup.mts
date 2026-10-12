import { signup, verifyRequestOrigin } from "@netlify/identity";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    verifyRequestOrigin(req); // 防止 CSRF
    const { email, password, nickname } = await req.json();
    await signup(email, password, { full_name: nickname });
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 400 });
  }
};

export const config = { path: "/api/signup" };
