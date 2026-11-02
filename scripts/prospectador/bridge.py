"""Conector local HubSystem. Biblioteca padrão; nunca recebe comandos do navegador."""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

PORT = 8091
PANEL = "http://127.0.0.1:8090"
MAX_RESPONSE = 20 * 1024 * 1024


def local_request(path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(PANEL + path, data=body, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=8) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Base local muito grande. Divida as buscas.")
    return json.loads(raw)


def export_csv(leads):
    fields = {"Empresa": "nome", "place_id": "id", "Categoria": "categoria",
              "Telefone": "telefone", "Tipo de telefone": "tel_tipo", "WhatsApp": "whatsapp",
              "E-mail": "email", "Site": "site", "Instagram": "instagram", "Facebook": "facebook",
              "LinkedIn": "linkedin", "Endereço": "endereco", "Bairro": "bairro", "Cidade": "cidade",
              "UF": "uf", "CEP": "cep", "Nota": "nota", "Avaliações": "avaliacoes",
              "Google Maps": "maps", "Anotações": "obs"}
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=fields, delimiter=";")
    writer.writeheader()
    for lead in leads:
        row = {label: lead.get(key, "") for label, key in fields.items()}
        # O importador usa números brasileiros; preserve 4.8 como 4,8.
        row["Nota"] = str(row["Nota"] or "").replace(".", ",")
        emails = re.split(r"[,;\s]+", str(row["E-mail"] or ""))
        row["E-mail"] = next((e for e in emails if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e)), "")
        if len([e for e in emails if e]) > 1:
            row["Anotações"] = (str(row["Anotações"] or "") + "\nE-mails encontrados: " + str(lead.get("email", ""))).strip()
        writer.writerow(row)
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


