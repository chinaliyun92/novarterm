export function toNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return Number(value);
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toNumber(value);
}

export function toStringValue(value: unknown): string {
  return String(value);
}

export function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

export function toBooleanFromInt(value: unknown): boolean {
  return toNumber(value) === 1;
}
