import { cn } from "@/lib/utils";

const THICKNESS = 10;
const GAP = 1.5;
const half = THICKNESS / 2;
const [left, right] = [half, 56 - half];
const [top, middle, bottom] = [half, 50, 100 - half];

function horizontal(y: number) {
  const [a, b] = [left + GAP, right - GAP];
  return `${a},${y} ${a + half},${y - half} ${b - half},${y - half} ${b},${y} ${b - half},${y + half} ${a + half},${y + half}`;
}

function vertical(x: number, from: number, to: number) {
  const [a, b] = [from + GAP, to - GAP];
  return `${x},${a} ${x + half},${a + half} ${x + half},${b - half} ${x},${b} ${x - half},${b - half} ${x - half},${a + half}`;
}

const SEGMENTS = {
  a: horizontal(top),
  b: vertical(right, top, middle),
  c: vertical(right, middle, bottom),
  d: horizontal(bottom),
  e: vertical(left, middle, bottom),
  f: vertical(left, top, middle),
  g: horizontal(middle),
};
type Segment = keyof typeof SEGMENTS;

const DIGITS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

/** Um dígito de mostrador de LED: os segmentos apagados continuam levemente visíveis. */
export function SegmentDigit({ value, className }: { value: string; className?: string }) {
  const lit = DIGITS[value] ?? "";
  return (
    <svg viewBox="0 0 56 100" data-digit={value} className={cn("aspect-[56/100] w-auto", className)} aria-hidden="true">
      {(Object.keys(SEGMENTS) as Segment[]).map((s) => (
        <polygon key={s} points={SEGMENTS[s]} className={lit.includes(s) ? "fill-clock-lit" : "fill-clock-ghost"} />
      ))}
    </svg>
  );
}
