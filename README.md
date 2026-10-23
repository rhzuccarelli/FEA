# FEA
FEA Structural Simulation

## Web UI for code_aster (`webui/`)

A browser front end for the [code_aster](https://gitlab.com/codeaster/src) finite element solver.
It starts with a simple part, a rectangular block meshed with hexahedra, and walks through:

1. **Part**: block dimensions and mesh density.
2. **Material**: presets (steel, aluminium, titanium, concrete) or custom E / ν / ρ.
3. **Supports & loads**: click a face in the 3D view (or in the list) to make it fixed, a roller or sliding,
   or to apply a pressure or a total force. Optional self-weight.
4. **Analysis**: linear static (`MECA_STATIQUE`) or modal (`CALC_MODES`).

Results are shown in the 3D viewer: deformed shape, a contour plot of displacement or von Mises stress,
animated mode shapes, max values and support reactions. The **Command file** tab shows the generated
code_aster `.comm` file, which you can edit before running. The **Solver log** tab shows the run output and
download links (`.comm`, mesh, `.rmed` results for ParaView/Salome, `.mess`).

### Running it

```bash
cd webui
pip install -r requirements.txt
./scripts/install_code_aster.sh      # code_aster from conda-forge into webui/.aster (one-off)
./scripts/serve.sh                   # http://localhost:8000
```

If code_aster is already installed elsewhere, set `CODE_ASTER_RUN=/path/to/run_aster`.
Runs are stored in `webui/runs/` (override with `FEA_RUNS_DIR`).

### Layout

- `backend/case.py`: mesh generator (ASTER mesh format) and `.comm` / `.export` builders.
- `backend/server.py`: FastAPI app that runs `run_aster` in the background and serves results as JSON.
- `static/`: the single-page front end (plain ES modules + three.js, no build step).

Default case: a 1 m × 0.1 m × 0.1 m steel cantilever with a 1 kN tip load. code_aster gives a tip
deflection of 0.172 mm (Euler–Bernoulli beam theory: 0.190 mm; linear hexahedra are slightly stiff) and a
first bending frequency of 88 Hz (beam theory: 83.5 Hz).
