'use client';

import * as React from 'react';

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Select({ value, onValueChange, children, disabled }: SelectProps) {
  return (
    <div className="relative">
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            value,
            onValueChange,
            disabled,
          });
        }
        return child;
      })}
    </div>
  );
}

interface SelectTriggerProps {
  children: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

export function SelectTrigger({
  children,
  value,
  onValueChange,
  disabled,
}: SelectTriggerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
        <svg
          className="h-4 w-4 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <SelectContentPortal
          value={value}
          onValueChange={(val) => {
            onValueChange?.(val);
            setIsOpen(false);
          }}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span>{placeholder || 'Select...'}</span>;
}

interface SelectContentPortalProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onClose: () => void;
}

function SelectContentPortal({ onClose }: SelectContentPortalProps) {
  React.useEffect(() => {
    const handleClickOutside = () => onClose();
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [onClose]);

  return null; // Simplified - will be rendered by children
}

interface SelectContentProps {
  children: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function SelectContent({ children, value, onValueChange }: SelectContentProps) {
  return (
    <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            isSelected: child.props.value === value,
            onSelect: () => onValueChange?.(child.props.value),
          });
        }
        return child;
      })}
    </div>
  );
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function SelectItem({ value, children, isSelected, onSelect }: SelectItemProps) {
  return (
    <div
      onClick={onSelect}
      className={`relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${
        isSelected ? 'bg-accent' : ''
      }`}
    >
      {children}
    </div>
  );
}
