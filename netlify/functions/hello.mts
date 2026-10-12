// 第一步:確認後端可以運作
export default async (req: Request) => {
  return Response.json({
    ok: true,
    message: "三國後端連線成功",
    serverTime: Date.now(),
  });
};

export const config = { path: "/api/hello" };
