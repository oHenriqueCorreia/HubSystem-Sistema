import { describe, expect, it } from "vitest";
import { addDays, filterAgenda, groupByDay, listDays, monthRange, sortAgenda, statusGroup, validRange, weekRange, type AgendaEntry } from "./agenda";

const entry = (over: Partial<AgendaEntry>): AgendaEntry => ({
  id: "1",
  source: "evento",
  type: "reuniao",
  title: "Reunião",
  start: "2026-11-10T13:00:00.000Z",
  end: "2026-11-10T14:00:00.000Z",
  allDay: false,
  ownerId: "u1",
  status: "agendado",
  statusLabel: "Agendado",
  description: null,
  clientId: null,
  clientName: null,
  leadId: null,
  leadName: null,
  location: null,
  meetUrl: null,
  taskId: null,
  boardId: null,
  boardName: null,
  listName: null,
  ...over,
});

describe("filtros da agenda", () => {
  it("esconde cancelados por padrão, mas mostra quando pedidos", () => {
    const list = [entry({ id: "a" }), entry({ id: "b", status: "cancelado" })];
    expect(filterAgenda(list, {}).map((e) => e.id)).toEqual(["a"]);
    expect(filterAgenda(list, { status: "cancelado" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("filtra por tipo, responsável e cliente", () => {
    const list = [entry({ id: "a", type: "prazo", ownerId: "u1", clientId: "c1" }), entry({ id: "b", type: "tarefa", ownerId: "u2", clientId: "c2" })];
    expect(filterAgenda(list, { type: "prazo" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterAgenda(list, { ownerIds: ["u2"] }).map((e) => e.id)).toEqual(["b"]);
    expect(filterAgenda(list, { clientId: "c1" }).map((e) => e.id)).toEqual(["a"]);
  });

  it("isola prioridades altas sem esconder compromissos de outros tipos na visão geral", () => {
    const list = [entry({ id: "urgente", source: "tarefa", type: "prazo", priority: "urgente" }), entry({ id: "alta", source: "tarefa", type: "tarefa", priority: "alta" }), entry({ id: "reuniao" })];
    expect(filterAgenda(list, {}).map((e) => e.id)).toEqual(["urgente", "alta", "reuniao"]);
    expect(filterAgenda(list, { priority: "urgente" }).map((e) => e.id)).toEqual(["urgente"]);
  });

  it("pesquisa ignora acento e olha também cliente e quadro", () => {
    const list = [entry({ id: "a", title: "Apresentação" }), entry({ id: "b", title: "Outra", clientName: "Padaria", boardName: "Produção" })];
    expect(filterAgenda(list, { q: "apresentacao" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterAgenda(list, { q: "padaria" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterAgenda(list, { q: "producao" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("agrupa situações diferentes", () => {
    expect(statusGroup({ status: "concluida" })).toBe("concluido");
    expect(statusGroup({ status: "publicado" })).toBe("concluido");
    expect(statusGroup({ status: "cancelada" })).toBe("cancelado");
    expect(statusGroup({ status: "em_andamento" })).toBe("aberto");
  });
});

describe("ordem e agrupamento", () => {
  it("coloca dia inteiro primeiro e horários em ordem", () => {
    const list = [entry({ id: "tarde", start: "2026-11-10T18:00:00Z" }), entry({ id: "cedo", start: "2026-11-10T12:00:00Z" }), entry({ id: "dia", allDay: true, start: "2026-11-10T20:00:00Z" })];
    expect(sortAgenda(list).map((e) => e.id)).toEqual(["dia", "cedo", "tarde"]);
  });

  it("usa o dia de São Paulo: 22h de lá ainda é o mesmo dia, mesmo já sendo o seguinte em UTC", () => {
    const groups = groupByDay([entry({ start: "2026-11-11T01:00:00.000Z", end: "2026-11-11T01:30:00.000Z" })]);
    expect([...groups.keys()]).toEqual(["2026-11-10"]);
  });

  it("item de vários dias aparece em cada dia, uma vez", () => {
    const groups = groupByDay([entry({ start: "2026-11-10T13:00:00Z", end: "2026-11-12T13:00:00Z" })]);
    expect([...groups.keys()]).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(groups.get("2026-11-11")).toHaveLength(1);
  });
});

describe("períodos", () => {
  it("semana vai de domingo a sábado", () => {
    expect(weekRange("2026-11-04")).toEqual({ from: "2026-11-01", to: "2026-11-07" });
  });

  it("grade do mês cobre semanas inteiras", () => {
    expect(monthRange("2026-11-15")).toEqual({ from: "2026-11-01", to: "2026-12-05" });
    expect(monthRange("2026-12-15")).toEqual({ from: "2026-11-29", to: "2027-01-02" });
  });

  it("soma dias atravessando o mês", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(listDays("2026-11-30", "2026-12-02")).toHaveLength(3);
  });

  it("recusa período invertido ou longo demais", () => {
    expect(validRange("2026-11-10", "2026-11-09")).toBe(false);
    expect(validRange("2026-01-01", "2026-12-31")).toBe(false);
    expect(validRange("2026-11-01", "2026-11-30")).toBe(true);
  });
});
