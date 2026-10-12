import { getUser } from "@netlify/identity";
import world from "../../shared/world-store.cjs";

export default async () => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const meta: any = (user as any).userMetadata ?? {};
  return Response.json({
    id: user.id,
    email: user.email,
    name: (user as any).name ?? meta.full_name ?? null,
    nick: world.nickOf({ id: user.id, name: (user as any).name ?? meta.full_name }),
  });
};

export const config = { path: "/api/me" };
