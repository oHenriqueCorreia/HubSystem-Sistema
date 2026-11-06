import { describe, expect, it } from "vitest";
import { effectivePermission, effectivePermissions, hasScope } from "./index";

describe("effectivePermission (espelho de private.perm_scope)", () => {
  it("segue o papel sem exceção", () => {
    expect(effectivePermission("own", undefined)).toEqual({ scope: "own", origin: "papel" });
  });
  it("sem papel nem exceção, não tem acesso", () => {
    expect(effectivePermission(undefined, undefined)).toEqual({ scope: null, origin: null });
  });
  it("negar anula o papel", () => {
    expect(effectivePermission("all", { effect: "deny", scope: "all" })).toEqual({ scope: null, origin: "bloqueio" });
  });
  it("conceder amplia quando é maior que o papel", () => {
    expect(effectivePermission("own", { effect: "grant", scope: "all" })).toEqual({ scope: "all", origin: "excecao" });
  });
  it("conceder menor que o papel não reduz (vale o maior)", () => {
    expect(effectivePermission("all", { effect: "grant", scope: "own" })).toEqual({ scope: "all", origin: "papel" });
  });
  it("conceder sem papel vem da exceção", () => {
    expect(effectivePermission(undefined, { effect: "grant", scope: "team" })).toEqual({ scope: "team", origin: "excecao" });
  });
  it("monta o mapa só com o que está liberado", () => {
    expect(effectivePermissions({ "tasks.read": "own", "admin.users": "all" }, { "admin.users": { effect: "deny", scope: "all" }, "ads.read": { effect: "grant", scope: "own" } })).toEqual({
      "tasks.read": "own",
      "ads.read": "own",
    });
  });
});

describe("hasScope", () => {
  it("permissões de módulo com escopo", () => {
    for (const k of ["tasks.read", "content.manage", "ads.read", "inbox.reply", "clients.read", "contracts.update"]) expect(hasScope(k)).toBe(true);
  });
  it("permissões liga/desliga, inclusive as de campo", () => {
    for (const k of ["contracts.values", "clients.billing", "admin.users", "inbox.manage", "finance.company.read"]) expect(hasScope(k)).toBe(false);
  });
});