class Runtime:
    def __init__(self, config):
        self.config = config
        self.project = Path(config["project"]).resolve(strict=True)
        self.guard = threading.Lock()
        self.state = "parado"
        self.stage = None
        self.error = None
        self.panel_process = None

    def command(self, args, timeout=30):
        return subprocess.run(args, cwd=self.project, capture_output=True, text=True,
                              timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def compose(self, *args):
        executable = [self.config["compose"]] if self.config.get("compose") else [self.config["docker"], "compose"]
        result = self.command([*executable, "-f", str(self.project / "docker-compose.yml"),
                               "-f", str(Path(__file__).with_name("compose.hub.yml")), *args], timeout=180)
        if result.returncode:
            raise RuntimeError("Falha no Docker Compose: " + (result.stderr or result.stdout)[-1500:])

    def docker_ready(self):
        try:
            return self.command([self.config["docker"], "version", "--format", "{{.Server.Version}}"], timeout=15).returncode == 0
        except subprocess.TimeoutExpired:
            # Docker Desktop pode aceitar a conexão antes de o engine estar pronto.
            return False

    def start(self):
        if not self.guard.acquire(blocking=False):
            return
        self.state, self.stage, self.error = "iniciando", "docker", None
        threading.Thread(target=self._start, daemon=True).start()

    def _start(self):
        try:
            if not self.docker_ready():
                startup = subprocess.STARTUPINFO() if os.name == "nt" else None
                if startup:
                    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    startup.wShowWindow = 0
                subprocess.Popen([self.config["dockerDesktop"]], startupinfo=startup,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 180
            while not self.docker_ready():
                if time.monotonic() > deadline:
                    raise RuntimeError("Docker não iniciou em 3 minutos. Abra o Docker Desktop e confira o WSL.")
                time.sleep(3)
            self.stage = "coletor"
            for attempt in range(3):
                try:
                    self.compose("up", "-d", "google-maps-scraper")
                    break
                except RuntimeError:
                    # O engine pode responder à versão antes de aceitar containers.
                    if attempt == 2:
                        raise
                    time.sleep(5)
            self.stage = "painel"
            try:
                local_request("/api/buscas")
            except Exception:
                env = {**os.environ, "PAINEL_PORT": "8090", "SCRAPER_BASE_URL": self.config["scraperUrl"]}
                self.panel_process = subprocess.Popen(
                    [sys.executable, str(self.project / "painel" / "server.py"), "--sem-navegador"],
                    cwd=self.project, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try:
                    if local_request("/api/status").get("motor"):
                        self.state = "pronto"
                        return
                except Exception:
                    pass
                time.sleep(2)
            raise RuntimeError("Painel ou motor não respondeu. Confira as portas 8080 e 8090 e os logs do Docker.")
        except Exception as exc:
            self.state, self.error = "erro", str(exc)
        finally:
            self.stage = None
            self.guard.release()

    def stop(self):
        if not self.guard.acquire(blocking=False):
            raise ValueError("Aguarde a operação atual terminar.")
        try:
            # Falhar fechado: não parar o coletor se não for possível verificar a fila.
            jobs = local_request("/api/buscas")
            if any(b.get("estado") in ("na_fila", "rodando") for b in jobs):
                raise ValueError("Há buscas em andamento. Aguarde ou cancele pelo painel local.")
            self.state = "parando"
            try:
                self.compose("stop", "google-maps-scraper")
            except Exception:
                self.state = "pronto"
                raise
            self.state, self.error = "parado", None
        finally:
            self.guard.release()

    def create_search(self, payload):
        if not self.guard.acquire(blocking=False):
            raise ValueError("Aguarde o coletor terminar de ligar ou parar.")
        try:
            if not self.status()["motor"]:
                raise ValueError("Ligue o coletor antes de iniciar uma busca.")
            return local_request("/api/buscas", payload)
        finally:
            self.guard.release()

    def status(self):
        panel, motor = False, False
        try:
            value = local_request("/api/status")
            panel, motor = True, bool(value.get("motor"))
        except Exception:
            pass
        if self.state in ("iniciando", "parando"):
            state = self.state
        elif motor:
            state = "pronto"
        else:
            state = "erro" if self.state == "erro" else "parado"
        return {"service": "hubsystem-prospectador", "version": 2, "state": state, "stage": self.stage,
                "panel": panel, "motor": motor, "error": self.error if state == "erro" else None}

    def search_action(self, search_id, action):
        if action == "repetir" and not self.status()["motor"]:
            raise ValueError("Ligue o coletor antes de repetir a busca.")
        return local_request(f"/api/buscas/{search_id}/{action}", {})


class BridgeServer(ThreadingHTTPServer):
    # No Windows, SO_REUSEADDR deixaria dois conectores escutando a mesma porta.
    allow_reuse_address = False


def handler_for(runtime):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Não registrar leads, parâmetros ou origens em arquivos.

        def allowed(self, preflight=False):
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin", "")
            return (host in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")
                    and origin in runtime.config["origins"]
                    and (preflight or self.headers.get("X-Hub-Bridge") == "1"))

        def send(self, code, value, content_type="application/json; charset=utf-8"):
            body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            if self.allowed(preflight=True):
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Hub-Bridge")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send(204 if self.allowed(preflight=True) else 403, b"")

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch()

        def dispatch(self):
            if not self.allowed():
                return self.send(403, {"error": "Origem ou cabeçalho não autorizado."})
            try:
                if self.command == "GET" and self.path == "/status":
                    return self.send(200, runtime.status())
                if self.command == "POST" and self.path == "/start":
                    runtime.start()
                    return self.send(202, {"ok": True})
                if self.command == "POST" and self.path == "/stop":
                    runtime.stop()
                    return self.send(200, {"ok": True})
                if self.path == "/buscas":
                    if self.command == "GET":
                        return self.send(200, local_request("/api/buscas"))
                    n = int(self.headers.get("Content-Length", "0"))
                    if not 0 < n <= 4096:
                        raise ValueError("Requisição inválida ou muito grande.")
                    data = json.loads(self.rfile.read(n))
                    if not isinstance(data, dict):
                        raise ValueError("Busca inválida.")
                    for key in ("nichos", "cidade", "uf", "bairro", "tamanho"):
                        if not isinstance(data.get(key, ""), str) or len(data.get(key, "")) > 300:
                            raise ValueError("Campos da busca inválidos.")
                    if not data.get("nichos", "").strip() or not data.get("cidade", "").strip():
                        raise ValueError("Informe nicho e cidade.")
                    if data.get("uf") not in "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split():
                        raise ValueError("UF inválida.")
                    if data.get("tamanho") not in ("rapida", "padrao", "completa", "cidade"):
                        raise ValueError("Tamanho de busca inválido.")
                    payload = {k: data.get(k, "") for k in ("nichos", "cidade", "uf", "bairro", "tamanho")}
                    payload["redes"] = True
                    return self.send(201, runtime.create_search(payload))
                if self.command == "GET" and self.path == "/municipios":
                    return self.send(200, local_request("/api/municipios"))
                action = re.fullmatch(r"/buscas/([a-f0-9]{32})/(cancelar|repetir)", self.path)
                if self.command == "POST" and action:
                    return self.send(200, runtime.search_action(action[1], action[2]))
                match = re.fullmatch(r"/buscas/([a-f0-9]{32})/csv", self.path)
                if self.command == "GET" and match:
                    job = local_request("/api/buscas/" + match[1])
                    if job.get("estado") != "concluida":
                        raise ValueError("Aguarde a conclusão da busca antes de importar.")
                    ids = set(job.get("lead_ids", []))
                    rows = [lead for lead in local_request("/api/leads") if lead["id"] in ids]
                    return self.send(200, export_csv(rows), "text/csv; charset=utf-8")
                self.send(404, {"error": "Rota não encontrada."})
            except (ValueError, json.JSONDecodeError) as exc:
                self.send(400, {"error": str(exc)})
            except Exception as exc:
                self.send(503, {"error": "Não foi possível acessar o prospectador: " + str(exc)})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--launch", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    runtime = Runtime(config)
    try:
        server = BridgeServer(("127.0.0.1", PORT), handler_for(runtime))
    except OSError:
        if args.launch:
            req = Request(f"http://127.0.0.1:{PORT}/start", data=b"{}",
                          headers={"Origin": config["origins"][0], "X-Hub-Bridge": "1"})
            with urlopen(req, timeout=10):
                pass
        return
    if args.launch:
        runtime.start()
    server.serve_forever()


if __name__ == "__main__":
    main()
