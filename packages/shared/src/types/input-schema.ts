import { z } from 'zod';

// ============================================================================
// Input Field Types
// ============================================================================

export const InputFieldType = {
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  EMAIL: 'email',
  URL: 'url',
  DATE: 'date',
  DATETIME: 'datetime',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  TEXTAREA: 'textarea',
  JSON: 'json',
  FILE: 'file',
  ARRAY: 'array',
  OBJECT: 'object',
} as const;

export type InputFieldType = (typeof InputFieldType)[keyof typeof InputFieldType];

export const InputFieldTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'email',
  'url',
  'date',
  'datetime',
  'select',
  'multiselect',
  'textarea',
  'json',
  'file',
  'array',
  'object',
]);

// ============================================================================
// Conditional Operators
// ============================================================================

export const ConditionalOperator = {
  EQUALS: 'eq',
  NOT_EQUALS: 'ne',
  GREATER_THAN: 'gt',
  LESS_THAN: 'lt',
  GREATER_THAN_OR_EQUAL: 'gte',
  LESS_THAN_OR_EQUAL: 'lte',
  IN: 'in',
  NOT_IN: 'notIn',
} as const;

export type ConditionalOperator =
  (typeof ConditionalOperator)[keyof typeof ConditionalOperator];

export const ConditionalOperatorSchema = z.enum([
  'eq',
  'ne',
  'gt',
  'lt',
  'gte',
  'lte',
  'in',
  'notIn',
]);

// ============================================================================
// Input Field Definition
// ============================================================================

export interface InputFieldDefinition {
  /** Field name (used as key in input object) */
  name: string;
  /** Field type */
  type: InputFieldType;
  /** Human-readable label */
  label: string;
  /** Help text describing the field */
  description?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Default value if not provided */
  default?: unknown;

  // String/Number validation
  /** Minimum length for strings */
  minLength?: number;
  /** Maximum length for strings */
  maxLength?: number;
  /** Minimum value for numbers */
  min?: number;
  /** Maximum value for numbers */
  max?: number;
  /** Regex pattern for string validation */
  pattern?: string;

  // Select options
  /** Options for select/multiselect fields */
  options?: Array<{ label: string; value: unknown }>;

  // File constraints
  /** Accepted MIME types or file extensions (e.g., ".pdf,.docx" or "image/*") */
  accept?: string;
  /** Maximum file size in bytes */
  maxSize?: number;

  // Array/Object
  /** Schema for array items */
  items?: InputFieldDefinition;
  /** Schema for object properties */
  properties?: InputFieldDefinition[];

  // Conditional visibility
  /** Show field only if condition is met */
  showIf?: {
    /** Field name to check */
    field: string;
    /** Comparison operator */
    operator: ConditionalOperator;
    /** Value to compare against */
    value: unknown;
  };

  // UI hints
  /** Placeholder text for input */
  placeholder?: string;
  /** Additional help text */
  helpText?: string;
}

// Recursive schema definition for nested fields
const baseInputFieldDefinitionSchema = z.object({
  name: z.string(),
  type: InputFieldTypeSchema,
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  minLength: z.number().positive().optional(),
  maxLength: z.number().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.unknown() })).optional(),
  accept: z.string().optional(),
  maxSize: z.number().positive().optional(),
  showIf: z
    .object({
      field: z.string(),
      operator: ConditionalOperatorSchema,
      value: z.unknown(),
    })
    .optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
});

export type InputFieldDefinitionSchema = z.ZodType<InputFieldDefinition>;

export const InputFieldDefinitionSchema: InputFieldDefinitionSchema =
  baseInputFieldDefinitionSchema.extend({
    items: z.lazy(() => InputFieldDefinitionSchema.optional()),
    properties: z.lazy(() => z.array(InputFieldDefinitionSchema).optional()),
  }) as InputFieldDefinitionSchema;

// ============================================================================
// Task Input Schema
// ============================================================================

export interface TaskInputSchema {
  /** Array of field definitions */
  fields: InputFieldDefinition[];
  /** Strict mode: reject input with unknown fields */
  strict?: boolean;
}

export const TaskInputSchemaSchema = z.object({
  fields: z.array(InputFieldDefinitionSchema),
  strict: z.boolean().optional(),
});

// ============================================================================
// Temp Upload
// ============================================================================

export interface TempUpload {
  id: string;
  storagePath: string;
  storageBackendId: string;
  uploadedAt: Date;
  expiresAt: Date;
  claimedByRunId?: string;
  deletedAt?: Date;
  originalFilename?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy?: string;
}

export const TempUploadSchema = z.object({
  id: z.string(),
  storagePath: z.string(),
  storageBackendId: z.string(),
  uploadedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  claimedByRunId: z.string().optional(),
  deletedAt: z.coerce.date().optional(),
  originalFilename: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  uploadedBy: z.string().optional(),
});
