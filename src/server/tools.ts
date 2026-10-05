import type {
  AnySkillTool,
  CallToolResult,
  JsonSchemaObject,
  StandardSchemaWithJSON,
  ToolHandlerResult,
  ToolSchema,
} from '../types';

const isStandardSchema = (
  schema: ToolSchema,
): schema is StandardSchemaWithJSON => '~standard' in schema;

/** A tool schema as the JSON Schema object MCP clients receive. */
export const toJsonSchema = (
  schema: ToolSchema | undefined,
): JsonSchemaObject | undefined => {
  if (!schema) return undefined;
  const json = isStandardSchema(schema)
    ? schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    : { ...schema };
  delete json['$schema'];
  return json as JsonSchemaObject;
};

const formatIssues = (
  issues: ReadonlyArray<{
    message: string;
    path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
  }>,
) =>
  issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === 'object' ? String(segment.key) : String(segment),
        )
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

/**
 * Validate tool arguments. Plain JSON Schema is advertised to clients but not
 * validated here.
 */
export const validateToolInput = async (
  tool: AnySkillTool,
  payload: unknown,
): Promise<{ value: unknown } | { error: string }> => {
  const schema = tool.inputSchema as ToolSchema | undefined;
  if (!schema || !isStandardSchema(schema)) return { value: payload ?? {} };
  const result = await schema['~standard'].validate(payload ?? {});
  return result.issues
    ? {
        error: `Invalid arguments for tool "${tool.name}": ${formatIssues(result.issues)}`,
      }
    : { value: result.value };
};

const isCallToolResult = (value: unknown): value is CallToolResult =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as CallToolResult).content);

/** Turn whatever a tool handler returned into an MCP tool result. */
export const toCallToolResult = (value: ToolHandlerResult): CallToolResult => {
  if (isCallToolResult(value)) return value;
  if (value === undefined) return { content: [] };
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  const text = JSON.stringify(value, null, 2);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: value,
    };
  }
  return { content: [{ type: 'text', text }] };
};

export const errorResult = (error: unknown): CallToolResult => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: error instanceof Error ? error.message : String(error),
    },
  ],
});
