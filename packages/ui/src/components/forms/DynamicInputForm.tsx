'use client';

import { useState } from 'react';
import type { TaskInputSchema, InputFieldDefinition } from '@pipeweave/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DynamicInputFormProps {
  schema: TaskInputSchema;
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
  initialValues?: Record<string, unknown>;
  submitLabel?: string;
}

export function DynamicInputForm({
  schema,
  onSubmit,
  initialValues = {},
  submitLabel = 'Submit',
}: DynamicInputFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setSubmitting(true);

    try {
      await onSubmit(values);
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const shouldShowField = (field: InputFieldDefinition): boolean => {
    if (!field.showIf) return true;

    const watchedValue = values[field.showIf.field];
    const { operator, value: expectedValue } = field.showIf;

    switch (operator) {
      case 'eq':
        return watchedValue === expectedValue;
      case 'ne':
        return watchedValue !== expectedValue;
      case 'gt':
        return typeof watchedValue === 'number' && typeof expectedValue === 'number'
          ? watchedValue > expectedValue
          : false;
      case 'lt':
        return typeof watchedValue === 'number' && typeof expectedValue === 'number'
          ? watchedValue < expectedValue
          : false;
      case 'gte':
        return typeof watchedValue === 'number' && typeof expectedValue === 'number'
          ? watchedValue >= expectedValue
          : false;
      case 'lte':
        return typeof watchedValue === 'number' && typeof expectedValue === 'number'
          ? watchedValue <= expectedValue
          : false;
      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(watchedValue);
      case 'notIn':
        return Array.isArray(expectedValue) && !expectedValue.includes(watchedValue);
      default:
        return true;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {schema.fields.map((field) => {
        if (!shouldShowField(field)) return null;

        return (
          <FormField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) => handleChange(field.name, value)}
            error={errors[field.name]}
          />
        );
      })}

      <div className="flex justify-end gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface FormFieldProps {
  field: InputFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

function FormField({ field, value, onChange, error }: FormFieldProps) {
  const renderInput = () => {
    switch (field.type) {
      case 'string':
      case 'email':
      case 'url':
        return (
          <Input
            id={field.name}
            type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        );

      case 'number':
      case 'integer':
        return (
          <Input
            id={field.name}
            type="number"
            value={(value as number) || ''}
            onChange={(e) =>
              onChange(field.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))
            }
            min={field.min}
            max={field.max}
            step={field.type === 'integer' ? 1 : 'any'}
            placeholder={field.placeholder}
            required={field.required}
          />
        );

      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.name}
              checked={(value as boolean) || false}
              onCheckedChange={(checked) => onChange(checked)}
            />
            <label
              htmlFor={field.name}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {field.label}
            </label>
          </div>
        );

      case 'textarea':
        return (
          <Textarea
            id={field.name}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            rows={5}
          />
        );

      case 'select':
        return (
          <Select value={(value as string) || ''} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'date':
      case 'datetime':
        return (
          <Input
            id={field.name}
            type={field.type === 'datetime' ? 'datetime-local' : 'date'}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        );

      case 'file':
        return <FileInput field={field} value={value as string} onChange={onChange} />;

      case 'json':
        return (
          <Textarea
            id={field.name}
            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onChange(parsed);
              } catch {
                onChange(e.target.value);
              }
            }}
            placeholder={field.placeholder || '{}'}
            required={field.required}
            rows={8}
            className="font-mono text-sm"
          />
        );

      default:
        return (
          <Input
            id={field.name}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        );
    }
  };

  // Boolean type renders checkbox inline with label
  if (field.type === 'boolean') {
    return (
      <div className="space-y-2">
        {renderInput()}
        {field.description && (
          <p className="text-sm text-muted-foreground">{field.description}</p>
        )}
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {field.description && (
        <p className="text-sm text-muted-foreground">{field.description}</p>
      )}
      {renderInput()}
      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

interface FileInputProps {
  field: InputFieldDefinition;
  value: string | undefined;
  onChange: (value: string) => void;
}

function FileInput({ field, value, onChange }: FileInputProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{
    uploadId: string;
    filename: string;
    size: number;
  } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size
    if (field.maxSize && file.size > field.maxSize) {
      alert(`File too large. Max size: ${formatBytes(field.maxSize)}`);
      return;
    }

    // Validate file type
    if (field.accept && !matchesAccept(file.type, field.accept)) {
      alert(`Invalid file type. Accepted: ${field.accept}`);
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload/temp', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const result = await response.json();

      setUploadedFile({
        uploadId: result.uploadId,
        filename: result.filename,
        size: result.size,
      });

      // Set the upload ID as the field value
      onChange(result.uploadId);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Input
        id={field.name}
        type="file"
        accept={field.accept}
        onChange={handleFileChange}
        disabled={uploading}
      />

      {uploading && <p className="text-sm text-muted-foreground">Uploading...</p>}

      {uploadedFile && (
        <div className="text-sm text-green-600">
          ✓ {uploadedFile.filename} ({formatBytes(uploadedFile.size)})
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function matchesAccept(mimeType: string, accept: string): boolean {
  const acceptTypes = accept.split(',').map((t) => t.trim());
  return acceptTypes.some((acceptType) => {
    if (acceptType.startsWith('.')) {
      // File extension
      return mimeType.toLowerCase().includes(acceptType.toLowerCase().substring(1));
    }
    if (acceptType.endsWith('/*')) {
      // Wildcard like image/*
      const baseType = acceptType.split('/')[0];
      return mimeType.startsWith(baseType);
    }
    // Exact MIME type
    return mimeType === acceptType;
  });
}
