import { z } from 'zod';
import type {
  TaskInputSchema,
  InputFieldDefinition,
  InputFieldType,
} from '../types/input-schema.js';

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  sanitized?: unknown;
}

// ============================================================================
// Input Validator
// ============================================================================

/**
 * Validates input against a task input schema.
 *
 * If schema is undefined, always returns valid=true (backward compatible).
 * This ensures tasks without schemas continue working as before.
 *
 * @param input - The input data to validate
 * @param schema - Optional task input schema
 * @returns Validation result with errors and sanitized data
 */
export function validateInput(
  input: unknown,
  schema?: TaskInputSchema
): ValidationResult {
  // No schema = no validation (backward compatible)
  if (!schema) {
    return { valid: true, errors: [], sanitized: input };
  }

  try {
    const zodSchema = generateZodSchema(schema.fields, schema.strict);
    const result = zodSchema.safeParse(input);

    if (result.success) {
      return {
        valid: true,
        errors: [],
        sanitized: result.data,
      };
    }

    return {
      valid: false,
      errors: result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
      })),
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          field: '_schema',
          message: error instanceof Error ? error.message : 'Invalid schema definition',
          code: 'invalid_schema',
        },
      ],
    };
  }
}

// ============================================================================
// Zod Schema Generator
// ============================================================================

/**
 * Generates a Zod schema from input field definitions.
 *
 * @param fields - Array of input field definitions
 * @param strict - If true, reject input with unknown fields
 * @returns Zod object schema
 */
function generateZodSchema(
  fields: InputFieldDefinition[],
  strict: boolean = false
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    shape[field.name] = createFieldSchema(field);
  }

  const schema = z.object(shape);

  // Strict mode: reject unknown keys
  return strict ? schema.strict() : schema;
}

/**
 * Creates a Zod schema for a single field definition.
 */
function createFieldSchema(field: InputFieldDefinition): z.ZodTypeAny {
  let fieldSchema: z.ZodTypeAny = createBaseFieldSchema(field);

  // Handle required/optional with default value
  if (!field.required) {
    fieldSchema = fieldSchema.optional();
    if (field.default !== undefined) {
      fieldSchema = fieldSchema.default(field.default);
    }
  }

  return fieldSchema;
}

/**
 * Creates the base Zod schema based on field type.
 */
function createBaseFieldSchema(field: InputFieldDefinition): z.ZodTypeAny {
  switch (field.type) {
    case 'string':
    case 'email':
    case 'url':
    case 'textarea':
      return createStringSchema(field);

    case 'number':
    case 'integer':
      return createNumberSchema(field);

    case 'boolean':
      return z.boolean();

    case 'date':
    case 'datetime':
      return z.coerce.date();

    case 'select':
      return createSelectSchema(field);

    case 'multiselect':
      return createMultiSelectSchema(field);

    case 'json':
      return z.unknown();

    case 'file':
      // File input is a temp upload reference (string ID or path)
      return z.string();

    case 'array':
      return createArraySchema(field);

    case 'object':
      return createObjectSchema(field);

    default:
      return z.unknown();
  }
}

/**
 * Creates a string schema with validation rules.
 */
function createStringSchema(field: InputFieldDefinition): z.ZodString {
  let schema = z.string();

  if (field.type === 'email') {
    schema = schema.email('Invalid email address');
  }

  if (field.type === 'url') {
    schema = schema.url('Invalid URL');
  }

  if (field.minLength !== undefined) {
    schema = schema.min(field.minLength, `Minimum length is ${field.minLength}`);
  }

  if (field.maxLength !== undefined) {
    schema = schema.max(field.maxLength, `Maximum length is ${field.maxLength}`);
  }

  if (field.pattern) {
    try {
      const regex = new RegExp(field.pattern);
      schema = schema.regex(regex, 'Invalid format');
    } catch (error) {
      console.warn(`Invalid regex pattern for field ${field.name}: ${field.pattern}`);
    }
  }

  return schema;
}

/**
 * Creates a number schema with validation rules.
 */
function createNumberSchema(field: InputFieldDefinition): z.ZodNumber {
  let schema = field.type === 'integer' ? z.number().int('Must be an integer') : z.number();

  if (field.min !== undefined) {
    schema = schema.min(field.min, `Minimum value is ${field.min}`);
  }

  if (field.max !== undefined) {
    schema = schema.max(field.max, `Maximum value is ${field.max}`);
  }

  return schema;
}

/**
 * Creates a select schema (enum).
 */
function createSelectSchema(field: InputFieldDefinition): z.ZodTypeAny {
  if (!field.options || field.options.length === 0) {
    return z.unknown();
  }

  const values = field.options.map((o) => o.value);

  // Check if all values are strings
  if (values.every((v) => typeof v === 'string')) {
    return z.enum(values as [string, ...string[]]);
  }

  // For mixed types, use union of literals
  if (values.length === 1) {
    return z.literal(values[0] as any);
  }

  const literalSchemas = values.map((v) => z.literal(v as any));
  return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/**
 * Creates a multiselect schema (array of enum values).
 */
function createMultiSelectSchema(field: InputFieldDefinition): z.ZodTypeAny {
  if (!field.options || field.options.length === 0) {
    return z.array(z.unknown());
  }

  const values = field.options.map((o) => o.value);

  // Check if all values are strings
  if (values.every((v) => typeof v === 'string')) {
    return z.array(z.enum(values as [string, ...string[]]));
  }

  // For mixed types, use union of literals
  if (values.length === 1) {
    return z.array(z.literal(values[0] as any));
  }

  const literalSchemas = values.map((v) => z.literal(v as any));
  const itemSchema = z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  return z.array(itemSchema);
}

/**
 * Creates an array schema with optional item schema.
 */
function createArraySchema(field: InputFieldDefinition): z.ZodArray<any> {
  if (field.items) {
    const itemSchema = createFieldSchema(field.items);
    return z.array(itemSchema);
  }

  return z.array(z.unknown());
}

/**
 * Creates an object schema with optional property schemas.
 */
function createObjectSchema(field: InputFieldDefinition): z.ZodTypeAny {
  if (field.properties && field.properties.length > 0) {
    return generateZodSchema(field.properties, false);
  }

  return z.record(z.unknown());
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Evaluates a conditional visibility rule.
 *
 * @param value - The current value of the watched field
 * @param condition - The condition to evaluate
 * @returns True if the condition is met
 */
export function evaluateCondition(
  value: unknown,
  condition: {
    operator: string;
    value: unknown;
  }
): boolean {
  switch (condition.operator) {
    case 'eq':
      return value === condition.value;

    case 'ne':
      return value !== condition.value;

    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value > condition.value
        : false;

    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value < condition.value
        : false;

    case 'gte':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value >= condition.value
        : false;

    case 'lte':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value <= condition.value
        : false;

    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value);

    case 'notIn':
      return Array.isArray(condition.value) && !condition.value.includes(value);

    default:
      return false;
  }
}

/**
 * Extracts temporary upload IDs from input data (recursively).
 *
 * @param obj - The input object to search
 * @param ids - Accumulator array for upload IDs
 * @returns Array of temp upload IDs found
 */
export function extractTempUploadIds(obj: unknown, ids: string[] = []): string[] {
  if (typeof obj === 'string' && obj.startsWith('tmp_')) {
    ids.push(obj);
  } else if (Array.isArray(obj)) {
    obj.forEach((item) => extractTempUploadIds(item, ids));
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach((value) => extractTempUploadIds(value, ids));
  }

  return ids;
}
