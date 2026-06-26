import { getThemeCatalog } from "@/lib/themes";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await getThemeCatalog();
  return Response.json(catalog);
}
