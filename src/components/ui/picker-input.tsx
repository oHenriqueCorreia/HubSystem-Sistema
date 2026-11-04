"use client"

import * as React from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react"
import { cn } from "cn"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type PickerKind = "time" | "date" | "datetime-local"
type Kind = PickerKind

const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5))
const monthTitle = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
// 2 de janeiro de 2022 foi um domingo: a grade começa no domingo, como no calendário brasileiro.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat("pt-BR", { weekday: "narrow" }).format(new Date(2022, 0, 2 + i)))
const weekdayName = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" })

function parts(kind: Kind, value: string) {
  if (kind === "time") return { date: "", time: value.slice(0, 5) }
  if (kind === "date") return { date: value, time: "" }
  const [date = "", time = ""] = value.split("T")
  return { date, time: time.slice(0, 5) }
}

function join(kind: Kind, date: string, time: string) {
  if (kind === "time") return time
  if (kind === "date") return date
  return date && time ? `${date}T${time}` : ""
}

/** Escreve como se a pessoa tivesse digitado: formulários controlados e com register recebem igual. */
function writeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function TimeColumn({ label, options, selected, onPick }: { label: string; options: string[]; selected?: string; onPick: (v: string) => void }) {
  const list = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && list.current) list.current.scrollTop = el.offsetTop - list.current.offsetTop - 72
  }, [])
  return (
    <div className="grid gap-1">
      <p className="text-center text-xs text-muted-foreground">{label}</p>
      <div ref={list} role="group" aria-label={label} className="relative grid h-48 w-14 auto-rows-max gap-0.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={o === selected}
            aria-label={`${o} ${label.toLowerCase()}`}
            onClick={() => onPick(o)}
            className={cn("h-8 rounded-lg text-sm tabular transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", o === selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary")}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

function Calendar({ selected, min, max, onPick }: { selected: string; min?: string; max?: string; onPick: (date: string) => void }) {
  const today = iso(new Date())
  const start = selected || today
  const [view, setView] = React.useState(() => new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1))
  const first = new Date(view.getFullYear(), view.getMonth(), 1 - view.getDay())
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  const move = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1))
  const title = monthTitle.format(view)
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => move(-1)} className="grid size-8 place-items-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <p aria-live="polite" className="text-sm font-medium first-letter:uppercase">
          {title}
        </p>
        <button type="button" aria-label="Próximo mês" onClick={() => move(1)} className="grid size-8 place-items-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((d, i) => (
          <span key={i} aria-hidden="true" className="grid h-7 place-items-center text-xs text-muted-foreground uppercase">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const value = iso(d)
          const outside = d.getMonth() !== view.getMonth()
          const blocked = Boolean((min && value < min) || (max && value > max))
          return (
            <button
              key={value}
              type="button"
              disabled={blocked}
              aria-pressed={value === selected}
              aria-label={weekdayName.format(d)}
              onClick={() => onPick(value)}
              className={cn(
                "grid size-8 place-items-center rounded-lg text-sm tabular transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
                outside && "text-muted-foreground/60",
                value === today && "font-semibold text-primary ring-1 ring-primary/40",
                value === selected && "bg-primary font-semibold text-primary-foreground ring-0 hover:bg-primary",
              )}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Panel({ kind, initial, min, max, required, onChange, onClose }: { kind: Kind; initial: string; min?: string; max?: string; required?: boolean; onChange: (value: string) => void; onClose: () => void }) {
  const start = parts(kind, initial)
  const [date, setDate] = React.useState(start.date)
  const [time, setTime] = React.useState(start.time)
  const hour = time.slice(0, 2)
  const minute = time.slice(3, 5)
  const minutes = minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES

  function commit(nextDate: string, nextTime: string) {
    // Data e hora juntas: escolher uma completa a outra, para o campo nunca ficar pela metade.
    const d = kind === "datetime-local" && !nextDate && nextTime ? iso(new Date()) : nextDate
    const t = kind === "datetime-local" && nextDate && !nextTime ? "09:00" : nextTime
    setDate(d)
    setTime(t)
    onChange(join(kind, d, t))
  }

  const now = new Date()
  const shortcut = kind === "time" ? "Agora" : "Hoje"
  return (
    <div className="grid gap-3">
      <div className="flex gap-4">
        {kind !== "time" && (
          <Calendar
            selected={date}
            min={min}
            max={max}
            onPick={(d) => {
              commit(d, time)
              if (kind === "date") onClose()
            }}
          />
        )}
        {kind !== "date" && (
          <div className="grid content-start gap-2">
            <p aria-live="polite" className="text-center text-2xl font-semibold tabular">
              {hour || "--"}:{minute || "--"}
            </p>
            <div className="flex gap-1">
              <TimeColumn label="Hora" options={HOURS} selected={hour} onPick={(h) => commit(date, `${h}:${minute || "00"}`)} />
              <TimeColumn label="Minutos" options={minutes} selected={minute} onPick={(m) => commit(date, `${hour || pad(now.getHours())}:${m}`)} />
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              commit(kind === "time" ? date : iso(now), kind === "date" ? time : `${pad(now.getHours())}:${pad(now.getMinutes())}`)
              if (kind === "date") onClose()
            }}
            className="h-8 rounded-lg px-2 text-sm font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {shortcut}
          </button>
          {!required && (date || time) && (
            <button
              type="button"
              onClick={() => {
                setDate("")
                setTime("")
                onChange("")
                onClose()
              }}
              className="h-8 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Limpar
            </button>
          )}
        </div>
        {kind !== "date" && (
          <button type="button" onClick={onClose} className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
            Concluir
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Data e hora com o visual do sistema, nas cores do tema. O campo continua sendo o nativo:
 * dá para digitar, e formulários e validações funcionam como sempre. Só a janela de escolha
 * é nossa. No celular fica a roleta do próprio aparelho, que é a mais fácil de usar com o dedo.
 */
export function PickerInput({ className, inputClassName, type, ref, min, max, onClick, ...props }: React.ComponentProps<"input"> & { type: Kind; inputClassName: string }) {
  const inner = React.useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [initial, setInitial] = React.useState("")
  const label = type === "time" ? "Escolher horário" : type === "date" ? "Escolher data" : "Escolher data e horário"
  const Icon = type === "time" ? Clock : CalendarDays

  const setRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      inner.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
  const write = React.useCallback((value: string) => {
    if (inner.current) writeValue(inner.current, value)
  }, [])
  const toggle = (next: boolean) => {
    // A janela abre com o que está no campo agora, digitado ou não.
    if (next) setInitial(inner.current?.value ?? "")
    setOpen(next)
  }

  return (
    <div className={cn("relative w-full min-w-0", className)}>
      <input
        {...props}
        ref={setRef}
        type={type}
        min={min}
        max={max}
        data-slot="input"
        data-picker=""
        // Alguns navegadores abrem a janela própria ao clicar no campo: aqui ele serve para digitar.
        onClick={(e) => {
          if (window.matchMedia("(pointer: fine)").matches) e.preventDefault()
          onClick?.(e)
        }}
        className={cn(inputClassName, "pointer-fine:pr-8")}
      />
      <Popover open={open} onOpenChange={toggle} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            disabled={props.disabled}
            className="absolute inset-y-0 right-0 hidden w-8 place-items-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-primary disabled:pointer-events-none disabled:opacity-50 pointer-fine:grid"
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={label} className="w-auto rounded-xl p-3">
          {open && <Panel kind={type} initial={initial} min={typeof min === "string" ? min : undefined} max={typeof max === "string" ? max : undefined} required={props.required} onChange={write} onClose={() => setOpen(false)} />}
        </PopoverContent>
      </Popover>
    </div>
  )
}
