"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeVisibility, type ResourceVisibility } from "@/lib/visibility";

const FILE_VISIBILITY_OPTIONS: {
  readonly value: ResourceVisibility;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "private", label: "Private", hint: "Only you and your sessions" },
  { value: "public", label: "Public", hint: "Anyone with the link can view it" },
];

export function FileVisibilitySelect({
  disabled,
  id,
  value,
  onChange,
}: {
  readonly disabled?: boolean;
  readonly id: string;
  readonly value: ResourceVisibility;
  readonly onChange: (next: ResourceVisibility) => void;
}) {
  return (
    <Select
      disabled={disabled}
      value={normalizeVisibility(value)}
      onValueChange={(next) => {
        const parsed = FILE_VISIBILITY_OPTIONS.find((option) => option.value === next)?.value;
        if (parsed) onChange(parsed);
      }}
    >
      <SelectTrigger
        aria-label="Who can access this file"
        className="h-7 min-h-7 w-[7.5rem] px-2 text-xs"
        id={id}
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {FILE_VISIBILITY_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            description={
              <span className="text-muted-foreground text-xs">{option.hint}</span>
            }
            textValue={option.label}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function visibilityBadgeLabel(visibility: ResourceVisibility): string | null {
  const value = normalizeVisibility(visibility);
  return value === "public" ? "Public" : null;
}
