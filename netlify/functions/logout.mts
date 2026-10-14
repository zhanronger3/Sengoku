import { logout, verifyRequestOrigin } from "@netlify/identity";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    verifyRequestOrigin(req);
    await logout();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 400 });
  }
};

export const config = { path: "/api/logout" };
