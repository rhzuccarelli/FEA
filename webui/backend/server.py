"""FastAPI server exposing code_aster studies to the web UI."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import case

ROOT = Path(__file__).resolve().parent.parent
RUNS = Path(os.environ.get("FEA_RUNS_DIR", ROOT / "runs"))


def _default_run_aster() -> str:
    """Use the install made by scripts/install_code_aster.* if present, else run_aster on PATH."""
    candidates = [
        Path.home() / "fea-aster" / "root" / "envs" / "aster" / "Library" / "bin" / "run_aster.bat",
        ROOT / ".aster" / "root" / "envs" / "aster" / "bin" / "run_aster",
    ]
    return next((str(c) for c in candidates if c.is_file()), "run_aster")


RUN_ASTER = os.environ.get("CODE_ASTER_RUN") or _default_run_aster()


def _aster_env() -> dict:
    env = dict(os.environ)
    if sys.platform == "win32":
        # run_aster.bat locates its own install only when no conda env is active.
        env.pop("CONDA_PREFIX", None)
    return env
STUDY = "study"
DOWNLOADS = {"comm": f"{STUDY}.comm", "mail": f"{STUDY}.mail", "rmed": f"{STUDY}.rmed",
             "mess": f"{STUDY}.mess", "log": "run.log"}

app = FastAPI(title="FEA web UI for code_aster")
jobs: dict[str, dict] = {}
lock = threading.Lock()


class StudyRequest(BaseModel):
    study: dict
    comm: str | None = None  # optional user-edited command file


def aster_version() -> str | None:
    exe = shutil.which(RUN_ASTER) or (RUN_ASTER if Path(RUN_ASTER).is_file() else None)
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=120,
                             env=_aster_env(), encoding="utf-8", errors="replace")
        return (out.stdout + out.stderr).strip().splitlines()[-1]
    except (OSError, subprocess.TimeoutExpired):
        return None


VERSION = None


@app.on_event("startup")
def _startup():
    global VERSION
    RUNS.mkdir(parents=True, exist_ok=True)
    VERSION = aster_version()


def _validate(study: dict) -> dict:
    try:
        return case.validate(study)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))


def _mesh_payload(geo: dict) -> tuple[case.BlockMesh, dict]:
    mesh = case.BlockMesh.build(geo["lx"], geo["ly"], geo["lz"], geo["nx"], geo["ny"], geo["nz"])
    payload = {
        "nodes": [c for xyz in mesh.nodes for c in xyz],
        "triangles": mesh.surface_triangles(),
        "edges": mesh.edges(),
        "n_nodes": len(mesh.nodes),
        "n_elements": len(mesh.hexas),
    }
    return mesh, payload


@app.get("/api/status")
def status():
    return {"code_aster": VERSION, "run_aster": RUN_ASTER}


@app.post("/api/preview")
def preview(req: StudyRequest):
    study = _validate(req.study)
    _, mesh = _mesh_payload(study["geometry"])
    return {"study": study, "mesh": mesh, "comm": case.build_comm(study)}


@app.post("/api/jobs")
def submit(req: StudyRequest):
    if VERSION is None:
        raise HTTPException(503, f"code_aster not found (looked for '{RUN_ASTER}'); set CODE_ASTER_RUN")
    study = _validate(req.study)
    job_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    work = RUNS / job_id
    work.mkdir(parents=True)
    mesh, _ = _mesh_payload(study["geometry"])
    (work / f"{STUDY}.mail").write_text(mesh.to_aster(), encoding="utf-8")
    (work / f"{STUDY}.comm").write_text(req.comm if req.comm else case.build_comm(study), encoding="utf-8")
    (work / f"{STUDY}.export").write_text(case.build_export(STUDY), encoding="utf-8")
    (work / "study.json").write_text(json.dumps(study, indent=2), encoding="utf-8")
    job = {"id": job_id, "status": "queued", "created": time.time(), "analysis": study["analysis"]["type"],
           "custom_comm": bool(req.comm), "elapsed": None}
    with lock:
        jobs[job_id] = job
    threading.Thread(target=_run, args=(job_id, work), daemon=True).start()
    return job


def _run(job_id: str, work: Path):
    jobs[job_id]["status"] = "running"
    start = time.time()
    with open(work / "run.log", "w", encoding="utf-8") as log:
        try:
            proc = subprocess.run([RUN_ASTER, f"{STUDY}.export"], cwd=work, stdout=log,
                                  stderr=subprocess.STDOUT, timeout=1200, env=_aster_env())
            ok = proc.returncode == 0 and (work / "fields.json").exists()
        except subprocess.TimeoutExpired:
            log.write("\n*** Job killed: time limit exceeded ***\n")
            ok = False
    jobs[job_id]["elapsed"] = round(time.time() - start, 2)
    jobs[job_id]["status"] = "done" if ok else "failed"


def _summary(study: dict, fields: dict) -> dict:
    if fields["type"] == "static":
        dx, dy, dz = fields["displacement"]
        mag = [math.sqrt(a * a + b * b + c * c) for a, b, c in zip(dx, dy, dz)]
        imax = max(range(len(mag)), key=mag.__getitem__)
        return {"max_displacement": mag[imax], "max_displacement_node": imax,
                "max_von_mises": max(fields["von_mises"]), "reaction": fields["reaction"]}
    return {"frequencies": [m["frequency"] for m in fields["modes"]]}


@app.get("/api/jobs")
def list_jobs():
    return sorted(jobs.values(), key=lambda j: j["created"], reverse=True)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, log_lines: int = 400):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    work = RUNS / job_id
    out = dict(job)
    log = work / "run.log"
    if log.exists():
        out["log"] = "".join(log.read_text(encoding="utf-8", errors="replace").splitlines(True)[-log_lines:])
    if job["status"] == "done":
        study = json.loads((work / "study.json").read_text(encoding="utf-8"))
        fields = json.loads((work / "fields.json").read_text(encoding="utf-8"))
        _, mesh = _mesh_payload(study["geometry"])
        out.update(study=study, mesh=mesh, fields=fields, summary=_summary(study, fields))
    return out


@app.get("/api/jobs/{job_id}/files/{kind}")
def download(job_id: str, kind: str):
    if job_id not in jobs or kind not in DOWNLOADS:
        raise HTTPException(404, "Not found")
    path = RUNS / job_id / DOWNLOADS[kind]
    if not path.exists():
        raise HTTPException(404, "File not produced")
    return FileResponse(path, filename=f"{job_id}-{DOWNLOADS[kind]}")


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
