import csv
import io
import json
from pathlib import Path
import tempfile
import subprocess
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

import bridge


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = bridge.Runtime({"project": self.temp.name, "origins": ["https://hub.example"]})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.handler_for(self.runtime))
        self.port_patch = patch.object(bridge, "PORT", self.server.server_port)
        self.port_patch.start()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.port_patch.stop()
        self.temp.cleanup()

    def request(self, path, method="GET", headers=None, body=None):
        req = Request(f"http://127.0.0.1:{self.server.server_port}" + path, method=method,
                      headers=headers if headers is not None else {"Origin": "https://hub.example", "X-Hub-Bridge": "1"},
                      data=None if body is None else json.dumps(body).encode())
        try:
            return urlopen(req, timeout=3)
        except HTTPError as error:
            return error

    def test_origin_header_and_host_required(self):
        for headers in ({}, {"Origin": "https://evil.example", "X-Hub-Bridge": "1"},
                        {"Origin": "https://hub.example"},
                        {"Origin": "https://hub.example", "X-Hub-Bridge": "1", "Host": "evil.example"}):
            with self.request("/status", headers=headers) as response:
                self.assertEqual(response.status, 403)

    def test_cors_preflight(self):
        with self.request("/buscas", "OPTIONS", {"Origin": "https://hub.example"}) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://hub.example")
        with self.request("/start", "OPTIONS", {"Origin": "https://evil.example"}) as response:
            self.assertEqual(response.status, 403)
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_no_arbitrary_proxy_or_command(self):
        with patch.object(self.runtime, "command") as command:
            with self.request("/exec?cmd=anything", "POST") as response:
                self.assertEqual(response.status, 404)
            command.assert_not_called()

    def test_stop_refuses_active_or_unavailable_queue(self):
        with patch.object(bridge, "local_request", return_value=[{"estado": "rodando"}]), patch.object(self.runtime, "compose") as compose:
            with self.request("/stop", "POST") as response:
                self.assertEqual(response.status, 400)
            compose.assert_not_called()
        with patch.object(bridge, "local_request", side_effect=OSError("offline")), patch.object(self.runtime, "compose") as compose:
            with self.request("/stop", "POST") as response:
                self.assertEqual(response.status, 503)
            compose.assert_not_called()

    def test_export_only_completed_search_and_its_leads(self):
        bid = "a" * 32
        with patch.object(bridge, "local_request", side_effect=[{"estado": "concluida", "lead_ids": ["one"]},
                         [{"id": "one", "nome": "Empresa correta"}, {"id": "two", "nome": "Outra busca"}] ]):
            with self.request(f"/buscas/{bid}/csv") as response:
                self.assertEqual(response.status, 200)
                text = response.read().decode("utf-8-sig")
                self.assertIn("Empresa correta", text)
                self.assertNotIn("Outra busca", text)
        with patch.object(bridge, "local_request", return_value={"estado": "rodando"}):
            with self.request(f"/buscas/{bid}/csv") as response:
                self.assertEqual(response.status, 400)

    def test_search_validation_and_payload(self):
        with patch.object(bridge, "local_request") as local:
            with self.request("/buscas", "POST", body={"nichos": "dentistas", "cidade": "São Paulo", "uf": "XX"}) as response:
                self.assertEqual(response.status, 400)
            local.assert_not_called()
        payload = {"nichos": "dentistas", "cidade": "São Paulo", "uf": "SP", "tamanho": "padrao", "command": "ignored"}
        with patch.object(self.runtime, "status", return_value={"motor": True}), patch.object(bridge, "local_request", return_value={"id": "a"}) as local:
            with self.request("/buscas", "POST", body=payload) as response:
                self.assertEqual(response.status, 201)
            self.assertNotIn("command", local.call_args.args[1])

    def test_docker_timeout_is_not_fatal_during_boot(self):
        self.runtime.config["docker"] = "docker"
        with patch.object(self.runtime, "command", side_effect=subprocess.TimeoutExpired("docker", 15)):
            self.assertFalse(self.runtime.docker_ready())

    def test_search_cannot_race_start_or_stop(self):
        self.runtime.guard.acquire()
        try:
            with patch.object(bridge, "local_request") as local:
                with self.assertRaises(ValueError):
                    self.runtime.create_search({})
                local.assert_not_called()
        finally:
            self.runtime.guard.release()

    def test_only_one_connector_can_listen(self):
        first = bridge.BridgeServer(("127.0.0.1", 0), bridge.handler_for(self.runtime))
        try:
            with self.assertRaises(OSError):
                bridge.BridgeServer(("127.0.0.1", first.server_port), bridge.handler_for(self.runtime))
        finally:
            first.server_close()

    def test_error_clears_when_collector_is_running(self):
        self.runtime.state, self.runtime.error = "erro", "Docker não iniciou"
        with patch.object(bridge, "local_request", return_value={"motor": False}):
            self.assertEqual(self.runtime.status()["error"], "Docker não iniciou")
        with patch.object(bridge, "local_request", return_value={"motor": True}):
            status = self.runtime.status()
        self.assertEqual((status["state"], status["error"]), ("pronto", None))

    def test_cancel_and_repeat_only_for_known_actions(self):
        bid = "a" * 32
        with patch.object(self.runtime, "status", return_value={"motor": True}), patch.object(bridge, "local_request", return_value={"id": bid}) as local:
            with self.request(f"/buscas/{bid}/cancelar", "POST", body={}) as response:
                self.assertEqual(response.status, 200)
            local.assert_called_once_with(f"/api/buscas/{bid}/cancelar", {})
            local.reset_mock()
            with self.request(f"/buscas/{bid}/apagar", "POST", body={}) as response:
                self.assertEqual(response.status, 404)
            with self.request("/buscas/../leads/cancelar", "POST", body={}) as response:
                self.assertEqual(response.status, 404)
            local.assert_not_called()

    def test_repeat_needs_collector(self):
        with patch.object(self.runtime, "status", return_value={"motor": False}), patch.object(bridge, "local_request") as local:
            with self.request(f"/buscas/{'a' * 32}/repetir", "POST", body={}) as response:
                self.assertEqual(response.status, 400)
            local.assert_not_called()

    def test_export_keeps_identity_decimal_emails_and_notes(self):
        raw = bridge.export_csv([{"id": "ChIJexample", "nome": 'Empresa; "Teste"', "nota": 4.8,
                                  "email": "a@example.com, b@example.com", "obs": "Nota original\nOutra linha"}])
        row = next(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"))
        self.assertEqual(row["place_id"], "ChIJexample")
        self.assertEqual(row["Nota"], "4,8")
        self.assertEqual(row["Empresa"], 'Empresa; "Teste"')
        self.assertEqual(row["E-mail"], "a@example.com")
        self.assertIn("b@example.com", row["Anotações"])
        self.assertIn("Nota original\nOutra linha", row["Anotações"])


if __name__ == "__main__":
    unittest.main()
