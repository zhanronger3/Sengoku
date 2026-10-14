import * as identity from "@netlify/identity";
import world from "../../shared/world-store.cjs";

// 每次請求先嘗試續期登入(JWT 約 1 小時過期;閒置後第一次操作靠這個自動換新)。
// 用 namespace import:即使舊版套件沒有 refreshSession 也不會讓打包失敗。
const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};


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
