import { login, verifyRequestOrigin } from "@netlify/identity";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    verifyRequestOrigin(req);
    const { email, password } = await req.json();
    await login(email, password);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 401 });
  }
};

export const config = { path: "/api/login" };
