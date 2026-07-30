import { z } from "zod";
import { buildDefinitionFromDescription } from "../../../../lib/workflow-draft";

const compileRequest = z.object({
  description: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const parsed = compileRequest.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ detail: "Invalid compile request" }, { status: 422 });
  }

  const definition = buildDefinitionFromDescription(parsed.data.description);
  return Response.json({
    definition,
    rationale: "Prepared a safe local draft from your description.",
    ai_compiled: false,
    compile_error: null,
    bound_tools: [],
    dropped_bindings: [],
    catalog_size: 0,
  });
}
