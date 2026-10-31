"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { parseBRL } from "@/domain/shared/money";

function toText(cents: number | null | undefined) {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Campo de valor em reais: aceita "1.234,56", "1234.56", "R$ 10"; devolve centavos. */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & { value: number | null | undefined; onChange: (cents: number | null) => void }) {
  const [text, setText] = useState(() => toText(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (parseBRL(text) !== value) setText(toText(value));
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
        R$
      </span>
      <Input
        {...props}
        inputMode="decimal"
        className="pl-9 text-right tabular"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const cents = e.target.value.trim() ? parseBRL(e.target.value) : null;
          setLast(cents);
          onChange(cents);
        }}
        onBlur={(e) => {
          const cents = parseBRL(text);
          if (cents != null) setText(toText(cents));
          props.onBlur?.(e);
        }}
      />
    </div>
  );
}
